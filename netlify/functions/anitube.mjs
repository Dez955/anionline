const SITE = 'https://anitube.in.ua';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const RESPONSE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp('(?:^|\\s)' + escaped + '\\s*=\\s*([\\x22\\x27])(.*?)\\1', 'i'));
  return match ? match[2] : '';
}

async function getPage(url) {
  return fetch(url, {
    method: 'GET',
    cache: 'no-store',
    redirect: 'manual',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
      'User-Agent': USER_AGENT,
      'Referer': SITE + '/'
    }
  });
}

async function readBody(response) {
  if (!response.ok) throw new Error('AniTube повернув HTTP ' + response.status);
  const type = response.headers.get('content-type') || '';
  if (!/text\/html|application\/json/i.test(type)) throw new Error('AniTube повернув не HTML/JSON');
  const body = await response.text();
  if (body.length > 3_000_000) throw new Error('Завелика відповідь AniTube');
  return body;
}

async function search(query) {
  const url = new URL('/index.php', SITE);
  url.searchParams.set('do', 'search');
  url.searchParams.set('subaction', 'search');
  url.searchParams.set('story', query);
  const response = await getPage(url);
  if (response.status >= 300 && response.status < 400) throw new Error('AniTube перенаправив запит пошуку');
  const html = await readBody(response);
  return new Response(html, {
    headers: { ...RESPONSE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function playlist(rawUrl) {
  let article;
  try {
    article = new URL(rawUrl);
  } catch (_) {
    return json({ success: false, error: 'invalid_url' }, 400);
  }

  if (article.protocol !== 'https:' || article.hostname !== 'anitube.in.ua' || article.port || !/^\/\d+-[^/]+\.html$/.test(article.pathname)) {
    return json({ success: false, error: 'invalid_anitube_page' }, 400);
  }

  const pageResponse = await getPage(article.href);
  if (pageResponse.status >= 300 && pageResponse.status < 400) throw new Error('AniTube перенаправив сторінку аніме');
  const html = await readBody(pageResponse);
  const container = html.match(/<[^<>]*\b(?:id|class)=["'][^"']*\bplaylists-ajax\b[^"']*["'][^<>]*>/i);
  const hash = html.match(/\bdle_login_hash\s*=\s*['"]([a-f\d]{16,128})['"]/i);
  if (!container || !hash) return json({ success: false, error: 'playlist_metadata_missing' }, 502);

  const newsId = attribute(container[0], 'data-news_id');
  const xfield = attribute(container[0], 'data-xfname');
  if (!/^\d{1,10}$/.test(newsId) || !/^[a-z\d_]{1,80}$/i.test(xfield)) {
    return json({ success: false, error: 'playlist_metadata_invalid' }, 502);
  }

  const form = new URLSearchParams({ news_id: newsId, xfield, user_hash: hash[1] });
  const response = await fetch(SITE + '/engine/ajax/playlists.php', {
    method: 'POST',
    cache: 'no-store',
    redirect: 'manual',
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': SITE,
      'Referer': article.href,
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: form.toString()
  });
  const body = await readBody(response);
  let data;
  try {
    data = JSON.parse(body);
  } catch (_) {
    throw new Error('AniTube повернув некоректний JSON плейлиста');
  }
  if (!data || data.success !== true || typeof data.response !== 'string') {
    return json({ success: false, error: 'playlist_unavailable' }, 502);
  }

  return json({ success: true, response: data.response });
}

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  try {
    if (action === 'search') {
      const query = (url.searchParams.get('q') || '').trim();
      if (!query || query.length > 200) return json({ error: 'invalid_query' }, 400);
      return await search(query);
    }
    if (action === 'playlist') {
      const target = url.searchParams.get('url') || '';
      if (target.length > 1000) return json({ success: false, error: 'invalid_url' }, 400);
      return await playlist(target);
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (error) {
    return json({ error: String(error && error.message || 'upstream_error').slice(0, 180) }, 502);
  }
};
