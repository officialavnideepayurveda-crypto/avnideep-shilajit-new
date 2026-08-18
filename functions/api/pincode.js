// /api/pincode?code=110001
// Server-side pincode lookup proxy - Cloudflare Pages Function.
// Why: api.postalpincode.in was timing out for end users (8s+ wait then
// 'network slow' error). This runs at the Cloudflare edge, tries BOTH
// upstream APIs in parallel with short timeouts, and caches the result in
// KV + CDN so repeat pincodes resolve instantly (and free).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function jsonResponse(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(extraHeaders || {}) }
  });
}

function fetchWithTimeout(url, ms) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms);
  return fetch(url, { signal: ctrl.signal }).then(function (res) {
    clearTimeout(timer);
    return res;
  }, function (err) {
    clearTimeout(timer);
    throw err;
  });
}

// Resolve with the FIRST VALID result (city found). Invalid is only reported
// when postalpincode (the authoritative Indian source) definitively says Error
// - a zippo 404 alone is NOT enough because zippo's India dataset is incomplete
// (it even returns {} for valid pincodes like 201003). A postal timeout counts
// as 'unknown' (null), never as invalid, so a slow/flaky postal API can never
// wrongly lock out a real pincode.
function firstFound(promises) {
  return new Promise(function (resolve) {
    var settled = 0;
    var anyValid = null;
    var postalInvalid = false;
    promises.forEach(function (p) {
      p.then(function (r) {
        settled++;
        if (r && r.found && r.city && !anyValid) { anyValid = r; resolve(r); }
        if (r && r.found && r.invalid && r.postal) { postalInvalid = true; }
        if (settled === promises.length) { resolve(anyValid || (postalInvalid ? { found: true, invalid: true } : null)); }
      });
    });
  });
}

// Try postalpincode.in - returns {city, state} or null (error/invalid/empty)
async function tryPostal(code) {
  try {
    var r = await fetchWithTimeout('https://api.postalpincode.in/pincode/' + code, 3500);
    if (!r.ok) return null;
    var data = await r.json();
    if (data && data[0] && data[0].Status === 'Success' && data[0].PostOffice && data[0].PostOffice.length > 0) {
      var po = data[0].PostOffice[0];
      return { found: true, city: po.District || po.Block || po.Name || '', state: po.State || '' };
    }
    if (data && data[0] && data[0].Status === 'Error') {
      return { found: true, invalid: true, postal: true };  // definitive not found (authoritative source)
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Try zippopotam.us - returns {city, state} or null (error/invalid/empty)
// NOTE: a zippo 404 is only a 'weak' signal (zippo's India dataset is incomplete);
// firstFound() ignores it unless postalpincode also says not-found.
async function tryZippo(code) {
  try {
    var r = await fetchWithTimeout('https://api.zippopotam.us/in/' + code, 3500);
    if (r.status === 404) return { found: true, invalid: true };  // weak invalid signal only
    if (!r.ok) return null;
    var data = await r.json();
    if (data && data.places && data.places.length > 0) {
      var p = data.places[0];
      return { found: true, city: p['place name'] || '', state: p.state || '' };
    }
    return null;
  } catch (e) {
    return null;
  }
}

export async function onRequestGet(context) {
  var url = new URL(context.request.url);
  var code = (url.searchParams.get('code') || '').replace(/\D/g, '').slice(0, 6);
  if (code.length !== 6) {
    return jsonResponse({ ok: false, error: 'invalid_pincode' }, 400);
  }

  var env = context.env;
  var kv = env && env.RATE_LIMIT_KV;

  // 1) KV cache hit -> instant, zero upstream calls (pin2_ prefix = v2; old pin_
  //    entries cached invalid results for 30 days and are now ignored)
  if (kv) {
    try {
      var cached = await kv.get('pin2_' + code);
      if (cached) {
        var cachedObj = JSON.parse(cached);
        // Invalid results: short CDN cache (1h, matches KV TTL) so a stale
        // 'invalid' never sticks at the edge for a whole day.
        var cc = cachedObj && cachedObj.invalid ? 'public, max-age=3600' : 'public, max-age=86400';
        return jsonResponse(cachedObj, 200, { 'Cache-Control': cc });
      }
    } catch (e) {}
  }

  // 2) Parallel upstream lookup - firstFound() resolves as soon as either API
  //    answers (postal preferred for District-quality city, zippo is the fast
  //    reliable fallback since postalpincode.in is flaky). No 5s stall.
  var result = await firstFound([tryPostal(code), tryZippo(code)]);

  var out = { ok: false, error: 'network' };
  if (result && result.found) {
    out = result.invalid ? { ok: true, invalid: true } : { ok: true, city: result.city, state: result.state };
  }

  // 3) Cache valid results (30 days) + invalid results (only 1 hour so a
  //    transient upstream error never locks out a real pincode for a month).
  //    Network failures NOT cached.
  if (out.ok && kv) {
    try {
      var ttl = out.invalid ? 3600 : 86400 * 30;
      await kv.put('pin2_' + code, JSON.stringify(out), { expirationTtl: ttl });
    } catch (e) {}
  }

  return jsonResponse(out, out.ok ? 200 : 502, {
    // Invalid: only 1h CDN cache (matches 1h KV TTL) - never a full day.
    'Cache-Control': out.ok ? (out.invalid ? 'public, max-age=3600' : 'public, max-age=86400') : 'no-store'
  });
}

// OPTIONS preflight
async function optionsHandler() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export { optionsHandler as onRequestOptions };
