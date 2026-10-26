// Offline support for the website version. The Android app loads files from the APK and never
// registers this. Network first, so a reload always picks up a new version; the cache is the
// fallback when there is no connection.
const VERSION = 'v1';
const CACHE = `expenses-${VERSION}`;

// Everything the app needs to start with no connection (checked by tests/web.test.js)
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/activity.js',
  'js/app.js',
  'js/charts.js',
  'js/editor.js',
  'js/home.js',
  'js/insights.js',
  'js/logic.js',
  'js/manage.js',
  'js/native.js',
  'js/onboarding.js',
  'js/rows.js',
  'js/settings.js',
  'js/store.js',
  'js/ui.js',
  'fonts/Inter.woff2',
  'vendor/phosphor/regular/style.css',
  'vendor/phosphor/regular/Phosphor.woff2',
  'vendor/phosphor/fill/style.css',
  'vendor/phosphor/fill/Phosphor-Fill.woff2',
  'icons/favicon.svg',
  'icons/favicon-32.png',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/shortcut-add.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE.map(path => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('expenses-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then(hit => hit || (request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
