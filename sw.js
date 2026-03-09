const CACHE_NAME = 'company-trip-guide-v1';
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
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
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
