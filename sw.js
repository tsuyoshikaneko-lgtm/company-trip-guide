const CACHE_NAME = 'company-trip-guide-v2';
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

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});

// Scheduled notification check via message from main thread
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
