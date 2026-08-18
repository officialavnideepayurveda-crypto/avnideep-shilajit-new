// ============================================================
// Avnideep — Edge HTML Caching Middleware (TTFB optimization)
// ============================================================
// Caches HTML page responses at the Cloudflare edge (Cache API)
// so repeat visitors get near-instant TTFB instead of hitting
// the origin every time.
//
// Rules:
//  - GET only, HTML only, 200 OK only, never /api/*, never
//    responses with Set-Cookie
//  - fbclid/gclid are stripped from the cache key: the site does
//    NOT read them (Meta attribution uses the _fbc cookie), so
//    ALL Meta ad clicks share ONE cached copy
//  - utm_* / ref / order_id params are KEPT (used for attribution)
//  - TTL: 10 minutes (s-maxage=600) — deploys propagate quickly
//  - Adds X-Cache: HIT/MISS for verification

export async function onRequest(context) {
  const { request, next, waitUntil } = context;

  if (request.method !== "GET") return next();

  const url = new URL(request.url);
  const path = url.pathname;

  // Never cache API endpoints or static assets (assets are cached via _headers)
  if (path.startsWith("/api/")) return next();
  if (/\.(js|css|png|jpe?g|webp|svg|ico|gif|woff2?|ttf|otf|json|xml|txt|webmanifest|map)$/i.test(path)) return next();

  // Ad click IDs — not used by the site; stripping makes all FB clicks share one cache entry
  url.searchParams.delete("fbclid");
  url.searchParams.delete("gclid");

  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cache = caches.default;

  // Serve from edge cache if present
  const cached = await cache.match(cacheKey);
  if (cached) {
    const res = new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers: cached.headers,
    });
    res.headers.set("X-Cache", "HIT");
    return res;
  }

  // Not cached — let the request continue to origin
  const response = await next();

  const canCache =
    response.ok &&
    !response.headers.has("set-cookie") &&
    (response.headers.get("content-type") || "").includes("text/html");

  if (canCache) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "public, max-age=0, s-maxage=600, must-revalidate");
    headers.set("X-Cache", "MISS");
    const toCache = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    if (typeof waitUntil === "function") {
      waitUntil(cache.put(cacheKey, toCache.clone()));
    } else {
      cache.put(cacheKey, toCache.clone());
    }
    return toCache;
  }

  return response;
}
