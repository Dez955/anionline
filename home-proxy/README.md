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
