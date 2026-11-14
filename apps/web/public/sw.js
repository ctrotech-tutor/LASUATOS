/* global self, caches */
/* LASUATOS service worker.
 *
 * Deliberately conservative:
 * - API calls (/api/) are never touched: attendance must always be live.
 * - Pages (HTML) go to the network; if the device is offline, the
 *   offline page is shown instead of the browser's error screen.
 * - Build assets (/_next/static, fonts, icons, the face tracker in /face)
 *   are content-hashed or versioned, so they are served from cache first.
 */
const VERSION = 'v1';
const STATIC_CACHE = `lasuatos-static-${VERSION}`;
const SHELL_CACHE = `lasuatos-shell-${VERSION}`;
// The face tracker (about 15 MB, versioned file names): its own cache, never trimmed.
// Rename it when FACE_RUNTIME_VERSION changes, so old files are dropped.
const FACE_CACHE = 'lasuatos-face-v1';
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/apple-touch-icon.png'];
const MAX_STATIC_ENTRIES = 160;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC_CACHE, SHELL_CACHE, FACE_CACHE]);
    for (const key of await caches.keys()) {
      if (key.startsWith('lasuatos-') && !keep.has(key)) await caches.delete(key);
    }
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let index = 0; index < keys.length - MAX_STATIC_ENTRIES; index += 1) await cache.delete(keys[index]);
}

async function cacheFirst(request, cacheName = STATIC_CACHE) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    if (cacheName === STATIC_CACHE) void trim(cache);
  }
  return response;
}

async function networkFirstPage(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(OFFLINE_URL)) || new Response('You are offline.', { status: 503, headers: { 'content-type': 'text/plain' } });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/face/')) {
    event.respondWith(cacheFirst(request, FACE_CACHE));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(event));
    return;
  }
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:woff2?|ttf)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request));
  }
});
