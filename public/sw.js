/*
 * Finance Baba service worker: makes the site installable and shows a friendly page when offline.
 * Pages and files always come from the network first (so a new deploy is used right away);
 * the cached copy is only used when there is no connection. API calls are never cached.
 */
const CACHE = 'fb-v1';
const PRECACHE = ['/offline.html', '/css/style.css', '/img/logo.svg', '/img/icons.svg', '/js/theme-init.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/') || url.pathname.startsWith('/.well-known/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('/offline.html') : Response.error()))
  );
});
