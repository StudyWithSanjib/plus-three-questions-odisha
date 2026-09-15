// Service Worker for +3 PYQ & Syllabus Hub
// Strategy:
//  - HTML shell (index.html / navigations): network-first, so returning
//    visitors always get the latest deployed version when online, and only
//    fall back to the cached copy if the network request fails (offline).
//    This is the key fix - previously this was cache-first, which meant a
//    browser that had already cached the old index.html would keep serving
//    it forever, even after new versions were deployed, until CACHE_VERSION
//    was manually bumped.
//  - Static shell assets (manifest/icons): cache-first, since these rarely
//    change and cache-first makes repeat visits instant.
//  - JSON data (data/pyq.json, data/syllabus.json, and any Apps Script
//    endpoint still in use): stale-while-revalidate, so a student sees data
//    instantly from cache while a fresh copy is fetched quietly in the
//    background for the *next* visit - matches how often the data actually
//    changes (every ~15 min via the Sheet-to-GitHub automation).
//
// Still bump CACHE_VERSION whenever you want to force a clean slate (e.g. if
// static asset filenames change), but the network-first shell strategy below
// means you no longer *have* to remember to do this for normal HTML/CSS/JS
// updates to show up.
const CACHE_VERSION = 'pyq-hub-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png'
];

// Static, rarely-changing assets - safe to keep cache-first.
const STATIC_ASSETS = ['/manifest.json', '/favicon.png'];

// Data that changes periodically (Apps Script, if still used anywhere, plus
// the static JSON snapshots that replaced it) - use stale-while-revalidate.
const DATA_HOST = 'script.google.com';
const DATA_PATH_PREFIX = '/data/';

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

  // Data requests (PYQ/Syllabus - either the old Apps Script host or the new
  // same-origin /data/ JSON files): stale-while-revalidate.
  if (url.hostname === DATA_HOST || url.pathname.includes(DATA_PATH_PREFIX)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  if (url.origin === self.location.origin) {
    // HTML navigations (and index.html itself): network-first, so updates
    // show up immediately for returning visitors. Falls back to the cached
    // shell only when there's no network (offline).
    const isHtmlRequest = req.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname === '/' || url.pathname.endsWith('/');
    if (isHtmlRequest) {
      event.respondWith(networkFirst(req));
      return;
    }

    // Other static shell assets: cache-first is fine, these rarely change.
    if (STATIC_ASSETS.some((path) => url.pathname.endsWith(path))) {
      event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req))
      );
      return;
    }

    // Anything else same-origin: just go to network, no special caching.
    event.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || cache.match('./index.html');
  }
}

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
