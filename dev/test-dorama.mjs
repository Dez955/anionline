import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {DOMParser} from 'linkedom';

const source = fs.readFileSync(new URL('../anitube.js', import.meta.url), 'utf8');
const fixture = name => fs.readFileSync(new URL('./fixtures/dorama-' + name, import.meta.url), 'utf8');
let russian = false, response = fixture('cook-player.html'), requested = [];
const ctx = {URL, DOMParser, setTimeout, clearTimeout, console,
  Lampa: {Platform: {is: () => false}, Storage: {field: k => k === 'anitube_russian' ? russian : ''}},
  $: {ajax(options) { requested.push(options); options.success(options.dataType === 'json' ? JSON.parse(response) : response); }}};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(source.replace('    start();', 'window.t={doramaCatalog,doramaSeasons,doramaPlayerUrl,doramaMedia,doramaStream,doramaPlayerPage};'), ctx);
const t = ctx.t;
const plain = value => JSON.parse(JSON.stringify(value));
assert.equal(t.doramaCatalog(JSON.parse(fixture('search.json')))[0].ref.slug, 'viiskovii-kuxar-staje-legendoyu');
assert.equal(t.doramaCatalog({serials: [{name: 'bad', slug: '../admin'}]}).length, 0);
assert.equal(t.doramaCatalog({serials: {}}).length, 0);
for (const [name, id, expected] of [
  ['cook', 3429, [['UAFLIX (UA)', 3], ['Субтитри (укр.)', 12]]],
  ['moli', 3897, [['UAFLIX (UA)', 7], ['Автосубтитри (укр.)', 39]]],
  ['spring', 4234, [['Автосубтитри (укр.)', 26]]]
]) {
  const seasons = t.doramaSeasons(fixture(name + '-player.html'), id);
  assert.deepEqual(plain(seasons[1].map(v => [v.label, v.episodes.length])), expected, name);
  for (const voice of seasons[1]) {
    const numbers = Array.from(voice.episodes, e => e.ref.ep);
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
    assert.equal(new Set(numbers).size, numbers.length);
  }
  assert.deepEqual(plain(t.doramaSeasons(fixture(name + '-player.html'), id + 1)), {}, 'wrong show rejected');
}
russian = true;
const all = t.doramaSeasons(fixture('cook-player.html'), 3429)[1];
assert.equal(all.find(v => v.label === 'Субтитри (укр.)').episodes.length, 12);
assert.equal(all.find(v => v.label === 'Субтитри (рос.)').episodes.length, 12, 'Russian subtitles are never labelled Ukrainian');
assert.ok(all.some(v => v.label === 'AniDUB (рос.)'));
assert.ok(!all.some(v => /KG/.test(v.label)), 'Kyrgyz subtitles are not Russian');
russian = false;
assert.deepEqual(plain(t.doramaSeasons('<div id="inputData" data-playlist="1">null</div>', 1)), {});
assert.deepEqual(plain(t.doramaSeasons('<div id="inputData" data-playlist="1">{broken}</div>', 1)), {});
const twoSeasons = {1: {1: [{voice_id: '310', voice_name: 'UAFLIX (UA)', season: '1', episode: '1'}]},
  2: {1: [{voice_id: '310', voice_name: 'UAFLIX (UA)', season: '2', episode: '1'}]}};
const multiPage = selector => '<div id="inputData" data-playlist="1" data-season="1" data-season-name="' + selector + '">' + JSON.stringify(twoSeasons) + '</div>';
assert.deepEqual(Object.keys(t.doramaSeasons(multiPage('disabled'), 1)), ['1'], 'unaddressable season 2 is never played as season 1');
const multiple = t.doramaSeasons(multiPage('season'), 1);
assert.deepEqual(Object.keys(multiple), ['1', '2']);
assert.equal(multiple[2][0].episodes[0].ref.seasonParam, 'season');
assert.match(t.doramaPlayerUrl(multiple[2][0].episodes[0].ref), /&season=2$/);
for (const bad of ['http://s1.davidog.top/a.m3u8', 'https://s1.davidog.top.evil.test/a.m3u8', 'https://evil.test/a.m3u8',
  'https://s1.davidog.top:8443/a.m3u8', 'https://user@s1.davidog.top/a.m3u8', 'https://w.davidog.top/a.m3u8']) assert.equal(t.doramaMedia(bad), '', bad);
for (const ref of [{id: '../x', ep: 1}, {id: 1, ep: 0}, {id: 1, ep: 1, track: '3&x=2'}, {id: 1, ep: 1, seasonParam: 'redirect', season: 2}]) assert.equal(t.doramaPlayerUrl(ref), '');
assert.equal(t.doramaPlayerUrl({id: 1, ep: 2, track: 310, season: 3, seasonParam: 'season'}), 'https://w.davidog.top/1?ep=2&track=310&season=3');

const ref = t.doramaSeasons(fixture('cook-player.html'), 3429)[1][0].episodes[0].ref;
response = fixture('cook-dub-player.html');
const stream = await new Promise((ok, fail) => t.doramaStream(ref, (url, subtitles) => ok({url, subtitles}), fail));
assert.match(stream.url, /uaflix_ukrainskij_465893/);
assert.match(requested.at(-1).url, /\/dorama\/player\?/);
assert.equal(new URL(requested.at(-1).url).searchParams.get('track'), '310');
for (const wrong of [{...ref, id: 99}, {...ref, ep: 2}, {...ref, track: '169'}, {...ref, season: 2}]) {
  const message = await new Promise(ok => t.doramaStream(wrong, () => assert.fail('must refuse mismatched selection'), ok));
  assert.match(message, /іншу серію або озвучення/);
}
response = fixture('spring-player.html');
const springRef = t.doramaSeasons(response, 4234)[1][0].episodes[0].ref;
const subs = await new Promise((ok, fail) => t.doramaStream(springRef, (url, subtitles) => ok(subtitles), fail));
assert.equal(subs.length, 1, 'soft Ukrainian subtitles are passed to Lampa');
assert.equal(subs[0].label, 'Українські');
for (const body of ['Змініть країну перегляду', '<title>Just a moment</title>']) {
  response = body;
  const before = requested.length;
  const message = await new Promise(ok => t.doramaPlayerPage(ref, () => assert.fail('refused page'), ok));
  assert.ok(message);
  assert.equal(requested.length, before + 1, 'no alternate server on access/region refusal');
}
// Android uses its native request, with no borrowed browser headers or Referer.
ctx.Lampa.Platform.is = name => name === 'android';
ctx.Lampa.Reguest = function () { this.native = (url, ok, fail, post, options) => {
  assert.ok(!Object.keys(options.headers).some(k => /referer|cookie|sec-fetch/i.test(k)));
  assert.match(options.headers['User-Agent'], /^AniTubeLampa\//);
  ok(fixture('cook-dub-player.html'));
}; };
await new Promise((ok, fail) => t.doramaStream(ref, ok, fail));
console.log('PASS: DoramaUA real catalogues/playlists, per-voice counts, language filters, soft subtitles, selection checks and native requests');

const workerSource = fs.readFileSync(new URL('../home-proxy/cloudflare-worker.js', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(workerSource).toString('base64'))).default;
const key = 'dorama-offline-test-key', env = {ACCESS_KEY: key};
const call = (params, supplied = key) => worker.fetch(new Request('https://worker.test/dorama/player?' + new URLSearchParams({...params, key: supplied})), env);
let calls = [];
globalThis.fetch = async (url, options) => { calls.push({url, options}); return new Response(fixture('cook-dub-player.html')); };
assert.equal((await call({id: '3429', ep: '1', track: '310'})).status, 200);
assert.equal(calls[0].url, 'https://w.davidog.top/3429?ep=1&track=310');
assert.equal(calls[0].options.redirect, 'manual');
assert.ok(!Object.keys(calls[0].options.headers).some(k => /referer|cookie|origin|sec-fetch/i.test(k)));
assert.match(calls[0].options.headers['User-Agent'], /^AniTubeLampaProxy/);
const before = calls.length;
for (const params of [{id: '../admin'}, {id: '1', ep: '-1'}, {id: '1', track: '310&url=x'}, {id: '1', seasonParam: 'url', season: '2'}, {id: '1', seasonParam: 's'}]) assert.equal((await call(params)).status, 400);
assert.equal((await call({id: '3429'}, 'wrong')).status, 200, 'Dorama player route is public and ignores client keys');
assert.equal(calls.length, before + 1, 'only the valid public request reaches the network');
for (const makeResponse of [() => new Response('forbidden', {status: 403}), () => new Response('', {status: 302, headers: {Location: 'https://evil.test'}}),
  () => new Response('Змініть країну перегляду'), () => new Response('no player')]) {
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return makeResponse(); };
  assert.equal((await call({id: '3429'})).status, 424);
  assert.equal(attempts, 1, 'no alternate host/redirect on refusal');
}
console.log('PASS: DoramaUA Worker fixed destination, key/input checks, honest headers and explicit upstream refusals');
