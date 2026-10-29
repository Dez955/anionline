# AniTube for Lampa

The Lampa plugin searches AniTube when the viewer opens the AniTube action. It reads the current search page each time, then loads the selected show's current playlist through AniTube's `/engine/ajax/playlists.php` endpoint. It keeps no catalogue and sends `no-store` cache headers, so a new AniTube post appears the next time the viewer searches. It does not poll while Lampa is idle or closed.

The plugin is served from GitHub Pages, while a small Netlify Function makes the AniTube requests for Lampa. AniTube does not send browser CORS permission headers, so a browser on a TV cannot read its pages directly. The function only accepts search requests and detail pages hosted on `anitube.in.ua`; it does not accept arbitrary proxy URLs or save site data.

## Deploy the server function

The Netlify project `anitube-lampa-proxy` has already been created. Its Git-backed deployment still needs to be connected:

1. Open [the Netlify project](https://app.netlify.com/projects/anitube-lampa-proxy).
2. Choose **Link repository** (or **Import from Git**) and select `Dez955/anionline` on branch `main`.
3. Keep the repository root as the base directory. Netlify reads `netlify.toml`, copies `anitube.js` into the publish folder, and deploys `netlify/functions/anitube.mjs` as the API.
4. Deploy the site. Netlify will then serve the function at `https://anitube-lampa-proxy.netlify.app/.netlify/functions/anitube`.

The API must be reachable without an SSO sign-in because Lampa calls it from the TV. Its requests are limited to AniTube search and episode-list retrieval. No credentials or cookies are forwarded.

## Add the plugin to Lampa

Use the direct JavaScript URL in Lampa's plugin settings:

`https://dez955.github.io/anionline/anitube.js`

Restart Lampa or refresh its plugins after the GitHub Pages update. The action is labeled **🟢 AniTube** in the plugin menu and on the details card.

## Limits

- “Fresh” means every search requests the current AniTube page. The plugin does not continuously poll for new titles while nobody is using it.
- Playback works only when AniTube exposes a direct HTTPS media URL that Lampa supports. Embedded players, DRM, provider-specific scripts, and separate subtitle extraction are not implemented.
- AniTube may change its HTML, block server requests, or change its playlist endpoint. The TV and Lampa build still need an on-device check after deployment.
