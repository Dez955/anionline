// Relay for an Android TV box in your own home network (Termux + Node.js 18 or newer). The sites below show their players only
// to ordinary visitors from Ukraine, and a Smart TV cannot read them itself (no CORS), so the TV asks this box and the box
// asks the site from your home connection - the same request your own browser would make.
//
//   node box-relay.mjs                  # listens on 0.0.0.0:8787
//   PORT=9000 ACCESS_KEY=... node box-relay.mjs
//
// Routes (all GET; the plugin adds ?key=<ACCESS_KEY> when a key is set):
//   /health                      {ok, name, version}       answers without a key
//   /check?key=                  what the box can reach right now (uafix, DoramaUA API, DoramaUA player) and why not
//   /uf/search?q=                uafix search page (HTML)
//   /uf/page?url=                uafix show or episode page (HTML)
//   /uf/episode?url=             {"player": first, "players": [all]} (zetvideo.net/vod/<id> addresses) taken from an uafix episode page
//   /uf/embed?url=               zetvideo player page (https://zetvideo.net/vod/<id>)
//   /dorama/player?id=&ep=&track=  DoramaUA player page (https://w.davidog.top/<id>?ep=&track=)
//
// It fetches only these addresses, follows no redirects, keeps nothing, and serves only clients from a private network.
// A site that refuses the request is reported as HTTP 424 with {"error": "<reason in Ukrainian>", "code": "<short code>"}.
import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.1.0';
const USER_AGENT = 'AniTubeLampaBox/1.0 (personal Lampa plugin helper)';
const MAX_BODY = 3_000_000;
const UPSTREAM_STATUS = 424;
const UAFIX = 'https://uafix.net';
const UAFIX_PAGE = /^\/[a-z-]+\/[a-z0-9-]+\/(?:season-\d+-episode-\d+\/)?$/;
const DORAMA_PLAYER = 'https://w.davidog.top';
const DORAMA_API = 'https://api.doramaua.tv';
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache'
};
const REGION_BLOCK = /[Зз]мініть країну|не доступно в вашем регионе|not available in your (?:country|region)/i;

class Upstream extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function reply(res, status, body, type) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type });
  res.end(body);
}
const json = (res, data, status = 200) => reply(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
const html = (res, text) => reply(res, 200, text, 'text/html; charset=utf-8');

export function isPrivateAddress(address) {
  const ip = String(address || '').replace(/^::ffff:/, '');
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  return ip === '::1' || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip);
}

function sameSecret(given, secret) {
  const a = Buffer.from(String(given)), b = Buffer.from(String(secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

function validPage(raw, host, pathPattern) {
  let page;
  try { page = new URL(raw); } catch { return null; }
  if (page.protocol !== 'https:' || page.hostname !== host || page.port || page.search || page.hash) return null;
  return pathPattern.test(page.pathname) ? page.href : null;
}

function get(url, extra = {}) {
  return fetch(url, {
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8', ...extra }
  });
}

// Turns what the site answered into a short Ukrainian reason; a region notice is recognised even in a 200 answer.
async function read(response) {
  if (response.status >= 300 && response.status < 400) throw new Upstream('сайт перенаправив запит (HTTP ' + response.status + ')', 'redirect');
  const text = await response.text();
  if (REGION_BLOCK.test(text)) throw new Upstream('сайт не пускає адресу цієї приставки (повідомлення про регіон). Перевірте, що приставка в мережі в Україні', 'region');
  if (response.status === 403) throw new Upstream('сайт відмовив у доступі (HTTP 403)', 'forbidden');
  if (response.status === 404) throw new Upstream('сторінку не знайдено (HTTP 404)', 'not_found');
  if (!response.ok) throw new Upstream('сайт відповів помилкою HTTP ' + response.status, 'http_' + response.status);
  if (text.length > MAX_BODY) throw new Upstream('завелика відповідь', 'too_large');
  return text;
}

// Every player of an episode page in the order the site lists them ("Плеєр 1" = voice-over, "Плеєр 2 (Субтитри)").
function ufPlayers(text) {
  const found = [];
  const pattern = /<iframe\b[^>]*\bsrc=["'](https:\/\/(?:zetvideo\.net|ashdi\.vip)\/vod\/\d+)["']/gi;
  let match;
  while ((match = pattern.exec(text))) if (!found.includes(match[1])) found.push(match[1]);
  return found;
}

async function ufSearch(res, query) {
  if (!query || query.length > 200) return json(res, { error: 'порожній або задовгий запит', code: 'invalid_query' }, 400);
  const url = new URL('/index.php', UAFIX);
  url.searchParams.set('do', 'search');
  url.searchParams.set('subaction', 'search');
  url.searchParams.set('story', query);
  html(res, await read(await get(url)));
}

async function ufPage(raw) {
  const page = validPage(raw, 'uafix.net', UAFIX_PAGE);
  return page ? read(await get(page)) : null;
}

async function ufEmbed(res, raw) {
  const page = validPage(raw, 'zetvideo.net', /^\/vod\/\d+$/);
  if (!page) return json(res, { error: 'адреса плеєра не підходить', code: 'invalid_player_page' }, 400);
  html(res, await read(await get(page, { Referer: UAFIX + '/' })));
}

// The address is built from three numbers, so no other path or host can be requested through it.
async function doramaPlayer(res, params) {
  const id = params.get('id') || '', ep = params.get('ep') || '', track = params.get('track') || '';
  if (!/^\d{1,8}$/.test(id) || (ep && !/^\d{1,4}$/.test(ep)) || (track && !/^\d{1,6}$/.test(track))) {
    return json(res, { error: 'адреса плеєра не підходить', code: 'invalid_player_page' }, 400);
  }
  const url = new URL('/' + id, DORAMA_PLAYER);
  if (ep) url.searchParams.set('ep', ep);
  if (track) url.searchParams.set('track', track);
  html(res, await read(await get(url)));
}

async function probe(name, url, test) {
  const started = Date.now();
  try {
    const response = await get(url);
    const text = await response.text();
    if (REGION_BLOCK.test(text)) return { name, ok: false, code: 'region', error: 'сайт не пускає адресу приставки (регіон)', ms: Date.now() - started };
    if (!response.ok) return { name, ok: false, code: 'http_' + response.status, error: 'HTTP ' + response.status, ms: Date.now() - started };
    if (test && !test(text)) return { name, ok: false, code: 'unexpected', error: 'сторінка відповіла, але без плеєра', ms: Date.now() - started };
    return { name, ok: true, ms: Date.now() - started };
  } catch (e) {
    return { name, ok: false, code: 'network', error: 'немає з\'єднання з сайтом (' + String((e && e.cause && e.cause.code) || (e && e.name) || 'помилка') + ')', ms: Date.now() - started };
  }
}

async function check(res) {
  const results = await Promise.all([
    probe('uafix.net', UAFIX + '/', (t) => t.length > 1000),
    probe('DoramaUA (каталог)', DORAMA_API + '/api/v2/serials/doktor-iks', (t) => t.indexOf('"voices"') !== -1),
    probe('DoramaUA (плеєр)', DORAMA_PLAYER + '/3666?ep=1&track=310', (t) => t.indexOf('data-config') !== -1)
  ]);
  json(res, { ok: results.every((r) => r.ok), version: VERSION, results });
}

export function createRelay({ accessKey = '' } = {}) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return reply(res, 204, '', 'text/plain');
      if (req.method !== 'GET') return json(res, { error: 'метод не підтримується', code: 'method_not_allowed' }, 405);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return json(res, { ok: true, name: 'anitube-box', version: VERSION });
      if (!isPrivateAddress(req.socket.remoteAddress)) return json(res, { error: 'лише для домашньої мережі', code: 'forbidden' }, 403);
      if (accessKey && !sameSecret(url.searchParams.get('key') || '', accessKey)) return json(res, { error: 'ключ не збігається', code: 'forbidden' }, 403);
      const p = url.pathname;
      if (p === '/check') return await check(res);
      if (p === '/uf/search') return await ufSearch(res, (url.searchParams.get('q') || '').trim());
      if (p === '/uf/page' || p === '/uf/episode') {
        const text = await ufPage(url.searchParams.get('url') || '');
        if (text === null) return json(res, { error: 'адреса сторінки uafix не підходить', code: 'invalid_uafix_page' }, 400);
        if (p === '/uf/page') return html(res, text);
        const players = ufPlayers(text);
        return players.length ? json(res, { player: players[0], players }) : json(res, { error: 'на сторінці серії немає плеєра', code: 'player_missing' }, UPSTREAM_STATUS);
      }
      if (p === '/uf/embed') return await ufEmbed(res, url.searchParams.get('url') || '');
      if (p === '/dorama/player') return await doramaPlayer(res, url.searchParams);
      json(res, { error: 'невідомий маршрут', code: 'not_found' }, 404);
    } catch (error) {
      if (error instanceof Upstream) return json(res, { error: error.message, code: error.code }, UPSTREAM_STATUS);
      const cause = String((error && error.cause && error.cause.code) || (error && error.name) || '');
      const message = cause === 'TimeoutError' ? 'сайт не відповів вчасно' : 'немає з\'єднання з сайтом' + (cause ? ' (' + cause + ')' : '');
      json(res, { error: message, code: 'network' }, UPSTREAM_STATUS);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '0.0.0.0';
  const accessKey = process.env.ACCESS_KEY || '';
  createRelay({ accessKey }).listen(port, host, () => {
    console.log('AniTube box ' + VERSION + ': http://' + host + ':' + port + (accessKey ? '  (потрібен ключ)' : '') + '  зупинити: Ctrl-C');
  });
}
