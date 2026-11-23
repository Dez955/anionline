// 2.0.8: the UAflix account works like the UAKino plugin's: login and password in Lampa's settings, the cookie comes from the helper (POST /uf/login),
// is kept in Lampa and goes back with the uf requests.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const code = fs.readFileSync(new URL('../anitube.js', import.meta.url), 'utf8');
const FORM = '<form><input type="password" name="login_password"></form>';
function world(store, script) {
  const calls = [];
  const $ = {ajax(s) { calls.push(s); script(s, calls.length); }};
  const storage = {get: (n, d) => (n in store ? store[n] : d), field: () => undefined, set: (n, v) => { store[n] = v; }};
  const ctx = {URL, console, $, setTimeout: f => f(), clearTimeout() {}, Lampa: {Storage: storage, Platform: {is: () => false}, Noty: {show() {}}}};
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(code.replace('    start();', '    window.t = {proxyUafix, uafixLogin, uafixEnsureLogin, uafixCookie, uafixStatus, uafixHeaders};'), ctx);
  return {t: ctx.t, calls, store};
}
const loginCall = c => /\/uf\/login/.test(c.url);

// 1. Without a saved login nothing is signed in and no cookie is sent.
let w = world({}, (s) => s.success('<html>page</html>'));
let got = [];
w.t.proxyUafix('page', 'https://uafix.net/serials/x/', h => got.push(h), () => got.push('fail'));
assert.deepEqual(got, ['<html>page</html>']);
assert.equal(w.calls.length, 1); assert.doesNotMatch(w.calls[0].url, /cookie=/);
assert.equal(w.t.uafixStatus(), 'Вхід не виконано');

// 2. A saved login signs in once through the helper, keeps the cookie and sends it with the request.
w = world({anitube_uafix_login: 'tolik', anitube_uafix_pass: 'secret'}, (s) => {
  if (loginCall(s)) { assert.equal(s.type, 'POST'); assert.deepEqual(JSON.parse(s.data), {login: 'tolik', password: 'secret'}); return s.success({ok: true, cookie: 'dle_user_id=7; dle_password=abc'}); }
  s.success('<html>member page</html>');
});
got = [];
w.t.proxyUafix('page', 'https://uafix.net/serials/x/', h => got.push(h), () => got.push('fail'));
assert.deepEqual(got, ['<html>member page</html>']);
assert.equal(w.store.anitube_uafix_cookie, 'dle_user_id=7; dle_password=abc');
const page = w.calls.find(c => !loginCall(c));
assert.match(page.url, /\/uf\/page\?url=.*&cookie=dle_user_id%3D7%3B%20dle_password%3Dabc/);
assert.doesNotMatch(page.url, /[?&]key=/, 'built-in Worker receives no client secret');
assert.equal(w.t.uafixStatus(), 'Вхід виконано (tolik)');
assert.equal(w.t.uafixHeaders().Cookie, 'dle_user_id=7; dle_password=abc', 'Android asks the site with the same cookie');
// a second request reuses the cookie: no new sign-in
w.t.proxyUafix('page', 'https://uafix.net/serials/y/', () => {}, () => {});
assert.equal(w.calls.filter(loginCall).length, 1);

// 3. uafix refuses the login: no cookie, no repeat for six hours (so a wrong password is not hammered), the page is still asked for.
w = world({anitube_uafix_login: 'tolik', anitube_uafix_pass: 'wrong'}, (s) => {
  if (loginCall(s)) return s.error({status: 401, responseText: JSON.stringify({ok: false, error: 'uafix.net не прийняв вхід'})}, 'error');
  s.success('<html>trailer</html>');
});
w.t.proxyUafix('page', 'https://uafix.net/serials/x/', () => {}, () => {});
w.t.proxyUafix('page', 'https://uafix.net/serials/x/', () => {}, () => {});
assert.equal(w.calls.filter(loginCall).length, 1, 'one sign-in attempt, then a pause');
assert.equal(w.store.anitube_uafix_cookie, '');
assert.ok(w.store.anitube_uafix_fail > 0);
let said = null;
w.t.uafixLogin((ok, why) => { said = [ok, why]; });
assert.deepEqual(said, [false, 'uafix.net не прийняв вхід'], 'the reason is shown to the user');

// 4. A network failure does NOT start the six-hour pause.
w = world({anitube_uafix_login: 'tolik', anitube_uafix_pass: 'secret'}, (s) => { if (loginCall(s)) s.error({status: 0}, 'error'); else s.success('<html>x</html>'); });
w.t.proxyUafix('page', 'https://uafix.net/serials/x/', () => {}, () => {});
assert.ok(!w.store.anitube_uafix_fail, 'no pause after a lost connection');

// 5. An old Worker or bot (404) is explained, not shown as a mystery.
w = world({anitube_uafix_login: 'a', anitube_uafix_pass: 'b'}, (s) => s.error({status: 404, responseText: '{"error":"not_found"}'}, 'error'));
said = null; w.t.uafixLogin((ok, why) => { said = why; });
assert.match(said, /оновіть/);

// 6. The stored cookie stopped working (the page shows the sign-in form again): sign in once more and ask again.
let step = 0;
w = world({anitube_uafix_login: 'tolik', anitube_uafix_pass: 'secret', anitube_uafix_cookie: 'dle_user_id=1; dle_password=old'}, (s) => {
  if (loginCall(s)) return s.success({ok: true, cookie: 'dle_user_id=1; dle_password=new'});
  s.success(++step === 1 ? FORM : '<html>member page</html>');
});
got = [];
w.t.proxyUafix('page', 'https://uafix.net/serials/x/', h => got.push(h), () => got.push('fail'));
assert.deepEqual(got, ['<html>member page</html>']);
assert.equal(w.store.anitube_uafix_cookie, 'dle_user_id=1; dle_password=new');
assert.equal(w.calls.filter(loginCall).length, 1);
assert.match(w.calls[w.calls.length - 1].url, /cookie=dle_user_id%3D1%3B%20dle_password%3Dnew/);

// 7. An episode page with no player (HTTP 424) and a stored cookie: renewed once, and only once.
step = 0;
w = world({anitube_uafix_login: 'tolik', anitube_uafix_pass: 'secret', anitube_uafix_cookie: 'dle_user_id=1; dle_password=old'}, (s) => {
  if (loginCall(s)) return s.success({ok: true, cookie: 'dle_user_id=1; dle_password=new'});
  s.error({status: 424, responseText: '{"error":"player_missing"}'}, 'error');
});
got = [];
w.t.proxyUafix('episode', 'https://uafix.net/serials/x/season-01-episode-01/', d => got.push('ok'), x => got.push(['fail', x.status]));
assert.deepEqual(got, [['fail', 424]]);
assert.equal(w.calls.filter(loginCall).length, 1, 'a single renewal, no loop');
assert.equal(w.calls.filter(c => !loginCall(c)).length, 2);
console.log('PASS: UAflix account in the plugin (login, cookie, pause, renewal)');
