/* AniTube for Lampa. Episode list screen modelled on Lampa's own online plugins. No provider scripts are executed. */
(function () {
    'use strict';
    var HOME = 'https://anitube.in.ua/';
    var API = 'https://anitube-lampa-proxy.netlify.app/.netlify/functions/anitube';
    var COMPONENT = 'anitube';
    var VERSION = '0.6.4';
    var PLAYLIST_AHEAD = 15, PLAYLIST_BEHIND = 3;

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
            var note = [text(card.querySelector('.short-meta')), text(card.querySelector('.up-series'))].map(function (part) { return part.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join(' · ');
            return { title: title, url: url, note: note };
        }).filter(Boolean);
    }
    function sources(html, base) {
        var doc = page(html), rows = list(doc, '.playlists-lists > .playlists-items');
        if (rows.length < 3) return [];
        var modes = list(rows[0], 'li[data-id]'), variants = list(rows[1], 'li[data-id]');
        var players = list(rows[2], 'li[data-id]'), episodes = list(doc, '.playlists-videos li[data-file][data-id]');
        var result = [];
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
    function homeProxy() {
        var value = '';
        try { value = String((window.Lampa && Lampa.Storage && Lampa.Storage.field('anitube_proxy')) || '').trim().replace(/\/+$/, ''); } catch (e) {}
        return /^https?:\/\/\S+$/i.test(value) ? value : '';
    }
    // Optional secret for a helper that is reachable from the internet (hosted server); sent as ?key=
    function homeKey() {
        try { return String((window.Lampa && Lampa.Storage && Lampa.Storage.field('anitube_proxy_key')) || '').trim(); } catch (e) { return ''; }
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
    function ashdiStream(url, success, failure) {
        function read(html, fail) {
            var match = String(html).match(/\bfile\s*:\s*(["'])(https:\/\/ashdi\.vip\/[^"']+?\.m3u8[^"']*)\1/i);
            var stream = match && absolute(match[2], url);
            if (stream && new URL(stream).hostname === 'ashdi.vip' && media(stream)) success(stream);
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
    function voiceLabel(source) { return sentence(source.mode) + ' · ' + source.variant; }
    // Episode title as AniTube lists it: "12 серія" becomes "Серія 12"; "OVA 1", "Фільм" and the like stay as they are.
    // The number is also used as the watch-progress key, so it is read from the title only (stream file names do not match AniTube's numbering).
    function episodeInfo(raw) {
        var title = String(raw || '').replace(/\s+/g, ' ').trim();
        var plain = title.match(/^(?:серія\s*)?(\d+)\s*(?:серія|серії|серій|епізод|ep\.?|episode)?$/i);
        var number = plain ? parseInt(plain[1], 10) : 0;
        return {number: number, label: plain ? 'Серія ' + number : title, original: title};
    }

    // ---- Episode screen --------------------------------------------------------------------------------------------
    function component(object) {
        var self = this;
        var movie = object.movie || {};
        var scroll = new Lampa.Scroll({mask: true, over: true});
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var results = [], item = null, voices = [], voiceIndex = 0, entries = [], last, closed = false, manual = '';

        scroll.body().addClass('torrent-list');
        scroll.minus(files.render().find('.explorer__files-head'));
        filter.render().find('.filter--sort').remove();

        function saved(key) { var all = Lampa.Storage.get('anitube_choice', '{}'); return (all && all[key]) || {}; }
        function remember(key, value) {
            var all = Lampa.Storage.get('anitube_choice', '{}');
            if (!all || typeof all !== 'object') all = {};
            all[key] = Object.assign(all[key] || {}, value);
            Lampa.Storage.set('anitube_choice', all);
        }
        var key = String(movie.id || movie.original_title || movie.title || '');

        this.create = function () {
            this.activity.loader(true);
            manual = saved(key).query || '';
            filter.onBack = function () { self.start(); };
            // AniTube often names a show differently from the card, so the title can be typed by hand (and is remembered).
            filter.onSearch = function (value) {
                manual = String(value || '').trim();
                remember(key, {query: manual, title: ''});
                results = []; item = null; voices = [];
                self.reset();
                self.loading(true);
                self.search(0);
            };
            filter.onSelect = function (type, a, b) {
                if (type !== 'filter') return;
                if (a.stype === 'title' && results[b.index]) self.openTitle(results[b.index]);
                else if (a.stype === 'voice' && voices[b.index]) {
                    voiceIndex = b.index;
                    remember(key, {voice: voices[b.index].label});
                    self.updateFilter();
                    self.showEpisodes();
                }
                setTimeout(self.closeFilter, 10);
            };
            files.appendHead(filter.render());
            files.appendFiles(scroll.render());
            this.search(0);
            return this.render();
        };

        this.closeFilter = function () { if ($('body').hasClass('selectbox--open')) Lampa.Select.close(); };

        this.inActivity = function () {
            var body = $('body');
            return !(body.hasClass('settings--open') || body.hasClass('menu--open') || body.hasClass('keyboard-input--visible') || body.hasClass('selectbox--open') || body.hasClass('search--open') || $('div.modal').length);
        };

        this.loading = function (status) {
            if (closed) return;
            if (status) this.activity.loader(true);
            else {
                this.activity.loader(false);
                if (Lampa.Activity.active().activity === this.activity && this.inActivity()) this.activity.toggle();
            }
        };

        this.reset = function () {
            last = false;
            scroll.render().find('.empty').remove();
            scroll.clear();
            scroll.reset();
        };

        this.empty = function (message) {
            this.reset();
            var empty = Lampa.Template.get('list_empty');
            if (message) empty.find('.empty__descr').text(message);
            scroll.append(empty);
            this.loading(false);
            this.start();
        };

        this.append = function (node) {
            node.on('hover:focus', function (e) {
                last = e.target;
                scroll.update($(e.target), true);
            });
            scroll.append(node);
        };

        // 1. find the title on AniTube (the card's own names, then the original ones)
        this.search = function (queryIndex) {
            var queries = manual ? [manual] : searchTerms(movie);
            if (queryIndex >= queries.length) {
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
            else this.showTitles();
        };

        this.showTitles = function () {
            this.reset();
            this.updateFilter();
            results.forEach(function (result) {
                var node = Lampa.Template.get('anitube_folder', {title: result.title, quality: result.note || 'Обери тайтл', info: ''});
                node.on('hover:enter', function () { self.openTitle(result); });
                self.append(node);
            });
            this.loading(false);
            this.start(true);
        };

        // 2. load the playlist and keep only Ashdi, the one player that gives a direct stream
        this.openTitle = function (selectedTitle) {
            item = selectedTitle;
            remember(key, {title: item.url});
            this.loading(true);
            fetchPlaylist(item.url, function (data) {
                if (closed) return;
                // On a dead end the title filter stays usable, so another search result can be picked.
                voices = [];
                if (!data || !data.success || !data.response) return self.noEpisodes('AniTube: сайт не повернув список серій.');
                var all = sources(data.response, item.url);
                if (!all.length) return self.noEpisodes('AniTube: не вдалося розібрати список серій.');
                var seen = {};
                voices = all.filter(function (source) { return /ashdi/i.test(source.player); }).map(function (source) {
                    return {label: voiceLabel(source), episodes: source.episodes};
                }).filter(function (voice) { return !seen[voice.label] && (seen[voice.label] = true); });
                if (!voices.length) {
                    var others = unique(all.map(function (source) { return source.player; })).join(', ');
                    return self.noEpisodes('AniTube: для цього тайтлу немає плеєра Ashdi (доступні: ' + others + ').');
                }
                var wantedVoice = saved(key).voice;
                voiceIndex = 0;
                voices.forEach(function (voice, index) { if (voice.label === wantedVoice) voiceIndex = index; });
                self.updateFilter();
                self.showEpisodes();
            }, function (xhr, why) {
                if (!closed) self.noEpisodes('AniTube: не вдалося отримати список серій ' + failureText(xhr, why) + '.');
            });
        };

        this.noEpisodes = function (message) {
            voices = [];
            this.updateFilter();
            this.empty(message);
        };

        this.updateFilter = function () {
            var select = [], chosen = [];
            if (results.length > 1) {
                select.push({
                    title: 'Тайтл',
                    subtitle: item ? item.title : '',
                    stype: 'title',
                    items: results.map(function (result, index) { return {title: result.title, selected: item === result, index: index}; })
                });
                if (item) chosen.push('Тайтл: ' + item.title);
            }
            if (voices.length) {
                select.push({
                    title: 'Озвучення / субтитри',
                    subtitle: voices[voiceIndex].label,
                    stype: 'voice',
                    items: voices.map(function (voice, index) { return {title: voice.label, selected: index === voiceIndex, index: index}; })
                });
                chosen.push(voices[voiceIndex].label);
            }
            filter.set('filter', select);
            filter.chosen('filter', chosen);
        };

        // 3. episode list with watch progress; the whole list becomes the player's playlist
        this.resolve = function (entry, success, failure) {
            if (entry.stream) return success(entry.stream);
            if (media(entry.url)) return success(entry.stream = entry.url);
            if (!ashdiPage(entry.url)) return failure('плеєр не підтримується');
            ashdiStream(entry.url, function (stream) { success(entry.stream = stream); }, failure);
        };

        this.showEpisodes = function () {
            this.reset();
            var voice = voices[voiceIndex];
            entries = voice.episodes.map(function (episode) {
                var info = episodeInfo(episode.title);
                var hash = Lampa.Utils.hash(item.url + ':' + (info.number || info.original));
                return {
                    url: episode.url,
                    info: info,
                    title: info.label + ' · ' + item.title,
                    timeline: Lampa.Timeline.view(hash)
                };
            });
            var lastWatched = -1;
            entries.forEach(function (entry, index) { if (entry.timeline.percent > 0) lastWatched = index; });
            var target = lastWatched < 0 ? 0 : (entries[lastWatched].timeline.percent >= 90 ? Math.min(lastWatched + 1, entries.length - 1) : lastWatched);

            entries.forEach(function (entry, index) {
                var node = Lampa.Template.get('anitube_item', {title: entry.info.label, quality: voice.label, info: ''});
                node.append(Lampa.Timeline.render(entry.timeline));
                if (Lampa.Timeline.details) node.find('.online__quality').append(Lampa.Timeline.details(entry.timeline, ' / '));
                node.on('hover:enter', function () { self.play(index); });
                self.append(node);
                if (index === target) last = node[0];
            });
            this.loading(false);
            this.start();
        };

        this.play = function (index) {
            var entry = entries[index];
            if (!entry || entry.loading) return;
            entry.loading = true;
            Lampa.Noty.show('AniTube v' + VERSION + ': готую серії…');
            // Lampa's external (Android) player is handed only playlist items whose url is a plain string, so lazy
            // links would be dropped and "next" would do nothing. Resolve a window around this episode up front;
            // the rest stays lazy for Lampa's built-in player.
            var from = Math.max(0, index - PLAYLIST_BEHIND), to = Math.min(entries.length - 1, index + PLAYLIST_AHEAD);
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
                var playlist = [];
                entries.forEach(function (other, n) {
                    if (n === index) return playlist.push(first);
                    if (other.stream) return playlist.push({title: other.title, url: other.stream, timeline: other.timeline});
                    if (n >= from && n <= to) return; // resolution failed, leave it out
                    var cell = {
                        title: other.title,
                        timeline: other.timeline,
                        url: function (call) {
                            self.resolve(other, function (url) { cell.url = url; call(); }, function () { cell.url = ''; call(); });
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
            if (closed || Lampa.Activity.active().activity !== this.activity) return;
            if (first || !last) last = scroll.render().find('.selector').eq(0)[0];
            Lampa.Background.immediately(Lampa.Utils.cardImgBackground(movie));
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down: function () { Navigator.move('down'); },
                right: function () { if (Navigator.canmove('right')) Navigator.move('right'); else filter.show(Lampa.Lang.translate('title_filter'), 'filter'); },
                left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                back: this.back
            });
            if (this.inActivity()) Lampa.Controller.toggle('content');
        };

        this.render = function () { return files.render(); };
        this.back = function () { Lampa.Activity.backward(); };
        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {
            closed = true;
            files.destroy();
            scroll.destroy();
        };
    }

    function open(movie) {
        Lampa.Component.add(COMPONENT, component);
        Lampa.Activity.push({url: '', title: 'AniTube', component: COMPONENT, movie: movie || {}, page: 1});
    }
    function addTemplates() {
        var play = '<svg style="height: 2.4em; width: 2.4em;" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="64" cy="64" r="56" stroke="white" stroke-width="16"/><path d="M90.5 64.3827L50 87.7654L50 41L90.5 64.3827Z" fill="white"/></svg>';
        var folder = '<svg style="height: 2.4em; width: 2.4em;" viewBox="0 0 128 112" fill="none" xmlns="http://www.w3.org/2000/svg"><rect y="20" width="128" height="92" rx="13" fill="white"/><path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"/><rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"/></svg>';
        function row(icon) {
            return '<div class="online selector"><div class="online__body"><div style="position: absolute;left: 0;top: -0.3em;width: 2.4em;height: 2.4em">' + icon + '</div>' +
                '<div class="online__title" style="padding-left: 2.1em;">{title}</div>' +
                '<div class="online__quality" style="padding-left: 3.4em;">{quality}{info}</div></div></div>';
        }
        Lampa.Template.add('anitube_item', row(play));
        Lampa.Template.add('anitube_folder', row(folder));
    }
    // Settings → AniTube: address of the home-network helper, only needed on TVs that cannot reach AniTube themselves.
    function addSettings() {
        try {
            if (!Lampa.SettingsApi || Lampa.SettingsApi.getComponent && Lampa.SettingsApi.getComponent('anitube')) return;
            Lampa.SettingsApi.addComponent({component: 'anitube', icon: '<svg><use xlink:href="#sprite-settings"></use></svg>', name: 'AniTube'});
            Lampa.SettingsApi.addParam({
                component: 'anitube',
                param: {name: 'anitube_proxy', type: 'input', values: '', 'default': '', placeholder: 'http://192.168.0.10:8787'},
                field: {name: 'Адреса проксі', description: 'Потрібна на Smart TV (Tizen, webOS), наприклад https://назва.koyeb.app. На Android-приставці залиш порожнім.'}
            });
            Lampa.SettingsApi.addParam({
                component: 'anitube',
                param: {name: 'anitube_proxy_key', type: 'input', values: '', 'default': '', placeholder: 'ключ доступу'},
                field: {name: 'Ключ проксі', description: 'Потрібен, якщо проксі стоїть на сервері в інтернеті (ACCESS_KEY).'}
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
            description: 'Озвучення, субтитри та серії з AniTube',
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
