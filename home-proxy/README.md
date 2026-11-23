# Network helpers for AniTube / ДубльUA

Current deployment (updated 23 November 2026):

- Android Lampa requests provider pages natively from its own connection.
- Samsung/webOS uses `cloudflare-worker.js` for AniTube; Ashdi pages are relayed through the owner’s Koyeb bot using `EMBED_URL`.
- The built-in Worker's fixed catalogue/player routes are public; Lampa does not send a key. Its secret `ACCESS_KEY` is used only for Worker → Koyeb relay calls and must match the Koyeb service's `ANITUBE_ACCESS_KEY`.
- `box-relay.mjs` on the owner’s TiVo/Termux handles UAflix and DoramaUA pages from the home connection. It is a separate helper, version **1.1.0**, compatible with plugin **1.8.2**.
- Video streams directly from the hosting service to the player; helpers do not relay the video.

## Home box used by 1.8.2

The existing TiVo setup has `~/anitube/box-relay.mjs`, `~/anitube/box.key` and `~/anitube/start.sh`. Start it in Termux with `bash ~/anitube/start.sh` when needed; it listens on port 8787. There is currently no automatic restart after reboot; [AUTOSTART.md](AUTOSTART.md) and `termux-boot.sh` (Termux:Boot) provide one; on the real box (9 Nov 2026) the relay answered by itself about 100 s after a reboot. Relay **1.2.0** also accepts Tailscale addresses (100.64.0.0/10).

In Lampa → Settings → AniTube, set **Адреса приставки** to `<box-ip>:8787` and press **Перевірити приставку**. Both devices must be on the same home network. Do not assume the recorded IP is still current.

Routes: `/health`, `/check`, `/uf/search`, `/uf/page`, `/uf/episode`, `/uf/embed`, `/dorama/player`. The home box is separate from the public Cloudflare Worker; its own relay key remains configured locally. Do not paste keys into documentation.

The relay serves private-network clients, limits permitted destinations and does not retain fetched pages. Upstream failures are returned as HTTP 424 with a Ukrainian error and a short code. Cloud relays previously failed to retrieve UAflix episode players and DoramaUA player pages; the plugin uses the box for those paths.

Samsung access to an HTTP box address from HTTPS Lampa still requires TV verification. The source menu shows DoramaUA only on Android or when a valid box address is configured; this is not a connectivity test.

## Older generic proxy instructions

The remaining instructions describe `server.mjs` and alternative deployments, not the active TiVo relay. They are retained for reference. Do not start a local server, enable a background service or deploy a replacement implicitly. Historical statements below about cloud access do not establish current availability.

### Generic server proxy

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

## Existing Cloudflare Worker

Update the existing Worker `anitube-proxy` by replacing its code with [`cloudflare-worker.js`](cloudflare-worker.js) and deploying it. Keep the current `ACCESS_KEY`, `EMBED_URL`, and KV binding `SYNC` unchanged during this code update. The fixed routes are public; do not enter `ACCESS_KEY` in Lampa. The Worker uses `ACCESS_KEY` only when relaying Ashdi/UAflix requests to Koyeb, where it must match `ANITUBE_ACCESS_KEY`.

**Ashdi / UAflix relay.** If `EMBED_URL` points to the Koyeb service, the Worker relays only the fixed `/embed` and selected `/uf/*` routes there with its private `ACCESS_KEY`. Search and catalogue requests stay on Cloudflare. Do not expose the server secret in Lampa or in repository files.

## Local 1.8.3 candidate: Moon route (not deployed)

`cloudflare-worker.js` adds `GET /moon?url=<public iframe>&key=<key>`, accepting only HTTPS `moonanime.net` / `moonanime.art` (optionally `www`) with `/iframe/<id>` paths, no credentials, custom ports, query or fragment. Authentication is unchanged, redirects are refused, provider failures become HTTP 424. No video is proxied and no provider JavaScript is executed by the Worker.

This updated Worker has not been deployed. Native Android tries the Moon page directly; Smart TV tries a browser request, then this route. The real sample returned HTTP 400 / `500`, so current Moon playback is unverified. Do not replace this failure with a claim that a Worker update alone fixes it.
