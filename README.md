# AniTube for Lampa

A Lampa plugin that adds an **AniTube** action with an SVG play icon to a card. It opens a series page (voice, season and episode chips, like the UAKino plugin's) with Ukrainian voice-overs and subtitles, and plays the episode in Lampa's player with a playlist, so next/previous episode work.

Current channels (8 November 2026):

- Working **2.0.9**: `https://dez955.github.io/a.js`, pinned to the unchanged `old/anitube-2.0.9.js`.
- Test beta **2.0.10** with DoramaUA: `https://dez955.github.io/anionline/anitube-beta.js?v=2.0.10`.
- Legacy `anitube.js`: **1.8.19**, unchanged.

Use one AniTube address at a time. DoramaUA on TVs requires the updated Cloudflare Worker; see [BETA.md](BETA.md).

Before the 1.8.3 changes on 2 November 2026, the local `anitube.js` and the published main and beta files were downloaded and verified byte-for-byte identical (SHA-256: `da74b5160d65caf4b0a0584e4d966ee831e6336df389a259263757f0b85d285d`). The local source is `anitube.js`; `anitube-beta.js` is the beta publication filename, not a separate local source. New changes go to beta first; publishing to main requires the owner’s instruction.

## Add the plugin to Lampa

Settings → Extensions → Add plugin, and enter the direct JavaScript URL:

`https://dez955.github.io/a.js`

Restart Lampa or refresh its plugins after an update (Lampa caches plugins; adding `?v=<number>` to the address forces a reload). Earlier versions are kept at `old/anitube-0.7.0.js` (AniTube only) and `old/anitube-1.2.0.js`.

## Sources

The **Джерело** chip on the page switches between them. While no source has been chosen for a card and a search finds nothing, the next one is tried on its own (AniTube → Makhno → AnimeOn → UAflix → DoramaUA → AniLibria); a source you pick is remembered for that card.

- **AniTube** (anitube.in.ua): search and playlists; only the Ashdi player is used, because it gives a direct HLS address.
- **Makhno**: Ashdi's own catalogue, found by the card's TMDB number (the public server of the "Bandera Online" Lampa plugin only says which Ashdi page belongs to the number). The Ashdi page lists every voice with its seasons and episodes, which the plugin reads itself; it also gives separate subtitle files. Films work too.
- **AnimeOn** (animeon.club): works through the same public server of "Bandera Online", which also turns an episode into an Ashdi address. It is someone else's service and can fail or change.
- **UAflix** (uafix.net): series and films. The site shows its player only to Ukrainian addresses, so it works on an Android box (the request goes from your own network) but not through the cloud helper servers used for Smart TVs. Version 1.8.2 also supports a relay on the owner’s home Android box; the Samsung-to-box path still needs TV verification.
- **DoramaUA** (doramaua.tv): dramas from its catalogue API and player pages. Available on Android or when a home box address is configured. Ukrainian voice-over comes first, then Ukrainian subtitles; Russian voices are hidden unless the Russian switch is enabled. Player pages are requested directly on Android or through the home box.
- **AniLibria** (anilibria.top): anime with a **Russian** voice-over, from the site's own public API. Its 1080p averages about 3.2 Mbit/s, higher than the Ukrainian sources. It is tried last, and only when **Показувати російські джерела** is enabled.

Subtitles that come as a separate file on the player page are passed to Lampa's player, so they can be chosen there. Subtitles burned into the picture cannot be switched off. The player header uses the selected source title, except for AniLibria, where the card’s translated display name is preferred; if the card has no translation, the Ukrainian or English name from TMDB is also used to search.

Video quality is whatever the source offers: Ashdi, zetvideo and AnimeOn give 1080p at about 2 Mbit/s, so fast scenes can show blocks. The plugin cannot improve that.

## Settings

Settings → AniTube: **Показувати російські джерела** (off by default; enables AniLibria and Russian voices in DoramaUA), **Забути запам'ятовані вибори** (clears the hand-typed names, chosen titles, voices and sources remembered per card), **Адреса приставки** and **Перевірити приставку**, and the optional proxy address and key.

For the home relay, enter `<box-ip>:8787`, then press **Перевірити приставку**. The box must be on the same network and its Termux relay must be running. The IP may change between networks. The relay currently has no automatic restart after a box reboot. HTTPS Lampa may block an HTTP box address; this path has not been verified on Samsung.

## How a title is found

The card's names in all languages are searched at once (Ukrainian and Russian first, then English/romaji): the card's own names, its TMDB alternative titles and translations, and, for a card with only a Japanese name, the romaji/English titles from AniList. Results are ranked by how closely their names match, a clear winner opens by itself, otherwise a list is shown. An empty entry in **Пошук** clears a hand-typed name. Seasons of the same show appear as chips; other candidates are under **Інші варіанти**.

## Samsung Tizen / LG webOS

These TVs cannot read AniTube or Ashdi pages themselves (no CORS permission), so the plugin goes through a small helper, by default the owner's Cloudflare Worker (`home-proxy/cloudflare-worker.js`), which relays the Ashdi pages through the owner's bot. Its address and key are built into the plugin; anything typed in Settings → AniTube overrides them. The key is public in this repository and can be rotated (Worker secret, the bot's `ANITUBE_ACCESS_KEY`, the constant in `anitube.js`). Details are in [`home-proxy/README.md`](home-proxy/README.md).

Makhno and AnimeOn call a public server directly; Makhno also reads the Ashdi show page, which on a Smart TV goes through the same helper as the Ashdi player pages.

## Limits

- Nothing is cached or stored on a server, and no provider scripts are executed.
- A request goes out each time a card's page is opened; nothing runs while Lampa is idle.
- On Android Lampa the plugin reads provider pages through Lampa’s native request (your own network).

## Project files and verification

- `anitube.js`: local candidate 1.8.4, including all six sources, the series screen, remote navigation and playback.
- `home-proxy/cloudflare-worker.js`: cloud page relay; Ashdi pages can be relayed through the owner’s Koyeb bot.
- `home-proxy/box-relay.mjs`: home-box relay for UAflix and DoramaUA. Its own version is 1.1.0; helper versions are independent of the plugin version.
- `home-proxy/server.mjs` and `netlify/`: older alternatives, not the current deployment path. Do not start or deploy them implicitly.
- `dev/sim-ui.mjs`: simulated Lampa with real provider requests; supports `SRC=dorama` and `BOX=<address>` as well as the other sources. It does not test actual TV playback, browser CORS or remote-control behavior.
- `dev/bench-anilibria.py`: search benchmark, not proof that the selected video plays correctly.
- `dev/PLAN.md`: current remaining work; `AGENTS.md`: detailed project context and operating rules.

Episode names, descriptions and stills are taken from TMDB when the selected show and episode counts are compatible; otherwise generic labels and the card backdrop remain.

Open issues: AniLibria search misses and the reported wrong-video case still need full-path verification; Samsung access to the home box and relay restart after reboot remain unverified/unimplemented. External aggregator availability and earlier bitrate measurements have not been rechecked by the documentation audit.

The documentation audit changed no deployed services. Subsequent local work is described below.

## Local candidate 1.8.3 (not published)

Episode cards separate team/player and premiere date (`DD.MM.YYYY`) / runtime. Partial seasons can use TMDB episode metadata only when the selected result matches the card and episode numbers form a known prefix. Maximum quality is read from AniLibria’s selected API URL or an accessible HLS master playlist; unknown quality stays blank. The first eight episodes are inspected in the background (two tasks at a time), others when focused. Playback stays on the original stream; the quality label does not force the player’s adaptive selection.

AniTube now retains all team/player variants and provides a separate **Плеєр** selector. Ashdi remains preferred when no saved team/player is available. Fenix and other unimplemented iframe hosts are labelled unsupported. Moon is experimental: its configuration is parsed without running provider scripts, including the public-page wrapper format studied in [AnitubeApp](https://github.com/MrIkso/AnitubeApp/blob/main/app/src/main/java/com/mrikso/anitube/app/extractors/MoonAnimeArtExtractor.java). This does not prove current Moon compatibility: the real sample returned HTTP 400 with body `500`. Browser-header testing was rejected by automatic approval review and was not executed.

The local Worker adds `/moon` for allowlisted public Moon iframe pages. It has not been deployed; Samsung needs this updated Worker if direct browser access fails. The plugin and Worker changes are local; main remains 1.8.2.

Verification: `node dev/test-episode-ui.mjs`, `node dev/test-worker-moon.mjs`, and `FIXTURE=1` screen cases in `dev/sim-ui.mjs`. Screen fixtures mock TMDB and stream responses; a separate live Ashdi check obtained the real playlist and HLS URL and read its 1080/720/480 manifest. Actual TV playback and real Moon playback remain unverified. See `dev/research-1.8.3.md` for evidence and limits.

## Local iteration 1.8.4 (not published)

Version 1.8.3 was archived before this iteration; later iterations must increment the version (next: 1.8.5), with separate records of local and published status in `CHANGELOG.md`.

After explicit user approval, Moon was requested with a browser User-Agent. The first and second Morys episodes on `.net` and the first on the known `.art` domain still returned HTTP 400 with body `500`. No configuration or video URL was obtained. Browser-header testing is no longer awaiting permission; the earlier rejection described above belongs to 1.8.3. The runtime did not gain a permanent browser User-Agent because it did not help.

Error messages now distinguish provider failures from missing Worker routes and proxy authentication. Tests pass, but real Moon playback remains unverified. Neither main/beta publication nor Worker deployment occurred. An installation URL with `?v=1.8.4` would still return the published 1.8.2 until actual publication; do not treat the query parameter as deployment.


## Publication of beta 1.8.4

Published for online testing on 2 November 2026 at the user’s explicit request. GitHub commit: 3619c8a16885690e220c4bc19141e2924521afef. Pages beta was verified byte-for-byte against the local source; main remains unchanged at 1.8.2. Previous unpublished-status notes above describe the stages before this publication. Worker source is published for manual deployment; Cloudflare itself has not been updated. Moon remains experimental. Setup and rollback: `BETA.md`.


## Candidate 1.8.5

Modern/legacy Moon configuration parsing, rawVideo/rawSubtitle, explicit quality lists (highest declared resolution), and /vod support have been implemented and tested. Real sample requests still return HTTP 400 / 500; real Moon playback is not confirmed. The prepared commit is 87b61985cc86a4d466bc1dcd639e8bdf5b069b2f, but automatic approval review rejected updating main because it requires a separate publication instruction for 1.8.5. No ref was moved; published beta is still 1.8.4. The local BETA.md describes the candidate’s eventual setup, not an already deployed 1.8.5.


## Beta 1.8.5 published after explicit approval

The user explicitly authorized publishing 1.8.5. Commit 87b61985cc86a4d466bc1dcd639e8bdf5b069b2f has now been applied; earlier rejection notes describe the preceding stage. Stable remains 1.8.2; Cloudflare deployment is still manual. Install and test using `BETA.md`.


## Candidate 1.8.6

A persistent SVG arrow toggle reverses episode display order across all six sources. Episode progress and chronological autoplay are preserved. Moon gains visible startup status and bounded error reporting using Lampa player events. Tests cover 1180 episodes, click mapping, saved order, progress and timeout cleanup.

Live Moon page/configuration and HLS manifests were read successfully, but a video segment returned HTTP 403 with a Cloudflare browser challenge; the deployed Worker also failed to read the Moon page. Actual Moon playback on Samsung/LG remains unconfirmed. This release adds no dependency on another repository or an Android box.
