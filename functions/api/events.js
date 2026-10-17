/**
 * /api/events - Server-side Facebook CAPI event tracking endpoint
 * Called by app.js (client-side) to forward events with matching event_id for dedup
 * Supports: ViewContent, Lead, InitiateCheckout, Purchase
 */

import { sendCAPIEvent, buildUserData, buildCustomData } from './_capi';

const corsHeaders = {
  // No credentials are used here; "*" + Allow-Credentials is an invalid combo
  // that browsers reject for credentialed requests.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  // Origin validation - compare HOSTNAMES exactly. A prefix check let
  // "https://avnideepayurveda.in.evil.com" through.
  const origin = request.headers.get('Origin') || request.headers.get('Referer') || '';
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).hostname.toLowerCase();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid origin' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    let allowedHost = 'avnideepayurveda.in';
    try {
      if (env.ALLOWED_ORIGIN) allowedHost = new URL(env.ALLOWED_ORIGIN).hostname.toLowerCase();
    } catch (e) {}
    const allowedHosts = [allowedHost, 'avnideepayurveda.in', 'avnideep-shilajit-new.pages.dev', 'localhost', '127.0.0.1'];
    const okOrigin = allowedHosts.some((h) => h && (originHost === h || originHost.endsWith('.' + h)));
    if (!okOrigin) {
      return new Response(JSON.stringify({ error: 'Invalid origin' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // Per-IP throttle so the CAPI relay cannot be flooded from one client.
  const throttleIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  if (env.RATE_LIMIT_KV) {
    try {
      const bucket = Math.floor(Date.now() / 60000);
      const rlKey = 'capi_rl_' + throttleIp + '_' + bucket;
      const seen = parseInt((await env.RATE_LIMIT_KV.get(rlKey)) || '0', 10);
      if (seen >= 120) {
        return new Response(JSON.stringify({ error: 'Too many events' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      await env.RATE_LIMIT_KV.put(rlKey, String(seen + 1), { expirationTtl: 120 }).catch(() => {});
    } catch (e) {}
  }

  try {
    const body = await request.json();
    const { event_name, event_id, user_data, custom_data, event_source_url } = body;
    // Do NOT log raw user_data - it carries plaintext customer name/phone.
    console.log(`[CAPILOG] BROWSER CAPI RECEIVED: event_name=${event_name} event_id=${event_id} custom_data=${JSON.stringify(custom_data)} has_user_data=${!!user_data}`);

    // Validate required fields
    if (!event_name) {
      return jsonResponse({ error: 'event_name is required' }, 400);
    }
    if (!event_id) {
      return jsonResponse({ error: 'event_id is required for dedup' }, 400);
    }

    // Build user_data with hashed PII
    // Prefer client_user_agent from request body (sent by browser JS),
    // fall back to User-Agent header for server-to-server calls
    const userUa = user_data?.client_user_agent || request.headers.get('User-Agent') || '';
    const userIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
    const userData = await buildUserData({
      name: user_data?.name,
      phone: user_data?.phone,
      fbp: user_data?.fbp,
      fbc: user_data?.fbc,
      ip: userIp,
      ua: userUa,
      orderId: custom_data?.order_id
    });

    // Build custom_data
    const metaCustomData = buildCustomData({
      value: custom_data?.value,
      currency: custom_data?.currency || 'INR',
      orderId: custom_data?.order_id,
      contentName: custom_data?.content_name,
      contentType: custom_data?.content_type
    });

    // Perf: send to Meta CAPI in background (waitUntil) so we respond instantly.
    // The browser already fire-and-forgets this call; no client depends on the response body.
    const capiPromise = sendCAPIEvent({
      env,
      eventName: event_name,
      eventId: event_id,
      userData,
      customData: metaCustomData,
      eventSourceUrl: event_source_url || '',
      actionSource: 'website',
      timeout: 4000,
      retries: 1
    });
    // Dedup: when this is a Purchase event carrying an order_id (COD thank-you flow),
    // mark purchase_capi_sent in D1 AFTER Meta confirms, so a later PATCH/webhook
    // confirm for the same order cannot double-fire Purchase CAPI.
    const dedupPromise = capiPromise.then((res) => {
      if (event_name === 'Purchase' && res && res.ok && custom_data && custom_data.order_id && env && env.DB) {
        // Only flip the flag if it isn't already set, so a replayed event cannot
        // rewrite state for an order that already fired Purchase.
        return env.DB.prepare('UPDATE orders SET purchase_capi_sent = 1 WHERE order_id = ? AND (purchase_capi_sent IS NULL OR purchase_capi_sent = 0)')
          .bind(String(custom_data.order_id)).run().then(() => res).catch(() => res);
      }
      return res;
    });
    if (typeof waitUntil === 'function') {
      waitUntil(dedupPromise.catch(() => {}));
    } else {
      dedupPromise.catch(() => {});
    }

    return jsonResponse({
      success: true,
      event_name,
      event_id,
      meta_response: { ok: true, background: true }
    });
  } catch (err) {
    console.error('Events API error:', err.message);
    return jsonResponse({ error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
