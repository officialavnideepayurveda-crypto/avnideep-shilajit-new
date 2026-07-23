// Avnideep Admin PWA Service Worker v3
var CACHE = 'avnideep-admin-v4';
var ASSETS = [
  '/',
  '/index.html',
  '/dashboard',
  '/orders',
  '/rewards',
  '/analytics',
  '/payment-settings',
  '/seo',
  '/css/styles.css',
  '/js/api.js',
  '/js/mobile-menu.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
          .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);
  
  if (event.request.method !== 'GET') return;
  
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE + '-api').then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          if (cached) return cached;
          return new Response(JSON.stringify({error:'offline'}), {
            status: 503, headers: {'Content-Type': 'application/json'}
          });
        });
      })
    );
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-status-updates') {
    event.waitUntil(
      caches.open(CACHE + '-queue').then(function(cache) {
        return cache.keys().then(function(requests) {
          return Promise.all(requests.map(function(request) {
            return fetch(request).then(function(response) {
              if (response.ok) return cache.delete(request);
            });
          }));
        });
      })
    );
  }
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
