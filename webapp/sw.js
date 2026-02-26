const CACHE_NAME = 'rtcc-2026-v5';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './img/logo-convention.png',
  './img/logo-convention-gold.png',
  './manifest.json'
];

// Install - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch - network first for JSON data, cache first for assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // JSON data files: always try network first (for fresh notifications/agenda)
  if (url.pathname.endsWith('.json') && url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: cache first
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});
