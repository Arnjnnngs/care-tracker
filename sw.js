const CACHE = 'caretracker-v58';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// WHY THE SHELL IS NETWORK-FIRST (v53).
// This used to be cache-first for everything but Firebase, which included index.html -- the whole
// app. That made freshness depend entirely on the service worker update cycle, and on an installed
// iOS PWA that cycle may not run until a cold start. The result, repeatedly: a build was live and
// correct on the server while the phone kept showing the previous one, with no way for the person
// holding it to tell the difference. Aaron hit this at least four times.
//
// Now: the shell is fetched from the network and only falls back to the cache when the network
// actually fails, so the app is still fully usable offline. Every successful fetch refreshes the
// cached copy, so the offline fallback is the last build seen rather than the build first installed.
// Icons and the manifest stay cache-first -- they are bigger, they effectively never change, and
// they are not what goes stale.
function isShellRequest(req) {
  if (req.mode === 'navigate') return true;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return false;
  return u.pathname.endsWith('/') || u.pathname.endsWith('/index.html') || u.pathname.endsWith('/sw.js');
}

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // Firebase: network-first, unchanged.
  if (url.includes('firestore.googleapis.com') || url.includes('gstatic.com') || url.includes('googleapis.com')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  if (isShellRequest(e.request)) {
    e.respondWith(
      fetch(e.request).then(res => {
        // Only cache a real success. Caching a 404 or an opaque error page would poison the
        // offline fallback with a broken shell, which is worse than having no fallback.
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() =>
        // Offline. Fall back to this exact request, then to the shell root, so a navigation to a
        // URL carrying a cache-busting query string still resolves instead of failing hard.
        caches.match(e.request).then(r => r || caches.match('index.html')).then(r => r || caches.match('./'))
      )
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      if (cls.length > 0) {
        cls[0].focus();
      } else {
        clients.openWindow('./');
      }
    })
  );
});
