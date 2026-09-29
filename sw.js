// Service worker: a app funciona offline. Aumenta VERSION a cada alteração.
const VERSION = 'v2';
const CACHE = `booksread-${VERSION}`;
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/stats.js', 'js/ai.js', 'js/util.js', 'js/importer.js',
  'vendor/anthropic-sdk.mjs',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('booksread-') && !k.startsWith(CACHE)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Ficheiros da app: rede primeiro (para receber atualizações), cache se offline.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
    );
    return;
  }
  // Capas de livros: cache primeiro.
  if (url.hostname === 'covers.openlibrary.org') {
    e.respondWith(
      caches.open(`${CACHE}-covers`).then(async c => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
        return res;
      })
    );
  }
});
