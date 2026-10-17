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

const CANONICAL_HOST = "avnideepayurveda.in";
const LEGACY_HOSTS = ["shop.avnideep.in", "www.avnideepayurveda.in"];

export async function onRequest(context) {
  const { request, next, waitUntil, env } = context;

  // ---- Domain migration: old hosts -> avnideepayurveda.in (permanent 301) ----
  if (request.method === "GET" || request.method === "HEAD") {
    const host = new URL(request.url).hostname;
    if (LEGACY_HOSTS.includes(host)) {
      const dest = new URL(request.url);
      dest.protocol = "https:";
      dest.hostname = CANONICAL_HOST;
      return Response.redirect(dest.toString(), 301);
    }
  }

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
    // Admin-managed Meta Pixel injection: replace the baked-in Pixel ID with
    // the one set in admin panel (settings/tracking). Best-effort — page must
    // NEVER break because of this.
    let bodyText = null;
    try {
      const pixel = await getPixelId(env);
      if (pixel && pixel !== DEFAULT_PIXEL) {
        const raw = await response.text();
        if (raw.includes(DEFAULT_PIXEL)) {
          bodyText = raw.split(DEFAULT_PIXEL).join(pixel);
        }
      }
    } catch (e) {}
    const toCache = bodyText !== null
      ? new Response(bodyText, { status: response.status, statusText: response.statusText, headers })
      : new Response(response.body, {
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

// ---- admin-managed Meta Pixel (edge injection) ----
const DEFAULT_PIXEL = "1715387275770711";
let pixelCache = { value: "", at: 0 };
async function getPixelId(env) {
  try {
    if (Date.now() - pixelCache.at < 5 * 60 * 1000 && pixelCache.value) return pixelCache.value;
    if (!env?.DB) return DEFAULT_PIXEL;
    const row = await env.DB.prepare(
      "SELECT value FROM settings WHERE section = ? AND key = ?"
    ).bind("tracking", "meta_pixel_id").first();
    const v = String(row?.value || "").trim();
    const pixel = /^\d{8,20}$/.test(v) ? v : DEFAULT_PIXEL;
    pixelCache = { value: pixel, at: Date.now() };
    return pixel;
  } catch (e) {
    return DEFAULT_PIXEL;
  }
}
