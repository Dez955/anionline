// Home-network helper for the AniTube Lampa plugin on TVs that cannot make cross-origin requests themselves
// (Samsung Tizen, LG webOS). It runs on a device in your own network, so AniTube sees ordinary home traffic.
//
//   node server.mjs                 # listens on 0.0.0.0:8787
//   PORT=9000 node server.mjs       # another port
//
// It only fetches three kinds of pages and keeps nothing: AniTube search results, an AniTube show's playlist, and an
// Ashdi player page. Only clients on a private network (or localhost) are served. Needs Node.js 18 or newer.
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const SITE = 'https://anitube.in.ua';
const MAX_BODY = 3_000_000;
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache'
};

function reply(res, status, body, type) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type });
  res.end(body);
}
const json = (res, data, status = 200) => reply(res, status, JSON.stringify(data), 'application/json; charset=utf-8');

export function isPrivateAddress(address) {
  const ip = String(address || '').replace(/^::ffff:/, '');
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  return ip === '::1' || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip);
}

async function get(url, extra = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    headers: { 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8', 'Referer': SITE + '/', ...extra }
  });
  return response;
}

async function body(response) {
  if (response.status >= 300 && response.status < 400) throw new Error('перенаправлення (HTTP ' + response.status + ')');
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const text = await response.text();
  if (text.length > MAX_BODY) throw new Error('завелика відповідь');
  return text;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\'])(.*?)\\1', 'i'));
  return match ? match[2] : '';
}

async function search(res, query) {
  if (!query || query.length > 200) return json(res, { error: 'invalid_query' }, 400);
  const url = new URL('/index.php', SITE);
  url.searchParams.set('do', 'search');
  url.searchParams.set('subaction', 'search');
  url.searchParams.set('story', query);
  reply(res, 200, await body(await get(url)), 'text/html; charset=utf-8');
}

async function playlist(res, raw) {
  let article;
  try { article = new URL(raw); } catch { return json(res, { success: false, error: 'invalid_url' }, 400); }
  if (article.protocol !== 'https:' || article.hostname !== 'anitube.in.ua' || article.port || !/^\/\d+-[^/]+\.html$/.test(article.pathname)) {
    return json(res, { success: false, error: 'invalid_anitube_page' }, 400);
  }
  const html = await body(await get(article.href));
  const container = html.match(/<[^<>]*\b(?:id|class)=["'][^"']*\bplaylists-ajax\b[^"']*["'][^<>]*>/i);
  const hash = html.match(/\bdle_login_hash\s*=\s*['"]([a-f\d]{16,128})['"]/i);
  if (!container || !hash) return json(res, { success: false, error: 'playlist_metadata_missing' }, 502);
  const newsId = attribute(container[0], 'data-news_id');
  const xfield = attribute(container[0], 'data-xfname');
  if (!/^\d{1,10}$/.test(newsId) || !/^[a-z\d_]{1,80}$/i.test(xfield)) return json(res, { success: false, error: 'playlist_metadata_invalid' }, 502);

  const form = new URLSearchParams({ news_id: newsId, xfield, user_hash: hash[1] });
  const response = await fetch(SITE + '/engine/ajax/playlists.php', {
    method: 'POST',
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': SITE,
      'Referer': article.href,
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: form.toString()
  });
  let data;
  try { data = JSON.parse(await body(response)); } catch (e) { throw new Error('некоректний JSON плейлиста'); }
  if (!data || data.success !== true || typeof data.response !== 'string') return json(res, { success: false, error: 'playlist_unavailable' }, 502);
  json(res, { success: true, response: data.response });
}

async function embed(res, raw) {
  let page;
  try { page = new URL(raw); } catch { return json(res, { error: 'invalid_url' }, 400); }
  if (page.protocol !== 'https:' || page.hostname !== 'ashdi.vip' || page.port || !/^\/vod\/\d+$/.test(page.pathname)) {
    return json(res, { error: 'invalid_player_page' }, 400);
  }
  reply(res, 200, await body(await get(page.href)), 'text/html; charset=utf-8');
}

export function createProxy({ allowAnyClient = false } = {}) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return reply(res, 204, '', 'text/plain');
      if (!allowAnyClient && !isPrivateAddress(req.socket.remoteAddress)) return json(res, { error: 'forbidden' }, 403);
      if (req.method !== 'GET') return json(res, { error: 'method_not_allowed' }, 405);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return json(res, { ok: true });
      if (url.pathname === '/search') return await search(res, (url.searchParams.get('q') || '').trim());
      if (url.pathname === '/playlist') return await playlist(res, url.searchParams.get('url') || '');
      if (url.pathname === '/embed') return await embed(res, url.searchParams.get('url') || '');
      json(res, { error: 'not_found' }, 404);
    } catch (error) {
      json(res, { error: String((error && error.message) || 'upstream_error').slice(0, 180) }, 502);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '0.0.0.0';
  createProxy().listen(port, host, () => {
    console.log('AniTube home proxy: http://' + host + ':' + port + '  (клієнти лише з локальної мережі; зупинити: Ctrl-C)');
  });
}
