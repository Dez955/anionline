// Cloudflare Worker version of the AniTube helper (same three routes as server.mjs and the bot's /anitube routes).
//
// Paste this whole file into a Worker (Cloudflare dashboard -> Workers & Pages -> Create -> Worker -> Edit code), deploy it, and add
// a secret named ACCESS_KEY (Settings -> Variables and Secrets -> Add -> Type: Secret). In Lampa: Settings -> AniTube ->
// "Адреса проксі" = the Worker address (https://<name>.<account>.workers.dev), "Ключ проксі" = the same secret.
//
//   GET /search?q=<text>&key=<key>     AniTube search page (HTML)
//   GET /playlist?url=<page>&key=<key> one AniTube show's playlist (JSON)
//   GET /moon?url=<page>&key=<key>     a public moonanime.net/art iframe page
//   GET /animeon?id=<episode>&key=<key>  the Ashdi page of one AnimeOn episode
//   GET /dorama/player?id=<id>&ep=<episode>&track=<voice>&key=<key>  DoramaUA's public player page; media stays direct
//   GET /embed?url=<page>&key=<key>    an Ashdi player page (https://ashdi.vip/vod/<id>) or show page (https://ashdi.vip/serial/<id>)
//   POST /sync?key=<key>               the plugin's shared follow list ({code, items}); needs a KV namespace bound as SYNC
//
// Second source, uafix.net (same rules: only these addresses, no redirects, nothing stored). uafix refuses Cloudflare's servers (HTTP 403),
// so when EMBED_URL is set, /uf/search, /uf/page and /uf/episode are relayed to the bot's /uf/* routes (same ACCESS_KEY) the way /embed is.
// /uf/embed (the zetvideo player page) is fetched here directly.
//   GET /uf/search?q=<text>&key=<key>   uafix search page (HTML)
//   GET /uf/page?url=<page>&key=<key>   a show page or an episode page of uafix (HTML)
//   GET /uf/episode?url=<page>&key=<key> {"player": "https://zetvideo.net/vod/<id>"} taken from an episode page (a small answer)
//   GET /uf/embed?url=<page>&key=<key>  a zetvideo player page (https://zetvideo.net/vod/<id>)
//   POST /uf/login?key=<key>            body {login, password}: signs in to the CALLER's own uafix.net account (through the bot) and answers
//                                       {ok, cookie}. uafix shows the player to a signed-in member from any country. Nothing is stored here;
//                                       the three /uf routes above then accept &cookie=<that cookie> and pass it to uafix.net only.
//
// UA Serials catalogue and HDVB player pages (the HLS media remains a direct stream from the source).
//   GET /uaserials/search?q=<text>&key=<key>   UA Serials search page (HTML)
//   GET /uaserials/page?url=<page>&key=<key>   one UA Serials title page (HTML)
//   GET /uaserials/player?url=<page>&key=<key> one public HDVB iframe page (HTML)
//
// Eneyida and Klon UA (DLE catalogues) and the public HDVB player page Eneyida embeds (no Referer, no made-up header).
//   GET /dle/<eneyida|klon>/search?q=<text>&key=<key>  the site's search page (HTML)
//   GET /dle/<eneyida|klon>/page?url=<page>&key=<key>  one title page of that site (HTML)
//   GET /dle/eneyida/player?url=<page>&key=<key>       https://hdvbua.pro/embd/<id> (a show) or /vid/<id> (a film) (HTML)
//
// Ashdi refuses visitors from outside certain countries, and Cloudflare's servers may sit in one of them. To get the player page
// from somewhere Ashdi accepts, add a plain-text variable EMBED_URL = the address of the bot's proxy, e.g.
// https://<service>.koyeb.app/anitube : /embed is then relayed there with the same ACCESS_KEY. Search and playlist stay here.
//
// It fetches only those addresses, follows no redirects, stores nothing, and identifies itself honestly in User-Agent.
// If a site refuses the request, the answer is HTTP 424 with {"error": "HTTP 403"} (or similar) so the reason is visible.

const SITE = 'https://anitube.in.ua';
const UASERIALS = 'https://uaserials.my';
const USER_AGENT = 'AniTubeLampaProxy/1.0 (personal Lampa plugin helper)';
const MAX_BODY = 3_000_000;
const MIN_KEY_LENGTH = 16;
const UPSTREAM_STATUS = 424;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache'
};

class UpstreamError extends Error {}

function reply(body, status, type) {
  return new Response(body, { status, headers: { ...HEADERS, 'Content-Type': type } });
}
const json = (data, status = 200) => reply(JSON.stringify(data), status, 'application/json; charset=utf-8');
const html = (text) => reply(text, 200, 'text/html; charset=utf-8');

function sameSecret(given, secret) {
  const a = new TextEncoder().encode(String(given));
  const b = new TextEncoder().encode(String(secret));
  if (a.length !== b.length) return false;
  if (crypto.subtle && crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function validPage(raw, host, pathPattern) {
  let page;
  try { page = new URL(raw); } catch { return null; }
  if (page.protocol !== 'https:' || page.hostname !== host || page.port || page.search || page.hash) return null;
  return pathPattern.test(page.pathname) ? page.href : null;
}

async function read(response) {
  if (response.status >= 300 && response.status < 400) throw new UpstreamError('перенаправлення (HTTP ' + response.status + ')');
  if (!response.ok) throw new UpstreamError('HTTP ' + response.status);
  const text = await response.text();
  if (text.length > MAX_BODY) throw new UpstreamError('завелика відповідь');
  return text;
}

function get(url, referer = SITE + '/') {
  return fetch(url, {
    redirect: 'manual',
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8', 'Referer': referer }
  });
}

function attribute(tag, name) {
  const match = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\'])(.*?)\\1', 'i'));
  return match ? match[2] : '';
}

async function search(query) {
  if (!query || query.length > 200) return json({ error: 'invalid_query' }, 400);
  const url = new URL('/index.php', SITE);
  url.searchParams.set('do', 'search');
  url.searchParams.set('subaction', 'search');
  url.searchParams.set('story', query);
  return html(await read(await get(url.href)));
}

async function playlist(raw) {
  const article = validPage(raw, 'anitube.in.ua', /^\/\d+-[^/]+\.html$/);
  if (!article) return json({ success: false, error: 'invalid_anitube_page' }, 400);
  const page = await read(await get(article));
  const container = page.match(/<[^<>]*\b(?:id|class)=["'][^"']*\bplaylists-ajax\b[^"']*["'][^<>]*>/i);
  const hash = page.match(/\bdle_login_hash\s*=\s*['"]([a-f\d]{16,128})['"]/i);
  if (!container || !hash) return json({ success: false, error: 'playlist_metadata_missing' }, UPSTREAM_STATUS);
  const newsId = attribute(container[0], 'data-news_id');
  const xfield = attribute(container[0], 'data-xfname');
  if (!/^\d{1,10}$/.test(newsId) || !/^[a-z\d_]{1,80}$/i.test(xfield)) return json({ success: false, error: 'playlist_metadata_invalid' }, UPSTREAM_STATUS);

  const response = await fetch(SITE + '/engine/ajax/playlists.php', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': SITE,
      'Referer': article,
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: new URLSearchParams({ news_id: newsId, xfield, user_hash: hash[1] }).toString()
  });
  let data;
  try { data = JSON.parse(await read(response)); } catch (e) {
    if (e instanceof UpstreamError) throw e;
    throw new UpstreamError('некоректний JSON плейлиста');
  }
  if (!data || data.success !== true || typeof data.response !== 'string') return json({ success: false, error: 'playlist_unavailable' }, UPSTREAM_STATUS);
  return json({ success: true, response: data.response });
}

const GEO_BLOCK = 'Змініть країну перегляду';

async function embed(raw, env) {
  const page = validPage(raw, 'ashdi.vip', /^\/(?:vod|serial)\/\d+$/);
  if (!page) return json({ error: 'invalid_player_page' }, 400);
  const relay = String((env && env.EMBED_URL) || '').trim().replace(/\/+$/, '');
  let text;
  if (/^https:\/\/\S+$/.test(relay)) {
    const target = relay + '/embed?url=' + encodeURIComponent(page) + '&key=' + encodeURIComponent(String(env.ACCESS_KEY).trim());
    const response = await fetch(target, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) {
      let reason = 'HTTP ' + response.status;
      try { reason = JSON.parse(await response.text()).error || reason; } catch { /* keep the status */ }
      throw new UpstreamError('ретрансляція плеєра: ' + reason);
    }
    text = await response.text();
  } else {
    text = await read(await get(page));
  }
  if (text.length > MAX_BODY) throw new UpstreamError('завелика відповідь');
  if (text.includes(GEO_BLOCK)) throw new UpstreamError('Ashdi не пускає країну цього сервера (див. EMBED_URL)');
  return html(text);
}

const UAFIX = 'https://uafix.net';
const UAFIX_PAGE = /^\/[a-z-]+\/[a-z0-9-]+\/(?:season-\d+-episode-\d+\/)?$/;

// Sends a uafix request to the bot (EMBED_URL) and returns its answer as is, or null when no relay is configured.
async function ufRelay(path, url, env) {
  const relay = String((env && env.EMBED_URL) || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/\S+$/.test(relay)) return null;
  const target = relay + '/uf/' + path + '?' + url.searchParams.toString().replace(/(^|&)key=[^&]*/g, '') + '&key=' + encodeURIComponent(String(env.ACCESS_KEY).trim());
  const response = await fetch(target, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT } });
  const body = await response.text();
  if (!response.ok) {
    let reason = 'HTTP ' + response.status;
    try { reason = JSON.parse(body).error || reason; } catch { /* keep the status */ }
    throw new UpstreamError('ретрансляція uafix: ' + reason);
  }
  if (body.length > MAX_BODY) throw new UpstreamError('завелика відповідь');
  return reply(body, 200, response.headers.get('Content-Type') || 'text/plain; charset=utf-8');
}

// Signs in to uafix.net with the caller's own login and password. uafix refuses Cloudflare's servers, so the bot (EMBED_URL) does it.
async function ufLogin(request, env) {
  const relay = String((env && env.EMBED_URL) || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/\S+$/.test(relay)) return json({ ok: false, error: 'EMBED_URL (адреса бота) не задана у Worker' }, UPSTREAM_STATUS);
  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { return json({ ok: false, error: 'invalid_json' }, 400); }
  const login = String((body && body.login) || '').trim();
  const password = String((body && body.password) || '');
  if (!login || !password || login.length > 100 || password.length > 200) return json({ ok: false, error: 'вкажіть логін і пароль' }, 400);
  const target = relay + '/uf/login?key=' + encodeURIComponent(String(env.ACCESS_KEY).trim());
  const response = await fetch(target, { method: 'POST', redirect: 'manual', headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const text = await response.text();
  let answer;
  try { answer = JSON.parse(text); } catch (e) { return json({ ok: false, error: 'бот відповів HTTP ' + response.status }, UPSTREAM_STATUS); }
  return json({ ok: !!answer.ok, cookie: answer.ok ? String(answer.cookie || '') : undefined, error: answer.ok ? undefined : String(answer.error || 'помилка входу').slice(0, 180) }, response.ok ? 200 : response.status === 404 ? 404 : response.status);
}

async function ufSearch(query) {
  if (!query || query.length > 200) return json({ error: 'invalid_query' }, 400);
  const url = new URL('/index.php', UAFIX);
  url.searchParams.set('do', 'search');
  url.searchParams.set('subaction', 'search');
  url.searchParams.set('story', query);
  return html(await read(await get(url.href, UAFIX + '/')));
}

async function ufPage(raw) {
  const page = validPage(raw, 'uafix.net', UAFIX_PAGE);
  if (!page) return null;
  return read(await get(page, UAFIX + '/'));
}

function ufPlayer(text) {
  const match = text.match(/<iframe\b[^>]*\bsrc=["'](https:\/\/(?:zetvideo\.net|ashdi\.vip)\/vod\/\d+)["']/i);
  return match ? match[1] : '';
}

async function ufEmbed(raw) {
  const page = validPage(raw, 'zetvideo.net', /^\/vod\/\d+$/);
  if (!page) return json({ error: 'invalid_player_page' }, 400);
  const text = await read(await get(page, UAFIX + '/'));
  if (/[Зз]мініть країну|not available in your country/i.test(text)) throw new UpstreamError('плеєр не пускає країну цього сервера');
  return html(text);
}

const UASERIALS_PAGE = /^\/[0-9]{1,8}-[a-z0-9-]+\.html$/i;
const UASERIALS_PLAYER = /^\/embed\/[0-9]{1,10}\/[a-f0-9]{6,64}$/i;

async function uaserialsSearch(query) {
  if (!query || query.length > 200) return json({ error: 'invalid_query' }, 400);
  const url = new URL('/index.php', UASERIALS);
  url.searchParams.set('do', 'search');
  url.searchParams.set('subaction', 'search');
  url.searchParams.set('story', query);
  return html(await read(await get(url.href, UASERIALS + '/')));
}

async function uaserialsPage(raw) {
  const page = validPage(raw, 'uaserials.my', UASERIALS_PAGE);
  if (!page) return null;
  return read(await get(page, UASERIALS + '/'));
}

async function uaserialsPlayer(raw) {
  const page = validPage(raw, 'hdvbua.pro', UASERIALS_PLAYER);
  if (!page) return null;
  return read(await fetch(page, { redirect: 'manual', headers: {
    'User-Agent': USER_AGENT, 'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8', 'Referer': UASERIALS + '/'
  } }));
}

// Eneyida and Klon UA (DLE catalogues) and the HDVB player page Eneyida embeds. No Referer and no made-up header is sent.
const DLE_SITES = {
  eneyida: { host: 'eneyida.tv', page: /^\/[0-9]{1,8}-[a-z0-9-]+\.html$/i },
  klon: { host: 'klonua.com', page: /^\/[a-z0-9-]+\/[0-9]{1,8}-[a-z0-9-]+\.html$/i }
};
const HDVB_EMBED = /^\/(?:embd|vid)\/[0-9]{1,10}$/;

function plainGet(url) {
  return fetch(url, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8' } });
}

async function dleRoute(site, action, params) {
  const rule = DLE_SITES[site];
  if (!rule) return null;
  if (action === 'search') {
    const query = (params.get('q') || '').trim();
    if (!query || query.length > 200) return json({ error: 'invalid_query' }, 400);
    const url = new URL('/index.php', 'https://' + rule.host);
    url.searchParams.set('do', 'search');
    url.searchParams.set('subaction', 'search');
    url.searchParams.set('story', query);
    return html(await read(await plainGet(url.href)));
  }
  if (action === 'page') {
    const page = validPage(params.get('url') || '', rule.host, rule.page);
    return page ? html(await read(await plainGet(page))) : json({ error: 'invalid_page' }, 400);
  }
  if (action === 'player') {
    const page = validPage(params.get('url') || '', 'hdvbua.pro', HDVB_EMBED);
    return page ? html(await read(await plainGet(page))) : json({ error: 'invalid_player' }, 400);
  }
  return null;
}

// Public Moon iframe pages only; no arbitrary proxy destinations or redirects.
async function moonPage(raw) {
  let page;
  try { page = new URL(raw); } catch { return json({ error: 'invalid_moon_page' }, 400); }
  if (page.protocol !== 'https:' || !/^(?:www\.)?moonanime\.(net|art)$/.test(page.hostname) || page.port || page.search || page.hash || page.username || page.password || !/^\/(?:iframe|vod)\/[a-zA-Z0-9_-]{5,100}\/?$/.test(page.pathname)) return json({ error: 'invalid_moon_page' }, 400);
  const response = await fetch(page.href, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: {
    'User-Agent': USER_AGENT, 'Accept': '*/*', 'Accept-Language': 'uk', 'Referer': SITE + '/'
  } });
  const text = await read(response);
  if (/<title>\s*Just a moment|Enable JavaScript and cookies to continue/i.test(text)) throw new UpstreamError('Moon вимагає перевірку браузера');
  return html(text);
}

// Fixed public API routes; callers cannot choose an upstream host or arbitrary path.
async function animeonCatalogApi(action, params) {
  let path;
  const id = params.get('id') || '';
  if (action === 'search') {
    const q = (params.get('q') || '').trim();
    if (!q || q.length > 200) return json({error: 'invalid_query'}, 400);
    path = '/anime?search=' + encodeURIComponent(q);
  } else {
    if (!/^\d{1,10}$/.test(id)) return json({error: 'invalid_id'}, 400);
    if (action === 'translations') path = '/player/' + id + '/translations';
    else if (action === 'episodes') {
      const player = params.get('player') || '', translation = params.get('translation') || '', skip = params.get('skip') || '0';
      if (!/^\d{1,10}$/.test(player) || !/^\d{1,10}$/.test(translation) || !/^\d{1,5}$/.test(skip) || Number(skip) > 20000) return json({error: 'invalid_episode_query'}, 400);
      path = '/player/' + id + '/episodes?take=100&skip=' + skip + '&playerId=' + player + '&translationId=' + translation;
    } else return json({error: 'not_found'}, 404);
  }
  const response = await fetch('https://animeon.club/api' + path, {redirect: 'manual', signal: AbortSignal.timeout(8000), headers: {'User-Agent': USER_AGENT, Accept: 'application/json'}});
  const text = await read(response);
  let data;
  try { data = JSON.parse(text); } catch { throw new UpstreamError('AnimeOn не повернув JSON'); }
  return json(data);
}

// AnimeOn's public answer for one episode: only the Ashdi page address goes back.
async function animeonEpisode(id) {
  if (!/^\d{1,10}$/.test(id)) return json({ error: 'invalid_animeon_id' }, 400);
  const response = await fetch('https://animeon.club/api/player/' + id + '/episode', { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: {
    'User-Agent': USER_AGENT, 'Accept': 'application/json'
  } });
  const text = await read(response);
  let page;
  try { page = new URL(JSON.parse(text).videoUrl); } catch { throw new UpstreamError('AnimeOn не дав адресу плеєра'); }
  if (page.protocol !== 'https:' || page.hostname !== 'ashdi.vip' || !/^\/vod\/\d+$/.test(page.pathname)) throw new UpstreamError('AnimeOn не дав адресу плеєра');
  return json({ videoUrl: page.origin + page.pathname });
}

// ---- Shared follow list of the plugin (POST /sync): the owner's TVs type the same code and get one list. -------------------
// Needs a KV namespace bound to this Worker as SYNC (Settings -> Bindings -> KV namespace). The code itself is not stored: the record key is its
// SHA-256. Each title is {t, r} or a removal {t, del}; the newer t wins, so the order in which TVs sync does not matter. Removals older than
// 120 days are dropped. Only plain values are kept, sizes are capped.
const SYNC_MAX_BODY = 400_000;
const SYNC_MAX_ITEMS = 500;
const SYNC_GONE_KEEP = 120 * 24 * 3600 * 1000;
async function syncRecordKey(code) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('anitube-follow:' + code));
  return 'follow:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function syncPlain(value, depth) {
  if (typeof value === 'string') return value.slice(0, 600);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value;
  if (depth > 0 && value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {};
    for (const name of Object.keys(value).slice(0, 80)) {
      if (!/^[a-zA-Z0-9_]{1,40}$/.test(name)) continue;
      const v = syncPlain(value[name], depth - 1);
      if (v !== undefined) out[name] = v;
    }
    return out;
  }
  return undefined;
}
function syncEntry(id, entry) {
  if (!/^\d{1,12}$/.test(id) || !entry || typeof entry !== 'object') return null;
  const t = Number(entry.t);
  if (!Number.isFinite(t) || t <= 0 || t > Date.now() + 24 * 3600 * 1000) return null;
  if (entry.del) return { t, del: true };
  const r = entry.r && typeof entry.r === 'object' ? entry.r : null;
  if (!r) return null;
  const url = typeof r.url === 'string' && /^https:\/\/anitube\.in\.ua\/[^\s]{1,300}$/.test(r.url) ? r.url : '';
  const clean = {
    id, url,
    title: String(r.title || '').slice(0, 300),
    mode: ['any', 'subs', 'dub'].includes(r.mode) ? r.mode : 'any',
    card: syncPlain(r.card, 1) || {},
    added: Number(r.added) || 0,
    total: Number(r.total) || 0
  };
  return JSON.stringify(clean).length > 20000 ? null : { t, r: clean };
}
async function followSync(request, env) {
  if (!env || !env.SYNC || typeof env.SYNC.get !== 'function' || typeof env.SYNC.put !== 'function') return json({ error: 'sync_not_configured' }, 503);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const text = await request.text();
  if (text.length > SYNC_MAX_BODY) return json({ error: 'too_large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: 'invalid_json' }, 400); }
  const code = String((body && body.code) || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{6,40}$/.test(code)) return json({ error: 'invalid_code' }, 400);
  const incoming = body && body.items && typeof body.items === 'object' ? body.items : {};
  const recordKey = await syncRecordKey(code);
  let stored = {};
  try { stored = JSON.parse((await env.SYNC.get(recordKey)) || '{}') || {}; } catch (e) { stored = {}; }
  const merged = {};
  const now = Date.now();
  let changed = false;
  for (const id of Object.keys(stored)) {
    const entry = stored[id];
    if (entry && entry.del && now - entry.t > SYNC_GONE_KEEP) { changed = true; continue; }
    merged[id] = entry;
  }
  for (const id of Object.keys(incoming).slice(0, SYNC_MAX_ITEMS * 2)) {
    const entry = syncEntry(id, incoming[id]);
    if (!entry) continue;
    if (!merged[id] || entry.t > merged[id].t) { merged[id] = entry; changed = true; }
  }
  if (Object.keys(merged).length > SYNC_MAX_ITEMS) return json({ error: 'too_many' }, 413);
  if (changed) await env.SYNC.put(recordKey, JSON.stringify(merged));
  return json({ items: merged });
}

// A fixed destination, no cookies, Referer, browser impersonation, redirects or media relay.
async function doramaPlayer(params) {
  const id = params.get('id') || '', ep = params.get('ep') || '1', track = params.get('track') || '';
  const season = params.get('season') || '', seasonParam = params.get('seasonParam') || '';
  if (!/^[1-9]\d{0,7}$/.test(id) || !/^[1-9]\d{0,3}$/.test(ep) || (track && !/^[1-9]\d{0,5}$/.test(track)) ||
      (season && !/^[1-9]\d{0,3}$/.test(season)) || (seasonParam && (!/^(season|s)$/.test(seasonParam) || !season))) {
    return json({ error: 'invalid_dorama_player' }, 400);
  }
  const url = new URL('/' + id, 'https://w.davidog.top');
  url.searchParams.set('ep', ep);
  if (track) url.searchParams.set('track', track);
  if (seasonParam) url.searchParams.set(seasonParam, season);
  const text = await read(await fetch(url.href, {redirect: 'manual', headers: {
    'User-Agent': USER_AGENT, 'Accept': 'text/html', 'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8'
  }}));
  if (!/data-config\s*=/.test(text) && /не[\s\S]{0,15}доступно в вашем регионе|Змініть країну перегляду/i.test(text)) {
    throw new UpstreamError('DoramaUA не пускає країну цього сервера');
  }
  if (!/\bid=["']inputData["']/.test(text) || !/data-config\s*=/.test(text)) throw new UpstreamError('DoramaUA не повернув сторінку плеєра');
  return html(text);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    const url = new URL(request.url);
    if (request.method !== 'GET' && !(request.method === 'POST' && (url.pathname === '/sync' || url.pathname === '/uf/login'))) return json({ error: 'method_not_allowed' }, 405);
    if (url.pathname === '/health') return json({ ok: true });
    const key = String((env && env.ACCESS_KEY) || '').trim();
    if (key.length < MIN_KEY_LENGTH) return json({ error: 'not_configured' }, 503);
    if (!sameSecret(url.searchParams.get('key') || '', key)) return json({ error: 'forbidden' }, 403);
    try {
      if (url.pathname === '/sync') return await followSync(request, env);
      if (url.pathname === '/search') return await search((url.searchParams.get('q') || '').trim());
      if (url.pathname === '/playlist') return await playlist(url.searchParams.get('url') || '');
      if (url.pathname === '/moon') return await moonPage(url.searchParams.get('url') || '');
      if (url.pathname === '/animeon') return await animeonEpisode(url.searchParams.get('id') || '');
      if (url.pathname === '/dorama/player') return await doramaPlayer(url.searchParams);
      if (['/animeon/search', '/animeon/translations', '/animeon/episodes'].includes(url.pathname)) return await animeonCatalogApi(url.pathname.split('/')[2], url.searchParams);
      if (url.pathname === '/embed') return await embed(url.searchParams.get('url') || '', env);
      if (url.pathname === '/uf/login') return await ufLogin(request, env);
      if (['/uf/search', '/uf/page', '/uf/episode'].includes(url.pathname)) {
        const relayed = await ufRelay(url.pathname.slice(4), url, env);
        if (relayed) return relayed;
      }
      if (url.pathname === '/uf/search') return await ufSearch((url.searchParams.get('q') || '').trim());
      if (url.pathname === '/uf/page') {
        const text = await ufPage(url.searchParams.get('url') || '');
        return text === null ? json({ error: 'invalid_uafix_page' }, 400) : html(text);
      }
      if (url.pathname === '/uf/episode') {
        const text = await ufPage(url.searchParams.get('url') || '');
        if (text === null) return json({ error: 'invalid_uafix_page' }, 400);
        const player = ufPlayer(text);
        return player ? json({ player }) : json({ error: 'player_missing' }, UPSTREAM_STATUS);
      }
      if (url.pathname === '/uf/embed') return await ufEmbed(url.searchParams.get('url') || '');
      if (url.pathname === '/uaserials/search') return await uaserialsSearch((url.searchParams.get('q') || '').trim());
      if (url.pathname === '/uaserials/page') {
        const text = await uaserialsPage(url.searchParams.get('url') || '');
        return text === null ? json({ error: 'invalid_uaserials_page' }, 400) : html(text);
      }
      if (url.pathname === '/uaserials/player') {
        const text = await uaserialsPlayer(url.searchParams.get('url') || '');
        return text === null ? json({ error: 'invalid_uaserials_player' }, 400) : html(text);
      }
      const dle = url.pathname.match(/^\/dle\/([a-z]+)\/(search|page|player)$/);
      if (dle) {
        const answer = await dleRoute(dle[1], dle[2], url.searchParams);
        if (answer) return answer;
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      const message = error instanceof UpstreamError ? error.message : (error && error.name) || 'upstream_error';
      return json({ error: String(message).slice(0, 180) }, UPSTREAM_STATUS);
    }
  }
};
