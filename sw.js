/* Service Worker — App-Shell offline verfügbar machen */
const CACHE = 'wilma-os-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'data.js', 'store.js', 'config.js',
  'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Supabase-Anfragen nie abfangen
  if (url.hostname.endsWith('.supabase.co')) return;

  // Fonts & CDN: erst Cache, dann Netz (und nachcachen)
  if (url.hostname.includes('fonts.g') || url.hostname.includes('jsdelivr')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }))
    );
    return;
  }

  // App-Shell: Netz zuerst mit Revalidierung (frische Version), Cache als Fallback
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request.url, { cache: 'no-cache' }).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});

/* ---------- Push-Nachrichten ---------- */
self.addEventListener('push', e => {
  let data = { title: 'Wilma OS', body: '', url: './' };
  try { data = { ...data, ...e.data.json() }; } catch (err) { if (e.data) data.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    tag: data.tag || 'wilma', renotify: false, data: { url: data.url },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate?.(target); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
