// Service worker mínimo: abre o app mesmo sem internet (rede primeiro, cópia local como reserva).
const V = 'rotina-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return; // Supabase e fontes passam direto
  e.respondWith(
    fetch(r)
      .then((res) => {
        if (res.ok) { const c = res.clone(); caches.open(V).then((ch) => ch.put(r, c)); }
        return res;
      })
      .catch(() => caches.match(r).then((m) => m || caches.match('./')))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow('./')))
  );
});
