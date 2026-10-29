/* AniTube Lampa prototype. No provider scripts are executed. */
(function () {
    'use strict';
    var HOME = 'https://anitube.in.ua/';
    var API = 'https://anitube-lampa-proxy.netlify.app/.netlify/functions/anitube';

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
            var heading = card.querySelector('h2');
            var link = card.querySelector('.title2 a[href]') || (heading && heading.querySelector('a[href]')) || card.querySelector('a[href]');
            var url = link && absolute(link.getAttribute('href'), HOME);
            var title = text(link) || text(heading);
            if (!url || new URL(url).hostname !== 'anitube.in.ua' || !title || seen[url]) return null;
            seen[url] = true;
            return { title: title, url: url };
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
    function fetchText(action, value, success, failure) {
        // The function fetches AniTube on demand; neither the client nor proxy caches the response.
        var parameter = action === 'search' ? 'q' : 'url';
        $.ajax({url: API + '?action=' + action + '&' + parameter + '=' + encodeURIComponent(value), dataType: 'text', timeout: 20000, cache: false, success: success, error: failure});
    }
    function fetchPlaylist(url, success, failure) {
        $.ajax({url: API + '?action=playlist&url=' + encodeURIComponent(url), dataType: 'json', timeout: 25000, cache: false, success: success, error: failure});
    }
    function requestError(prefix, xhr) {
        var status = xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '';
        error(prefix + status + '.');
    }
    function error(message) { Lampa.Noty.show(message, {time: 8000}); }
    function choose(title, items, selected, back) {
        var safe = items.map(function (item) {
            var copy = {};
            Object.keys(item).forEach(function (key) { copy[key] = item[key]; });
            copy.rawTitle = item.title;
            copy.title = String(item.title).replace(/[&<>"']/g, function (c) {
                return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
            });
            return copy;
        });
        Lampa.Select.show({title: title, items: safe, onSelect: function (item) {
            item.title = item.rawTitle;
            selected(item);
        }, onBack: back});
    }
    function unique(values) { return values.filter(function (v, i) { return v && values.indexOf(v) === i; }); }
    function searchUrl(query) {
        return query;
    }
    function lookup(movie, queryIndex) {
        var queries = unique([movie.title, movie.original_title, movie.name, movie.original_name]);
        if (queryIndex >= queries.length) return error('AniTube: за назвою цієї картки нічого не знайдено.');
        fetchText('search', searchUrl(queries[queryIndex]), function (html) {
            var items = catalog(html);
            if (!items.length) return lookup(movie, queryIndex + 1);
            choose('AniTube · Обери відповідний тайтл', items, function (item) { detail(item, movie); });
        }, function (xhr) { requestError('AniTube: сервер пошуку не отримав сторінку сайту', xhr); });
    }
    function detail(item, movie) {
        fetchPlaylist(item.url, function (data) {
            if (!data || !data.success || !data.response) return error('AniTube: сайт не повернув список серій.');
            var all = sources(data.response, item.url);
            if (!all.length) return error('AniTube: не вдалося розібрати список серій AniTube.');
            function modes() {
                choose(item.title + ' · Тип', unique(all.map(function (x) { return x.mode; })).map(function (x) { return {title: x}; }), function (mode) { variants(mode.title); });
            }
            function variants(mode) {
                var filtered = all.filter(function (x) { return x.mode === mode; });
                choose(mode + ' · Переклад', unique(filtered.map(function (x) { return x.variant; })).map(function (x) { return {title: x}; }), function (variant) { players(mode, variant.title); }, modes);
            }
            function players(mode, variant) {
                var filtered = all.filter(function (x) { return x.mode === mode && x.variant === variant; });
                choose(variant + ' · Плеєр', filtered.map(function (x) { return {title: x.player, source: x}; }), function (player) { episodes(mode, variant, player.source); }, function () { variants(mode); });
            }
            function episodes(mode, variant, source) {
                choose(source.player + ' · Серія', source.episodes, function (episode) {
                    if (!media(episode.url)) {
                        error('AniTube: це сторінка вбудованого плеєра, а не пряме відео. Спробуй інший плеєр.');
                        return episodes(mode, variant, source);
                    }
                    Lampa.Player.play({title: item.title + ' · ' + episode.title, url: episode.url, movie: movie});
                }, function () { players(mode, variant); });
            }
            modes();
        }, function (xhr) { requestError('AniTube: сервер не отримав список серій', xhr); });
    }
    function addCardButton(event) {
        if (!event.object || !event.object.activity) return;
        var root = event.object.activity.render();
        var movie = event.data && event.data.movie;
        if (!movie || root.find('.anitube-card-button').length) return;

        var button = $('<div class="full-start__button selector view--anitube anitube-card-button"><span>🟢 AniTube</span></div>');
        button.on('hover:enter', function () { lookup(movie, 0); });

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
        Lampa.Listener.follow('full', function (event) {
            if (event.type === 'complite') addCardButton(event);
        });
        Lampa.Manifest.plugins = {
            type: 'video',
            version: '0.2.0',
            name: '🟢 AniTube',
            description: 'Озвучення, субтитри та серії з AniTube',
            onContextMenu: function () {
                return {name: '🟢 AniTube', description: 'Актуальний пошук на anitube.in.ua'};
            },
            onContextLauch: function (movie) {
                lookup(movie || {}, 0);
            }
        };
    }
    // Lampa loads plugins after its API is available; register immediately as Online_Mod does.
    start();
}());
