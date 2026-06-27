/**
 * Shared Facebook Conversions API (CAPI) Utility for Avnideep Ayurveda
 * Used by order.js, events.js for server-side event tracking
 * Meta Graph API v22.0
 */

const META_API_VERSION = 'v22.0';

/**
 * SHA-256 hash function using Web Crypto API
 */
export async function sha256(str) {
  if (!str) return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(String(str));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Normalize phone to E.164 (91XXXXXXXXXX) and SHA-256 hash
 */
export async function hashPhone(phone) {
  if (!phone) return '';
  const cleaned = String(phone).replace(/[^\d]/g, '');
  // Normalize to E.164 format (+91XXXXXXXXXX) for Facebook CAPI
  const normalized = cleaned.length === 10
    ? '+91' + cleaned
    : cleaned.length > 10 && cleaned.startsWith('91')
      ? '+91' + cleaned.slice(-10)
      : '+91' + cleaned.slice(-10);
  return sha256(normalized);
}

/**
 * Build Facebook CAPI user_data with hashed PII for Advanced Matching
 */
export async function buildUserData({ name, phone, fbp, fbc, ip, ua, orderId, email } = {}) {
  const userData = {};
  if (phone) userData.ph = await hashPhone(phone);
  if (email) userData.em = await sha256(String(email).trim().toLowerCase());
  if (name) {
    const parts = String(name).trim().split(/\s+/);
    if (parts.length > 0) {
      userData.fn = await sha256(parts[0].toLowerCase());
      if (parts.length > 1) userData.ln = await sha256(parts.slice(1).join(' ').toLowerCase());
    }
  }
  userData.country = await sha256('in');
  if (ip) userData.client_ip_address = ip;
  if (ua) userData.client_user_agent = ua;
  if (fbp) userData.fbp = String(fbp);
  if (fbc) userData.fbc = String(fbc);
  if (orderId) userData.external_id = await sha256(String(orderId));
  return userData;
}

/**
 * Build standard custom_data for Avnideep 6Pro product
 */
export function buildCustomData({ value, currency = 'INR', orderId, contentName, contentType = 'product' } = {}) {
  const customData = {
    value: Number(value) || 0,
    currency,
    content_name: contentName || 'AVN-6PRO-001',
    content_type: contentType
  };
  if (orderId) customData.order_id = String(orderId);
  return customData;
}

/**
 * Send event to Meta Conversions API with retry support
 */
export async function sendCAPIEvent({
  env,
  eventName,
  eventId,
  userData,
  customData = {},
  eventSourceUrl = '',
  actionSource = 'website',
  timeout = 4000,
  retries = 1
} = {}) {
  if (!env.META_ACCESS_TOKEN || !env.META_PIXEL_ID) {
    console.warn('Meta CAPI: META_ACCESS_TOKEN or META_PIXEL_ID not configured');
    return null;
  }

  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: actionSource,
      event_source_url: eventSourceUrl || '',
      event_id: eventId,
      user_data: userData,
      custom_data: customData
    }]
  };

  const url = `https://graph.facebook.com/${META_API_VERSION}/${env.META_PIXEL_ID}/events`;
  const body = JSON.stringify({
    data: payload.data,
    access_token: env.META_ACCESS_TOKEN
  });

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const result = await response.json();

      if (!response.ok) {
        console.error(`Meta CAPI error (attempt ${attempt + 1}):`, JSON.stringify(result));
        lastError = result;
        if (response.status >= 400 && response.status < 500) return result;
        continue;
      }

      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error(`Meta CAPI timeout (attempt ${attempt + 1})`);
        lastError = { error: 'timeout' };
      } else {
        console.error(`Meta CAPI fetch error (attempt ${attempt + 1}):`, err.message);
        lastError = { error: err.message };
      }
    }
  }

  return lastError;
}
