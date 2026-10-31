/* AniTube for Lampa 1.0. Sources: AniTube, AnimeOn (through a public Lampa-plugin aggregator), uafix. Series page laid out like the UAKino plugin's.
   No provider scripts are executed. */
(function () {
    'use strict';
    var HOME = 'https://anitube.in.ua/';
    var API = 'https://anitube-lampa-proxy.netlify.app/.netlify/functions/anitube';
    var COMPONENT = 'anitube';
    var VERSION = '1.0.0';
    var PLAYLIST_AHEAD = 15, PLAYLIST_BEHIND = 3;
    // uafix needs one page request per episode, so its window around the chosen episode is smaller.
    var UAFIX_AHEAD = 6, UAFIX_BEHIND = 1;
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
        if (!match || !match[2]) return [];
        return match[2].split(',').map(function (part) {
            var item = part.match(/^\s*\[([^\]]+)\]\s*(https:\/\/\S+?)\s*$/);
            var address = item && absolute(item[2], 'https://' + host + '/');
            if (!address || new URL(address).hostname !== host || !/\.(vtt|srt)(?:[?#]|$)/i.test(address)) return null;
            return {label: item[1].trim(), url: address};
        }).filter(Boolean);
    }
    function ashdiStream(url, success, failure) {
        function read(html, fail) {
            var match = String(html).match(/\bfile\s*:\s*(["'])(https:\/\/ashdi\.vip\/[^"']+?\.m3u8[^"']*)\1/i);
            var stream = match && absolute(match[2], url);
            if (stream && new URL(stream).hostname === 'ashdi.vip' && media(stream)) success(stream, playerSubtitles(html, 'ashdi.vip'));
            else if (String(html).indexOf('Змініть країну перегляду') !== -1) fail('Ashdi не пускає країну цього сервера');
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
            return {title: title, url: url, note: 'uafix'};
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
    function uafixPlayer(html) {
        var match = String(html).match(/<iframe\b[^>]*\bsrc=["'](https:\/\/(?:zetvideo\.net|ashdi\.vip)\/vod\/\d+)["']/i);
        return match ? match[1] : '';
    }
    function zetPage(value) {
        try {
            var page = new URL(value);
            return page.protocol === 'https:' && page.hostname === 'zetvideo.net' && !page.port && /^\/vod\/\d+$/.test(page.pathname);
        } catch (e) { return false; }
    }
    function proxyUafix(action, value, success, failure) {
        $.ajax({url: homeUrl(homeProxy(), 'uf/' + action, action === 'search' ? 'q' : 'url', value), dataType: action === 'episode' ? 'json' : 'text',
            timeout: 25000, cache: false, success: success, error: failure});
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
            var player = uafixPlayer(html);
            if (player) success(player); else failure('на сторінці серії немає плеєра');
        }, function (e) {
            proxyUafix('episode', url, function (data) {
                var player = data && uafixPlayer('<iframe src="' + data.player + '">');
                if (player) success(player); else failure('на сторінці серії немає плеєра');
            }, function (xhr) {
                // Off Ukrainian addresses uafix shows only a trailer instead of the player, so the relay finds no player on the page.
                if (xhr && /player_missing/.test(String(xhr.responseText || ''))) return failure('uafix показує плеєр лише на українських адресах, через проксі серія недоступна');
                failure(failureText(xhr, reason(e)));
            });
        });
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
    function uafixStream(episodeUrl, success, failure) {
        uafixEpisodePlayer(episodeUrl, function (player) {
            if (zetPage(player)) zetStream(player, success, failure);
            else if (ashdiPage(player)) ashdiStream(player, success, failure);
            else failure('плеєр не підтримується');
        }, failure);
    }

    // ---- Third source: AnimeOn (animeon.club) through the aggregator behind the "Bandera Online" Lampa plugin -------------
    // That server lists AnimeOn's titles and voices and turns an episode into an Ashdi stream address. It answers browsers from any
    // site (CORS), so TVs call it directly. It is someone else's service: if it changes or disappears this source stops working.
    var ANIMEON_API = 'https://bbe.lme.isroot.in/api/v2';
    var SOURCE_NAMES = {anitube: 'AniTube', animeon: 'AnimeOn', uafix: 'uafix'};
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
    function animeonCatalog(data) {
        var seen = {};
        return ((data && data.items) || []).map(function (item) {
            var ref = item && item.ref;
            if (!item || item.source !== 'animeon' || !ref || !/^\d{1,10}$/.test(String(ref.id))) return null;
            var url = 'animeon:' + ref.id + ':' + (ref.season || 1);
            if (seen[url]) return null;
            seen[url] = true;
            var title = String(item.title || '').replace(/\s+/g, ' ').trim();
            if (!title) return null;
            var year = String(item.year || '');
            return {title: title, url: url, note: [year, item.title_en].filter(Boolean).join(' · '), year: year, ref: {id: ref.id, season: ref.season || 1}};
        }).filter(Boolean);
    }
    // Only voices that come as an Ashdi player are kept, the one player this plugin can play. "[Ashdi] Рідний Голос" becomes "Рідний Голос".
    function animeonVoices(data, season) {
        return ((data && data.voices) || []).map(function (voice) {
            var name = String(voice.display_name || voice.id || '');
            if (!/^\[Ashdi\]/i.test(name)) return null;
            var seasons = voice.seasons || [];
            var chosen = seasons.filter(function (entry) { return Number(entry.title) === Number(season); })[0] || seasons[0];
            var episodes = ((chosen && chosen.episodes) || []).filter(function (e) { return e && e.number && e.ref && e.ref.episode_id; }).map(function (e) {
                return {title: 'Серія ' + e.number, url: 'animeon:' + e.ref.episode_id, ref: e.ref, subtitles: true};
            });
            return episodes.length ? {label: name.replace(/^\[Ashdi\]\s*/i, '').replace(/\s*\|\s*/g, ' · ').trim(), episodes: episodes} : null;
        }).filter(Boolean);
    }
    function animeonStream(ref, wantSubtitles, success, failure) {
        animeonCall('/stream', null, {source: 'animeon', ref: ref}, function (data) {
            var stream = data && data.ok && data.streams && data.streams[0] && absolute(data.streams[0].url, 'https://ashdi.vip/');
            if (!(stream && new URL(stream).hostname === 'ashdi.vip' && media(stream))) return failure((data && data.error) || 'немає потоку');
            var id = (stream.match(/_(\d{4,10})\/hls\//) || [])[1];
            if (!wantSubtitles || !id) return success(stream, []);
            // A missing subtitle file must never block the episode.
            ashdiStream('https://ashdi.vip/vod/' + id, function (ignored, subtitles) { success(stream, subtitles || []); }, function () { success(stream, []); });
        }, function (xhr) { failure(xhr && xhr.status ? 'AnimeOn: HTTP ' + xhr.status : 'AnimeOn: сервер не відповідає'); });
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
        return '(напряму: ' + directReason + '; ' + status + ')' + hint;
    }

    // ---- Names ---------------------------------------------------------------------------------------------------
    function unique(values) { return values.filter(function (v, i) { return v && values.indexOf(v) === i; }); }
    // Names to search for, best first. Card titles can be whole sentences (the helpers refuse queries over 200 characters and
    // AniTube's search finds nothing for them anyway), so a long title is cut to its first words and only that is tried.
    function searchTerms(movie) {
        var terms = [];
        [movie.title, movie.original_title, movie.name, movie.original_name].forEach(function (name) {
            var clean = String(name || '').replace(/\s+/g, ' ').trim();
            if (!clean) return;
            if (clean.length > 60) {
                var words = clean.split(' ');
                clean = words.slice(0, 5).join(' ');
                if (clean.length > 60) clean = clean.slice(0, 60).replace(/\s+\S*$/, '');
            }
            terms.push(clean);
        });
        return unique(terms);
    }
    function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/g, ' ').trim(); }
    function sentence(value) {
        var low = String(value || '').toLowerCase();
        return low.charAt(0).toUpperCase() + low.slice(1);
    }
    // "ОЗВУЧЕННЯ" + "QTV" -> "Озвучення · QTV"
    function voiceLabel(source) { return sentence(source.mode) + (source.variant ? ' · ' + source.variant : ''); }
    // Episode title as AniTube lists it: "12 серія" becomes "Серія 12"; "OVA 1", "Фільм" and the like stay as they are.
    // The number is also used as the watch-progress key, so it is read from the title only (stream file names do not match AniTube's numbering).
    function episodeInfo(raw) {
        var title = String(raw || '').replace(/\s+/g, ' ').trim();
        var plain = title.match(/^(?:серія\s*)?(\d+)\s*(?:серія|серії|серій|епізод|ep\.?|episode)?$/i);
        var number = plain ? parseInt(plain[1], 10) : 0;
        return {number: number, label: plain ? 'Серія ' + number : title, original: title};
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

        function saved(key) { var all = Lampa.Storage.get('anitube_choice', '{}'); return (all && all[key]) || {}; }
        function remember(key, value) {
            var all = Lampa.Storage.get('anitube_choice', '{}');
            if (!all || typeof all !== 'object') all = {};
            all[key] = Object.assign(all[key] || {}, value);
            Lampa.Storage.set('anitube_choice', all);
        }
        var key = String(movie.id || movie.original_title || movie.title || '');
        // The source is remembered per card. While none is remembered and a search finds nothing, the next one in ORDER is tried.
        var source = SOURCE_NAMES[saved(key).source] ? saved(key).source : 'anitube', fellBack = !!saved(key).source;
        var ORDER = ['anitube', 'animeon', 'uafix'];
        var seasons = {}, season = 0;
        function active() { return Lampa.Activity.active() && Lampa.Activity.active().activity === self.activity; }

        function focusAt(r, c) {
            if (!rows.length) return;
            r = Math.max(0, Math.min(rows.length - 1, r));
            c = Math.max(0, Math.min(rows[r].length - 1, c));
            cur.r = r; cur.c = c;
            var el = rows[r][c];
            // The set of focusable elements is remembered once by Lampa, and the list is redrawn, so read it again before focusing.
            Lampa.Controller.collectionSet(scroll.render());
            Lampa.Controller.collectionFocus(el, scroll.render());
            try { scroll.update($(el), true); } catch (e) {}
        }
        function chip(label, value, on, enter) {
            var node = $('<div class="atp-chip selector' + (on ? ' atp-chip--on' : '') + '"><span class="atp-chip__l"></span><span class="atp-chip__v"></span></div>');
            node.find('.atp-chip__l').text(label);
            node.find('.atp-chip__v').text(value || '');
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
            var found = String(result.title || '').match(/(\d+)\s*(?:-?й\s*)?(?:сезон|season)|(?:сезон|season)\s*(\d+)/i);
            return found ? parseInt(found[1] || found[2], 10) : 0;
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
            if (source === 'uafix') return season;
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

        this.create = function () {
            html = $('<div class="atp"></div>');
            scroll = new Lampa.Scroll({mask: true, over: true, step: 250});
            try { scroll.minus(); } catch (e) {}
            body = $('<div class="atp__body"></div>');
            scroll.append(body);
            html.append(scroll.render());
            this.activity.loader(true);
            manual = saved(key).query || '';
            this.search(0);
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
            head.find('.atp__meta').text(meta.join(' · '));
            body.append(head);

            var first = [];
            if (voice) {
                first.push(chip('Озвучення', voice.label + (voices.length > 1 ? ' ▾' : ''), false, function () {
                    if (voices.length < 2) return Lampa.Noty.show('Для цього тайтлу лише один варіант озвучення');
                    Lampa.Select.show({
                        title: 'Озвучення / субтитри',
                        items: voices.map(function (v, index) { return {title: v.label, subtitle: 'Серій: ' + v.episodes.length, selected: index === voiceIndex, index: index}; }),
                        onBack: function () { Lampa.Controller.toggle('content'); },
                        onSelect: function (picked) {
                            voiceIndex = picked.index;
                            remember(key, {voice: voices[voiceIndex].label});
                            Lampa.Controller.toggle('content');
                            self.draw();
                            focusAt(0, 0);
                        }
                    });
                }));
            }
            first.push(chip('Джерело', SOURCE_NAMES[source] + ' ▾', false, function () {
                Lampa.Select.show({
                    title: 'Джерело серій',
                    items: [
                        {title: 'AniTube', subtitle: 'озвучення й субтитри, Ashdi', selected: source === 'anitube', value: 'anitube'},
                        {title: 'AnimeOn', subtitle: 'багато озвучок, є новинки аніме', selected: source === 'animeon', value: 'animeon'},
                        {title: 'uafix', subtitle: 'серіали й фільми, лише з України', selected: source === 'uafix', value: 'uafix'}
                    ],
                    onBack: function () { Lampa.Controller.toggle('content'); },
                    onSelect: function (picked) {
                        Lampa.Controller.toggle('content');
                        if (picked.value !== source) self.switchSource(picked.value);
                    }
                });
            }));
            first.push(chip('Пошук', manual || '', false, function () { self.ask(); }));
            addRow(first);

            if (source === 'uafix') {
                var numbers = Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; });
                if (numbers.length > 1) {
                    addRow(numbers.map(function (number) {
                        return chip('Сезон ' + number, '', number === season, function () {
                            if (number === season) return;
                            remember(key, {season: number});
                            self.useSeason(number);
                        });
                    }));
                }
            } else if (results.length > 1 && item) {
                addRow(results.map(function (result) {
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
            entries = voice.episodes.map(function (episode) {
                var info = episodeInfo(episode.title);
                var hash = Lampa.Utils.hash(item.url + (source === 'uafix' ? '#s' + season : '') + ':' + (info.number || info.original));
                return {url: episode.url, ref: episode.ref, wantSubtitles: episode.subtitles, info: info, title: info.label + ' · ' + item.title, timeline: Lampa.Timeline.view(hash)};
            });
            var lastWatched = -1;
            entries.forEach(function (entry, index) { if (entry.timeline.percent > 0) lastWatched = index; });
            var target = lastWatched < 0 ? 0 : (entries[lastWatched].timeline.percent >= 90 ? Math.min(lastWatched + 1, entries.length - 1) : lastWatched);

            var list = $('<div class="atp__list"><div class="atp__note">Завантажуємо серії…</div></div>');
            body.append(list);
            var firstRow = rows.length;
            loadSeason(tmdbSeason()).then(function (tm) {
                if (closed || current !== token) return;
                // The stills and descriptions are only used when TMDB's season is about as long as AniTube's list, so they cannot belong to another season.
                var count = tm.__count || 0, fits = count && Math.abs(count - entries.length) <= Math.max(2, Math.round(count * 0.2));
                list.empty();
                entries.forEach(function (entry, index) {
                    var t = (fits && entry.info.number && tm[entry.info.number]) || {};
                    var percent = Math.min(100, entry.timeline.percent || 0);
                    var date = t.air_date || '', runtime = t.runtime ? t.runtime + ' хв' : '';
                    var node = $('<div class="atp-ep selector"><div class="atp-ep__img"><div class="atp-ep__num"></div></div><div class="atp-ep__body"><div class="atp-ep__name"></div><div class="atp-ep__meta"></div><div class="atp-ep__descr"></div></div></div>');
                    var picture = t.still_path || movie.backdrop_path;
                    if (picture) {
                        var img = $('<img loading="lazy">');
                        img.attr('src', Lampa.TMDB.image('t/p/w300' + picture));
                        node.find('.atp-ep__img').append(img);
                    }
                    node.find('.atp-ep__num').text(entry.info.number || '');
                    if (percent > 0 && percent < 90) node.find('.atp-ep__img').append('<div class="atp-ep__bar"><i style="width:' + percent + '%"></i></div>');
                    var own = t.name && !/^\s*(серія|епізод|episode)\s*\d+\s*$/i.test(t.name);
                    node.find('.atp-ep__name').text(own ? entry.info.label + ' · ' + t.name : entry.info.label);
                    node.find('.atp-ep__meta').text([voice.label, date, runtime].filter(Boolean).join(' · '));
                    node.find('.atp-ep__descr').text(t.overview || '');
                    if (percent >= 90) node.append($('<div class="atp-ep__st atp-ep__st--ok"></div>').text('✓ Переглянуто'));
                    else if (index === target && percent > 0) node.append($('<div class="atp-ep__st atp-ep__st--go"></div>').text('Продовжити'));
                    node.on('hover:enter', function () { self.play(index); });
                    list.append(node);
                    rows.push([node[0]]);
                });
                try { Lampa.Layer.update(); } catch (e) {}
                if (self.focusEpisode) { self.focusEpisode = false; focusAt(firstRow + target, 0); }
            });
        };

        this.ask = function () {
            Lampa.Input.edit({free: true, title: 'Пошук на AniTube', nosave: true, value: manual}, function (value) {
                Lampa.Controller.toggle('content');
                value = String(value || '').trim();
                if (!value) return;
                // AniTube often names a show differently from the card, so the title can be typed by hand (and is remembered).
                manual = value;
                remember(key, {query: manual, title: ''});
                results = []; item = null; voices = [];
                self.loading(true);
                self.search(0);
            });
        };

        // 1. find the title on AniTube (the card's own names, then the original ones)
        this.search = function (queryIndex) {
            var queries = manual ? [manual] : searchTerms(movie);
            if (source === 'uafix') return this.searchUafix(queries, queryIndex);
            if (source === 'animeon') return this.searchAnimeon(queries);
            if (queryIndex >= queries.length) {
                if (this.nextSource()) return this.search(0);
                return this.empty(manual ? 'AniTube: за запитом «' + manual + '» нічого не знайдено. Спробуй інше слово через «Пошук» угорі.'
                    : 'AniTube: за назвою цієї картки нічого не знайдено. Натисни «Пошук» угорі й введи назву так, як вона на AniTube (часто достатньо одного слова).');
            }
            fetchText('search', queries[queryIndex], function (html) {
                if (closed) return;
                var found = catalog(html);
                if (!found.length) return self.search(queryIndex + 1);
                self.found(found, queries);
            }, function (xhr, why) {
                if (closed) return;
                // A 400 is about this particular query (e.g. too long); another name of the card may still work.
                if (xhr && xhr.status === 400 && queryIndex + 1 < queries.length) return self.search(queryIndex + 1);
                self.empty('AniTube: не вдалося отримати результати пошуку ' + failureText(xhr, why) + '.');
            });
        };

        // When nothing is found and the source was not chosen by hand, the next one in ORDER is searched.
        this.nextSource = function () {
            var next = ORDER[ORDER.indexOf(source) + 1];
            if (manual || fellBack || !next) return false;
            source = next;
            return true;
        };

        this.searchAnimeon = function (queries) {
            var imdb = String(movie.imdb_id || '');
            animeonCall('/search', {
                sources: 'animeon', source: 'animeon',
                title: manual || queries[0] || '',
                original_title: manual ? '' : (queries[1] || ''),
                imdb_id: manual || !/^tt\d+$/.test(imdb) ? '' : imdb
            }, null, function (data) {
                if (closed) return;
                var found = animeonCatalog(data);
                if (found.length) return self.found(found, queries);
                if (self.nextSource()) return self.search(0);
                self.empty('AnimeOn: за ' + (manual ? 'запитом «' + manual + '»' : 'назвою цієї картки') + ' нічого не знайдено. Спробуй інше слово через «Пошук» або інше джерело.');
            }, function (xhr) {
                if (!closed) self.empty('AnimeOn: сервер не відповів' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') + '.');
            });
        };

        this.searchUafix = function (queries, queryIndex) {
            if (queryIndex >= queries.length) {
                if (this.nextSource()) return this.search(0);
                return this.empty('uafix: за ' + (manual ? 'запитом «' + manual + '»' : 'назвою цієї картки') + ' нічого не знайдено. Спробуй інше слово через «Пошук» або інше джерело.');
            }
            uafixGet('search', queries[queryIndex], function (html) {
                if (closed) return;
                var found = uafixCatalog(html);
                if (!found.length) return self.searchUafix(queries, queryIndex + 1);
                self.found(found, queries);
            }, function (xhr, why) {
                if (closed) return;
                if (xhr && xhr.status === 400 && queryIndex + 1 < queries.length) return self.searchUafix(queries, queryIndex + 1);
                self.empty('uafix: не вдалося отримати результати пошуку ' + failureText(xhr, why) + '.');
            });
        };

        // Picking another source starts the search again from the card's own names.
        this.switchSource = function (name) {
            source = name;
            fellBack = true;
            remember(key, {source: name, title: ''});
            results = []; item = null; voices = []; seasons = {}; season = 0;
            this.loading(true);
            this.search(0);
        };

        this.empty = function (message) {
            if (source === 'anitube') message += ' Можна вибрати інше джерело (AnimeOn, uafix) у чипі «Джерело».';
            this.draw(message);
            this.loading(false);
            this.start(true);
        };

        this.found = function (found, queries) {
            results = found;
            var wanted = saved(key).title;
            var chosen = found.filter(function (r) { return r.url === wanted; })[0];
            if (!chosen && found.length === 1) chosen = found[0];
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
        this.openTitle = function (selectedTitle, keepFocusOnSeasons) {
            item = selectedTitle;
            remember(key, {title: item.url});
            this.loading(true);
            if (source === 'uafix') return this.openUafix();
            if (source === 'animeon') return this.openAnimeon();
            fetchPlaylist(item.url, function (data) {
                if (closed) return;
                // On a dead end the chips stay usable, so another search result can be picked.
                voices = [];
                if (!data || !data.success || !data.response) return self.empty('AniTube: сайт не повернув список серій.');
                var all = sources(data.response, item.url);
                if (!all.length) return self.empty('AniTube: не вдалося розібрати список серій.');
                var seen = {};
                voices = all.filter(function (source) { return /ashdi/i.test(source.player); }).map(function (source) {
                    return {label: voiceLabel(source), episodes: source.episodes};
                }).filter(function (voice) { return !seen[voice.label] && (seen[voice.label] = true); });
                if (!voices.length) {
                    var others = unique(all.map(function (source) { return source.player; })).join(', ');
                    return self.empty('AniTube: для цього тайтлу немає плеєра Ashdi (доступні: ' + others + ').');
                }
                var wantedVoice = saved(key).voice;
                voiceIndex = 0;
                voices.forEach(function (voice, index) { if (voice.label === wantedVoice) voiceIndex = index; });
                self.focusEpisode = !keepFocusOnSeasons;
                self.draw();
                self.loading(false);
                self.start(true);
                if (keepFocusOnSeasons) focusAt(1, Math.max(0, results.indexOf(item)));
            }, function (xhr, why) {
                if (!closed) self.empty('AniTube: не вдалося отримати список серій ' + failureText(xhr, why) + '.');
            });
        };

        // One AnimeOn season: its Ashdi voices become the voices of the screen, in the order the server lists them.
        this.openAnimeon = function () {
            animeonCall('/content', null, {source: 'animeon', ref: item.ref, full: true}, function (data) {
                if (closed) return;
                voices = animeonVoices(data, item.ref.season);
                if (!voices.length) return self.empty('AnimeOn: для цього тайтлу немає озвучень з плеєром Ashdi.');
                var wantedVoice = saved(key).voice;
                voiceIndex = 0;
                voices.forEach(function (voice, index) { if (voice.label === wantedVoice) voiceIndex = index; });
                self.focusEpisode = true;
                self.draw();
                self.loading(false);
                self.start(true);
            }, function (xhr) {
                if (!closed) self.empty('AnimeOn: не вдалося отримати список серій' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') + '.');
            });
        };

        // The show page of uafix lists every season; the episodes of one season become the single "voice" of the screen.
        this.openUafix = function () {
            uafixGet('page', item.url, function (html) {
                if (closed) return;
                seasons = uafixSeasons(html, item.url);
                var numbers = Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; });
                if (!numbers.length) {
                    // A film has no episode pages: the show page carries the player itself.
                    if (!uafixPlayer(html)) return self.empty('uafix: на сторінці немає ні серій, ні плеєра.');
                    seasons = {1: [{number: 0, url: item.url}]};
                    numbers = [1];
                }
                var wanted = saved(key).season;
                self.useSeason(numbers.indexOf(wanted) >= 0 ? wanted : numbers[0], true);
            }, function (xhr, why) {
                if (!closed) self.empty('uafix: не вдалося отримати список серій ' + failureText(xhr, why) + '.');
            });
        };
        this.useSeason = function (number, fresh) {
            season = number;
            voices = [{
                label: 'Українська',
                episodes: seasons[number].map(function (episode) { return {title: episode.number ? 'Серія ' + episode.number : 'Фільм', url: episode.url}; })
            }];
            voiceIndex = 0;
            this.focusEpisode = !!fresh;
            this.draw();
            this.loading(false);
            this.start(true);
            if (!fresh) focusAt(1, Math.max(0, Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; }).indexOf(number)));
        };

        // 3. episode list with watch progress; the whole list becomes the player's playlist
        this.resolve = function (entry, success, failure) {
            if (entry.stream) return success(entry.stream);
            if (source === 'uafix') return uafixStream(entry.url, function (stream, subtitles) { entry.subtitles = subtitles; success(entry.stream = stream); }, failure);
            if (source === 'animeon') return animeonStream(entry.ref, entry.wantSubtitles, function (stream, subtitles) { entry.subtitles = subtitles; success(entry.stream = stream); }, failure);
            if (media(entry.url)) return success(entry.stream = entry.url);
            if (!ashdiPage(entry.url)) return failure('плеєр не підтримується');
            ashdiStream(entry.url, function (stream, subtitles) { entry.subtitles = subtitles; success(entry.stream = stream); }, failure);
        };

        this.play = function (index) {
            var entry = entries[index];
            if (!entry || entry.loading) return;
            entry.loading = true;
            Lampa.Noty.show('AniTube v' + VERSION + ': готую серії…');
            // Lampa's external (Android) player is handed only playlist items whose url is a plain string, so lazy
            // links would be dropped and "next" would do nothing. Resolve a window around this episode up front;
            // the rest stays lazy for Lampa's built-in player.
            var behind = PLAYLIST_BEHIND, ahead = PLAYLIST_AHEAD;
            if (source === 'uafix') { behind = UAFIX_BEHIND; ahead = UAFIX_AHEAD; }
            if (source === 'animeon') { behind = ANIMEON_BEHIND; ahead = ANIMEON_AHEAD; }
            var from = Math.max(0, index - behind), to = Math.min(entries.length - 1, index + ahead);
            var pending = to - from + 1, failure = '';
            function settled() {
                if (--pending > 0) return;
                entry.loading = false;
                if (closed) return;
                if (!entry.stream) {
                    Lampa.Noty.show('AniTube: не вдалося отримати відео (' + reason(failure) + '). Спробуй іншу серію чи озвучення.', {time: 6000});
                    return;
                }
                try { if (movie.id) Lampa.Favorite.add('history', movie, 100); } catch (e) {}
                var first = {title: entry.title, url: entry.stream, timeline: entry.timeline};
                if (entry.subtitles && entry.subtitles.length) first.subtitles = entry.subtitles;
                var playlist = [];
                entries.forEach(function (other, n) {
                    if (n === index) return playlist.push(first);
                    if (other.stream) return playlist.push({title: other.title, url: other.stream, timeline: other.timeline, subtitles: other.subtitles && other.subtitles.length ? other.subtitles : undefined});
                    if (n >= from && n <= to) return; // resolution failed, leave it out
                    var cell = {
                        title: other.title,
                        timeline: other.timeline,
                        url: function (call) {
                            self.resolve(other, function (url) { cell.url = url; if (other.subtitles && other.subtitles.length) cell.subtitles = other.subtitles; call(); }, function () { cell.url = ''; call(); });
                        }
                    };
                    playlist.push(cell);
                });
                Lampa.Player.play(first);
                // The playlist lets the player's next/previous buttons switch episodes without leaving it.
                Lampa.Player.playlist(playlist);
            }
            for (var n = from; n <= to; n++) {
                this.resolve(entries[n], settled, function (why) { if (!failure) failure = why; settled(); });
            }
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
            '.atp__head{margin-bottom:1em}.atp__title{font-size:2.4em;font-weight:800;line-height:1.1}.atp__meta{margin-top:.35em;opacity:.6;font-size:1.15em}' +
            '.atp__row{display:flex;flex-wrap:wrap;margin-bottom:.4em}' +
            '.atp-chip{display:flex;align-items:baseline;padding:.6em 1.2em;margin:0 .7em .7em 0;border-radius:2em;background:rgba(255,255,255,.1);font-size:1.15em;font-weight:600}' +
            '.atp-chip__v{margin-left:.55em;opacity:.65;font-weight:500}' +
            '.atp-chip--on{background:#1F6FEB;color:#fff}.atp-chip--on .atp-chip__v{opacity:.85}' +
            '.atp-chip.focus{background:#fff;color:#0b0d12}.atp-chip.focus .atp-chip__v{opacity:.7}' +
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
            Lampa.SettingsApi.addComponent({component: 'anitube', icon: '<svg><use xlink:href="#sprite-settings"></use></svg>', name: 'AniTube'});
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

        var button = $('<div class="full-start__button selector view--anitube anitube-card-button"><span>🟢 AniTube</span></div>');
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
            name: '🟢 AniTube',
            description: 'Озвучення, субтитри та серії з AniTube, AnimeOn і uafix',
            onContextMenu: function () {
                return {name: '🟢 AniTube', description: 'Актуальний пошук на anitube.in.ua'};
            },
            onContextLauch: function (movie) {
                open(movie);
            }
        };
    }
    // Lampa loads plugins after its API is available; register immediately as Online_Mod does.
    start();
}());
