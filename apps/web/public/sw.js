/*
 * Service worker do MyKids Printer (webapp instalável).
 * - Casca do app (HTML, JS/CSS com hash, ícones, fontes) em cache → abre rápido e funciona sem rede.
 * - /api/* NUNCA é cacheado: status, impressões e logs são sempre ao vivo.
 */
const VERSION = 'mkp-v1';
const SHELL = ['/', '/manifest.webmanifest', '/logo-incc.png', '/icon-192.png', '/icon-512.png', '/offline.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API e health: sempre rede, sem cache
  if (url.origin === self.location.origin && (url.pathname.startsWith('/api/') || url.pathname === '/healthz')) return;

  // navegação (abrir/recarregar o app): rede primeiro, cai para a casca em cache e depois para a página offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/', copy));
          return res;
        })
        .catch(async () => (await caches.match('/')) || (await caches.match('/offline.html'))),
    );
    return;
  }

  // arquivos estáticos com hash, ícones e fontes do Google: cache primeiro
  const cacheable =
    (url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || /\.(png|jpg|svg|webmanifest|woff2?)$/.test(url.pathname))) ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
