import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../home-proxy/cloudflare-worker.js', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
const key = 'offline-test-key-only';
const request = (url, supplied) => new Request('https://worker.test/moon?' + new URLSearchParams({url, ...(supplied === undefined ? {} : {key: supplied})}));
let calls = 0;
globalThis.fetch = async (url, options) => { calls++; assert.equal(options.redirect, 'manual'); return new Response('<html>public player config</html>'); };
assert.equal((await worker.fetch(request('https://moonanime.net/iframe/abcde'), {})).status, 200, 'built-in public route needs no client or server key');
for (const url of ['https://127.0.0.1/iframe/abcde', 'https://moonanime.net.evil.test/iframe/abcde', 'https://moonanime.net:8080/iframe/abcde', 'https://user@moonanime.net/iframe/abcde', 'https://moonanime.net/admin', 'http://moonanime.net/iframe/abcde', 'https://moonanime.net/iframe/abcde?url=https://evil.test']) {
 assert.equal((await worker.fetch(request(url), {ACCESS_KEY:key})).status, 400, url);
}
assert.equal(calls, 1);
assert.equal((await worker.fetch(request('https://moonanime.art/vod/abcdef/'), {ACCESS_KEY:key})).status, 200);
assert.equal((await worker.fetch(request('https://moonanime.net/iframe/abcde', 'wrong'), {})).status, 200, 'a client-supplied key is ignored');
assert.equal(calls, 3);
globalThis.fetch = async () => new Response('<html>500</html>', {status:400});
assert.equal((await worker.fetch(request('https://moonanime.net/iframe/abcde'), {ACCESS_KEY:key})).status, 424);
console.log('PASS: Worker Moon route, public access, destination validation and upstream errors');
let targets=[];
for (const status of [400, 403, 500]) {
 targets=[];
 globalThis.fetch=async(url,options)=>{targets.push(String(url));assert.equal(options.headers['Accept-Language'],'uk');assert.equal(options.headers.Accept,'*/*');return new Response('upstream failure',{status});};
 const result=await worker.fetch(request('https://moonanime.net/iframe/abcde'),{ACCESS_KEY:key,EMBED_URL:'https://helper.test/anitube'});
 assert.equal(result.status,424);assert.equal(targets.length,1,'Moon never forwards to another service');
}
targets=[];
globalThis.fetch=async(url)=>{targets.push(String(url));return new Response('<title>Just a moment...</title>Enable JavaScript and cookies to continue');};
const result=await worker.fetch(request('https://moonanime.net/iframe/abcde'),{ACCESS_KEY:key});
assert.equal(result.status,424);assert.equal(targets.length,1,'no retry of a browser challenge');
targets=[];
globalThis.fetch=async(url,options)=>{targets.push(String(url));assert.equal(options.redirect,'manual');return new Response(JSON.stringify({videoUrl:'https://ashdi.vip/vod/142931?player=animeon.club'}));};
const animeon=id=>worker.fetch(new Request('https://worker.test/animeon?'+new URLSearchParams({id,key})),{ACCESS_KEY:key});
let reply=await animeon('59901');
assert.equal(reply.status,200);assert.deepEqual(await reply.json(),{videoUrl:'https://ashdi.vip/vod/142931'});assert.equal(targets[0],'https://animeon.club/api/player/59901/episode');
assert.equal((await animeon('1/../x')).status,400);assert.equal(targets.length,1,'a bad id never reaches AnimeOn');
for (const body of [{videoUrl:'https://evil.test/vod/1'},{videoUrl:'https://moonanime.art/iframe/abc/'},{}]) {
 globalThis.fetch=async()=>new Response(JSON.stringify(body));
 assert.equal((await animeon('59901')).status,424);
}
console.log('PASS: AnimeOn episode route returns only an Ashdi page');
console.log('PASS: explicit language, page-only requests and no forwarding/retry of upstream failures or challenges');
