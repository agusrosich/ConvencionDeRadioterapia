const CACHE_NAME = 'rtcc-2026-v13';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './img/logo-convention.png',
  './img/logo-convention-gold.png',
  './qr/registro-arribo-rtcc2026.png',
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
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const path = url.pathname || '';
  const isDataJson = path.endsWith('.json') && path.includes('/data/');
  const isNavigation = event.request.mode === 'navigate';
  const isCoreAsset = /\.(?:js|css|html)$/i.test(path);

  // JSON data files: always try network first (for fresh notifications/agenda)
  if (isDataJson) {
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

  // HTML navigation + core JS/CSS/HTML: network first to avoid stale app shell.
  if (isNavigation || isCoreAsset) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          if (isNavigation) {
            return caches.match('./index.html');
          }
          return Response.error();
        })
    );
    return;
  }

  // Static assets: cache first
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});
