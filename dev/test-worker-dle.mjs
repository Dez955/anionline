import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../home-proxy/cloudflare-worker.js', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
const key = 'offline-test-key-only', env = {ACCESS_KEY: key};
const call = (path, params, supplied = key) => worker.fetch(new Request('https://worker.test' + path + '?' + new URLSearchParams({...params, key: supplied})), env);
const seen = [];
globalThis.fetch = async (url, options) => { seen.push({url: String(url), options}); assert.equal(options.redirect, 'manual'); return new Response('<html>public page</html>'); };
let r = await call('/dle/eneyida/search', {q: 'Фрірен'});
assert.equal(r.status, 200);
assert.match(seen[0].url, /^https:\/\/eneyida\.tv\/index\.php\?do=search&subaction=search&story=/);
assert.equal(Object.keys(seen[0].options.headers).some(h => /^(referer|cookie|origin)$/i.test(h)), false, 'no Referer and no cookie is sent');
assert.match(seen[0].options.headers['User-Agent'], /^AniTubeLampaProxy/, 'honest User-Agent');
r = await call('/dle/klon/page', {url: 'https://klonua.com/anime/9941-friren-pislia-kincia-prygody.html'});
assert.equal(r.status, 200);
r = await call('/dle/eneyida/player', {url: 'https://hdvbua.pro/embd/2252'});
assert.equal(r.status, 200);
r = await call('/dle/bamboo/search', {q: 'весна'});
assert.equal(r.status, 200);
assert.match(seen[seen.length - 1].url, /^https:\/\/bambooua\.com\/index\.php\?do=search&subaction=search&story=/);
r = await call('/dle/bamboo/page', {url: 'https://bambooua.com/dorama/1205-rannya-vesna.html'});
assert.equal(r.status, 200);
r = await call('/dle/bamboo/page', {url: 'https://bambooua.com/cinema/626-my-beautiful-man-eternal.html'});
assert.equal(r.status, 200);
const before = seen.length;
for (const [path, params] of [
  ['/dle/eneyida/page', {url: 'https://klonua.com/anime/9941-x.html'}],
  ['/dle/eneyida/page', {url: 'https://eneyida.tv.evil.test/9618-x.html'}],
  ['/dle/eneyida/page', {url: 'https://eneyida.tv/9618-x.html?x=1'}],
  ['/dle/eneyida/player', {url: 'https://hdvbua.pro/vid/98533?tr=1'}], ['/dle/eneyida/player', {url: 'https://hdvbua.pro/other/98533'}],
  ['/dle/bamboo/page', {url: 'https://bambooua.com/for-supporters/'}],
  ['/dle/bamboo/page', {url: 'https://bambooua.com.evil.test/dorama/1205-x.html'}],
  ['/dle/bamboo/page', {url: 'https://bambooua.com/dorama/1205-x.html?x=1'}],
  ['/dle/bamboo/page', {url: 'https://eneyida.tv/9618-x.html'}],
  ['/dle/bamboo/player', {url: 'https://bambooua.com/dorama/1205-x.html'}],
  ['/dle/klon/search', {q: ''}],
  ['/dle/klon/search', {q: 'x'.repeat(201)}],
]) assert.equal((await call(path, params)).status, 400, path + JSON.stringify(params));
assert.equal((await call('/dle/other/search', {q: 'x'})).status, 404, 'unknown site');
assert.equal((await call('/dle/klon/search', {q: 'x'}, 'wrong')).status, 200, 'fixed public catalogue routes need no client key');
assert.equal(seen.length, before + 1, 'only the explicitly public valid request reaches the network');
globalThis.fetch = async () => new Response('Just a moment...', {status: 403});
assert.equal((await call('/dle/klon/search', {q: 'x'})).status, 424, 'site refusals are shown as 424');
console.log('PASS: Worker /dle routes (public access, address validation, no made-up headers, errors)');
// /uf/login: the caller's login goes to the bot, the cookie comes back; the uf routes pass &cookie= on to the bot untouched.
const sent = [];
globalThis.fetch = async (url, options) => {
  sent.push({url: String(url), options});
  return String(url).includes('/uf/login')
    ? new Response(JSON.stringify({ok: true, cookie: 'dle_user_id=7; dle_password=abc'}), {headers: {'Content-Type': 'application/json'}})
    : new Response('<html>member page</html>');
};
const loginRequest = (body, k = key) => new Request('https://worker.test/uf/login?key=' + k, {method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body)});
let answer = await worker.fetch(loginRequest({login: 'tolik', password: 'secret'}), {ACCESS_KEY: key, EMBED_URL: 'https://bot.test/anitube'});
assert.equal(answer.status, 200);
assert.deepEqual(await answer.json(), {ok: true, cookie: 'dle_user_id=7; dle_password=abc'});
assert.equal(sent[0].url, 'https://bot.test/anitube/uf/login?key=' + key);
assert.equal(sent[0].options.method, 'POST');
assert.deepEqual(JSON.parse(sent[0].options.body), {login: 'tolik', password: 'secret'});
assert.equal((await worker.fetch(loginRequest({login: 'tolik', password: 'secret'}, 'wrong'), {ACCESS_KEY: key, EMBED_URL: 'https://bot.test/anitube'})).status, 200, 'the Worker authenticates to the bot with its server secret, not the caller key');
assert.equal((await worker.fetch(loginRequest('not json'), {ACCESS_KEY: key, EMBED_URL: 'https://bot.test/anitube'})).status, 400);
assert.equal((await worker.fetch(loginRequest({login: 'tolik'}), {ACCESS_KEY: key, EMBED_URL: 'https://bot.test/anitube'})).status, 400);
assert.equal((await worker.fetch(loginRequest({login: 'a', password: 'b'}), {ACCESS_KEY: key})).status, 424, 'without a bot there is nobody to sign in');
// a refusal by uafix keeps its status and its reason
globalThis.fetch = async () => new Response(JSON.stringify({ok: false, error: 'uafix.net не прийняв вхід'}), {status: 401});
answer = await worker.fetch(loginRequest({login: 'a', password: 'wrong'}), {ACCESS_KEY: key, EMBED_URL: 'https://bot.test/anitube'});
assert.equal(answer.status, 401); assert.equal((await answer.json()).ok, false);
// the cookie rides along to the bot on the uf routes (and the key is replaced, not duplicated)
sent.length = 0;
globalThis.fetch = async (url) => { sent.push(String(url)); return new Response('<html>member page</html>'); };
await worker.fetch(new Request('https://worker.test/uf/page?' + new URLSearchParams({url: 'https://uafix.net/serials/x/', cookie: 'dle_user_id=7; dle_password=abc', key})), {ACCESS_KEY: key, EMBED_URL: 'https://bot.test/anitube'});
assert.match(sent[0], /^https:\/\/bot\.test\/anitube\/uf\/page\?url=.*&cookie=dle_user_id%3D7%3B\+dle_password%3Dabc&key=/);
assert.equal((sent[0].match(/key=/g) || []).length, 1);
// a GET on /uf/login carries no login and never reaches the bot
sent.length = 0;
assert.equal((await worker.fetch(new Request('https://worker.test/uf/login?key=' + key), {ACCESS_KEY: key, EMBED_URL: 'https://bot.test/anitube'})).status, 400);
assert.equal(sent.length, 0);
console.log('PASS: Worker /uf/login relay and cookie pass-through');
