# EmbedFixer (Vencord plugin)

- **Link rewriting** (on send): TikTok → `tnktok.com`, Twitter/X → `fxtwitter.com`, Instagram → `ddinstagram.com`, Reddit → `vxreddit.com`. Domains are configurable. Links in `<angle brackets>` and code blocks are left alone. Per-service toggles and a channel blacklist.
- **Spotify player** under messages with Spotify links (track/album/playlist/episode):
  - Official Spotify embed (full track if you're logged into Spotify inside the client, otherwise 30s preview).
  - **Play full track (YouTube)** button: finds the matching YouTube video and plays it in an embedded player, no Spotify account needed. Needs the desktop app (Vesktop/Discord) — uses `native.ts`.

## Install (userplugin)
```sh
git clone https://github.com/Vendicated/Vencord && cd Vencord
pnpm install --frozen-lockfile
git clone https://github.com/Fikser0/embedFixer.git src/userplugins/embedFixer
pnpm build
```
Then inject (`pnpm inject`) or, for Vesktop, set Settings → Vencord Location to `Vencord/dist`. Enable **EmbedFixer** in Vencord plugin settings.

## Notes
- Rewrite domains are third-party services and may change; edit them in settings.
- YouTube match is a search result, so it can be inexact (live/remix).

License: GPL-3.0-or-later.
