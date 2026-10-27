/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface RewriteRule {
    id: "tiktok" | "twitter" | "instagram" | "reddit";
    /** Base domains (without subdomain) that this rule matches */
    bases: string[];
    /** Path must match to be rewritten */
    path: RegExp;
    /** Keep the original subdomain (needed for tiktok short links vm./vt.) */
    keepSub: boolean;
}

export const RULES: RewriteRule[] = [
    { id: "tiktok", bases: ["tiktok.com"], path: /^\/(@[^/]+\/(video|photo)\/|t\/|[\w-]{6,}\/?$)/, keepSub: true },
    { id: "twitter", bases: ["twitter.com", "x.com"], path: /^\/[^/]+\/status(es)?\/\d+/, keepSub: false },
    { id: "instagram", bases: ["instagram.com"], path: /^\/(p|reel|reels|tv|share)\//, keepSub: false },
    { id: "reddit", bases: ["reddit.com"], path: /^\/r\/[^/]+\/(comments|s)\//, keepSub: false },
];

export interface RewriteOptions {
    enabled: Record<RewriteRule["id"], boolean>;
    domains: Record<RewriteRule["id"], string>;
}

const CODE_RE = /(```[\s\S]*?```|`[^`\n]+`)/g;
const URL_RE = /(<)?(https?:\/\/[^\s<>]+)(>)?/g;

export function rewriteUrl(raw: string, opts: RewriteOptions): string | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }

    const host = url.hostname.toLowerCase();
    for (const rule of RULES) {
        if (!opts.enabled[rule.id]) continue;
        const domain = opts.domains[rule.id]?.trim();
        if (!domain) continue;

        const base = rule.bases.find(b => host === b || host.endsWith("." + b));
        if (!base) continue;
        if (!rule.path.test(url.pathname)) return null;

        const sub = host === base ? "" : host.slice(0, -(base.length + 1));
        url.hostname = rule.keepSub && sub ? `${sub}.${domain}` : domain;
        url.protocol = "https:";
        return url.toString();
    }
    return null;
}

/** Rewrites supported links, skipping code blocks and <wrapped> links. */
export function rewriteContent(content: string, opts: RewriteOptions): string {
    return content
        .split(CODE_RE)
        .map((part, i) => {
            if (i % 2 === 1) return part; // code
            return part.replace(URL_RE, (match, open, link, close) => {
                if (open) return match;
                // strip trailing punctuation which is not part of the url
                const trail = link.match(/[.,;:!?)\]]+$/)?.[0] ?? "";
                const clean = trail ? link.slice(0, -trail.length) : link;
                const res = rewriteUrl(clean, opts);
                return res ? res + trail + (close ?? "") : match;
            });
        })
        .join("");
}

export const SPOTIFY_RE = /https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode)\/([A-Za-z0-9]+)/g;

export function findSpotifyLinks(content: string): { type: string; id: string; url: string; }[] {
    const out: { type: string; id: string; url: string; }[] = [];
    const seen = new Set<string>();
    for (const m of content.replace(CODE_RE, "").matchAll(SPOTIFY_RE)) {
        if (seen.has(m[2])) continue;
        seen.add(m[2]);
        out.push({ type: m[1], id: m[2], url: `https://open.spotify.com/${m[1]}/${m[2]}` });
    }
    return out;
}
