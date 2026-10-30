// Cloudflare Worker version of the AniTube helper (same three routes as server.mjs and the bot's /anitube routes).
//
// Paste this whole file into a Worker (Cloudflare dashboard -> Workers & Pages -> Create -> Worker -> Edit code), deploy it, and add
// a secret named ACCESS_KEY (Settings -> Variables and Secrets -> Add -> Type: Secret). In Lampa: Settings -> AniTube ->
// "Адреса проксі" = the Worker address (https://<name>.<account>.workers.dev), "Ключ проксі" = the same secret.
//
//   GET /search?q=<text>&key=<key>     AniTube search page (HTML)
//   GET /playlist?url=<page>&key=<key> one AniTube show's playlist (JSON)
//   GET /embed?url=<page>&key=<key>    an Ashdi player page (https://ashdi.vip/vod/<id>)
//
// Ashdi refuses visitors from outside certain countries, and Cloudflare's servers may sit in one of them. To get the player page
// from somewhere Ashdi accepts, add a plain-text variable EMBED_URL = the address of the bot's proxy, e.g.
// https://<service>.koyeb.app/anitube : /embed is then relayed there with the same ACCESS_KEY. Search and playlist stay here.
//
// It fetches only those addresses, follows no redirects, stores nothing, and identifies itself honestly in User-Agent.
// If a site refuses the request, the answer is HTTP 424 with {"error": "HTTP 403"} (or similar) so the reason is visible.

const SITE = 'https://anitube.in.ua';
const USER_AGENT = 'AniTubeLampaProxy/1.0 (personal Lampa plugin helper)';
const MAX_BODY = 3_000_000;
const MIN_KEY_LENGTH = 16;
const UPSTREAM_STATUS = 424;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

function get(url) {
  return fetch(url, {
    redirect: 'manual',
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8', 'Referer': SITE + '/' }
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
  const page = validPage(raw, 'ashdi.vip', /^\/vod\/\d+$/);
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    const key = String((env && env.ACCESS_KEY) || '').trim();
    if (key.length < MIN_KEY_LENGTH) return json({ error: 'not_configured' }, 503);
    if (!sameSecret(url.searchParams.get('key') || '', key)) return json({ error: 'forbidden' }, 403);
    try {
      if (url.pathname === '/search') return await search((url.searchParams.get('q') || '').trim());
      if (url.pathname === '/playlist') return await playlist(url.searchParams.get('url') || '');
      if (url.pathname === '/embed') return await embed(url.searchParams.get('url') || '', env);
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      const message = error instanceof UpstreamError ? error.message : (error && error.name) || 'upstream_error';
      return json({ error: String(message).slice(0, 180) }, UPSTREAM_STATUS);
    }
  }
};
