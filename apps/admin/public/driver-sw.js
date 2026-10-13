/* FastMoveX driver page — works without signal. Scope: /driver only. Never caches API answers (those stay in the page's
   own storage, per driver, wiped at sign-out) and never touches the rest of the admin panel. */
const VERSION = 'fastmovex-driver-v2';
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fastmovex-driver-') && !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function page(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put('/driver', copy));
    }
    return res;
  } catch {
    const cached = await caches.match('/driver');
    return cached || new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Offline</title><p style="font:16px system-ui;padding:24px">No connection. Open the driver page once with signal so it works offline next time.</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}

async function asset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    caches.open(STATIC).then((c) => c.put(request, copy));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the API: always the network
  if (request.mode === 'navigate' && url.pathname.replace(/\/$/, '') === '/driver') {
    event.respondWith(page(request));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || /^\/(favicon\.ico|icon|apple-icon)/.test(url.pathname)) {
    event.respondWith(asset(request));
  }
});
