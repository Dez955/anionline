# Home proxy for TVs that cannot reach AniTube themselves

Lampa on **Android** reads AniTube directly with its native requests, so Android TV boxes need nothing from this folder.
Lampa on **Samsung Tizen** or **LG webOS** runs inside a browser engine: AniTube and Ashdi send no CORS permission, so the TV
cannot read their pages, and AniTube refuses requests from cloud hosts such as Netlify (HTTP 403). This small helper runs on a
device in your own network, so AniTube sees ordinary home traffic.

It has no dependencies (Node.js 18 or newer), stores nothing, and only fetches three kinds of pages: an AniTube search page, an
AniTube show's playlist, and an Ashdi player page. It only answers clients on a private network (192.168.x.x, 10.x.x.x,
172.16–31.x.x, localhost); anything else gets HTTP 403.

## Run it

On an always-on device in the same network as the TV (Raspberry Pi, NAS, home server, a PC that stays on):

```bash
node server.mjs
```

It prints the address, by default port `8787`. Use another port with `PORT=9000 node server.mjs`. Keep it running while you watch
(for a permanent setup use your device's own service manager, e.g. systemd on a Raspberry Pi). Test it from another device:
`http://<device-ip>:8787/health` should answer `{"ok":true}`.

## Tell Lampa where it is

On the TV open **Settings → AniTube → Адреса домашнього проксі** and enter `http://<device-ip>:8787`, for example
`http://192.168.0.10:8787`. Leave it empty on Android.

Notes:

- If Lampa on your TV is opened through an `https://` address, the browser blocks calls to an `http://` helper (mixed content).
  The plugin says so in its error message; then the helper needs HTTPS, or Lampa must be opened over `http://`.
- Only the page requests go through the helper. The video itself still streams from Ashdi straight to the TV, so playback needs
  a player that can open Ashdi's HLS stream without extra browser permissions (Lampa's built-in player on Tizen and webOS normally
  does this natively). This has not been verified on a real Tizen/webOS TV.

## On a hosted server instead (Koyeb, Render, Fly, a VPS)

The same file also runs on a server reachable from the internet, with two differences: it must be protected by a secret, and AniTube
has to accept that server's address (many cloud hosts are refused with HTTP 403, as Netlify is; the proxy then answers 502 with
`HTTP 403` in its message, which the plugin shows).

1. Make a long random secret, for example `openssl rand -hex 16`, and keep it private.
2. Deploy this folder as a separate service with the secret in the `ACCESS_KEY` environment variable. The included `Dockerfile` listens
   on port 8000 (override with `PORT`). On Koyeb: Create service → GitHub → `Dez955/anionline` → builder **Dockerfile**, Dockerfile
   location `home-proxy/Dockerfile`, work directory `home-proxy`, port 8000 (HTTP), health check path `/health`, environment variable
   `ACCESS_KEY`. Koyeb serves it over HTTPS automatically. A free plan may allow only one web service; a bot already running there
   would have to share that slot or be moved.
3. On the TV: **Settings → AniTube** → *Адреса проксі* `https://<your-service>.koyeb.app` and *Ключ проксі* = the secret.

With `ACCESS_KEY` set every request except `/health` must carry `?key=<secret>`; without it only private-network clients are served.

## On Cloudflare Workers (free)

[`cloudflare-worker.js`](cloudflare-worker.js) is the same helper as a Cloudflare Worker, for a free account and no server to keep.
AniTube refuses requests from Netlify and Koyeb (HTTP 403); whether it accepts Cloudflare's network is only known by trying.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker** → name it (e.g. `anitube-proxy`) → **Deploy** → **Edit code**.
2. Replace the sample code with the whole of `cloudflare-worker.js` and **Deploy**.
3. Worker → **Settings** → **Variables and Secrets** → **Add** → Type **Secret**, name `ACCESS_KEY`, value = a long random text (16+ characters) → **Deploy**.
4. Test in a browser: `https://<name>.<account>.workers.dev/search?q=naruto&key=<secret>` should show an HTML page. `{"error": "HTTP 403"}` means AniTube refuses Cloudflare too.
5. In Lampa: Settings → AniTube → *Адреса проксі* = `https://<name>.<account>.workers.dev`, *Ключ проксі* = the secret.

**Ashdi geo-block.** Ashdi shows "Плеєр недоступний … в цій країні" to servers in some countries, and Cloudflare's servers can be among
them (search and playlist from AniTube work, the player page does not). If so, add a *Text* variable `EMBED_URL` to the Worker
(Settings → Variables and Secrets → Add → Type **Text**) set to the address of another proxy that Ashdi accepts, for example the bot's
`https://<service>.koyeb.app/anitube`. The Worker then relays only `/embed` there using the same `ACCESS_KEY`, so both must hold the
same secret. Search and playlist keep going through Cloudflare.
