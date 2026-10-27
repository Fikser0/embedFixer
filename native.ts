/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RendererSettings } from "@main/settings";
import { app, type IpcMainInvokeEvent } from "electron";

/** Marker added to our YouTube embed urls so we only touch our own players */
const FRAME_MARKER = "vc_embedfixer=1";

// Strips YouTube ad metadata (including 2024+ adSlots & adBreakHeartbeatParams that
// Vencord's built-in YoutubeAdblock misses and which cause a black screen while pre-roll
// ad pods play) and keeps a fast-forward fallback skipper.
const AD_SKIPPER = `(() => {
    if (window.__vcEfSkip) return;
    window.__vcEfSkip = true;
    window.adguardInjected = true;

    const AD_KEYS = ["adPlacements", "playerAds", "adSlots", "adBreakHeartbeatParams", "interstitialPods", "playerCueRanges", "playerCueRangeSet"];

    const stripAds = (obj, seen = new WeakSet()) => {
        if (!obj || typeof obj !== "object" || seen.has(obj)) return obj;
        seen.add(obj);
        for (const k of AD_KEYS) {
            if (Object.prototype.hasOwnProperty.call(obj, k)) delete obj[k];
        }
        for (const k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k)) {
                const v = obj[k];
                if (v && typeof v === "object") stripAds(v, seen);
            }
        }
        return obj;
    };

    for (const k of AD_KEYS) {
        try {
            Object.defineProperty(Object.prototype, k, {
                configurable: true,
                enumerable: false,
                get() { return undefined; },
                set() { }
            });
        } catch { }
    }

    const origParse = JSON.parse;
    JSON.parse = function (...args) {
        const res = origParse.apply(this, args);
        return res && typeof res === "object" ? stripAds(res) : res;
    };

    const origJson = Response.prototype.json;
    Response.prototype.json = async function (...args) {
        const res = await origJson.apply(this, args);
        return res && typeof res === "object" ? stripAds(res) : res;
    };

    let mutedByUs = false;
    let onesieDisabled = false;
    const SKIP = ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[id^='skip-button']";
    const tick = () => {
        const player = document.querySelector(".html5-video-player");
        if (player && !onesieDisabled && typeof player.forceExperimentFlagsForTesting === "function") {
            try {
                player.forceExperimentFlagsForTesting({
                    html5_disable_onesie: "true",
                    html5_onesie: "false",
                    html5_onesie_wait_for_media_availability: "false"
                });
                onesieDisabled = true;
            } catch { }
        }
        const video = document.querySelector("video");
        if (!player || !video) return;
        const ad = player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting");
        if (ad) {
            if (!video.muted) { video.muted = true; mutedByUs = true; }
            video.playbackRate = 16;
            if (isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
            document.querySelectorAll(SKIP).forEach(b => b.click());
            if (typeof player.cancelPlayback === "function") {
                try { player.cancelPlayback(); player.playVideo?.(); } catch { }
            }
        } else {
            if (video.playbackRate === 16) video.playbackRate = 1;
            if (mutedByUs) { video.muted = false; mutedByUs = false; }
        }
    };
    tick();
    setInterval(tick, 50);
    new MutationObserver(tick).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
})();`;

const isOurEmbed = (url?: string) => Boolean(url && url.includes("youtube.com/embed/") && url.includes(FRAME_MARKER));

app.on("browser-window-created", (_, win) => {
    win.webContents.on("frame-created", (_, { frame }) => {
        frame?.prependOnceListener("dom-ready", () => {
            if (!RendererSettings.store.plugins?.EmbedFixer?.enabled) return;
            if (isOurEmbed(frame.url)) {
                frame.executeJavaScript(AD_SKIPPER).catch(() => { });
            } else if (isOurEmbed(frame.parent?.url)) {
                frame.parent?.executeJavaScript(AD_SKIPPER).catch(() => { });
            }
        });
    });
});

export interface YoutubeMatch {
    title?: string;
    artist?: string;
    videoId?: string;
    listId?: string;
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function decodeEntities(s: string) {
    return s
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
        .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function spotifyMeta(spotifyUrl: string): Promise<{ title?: string; artist?: string; }> {
    try {
        // Spotify serves a server-rendered page with meta tags only to simple user agents
        const res = await fetch(spotifyUrl, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en" } });
        if (res.ok) {
            const html = await res.text();
            const title = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/)?.[1];
            const desc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/)?.[1];
            if (title) {
                // description looks like "Artist · Album · Song · 1987"
                const artist = desc ? decodeEntities(desc).split("·")[0]?.trim() : undefined;
                return { title: decodeEntities(title).replace(/^Listen to /, "").replace(/ \| Spotify$/, ""), artist };
            }
        }
    } catch { /* fall through to oEmbed */ }

    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`);
    if (!res.ok) return {};
    const json = await res.json();
    return { title: json.title };
}

async function viaYoutubeSearch(spotifyUrl: string): Promise<YoutubeMatch | null> {
    const meta = await spotifyMeta(spotifyUrl);
    if (!meta.title) return null;
    const q = `${meta.artist ?? ""} ${meta.title}`.trim();
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
        headers: { "User-Agent": UA, "Accept-Language": "en" }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const videoId = html.match(/"videoId":"([\w-]{11})"/)?.[1];
    return videoId ? { ...meta, videoId } : null;
}

const cache = new Map<string, YoutubeMatch | null>();

export async function resolveYoutube(_: IpcMainInvokeEvent, spotifyUrl: string): Promise<YoutubeMatch | null> {
    if (!/^https:\/\/open\.spotify\.com\/(track|album|playlist|episode)\/[A-Za-z0-9]+$/.test(spotifyUrl)) return null;
    if (cache.has(spotifyUrl)) return cache.get(spotifyUrl)!;

    let result: YoutubeMatch | null = null;
    try {
        result = await viaYoutubeSearch(spotifyUrl);
    } catch (e) {
        console.error("[EmbedFixer] resolve failed", e);
    }
    cache.set(spotifyUrl, result);
    return result;
}
