/*
 * EmbedFixer, a Vencord plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

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
