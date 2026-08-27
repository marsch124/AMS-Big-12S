/*
 * sw.js — offline shell for AMS Big 12S.
 *
 * Paths are relative to the service worker's own location, so the same file
 * works when the app is served from a GitHub Pages subpath or from the root of
 * a local dev server.
 */
const APP_VERSION = '2.0';
const CACHE_NAME = 'ams-big-12s-v25';

const SHELL = [
    './',
    'index.html',
    'manifest.json',
    'css/style.css?v=18',
    'js/parser.js?v=1',
    'js/db.js?v=2',
    'js/store.js?v=8',
    'js/backup.js?v=3',
    'js/ui.js?v=17',
    'js/app.js?v=5',
    'data/book.json',
    'data/steps.json',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-512-maskable.png',
    'icons/apple-touch-icon.png',
    'icons/favicon-64.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            // Cache entries one at a time: a single 404 should not throw away
            // the whole install, which is what cache.addAll would do.
            Promise.all(SHELL.map((path) =>
                cache.add(new Request(path, { cache: 'reload' }))
                    .catch((error) => console.warn('[sw] could not cache', path, error))
            ))
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Navigations: serve the shell so a deep link works offline.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put('index.html', copy));
                    return response;
                })
                .catch(() => caches.match('index.html', { ignoreSearch: true })
                    .then((cached) => cached || caches.match('./')))
        );
        return;
    }

    event.respondWith(
        caches.match(request, { ignoreSearch: false }).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            }).catch(() => caches.match(request, { ignoreSearch: true }));
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
    if (event.data && event.data.type === 'VERSION') {
        event.source.postMessage({ type: 'VERSION', version: APP_VERSION, cache: CACHE_NAME });
    }
});
