/* Service worker: lets the app open with no internet.
   Online: always fetch the latest files (so updates apply all at once).
   Offline: fall back to the saved copy.
   Nothing to change when you update: just replace the files. */
const CACHE = 'expense-tracker';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './fonts/bricolage.woff2',
    './fonts/figtree.woff2'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(u => new Request(u, {cache: 'reload'})))));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
    const isFont = req.url.includes('/fonts/');
    event.respondWith(
        isFont
            // fonts never change: cache first
            ? caches.match(req).then(hit => hit || fetch(req))
            // everything else: network first, cache as fallback
            : fetch(req, {cache: 'no-cache'})
                .then(res => {
                    if (res && res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE).then(c => c.put(req, copy));
                    }
                    return res;
                })
                .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
});