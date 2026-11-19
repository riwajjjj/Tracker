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

/* ---------- Daily reminder (Chrome on Android, installed app) ----------
   The page saves { on, time, lastLog } into IndexedDB; Chrome wakes this
   worker now and then, and it notifies if the reminder time has passed
   and nothing was logged today. */
function readKV(key) {
    return new Promise(resolve => {
        const r = indexedDB.open('expense-tracker-sw', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => {
            const req = r.result.transaction('kv').objectStore('kv').get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        };
        r.onerror = () => resolve(null);
    });
}

function writeKV(key, val) {
    return new Promise(resolve => {
        const r = indexedDB.open('expense-tracker-sw', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => {
            const tx = r.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(val, key);
            tx.oncomplete = resolve;
            tx.onerror = resolve;
        };
        r.onerror = resolve;
    });
}

const two = n => String(n).padStart(2, '0');

async function checkReminder() {
    const r = await readKV('reminder');
    if (!r || !r.on) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
    const [hh, mm] = (r.time || '21:00').split(':').map(Number);
    if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;
    if (r.lastLog === today || r.notified === today) return;
    await self.registration.showNotification("Log today's spending", {
        body: 'Nothing added today yet. It takes five seconds.',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: 'daily-reminder',
        data: {url: './?add=expense'}
    });
    await writeKV('reminder', {...r, notified: today});
}

self.addEventListener('periodicsync', event => {
    if (event.tag === 'daily-reminder') event.waitUntil(checkReminder());
});
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || './';
    event.waitUntil(
        self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(wins => {
            for (const w of wins) {
                if ('focus' in w) {
                    w.navigate(url);
                    return w.focus();
                }
            }
            return self.clients.openWindow(url);
        })
    );
});