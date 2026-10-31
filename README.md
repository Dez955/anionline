# AniTube for Lampa

A Lampa plugin that adds a **🟢 AniTube** action to a card. It opens a series page (voice, season and episode chips, like the UAKino plugin's) with Ukrainian voice-overs and subtitles, and plays the episode in Lampa's player with a playlist, so next/previous episode work.

Current version: **1.1.0**.

## Add the plugin to Lampa

Settings → Extensions → Add plugin, and enter the direct JavaScript URL:

`https://dez955.github.io/anionline/anitube.js`

Restart Lampa or refresh its plugins after an update (Lampa caches plugins; adding `?v=<number>` to the address forces a reload). The previous version 0.7.0 is kept at `old/anitube-0.7.0.js`.

## Sources

The **Джерело** chip on the page switches between them. While no source has been chosen for a card and a search finds nothing, the next one is tried on its own (AniTube → Makhno → AnimeOn → UAflix); a source you pick is remembered for that card.

- **AniTube** (anitube.in.ua): search and playlists; only the Ashdi player is used, because it gives a direct HLS address.
- **Makhno**: Ashdi's own catalogue, found by the card's TMDB number (the public server of the "Bandera Online" Lampa plugin only says which Ashdi page belongs to the number). The Ashdi page lists every voice with its seasons and episodes, which the plugin reads itself; it also gives separate subtitle files. Films work too.
- **AnimeOn** (animeon.club): works through the same public server of "Bandera Online", which also turns an episode into an Ashdi address. It is someone else's service and can fail or change.
- **UAflix** (uafix.net): series and films. The site shows its player only to Ukrainian addresses, so it works on an Android box (the request goes from your own network) but not through the helper servers used for Smart TVs.

Subtitles that come as a separate file on the player page are passed to Lampa's player, so they can be chosen there. Subtitles burned into the picture cannot be switched off. The player header shows the source's title instead of a card name written in the original (e.g. Japanese) letters; if the card has no translation, the Ukrainian or English name from TMDB is also used to search.

Video quality is whatever the source offers: Ashdi, zetvideo and AnimeOn give 1080p at about 2 Mbit/s, so fast scenes can show blocks. The plugin cannot improve that.

## Samsung Tizen / LG webOS

These TVs cannot read AniTube or Ashdi pages themselves (no CORS permission), so the plugin goes through a small helper, by default the owner's Cloudflare Worker (`home-proxy/cloudflare-worker.js`), which relays the Ashdi pages through the owner's bot. Its address and key are built into the plugin; anything typed in Settings → AniTube overrides them. The key is public in this repository and can be rotated (Worker secret, the bot's `ANITUBE_ACCESS_KEY`, the constant in `anitube.js`). Details are in [`home-proxy/README.md`](home-proxy/README.md).

Makhno and AnimeOn call a public server directly; Makhno also reads the Ashdi show page, which on a Smart TV goes through the same helper as the Ashdi player pages.

## Limits

- Nothing is cached or stored on a server, and no provider scripts are executed.
- A request goes out each time a card's page is opened; nothing runs while Lampa is idle.
- On Android Lampa the plugin reads AniTube and uafix directly through Lampa's native request (your own network).
