# AniTube for Lampa

A Lampa plugin that adds a **🟢 AniTube** action to a card. It opens a series page (voice, season and episode chips, like the UAKino plugin's) with Ukrainian voice-overs and subtitles, and plays the episode in Lampa's player with a playlist, so next/previous episode work.

Current version: **1.8.2**.

## Add the plugin to Lampa

Settings → Extensions → Add plugin, and enter the direct JavaScript URL:

`https://dez955.github.io/anionline/anitube.js`

Restart Lampa or refresh its plugins after an update (Lampa caches plugins; adding `?v=<number>` to the address forces a reload). Earlier versions are kept at `old/anitube-0.7.0.js` (AniTube only), `old/anitube-1.2.0.js` and `old/anitube-1.7.2.js`.

## Sources

The **Джерело** chip on the page switches between them. While no source has been chosen for a card and a search finds nothing, the next one is tried on its own (AniTube → Makhno → AnimeOn → UAflix → DoramaUA → AniLibria); a source you pick is remembered for that card.

- **AniTube** (anitube.in.ua): search and playlists; only the Ashdi player is used, because it gives a direct HLS address.
- **Makhno**: Ashdi's own catalogue, found by the card's TMDB number (the public server of the "Bandera Online" Lampa plugin only says which Ashdi page belongs to the number). The Ashdi page lists every voice with its seasons and episodes, which the plugin reads itself; it also gives separate subtitle files. Films work too.
- **AnimeOn** (animeon.club): works through the same public server of "Bandera Online", which also turns an episode into an Ashdi address. It is someone else's service and can fail or change.
- **UAflix** (uafix.net): anime, films, series and dramas. The site shows its player only to Ukrainian addresses, so it works on an Android Lampa (the request goes from your own network) and on a Smart TV through a **home box** (below), but not through the helper servers. Each episode page has two players, listed as two voices: the Ukrainian voice-over and the original with Ukrainian subtitles; only episodes that really have the chosen one are shown.
- **DoramaUA** (doramaua.tv): dramas. The catalogue API is open; the player page (`w.davidog.top`) lists every season, episode and voice (Ukrainian voice-over first, then subtitles; other studios are Russian and only appear with the Russian sources switched on) and states the stream address in plain text. Like UAflix it needs a Ukrainian address: Android Lampa, or a home box.
- **AniLibria** (anilibria.top): anime with a **Russian** voice-over, from the site's own public API. Its 1080p averages about 3.2 Mbit/s, higher than the Ukrainian sources. It is the last one tried, for titles that have no Ukrainian voice-over.

Subtitles that come as a separate file on the player page are passed to Lampa's player, so they can be chosen there. Subtitles burned into the picture cannot be switched off. The player header shows the source's title instead of a card name written in the original (e.g. Japanese) letters; if the card has no translation, the Ukrainian or English name from TMDB is also used to search.

Video quality is whatever the source offers: Ashdi, zetvideo and AnimeOn give 1080p at about 2 Mbit/s, so fast scenes can show blocks. The plugin cannot improve that.

## Home box (Smart TVs)

A Smart TV cannot read UAflix or DoramaUA itself, and the helper servers are refused. An Android TV box in the same network can ask the sites from your home connection: run `home-proxy/box-relay.mjs` on it (Termux + Node.js 18 or newer: `ACCESS_KEY=<key> node box-relay.mjs`), then enter its address in Settings → AniTube → "Адреса приставки" (for example `192.168.0.15:8787`; the port 8787 is the default). "Перевірити приставку" shows whether it answers and what it can reach. The address changes when the box is moved to another network.

## Settings

Settings → AniTube: **Показувати російські джерела** (off by default; turns on AniLibria), **Забути запам'ятовані вибори** (clears the hand-typed names, chosen titles, voices and sources remembered per card), and the optional proxy address and key.

## How a title is found

The card's names in all languages are searched at once (Ukrainian and Russian first, then English/romaji): the card's own names, its TMDB alternative titles and translations, and, for a card with only a Japanese name, the romaji/English titles from AniList. Results are ranked by how closely their names match, a clear winner opens by itself, otherwise a list is shown. An empty entry in **Пошук** clears a hand-typed name. Seasons of the same show appear as chips; other candidates are under **Інші варіанти**.

## Samsung Tizen / LG webOS

These TVs cannot read AniTube or Ashdi pages themselves (no CORS permission), so the plugin goes through a small helper, by default the owner's Cloudflare Worker (`home-proxy/cloudflare-worker.js`), which relays the Ashdi pages through the owner's bot. Its address and key are built into the plugin; anything typed in Settings → AniTube overrides them. The key is public in this repository and can be rotated (Worker secret, the bot's `ANITUBE_ACCESS_KEY`, the constant in `anitube.js`). Details are in [`home-proxy/README.md`](home-proxy/README.md).

Makhno and AnimeOn call a public server directly; Makhno also reads the Ashdi show page, which on a Smart TV goes through the same helper as the Ashdi player pages.

## Limits

- Nothing is cached or stored on a server, and no provider scripts are executed.
- A request goes out each time a card's page is opened; nothing runs while Lampa is idle.
- On Android Lampa the plugin reads AniTube and uafix directly through Lampa's native request (your own network).
