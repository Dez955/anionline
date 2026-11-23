// 2.0.7: the follow list shared between the owner's TVs through the Worker's /sync (in-memory KV), and Japanese titles in the list
// replaced with the AniTube page's own title. No network.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {DOMParser} from 'linkedom';
import worker from '../home-proxy/cloudflare-worker.js';

const KEY = 'k'.repeat(20);
function kv() {
    const map = new Map(), writes = [];
    return {map, writes, async get(k) { return map.has(k) ? map.get(k) : null; }, async put(k, v) { writes.push(k); map.set(k, v); }};
}
const call = (env, body, {method = 'POST', key = KEY, path = '/sync'} = {}) =>
    worker.fetch(new Request('https://w.test' + path + '?key=' + key, method === 'POST' ? {method, body: typeof body === 'string' ? body : JSON.stringify(body), headers: {'content-type': 'text/plain'}} : {method}), env);

// 1. The Worker route.
let store = kv();
let env = {ACCESS_KEY: KEY, SYNC: store};
assert.equal((await call({ACCESS_KEY: KEY}, {code: 'abcdef', items: {}})).status, 503, 'no KV bound: a clear error');
assert.equal((await call(env, {code: 'abc', items: {}})).status, 400, 'too short a code');
assert.equal((await call(env, {code: 'abcdef', items: {}}, {key: 'x'.repeat(20)})).status, 200, 'shared-list code, not a Worker client key, gates the list');
assert.equal((await call(env, null, {method: 'GET'})).status, 405);
assert.equal((await call(env, null, {method: 'POST', path: '/search'})).status, 405, 'POST only for /sync');
assert.equal((await worker.fetch(new Request('https://w.test/sync', {method: 'OPTIONS'}), env)).headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
let res = await (await call(env, {code: 'Tolik-1', items: {
    '7': {t: 100, r: {id: '7', url: 'https://anitube.in.ua/6088-x.html', title: 'Чорна конюшина', mode: 'subs', card: {id: 7, name: 'X', deep: {a: 1}}, added: 90, seen: {subs: 3}}},
    'bad': {t: 1, r: {}},
    '8': {t: 50, r: {url: 'https://evil.test/x', title: 'Y', card: {id: 8}}}
}})).json();
assert.deepEqual(Object.keys(res.items).sort(), ['7', '8']);
assert.equal(res.items['7'].r.seen, undefined, 'counts are not stored');
assert.equal(res.items['7'].r.card.deep, undefined, 'only plain card values');
assert.equal(res.items['8'].r.url, '', 'foreign address dropped');
assert.equal([...store.map.keys()][0].length, 'follow:'.length + 64, 'the code is stored only as a hash');
assert.ok(![...store.map.keys()][0].includes('tolik'));
const writes = store.writes.length;
await call(env, {code: 'tolik-1', items: {'7': {t: 100, r: {id: '7', title: 'old'}}}});
assert.equal(store.writes.length, writes, 'nothing newer: no KV write (the code is case-insensitive)');
res = await (await call(env, {code: 'tolik-1', items: {'7': {t: 99, r: {id: '7', title: 'older'}}, '8': {t: 60, del: true}}})).json();
assert.equal(res.items['7'].r.title, 'Чорна конюшина', 'an older change loses');
assert.equal(res.items['8'].del, true, 'a newer removal wins');
res = await (await call(env, {code: 'someone-else', items: {}})).json();
assert.deepEqual(res.items, {}, 'another code is another list');

// 2. Two TVs with the plugin, both talking to that Worker.
let code = fs.readFileSync(new URL('../anitube.js', import.meta.url), 'utf8');
code = code.replace('    function fetchText(action, value, success, failure) {', '    function fetchText(action, value, success, failure) { if (window.stubSearch) return window.stubSearch(value, success, failure);')
    .replace('    function fetchPlaylist(url, success, failure) {', '    function fetchPlaylist(url, success, failure) { if (window.stubPlaylist) return window.stubPlaylist(url, success, failure);')
    .replace('    function tmdbTitles(movie, done) {', '    function tmdbTitles(movie, done) { return done([]);')
    .replace('    function anilistTitles(movie, done) {', '    function anilistTitles(movie, done) { return done(window.stubAnilist || []);');
store = kv();
env = {ACCESS_KEY: KEY, SYNC: store};
function tv(syncCode) {
    const data = {anitube_proxy: 'https://w.test', anitube_proxy_key: KEY}, noty = [], requests = [];
    if (syncCode) data.anitube_sync_code = syncCode;
    let pending = [];
    const ctx = {URL, DOMParser, console, clearTimeout, setInterval: () => 0, setTimeout: (fn, ms) => { if (ms === 3000) pending.push(fn); return 0; }};
    ctx.window = ctx;
    ctx.$ = {ajax(o) {
        requests.push(o);
        const url = new URL(o.url);
        worker.fetch(new Request(o.url, {method: o.type, body: o.data, headers: {'content-type': o.contentType}}), env)
            .then(async r => { const text = await r.text(); if (r.ok) o.success(JSON.parse(text)); else o.error({status: r.status, responseText: text}); });
        return url;
    }};
    ctx.Lampa = {
        Storage: {get: (n, d) => n in data ? data[n] : d, set(n, v) { data[n] = v; }, field: n => data[n]},
        Noty: {show: m => noty.push(m)}, Listener: {follow() {}}, Controller: {enabled: () => ({name: 'content'}), toggle() {}},
        Select: {show() {}}, Activity: {push() {}}, Platform: {is: () => false}
    };
    vm.createContext(ctx);
    vm.runInContext(code.replace('    start();', '    window.test = {followAdd, followRemove, followAll, followGet, followSync, followCheck, followModeMenu, pickName};'), ctx);
    const flush = async () => { await new Promise(r => setTimeout(r, 30)); const p = pending; pending = []; p.forEach(fn => fn()); await new Promise(r => setTimeout(r, 30)); };
    return {t: ctx.test, ctx, data, noty, requests, flush};
}
const sync = async (side, manual) => { side.t.followSync(manual); await new Promise(r => setTimeout(r, 40)); };
const anime = (id, name) => ({id, name, original_name: name, genres: [{id: 16}], original_language: 'ja', poster_path: '/p.jpg'});

const lone = tv('');
lone.t.followAdd(anime(1, 'A'), {url: 'https://anitube.in.ua/1-a.html', title: 'А', note: ''});
await lone.flush(); await sync(lone, true);
assert.equal(lone.requests.length, 0, 'without a code nothing leaves the TV');
assert.match(lone.noty.at(-1), /синхронізація вимкнена/);

const samsung = tv('tolik-tv-2026'), lg = tv('tolik-tv-2026');
samsung.t.followAdd(anime(7, 'Чорна конюшина'), {url: 'https://anitube.in.ua/6088-x.html', title: 'Чорна конюшина (Сезон 2)', note: '5 з 12'});
samsung.t.followAdd(anime(9, 'Фрірен'), {url: 'https://anitube.in.ua/4465-f.html', title: 'Фрірен', note: ''});
await samsung.flush();
assert.equal(samsung.requests.length, 1, 'two stars, one request after a short pause');
let a = samsung.t.followAll(); a['7'].seen = {subs: 5, dub: 4}; samsung.data.anitube_follow = a;
await sync(lg, true);
assert.deepEqual(Object.keys(lg.t.followAll()).sort(), ['7', '9'], 'the other TV gets the list');
assert.equal(lg.t.followGet(7).seen, undefined, 'counts stay per TV: its first check is a silent baseline');
assert.equal(lg.t.followGet(7).next, 0, 'checked soon');
assert.match(lg.noty.at(-1), /синхронізовано, у списку 2/);
// Removed on LG: gone on Samsung too, and it does not come back from Samsung's older copy.
lg.t.followRemove(9);
await lg.flush();
await sync(samsung);
assert.equal(samsung.t.followGet(9), null, 'removal travels');
await sync(lg);
assert.equal(lg.t.followGet(9), null, 'and is not brought back');
assert.equal(samsung.t.followGet(7).seen.subs, 5, 'Samsung keeps its own counts');
// Mode changed on Samsung reaches LG; added again on Samsung after removal wins over the old removal.
await new Promise(r => setTimeout(r, 5));
a = samsung.t.followAll(); a['7'].mode = 'dub'; a['7'].t = Date.now(); samsung.data.anitube_follow = a;
await new Promise(r => setTimeout(r, 5));
samsung.t.followAdd(anime(9, 'Фрірен'), {url: 'https://anitube.in.ua/4465-f.html', title: 'Фрірен', note: ''});
await samsung.flush();
await sync(lg);
assert.equal(lg.t.followGet(7).mode, 'dub');
assert.ok(lg.t.followGet(9), 'added again after the removal');
// Worker without storage or old Worker: a plain message, the list stays as it is.
env.SYNC = null;
await sync(lg, true);
assert.match(lg.noty.at(-1), /не вдалася \(у Worker не підключене сховище SYNC\)/);
assert.equal(Object.keys(lg.t.followAll()).length, 2);
env.SYNC = store;

// 3. A Japanese title in the list is replaced with the followed page's own title.
const side = tv('');
side.ctx.stubSearch = (q, ok) => ok('<div class="short-in"><h2><a href="https://anitube.in.ua/6138-p.html">Підкорення іншого світу разом із богинею</a></h2></div>' +
    '<div class="short-in"><h2><a href="https://anitube.in.ua/1-other.html">Інше</a></h2></div>');
side.ctx.stubPlaylist = (url, ok, fail) => fail({status: 0});
a = side.t.followAll();
a['42'] = {id: '42', url: 'https://anitube.in.ua/6138-p.html', title: '信者ゼロの女神サマと始める異世界攻略', mode: 'any', card: {id: 42, name: '信者ゼロの女神サマと始める異世界攻略', original_name: '信者ゼロの女神サマと始める異世界攻略'}, next: 0};
side.data.anitube_follow = a;
await new Promise(resolve => side.t.followCheck('42', resolve));
assert.equal(side.t.followGet(42).title, 'Підкорення іншого світу разом із богинею');
// Not on AniTube's answer: the title stays and is not looked up again for six hours.
a = side.t.followAll(); a['43'] = {id: '43', url: 'https://anitube.in.ua/9-z.html', title: 'ゼロ', mode: 'any', card: {id: 43, name: 'ゼロ'}, next: 0}; side.data.anitube_follow = a;
let searches = 0; const before = side.ctx.stubSearch; side.ctx.stubSearch = (q, ok) => { searches++; before(q, ok); };
await new Promise(resolve => side.t.followCheck('43', resolve));
await new Promise(resolve => side.t.followCheck('43', resolve));
assert.equal(side.t.followGet(43).title, 'ゼロ'); assert.equal(searches, 1, 'one try, then six hours later');
// A site's "Ukrainian / English / Japanese" name with a Japanese card name: the Ukrainian part, never the Japanese one.
assert.equal(side.t.pickName(['Вигнаний лицар', 'Exiled Knight', '追放された転生重騎士'], '追放された転生重騎士'), 'Вигнаний лицар');
assert.equal(side.t.pickName(['Фрірен', 'Frieren'], ''), 'Фрірен');
console.log('PASS: shared follow list (code, merge, removals, counts per TV, Worker without storage) and Ukrainian titles in the list');
