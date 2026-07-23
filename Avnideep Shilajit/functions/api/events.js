/**
 * /api/events - Server-side Facebook CAPI event tracking endpoint
 * Called by app.js (client-side) to forward events with matching event_id for dedup
 * Supports: ViewContent, Lead, InitiateCheckout, Purchase
 */

import { sendCAPIEvent, buildUserData, buildCustomData } from './_capi';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': 'true',
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
  const { request, env } = context;

  // Origin validation (same as order.js)
  const origin = request.headers.get('Origin') || request.headers.get('Referer') || '';
  if (env.ALLOWED_ORIGIN && !origin.startsWith(env.ALLOWED_ORIGIN)) {
    return new Response(JSON.stringify({ error: 'Invalid origin' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const { event_name, event_id, user_data, custom_data, event_source_url } = body;
    console.log(`[CAPILOG] BROWSER CAPI RECEIVED: event_name=${event_name} event_id=${event_id} custom_data=${JSON.stringify(custom_data)} user_data=${JSON.stringify(user_data)}`);

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

    // Send to Meta CAPI
    const result = await sendCAPIEvent({
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

    return jsonResponse({
      success: true,
      event_name,
      event_id,
      meta_response: result
    });
  } catch (err) {
    console.error('Events API error:', err.message);
    return jsonResponse({ error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
