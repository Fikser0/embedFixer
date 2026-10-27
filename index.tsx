/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { addMessagePreSendListener, MessageSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { React, useEffect, useState } from "@webpack/common";

import hideSpotifyStyle from "./hideSpotify.css?managed";
import type { YoutubeMatch } from "./native";
import { findSpotifyLinks, rewriteContent, RewriteOptions } from "./rewrite";

function updateStyle() {
    if (settings.store.hideNativeSpotifyEmbed) enableStyle(hideSpotifyStyle);
    else disableStyle(hideSpotifyStyle);
}

const settings = definePluginSettings({
    tiktok: { type: OptionType.BOOLEAN, description: "Rewrite TikTok links", default: true },
    tiktokDomain: { type: OptionType.STRING, description: "TikTok replacement domain (e.g. tnktok.com, vxtiktok.com)", default: "tnktok.com" },
    twitter: { type: OptionType.BOOLEAN, description: "Rewrite Twitter/X links", default: true },
    twitterDomain: { type: OptionType.STRING, description: "Twitter/X replacement domain (e.g. fxtwitter.com, vxtwitter.com, fixupx.com)", default: "fxtwitter.com" },
    instagram: { type: OptionType.BOOLEAN, description: "Rewrite Instagram links", default: true },
    instagramDomain: { type: OptionType.STRING, description: "Instagram replacement domain (e.g. ddinstagram.com, kkinstagram.com)", default: "ddinstagram.com" },
    reddit: { type: OptionType.BOOLEAN, description: "Rewrite Reddit links", default: true },
    redditDomain: { type: OptionType.STRING, description: "Reddit replacement domain (e.g. vxreddit.com)", default: "vxreddit.com" },
    blacklistedChannels: { type: OptionType.STRING, description: "Channel IDs where links are NOT rewritten (comma separated)", default: "" },
    spotifyPlayer: { type: OptionType.BOOLEAN, description: "Show Spotify player under messages with Spotify links", default: true },
    spotifyDefault: {
        type: OptionType.SELECT,
        description: "Default Spotify player",
        options: [
            { label: "YouTube (full track, no account, seek + volume)", value: "youtube", default: true },
            { label: "Spotify (30s preview unless logged in)", value: "spotify" }
        ]
    },
    hideNativeSpotifyEmbed: { type: OptionType.BOOLEAN, description: "Hide Discord's own Spotify embed (avoids two players)", default: true, onChange: updateStyle },
    spotifyHeight: { type: OptionType.NUMBER, description: "Spotify player height for tracks/episodes (px)", default: 152 },
});

function getOptions(): RewriteOptions {
    const s = settings.store;
    return {
        enabled: { tiktok: s.tiktok, twitter: s.twitter, instagram: s.instagram, reddit: s.reddit },
        domains: { tiktok: s.tiktokDomain, twitter: s.twitterDomain, instagram: s.instagramDomain, reddit: s.redditDomain },
    };
}

const preSend: MessageSendListener = (channelId, msg) => {
    const blacklist = settings.store.blacklistedChannels.split(",").map(s => s.trim()).filter(Boolean);
    if (blacklist.includes(channelId)) return;
    msg.content = rewriteContent(msg.content, getOptions());
};

const Native = IS_DISCORD_DESKTOP || IS_VESKTOP
    ? (VencordNative.pluginHelpers?.EmbedFixer as PluginNative<typeof import("./native")> | undefined)
    : undefined;

const matchCache = new Map<string, Promise<YoutubeMatch | null>>();

function resolve(url: string) {
    if (!Native) return Promise.resolve(null);
    let p = matchCache.get(url);
    if (!p) matchCache.set(url, p = Native.resolveYoutube(url).catch(() => null));
    return p;
}

type Mode = "spotify" | "youtube";

function SpotifyPlayer({ type, id, url }: { type: string; id: string; url: string; }) {
    const [mode, setMode] = useState<Mode>(settings.store.spotifyDefault as Mode);
    const [match, setMatch] = useState<YoutubeMatch | null | undefined>(undefined);

    useEffect(() => {
        if (mode !== "youtube" || match !== undefined) return;
        let cancelled = false;
        resolve(url).then(m => !cancelled && setMatch(m));
        return () => void (cancelled = true);
    }, [mode]);

    const tall = type === "album" || type === "playlist";
    const height = tall ? 352 : settings.store.spotifyHeight;

    const btn: React.CSSProperties = {
        background: "var(--button-secondary-background, #4e5058)", color: "var(--button-secondary-text, #fff)",
        border: "none", borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 500
    };

    const spotifyFrame = (
        <iframe
            src={`https://open.spotify.com/embed/${type}/${id}?theme=0`}
            width="100%" height={height}
            style={{ border: 0, borderRadius: 12 }}
            allow="encrypted-media; autoplay; clipboard-write"
            loading="lazy"
        />
    );

    let player: React.ReactNode;
    if (mode === "spotify") {
        player = spotifyFrame;
    } else if (match === undefined) {
        player = <div style={{ color: "var(--text-muted)" }}>Searching for full track…</div>;
    } else if (!match) {
        player = (
            <>
                <div style={{ color: "var(--text-danger)", fontSize: 12 }}>
                    {Native ? "No YouTube match found, showing Spotify preview." : "YouTube fallback needs the desktop app (Vesktop/Discord), showing Spotify preview."}
                </div>
                {spotifyFrame}
            </>
        );
    } else {
        const src = match.videoId
            ? `https://www.youtube.com/embed/${match.videoId}?vc_embedfixer=1`
            : `https://www.youtube.com/embed/videoseries?list=${match.listId}&vc_embedfixer=1`;
        player = (
            <>
                <iframe
                    src={src} width="100%" height={tall ? 315 : 270}
                    style={{ border: 0, borderRadius: 12, aspectRatio: "16 / 9" }}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" loading="lazy"
                />
                {(match.title || match.artist) && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        YouTube match: {[match.artist, match.title].filter(Boolean).join(" – ")}
                    </div>
                )}
            </>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 480, marginTop: 4 }}>
            {player}
            <div style={{ display: "flex", gap: 6 }}>
                {mode === "spotify"
                    ? <button style={btn} onClick={() => setMode("youtube")}>Play full track (YouTube)</button>
                    : <button style={btn} onClick={() => setMode("spotify")}>Spotify preview</button>}
            </div>
        </div>
    );
}

export default definePlugin({
    name: "EmbedFixer",
    description: "Rewrites TikTok/Twitter/Instagram/Reddit links to embed-friendly domains and adds a Spotify player (with full-track YouTube fallback)",
    authors: [{ name: "Fikser0", id: 411159664747872257n }],
    tags: ["Media", "Utility", "Chat"],
    dependencies: ["MessageEventsAPI", "MessageAccessoriesAPI"],
    settings,

    start() {
        updateStyle();
        addMessagePreSendListener(preSend);
        addMessageAccessory("EmbedFixerSpotify", props => {
            if (!settings.store.spotifyPlayer) return null;
            const links = findSpotifyLinks(props.message?.content ?? "");
            if (!links.length) return null;
            return <>{links.slice(0, 3).map(l => <SpotifyPlayer key={l.id} {...l} />)}</>;
        });
    },

    stop() {
        disableStyle(hideSpotifyStyle);
        removeMessagePreSendListener(preSend);
        removeMessageAccessory("EmbedFixerSpotify");
    },
});
