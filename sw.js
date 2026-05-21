// Avnideep Service Worker v5 - Performance Optimized
// Strategy: Network-only for HTML/API, Stale-While-Revalidate for static assets
const VER = "avn-v5-2026";
const ASSET_CACHE = `assets-${VER}`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.endsWith(VER)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Don't intercept:
  // - API requests (always fresh)
  // - Third-party requests (Razorpay, FB, YouTube)
  // - Pages outside our origin
  // - Range requests
  if (url.pathname.startsWith("/api/") ||
      url.hostname !== self.location.hostname ||
      req.headers.get("range")) {
    return;
  }

  // HTML pages - ALWAYS fetch fresh (no cache, ensures updates ship instantly)
  if (req.mode === "navigate" || req.destination === "document") {
    return;
  }

  // Images, fonts, manifest - Stale-While-Revalidate
  // Serves cached version instantly, updates cache in background
  // This prevents the "sometimes show, sometimes don't" issue
  if (req.destination === "image" ||
      req.destination === "font" ||
      req.destination === "manifest" ||
      url.pathname.endsWith(".webp") ||
      url.pathname.endsWith(".jpg") ||
      url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".woff2")) {
    e.respondWith(
      caches.match(req).then((cached) => {
        // Stale-while-revalidate: return cached immediately, update in background
        const fetchPromise = fetch(req).then((res) => {
          if (res.ok && res.status === 200) {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached);

        // Return cached version immediately if available
        // If not cached, wait for network
        return cached || fetchPromise;
      })
    );
  }
});
