/* FastMoveX service worker — offline support without ever caching personal or payment pages. */
const VERSION = 'fastmovex-v3'; // caches of older versions are deleted on activate
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const IMAGES = `${VERSION}-images`;
const OFFLINE = '/offline.html';
const PRECACHE = [OFFLINE, '/icons/icon-192.png', '/icons/icon-512.png'];
// Catalogue pages are the same for every visitor (personal data is loaded by the browser), so they are safe to keep.
const CACHEABLE_PAGE = /^\/(en|ar)(\/(c|p|store)\/[^/]+|\/categories|\/help(\/(returns|delivery))?)?\/?$/;
const MAX_PAGES = 40;
const MAX_IMAGES = 150;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function networkFirstPage(request, url) {
  try {
    const res = await fetch(request);
    if (res.ok && CACHEABLE_PAGE.test(url.pathname) && !url.search) {
      const copy = res.clone();
      caches.open(PAGES).then((c) => c.put(request, copy)).then(() => trim(PAGES, MAX_PAGES));
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match(OFFLINE);
  }
}

async function cacheFirst(request, cacheName, max) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(request, copy)).then(() => (max ? trim(cacheName, max) : undefined));
  }
  return res;
}

async function staleWhileRevalidate(request, cacheName, max) {
  const cached = await caches.match(request);
  const network = fetch(request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(request, copy)).then(() => trim(cacheName, max));
    }
    return res;
  }).catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // API, payment pages, CDNs: always straight to the network

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request, url));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }
  if (url.pathname.startsWith('/_next/image')) {
    event.respondWith(staleWhileRevalidate(request, IMAGES, MAX_IMAGES));
  }
});

// ---------------------------------------------------------------- browser notifications (Web Push)
// The API sends { title, body, url, tag }; a tap opens (or focuses) that page of the shop.
self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data ? event.data.text() : '' }; }
  const url = typeof msg.url === 'string' && msg.url.startsWith('/') ? msg.url : '/';
  event.waitUntil(self.registration.showNotification(msg.title || 'FastMoveX', {
    body: msg.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: msg.tag || undefined,
    renotify: !!msg.tag,
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  if (url.origin !== self.location.origin) return; // only our own pages
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
        await w.focus();
        if ('navigate' in w) return w.navigate(url.href);
        return undefined;
      }
    }
    return self.clients.openWindow(url.href);
  })());
});
