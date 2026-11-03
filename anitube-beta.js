/* AniTube for Lampa. Sources: AniTube, Makhno, AnimeOn, UAflix, DoramaUA, AniLibria. Series page laid out like the UAKino plugin's.
   No provider scripts are executed. */
(function () {
    'use strict';
    var HOME = 'https://anitube.in.ua/';
    var API = 'https://anitube-lampa-proxy.netlify.app/.netlify/functions/anitube';
    var COMPONENT = 'anitube';
    var VERSION = '1.8.19';
    var PLAYLIST_AHEAD = 15, PLAYLIST_BEHIND = 3, NEIGHBOUR_GRACE = 2000;
    // uafix and DoramaUA need one page request per episode, so their window around the chosen episode is smaller.
    var UAFIX_AHEAD = 6, UAFIX_BEHIND = 1;
    var DORAMA_AHEAD = 6, DORAMA_BEHIND = 1;
    var ANIMEON_AHEAD = 6, ANIMEON_BEHIND = 1;

    function absolute(value, base) {
        try {
            var url = new URL(value, base);
            return url.protocol === 'https:' ? url.href : '';
        } catch (e) { return ''; }
    }
    function text(node) { return node ? (node.textContent || '').trim() : ''; }
    function list(root, selector) { return Array.prototype.slice.call(root.querySelectorAll(selector)); }
    function page(html) { return new DOMParser().parseFromString(html, 'text/html'); }
    function catalog(html) {
        var doc = page(html), cards = list(doc, '.news_2');
        if (!cards.length) cards = list(doc, '.short-in');
        if (!cards.length) cards = list(doc, 'article.story');
        var seen = {};
        return cards.map(function (card) {
            // AniTube serves different templates by client. On the mobile one (what Android Lampa receives) the card's first
            // link wraps the poster and the "Озв+Суб" badge, and the real title is an <h2> inside a later link.
            var heading = card.querySelector('h2');
            var titled = card.querySelector('.title2 a[href]');
            var link = titled || (heading && (heading.querySelector('a[href]') || (heading.closest && heading.closest('a[href]')))) || card.querySelector('a[href]');
            var url = link && absolute(link.getAttribute('href'), HOME);
            // Never fall back to a link's own text first: on the mobile template that is the "Озв+Суб" badge.
            var poster = card.querySelector('img[alt]');
            var linkTitle = link && (link.getAttribute('title') || '').replace(/^Перегляд:\s*/i, '');
            var title = (titled ? text(titled) : '') || text(heading) || (poster && poster.getAttribute('alt')) || linkTitle || text(link);
            title = String(title || '').replace(/\s+/g, ' ').trim();
            if (!url || new URL(url).hostname !== 'anitube.in.ua' || !title || seen[url]) return null;
            seen[url] = true;
            // The year tells an old adaptation from a new one of the same name; the card's text carries it ("Рік виходу аніме: 2025").
            var info = String(card.textContent || '').replace(/\s+/g, ' ');
            var year = (info.match(/Рік виходу аніме:\s*(\d{4})/) || [])[1] || '';
            var count = (info.match(/Серій:\s*(\d+(?:\s*з\s*\d+)?)/) || [])[1] || '';
            var note = [year, count ? count + ' сер.' : '', text(card.querySelector('.short-meta')), text(card.querySelector('.up-series'))].map(function (part) { return part.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join(' · ');
            return { title: title, url: url, note: note, year: year };
        }).filter(Boolean);
    }
    function sources(html, base) {
        var doc = page(html), rows = list(doc, '.playlists-lists > .playlists-items');
        if (rows.length < 2) return [];
        var episodes = list(doc, '.playlists-videos li[data-file][data-id]');
        var result = [];
        // Some shows have no row of voice teams: only "озвучення / субтитри" and then the players (ids "0_0" and "0_0_0").
        if (rows.length === 2) {
            list(rows[0], 'li[data-id]').forEach(function (mode) {
                var mid = mode.getAttribute('data-id');
                list(rows[1], 'li[data-id]').filter(function (p) { return p.getAttribute('data-id').indexOf(mid + '_') === 0; }).forEach(function (player) {
                    var pid = player.getAttribute('data-id');
                    var eps = episodes.filter(function (e) { return e.getAttribute('data-id') === pid; }).map(function (e) {
                        return { title: text(e), url: absolute(e.getAttribute('data-file'), base) };
                    }).filter(function (e) { return e.title && e.url; });
                    if (eps.length) result.push({ mode: text(mode), variant: '', player: text(player), episodes: eps });
                });
            });
            return result;
        }
        var modes = list(rows[0], 'li[data-id]'), variants = list(rows[1], 'li[data-id]');
        var players = list(rows[2], 'li[data-id]');
        modes.forEach(function (mode) {
            var mid = mode.getAttribute('data-id');
            variants.filter(function (v) { return v.getAttribute('data-id').indexOf(mid + '_') === 0; }).forEach(function (variant) {
                var vid = variant.getAttribute('data-id');
                players.filter(function (p) { return p.getAttribute('data-id').indexOf(vid + '_') === 0; }).forEach(function (player) {
                    var pid = player.getAttribute('data-id');
                    var eps = episodes.filter(function (e) { return e.getAttribute('data-id') === pid; }).map(function (e) {
                        return { title: text(e), url: absolute(e.getAttribute('data-file'), base) };
                    }).filter(function (e) { return e.title && e.url; });
                    if (eps.length) result.push({ mode: text(mode), variant: text(variant), player: text(player), episodes: eps });
                });
            });
        });
        return result;
    }
    function media(url) { return /^https:\/\//i.test(url) && /\.(m3u8|mp4|mpd|webm)(?:[?#]|$)/i.test(url); }

    function episodeDate(value) {
        var m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
        if (!m) return '';
        var y = +m[1], month = +m[2], day = +m[3];
        var days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return y >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? m[3] + '.' + m[2] + '.' + m[1] : '';
    }
    function hlsInfo(value, base) {
        var best = {height: 0, bandwidth: 0}, qualities = {}, rates = {}, pending = null;
        var lines = String(value || '').slice(0, 1000000).split(/\r?\n/);
        if (!/^#EXTM3U/.test(lines[0] || '')) return best;
        // A variant URL alone would lose external audio/subtitle groups. Keep such masters intact.
        var externalTracks = lines.some(function (line) { return /^#EXT-X-MEDIA:/.test(line) && /(?:[:,])\s*URI=/.test(line); });
        lines.forEach(function (line) {
            line = line.trim();
            if (!line) return;
            if (!/^#EXT-X-STREAM-INF:/.test(line)) {
                if (line.charAt(0) !== '#' && pending) {
                    var url = absolute(line, base), label = pending.height + 'p';
                    if (base && !externalTracks && pending.height && media(url) && /\.m3u8(?:[?#]|$)/i.test(url) &&
                        !new URL(url).username && !new URL(url).password && (!qualities[label] || pending.bandwidth > rates[label])) {
                        qualities[label] = url; rates[label] = pending.bandwidth;
                    }
                    pending = null;
                }
                return;
            }
            var size = line.match(/(?:[:,])\s*RESOLUTION=(\d+)x(\d+)/i);
            var rate = line.match(/(?:[:,])\s*BANDWIDTH=(\d+)/i);
            var height = size ? +size[2] : 0;
            pending = {height: height, bandwidth: rate ? +rate[1] : 0};
            if (height > best.height || (height === best.height && pending.bandwidth > best.bandwidth)) best = pending;
        });
        best.qualities = qualities;
        return best;
    }
    function playbackFile(stream, info, adaptive) {
        var qualities = info && info.qualities;
        var names = Object.keys(qualities || {}).sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
        if (!names.length) return {url: stream};
        var choices = {};
        if (adaptive) choices.AUTO = {url: stream, call: function (item, done) { done(stream); }};
        names.forEach(function (name, index) {
            var url = qualities[name];
            // Lampa's documented quality callbacks keep manual selection, while a saved global 480p
            // preference cannot replace this episode's maximum start. No global setting is changed.
            choices[name] = {call: function (item, done) { done(url); }};
            if (!index && !adaptive) choices[name].url = url;
        });
        return {url: adaptive ? stream : qualities[names[0]], quality: choices};
    }
    // Lampa otherwise runs a second HLS parser even when a native stream is already prepared.
    // The public change_quality argument skips that parser, without changing the video engine.
    var nativePlayback = null;
    function useNativePlayback(owner) {
        var player = Lampa.PlayerVideo;
        if (!player || typeof player.url !== 'function') return;
        if (nativePlayback) { nativePlayback.owner = owner; return; }
        var state = {player: player, original: player.url, owner: owner};
        state.wrapper = function (url, changed) {
            var work = Lampa.Player.playdata && Lampa.Player.playdata();
            var prepared = state.owner && work && work.anitube_owner === state.owner && work.anitube_native_prepared && work.url === url;
            return state.original.call(this, url, prepared ? true : changed);
        };
        nativePlayback = state; player.url = state.wrapper;
    }
    function restoreNativePlayback(owner) {
        var state = nativePlayback;
        if (!state || state.owner !== owner) return;
        state.owner = '';
        if (state.player.url === state.wrapper) state.player.url = state.original;
        nativePlayback = null;
    }
    function streamInfo(url, done) {
        if (!media(url) || !/\.m3u8(?:[?#]|$)/i.test(url)) return done({height: 0, bandwidth: 0});
        var finished = false;
        var timer = setTimeout(function () { finish({height: 0, bandwidth: 0}); }, 8000);
        function finish(info) { if (finished) return; finished = true; clearTimeout(timer); done(info); }
        function read(value) { finish(hlsInfo(value, url)); }
        if (window.Lampa && Lampa.Platform && Lampa.Platform.is('android')) {
            direct(url, {dataType: 'text'}, read, function () { finish({height: 0, bandwidth: 0}); });
        } else {
            $.ajax({url: url, dataType: 'text', timeout: 7000, success: read, error: function () { finish({height: 0, bandwidth: 0}); }});
        }
    }

    // Moon configuration is read as data. Never evaluate downloaded JavaScript.
    function moonPage(value) {
        try {
            var u = new URL(value);
            return u.protocol === 'https:' && /^(?:www\.)?moonanime\.(net|art)$/.test(u.hostname) && !u.port && !u.search && !u.hash && !u.username && !u.password && /^\/(?:iframe|vod)\/[a-zA-Z0-9_-]{5,100}\/?$/.test(u.pathname);
        } catch (e) { return false; }
    }
    function jsString(literal) {
        var quote = literal.charAt(0), out = '';
        if ((quote !== '"' && quote !== "'") || literal.charAt(literal.length - 1) !== quote) return '';
        for (var i = 1; i < literal.length - 1; i++) {
            var c = literal.charAt(i);
            if (c !== '\\') { out += c; continue; }
            c = literal.charAt(++i);
            if (c === 'u' || c === 'x') {
                var n = c === 'u' ? 4 : 2, digits = literal.substr(i + 1, n);
                if (!new RegExp('^[a-fA-F0-9]{' + n + '}$').test(digits)) return '';
                out += String.fromCharCode(parseInt(digits, 16)); i += n;
            } else out += ({n: '\n', r: '\r', t: '\t', b: '\b', f: '\f'})[c] || c;
        }
        return out;
    }
    function utf8(binary) {
        try { return decodeURIComponent(binary.split('').map(function (c) { return '%' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')); }
        catch (e) { return binary; }
    }
    function moonMedia(value) {
        try {
            var u = new URL(value);
            return media(value) && !u.username && !u.password && !u.port && /^[a-z0-9.-]+$/i.test(u.hostname) && !/^(?:localhost|\d+\.\d+\.\d+\.\d+)$/.test(u.hostname);
        } catch (e) { return false; }
    }
    // A player may expose one master URL or an explicit [1080p]URL,[720p]URL list.
    function moonSources(value) {
        var input = String(value || '').trim(), result = [];
        if (moonMedia(input)) return [{url: input, quality: 0}];
        input.split(/,(?=\s*\[[^\]]+\])/).forEach(function (part) {
            var m = part.trim().match(/^\[(\d{3,4})p?\]\s*(https:\/\/\S+)$/i);
            if (m && +m[1] <= 4320 && moonMedia(m[2])) result.push({url: m[2], quality: +m[1]});
        });
        return result.sort(function (a, b) { return b.quality - a.quality; });
    }
    function moonConfig(html) {
        var raw = String(html || '');
        if (raw.length > 3000000) return null;
        var code = raw, encoded;
        var wrappers = /atob\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/g;
        // Both public-page wrapper generations are data transforms, never script execution.
        function unwrap(bytes, modern) {
            var offset = modern ? 33 : 32, output = '', previous = bytes.charCodeAt(0);
            if (bytes.length <= offset) return '';
            for (var i = offset; i < bytes.length; i++) {
                var b = bytes.charCodeAt(i), k = bytes.charCodeAt((modern ? 1 : 0) + (i - offset) % 32);
                output += String.fromCharCode(b ^ k ^ (modern ? previous : 0));
                previous = (b + k) & 255;
            }
            return utf8(output);
        }
        while ((encoded = wrappers.exec(raw))) {
            if (encoded[1].length > 1500000) continue;
            try {
                var bytes = atob(encoded[1]);
                var modern = unwrap(bytes, true), legacy = unwrap(bytes, false);
                var recognised = function (value) { return /Playerjs\s*\(|\brawVideo\s*=|\bfile\s*:/.test(value); };
                if (recognised(modern)) { code = modern; break; }
                if (recognised(legacy)) { code = legacy; break; }
            } catch (e) { /* not a recognised wrapper */ }
        }
        function decodeValue(value) {
            if (/^["']/.test(value)) return jsString(value);
            var call = value.match(/^([A-Za-z_$][\w$]*)\(\s*(["'])([A-Za-z0-9+/=]+)\2\s*\)$/);
            if (!call) return '';
            var escaped = call[1].replace(/[$]/g, '\\$');
            var body = code.match(new RegExp('function\\s+' + escaped + '\\s*\\(\\s*[A-Za-z_$][\\w$]*\\s*\\)\\s*\\{([^}]{1,4000})\\}'));
            var key = body && body[1].match(/(?:var|let|const)\s+\w+\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
            if (!key) return ''; // no borrowed/static fallback keys; only bytes carried by this page
            key = jsString(key[1]);
            if (!key || key.length > 1000) return '';
            try {
                key = unescape(encodeURIComponent(key));
                var encrypted = atob(call[3]), result = '';
                for (var j = 0; j < encrypted.length; j++) result += String.fromCharCode(encrypted.charCodeAt(j) ^ key.charCodeAt(j % key.length));
                return utf8(result);
            } catch (e) { return ''; }
        }
        // Read literal/call values in either old Playerjs fields or modern rawVideo/rawSubtitle variables.
        function field(name, variable) {
            var valuePattern = '("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|[A-Za-z_$][\\w$]*\\(\\s*(?:"[A-Za-z0-9+/=]+"|\'[A-Za-z0-9+/=]+\')\\s*\\))';
            var patterns = [new RegExp('\\b(?:var|let|const)\\s+' + variable + '\\s*=\\s*' + valuePattern),
                new RegExp('[,{]\\s*["\']?' + name + '["\']?\\s*:\\s*' + valuePattern)];
            for (var i = 0; i < patterns.length; i++) {
                var m = code.match(patterns[i]);
                if (m) { var value = decodeValue(m[1]); if (value) return value; }
            }
            return '';
        }
        var sources = moonSources(field('file', 'rawVideo'));
        if (!sources.length) return null;
        var host = new URL(sources[0].url).hostname, subtitles = [], seen = {};
        var caption = field('subtitle', 'rawSubtitle');
        [host, 'moonanime.net', 'moonanime.art'].forEach(function (domain) {
            subtitleList(caption, domain).forEach(function (item) { if (!seen[item.url]) { seen[item.url] = true; subtitles.push(item); } });
        });
        return {url: sources[0].url, quality: sources[0].quality, sources: sources, subtitles: subtitles};
    }
    function browserChallenge(value) {
        var text = String(value || '').slice(0, 200000);
        return /<title>\s*Just a moment|Enable JavaScript and cookies to continue|cf-chl-widget/i.test(text);
    }
    // Observe the actual TV player, rather than treating an HLS address as proof of playback.
    function watchMoonPlayback(work, report, onReady) {
        var listener = Lampa.PlayerVideo && Lampa.PlayerVideo.listener;
        if (!listener || !listener.follow || !listener.remove) return function () {};
        var ended = false;
        var prefix = work.anitube_moon === false ? 'AT-P' : 'AT-M';
        var timer = setTimeout(function () { fail(prefix + '4', 'Плеєр не почав відтворення за 25 секунд. Спробуй інший плеєр.'); }, 25000);
        function stop() {
            if (ended) return;
            ended = true; clearTimeout(timer);
            listener.remove('canplay', ready); listener.remove('timeupdate', progress); listener.remove('error', error);
            if (Lampa.Player.listener && Lampa.Player.listener.remove) Lampa.Player.listener.remove('destroy', stop);
        }
        function ready() { if (!ended) { stop(); report('', ''); if (onReady) onReady(); } }
        function progress(event) { if (event && Number(event.currentTime || event.time) > 0) ready(); }
        function fail(code, message) {
            if (ended) return;
            stop();
            var current = Lampa.Player.playdata && Lampa.Player.playdata();
            if (current && current.anitube_owner === work.anitube_owner && current.url === work.url && Lampa.Player.close) Lampa.Player.close();
            report(code, message);
        }
        function error(event) {
            if (!event || !event.fatal) return;
            var detail = String(event.error || event.details || '');
            var reason = /manifest/i.test(detail) ? 'Не завантажився список відеопотоку.' : 'Хостинг не віддав відео або його фрагмент.';
            fail(prefix + '3', reason + ' Спробуй інший плеєр.');
        }
        listener.follow('canplay', ready); listener.follow('timeupdate', progress); listener.follow('error', error);
        if (Lampa.Player.listener && Lampa.Player.listener.follow) Lampa.Player.listener.follow('destroy', stop);
        return stop;
    }

    function moonStreamFresh(entry) {
        if (!entry.streamAt || Date.now() - entry.streamAt > 120000) return false;
        try {
            var expires = Number(new URL(entry.stream).searchParams.get('expires'));
            return !expires || expires * 1000 > Date.now() + 30000;
        } catch (e) { return false; }
    }
    // Moon's segments need Accept and Accept-Language, which the browser sends and a TV's native player cannot be given.
    // Moon alone uses Lampa's own player with hls.js; the owner's settings return when that player closes.
    var MOON_PLAYER_SAVED = 'anitube_moon_player_saved';
    function restoreMoonPlayer() {
        var saved = String(Lampa.Storage.get(MOON_PLAYER_SAVED, '') || '').split('|');
        if (saved.length < 2) return;
        Lampa.Storage.set('player', saved[0], true);
        Lampa.Storage.set('player_hls_method', saved[1], true);
        if (saved[2]) Lampa.Storage.set('video_quality_default', saved[2], true);
        Lampa.Storage.set(MOON_PLAYER_SAVED, '', true);
    }
    function tvPlatform() { return !!(Lampa.Platform && (Lampa.Platform.is('tizen') || Lampa.Platform.is('webos'))); }
    function useMoonPlayer() {
        var listener = Lampa.Player.listener;
        if (!tvPlatform() || !listener || !listener.follow || !listener.remove) return;
        if (!Lampa.Storage.get(MOON_PLAYER_SAVED, '')) {
            Lampa.Storage.set(MOON_PLAYER_SAVED, [Lampa.Storage.field('player'), Lampa.Storage.field('player_hls_method'), Lampa.Storage.field('video_quality_default')].join('|'), true);
            listener.follow('destroy', function restore() {
                listener.remove('destroy', restore);
                restoreMoonPlayer();
            });
        }
        Lampa.Storage.set('player', 'inner', true);
        Lampa.Storage.set('player_hls_method', 'hlsjs', true);
        Lampa.Storage.set('video_quality_default', '1080', true);
    }
    function autoQualityEnabled() {
        var value = Lampa.Storage.field('anitube_auto_quality');
        return value !== false && value !== 'false';
    }
    // Moon starts at its highest quality. With the setting on, repeated or long stalls lower it one step.
    function watchMoonQuality() {
        var player = Lampa.PlayerVideo, listener = player && player.listener;
        if (!listener || !listener.follow || !listener.remove || !player.video) return function () {};
        var levels = [], video = null, timer = null, stalls = [], calm = 0, initialized = false, stopped = false;
        function showLevel(level) {
            var panel = Lampa.PlayerPanel;
            if (level && panel && panel.render) panel.render().find('.player-panel__quality').text(level.title || level.height + 'p');
        }
        function ordered() {
            return levels.slice().sort(function (a, b) { return (Number(b.height) || 0) - (Number(a.height) || 0); });
        }
        function clearStall() { clearTimeout(timer); timer = null; }
        function lower() {
            clearStall();
            stalls = [];
            calm = Date.now() + 30000;
            var list = ordered(), next = list[Math.max(0, list.findIndex(function (level) { return level.selected; })) + 1];
            if (!next) return;
            next.enabled = true;
            showLevel(next);
            Lampa.Noty.show('Погане з\'єднання, знижую якість' + (next.title ? ' до ' + next.title : ''), {time: 6000});
        }
        function waiting() {
            var now = Date.now();
            if (timer || now < calm || !video || video.seeking || !(video.currentTime > 3) || !autoQualityEnabled()) return;
            stalls = stalls.filter(function (time) { return now - time < 60000; });
            stalls.push(now);
            if (stalls.length >= 3) lower();
            else timer = setTimeout(lower, 6000);
        }
        function release() {
            if (!video) return;
            video.removeEventListener('waiting', waiting);
            video.removeEventListener('playing', clearStall);
            video = null;
        }
        function onLevels(event) {
            levels = (event && event.levels) || [];
            levels.forEach(function (level) { level.quality = level.title || level.height + 'p'; });
            var next = player.video();
            if (next !== video && next && next.addEventListener) {
                release();
                video = next;
                video.addEventListener('waiting', waiting);
                video.addEventListener('playing', clearStall);
            }
            var top = ordered()[0];
            if (top && !initialized) { top.enabled = true; initialized = true; }
            if (Lampa.PlayerPanel && Lampa.PlayerPanel.quality) Lampa.PlayerPanel.quality(levels, '');
            var selected = levels.filter(function (level) { return level.selected; })[0];
            showLevel(selected);
        }
        function stop() {
            if (stopped) return;
            stopped = true;
            clearStall();
            release();
            listener.remove('levels', onLevels);
            if (Lampa.Player.listener && Lampa.Player.listener.remove) Lampa.Player.listener.remove('destroy', stop);
        }
        listener.follow('levels', onLevels);
        if (Lampa.Player.listener && Lampa.Player.listener.follow) Lampa.Player.listener.follow('destroy', stop);
        return stop;
    }

    function moonFailure(xhr, viaProxy) {
        var status = xhr && xhr.status, upstream = 0;
        if (viaProxy && status === 424) {
            try {
                var data = JSON.parse(xhr.responseText || '{}');
                if (data.code === 'moon_relay_missing') return 'Moon: потрібно оновити хмарний помічник плеєра.';
                var message = data.error || '';
                upstream = Number((String(message).match(/HTTP (\d{3})/) || [])[1]) || 0;
            } catch (e) { /* keep the relay status */ }
        }
        if (viaProxy && status === 404) return 'Moon: у проксі немає маршруту /moon. Потрібне оновлення Worker.';
        if (viaProxy && status === 403) return 'Moon: проксі відмовив у доступі (HTTP 403). Перевір адресу та ключ проксі.';
        var code = upstream || status;
        return code ? 'Moon: не вдалося отримати сторінку плеєра (HTTP ' + code + '). Спробуй Ashdi або іншу серію.'
            : 'Moon: немає з’єднання з плеєром. Спробуй Ashdi або іншу серію.';
    }
    function moonStream(url, success, failure) {
        if (!moonPage(url)) return failure('некоректна адреса Moon');
        function read(html) {
            var config = moonConfig(html);
            if (!config) return failure(browserChallenge(html) ? 'Moon: хостинг вимагає перевірку браузера. Відеоплеєр телевізора її не проходить.' : 'Moon: сторінка не містить підтримуваної конфігурації відео. Спробуй Ashdi або іншу серію.');
            success(config.url, config.subtitles, config.quality);
        }
        function proxy() {
            $.ajax({url: homeUrl(homeProxy(), 'moon', 'url', url), dataType: 'text', timeout: 20000, success: read,
                error: function (xhr) { failure(moonFailure(xhr, true)); }});
        }
        if (window.Lampa && Lampa.Platform && Lampa.Platform.is('android')) {
            direct(url, {dataType: 'text', headers: {'Accept': '*/*'}}, read, function () { proxy(); });
        } else {
            $.ajax({url: url, dataType: 'text', timeout: 8000, success: read, error: proxy});
        }
    }

    // ---- Network: Lampa's native request on Android first, Netlify proxy as fallback -------------------------------
    // Address of the optional home-network helper (home-proxy/server.mjs) for TVs that cannot reach AniTube themselves.
    // The owner's own Cloudflare Worker, built in so nothing has to be typed on a TV. Anything entered in Settings -> AniTube wins.
    var DEFAULT_PROXY = 'https://anitube-proxy.dezmand39.workers.dev';
    var DEFAULT_KEY = '99380bc4907c37c189420da5965f614d';
    function customProxy() {
        var value = '';
        try { value = String((window.Lampa && Lampa.Storage && Lampa.Storage.field('anitube_proxy')) || '').trim().replace(/\/+$/, ''); } catch (e) {}
        return /^https?:\/\/\S+$/i.test(value) ? value : '';
    }
    function homeProxy() { return customProxy() || DEFAULT_PROXY; }
    // Secret for a helper that is reachable from the internet; sent as ?key=. A custom address uses the key typed with it.
    function homeKey() {
        var typed = '';
        try { typed = String((window.Lampa && Lampa.Storage && Lampa.Storage.field('anitube_proxy_key')) || '').trim(); } catch (e) {}
        return customProxy() ? typed : (typed || DEFAULT_KEY);
    }
    function homeUrl(home, action, name, value) {
        var key = homeKey();
        return home + '/' + action + '?' + name + '=' + encodeURIComponent(value) + (key ? '&key=' + encodeURIComponent(key) : '');
    }
    function proxyText(action, value, success, failure) {
        // Neither the helper nor the Netlify function caches anything; AniTube is fetched on demand.
        var home = homeProxy();
        var name = action === 'search' ? 'q' : 'url';
        var url = home ? homeUrl(home, action, name, value) : API + '?action=' + action + '&' + name + '=' + encodeURIComponent(value);
        $.ajax({url: url, dataType: 'text', timeout: 20000, cache: false, success: success, error: failure});
    }
    function proxyPlaylist(url, success, failure) {
        var home = homeProxy();
        $.ajax({url: home ? homeUrl(home, 'playlist', 'url', url) : API + '?action=playlist&url=' + encodeURIComponent(url), dataType: 'json', timeout: 25000, cache: false, success: success, error: failure});
    }
    function proxyEmbed(url, success, failure) {
        var home = homeProxy();
        if (!home) return failure('домашній проксі не налаштовано');
        $.ajax({url: homeUrl(home, 'embed', 'url', url), dataType: 'text', timeout: 20000, cache: false, success: success, error: failure});
    }
    function reason(e) {
        if (e && e.status) return 'HTTP ' + e.status;
        var raw = e && (e.responseText || e.message || e);
        if (raw && typeof raw === 'object') raw = JSON.stringify(raw);
        return String(raw || 'без відповіді').slice(0, 140);
    }
    // ---- Home box: an Android TV box in the same network (home-proxy/box-relay.mjs under Termux) ---------------------------
    // The sites that show their players only to visitors from Ukraine (uafix, DoramaUA) refuse the Cloudflare Worker, and a Smart TV
    // cannot read them itself. The box asks them from the home connection, which is an ordinary Ukrainian visitor.
    var BOX_PORT = 8787;
    var boxNote = '';
    function boxAddress() {
        var value = '';
        try { value = String((window.Lampa && Lampa.Storage && Lampa.Storage.field('anitube_box')) || '').trim().replace(/\/+$/, ''); } catch (e) {}
        if (!value) return '';
        if (!/^https?:\/\//i.test(value)) value = 'http://' + value;
        if (!/^https?:\/\/[^\/\s?#]+$/i.test(value)) return '';
        if (!/:\d+$/.test(value.replace(/^https?:\/\//i, ''))) value += ':' + BOX_PORT;
        return value;
    }
    function boxRequest(path, params, dataType, success, failure) {
        var base = boxAddress();
        if (!base) return failure(null);
        var query = Object.keys(params).filter(function (name) { return params[name] !== '' && params[name] != null; })
            .map(function (name) { return name + '=' + encodeURIComponent(params[name]); }).concat('key=' + encodeURIComponent(DEFAULT_KEY)).join('&');
        $.ajax({url: base + '/' + path + '?' + query, dataType: dataType, timeout: 25000, cache: false, success: success, error: failure});
    }
    // Why the box did not help, in words: its own explanation when it answered, otherwise a hint about the likely cause.
    function boxReason(xhr) {
        var base = boxAddress(), host = base.replace(/^https?:\/\//i, '');
        try {
            var said = xhr && xhr.responseText && JSON.parse(xhr.responseText).error;
            if (said) return 'приставка ' + host + ': ' + String(said).slice(0, 120);
        } catch (e) {}
        if (xhr && xhr.status) return 'приставка ' + host + ': HTTP ' + xhr.status;
        if (window.location && window.location.protocol === 'https:' && /^http:/i.test(base)) return 'приставка ' + host + ' недоступна: Lampa відкрита через https, тож браузер блокує http-адресу';
        return 'приставка ' + host + ' не відповідає: перевір, що вона ввімкнена, в тій самій Wi-Fi і ретранслятор запущено';
    }
    function boxCheck() {
        if (!boxAddress()) return Lampa.Noty.show('AniTube: адресу приставки не вказано (Налаштування → AniTube → Адреса приставки)', {time: 6000});
        boxRequest('check', {}, 'json', function (data) {
            var parts = ((data && data.results) || []).map(function (r) { return r.name + ': ' + (r.ok ? 'ок' : 'не працює (' + r.error + ')'); });
            Lampa.Noty.show('Приставка ' + boxAddress().replace(/^https?:\/\//i, '') + ' відповіла. ' + (parts.join('; ') || 'без деталей'), {time: 10000});
        }, function (xhr) { Lampa.Noty.show('AniTube: ' + boxReason(xhr), {time: 8000}); });
    }
    // Added to an error about a source that needs a Ukrainian address when the device can neither ask it itself nor use a box.
    function boxHint() {
        var android = !!(window.Lampa && Lampa.Platform && Lampa.Platform.is('android'));
        return boxAddress() || android ? '' : ' Без приставки UAflix можна дивитися через джерело UAFilms (чип «Джерело»).';
    }
    // The box is useful on a device with no native requests; Android Lampa asks the sites itself.
    function doramaAvailable() {
        return !!boxAddress() || !!(window.Lampa && Lampa.Platform && Lampa.Platform.is('android'));
    }

    // Lampa on Android can send native requests that are not limited by browser CORS rules.
    function direct(url, options, success, failure) {
        if (!(window.Lampa && Lampa.Platform && Lampa.Platform.is('android') && Lampa.Reguest)) return failure('не Android');
        var headers = {'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8', 'Referer': HOME};
        Object.keys(options.headers || {}).forEach(function (key) { headers[key] = options.headers[key]; });
        var params = {headers: headers, timeout: 20000};
        if (options.dataType) params.dataType = options.dataType;
        try {
            new Lampa.Reguest()['native'](url, success, failure, options.post, params);
        } catch (e) { failure(e); }
    }
    function attribute(tag, name) {
        var match = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\'])(.*?)\\1', 'i'));
        return match ? match[2] : '';
    }
    function directPlaylist(url, success, failure) {
        var article;
        try { article = new URL(url); } catch (e) { return failure('некоректна адреса'); }
        if (article.protocol !== 'https:' || article.hostname !== 'anitube.in.ua' || article.port || !/^\/\d+-[^/]+\.html$/.test(article.pathname)) return failure('некоректна адреса');
        direct(article.href, {dataType: 'text'}, function (html) {
            html = String(html);
            var container = html.match(/<[^<>]*\b(?:id|class)=["'][^"']*\bplaylists-ajax\b[^"']*["'][^<>]*>/i);
            var hash = html.match(/\bdle_login_hash\s*=\s*['"]([a-f\d]{16,128})['"]/i);
            if (!container || !hash) return failure('на сторінці немає плейлиста');
            var newsId = attribute(container[0], 'data-news_id'), xfield = attribute(container[0], 'data-xfname');
            if (!/^\d{1,10}$/.test(newsId) || !/^[a-z\d_]{1,80}$/i.test(xfield)) return failure('некоректні дані плейлиста');
            var body = 'news_id=' + newsId + '&xfield=' + xfield + '&user_hash=' + hash[1];
            direct(HOME + 'engine/ajax/playlists.php', {post: body, headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': article.href
            }}, function (data) {
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (e) { return failure('некоректний JSON'); }
                }
                if (data && data.success === true && typeof data.response === 'string') success(data);
                else failure('плейлист недоступний');
            }, failure);
        }, failure);
    }
    // Ashdi embed pages state their HLS URL in plain text; no provider script is run.
    function ashdiPage(value) {
        try {
            var page = new URL(value);
            return page.protocol === 'https:' && page.hostname === 'ashdi.vip' && !page.port && /^\/vod\/\d+$/.test(page.pathname);
        } catch (e) { return false; }
    }
    // Player pages list soft subtitles as subtitle:"[Українські]https://ashdi.vip/player/subtitle/297051_ua.vtt" (several separated by commas).
    // Only .vtt/.srt files on the player's own host are taken. The result is what Lampa's player expects: [{label, url}].
    function playerSubtitles(html, host) {
        var match = String(html).match(/\bsubtitle\s*:\s*(["'])(.*?)\1/);
        return match ? subtitleList(match[2], host) : [];
    }
    function subtitleList(value, host) {
        if (!value) return [];
        return String(value).split(',').map(function (part) {
            var item = part.match(/^\s*\[([^\]]+)\]\s*(https:\/\/\S+?)\s*$/);
            var address = item && absolute(item[2], 'https://' + host + '/');
            if (!address || new URL(address).hostname !== host || !/\.(vtt|srt)(?:[?#]|$)/i.test(address)) return null;
            return {label: item[1].trim(), url: address};
        }).filter(Boolean);
    }
    function ashdiMissing(html) { return String(html).indexOf('Файл не знайдено') !== -1; }
    function ashdiStream(url, success, failure) {
        function read(html, fail) {
            var match = String(html).match(/\bfile\s*:\s*(["'])(https:\/\/ashdi\.vip\/[^"']+?\.m3u8[^"']*)\1/i);
            var stream = match && absolute(match[2], url);
            if (stream && new URL(stream).hostname === 'ashdi.vip' && media(stream)) success(stream, playerSubtitles(html, 'ashdi.vip'));
            else if (String(html).indexOf('Змініть країну перегляду') !== -1) fail('Ashdi не пускає країну цього сервера');
            else if (ashdiMissing(html)) fail('Ashdi більше не має цього файлу');
            else fail('на сторінці плеєра немає посилання на відео');
        }
        direct(url, {dataType: 'text', headers: {'Referer': HOME}}, function (html) {
            read(html, failure);
        }, function (e) {
            proxyEmbed(url, function (html) { read(html, failure); }, function (xhr) {
                failure(homeProxy() ? failureText(xhr, reason(e)) : (e === 'не Android' ? 'на цьому пристрої потрібен домашній проксі (Налаштування → AniTube)' : e));
            });
        });
    }
    // Direct request first (Android Lampa, home IP); the Netlify proxy is only a fallback.
    function fetchText(action, value, success, failure) {
        var url = HOME + 'index.php?do=search&subaction=search&story=' + encodeURIComponent(value);
        direct(url, {dataType: 'text'}, function (html) {
            if (html && String(html).length) success(String(html));
            else proxyText(action, value, success, function (xhr) { failure(xhr, 'порожня відповідь'); });
        }, function (e) {
            proxyText(action, value, success, function (xhr) { failure(xhr, reason(e)); });
        });
    }
    function fetchPlaylist(url, success, failure) {
        directPlaylist(url, success, function (e) {
            proxyPlaylist(url, success, function (xhr) { failure(xhr, reason(e)); });
        });
    }
    // ---- Second source: uafix.net --------------------------------------------------------------------------------------
    // Same idea as AniTube: the site's own search page, a show page that lists its seasons and episodes, one page per episode
    // with a player (zetvideo.net or Ashdi) whose .m3u8 address is plain text. No player script is run.
    var UAFIX = 'https://uafix.net';
    function uafixPage(value, pattern) {
        try {
            var page = new URL(value);
            return page.protocol === 'https:' && page.hostname === 'uafix.net' && !page.port && !page.search && !page.hash && pattern.test(page.pathname);
        } catch (e) { return false; }
    }
    function uafixShow(value) { return uafixPage(value, /^\/[a-z-]+\/[a-z0-9-]+\/$/); }
    function uafixAnyPage(value) { return uafixPage(value, /^\/[a-z-]+\/[a-z0-9-]+\/(?:season-\d+-episode-\d+\/)?$/); }
    function uafixCatalog(html) {
        var seen = {};
        return list(page(html), 'a.sres-wrap').map(function (card) {
            var url = absolute(card.getAttribute('href'), UAFIX + '/');
            var title = text(card.querySelector('h2')).replace(/\s+/g, ' ').trim();
            if (!uafixShow(url) || !title || seen[url]) return null;
            seen[url] = true;
            return {title: title, url: url, note: 'UAflix'};
        }).filter(Boolean);
    }
    // {seasonNumber: [{number, url}]}; a page with no episode links (a film) becomes one "Фільм" entry.
    function uafixSeasons(html, show) {
        var seasons = {}, seen = {}, pattern = /href=["'](https:\/\/uafix\.net\/[a-z-]+\/[a-z0-9-]+\/season-(\d+)-episode-(\d+)\/)["']/gi, match;
        var base = new URL(show).pathname;
        while ((match = pattern.exec(html))) {
            if (seen[match[1]] || new URL(match[1]).pathname.indexOf(base) !== 0) continue;
            seen[match[1]] = true;
            var season = parseInt(match[2], 10);
            (seasons[season] = seasons[season] || []).push({number: parseInt(match[3], 10), url: match[1]});
        }
        Object.keys(seasons).forEach(function (season) { seasons[season].sort(function (a, b) { return a.number - b.number; }); });
        return seasons;
    }
    // Every player of an episode page in the site's order: "Плеєр 1" is the voice-over, "Плеєр 2 (Субтитри)" the original with subtitles.
    function uafixPlayers(html) {
        var found = [], pattern = /<iframe\b[^>]*\bsrc=["'](https:\/\/(?:zetvideo\.net|ashdi\.vip)\/vod\/\d+)["']/gi, match;
        while ((match = pattern.exec(String(html)))) if (found.indexOf(match[1]) < 0) found.push(match[1]);
        return found;
    }
    function uafixPlayer(html) { return uafixPlayers(html)[0] || ''; }
    function zetPage(value) {
        try {
            var page = new URL(value);
            return page.protocol === 'https:' && page.hostname === 'zetvideo.net' && !page.port && /^\/vod\/\d+$/.test(page.pathname);
        } catch (e) { return false; }
    }
    function proxyUafix(action, value, success, failure) {
        var type = action === 'episode' ? 'json' : 'text';
        function viaWorker(onError) {
            $.ajax({url: homeUrl(homeProxy(), 'uf/' + action, action === 'search' ? 'q' : 'url', value), dataType: type,
                timeout: 25000, cache: false, success: success, error: onError || failure});
        }
        // The home box goes first: it asks uafix from a Ukrainian address, which the Worker cannot.
        if (!boxAddress()) return viaWorker();
        var params = {};
        params[action === 'search' ? 'q' : 'url'] = value;
        boxRequest('uf/' + action, params, type, function (data) { boxNote = ''; success(data); }, function (xhr) {
            // The box's reason travels with the final failure itself (requests run side by side, so a shared variable would be overwritten).
            var note = boxNote = boxReason(xhr);
            viaWorker(function (xhr2, a, b) { try { xhr2.boxNote = note; } catch (e) {} failure(xhr2, a, b); });
        });
    }
    function uafixGet(action, value, success, failure) {
        if (action !== 'search' && !uafixAnyPage(value)) return failure(null, 'некоректна адреса');
        var url = action === 'search' ? UAFIX + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(value) : value;
        direct(url, {dataType: 'text', headers: {'Referer': UAFIX + '/'}}, function (html) { success(String(html)); }, function (e) {
            proxyUafix(action, value, success, function (xhr) { failure(xhr, reason(e)); });
        });
    }
    function uafixEpisodePlayer(url, success, failure) {
        if (!uafixAnyPage(url)) return failure('некоректна адреса');
        direct(url, {dataType: 'text', headers: {'Referer': UAFIX + '/'}}, function (html) {
            var players = uafixPlayers(html);
            if (players.length) success(players); else failure('на сторінці серії немає плеєра');
        }, function (e) {
            proxyUafix('episode', url, function (data) {
                // The home box lists every player; the Worker and the bot only the first.
                var players = uafixPlayers(((data && data.players) || (data && data.player ? [data.player] : [])).map(function (src) { return '<iframe src="' + src + '">'; }).join(''));
                if (players.length) success(players); else failure('на сторінці серії немає плеєра');
            }, function (xhr) {
                // Off Ukrainian addresses uafix shows only a trailer instead of the player, so the relay finds no player on the page.
                if (!boxNote && !(xhr && xhr.boxNote) && xhr && /player_missing/.test(String(xhr.responseText || ''))) return failure('uafix показує плеєр лише на українських адресах, через проксі серія недоступна.' + boxHint());
                failure(failureText(xhr, reason(e)));
            });
        });
    }
    // Which of a season's episodes have the voice-over ("Плеєр 1") and which the subtitles: {episodeUrl: {voice, subs}}. Four pages at a time; an episode
    // whose page cannot be read is left out of the answer and so stays in the list.
    var UAFIX_PROBE_MAX = 40;
    function uafixProbe(episodes, done) {
        var found = {}, next = 0, active = 0, finished = false;
        function finish() {
            if (finished) return;
            finished = true;
            try { if (window.anitube_debug) console.log('AniTube uafix probe', JSON.stringify(found)); } catch (e) {}
            done(found);
        }
        function pump() {
            while (active < 4 && next < episodes.length) (function (episode) {
                active++;
                function over() { if (--active === 0 && next >= episodes.length) finish(); else pump(); }
                uafixEpisodePlayer(episode.url, function (players) {
                    if (players.length > 1) { found[episode.url] = {voice: true, subs: true}; return over(); }
                    var one = players[0];
                    function seen(stream, subtitles) { found[episode.url] = (subtitles && subtitles.length) ? {voice: false, subs: true} : {voice: true, subs: false}; over(); }
                    if (zetPage(one)) zetStream(one, seen, over);
                    else if (ashdiPage(one)) ashdiStream(one, seen, over);
                    else over();
                }, function (why) {
                    // The page was read and carries no player at all (an episode listed before its release): not available in either voice.
                    if (/немає плеєра/.test(String(why))) found[episode.url] = {voice: false, subs: false};
                    over();
                });
            }(episodes[next++]));
            if (active === 0 && next >= episodes.length) finish();
        }
        setTimeout(finish, 25000); // never hold the screen for long: after that every episode stays listed
        pump();
    }
    function zetStream(url, success, failure) {
        function read(html) {
            var match = String(html).match(/\bfile\s*:\s*(["'])(https:\/\/zetvideo\.net\/[^"']+?\.m3u8[^"']*)\1/i);
            var stream = match && absolute(match[2], url);
            if (stream && new URL(stream).hostname === 'zetvideo.net' && media(stream)) success(stream, playerSubtitles(html, 'zetvideo.net'));
            else failure('на сторінці плеєра немає посилання на відео');
        }
        direct(url, {dataType: 'text', headers: {'Referer': UAFIX + '/'}}, read, function (e) {
            proxyUafix('embed', url, read, function (xhr) { failure(failureText(xhr, reason(e))); });
        });
    }
    // kind: 'voice' (Плеєр 1, the Ukrainian voice-over) or 'subs' (Плеєр 2, the original with Ukrainian subtitles). Some episodes only have the
    // subtitles player; it is told apart by the subtitle file its page carries.
    function uafixStream(episodeUrl, kind, success, failure) {
        uafixEpisodePlayer(episodeUrl, function (players) {
            var two = players.length > 1, player = two && kind === 'subs' ? players[1] : players[0];
            function done(stream, subtitles) {
                var withSubs = !!(subtitles && subtitles.length);
                if (!two && kind === 'voice' && withSubs) return failure('у цієї серії ще немає озвучення, лише субтитри: обери «Українські субтитри» у чипі «Озвучення»');
                if (!two && kind === 'subs' && !withSubs) return failure('у цієї серії немає окремого плеєра з субтитрами');
                success(stream, subtitles);
            }
            if (zetPage(player)) zetStream(player, done, failure);
            else if (ashdiPage(player)) ashdiStream(player, done, failure);
            else failure('плеєр не підтримується');
        }, failure);
    }

    // UA Serials uses a DLE catalogue and exposes episode HLS playlists in its public HDVB iframe.
    var UASERIALS = 'https://uaserials.my';
    function uaserialPage(value, player) {
        try {
            var url = new URL(value);
            return url.protocol === 'https:' && url.hostname === (player ? 'hdvbua.pro' : 'uaserials.my') && !url.port &&
                (player ? /^\/embed\/\d{1,10}\/[a-f\d]{6,64}$/i.test(url.pathname) : /^\/\d{1,8}-[a-z0-9-]+\.html$/i.test(url.pathname));
        } catch (e) { return false; }
    }
    // Keep a standalone X/Х/Ікс meaningful: the common scorer drops one-letter words.
    function uaserialHasX(value) {
        return /(?:^|[^a-zа-яіїєґ0-9])(?:x|х|ікс|икс)(?=$|[^a-zа-яіїєґ0-9])/i.test(String(value || ''));
    }
    function uaserialGet(action, value, success, failure) {
        if (action === 'search' && (!value || value.length > 200)) return failure(null, 'invalid_query');
        if (action !== 'search' && !uaserialPage(value, action === 'player')) return failure(null, 'invalid_page');
        function proxy() {
            var query = action === 'search' ? 'q=' + encodeURIComponent(value) : 'url=' + encodeURIComponent(value);
            $.ajax({url: homeProxy() + '/uaserials/' + action + '?' + query + (homeKey() ? '&key=' + encodeURIComponent(homeKey()) : ''), dataType: 'text', timeout: 20000, success: success, error: failure});
        }
        if (action !== 'player' && window.Lampa && Lampa.Platform && Lampa.Platform.is('android')) {
            var url = action === 'search' ? UASERIALS + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(value) : value;
            direct(url, {dataType: 'text'}, success, proxy);
        } else proxy();
    }
    function uaserialCatalog(html) {
        var doc = page(html), seen = {};
        return list(doc, '.short-item').map(function (card) {
            var link = card.querySelector('a[href]');
            if (!link) return null;
            var url = absolute(link.getAttribute('href'), UASERIALS);
            var poster = link.querySelector('img[alt]');
            var title = (text(card.querySelector('.th-title')) || (poster && poster.getAttribute('alt')) || '').replace(/\s+/g, ' ').trim();
            var original = text(card.querySelector('.th-title-oname'));
            if (!uaserialPage(url, false) || !title || seen[url]) return null;
            seen[url] = true;
            return {title: title, names: [title, original].filter(Boolean), url: url, note: text(card.querySelector('.short-label')), ref: {url: url}};
        }).filter(Boolean);
    }
    function uaserialMedia(url) {
        return /^https:\/\/(?:s\d+\.)?hdvbua\.pro\/[^\s]*\.m3u8(?:[?#]|$)/i.test(url || '');
    }
    function uaserialPlaylist(html) {
        var raw = String(html || ''), data;
        var direct = raw.match(/\bfile\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/i);
        if (!direct) return null;
        var movie = jsString(direct[1]);
        if (uaserialMedia(movie)) return {1: [{label: 'Відео', episodes: [{title: 'Фільм', url: movie}]}]};
        try { data = JSON.parse(movie); } catch (e) { return null; }
        if (!Array.isArray(data)) return null;
        data = data.filter(function (entry) { return entry && typeof entry === 'object'; });
        function episodes(folder) {
            return (Array.isArray(folder) ? folder : []).map(function (episode, index) {
                if (!episode) return null;
                var url = absolute(episode.file, UASERIALS);
                return uaserialMedia(url) ? {title: episode.title || 'Серія ' + (index + 1), url: url} : null;
            }).filter(Boolean);
        }
        function voices(folder) {
            var plain = episodes(folder);
            if (plain.length) return [{label: 'Відео', episodes: plain}];
            return (Array.isArray(folder) ? folder : []).map(function (voice) {
                if (!voice) return null;
                var list = episodes(voice.folder);
                return list.length ? {label: voice.title || 'Відео', episodes: list} : null;
            }).filter(Boolean);
        }
        // A film's top-level files are translations, not numbered seasons.
        var films = data.filter(function (entry) { return uaserialMedia(entry.file); });
        if (films.length === data.length && films.length) {
            return {1: films.map(function (entry) {
                return {label: entry.title || 'Відео', episodes: [{title: 'Фільм', url: entry.file}]};
            })};
        }
        // Only an explicit season label can create a season. Voice folders without it share season 1.
        var numbered = data.filter(function (entry) { return /сезон|season/i.test(entry.title || '') && seasonNumberIn(entry.title); });
        if (!numbered.length) {
            var unnumbered = voices(data);
            return unnumbered.length ? {1: unnumbered} : {};
        }
        var seasons = {};
        numbered.forEach(function (entry) {
            var number = seasonNumberIn(entry.title), list = voices(entry.folder);
            if (list.length) seasons[number] = (seasons[number] || []).concat(list);
        });
        return seasons;
    }

    // AnimeOn uses its own public API. The legacy aggregator below remains only for Makhno's TMDB mapping.
    var ANIMEON_API = 'https://bbe.lme.isroot.in/api/v2';
    // ---- UAFilms: a public catalogue (films.aartzz.pp.ua) that names, by the card's TMDB number, the players of one episode ------------
    // It is used only for that mapping: the Ashdi / zetvideo (UAflix) / Moon page is then read by the same code as everywhere else, and
    // the video comes straight from the hosting, not through UAFilms. Anonymous clients prove a small piece of work (SHA-256 with N
    // leading zeros), exactly as the catalogue's own Lampa client does; the token lives 14 minutes.
    var UAFILMS = 'https://films.aartzz.pp.ua';
    var SHA_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    // SHA-256 of an ASCII string as hex; plain ES5, because crypto.subtle is missing on older TVs and outside https pages.
    function sha256(text) {
        var bytes = [], i, j;
        for (i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 255);
        var bits = bytes.length * 8;
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) bytes.push(0);
        for (i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bits >>> (i * 8)) & 255);
        var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Array(64);
        for (i = 0; i < bytes.length; i += 64) {
            for (j = 0; j < 16; j++) w[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3];
            for (j = 16; j < 64; j++) {
                var a0 = w[j - 15], a1 = w[j - 2];
                var s0 = ((a0 >>> 7) | (a0 << 25)) ^ ((a0 >>> 18) | (a0 << 14)) ^ (a0 >>> 3);
                var s1 = ((a1 >>> 17) | (a1 << 15)) ^ ((a1 >>> 19) | (a1 << 13)) ^ (a1 >>> 10);
                w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
            }
            var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
            for (j = 0; j < 64; j++) {
                var t1 = (k + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + SHA_K[j] + w[j]) | 0;
                var t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
            h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
        }
        return h.map(function (v) { return ('00000000' + (v >>> 0).toString(16)).slice(-8); }).join('');
    }
    var uafilmsPow = null, uafilmsPowWaiting = null, uafilmsCache = {}, uafilmsPause = {until: 0, why: ''};
    function uafilmsToken(success, failure) {
        var now = Date.now();
        if (!uafilmsPow) { try { uafilmsPow = Lampa.Storage.get('anitube_uafilms_pow', '') || null; } catch (e) {} }
        if (uafilmsPow && uafilmsPow.token && uafilmsPow.exp > now + 30000) return success(uafilmsPow.token);
        if (uafilmsPowWaiting) return uafilmsPowWaiting.push([success, failure]);
        uafilmsPowWaiting = [[success, failure]];
        function done(token, why) {
            var waiting = uafilmsPowWaiting; uafilmsPowWaiting = null;
            if (token) {
                uafilmsPow = {token: token, exp: Date.now() + 840000};
                try { Lampa.Storage.set('anitube_uafilms_pow', uafilmsPow); } catch (e) {}
            }
            waiting.forEach(function (pair) { if (token) pair[0](token); else pair[1](why); });
        }
        $.ajax({url: UAFILMS + '/api/challenge', dataType: 'json', timeout: 15000, cache: false, success: function (task) {
            if (!task || !task.salt || !(task.difficulty >= 1 && task.difficulty <= 6)) return done('', 'UAFilms не дав завдання перевірки');
            var zeros = new Array(task.difficulty + 1).join('0'), nonce = 0, started = Date.now();
            (function step() {
                // Chunks keep the remote and the screen responsive while the TV counts.
                for (var stop = nonce + 3000; nonce < stop; nonce++) {
                    if (sha256(task.salt + ':' + nonce).indexOf(zeros) === 0) {
                        var answer = {salt: task.salt, nonce: nonce, timestamp: task.timestamp, signature: task.signature};
                        return $.ajax({url: UAFILMS + '/api/challenge/verify', type: 'POST', contentType: 'application/json', data: JSON.stringify(answer),
                            dataType: 'json', timeout: 15000, success: function (reply) {
                                done(reply && reply.success && reply.token ? reply.token : btoa(JSON.stringify(answer)));
                            }, error: function () { done(btoa(JSON.stringify(answer))); }});
                    }
                }
                if (Date.now() - started > 60000) return done('', 'перевірка UAFilms триває задовго');
                setTimeout(step, 0);
            })();
        }, error: function (xhr) { done('', 'UAFilms не відповів' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '')); }});
    }
    // Players of one episode (or of a film when season is 0). The answer is kept ten minutes.
    function uafilmsSources(tmdb, season, episode, success, failure, retried) {
        var path = season ? '/v1/tv/' + encodeURIComponent(tmdb) + '/seasons/' + season + '/episodes/' + episode : '/v1/movies/' + encodeURIComponent(tmdb);
        var cached = uafilmsCache[path];
        if (cached && cached.at > Date.now() - 600000) return success(cached.list);
        // After "too many requests" the catalogue bans the address for half an hour on repeat, so it is left alone meanwhile.
        if (uafilmsPause.until > Date.now()) return failure(uafilmsPause.why);
        uafilmsToken(function (token) {
            $.ajax({url: UAFILMS + path + '?platform=tv&pow_token=' + encodeURIComponent(token), dataType: 'json', timeout: 30000, cache: false,
                success: function (data) {
                    var list = uafilmsVariants(data);
                    uafilmsCache[path] = {at: Date.now(), list: list};
                    success(list);
                }, error: function (xhr) {
                    var answer = {};
                    try { answer = JSON.parse(xhr.responseText).error || {}; } catch (e) {}
                    if (answer.code === 'IP_TEMPORARILY_BANNED' || (xhr && xhr.status === 429)) {
                        var minutes = parseInt((String(answer.message || '').match(/(\d+)\s*хв/) || [])[1], 10) || 1;
                        uafilmsPause = {until: Date.now() + minutes * 60000, why: answer.code === 'IP_TEMPORARILY_BANNED'
                            ? 'UAFilms тимчасово заблокував цю адресу за часті запити, ще приблизно ' + minutes + ' хв'
                            : 'UAFilms просить зачекати хвилину між запитами, спробуй ще раз трохи згодом'};
                        return failure(uafilmsPause.why);
                    }
                    if (!retried && xhr && (xhr.status === 401 || xhr.status === 403)) {
                        uafilmsPow = null;
                        try { Lampa.Storage.set('anitube_uafilms_pow', ''); } catch (e) {}
                        return uafilmsSources(tmdb, season, episode, success, failure, true);
                    }
                    failure('UAFilms не відповів' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : ''));
                }});
        }, failure);
    }
    // Only players this plugin reads itself: Ashdi and zetvideo by number, Moon by its page. Tortuga/Fenix would mean playing
    // through the catalogue's own relay, so they are left out.
    function uafilmsVariants(data) {
        var seen = {};
        return ((data && data.sources) || []).map(function (s) {
            var provider = String((s.provider && s.provider.id) || ''), query = String(s.url || '').split('?')[1] || '', params = {}, page = '';
            query.split('&').forEach(function (pair) { var at = pair.indexOf('='); if (at > 0) params[pair.slice(0, at)] = decodeURIComponent(pair.slice(at + 1)); });
            if (provider === 'ashdi' && /^\d{1,10}$/.test(params.id || '')) page = 'https://ashdi.vip/vod/' + params.id;
            else if (provider === 'zetvideo' && /^\d{1,10}$/.test(params.id || '')) page = 'https://zetvideo.net/vod/' + params.id;
            else if (provider === 'moonanime' && moonPage(params.url || '')) page = params.url;
            if (!page) return null;
            var player = provider === 'zetvideo' ? 'UAflix' : provider === 'moonanime' ? 'Moon' : 'Ashdi';
            var studio = String((s.studio && s.studio.name) || '').replace(/\s+/g, ' ').trim();
            var generic = !studio || studio === 'Ashdi' || studio === 'ZetVideo' || studio === 'Плеєр';
            if (generic) studio = s.lang === 'en' ? 'Субтитри' : 'Озвучення';
            var label = generic && player === 'UAflix' ? 'UAflix' : studio + ' · ' + player, key = provider + '|' + studio;
            if (seen[key]) return null;
            seen[key] = true;
            return {key: key, label: label, player: player, page: page, subs: studio === 'Субтитри'};
        }).filter(Boolean).sort(function (a, b) { return a.subs - b.subs; }); // the Ukrainian voices first, the subtitled original after them
    }

    var SOURCE_NAMES = {anitube: 'AniTube', makhno: 'Makhno', uafilms: 'UAFilms', animeon: 'AnimeOn', uafix: 'UAflix', dorama: 'DoramaUA', uaserials: 'UA Serials', anilibria: 'AniLibria (рос.)'};
    function animeonCall(path, query, body, success, failure) {
        var url = ANIMEON_API + path;
        var settings = {url: url, dataType: 'json', timeout: 30000, cache: false, success: success, error: failure};
        if (body) {
            settings.type = 'POST';
            settings.contentType = 'application/json';
            settings.data = JSON.stringify(body);
        } else {
            settings.url = url + '?' + Object.keys(query).filter(function (k) { return query[k]; }).map(function (k) { return k + '=' + encodeURIComponent(query[k]); }).join('&');
        }
        $.ajax(settings);
    }
    // Read the site's public API directly on Android, through the owner's Worker on TVs.
    function animeonApi(action, params, success, failure) {
        var paths = {search: '/anime?search=' + encodeURIComponent(params.q || ''),
            translations: '/player/' + params.id + '/translations',
            episodes: '/player/' + params.id + '/episodes?take=100&skip=' + (params.skip || 0) + '&playerId=' + params.player + '&translationId=' + params.translation};
        function read(value) {
            try { value = typeof value === 'string' ? JSON.parse(value) : value; } catch (e) { return failure(null, 'invalid_json'); }
            success(value);
        }
        direct('https://animeon.club/api' + paths[action], {dataType: 'text', headers: {'Referer': '', 'Accept': 'application/json'}}, read, function () {
            var query = Object.keys(params).map(function (key) { return key + '=' + encodeURIComponent(params[key]); }).join('&');
            $.ajax({url: homeProxy() + '/animeon/' + action + '?' + query + '&key=' + encodeURIComponent(homeKey()), dataType: 'text', timeout: 20000, success: read,
                error: function (xhr) { failure(xhr, xhr && xhr.status === 404 ? 'онови Worker у Cloudflare для прямого AnimeOn' : 'AnimeOn не відповів'); }});
        });
    }
    function animeonCatalog(data) {
        return ((data && (data.results || data.result)) || []).filter(function (item) { return item && /^\d{1,10}$/.test(String(item.id)); }).map(function (item) {
            var title = String(item.titleUa || item.title || '').trim();
            return {title: title, names: [title, item.titleEn], url: 'animeon:' + item.id + ':1', year: String(item.year || (item.releaseDate || '').slice(0, 4)),
                note: item.titleEn || '', ref: {id: item.id, season: 1}};
        }).filter(function (item) { return !!item.title; });
    }
    function animeonLoadVoices(id, success, failure) {
        animeonApi('translations', {id: id}, function (data) {
            var jobs = [];
            (data.translations || []).forEach(function (item) {
                if (!item.translation) return;
                (item.player || []).filter(function (player) { return /ashdi/i.test(player.name); }).forEach(function (player) {
                    jobs.push({label: String(item.translation.name || 'Українська озвучка').replace(/\s*\|\s*/g, ' · ').trim(), player: 'Ashdi', episodes: [], translation: item.translation.id, playerId: player.id});
                });
            });
            if (!jobs.length) return success([]);
            var pending = jobs.length, failed = false;
            function fail(xhr, why) { if (!failed) { failed = true; failure(xhr, why); } }
            jobs.forEach(function (job) {
                function page(skip) {
                    animeonApi('episodes', {id: id, player: job.playerId, translation: job.translation, skip: skip}, function (data) {
                        if (failed) return;
                        var episodes = data.episodes || [], before = job.episodes.length;
                        episodes.forEach(function (episode) {
                            if (!/^\d{1,10}$/.test(String(episode.id)) || !Number.isFinite(Number(episode.episode))) return;
                            if (job.episodes.some(function (entry) { return entry.ref.episode_id === episode.id; })) return;
                            job.episodes.push({title: Number(episode.episode) === 0 ? 'Спецвипуск 0' : 'Серія ' + episode.episode,
                                url: 'animeon:' + episode.id, ref: {episode_id: episode.id}, subtitles: true});
                        });
                        if (data.pagination && data.pagination.hasMore && episodes.length) {
                            if (before === job.episodes.length) return fail(null, 'AnimeOn повторив сторінку серій');
                            if (skip >= 20000) return fail(null, 'завеликий список серій');
                            return page(skip + episodes.length);
                        }
                        if (--pending === 0) success(jobs.filter(function (voice) { return voice.episodes.length; }));
                    }, fail);
                }
                page(0);
            });
        }, failure);
    }
    // AnimeOn's own API names the episode's Ashdi page. It has no CORS, so a TV asks through the owner's Worker.
    function animeonPlayerPage(id, success, failure) {
        function read(text) {
            var page = '';
            try {
                var address = new URL(JSON.parse(text).videoUrl);
                page = address.origin + address.pathname;
            } catch (e) {}
            if (ashdiPage(page)) success(page);
            else failure('AnimeOn не дав адресу плеєра');
        }
        function proxy() {
            var home = homeProxy();
            if (!home) return failure('домашній проксі не налаштовано');
            $.ajax({url: homeUrl(home, 'animeon', 'id', id), dataType: 'text', timeout: 20000, cache: false, success: read, error: function (xhr) {
                failure(xhr && xhr.status === 404 ? 'потрібно оновити Worker у Cloudflare' : 'AnimeOn не відповів');
            }});
        }
        direct('https://animeon.club/api/player/' + id + '/episode', {dataType: 'text'}, read, proxy);
    }
    function animeonStream(ref, wantSubtitles, success, failure) {
        animeonPlayerPage(ref.episode_id, function (page) {
            ashdiStream(page, function (stream, subtitles) { success(stream, wantSubtitles ? subtitles || [] : []); }, failure);
        }, failure);
    }

    // ---- Fourth source: Makhno = Ashdi's own catalogue, found by the card's TMDB number ----------------------------------
    // The aggregator behind "Bandera Online" only tells which Ashdi page belongs to a TMDB/IMDb number. The page itself
    // (ashdi.vip/serial/<id>) lists every voice with seasons and episodes as plain JSON, and is read here like the player pages.
    function ashdiCatalogPage(value) {
        try {
            var page = new URL(value);
            return page.protocol === 'https:' && page.hostname === 'ashdi.vip' && !page.port && /^\/(?:serial|vod)\/\d+$/.test(page.pathname);
        } catch (e) { return false; }
    }
    function ashdiHtml(url, success, failure) {
        function done(html) {
            if (String(html).indexOf('Змініть країну перегляду') !== -1) failure('Ashdi не пускає країну цього сервера');
            else success(String(html));
        }
        direct(url, {dataType: 'text', headers: {'Referer': HOME}}, done, function (e) {
            proxyEmbed(url, done, function (xhr) {
                failure(homeProxy() ? failureText(xhr, reason(e)) : (e === 'не Android' ? 'на цьому пристрої потрібен домашній проксі (Налаштування → AniTube)' : e));
            });
        });
    }
    function ashdiPlaylist(html) {
        var match = String(html).match(/\bfile\s*:\s*'(\[[\s\S]*?\])'\s*[,}]/);
        if (!match) return [];
        try {
            var data = JSON.parse(match[1]);
            return Array.isArray(data) ? data : [];
        } catch (e) { return []; }
    }
    // voices -> seasons -> episodes becomes {seasonNumber: [{label, episodes: [{title, url, subs}]}]}
    function makhnoSeasons(data) {
        var seasons = {};
        function episodesOf(items) {
            return (items || []).filter(function (e) { return e && e.file && media(String(e.file)); }).map(function (e) {
                return {title: String(e.title || '').trim(), url: String(e.file), subs: subtitleList(e.subtitle, 'ashdi.vip')};
            });
        }
        function add(number, label, episodes) {
            var voices = seasons[number] = seasons[number] || [];
            if (episodes.length && !voices.some(function (v) { return v.label === label; })) voices.push({label: label, episodes: episodes});
        }
        data.forEach(function (voice) {
            var label = String(voice.title || '').replace(/\s*\|\s*/g, ' · ').replace(/\s+/g, ' ').trim() || 'Ashdi';
            var children = voice.folder || [];
            if (children.length && children[0].file) return add(1, label, episodesOf(children)); // no season level
            children.forEach(function (folder, index) {
                var number = parseInt((String(folder.title || '').match(/\d+/) || [])[0], 10) || index + 1;
                add(number, label, episodesOf(folder.folder));
            });
        });
        Object.keys(seasons).forEach(function (number) { if (!seasons[number].length) delete seasons[number]; });
        return seasons;
    }
    // ---- Fifth source: DoramaUA (doramaua.tv) --------------------------------------------------------------------------
    // Its API (api.doramaua.tv) is open to any site. The player page of a show (w.davidog.top/<id>) lists every season, episode and voice
    // as plain JSON, and states the stream address and the subtitle file in plain text, like Ashdi's pages; no script of it is run.
    // That page is only readable from a Ukrainian address: Android Lampa asks for it itself, a Smart TV asks the home box.
    var DORAMA_API = 'https://api.doramaua.tv/api/v2';
    var DORAMA_PLAYER = 'https://w.davidog.top';
    var DORAMA_REGION = /не доступно в вашем регионе|Змініть країну перегляду/i;
    function doramaApi(path, success, failure) {
        $.ajax({url: DORAMA_API + path, dataType: 'json', timeout: 20000, cache: false, success: success, error: failure});
    }
    function doramaCatalog(data) {
        var seen = {};
        return ((data && data.serials) || []).map(function (entry) {
            if (!entry || !/^[a-z0-9-]{1,120}$/i.test(String(entry.slug || '')) || seen[entry.slug]) return null;
            seen[entry.slug] = true;
            var title = String(entry.name || '').replace(/\s+/g, ' ').trim();
            if (!title) return null;
            var year = String(entry.start_year || '');
            var count = entry.last_episode && entry.episodes_all ? entry.last_episode + ' з ' + entry.episodes_all + ' сер.' : (entry.episodes_all ? entry.episodes_all + ' сер.' : '');
            return {title: title, names: [title, entry.original_name], url: 'dorama:' + entry.slug, note: [year, entry.countries, count].filter(Boolean).join(' · '), year: year, ref: {slug: entry.slug}};
        }).filter(Boolean);
    }
    // One request per player page: Android Lampa asks the site itself, otherwise the home box does.
    function doramaPlayerPage(ref, success, failure) {
        var url = DORAMA_PLAYER + '/' + ref.id + '?ep=' + ref.ep + (ref.track ? '&track=' + ref.track : '');
        function done(html) {
            html = String(html);
            if (DORAMA_REGION.test(html) && html.indexOf('data-config') === -1) failure('сайт не пускає цю адресу (повідомлення про регіон)');
            else success(html);
        }
        direct(url, {dataType: 'text', headers: {'Referer': ''}}, done, function (e) {
            if (!boxAddress()) return failure(e === 'не Android' ? 'на цьому пристрої потрібна приставка (Налаштування → AniTube → Адреса приставки)' : reason(e));
            boxRequest('dorama/player', {id: ref.id, ep: ref.ep, track: ref.track}, 'text', function (html) { boxNote = ''; done(html); }, function (xhr) { boxNote = boxReason(xhr); failure(boxNote); });
        });
    }
    // The playlist is the text inside <div id="inputData">: {"<season>": {"<episode>": [{voice_name, voice_id, ...}]}}.
    function doramaPlaylist(html) {
        var start = String(html).indexOf('id="inputData"');
        if (start < 0) return null;
        var open = html.indexOf('>', start), close = html.indexOf('</div>', open);
        if (open < 0 || close < 0) return null;
        try { return JSON.parse(html.slice(open + 1, close).trim()); } catch (e) { return null; }
    }
    // {seasonNumber: [{label, episodes: [{title, url, ref}]}]}. Ukrainian voice-over first, then subtitles; other studios are Russian
    // voice-overs and only appear when the Russian sources are switched on.
    function doramaSeasons(playlist, id) {
        var seasons = {};
        Object.keys(playlist || {}).forEach(function (seasonKey) {
            var byVoice = {}, order = [], episodes = playlist[seasonKey] || {};
            Object.keys(episodes).map(Number).filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; }).forEach(function (number) {
                (episodes[number] || []).forEach(function (entry) {
                    var name = String((entry && entry.voice_name) || '').replace(/\s+/g, ' ').trim();
                    if (!name || !/^\d{1,6}$/.test(String(entry.voice_id)) || /^Превью|^Автосабы/i.test(name)) return;
                    var kind = /\(UA\)|українськ/i.test(name) && !/^Субтитр/i.test(name) ? 0 : /^Субтитр/i.test(name) ? 1 : 2;
                    if (kind === 2 && !russianEnabled()) return;
                    var voice = byVoice[name];
                    if (!voice) { voice = byVoice[name] = {label: kind === 1 ? 'Субтитри (укр.)' : kind === 2 ? name + ' (рос.)' : name, kind: kind, index: order.length, episodes: []}; order.push(name); }
                    voice.episodes.push({title: 'Серія ' + number, url: 'dorama:' + id + ':' + number + ':' + entry.voice_id, ref: {id: id, ep: number, track: entry.voice_id}});
                });
            });
            var voices = order.map(function (name) { return byVoice[name]; }).sort(function (a, b) { return (a.kind - b.kind) || (a.index - b.index); });
            if (voices.length) seasons[parseInt(seasonKey, 10) || 1] = voices;
        });
        return seasons;
    }
    // The stream address sits in data-config='{"hls":"https://s1.davidog.top/..."}'; the Ukrainian subtitle file in data-ua_subtitle.
    function doramaStream(ref, success, failure) {
        doramaPlayerPage(ref, function (html) {
            var config = String(html).match(/data-config='(\{[^']*\})'/), stream = '';
            try { stream = absolute(JSON.parse(config[1]).hls, DORAMA_PLAYER + '/'); } catch (e) {}
            var host = stream && new URL(stream).hostname;
            if (!(stream && /(^|\.)davidog\.top$/i.test(host) && media(stream))) return failure('на сторінці плеєра немає посилання на відео');
            var subtitles = [];
            [['ua', 'Українські'], ['ru', 'Російські']].forEach(function (pair) {
                var match = String(html).match(new RegExp('data-' + pair[0] + '_subtitle="([^"]*)"'));
                var url = match && absolute(match[1], DORAMA_PLAYER + '/');
                if (url && new URL(url).hostname === 'w.davidog.top' && /\.(vtt|srt)$/i.test(new URL(url).pathname) && (pair[0] === 'ua' || russianEnabled())) subtitles.push({label: pair[1], url: url});
            });
            success(stream, subtitles);
        }, failure);
    }

    // Other names of the card from TMDB (Ukrainian, English): a card shown with its Japanese name can still be found.
    function tmdbTitles(movie, done) {
        var finished = false;
        function finish(list) { if (!finished) { finished = true; done(list || []); } }
        setTimeout(function () { finish([]); }, 4000);
        try {
            if (!(movie && movie.id && window.Lampa && Lampa.TMDB && Lampa.TMDB.api && Lampa.Reguest)) return finish([]);
            var kind = (movie.name || movie.number_of_seasons || movie.first_air_date) ? 'tv' : 'movie';
            new Lampa.Reguest().silent(Lampa.TMDB.api(kind + '/' + movie.id + '/translations?api_key=' + Lampa.TMDB.key()), function (data) {
                var found = {};
                ((data && data.translations) || []).forEach(function (entry) {
                    var name = entry && entry.data && (entry.data.name || entry.data.title);
                    if (name && /^(uk|en)$/.test(entry.iso_639_1)) found[entry.iso_639_1] = String(name);
                });
                finish([found.uk, found.en].filter(Boolean));
            }, function () { finish([]); });
        } catch (e) { finish([]); }
    }
    // Names written in Japanese/Chinese/Korean letters rarely match anything, so they are tried last.
    function orderTerms(terms) {
        var cjk = /[぀-ヿ㐀-鿿가-힯]/;
        return terms.filter(function (t) { return !cjk.test(t); }).concat(terms.filter(function (t) { return cjk.test(t); }));
    }

    // ---- Fifth source: AniLibria (anilibria.top): anime with a Russian voice-over, a higher bitrate than Ashdi --------------
    // The site's own public API (open to any origin). Every season is a separate release, so releases are listed like AniTube's pages.
    var ANILIBRIA_API = 'https://anilibria.top/api/v1';
    function anilibriaCall(path, success, failure) {
        $.ajax({url: ANILIBRIA_API + path, dataType: 'json', timeout: 25000, cache: false, success: success, error: failure});
    }
    // AniLibria's search is fuzzy: it returns releases that merely share a letter or a short word with the query, and it
    // names anime by their romaji ("Sousou no Frieren"). So several words of the card's names are searched and every release
    // is kept only when its own names really share a distinctive word with the card's.
    var WORD_STOP = {the: 1, and: 1, of: 1, season: 1, movie: 1, story: 1, part: 1, special: 1, film: 1, that: 1, with: 1, from: 1, into: 1, your: 1};
    function nameWords(value) {
        var folded = String(value || '').toLowerCase().replace(/[іїє]/g, function (c) { return c === 'і' || c === 'ї' ? 'и' : 'е'; }).replace(/ґ/g, 'г').replace(/ё/g, 'е').replace(/ы/g, 'и');
        // each word once, and no bare numbers (a year like "(2011)" in a title must not count as a shared word)
        return unique(folded.split(/[^a-zа-я0-9]+/).filter(function (w) { return w.length >= 4 && !WORD_STOP[w] && !/^\d+$/.test(w); }));
    }
    function sameWord(a, b) {
        if (a === b) return true;
        // the same word with a different ending ("титанів" ~ "титанов"), not a longer word that merely starts the same way
        return a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 2 && a.slice(0, 5) === b.slice(0, 5);
    }
    // A candidate (its list of names) is compared name by name with each of the card's names (`cards` is a list of word lists). They must
    // share at least half of the words on BOTH sides, and either two words or one very long word; a card with a one-word name also
    // accepts a short candidate that has the word ("Naruto" ~ "Naruto: Shippuuden"). One word of a long title ("knight", "tsuihou") is a
    // coincidence, not a match. Returns 0 for "not this one"; a full match of two words scores 12.
    function titleScore(values, cards) {
        var best = 0;
        values.forEach(function (value) {
            var own = nameWords(value);
            if (!own.length) return;
            cards.forEach(function (card) {
                var shared = card.filter(function (w) { return own.some(function (o) { return sameWord(o, w); }); });
                if (!shared.length) return;
                var cardCoverage = shared.length / card.length, ownCoverage = shared.length / own.length;
                var ok = (cardCoverage >= 0.5 && ownCoverage >= 0.5 && (shared.length >= 2 || shared[0].length >= 8)) ||
                    (card.length === 1 && shared[0].length >= 5 && own.length <= 4);
                if (ok) best = Math.max(best, Math.min(cardCoverage, ownCoverage) * 10 + shared.length);
                // One name entirely inside the other (the card's "Вигнаний важкоозброєний лицар" in a longer title with a subtitle) is a strong match too.
                if ((shared.length === card.length && card.length >= 2) || (shared.length === own.length && own.length >= 2)) best = Math.max(best, 9 + shared.length);
            });
        });
        return best;
    }
    function anilibriaScore(release, cards) {
        var name = release.name || {};
        return titleScore([name.main, name.english, name.alternative], cards);
    }
    // "2 сезон", "Season 2", "2nd Season", "... II", "... 2" at the end of a name -> 2; 0 when the name says nothing about a season.
    function seasonNumberIn(value) {
        var text = String(value || ''), m;
        if ((m = text.match(/(\d+)\s*-?(?:й|ий)?\s*(?:сезон|season)|(?:сезон|season)\s*(\d+)/i))) return parseInt(m[1] || m[2], 10);
        if ((m = text.match(/(\d+)(?:st|nd|rd|th)\s+season/i))) return parseInt(m[1], 10);
        if ((m = text.match(/\s(II|III|IV|V|VI)\s*$/))) return {II: 2, III: 3, IV: 4, V: 5, VI: 6}[m[1]];
        if ((m = text.match(/\s(\d{1,2})\s*$/)) && parseInt(m[1], 10) < 13) return parseInt(m[1], 10);
        return 0;
    }
    // Words of a title without its season marker ("... 2", "2 сезон", "... II"): releases that share them belong to one show.
    function baseWords(result) {
        var text = String(result.title || '').replace(/(\d+)\s*-?(?:й|ий)?\s*(?:сезон|season)|(?:сезон|season)\s*\d+|\s(?:II|III|IV|V|VI)\s*$|\s\d{1,2}\s*$/gi, ' ');
        return nameWords(text);
    }
    function sameFranchise(a, b) {
        var x = baseWords(a), y = baseWords(b);
        if (!x.length || !y.length) return false;
        var shared = x.filter(function (w) { return y.some(function (o) { return sameWord(o, w); }); });
        // most of the words of BOTH titles are shared, so a long title that merely contains the other's words is not the same show
        return shared.length >= 1 && shared.length / Math.max(x.length, y.length) >= 0.6;
    }
    function anilibriaCatalog(data) {
        return (Array.isArray(data) ? data : []).map(function (release) {
            var name = (release && release.name) || {};
            var title = String(name.main || name.english || '').replace(/\s+/g, ' ').trim();
            if (!release || !/^\d{1,8}$/.test(String(release.id)) || !title) return null;
            var year = release.year ? String(release.year) : '';
            return {title: title, names: [name.main, name.english, name.alternative], url: 'anilibria:' + release.id, note: [year, name.english].filter(Boolean).join(' · '), year: year, ref: {id: release.id}};
        }).filter(Boolean);
    }
    // Only HLS addresses on the site's own video hosts are taken; 1080p when the release has it.
    function anilibriaVoices(data) {
        var episodes = ((data && data.episodes) || []).map(function (e) {
            var url = e && (e.hls_1080 || e.hls_720 || e.hls_480);
            var ok = false;
            try { ok = !!url && media(String(url)) && /(^|\.)(libria\.fun|anilibria\.(top|tv))$/.test(new URL(url).hostname); } catch (x) {}
            return ok ? {title: 'Серія ' + e.ordinal, url: String(url), quality: e.hls_1080 === url ? 1080 : e.hls_720 === url ? 720 : 480} : null;
        }).filter(Boolean);
        return episodes.length ? [{label: 'Російська озвучка', episodes: episodes}] : [];
    }

    // A green round play icon drawn as SVG: the earlier green-circle emoji shows as an empty box on TVs whose font has no emoji.
    var ICON = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#2ecc71"></circle><path d="M9.6 7.6v8.8l7.2-4.4z" fill="#ffffff"></path></svg>';
    var CHEVRON = '<svg class="atp-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"></path></svg>';
    var CHECK = '<svg class="atp-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="m2 8 4 4 8-8" fill="none" stroke="currentColor" stroke-width="2"></path></svg>';
    // Sources with a Russian voice-over are hidden until Settings -> AniTube -> "Показувати російські джерела" is switched on.
    var RUSSIAN_SOURCES = {anilibria: true};
    function russianEnabled() {
        try {
            var value = Lampa.Storage.field('anitube_russian');
            return value === true || value === 'true';
        } catch (e) { return false; }
    }
    function sourceAllowed(name) {
        if (name === 'dorama' && !doramaAvailable()) return false; // its player page is readable only from the box or Android Lampa
        return !RUSSIAN_SOURCES[name] || russianEnabled();
    }

    // A card that only has a Japanese name: AniList (public, free, open to any origin) turns it into the romaji and English titles, which
    // is how AniLibria and most Latin-script catalogues name anime. The hit must have the same native title, or the same year.
    function anilistTitles(movie, done) {
        var finished = false;
        function finish(list) { if (!finished) { finished = true; done(list || []); } }
        setTimeout(function () { finish([]); }, 4500);
        try {
            var original = String(movie.original_name || movie.original_title || '');
            if (!/[぀-ヿ㐀-鿿]/.test(original)) return finish([]);
            var year = parseInt(String(movie.first_air_date || movie.release_date || '').slice(0, 4), 10) || 0;
            var flat = function (value) { return String(value || '').replace(/[\s　・!！?？~～\-]+/g, ''); };
            $.ajax({
                url: 'https://graphql.anilist.co', type: 'POST', contentType: 'application/json', dataType: 'json', timeout: 4000, cache: false,
                data: JSON.stringify({query: 'query($s:String){Page(perPage:5){media(search:$s,type:ANIME,sort:SEARCH_MATCH){seasonYear title{romaji english native}}}}', variables: {s: original}}),
                success: function (data) {
                    var list = (data && data.data && data.data.Page && data.data.Page.media) || [];
                    var hit = list.filter(function (m) { return m && m.title && flat(m.title.native) === flat(original); })[0] ||
                        (list[0] && year && Math.abs((list[0].seasonYear || 0) - year) <= 1 ? list[0] : null);
                    finish(hit ? [hit.title.romaji, hit.title.english].filter(Boolean) : []);
                },
                error: function () { finish([]); }
            });
        } catch (e) { finish([]); }
    }

    function failureText(xhr, directReason) {
        var home = homeProxy();
        var status = xhr && xhr.status ? 'проксі: HTTP ' + xhr.status : 'проксі: помилка мережі';
        // The helper explains upstream failures in its JSON body (e.g. {"error": "HTTP 403"} when AniTube refuses its address).
        try {
            var said = xhr && xhr.responseText && JSON.parse(xhr.responseText).error;
            if (said) status += ' – ' + String(said).slice(0, 80);
        } catch (e) {}
        var hint = '';
        if (!home && !(window.Lampa && Lampa.Platform && Lampa.Platform.is('android'))) hint = ' На цьому пристрої потрібен домашній проксі: Налаштування → AniTube.';
        else if (home && /^http:/i.test(home) && window.location && window.location.protocol === 'https:') hint = ' Lampa відкрита через https, тож браузер блокує http-проксі.';
        var note = (xhr && xhr.boxNote) || boxNote;
        return '(' + (note ? note + '; ' : '') + 'напряму: ' + directReason + '; ' + status + ')' + hint;
    }

    // ---- Names ---------------------------------------------------------------------------------------------------
    function unique(values) { return values.filter(function (v, i) { return v && values.indexOf(v) === i; }); }
    // Names to search for, best first. Card titles can be whole sentences (the helpers refuse queries over 200 characters and
    // AniTube's search finds nothing for them anyway), so a long title is cut to its first words and only that is tried.
    function searchTerms(movie) {
        var terms = [];
        [movie.title, movie.original_title, movie.name, movie.original_name].forEach(function (name) {
            var clean = shortName(name);
            if (clean) terms.push(clean);
        });
        return unique(terms);
    }
    function shortName(value) {
        var clean = String(value || '').replace(/\s+/g, ' ').trim();
        if (clean.length > 60) {
            var words = clean.split(' ');
            clean = words.slice(0, 5).join(' ');
            if (clean.length > 60) clean = clean.slice(0, 60).replace(/\s+\S*$/, '');
        }
        return clean;
    }
    // The card's other names that Lampa already carries from TMDB (English, romaji, other languages), best countries first.
    function alternativeNames(movie) {
        var data = movie && movie.alternative_titles;
        var list = (data && (data.titles || data.results)) || [];
        var rank = {US: 0, GB: 0, JP: 1};
        return list.filter(function (entry) { return entry && entry.title; }).map(function (entry, index) {
            var country = String(entry.iso_3166_1 || '').toUpperCase();
            return {title: String(entry.title), order: (rank.hasOwnProperty(country) ? rank[country] : 2) * 1000 + index};
        }).sort(function (x, y) { return x.order - y.order; }).map(function (entry) { return entry.title; });
    }
    // Names grouped by script, searched in this order and never all at once: [0] Ukrainian/Russian, [1] English/romaji, [2] Japanese etc.
    // A source tries the first group, and only when that finds nothing moves to the next one.
    function nameTiers(movie, extra) {
        var tiers = [[], [], []], seen = {}, caps = [4, 5, 1];
        [movie.title, movie.name, movie.original_title, movie.original_name].concat(extra || [], alternativeNames(movie)).forEach(function (raw) {
            var name = shortName(raw), key = name.toLowerCase();
            if (!name || seen[key]) return;
            seen[key] = true;
            var tier = /[а-яіїєґё]/i.test(name) ? 0 : /[a-z]/i.test(name) ? 1 : 2;
            if (tiers[tier].length < caps[tier]) tiers[tier].push(name);
        });
        return tiers;
    }
    // Every name of the card in full (no five-word cut), without repeats; what a candidate's names are compared with.
    function fullNames(movie, extra) {
        var seen = {}, out = [];
        [movie.title, movie.name, movie.original_title, movie.original_name].concat(extra || [], alternativeNames(movie)).forEach(function (raw) {
            var name = String(raw || '').replace(/\s+/g, ' ').trim(), low = name.toLowerCase();
            if (name && !seen[low]) { seen[low] = true; out.push(name); }
        });
        return out;
    }
    function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/g, ' ').trim(); }
    // Of the names a site strings together ("A / B / C"), the one to show: the card's own title if it is there, otherwise the Ukrainian name
    // that shares the most words with it, otherwise the first.
    function pickName(parts, shown) {
        var target = normalize(shown);
        var same = parts.filter(function (part) { return normalize(part) === target; })[0];
        if (same) return same;
        var wanted = nameWords(shown), best = parts[0], bestScore = -1;
        parts.forEach(function (part) {
            var own = nameWords(part);
            var shared = wanted.filter(function (w) { return own.some(function (o) { return sameWord(o, w); }); }).length;
            var score = shared * 10 + (/[а-яіїєґё]/i.test(part) ? 5 : 0) - (/\//.test(part) ? 1 : 0);
            if (score > bestScore) { best = part; bestScore = score; }
        });
        return best;
    }
    function sentence(value) {
        var low = String(value || '').toLowerCase();
        return low.charAt(0).toUpperCase() + low.slice(1);
    }
    // A team's default player: Moon when it has at least Ashdi's episodes, then Ashdi, then the first that works.
    function preferredVoice(voices, label) {
        var team = voices.filter(function (v) { return v.label === label && v.supported !== false; });
        var ashdi = team.filter(function (v) { return v.player === 'Ashdi'; })[0];
        var moon = team.filter(function (v) { return v.player === 'Moon'; })[0];
        var best = moon && (!ashdi || moon.episodes.length >= ashdi.episodes.length) ? moon : ashdi || team[0];
        return voices.indexOf(best);
    }
    // "ОЗВУЧЕННЯ" + "QTV" -> "Озвучення · QTV"
    function voiceLabel(source) { return sentence(source.mode) + (source.variant ? ' · ' + source.variant : ''); }
    // Preserve meaningful source titles; replace a generic film label with the selected title for display only.
    // The number is also used as the watch-progress key, so it is read from the title only (stream file names do not match AniTube's numbering).
    function episodeInfo(raw, filmTitle) {
        var title = String(raw || '').replace(/\s+/g, ' ').trim();
        var plain = title.match(/^(?:серія\s*)?(\d+)\s*(?:серія|серії|серій|епізод|ep\.?|episode)?$/i);
        var number = plain ? parseInt(plain[1], 10) : 0;
        var label = plain ? 'Серія ' + number : title;
        if (filmTitle && /^(?:фільм|фильм|film|movie|відео)?$/i.test(label)) label = filmTitle;
        return {number: number, label: label, original: title};
    }
    function cleanPlayer(on) {
        var body = $('body')[0];
        if (body && body.classList) body.classList.toggle('anitube-player', !!on);
    }
    function playbackVersion(work, owner) {
        if (!work || work.anitube_owner !== owner) return;
        if (work.anitube_version_shown) { delete work.anitube_version_shown; return; }
        Lampa.Noty.show('AniTube v' + VERSION + (work.title ? ' · ' + work.title : ''));
    }

    // Indices only: the caller's entries and progress objects are never reordered in place.
    // Numbered episodes sort numerically; specials with no number remain after them in source order.
    function episodeOrder(entries, descending) {
        return entries.map(function (entry, index) { return index; }).sort(function (a, b) {
            var x = entries[a].info.number, y = entries[b].info.number;
            if (x && y) return (descending ? y - x : x - y) || a - b;
            if (x || y) return x ? -1 : 1;
            return a - b;
        });
    }

    // ---- Episode screen --------------------------------------------------------------------------------------------
    // A page of its own (header, voice/season chips, episode cards with stills), laid out like the UAKino plugin's series page.
    function plural(n, one, few, many) {
        var m = Math.abs(n) % 100, d = m % 10;
        return m > 10 && m < 20 ? many : d > 1 && d < 5 ? few : d === 1 ? one : many;
    }
    function component(object) {
        var self = this;
        var movie = object.movie || {};
        var html, scroll, body, rows = [], cur = {r: 0, c: 0};
        var results = [], item = null, voices = [], voiceIndex = 0, entries = [], closed = false, manual = '', tmdbCache = {}, token = 0;
        var isTv = !!(movie.name || movie.number_of_seasons || movie.first_air_date);
        var descending = Lampa.Storage.get('anitube_episode_order', 'asc') === 'desc';

        function saved(key) { var all = Lampa.Storage.get('anitube_choice', '{}'); return (all && all[key]) || {}; }
        // The player the owner picked by hand wins; otherwise the team's default. This is the variant a voice opens.
        function voiceFor(label) {
            var player = saved(key).player;
            var picked = !player ? -1 : voices.findIndex(function (v) { return v.label === label && v.player === player && v.supported !== false; });
            if (picked < 0) picked = preferredVoice(voices, label);
            return picked < 0 ? voices.findIndex(function (v) { return v.label === label; }) : picked;
        }
        function remember(key, value) {
            var all = Lampa.Storage.get('anitube_choice', '{}');
            if (!all || typeof all !== 'object') all = {};
            all[key] = Object.assign(all[key] || {}, value);
            Lampa.Storage.set('anitube_choice', all);
        }
        var key = String(movie.id || movie.original_title || movie.title || '');
        // The source is remembered per card. While none is remembered and a search finds nothing, the next one in ORDER is tried.
        var source = SOURCE_NAMES[saved(key).source] && sourceAllowed(saved(key).source) ? saved(key).source : 'anitube', fellBack = !!saved(key).source;
        var qualityCache = {}, qualityBusy = 0, qualityQueue = [], streamMetadata = {}, streamWaiting = {};
        var ORDER = ['anitube', 'makhno', 'uafilms', 'animeon', 'uafix', 'dorama', 'uaserials', 'anilibria'], extraTerms = [], lastQueries = [], openSeq = 0, seasonOrder = [];
        var playSeq = 0, launching = false;
        var playbackMessage = '', moonWatchStop = null, moonQualityStop = null, playbackListener = null, playerCloseListener = null;
        var playbackOwner = 'anitube-' + Date.now() + '-' + Math.random();
        var seasons = {}, season = 0;
        function playbackStatus(code, message) {
            if (closed) return;
            playbackMessage = (code ? code + ' · ' : '') + message;
            if (body) body.find('.atp-playback-status').text(playbackMessage);
            if (code) Lampa.Noty.show(playbackMessage, {time: 12000});
        }
        function active() { return Lampa.Activity.active() && Lampa.Activity.active().activity === self.activity; }

        function focusAt(r, c) {
            if (!rows.length) return;
            r = Math.max(0, Math.min(rows.length - 1, r));
            c = Math.max(0, Math.min(rows[r].length - 1, c));
            cur.r = r; cur.c = c;
            var el = rows[r][c];
            if (el && el.atEntry && source !== 'uafilms') self.inspectQuality(el.atEntry, el.atQuality, token);
            // The set of focusable elements is remembered once by Lampa, and the list is redrawn, so read it again before focusing.
            Lampa.Controller.collectionSet(scroll.render());
            Lampa.Controller.collectionFocus(el, scroll.render());
            try { scroll.update($(el), true); } catch (e) {}
        }
        function chip(label, value, on, enter, dropdown) {
            var node = $('<div class="atp-chip selector' + (on ? ' atp-chip--on' : '') + '"><span class="atp-chip__l"></span><span class="atp-chip__v"></span></div>');
            node.find('.atp-chip__l').text(label);
            node.find('.atp-chip__v').text(value || '');
            if (dropdown) node.find('.atp-chip__v').append(CHEVRON);
            node.on('hover:enter', enter);
            return node;
        }
        function addRow(nodes) {
            var row = $('<div class="atp__row"></div>');
            nodes.forEach(function (node) { row.append(node); });
            body.append(row);
            rows.push(nodes.map(function (node) { return node[0]; }));
        }
        function seasonOf(result) {
            return result.seasonNo || seasonNumberIn(result.title);
        }
        // Season numbers from the names ("2 сезон", "2nd Season", "... 2"). Within one show (same franchise), if some releases carry a number
        // above 1 and the earliest one has none, that one is season 1.
        function assignSeasons(list) {
            list.forEach(function (r) {
                r.seasonNo = [r.title].concat(r.names || []).reduce(function (n, value) { return n || seasonNumberIn(value); }, 0);
            });
            list.forEach(function (r) {
                if (r.seasonNo) return;
                var group = list.filter(function (x) { return x === r || sameFranchise(x, r); });
                if (!group.some(function (x) { return x.seasonNo > 1; })) return;
                var earliest = group.filter(function (x) { return !x.seasonNo; }).sort(function (x, y) { return (parseInt(x.year, 10) || 0) - (parseInt(y.year, 10) || 0); })[0];
                if (earliest === r) r.seasonNo = 1;
            });
        }
        function seasonLabel(result) {
            var number = seasonOf(result);
            var name = String(result.title || '');
            var label = number ? 'Сезон ' + number : (name.length > 26 ? name.slice(0, 25) + '…' : name);
            return result.year ? label + ' · ' + result.year : label;
        }
        // AniTube keeps every season on its own page, so TMDB's season is only matched by the number in the title (or "1" for the first one).
        function tmdbSeason() {
            if (!isTv || !movie.id || !item) return 0;
            if (source === 'uafix' || source === 'makhno' || source === 'uafilms' || source === 'dorama' || source === 'uaserials') return season;
            if (source === 'animeon') return seasonOf(item) || (item.ref && item.ref.season) || 0;
            return seasonOf(item) || (results.length <= 1 || results.indexOf(item) === 0 ? 1 : 0);
        }
        function loadSeason(number) {
            if (!number) return Promise.resolve({});
            if (tmdbCache[number]) return Promise.resolve(tmdbCache[number]);
            return new Promise(function (resolve) {
                var done = false, fin = function (value) { if (!done) { done = true; resolve(value || {}); } };
                setTimeout(function () { fin({}); }, 5000);
                try {
                    Lampa.Api.seasons(movie, [number], function (data) {
                        var episodes = {}, count = 0;
                        ((data && data[number] && data[number].episodes) || []).forEach(function (e) { episodes[e.episode_number] = e; count++; });
                        episodes.__count = count;
                        tmdbCache[number] = episodes;
                        fin(episodes);
                    });
                } catch (e) { fin({}); }
            });
        }

        // The card's own title unless it is written in Japanese/Chinese/Korean letters; then the Ukrainian/English name from TMDB.
        function displayName() {
            var cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/, own = movie.title || movie.name || '';
            return own && !cjk.test(own) ? own : (extraTerms[0] || orderTerms(searchTerms(movie))[0] || own);
        }

        this.create = function () {
            html = $('<div class="atp"></div>');
            scroll = new Lampa.Scroll({mask: true, over: true, step: 250});
            try { scroll.minus(); } catch (e) {}
            body = $('<div class="atp__body"></div>');
            scroll.append(body);
            html.append(scroll.render());
            if (Lampa.Player.listener && Lampa.Player.listener.follow) {
                playbackListener = function (work) {
                    playbackVersion(work, playbackOwner);
                    cleanPlayer(work && work.anitube_owner === playbackOwner);
                    if (!work || work.anitube_owner !== playbackOwner) restoreNativePlayback(playbackOwner);
                    if (moonWatchStop) { moonWatchStop(); moonWatchStop = null; }
                    if (moonQualityStop) { moonQualityStop(); moonQualityStop = null; }
                    if (work && work.anitube_owner === playbackOwner) {
                        moonWatchStop = watchMoonPlayback(work, playbackStatus, function () {
                            if (closed || !tvPlatform()) return;
                            var index = entries.findIndex(function (entry) { return entry.url === work.anitube_source_url; });
                            var next = entries[index + 1];
                            if (index >= 0 && next) self.resolve(next, function () {}, function () {});
                        });
                        if (work.anitube_moon && tvPlatform()) moonQualityStop = watchMoonQuality();
                    }
                };
                Lampa.Player.listener.follow('start', playbackListener);
                playerCloseListener = function () { launching = false; restoreNativePlayback(playbackOwner); cleanPlayer(false); };
                Lampa.Player.listener.follow('destroy', playerCloseListener);
            }
            this.activity.loader(true);
            manual = saved(key).query || '';
            // Other names of the card from two places at once (TMDB translations, AniList for a Japanese-only card), then the search starts.
            var gathered = [], waiting = 2;
            function got(index, list) {
                gathered[index] = list || [];
                if (--waiting > 0 || closed) return;
                extraTerms = unique((gathered[0] || []).concat(gathered[1] || []));
                self.search(0);
            }
            tmdbTitles(movie, function (list) { got(0, list); });
            anilistTitles(movie, function (list) { got(1, list); });
            return this.render();
        };

        this.loading = function (status) {
            if (closed) return;
            this.activity.loader(!!status);
            if (!status && active()) this.activity.toggle();
        };

        // The header and the chips are always drawn; below them come the message, the choice of title or the episodes.
        this.draw = function (message) {
            if (closed) return;
            var current = ++token;
            body.empty();
            rows = [];
            var voice = voices[voiceIndex];
            var head = $('<div class="atp__head"><div class="atp__title"></div><div class="atp__meta"></div></div>');
            head.find('.atp__title').text(item ? item.title : (movie.title || movie.name || 'AniTube'));
            var meta = [];
            if (voice) meta.push(voice.episodes.length + ' ' + plural(voice.episodes.length, 'серія', 'серії', 'серій'));
            if (results.length > 1) meta.push(results.length + ' ' + plural(results.length, 'варіант', 'варіанти', 'варіантів') + ' на ' + SOURCE_NAMES[source]);
            // For tracing "the page shows one anime and the player plays another": the id of the opened release/title is printed on the page.
            if (item && item.ref && item.ref.id) meta.push('№ ' + item.ref.id);
            head.find('.atp__meta').text(meta.join(' · '));
            body.append(head);
            body.append($('<div class="atp-playback-status"></div>').text(playbackMessage));

            var first = [];
            // Releases of the same show are its seasons; everything else that was found is another candidate, kept out of the chip rows.
            var related = item ? results.filter(function (r) { return r === item || (isTv && sameFranchise(r, item)); }) : [];
            var others = item ? results.filter(function (r) { return related.indexOf(r) < 0; }) : [];
            if (voice) {
                first.push(chip('Озвучення', voice.label, false, function () {
                    if (voices.length < 2) return Lampa.Noty.show('Для цього тайтлу лише один варіант озвучення');
                    Lampa.Select.show({
                        title: 'Озвучення / субтитри',
                        items: voices.filter(function (v, index) { return voices.findIndex(function (x) { return x.label === v.label; }) === index; }).map(function (v) {
                            var opens = voiceFor(v.label);
                            return {title: v.label, subtitle: 'Серій: ' + voices[opens].episodes.length, selected: v.label === voice.label, index: opens};
                        }),
                        onBack: function () { Lampa.Controller.toggle('content'); },
                        onSelect: function (picked) {
                            playbackMessage = '';
                            voiceIndex = picked.index;
                            remember(key, {voice: voices[voiceIndex].label, player: saved(key).player || ''});
                            Lampa.Controller.toggle('content');
                            self.draw();
                            focusAt(0, 0);
                        }
                    });
                }, voices.length > 1));
            }
            if (voice && voice.player) {
                first.push(chip('Плеєр', voice.player, false, function () {
                    Lampa.Select.show({title: 'Плеєр · ' + voice.label,
                        items: voices.map(function (v, index) { return {title: v.player, subtitle: (v.supported === false ? 'Не підтримується · ' : '') + 'Серій: ' + v.episodes.length, selected: index === voiceIndex, index: index, label: v.label}; }).filter(function (v) { return v.label === voice.label; }),
                        onBack: function () { Lampa.Controller.toggle('content'); },
                        onSelect: function (picked) {
                            playbackMessage = '';
                            voiceIndex = picked.index;
                            remember(key, {voice: voices[voiceIndex].label, player: voices[voiceIndex].player});
                            Lampa.Controller.toggle('content'); self.draw(); focusAt(0, 1);
                        }
                    });
                }, true));
            }
            first.push(chip('Джерело', SOURCE_NAMES[source], false, function () {
                Lampa.Select.show({
                    title: 'Джерело серій',
                    items: ([
                        {title: 'AniTube', subtitle: 'Аніме (укр)', selected: source === 'anitube', value: 'anitube'},
                        {title: 'Makhno', subtitle: 'Аніме, Фільми, Серіали (укр)', selected: source === 'makhno', value: 'makhno'},
                        {title: 'UAFilms', subtitle: 'Ashdi, UAflix, Moon за номером TMDB (укр)', selected: source === 'uafilms', value: 'uafilms'},
                        {title: 'AnimeOn', subtitle: 'Аніме (укр)', selected: source === 'animeon', value: 'animeon'},
                        {title: 'UAflix', subtitle: 'Аніме, Фільми, Серіали, Дорами (укр)', selected: source === 'uafix', value: 'uafix'},
                        {title: 'DoramaUA', subtitle: 'Дорами (укр)', selected: source === 'dorama', value: 'dorama', box: true},
                        {title: 'UA Serials', subtitle: 'Фільми, Серіали, Дорами, Аніме (укр)', selected: source === 'uaserials', value: 'uaserials'},
                        {title: 'AniLibria', subtitle: 'Аніме (рос)', selected: source === 'anilibria', value: 'anilibria', ru: true}
                    ]).filter(function (entry) { return (!entry.ru || russianEnabled()) && (!entry.box || sourceAllowed('dorama')); }),
                    onBack: function () { Lampa.Controller.toggle('content'); },
                    onSelect: function (picked) {
                        Lampa.Controller.toggle('content');
                        if (picked.value !== source) self.switchSource(picked.value);
                    }
                });
            }, true));
            if (others.length) {
                first.push(chip('Інші варіанти', others.length, false, function () {
                    Lampa.Select.show({
                        title: 'Інші знайдені варіанти',
                        items: others.map(function (r, index) { return {title: r.title, subtitle: r.note || '', index: index}; }),
                        onBack: function () { Lampa.Controller.toggle('content'); },
                        onSelect: function (picked) {
                            Lampa.Controller.toggle('content');
                            self.openTitle(others[picked.index]);
                        }
                    });
                }, true));
            }
            if (voice && voice.episodes.length > 1) {
                var orderColumn = first.length;
                var orderButton = chip('', '', descending, function () {
                    descending = !descending;
                    Lampa.Storage.set('anitube_episode_order', descending ? 'desc' : 'asc');
                    self.focusEpisode = false;
                    self.draw();
                    focusAt(0, orderColumn);
                });
                orderButton.attr('class', 'atp-chip atp-chip--sort selector' + (descending ? ' atp-chip--on' : ''));
                orderButton.attr('title', descending ? 'Від останньої серії' : 'Від першої серії');
                orderButton.attr('aria-label', descending ? 'Серії від останньої. Перемкнути порядок' : 'Серії від першої. Перемкнути порядок');
                orderButton.find('.atp-chip__l').append('<svg viewBox="0 0 36 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M10 20V4m-5 5 5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.5" opacity="' + (descending ? '1' : '.3') + '"></path><path d="M26 4v16m-5-5 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.5" opacity="' + (descending ? '.3' : '1') + '"></path></svg>');
                first.push(orderButton);
            }
            first.push(chip('Пошук', manual || '', false, function () { self.ask(); }));
            addRow(first);

            if (source === 'uafix' || source === 'makhno' || source === 'uafilms' || source === 'dorama' || source === 'uaserials') {
                var numbers = Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; });
                if (numbers.length > 1) {
                    addRow(numbers.map(function (number) {
                        return chip('Сезон ' + number, '', number === season, function () {
                            if (number === season) return;
                            remember(key, {season: number});
                            if (source === 'uafilms') self.useUafilmsSeason(number); else if (source === 'makhno' || source === 'dorama' || source === 'uaserials') self.useMakhnoSeason(number); else self.useSeason(number);
                        });
                    }));
                }
            } else if (related.length > 1) {
                // The seasons in their own order (season 1, 2, ...), then by year; not in the order of how well they matched.
                seasonOrder = related.slice().sort(function (x, y) {
                    return ((seasonOf(x) || 99) - (seasonOf(y) || 99)) || ((parseInt(x.year, 10) || 0) - (parseInt(y.year, 10) || 0));
                });
                addRow(seasonOrder.map(function (result) {
                    var on = result === item;
                    return chip(seasonLabel(result), '', on, function () { if (!on) self.openTitle(result, true); });
                }));
            }

            if (message) {
                body.append($('<div class="atp__note"></div>').text(message));
                return;
            }
            if (!item) {
                // Several matches and none is known to be the right one: they are offered as cards.
                results.forEach(function (result) {
                    var node = $('<div class="atp-ep selector"><div class="atp-ep__body"><div class="atp-ep__name"></div><div class="atp-ep__meta"></div></div></div>');
                    node.find('.atp-ep__name').text(result.title);
                    node.find('.atp-ep__meta').text(result.note || 'Обери тайтл');
                    node.on('hover:enter', function () { self.openTitle(result); });
                    body.append(node);
                    rows.push([node[0]]);
                });
                return;
            }
            this.episodes(current, voice);
        };

        this.episodes = function (current, voice) {
            if (!voice) return;
            entries = voice.episodes.map(function (episode) {
                var info = episodeInfo(episode.title, item.title);
                var hash = Lampa.Utils.hash(item.url + (source === 'uafix' || source === 'makhno' || source === 'uafilms' || source === 'dorama' || source === 'uaserials' ? '#s' + season : '') + ':' + (info.number || info.original));
                return {url: episode.url, ref: episode.ref, kind: episode.kind, wantSubtitles: episode.subtitles, subtitles: episode.subs, quality: episode.quality || 0, supported: voice.supported !== false, player: voice.player || '', info: info, title: info.label, timeline: Lampa.Timeline.view(hash)};
            });
            entries = episodeOrder(entries, false).map(function (index) { return entries[index]; });
            var displayOrder = episodeOrder(entries, descending);
            var lastWatched = -1;
            entries.forEach(function (entry, index) { if (entry.timeline.percent > 0) lastWatched = index; });
            var target = lastWatched < 0 ? 0 : (entries[lastWatched].timeline.percent >= 90 ? Math.min(lastWatched + 1, entries.length - 1) : lastWatched);

            var list = $('<div class="atp__list"><div class="atp__note">Завантажуємо серії…</div></div>');
            body.append(list);
            var firstRow = rows.length;
            loadSeason(tmdbSeason()).then(function (tm) {
                if (closed || current !== token) return;
                // The stills and descriptions are only used when TMDB's season is about as long as AniTube's list, so they cannot belong to another season.
                // A show picked from the list that does not share a name with the card (another drama on an anime's card) gets no stills.
                var count = tm.__count || 0, numbers = entries.map(function (e) { return e.info.number; });
                var partial = item.matched === true && numbers.length > 0 && numbers.every(function (n, i) { return n === i + 1 && !!tm[n]; });
                var fits = count && item.matched !== false && (Math.abs(count - entries.length) <= Math.max(2, Math.round(count * 0.2)) || partial);
                list.empty();
                displayOrder.forEach(function (index, displayIndex) {
                    var entry = entries[index];
                    var t = (fits && entry.info.number && tm[entry.info.number]) || {};
                    var percent = Math.min(100, entry.timeline.percent || 0);
                    var date = episodeDate(t.air_date), runtime = t.runtime ? t.runtime + ' хв' : '';
                    var node = $('<div class="atp-ep selector"><div class="atp-ep__img"><div class="atp-ep__num"></div></div><div class="atp-ep__body"><div class="atp-ep__name"></div><div class="atp-ep__meta"></div><div class="atp-ep__date"></div><div class="atp-ep__descr"></div></div></div>');
                    var picture = t.still_path || movie.backdrop_path;
                    if (picture) {
                        var img = $('<img loading="lazy">');
                        img.attr('src', Lampa.TMDB.image('t/p/w300' + picture));
                        node.find('.atp-ep__img').append(img);
                    }
                    node.find('.atp-ep__num').text(entry.info.number || '');
                    if (percent > 0 && percent < 90) node.find('.atp-ep__img').append('<div class="atp-ep__bar"><i style="width:' + percent + '%"></i></div>');
                    var own = t.name && normalize(t.name) !== normalize(item.title) && !/^\s*(серія|епізод|episode)\s*\d+\s*$/i.test(t.name);
                    var name = own ? entry.info.label + ' · ' + t.name : entry.info.label;
                    entry.title = name;
                    function showQuality(height) { node.find('.atp-ep__name').text(name + (height ? ' · ' + height + 'p' : '')); }
                    showQuality(entry.quality);
                    node.find('.atp-ep__meta').text([voice.label, voice.player, voice.supported === false ? 'Плеєр не підтримується' : ''].filter(Boolean).join(' · '));
                    node.find('.atp-ep__date').text([date, runtime].filter(Boolean).join(' · '));
                    node[0].atEntry = entry; node[0].atQuality = showQuality;
                    if (displayIndex < 8 && media(entry.url)) self.inspectQuality(entry, showQuality, current);
                    node.find('.atp-ep__descr').text(t.overview || '');
                    if (percent >= 90) node.append($('<div class="atp-ep__st atp-ep__st--ok"></div>').append(CHECK).append('<span>Переглянуто</span>'));
                    else if (index === target && percent > 0) node.append($('<div class="atp-ep__st atp-ep__st--go"></div>').text('Продовжити'));
                    node.on('hover:enter', function () { self.play(index); });
                    list.append(node);
                    rows.push([node[0]]);
                });
                try { Lampa.Layer.update(); } catch (e) {}
                if (self.focusEpisode) { self.focusEpisode = false; focusAt(firstRow + (descending ? 0 : Math.max(0, displayOrder.indexOf(target))), 0); }
            });
        };

        this.inspectQuality = function (entry, update, current) {
            if (!entry || entry.supported === false || entry.quality || entry.qualityQueued) return;
            var cached = qualityCache[entry.url];
            if (cached) { entry.quality = cached.height; if (update) update(entry.quality); return; }
            entry.qualityQueued = true;
            qualityQueue.push({entry: entry, update: update, current: current});
            pumpQuality();
        };
        // Share a manifest read between the card badge, playback and preloaded playlist entries.
        function inspectStream(entry, url, done) {
            function apply(info) {
                entry.streamInfo = info; entry.streamInfoUrl = url;
                if (info.height) entry.quality = info.height;
                done(info);
            }
            if (streamMetadata[url]) return apply(streamMetadata[url]);
            if (streamWaiting[url]) { streamWaiting[url].push(apply); return; }
            streamWaiting[url] = [apply];
            streamInfo(url, function (info) {
                streamMetadata[url] = info;
                var waiting = streamWaiting[url];
                delete streamWaiting[url];
                waiting.forEach(function (callback) { callback(info); });
            });
        }
        function playerFile(entry) {
            var native = tvPlatform() && /^https:\/\/ashdi\.vip\//i.test(entry.stream || '');
            var file = playbackFile(entry.stream, !moonPage(entry.url) && entry.streamInfoUrl === entry.stream ? entry.streamInfo : null, native);
            file.anitube_source_url = entry.url;
            if (native) { file.hls_type = 'native'; file.anitube_native_prepared = true; }
            return file;
        }
        function prepareStream(entry, url, done) {
            if (moonPage(entry.url)) return done();
            if (tvPlatform() && /^https:\/\/ashdi\.vip\//i.test(url)) {
                done(); // Optional quality metadata never delays native playback.
                inspectStream(entry, url, function (info) {
                    var work = Lampa.Player.playdata && Lampa.Player.playdata();
                    if (closed || !work || work.anitube_owner !== playbackOwner || work.anitube_source_url !== entry.url || work.quality) return;
                    var file = playbackFile(url, info, true);
                    if (file.quality) { work.quality = file.quality; if (Lampa.PlayerPanel && Lampa.PlayerPanel.quality) Lampa.PlayerPanel.quality(file.quality, work.url); }
                });
                return;
            }
            var finished = false;
            var timer = setTimeout(finish, 1500);
            function finish() { if (finished) return; finished = true; clearTimeout(timer); done(); }
            inspectStream(entry, url, finish);
        }
        function pumpQuality() {
            if (launching || closed) return;
            while (qualityBusy < 2 && qualityQueue.length) {
                var task = qualityQueue.shift();
                if (closed || task.current !== token) continue;
                qualityBusy++;
                (function (job) {
                    var entry = job.entry;
                    function finish(info) {
                        if (info && !info.height && entry.quality) info = {height: entry.quality, bandwidth: 0};
                        if (info) qualityCache[entry.url] = info;
                        entry.quality = info ? info.height : 0;
                        if (!closed && job.current === token && job.update) job.update(entry.quality);
                        qualityBusy--; pumpQuality();
                    }
                    self.resolve(entry, function (url) {
                        if (closed || job.current !== token) return finish(null);
                        inspectStream(entry, url, finish);
                    }, function () { finish(null); });
                })(task);
            }
        }

        this.ask = function () {
            Lampa.Input.edit({free: true, title: 'Пошук (порожнє поле скидає ручну назву)', nosave: true, value: manual}, function (value) {
                Lampa.Controller.toggle('content');
                value = String(value || '').trim();
                // An empty entry confirmed with Enter clears the hand-typed name, so the search goes back to the card's own names.
                if (!value && !manual) return;
                if (!value) Lampa.Noty.show('Ручну назву скинуто, шукаю за назвами картки');
                // AniTube often names a show differently from the card, so the title can be typed by hand (and is remembered).
                manual = value;
                remember(key, {query: manual, title: ''});
                results = []; item = null; voices = [];
                self.loading(true);
                self.search(0);
            });
        };

        // 1. find the title on AniTube (the card's own names, then the original ones)
        // Every source is searched with the card's names in all languages at once; the results are merged and ranked by how closely their
        // own names match the card's, and a clear winner is opened by itself. `spec`: label, fetch(query, ok, fail), strict (drop results
        // that do not resemble the card), words (also ask distinctive words), failed(xhr, why), nothing.
        this.searchMany = function (spec) {
            var tiers = manual ? [[manual]] : nameTiers(movie, extraTerms);
            var flat = tiers.reduce(function (all, tier) { return all.concat(tier); }, []);
            var names = [];
            for (var i = 0; i < 4; i++) [tiers[0], tiers[1]].forEach(function (tier) { if (tier && tier[i] && names.length < 5) names.push(tier[i]); });
            if (!manual && names.length < 2 && tiers[2] && tiers[2][0]) names.push(tiers[2][0]);
            if (!manual && spec.words) names = unique(names.concat(names.reduce(function (all, q) { return all.concat(nameWords(q).filter(function (w) { return w.length >= 5; })); }, []))).slice(0, 8);
            // Scored against the card's whole names, not the shortened search queries: a long title cut to five words would match any show that shares
            // two of them ("Самый сильный в мире заступник: Страна лабиринта…" matched "На самом деле я самый сильный?").
            var cards = manual ? [] : fullNames(movie, extraTerms).map(nameWords).filter(function (c) { return c.length; });
            var year = parseInt(String(movie.release_date || movie.first_air_date || '').slice(0, 4), 10) || 0;
            var pending = names.length, seen = {}, list = [], failures = 0, lastFailure = [];
            function finish() {
                if (closed) return;
                // Some sites list every name of a show in one title ("Доктор X / Доктор Ікс / ... / Doctor X: ..."). Each name is scored on its own, and the
                // screen shows only the one that looks most like the card's title, so the heading stays readable.
                var shown = displayName();
                list.forEach(function (r) {
                    var parts = String(r.title || '').split(/\s+\/\s+/).map(function (part) { return part.trim(); }).filter(Boolean);
                    if (parts.length < 2) return;
                    r.names = unique((r.names || []).concat(parts));
                    r.title = shortName(pickName(parts, shown));
                });
                // Whether a result is really the card's show decides if the card's TMDB stills may be used for its episodes.
                var matchCards = fullNames(movie, extraTerms).map(nameWords).filter(function (c) { return c.length; });
                list.forEach(function (r) { r.matched = titleScore(r.names || [r.title], matchCards) > 0; });
                var scored = list.map(function (r) { return {r: r, score: manual ? 1 : titleScore(r.names || [r.title], cards)}; });
                if (source === 'uaserials' && !manual && fullNames(movie, extraTerms).some(uaserialHasX)) {
                    scored = scored.filter(function (entry) { return (entry.r.names || [entry.r.title]).some(uaserialHasX); });
                }
                // Developer aid: window.anitube_debug = true in the console prints every candidate with its score.
                try { if (window.anitube_debug) console.log('AniTube search', source, names, scored.map(function (e) { return e.score.toFixed(1) + ' ' + e.r.title + ' [' + (e.r.names || []).join(' | ') + ']'; })); } catch (e) {}
                if (spec.strict) scored = scored.filter(function (e) { return e.score > 0; });
                scored.sort(function (x, y) {
                    return (y.score - x.score) || (Math.abs((parseInt(x.r.year, 10) || 0) - year) - Math.abs((parseInt(y.r.year, 10) || 0) - year));
                });
                if (scored.length) {
                    var top = scored[0].score, next = scored[1] ? scored[1].score : 0;
                    var clear = manual || (top >= 11 && next < top * 0.7);
                    // A fuzzy source (AniLibria) never opens one of several results by itself: the right one is picked from the list.
                    var auto = clear && (!spec.strict || scored.length === 1) && (!spec.confirm || manual);
                    // The text search of uafix and DoramaUA also returns unrelated shows; a lone result that shares no name with the card is shown
                    // for confirmation instead of being opened (it used to open another drama's episodes on an anime's card).
                    var unsure = !!spec.verify && !manual && top <= 0;
                    return self.found(scored.map(function (e) { return e.r; }), flat, (spec.strict && !auto) || unsure, auto && scored.length > 1 ? scored[0].r : null);
                }
                if (self.nextSource()) return self.search(0);
                if (failures === names.length) return self.empty(spec.failed(lastFailure[0], lastFailure[1]));
                self.empty(spec.nothing(manual, list.length));
            }
            names.forEach(function (query) {
                spec.fetch(query, function (items) {
                    (items || []).forEach(function (r) { if (!seen[r.url]) { seen[r.url] = true; list.push(r); } });
                    if (--pending === 0) finish();
                }, function (xhr, why) {
                    failures++;
                    lastFailure = [xhr, why];
                    if (--pending === 0) finish();
                });
            });
        };

        this.search = function () {
            var queries = manual ? [manual] : nameTiers(movie, extraTerms).reduce(function (all, tier) { return all.concat(tier); }, []);
            lastQueries = queries;
            var where = function (m) { return (m ? 'за запитом «' + m + '»' : 'за назвою цієї картки') + ' нічого не знайдено'; };
            var imdb = String(movie.imdb_id || '');
            var specs = {
                anitube: {
                    label: 'AniTube',
                    fetch: function (q, ok, fail) { fetchText('search', q, function (html) { ok(catalog(html)); }, fail); },
                    failed: function (xhr, why) { return 'AniTube: не вдалося отримати результати пошуку ' + failureText(xhr, why) + '.'; },
                    nothing: function (m) { return m ? 'AniTube: за запитом «' + m + '» нічого не знайдено. Спробуй інше слово через «Пошук» угорі.'
                        : 'AniTube: за назвою цієї картки нічого не знайдено. Натисни «Пошук» угорі й введи назву так, як вона на AniTube (часто достатньо одного слова).'; }
                },
                animeon: {
                    label: 'AnimeOn',
                    fetch: function (q, ok, fail) {
                        animeonApi('search', {q: q}, function (data) { ok(animeonCatalog(data)); }, fail);
                    },
                    failed: function (xhr, why) { return 'AnimeOn: ' + (why || 'сервер не відповів') + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') + '.'; },
                    nothing: function (m) { return 'AnimeOn: ' + where(m) + '. Спробуй інше слово через «Пошук» або інше джерело.'; }
                },
                uafix: {
                    label: 'UAflix', verify: true,
                    fetch: function (q, ok, fail) { uafixGet('search', q, function (html) { ok(uafixCatalog(html)); }, fail); },
                    failed: function (xhr, why) { return 'UAflix: не вдалося отримати результати пошуку ' + failureText(xhr, why) + '.' + boxHint(); },
                    nothing: function (m) { return 'UAflix: ' + where(m) + '. Спробуй інше слово через «Пошук» або інше джерело.'; }
                },
                dorama: {
                    label: 'DoramaUA', verify: true,
                    fetch: function (q, ok, fail) { doramaApi('/search?text=' + encodeURIComponent(q), function (data) { ok(doramaCatalog(data)); }, fail); },
                    failed: function (xhr) { return 'DoramaUA: сервер каталогу не відповів' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') + '.'; },
                    nothing: function (m) { return 'DoramaUA: ' + where(m) + '. Спробуй інше слово через «Пошук» або інше джерело.'; }
                },
                uaserials: {
                    label: 'UA Serials', verify: true, strict: true, confirm: true,
                    fetch: function (q, ok, fail) { uaserialGet('search', q, function (html) { ok(uaserialCatalog(html)); }, fail); },
                    failed: function (xhr) { return 'UA Serials: не вдалося отримати результати пошуку' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') + '.'; },
                    nothing: function (m) { return 'UA Serials: ' + where(m) + '. Спробуй інше слово через «Пошук» або інше джерело.'; }
                },
                anilibria: {
                    label: 'AniLibria', strict: true, words: true,
                    fetch: function (q, ok, fail) { anilibriaCall('/app/search/releases?query=' + encodeURIComponent(q), function (data) { ok(anilibriaCatalog(data)); }, fail); },
                    failed: function () { return 'AniLibria: сервер не відповів.'; },
                    nothing: function (m, raw) {
                        return 'AniLibria: ' + (m ? 'за запитом «' + m + '»' : 'цього аніме') + (raw ? ' сервер повернув ' + raw + ' результатів, жоден не схожий на цей тайтл' : ' сервер нічого не знайшов') +
                            ', схоже, його немає в каталозі AniLibria. Якщо знаєш його назву там (ромадзі чи російською), введи її через «Пошук».';
                    }
                }
            };
            if (source === 'makhno') return this.searchMakhno(queries);
            if (source === 'uafilms') return this.searchUafilms(queries);
            this.searchMany(specs[source]);
        };

        // When nothing is found and the source was not chosen by hand, the next one in ORDER is searched.
        this.nextSource = function () {
            var next = ORDER[ORDER.indexOf(source) + 1];
            while (next && !sourceAllowed(next)) next = ORDER[ORDER.indexOf(next) + 1];
            if (manual || fellBack || !next) return false;
            source = next;
            return true;
        };

        // Makhno finds the Ashdi page by the card's TMDB number (and IMDb number when the card has one), not by name.
        this.searchMakhno = function (queries) {
            var imdb = String(movie.imdb_id || '');
            animeonCall('/search', {
                sources: 'makhno', source: 'makhno', tmdb_id: movie.id,
                imdb_id: /^tt\d+$/.test(imdb) ? imdb : '', serial: isTv ? 1 : 0
            }, null, function (data) {
                if (closed) return;
                var found = ((data && data.items) || []).map(function (entry) {
                    var play = String((entry && entry.ref && entry.ref.play) || '').split('?')[0];
                    if (!ashdiCatalogPage(play)) return null;
                    return {title: displayName() || 'Ashdi', url: 'makhno:' + play, note: 'Ashdi', ref: {play: play}};
                }).filter(Boolean).slice(0, 1);
                if (found.length) return self.found(found, queries);
                if (self.nextSource()) return self.search(0);
                self.empty('Makhno: за номером цієї картки нічого не знайдено. Спробуй інше джерело.');
            }, function (xhr) {
                if (closed) return;
                if (self.nextSource()) return self.search(0);
                self.empty('Makhno: сервер не відповів' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') + '. Ті самі озвучення Ashdi є в джерелі UAFilms (чип «Джерело»).');
            });
        };

        // Picking another source starts the search again from the card's own names.
        this.switchSource = function (name) {
            playSeq++; launching = false;
            source = name;
            fellBack = true;
            remember(key, {source: name, title: ''});
            results = []; item = null; voices = []; seasons = {}; season = 0;
            this.loading(true);
            this.search(0);
        };

        this.empty = function (message) {
            playbackMessage = '';
            if (/нічого/.test(message) && !manual && lastQueries.length) {
                message += ' Шукали: ' + lastQueries.slice(0, 3).map(function (q) { return '«' + q + '»'; }).join(', ') + ' та ще ' + Math.max(0, lastQueries.length - 3) + ' назв.';
            }
            if (source === 'anitube') {
                var others = ORDER.filter(function (name) { return name !== 'anitube' && sourceAllowed(name); }).map(function (name) { return SOURCE_NAMES[name]; });
                message += ' Можна вибрати інше джерело (' + others.join(', ') + ') у чипі «Джерело».';
            }
            this.draw(message);
            this.loading(false);
            this.start(true);
        };

        this.found = function (found, queries, confirm, pick) {
            results = found;
            assignSeasons(results);
            var wanted = saved(key).title;
            var chosen = found.filter(function (r) { return r.url === wanted; })[0];
            if (!chosen && found.length === 1 && !confirm) chosen = found[0];
            if (!chosen && pick) chosen = pick;
            if (!chosen) {
                var exact = found.filter(function (r) { return queries.some(function (q) { return normalize(q) === normalize(r.title); }); });
                if (exact.length === 1) chosen = exact[0];
            }
            if (chosen) this.openTitle(chosen);
            else {
                this.draw();
                this.loading(false);
                this.start(true);
            }
        };

        // 2. load the playlist and keep only Ashdi, the one player that gives a direct stream
        // Every open of a title takes a new number; an answer that arrives for an older number is dropped, so a slow reply for one title can
        // never fill the page of another one.
        this.openTitle = function (selectedTitle, keepFocusOnSeasons) {
            playSeq++; launching = false;
            item = selectedTitle;
            playbackMessage = '';
            voices = []; seasons = {}; season = 0;
            var mine = ++openSeq;
            remember(key, {title: item.url});
            this.loading(true);
            if (source === 'uafix') return this.openUafix();
            if (source === 'animeon') return this.openAnimeon();
            if (source === 'makhno') return this.openMakhno();
            if (source === 'uafilms') return this.openUafilms();
            if (source === 'dorama') return this.openDorama();
            if (source === 'uaserials') return this.openUaserials();
            if (source === 'anilibria') return this.openAnilibria();
            fetchPlaylist(item.url, function (data) {
                if (closed || mine !== openSeq) return;
                // On a dead end the chips stay usable, so another search result can be picked.
                voices = [];
                if (!data || !data.success || !data.response) return self.empty('AniTube: сайт не повернув список серій.');
                var all = sources(data.response, item.url);
                if (!all.length) return self.empty('AniTube: не вдалося розібрати список серій.');
                all = all.filter(function (variant) { return !/fenix|фенікс|феникс/i.test(variant.player); });
                if (!all.length) return self.empty('AniTube: для цього тайтлу є лише плеєр Fenix, а він не працює.');
                voices = all.map(function (variant) {
                    var player = /ashdi/i.test(variant.player) ? 'Ashdi' : /moon/i.test(variant.player) ? 'Moon' : variant.player;
                    return {label: voiceLabel(variant), player: player, episodes: variant.episodes,
                        supported: player === 'Ashdi' || player === 'Moon' || variant.episodes.every(function (e) { return media(e.url); })};
                });
                var firstAshdi = voices.filter(function (v) { return v.supported && v.player === 'Ashdi'; })[0];
                var firstWorking = firstAshdi || voices.filter(function (v) { return v.supported; })[0];
                var wantedVoice = saved(key).voice;
                voiceIndex = voices.some(function (v) { return v.label === wantedVoice && v.supported; }) ? voiceFor(wantedVoice) : -1;
                if (voiceIndex < 0 && firstWorking) voiceIndex = voiceFor(firstWorking.label);
                if (voiceIndex < 0) voiceIndex = 0;
                self.focusEpisode = !keepFocusOnSeasons;
                self.draw();
                self.loading(false);
                self.start(true);
                if (keepFocusOnSeasons) focusAt(1, Math.max(0, seasonOrder.indexOf(item)));
            }, function (xhr, why) {
                if (!closed && mine === openSeq) self.empty('AniTube: не вдалося отримати список серій ' + failureText(xhr, why) + '.');
            });
        };

        this.openAnilibria = function () {
            var mine = openSeq;
            anilibriaCall('/anime/releases/' + encodeURIComponent(item.ref.id), function (data) {
                if (closed || mine !== openSeq) return;
                voices = anilibriaVoices(data);
                if (!voices.length) return self.empty('AniLibria: у цьому релізі немає серій для перегляду.');
                voiceIndex = 0;
                self.focusEpisode = true;
                self.draw();
                self.loading(false);
                self.start(true);
            }, function (xhr) {
                if (!closed && mine === openSeq) self.empty('AniLibria: не вдалося отримати список серій' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') + '.');
            });
        };

        // The Ashdi page of the show: a serial page lists voices > seasons > episodes, a film page is one player.
        this.openMakhno = function () {
            var mine = openSeq;
            var play = item.ref.play;
            ashdiHtml(play, function (html) {
                if (closed || mine !== openSeq) return;
                if (ashdiMissing(html)) {
                    if (self.nextSource()) return self.search(0);
                    return self.empty('Makhno: Ashdi більше не має цього файлу. Спробуй інше джерело.');
                }
                if (/^\/serial\//.test(new URL(play).pathname)) seasons = makhnoSeasons(ashdiPlaylist(html));
                else seasons = {1: [{label: 'Ashdi', episodes: [{title: 'Фільм', url: play, subs: []}]}]};
                var numbers = Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; });
                if (!numbers.length) return self.empty('Makhno: на сторінці Ashdi немає серій.');
                var wanted = saved(key).season;
                self.useMakhnoSeason(numbers.indexOf(wanted) >= 0 ? wanted : numbers[0], true);
            }, function (why) {
                if (!closed && mine === openSeq) self.empty('Makhno: не вдалося прочитати сторінку Ashdi (' + reason(why) + ').');
            });
        };
        this.useMakhnoSeason = function (number, fresh) {
            season = number;
            voices = seasons[number];
            var wantedVoice = saved(key).voice;
            voiceIndex = 0;
            voices.forEach(function (voice, index) { if (voice.label === wantedVoice) voiceIndex = index; });
            this.focusEpisode = !!fresh;
            this.draw();
            this.loading(false);
            this.start(true);
            if (!fresh) focusAt(1, Math.max(0, Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; }).indexOf(number)));
        };

        // UAFilms knows the card only by its TMDB number, so there is nothing to search by name: one result, the card itself.
        this.searchUafilms = function (queries) {
            if (!/^\d{1,10}$/.test(String(movie.id || ''))) {
                if (self.nextSource()) return self.search(0);
                return self.empty('UAFilms: у картки немає номера TMDB. Спробуй інше джерело.');
            }
            self.found([{title: displayName() || 'UAFilms', url: 'uafilms:' + movie.id, note: 'UAFilms', ref: {tmdb: String(movie.id)}}], queries);
        };
        function uafilmsSeasonNumbers() {
            if (!isTv) return [1];
            var listed = (movie.seasons || []).filter(function (s) { return s && s.season_number > 0 && s.episode_count > 0; }).map(function (s) { return s.season_number; });
            if (listed.length) return listed.sort(function (a, b) { return a - b; });
            var count = parseInt(movie.number_of_seasons, 10) || 1;
            return Array.from({length: Math.min(count, 60)}, function (v, i) { return i + 1; });
        }
        this.openUafilms = function () {
            seasons = {};
            uafilmsSeasonNumbers().forEach(function (number) { seasons[number] = []; });
            var numbers = Object.keys(seasons).map(Number);
            var wanted = saved(key).season;
            this.useUafilmsSeason(numbers.indexOf(wanted) >= 0 ? wanted : numbers[0], true);
        };
        // The voices of a season are the players of its first episode; every episode is then asked for the same voice when it is played.
        this.useUafilmsSeason = function (number, fresh) {
            var mine = openSeq, tmdb = item.ref.tmdb;
            this.loading(true);
            function fail(message) {
                if (closed || mine !== openSeq) return;
                if (fresh && self.nextSource()) return self.search(0);
                self.empty(message);
            }
            uafilmsSources(tmdb, isTv ? number : 0, 1, function (variants) {
                if (closed || mine !== openSeq) return;
                if (!variants.length) return fail('UAFilms: для ' + (isTv ? number + ' сезону ' : '') + 'цієї картки немає озвучень з плеєрами Ashdi, UAflix чи Moon.');
                countEpisodes(number, function (count) {
                    if (closed || mine !== openSeq) return;
                    seasons[number] = variants.map(function (variant) {
                        var episodes = [];
                        for (var n = 1; n <= count; n++) episodes.push({title: isTv ? 'Серія ' + n : 'Фільм', url: 'uafilms:' + tmdb + ':' + number + ':' + n + ':' + variant.key,
                            ref: {season: isTv ? number : 0, episode: n, variant: variant.key}, subtitles: []});
                        return {label: variant.label, player: variant.player, episodes: episodes};
                    });
                    self.useMakhnoSeason(number, fresh);
                });
            }, function (why) { fail('UAFilms: ' + why + '.'); });
        };
        // TMDB's episode count (the card's own season list, then the TMDB season), then the catalogue's season page.
        function countEpisodes(number, done) {
            if (!isTv) return done(1);
            var listed = (movie.seasons || []).filter(function (s) { return s && s.season_number === number; })[0];
            loadSeason(number).then(function (episodes) {
                var count = (episodes && episodes.__count) || (listed && listed.episode_count) || 0;
                if (count) return done(Math.min(count, 2000));
                $.ajax({url: UAFILMS + '/season?id=' + encodeURIComponent(movie.id) + '&season=' + number, dataType: 'json', timeout: 15000,
                    success: function (data) { done(Math.max(1, Math.min(((data && data.episodes) || []).length, 2000))); },
                    error: function () { done(1); }});
            });
        }

        // DoramaUA: the show's API record names its player; the player page lists every season, episode and voice.
        this.openDorama = function () {
            var mine = openSeq;
            doramaApi('/serials/' + encodeURIComponent(item.ref.slug), function (data) {
                if (closed || mine !== openSeq) return;
                var id = data && data.serial && data.serial.page_player;
                if (!/^\d{1,8}$/.test(String(id))) return self.empty('DoramaUA: у цього тайтлу немає плеєра.');
                doramaPlayerPage({id: id, ep: 1}, function (html) {
                    if (closed || mine !== openSeq) return;
                    var playlist = doramaPlaylist(html);
                    if (!playlist) return self.empty('DoramaUA: не вдалося розібрати список серій на сторінці плеєра.');
                    seasons = doramaSeasons(playlist, id);
                    var numbers = Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; });
                    if (!numbers.length) return self.empty('DoramaUA: для цього тайтлу немає українських озвучок чи субтитрів' + (russianEnabled() ? '.' : ' (російські озвучки приховано: Налаштування → AniTube → Показувати російські джерела).'));
                    var wanted = saved(key).season;
                    self.useMakhnoSeason(numbers.indexOf(wanted) >= 0 ? wanted : numbers[0], true);
                }, function (why) {
                    if (!closed && mine === openSeq) self.empty('DoramaUA: не вдалося отримати список серій (' + why + ').');
                });
            }, function (xhr) {
                if (!closed && mine === openSeq) self.empty('DoramaUA: не вдалося отримати дані тайтлу' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') + '.');
            });
        };

        this.openUaserials = function () {
            var mine = openSeq;
            uaserialGet('page', item.url, function (html) {
                if (closed || mine !== openSeq) return;
                var iframe = String(html).match(/<iframe\b[^>]*\b(?:data-src|src)=["'](https:\/\/hdvbua\.pro\/embed\/\d+\/[a-f\d]{6,64})["']/i);
                if (!iframe) return self.empty('UA Serials: на сторінці не знайдено підтримуваного плеєра.');
                uaserialGet('player', iframe[1], function (playerHtml) {
                    if (closed || mine !== openSeq) return;
                    seasons = uaserialPlaylist(playerHtml) || {};
                    var numbers = Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; });
                    if (!numbers.length) return self.empty('UA Serials: не вдалося прочитати список серій плеєра.');
                    var wanted = saved(key).season;
                    self.useMakhnoSeason(numbers.indexOf(wanted) >= 0 ? wanted : numbers[0], true);
                }, function (xhr) {
                    if (!closed && mine === openSeq) self.empty('UA Serials: не вдалося прочитати плеєр' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') + '.');
                });
            }, function (xhr) {
                if (!closed && mine === openSeq) self.empty('UA Serials: не вдалося відкрити сторінку тайтлу' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') + '.');
            });
        };

        // One AnimeOn season: its Ashdi voices become the voices of the screen, in the order the server lists them.
        this.openAnimeon = function () {
            var mine = openSeq;
            animeonLoadVoices(item.ref.id, function (data) {
                if (closed || mine !== openSeq) return;
                voices = data;
                if (!voices.length) return self.empty('AnimeOn: для цього тайтлу немає озвучень з плеєром Ashdi.');
                var wantedVoice = saved(key).voice;
                voiceIndex = 0;
                voices.forEach(function (voice, index) { if (voice.label === wantedVoice) voiceIndex = index; });
                self.focusEpisode = true;
                self.draw();
                self.loading(false);
                self.start(true);
            }, function (xhr, why) {
                if (!closed && mine === openSeq) self.empty('AnimeOn: ' + (why || 'не вдалося отримати список серій') + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') + '.');
            });
        };

        // The show page of uafix lists every season; the episodes of one season become the single "voice" of the screen.
        this.openUafix = function () {
            var mine = openSeq;
            uafixGet('page', item.url, function (html) {
                if (closed || mine !== openSeq) return;
                seasons = uafixSeasons(html, item.url);
                var numbers = Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; });
                if (!numbers.length) {
                    // A film has no episode pages: the show page carries the player itself.
                    if (!uafixPlayer(html)) return self.empty('UAflix: на сторінці немає ні серій, ні плеєра.');
                    seasons = {1: [{number: 0, url: item.url}]};
                    numbers = [1];
                }
                var wanted = saved(key).season;
                self.useSeason(numbers.indexOf(wanted) >= 0 ? wanted : numbers[0], true);
            }, function (xhr, why) {
                if (!closed && mine === openSeq) self.empty('UAflix: не вдалося отримати список серій ' + failureText(xhr, why) + '.' + boxHint());
            });
        };
        this.useSeason = function (number, fresh) {
            season = number;
            var plain = seasons[number], mine = openSeq;
            function build(found) {
                if (closed || mine !== openSeq || season !== number) return;
                // Only episodes that really have the voice-over / the subtitles are listed; a failed check keeps the episode.
                var made = ['voice', 'subs'].map(function (kind) {
                    return {
                        label: kind === 'voice' ? 'Українська озвучка' : 'Українські субтитри',
                        episodes: plain.filter(function (episode) { var f = found && found[episode.url]; return !f || f[kind]; })
                            .map(function (episode) { return {title: episode.number ? 'Серія ' + episode.number : 'Фільм', url: episode.url, kind: kind}; })
                    };
                });
                voices = made.filter(function (voice) { return voice.episodes.length; });
                if (!voices.length) voices = made;
                var wantedVoice = saved(key).voice;
                voiceIndex = 0;
                voices.forEach(function (voice, index) { if (voice.label === wantedVoice) voiceIndex = index; });
                self.focusEpisode = !!fresh;
                self.draw();
                self.loading(false);
                self.start(true);
                if (!fresh) focusAt(1, Math.max(0, Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; }).indexOf(number)));
            }
            // The show page lists every episode the site has a page for, but a voice-over often exists for fewer of them than the subtitles.
            if (plain.length < 2 || plain.length > UAFIX_PROBE_MAX) return build(null);
            this.loading(true);
            uafixProbe(plain, build);
        };

        // A UAFilms episode is asked for its players when it is played; the page of the same voice is then read like any other.
        function uafilmsStream(entry, success, failure) {
            uafilmsSources(item.ref.tmdb, entry.ref.season, entry.ref.episode, function (variants) {
                var variant = variants.filter(function (v) { return v.key === entry.ref.variant; })[0];
                if (!variant) return failure('у цієї серії немає озвучення «' + entry.ref.variant.split('|')[1] + '»: обери інше в чипі «Озвучення»');
                function done(stream, subtitles) { entry.subtitles = subtitles || []; success(entry.stream = stream); }
                if (moonPage(variant.page)) {
                    entry.url = variant.page; // the Moon player switch on TVs looks at the episode's own page
                    return moonStream(variant.page, function (stream, subtitles, quality) { entry.streamAt = Date.now(); entry.quality = quality || entry.quality || 0; done(stream, subtitles); }, failure);
                }
                if (zetPage(variant.page)) return zetStream(variant.page, done, failure);
                ashdiStream(variant.page, done, failure);
            }, failure);
        }

        // 3. episode list with watch progress; the whole list becomes the player's playlist
        function resolveEntry(entry, success, failure) {
            if (entry.supported === false) return failure('плеєр ' + entry.player + ' поки не підтримується');
            if (entry.stream && (!moonPage(entry.url) || moonStreamFresh(entry))) return success(entry.stream);
            if (source === 'uafilms' && entry.ref && entry.ref.variant) return uafilmsStream(entry, success, failure);
            if (source === 'uafix') return uafixStream(entry.url, entry.kind, function (stream, subtitles) { entry.subtitles = subtitles; success(entry.stream = stream); }, failure);
            if (source === 'dorama') return doramaStream(entry.ref, function (stream, subtitles) { entry.subtitles = subtitles; success(entry.stream = stream); }, failure);
            if (source === 'animeon') return animeonStream(entry.ref, entry.wantSubtitles, function (stream, subtitles) { entry.subtitles = subtitles; success(entry.stream = stream); }, failure);
            if (media(entry.url)) return success(entry.stream = entry.url);
            if (moonPage(entry.url)) return moonStream(entry.url, function (stream, subtitles, quality) { entry.streamAt = Date.now(); entry.subtitles = subtitles; entry.quality = quality || entry.quality || 0; success(entry.stream = stream); }, failure);
            if (!ashdiPage(entry.url)) return failure('плеєр не підтримується');
            ashdiStream(entry.url, function (stream, subtitles) { entry.subtitles = subtitles; success(entry.stream = stream); }, failure);
        }

        this.resolve = function (entry, success, failure) {
            if (entry.stream && (!moonPage(entry.url) || moonStreamFresh(entry))) return success(entry.stream);
            if (entry.resolving) { entry.resolving.push([success, failure]); return; }
            entry.resolving = [[success, failure]];
            var done = false;
            var limit = source === 'uafilms' ? 45 : 20;
            var timer = setTimeout(function () { finish('', 'джерело не відповіло за ' + limit + ' секунд'); }, limit * 1000);
            function finish(url, why) {
                if (done) return;
                done = true; clearTimeout(timer);
                var listeners = entry.resolving; entry.resolving = null;
                listeners.forEach(function (pair) { if (url) pair[0](url); else pair[1](why); });
            }
            resolveEntry(entry, function (url) { finish(url, ''); }, function (why) { finish('', why); });
        };

        this.play = function (index) {
            if (closed) return;
            var entry = entries[index];
            if (!entry || entry.loading) return;
            if (entry.supported === false) return Lampa.Noty.show('AniTube: плеєр ' + entry.player + ' поки не підтримується. Обери інший плеєр угорі.');
            var mine = openSeq, playingToken = token, request = ++playSeq;
            entry.loading = true; launching = true;
            self.activity.loader(true);
            Lampa.Noty.show('AniTube v' + VERSION + ' · ' + entry.info.label + (source === 'uafilms' && !entry.stream ? ' · UAFilms шукає серію, вперше це може тривати до 30 секунд' : ''));
            // Lampa's external (Android) player is handed only playlist items whose url is a plain string, so lazy
            // links would be dropped and "next" would do nothing. Resolve a window around this episode up front;
            // the rest stays lazy for Lampa's built-in player.
            var behind = PLAYLIST_BEHIND, ahead = PLAYLIST_AHEAD;
            if (source === 'uafix') { behind = UAFIX_BEHIND; ahead = UAFIX_AHEAD; }
            if (source === 'uafilms') { behind = 0; ahead = 0; }
            if (source === 'animeon') { behind = ANIMEON_BEHIND; ahead = ANIMEON_AHEAD; }
            if (source === 'dorama') { behind = DORAMA_BEHIND; ahead = DORAMA_AHEAD; }
            var android = Lampa.Platform && Lampa.Platform.is('android');
            var from = android ? Math.max(0, index - behind) : index, to = android ? Math.min(entries.length - 1, index + ahead) : index;
            var pending = to - from + 1, failure = '', selectedFailure = '', failed = [], started = false, grace = null;
            // The chosen episode starts as soon as its own address is ready. Neighbours get NEIGHBOUR_GRACE more;
            // one slow neighbour used to hold the whole start for up to 25 seconds. Late ones stay lazy items.
            function settled(next, why) {
                pending--;
                if (why) failed.push(next);
                if (next === entry && pending > 0 && !why) grace = setTimeout(launch, NEIGHBOUR_GRACE);
                if (pending <= 0 || (next === entry && why)) launch();
            }
            function launch() {
                if (started) return;
                started = true; clearTimeout(grace);
                entry.loading = false;
                if (closed || mine !== openSeq || playingToken !== token || request !== playSeq) return;
                self.activity.loader(false);
                if (!entry.stream || selectedFailure) {
                    launching = false;
                    playbackStatus(moonPage(entry.url) ? 'AT-M1' : 'AT-P1', 'Не вдалося отримати відео: ' + reason(selectedFailure || failure) + '. Спробуй іншу серію чи плеєр.');
                    return;
                }
                try { if (movie.id) Lampa.Favorite.add('history', movie, 100); } catch (e) {}
                // Lampa's player prints the card's title above the episode; a card without a translation shows the original name.
                var shown = (item && source !== 'anilibria' && item.title) || displayName(); // AniLibria's own titles are Russian
                var card = Object.assign({}, movie, {title: shown, name: shown});
                playbackStatus('', '');
                var first = Object.assign({title: entry.title, timeline: entry.timeline, card: card, anitube_owner: playbackOwner, anitube_version_shown: true, anitube_moon: !!moonPage(entry.url)}, playerFile(entry));
                if (entry.subtitles && entry.subtitles.length) first.subtitles = entry.subtitles;
                var playlist = [];
                entries.forEach(function (other, n) {
                    if (n === index) return playlist.push(first);
                    if (android && other.stream) return playlist.push(Object.assign({title: other.title, timeline: other.timeline, card: card, anitube_owner: playbackOwner, anitube_moon: !!moonPage(other.url), subtitles: other.subtitles && other.subtitles.length ? other.subtitles : undefined}, playerFile(other)));
                    if (android && failed.indexOf(other) >= 0 && !moonPage(other.url)) return; // resolution failed, leave it out
                    var cell = {
                        title: other.title,
                        timeline: other.timeline,
                        card: card,
                        anitube_owner: playbackOwner, anitube_moon: !!moonPage(other.url),
                        url: function (call) {
                            self.resolve(other, function (url) {
                                function ready() { Object.assign(cell, playerFile(other)); if (other.subtitles && other.subtitles.length) cell.subtitles = other.subtitles; call(); }
                                prepareStream(other, url, ready);
                            }, function () { cell.url = ''; call(); });
                        }
                    };
                    playlist.push(cell);
                });
                if (first.anitube_moon) useMoonPlayer();
                if (first.anitube_native_prepared) useNativePlayback(playbackOwner);
                cleanPlayer(true);
                Lampa.Player.play(first);
                // The playlist lets the player's next/previous buttons switch episodes without leaving it.
                Lampa.Player.playlist(playlist);
            }
            for (var n = from; n <= to; n++) (function (next) {
                var done = false;
                var wait = source === 'uafilms' ? 50 : 25;
                var deadline = setTimeout(function () { finish('сервер не відповів за ' + wait + ' секунд'); }, wait * 1000);
                function finish(why) {
                    if (done) return;
                    done = true; clearTimeout(deadline);
                    if (why && !failure) failure = why;
                    if (why && next === entry) selectedFailure = why;
                    settled(next, why);
                }
                self.resolve(next, function (url) {
                    prepareStream(next, url, function () { finish(''); });
                }, finish);
            })(entries[n]);
        };

        this.start = function (first) {
            if (closed || !active()) return;
            try { Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur ? Lampa.Utils.cardImgBackgroundBlur(movie) : Lampa.Utils.cardImgBackground(movie)); } catch (e) {}
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    if (rows.length) focusAt(cur.r, cur.c);
                },
                up: function () { if (cur.r <= 0) Lampa.Controller.toggle('head'); else focusAt(cur.r - 1, rows[cur.r - 1].length > cur.c ? cur.c : 0); },
                down: function () { if (cur.r < rows.length - 1) focusAt(cur.r + 1, 0); },
                left: function () { if (cur.c > 0) focusAt(cur.r, cur.c - 1); else Lampa.Controller.toggle('menu'); },
                right: function () { if (rows[cur.r] && cur.c < rows[cur.r].length - 1) focusAt(cur.r, cur.c + 1); },
                enter: function () { var el = rows[cur.r] && rows[cur.r][cur.c]; if (el) $(el).trigger('hover:enter'); },
                back: this.back
            });
            Lampa.Controller.toggle('content');
        };

        this.render = function () { return html; };
        this.back = function () { Lampa.Activity.backward(); };
        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {
            closed = true;
            if (moonWatchStop) moonWatchStop();
            if (moonQualityStop) moonQualityStop();
            if (playbackListener && Lampa.Player.listener && Lampa.Player.listener.remove) Lampa.Player.listener.remove('start', playbackListener);
            if (playerCloseListener && Lampa.Player.listener && Lampa.Player.listener.remove) Lampa.Player.listener.remove('destroy', playerCloseListener);
            cleanPlayer(false);
            restoreNativePlayback(playbackOwner);
            try { scroll.destroy(); } catch (e) {}
            if (html) html.remove();
            html = null;
        };
    }

    function open(movie) {
        Lampa.Component.add(COMPONENT, component);
        Lampa.Activity.push({url: '', title: 'AniTube', component: COMPONENT, movie: movie || {}, page: 1});
    }
    function addTemplates() {
        // Look copied from the UAKino series page. No flex "gap": the TV's old browser ignores it, so spacing is done with margins.
        $('head').append('<style>' +
            '.atp{height:100%}.atp__body{padding:1.2em 3em 3em 4.2em}' +
            '.anitube-player .player-panel__next-episode-name,.anitube-player .player-info__error,.anitube-player .value--stat{display:none!important}' +
            '.atp__head{margin-bottom:1em}.atp__title{font-size:2.4em;font-weight:800;line-height:1.1}.atp__meta{margin-top:.35em;opacity:.6;font-size:1.15em}' +
            '.atp__row{display:flex;flex-wrap:wrap;margin-bottom:.4em}' +
            '.atp-chip{display:flex;align-items:baseline;padding:.6em 1.2em;margin:0 .7em .7em 0;border-radius:2em;background:rgba(255,255,255,.1);font-size:1.15em;font-weight:600}' +
            '.atp-chip--sort svg{display:block;width:2em;height:1.3em}.atp-chip--sort .atp-chip__v{display:none}' +
            '.atp-chip__v{margin-left:.55em;opacity:.65;font-weight:500}' +
            '.atp-icon{display:inline-block;width:.85em;height:.85em;vertical-align:middle}.atp-chip__v .atp-icon{margin-left:.45em}.atp-ep__st .atp-icon{margin-right:.4em}' +
            '.atp-chip--on{background:#1F6FEB;color:#fff}.atp-chip--on .atp-chip__v{opacity:.85}' +
            '.atp-chip.focus{background:#fff;color:#0b0d12}.atp-chip.focus .atp-chip__v{opacity:.7}' +
            '.atp-playback-status{padding:.5em 0;font-size:1.1em;color:#f0cd8c}.atp-playback-status:empty{display:none}' +
            '.atp__list{margin-top:.8em}.atp__note{opacity:.7;font-size:1.2em;padding:1em 0}' +
            '.atp-ep{display:flex;align-items:stretch;padding:.7em;margin-bottom:.7em;border-radius:1em;background:rgba(255,255,255,.06)}' +
            '.atp-ep__img{position:relative;flex:0 0 13em;height:7.4em;margin-right:1.2em;border-radius:.7em;overflow:hidden;background:linear-gradient(135deg,#1c2230,#10131b)}' +
            '.atp-ep__img img{width:100%;height:100%;object-fit:cover;display:block}' +
            '.atp-ep__num{position:absolute;left:.4em;top:.3em;font-weight:800;font-size:1.4em;text-shadow:0 1px 6px rgba(0,0,0,.8)}' +
            '.atp-ep__bar{position:absolute;left:0;right:0;bottom:0;height:.35em;background:rgba(255,255,255,.25)}.atp-ep__bar i{display:block;height:100%;background:#1F6FEB}' +
            '.atp-ep__body{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}' +
            '.atp-ep__name{font-size:1.35em;font-weight:700}.atp-ep__meta{margin-top:.3em;opacity:.6;font-size:1.05em}' +
            '.atp-ep__descr{margin-top:.3em;opacity:.55;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
            '.atp-ep__st{align-self:center;margin-left:1em;white-space:nowrap;font-weight:700;padding:.3em .8em;border-radius:1.4em;background:rgba(255,255,255,.12)}' +
            '.atp-ep__st--go{background:#1F6FEB;color:#fff}.atp-ep__st--ok{color:#7ddc8a}' +
            '.atp-ep.focus{background:#fff;color:#0b0d12}.atp-ep.focus .atp-ep__meta,.atp-ep.focus .atp-ep__descr{opacity:.7}' +
            '.atp-ep.focus .atp-ep__st{background:rgba(0,0,0,.1)}.atp-ep.focus .atp-ep__st--go{background:#1F6FEB;color:#fff}' +
            'body.true--mobile .atp-ep__img{flex-basis:8em;height:4.8em}body.true--mobile .atp-ep__descr{display:none}' +
            '</style>');
    }
    // Settings → AniTube: address of the home-network helper, only needed on TVs that cannot reach AniTube themselves.
    function addSettings() {
        try {
            if (!Lampa.SettingsApi || Lampa.SettingsApi.getComponent && Lampa.SettingsApi.getComponent('anitube')) return;
            Lampa.SettingsApi.addComponent({component: 'anitube', icon: ICON, name: 'AniTube'});
            Lampa.SettingsApi.addParam({
                component: 'anitube',
                param: {name: 'anitube_version', type: 'button'},
                field: {name: 'Версія ' + VERSION, description: 'Фактично завантажена версія AniTube.'},
                onChange: function () { Lampa.Noty.show('AniTube v' + VERSION); }
            });
            Lampa.SettingsApi.addParam({
                component: 'anitube',
                param: {name: 'anitube_russian', type: 'trigger', 'default': false},
                field: {name: 'Показувати російські джерела', description: 'Вимкнено: лише українські джерела. Увімкнено: додається AniLibria (російська озвучка, вищий бітрейт).'}
            });
            Lampa.SettingsApi.addParam({
                component: 'anitube',
                param: {name: 'anitube_auto_quality', type: 'trigger', 'default': true},
                field: {name: 'Знижувати якість Moon при поганому зв\'язку', description: 'Увімкнено: якщо відео зависає, якість падає на один крок. Вимкнено: завжди максимальна якість. Лише для Moon на ТВ.'}
            });
            Lampa.SettingsApi.addParam({
                component: 'anitube',
                param: {name: 'anitube_reset', type: 'button'},
                field: {name: 'Забути запам\'ятовані вибори', description: 'Ручні назви пошуку, вибраний тайтл, озвучення й джерело для всіх карток. Пошук почнеться з нуля.'},
                onChange: function () {
                    Lampa.Storage.set('anitube_choice', {});
                    Lampa.Noty.show('AniTube: збережені вибори скинуто');
                }
            });
            Lampa.SettingsApi.addParam({
                component: 'anitube',
                param: {name: 'anitube_box', type: 'input', values: '', 'default': '', placeholder: '192.168.0.15:8787'},
                field: {name: 'Адреса приставки', description: 'Android-приставка вдома з ретранслятором (home-proxy/box-relay.mjs). Потрібна на Smart TV для UAflix і DoramaUA. Адреса змінюється, коли приставку переносять в іншу мережу.'}
            });
            Lampa.SettingsApi.addParam({
                component: 'anitube',
                param: {name: 'anitube_box_check', type: 'button'},
                field: {name: 'Перевірити приставку', description: 'Показує, чи приставка відповідає і до яких сайтів вона дістається.'},
                onChange: function () { boxCheck(); }
            });
            Lampa.SettingsApi.addParam({
                component: 'anitube',
                param: {name: 'anitube_proxy', type: 'input', values: '', 'default': '', placeholder: 'http://192.168.0.10:8787'},
                field: {name: 'Адреса проксі', description: 'Не потрібна: у плагін уже вшито робочу адресу. Заповнюй лише щоб підставити власний проксі.'}
            });
            Lampa.SettingsApi.addParam({
                component: 'anitube',
                param: {name: 'anitube_proxy_key', type: 'input', values: '', 'default': '', placeholder: 'ключ доступу'},
                field: {name: 'Ключ проксі', description: 'Потрібен лише разом із власною адресою проксі (ACCESS_KEY).'}
            });
        } catch (e) {}
    }
    function addCardButton(event) {
        if (!event.object || !event.object.activity) return;
        var root = event.object.activity.render();
        var movie = event.data && event.data.movie;
        if (!movie || root.find('.anitube-card-button').length) return;

        var button = $('<div class="full-start__button selector view--anitube anitube-card-button">' + ICON + '<span>AniTube</span></div>');
        button.on('hover:enter', function () { open(movie); });

        // Match established Lampa online plugins: attach to the card's torrent button.
        var anchor = root.find('.view--torrent').first();
        if (anchor.length) anchor.after(button);
        else {
            var buttons = root.find('.full-start-new__buttons, .full-start__buttons').first();
            if (buttons.length) buttons.append(button);
        }
    }
    function start() {
        if (window.plugin_anitube_prototype_ready) return;
        window.plugin_anitube_prototype_ready = true;
        restoreMoonPlayer();
        addTemplates();
        addSettings();
        // Registered up front so Lampa can restore the screen after a restart.
        Lampa.Component.add(COMPONENT, component);
        Lampa.Listener.follow('full', function (event) {
            if (event.type === 'complite') addCardButton(event);
        });
        Lampa.Manifest.plugins = {
            type: 'video',
            version: VERSION,
            name: 'AniTube',
            description: 'Озвучення, субтитри та серії з AniTube, Makhno, AnimeOn, UAflix і DoramaUA',
            onContextMenu: function () {
                return {name: 'AniTube', description: 'Актуальний пошук на anitube.in.ua'};
            },
            onContextLauch: function (movie) {
                open(movie);
            }
        };
    }
    // Lampa loads plugins after its API is available; register immediately as Online_Mod does.
    start();
}());
