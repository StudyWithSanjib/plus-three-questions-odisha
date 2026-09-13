// Service Worker for +3 PYQ & Syllabus Hub
// Strategy:
//  - App shell (HTML/CSS/JS/manifest/icons): cache-first, so the app opens instantly
//    and works fully offline once visited.
//  - Google Apps Script data (PYQ + Syllabus): stale-while-revalidate, so a student
//    who already loaded data once can keep browsing it offline/on poor networks,
//    while the cache still refreshes quietly in the background when online.
//
// Bump CACHE_VERSION whenever index.html/CSS/JS changes so old caches are cleared
// and users get the latest shell instead of a stale cached copy.
const CACHE_VERSION = 'pyq-hub-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png'
];

// Only cache-as-data the Apps Script backend this site actually uses.
const DATA_HOST = 'script.google.com';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Data requests (PYQ/Syllabus from Apps Script): stale-while-revalidate.
  if (url.hostname === DATA_HOST) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Same-origin app shell: cache-first with network fallback.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Prefer a fast cached response if we have one; otherwise wait for network.
  return cached || (await networkFetch) || new Response(
    JSON.stringify({ error: 'offline', message: 'No cached data available offline.' }),
    { headers: { 'Content-Type': 'application/json' }, status: 503 }
  );
}
