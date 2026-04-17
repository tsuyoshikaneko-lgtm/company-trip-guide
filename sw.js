const CACHE_NAME = 'company-trip-guide-v10';
const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './img/icon-192x192.png',
    './img/icon-512x512.png',
    './img/apple-touch-icon.png',
    './img/kuroko.webp',
    './img/bear_puppet_latest.webp',
    './img/sawara_town.webp',
    './img/sawara_food.webp',
    './img/sawara_map.webp'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Network-first for HTML/JS/CSS, cache-first for images
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const isAsset = /\.(png|webp|jpg|jpeg|gif|svg|ico|woff2?)$/i.test(url.pathname);

    if (isAsset) {
        // Cache-first for images/fonts (rarely change)
        event.respondWith(
            caches.match(event.request).then(cached => {
                return cached || fetch(event.request).then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                });
            })
        );
    } else {
        // Network-first for HTML/JS/CSS (changes frequently)
        event.respondWith(
            fetch(event.request).then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            }).catch(() => {
                return caches.match(event.request);
            })
        );
    }
});

// Web Push event from server (Cloudflare Worker)
self.addEventListener('push', event => {
    let data = { title: '社員旅行のお知らせ', body: '' };
    if (event.data) {
        try {
            data = event.data.json();
        } catch {
            data.body = event.data.text();
        }
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: './img/icon-192x192.png',
            badge: './img/icon-192x192.png',
            tag: data.tag || 'trip-notification',
            renotify: true,
            vibrate: [200, 100, 200]
        })
    );
});

// Local notification via message from main thread (fallback)
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, tag } = event.data;
        self.registration.showNotification(title, {
            body: body,
            icon: './img/icon-192x192.png',
            badge: './img/icon-192x192.png',
            tag: tag,
            renotify: true,
            vibrate: [200, 100, 200]
        });
    }
});

// Notification click - open the app
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes('index.html') || client.url.endsWith('/')) {
                    return client.focus();
                }
            }
            return clients.openWindow('./');
        })
    );
});
