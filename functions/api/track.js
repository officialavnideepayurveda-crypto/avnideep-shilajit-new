// Live Analytics Tracking Endpoint
// Receives page_view, form_open, heartbeat events from the frontend

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  try {
    const body = await request.json();
    const { event_type, session_id, page_url, utm_source, utm_medium, utm_campaign } = body;

    if (!event_type || !session_id) {
      return new Response(JSON.stringify({ ok: false, error: 'event_type and session_id required' }), { status: 400, headers });
    }

    const validEvents = ['page_view', 'form_open', 'heartbeat', 'purchase'];
    if (!validEvents.includes(event_type)) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid event_type' }), { status: 400, headers });
    }

    const ip = request.headers.get('CF-Connecting-IP') || '';
    const ua = request.headers.get('User-Agent') || '';

    // KV: Update live visitor heartbeat
    if (env.RATE_LIMIT_KV) {
      await env.RATE_LIMIT_KV.put(
        `lv:${session_id}`,
        JSON.stringify({ last_seen: Date.now(), event_type }),
        { expirationTtl: 120 }
      );
    }

    // D1: Store non-heartbeat events persistently
    if (event_type !== 'heartbeat' && env.DB) {
      await env.DB.prepare(
        `INSERT INTO analytics_events (event_type, session_id, page_url, utm_source, utm_medium, utm_campaign, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(event_type, session_id, page_url || '', utm_source || '', utm_medium || '', utm_campaign || '', ip, ua).run();
    }

    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (err) {
    console.error('Track error:', err);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), { status: 500, headers });
  }
}

export async function onRequestOptions(context) {
  return onRequestPost(context);
}
