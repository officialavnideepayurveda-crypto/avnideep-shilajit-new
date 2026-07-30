/**
 * Facebook Conversion API (CAPI) Utility Module
 * Handles sending server-side events to Meta/Facebook
 * with SHA-256 hashing for PII data
 */

// ============================================================
// SHA-256 Hashing using Web Crypto API (Cloudflare Workers native)
// ============================================================
async function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// Normalize and hash user data for Facebook CAPI
// ============================================================
async function buildUserData({ name, phone, fbp, fbc, ip, ua, orderId }) {
  const userData = {};

  // Hash phone number (remove non-digits, normalize to E.164)
  if (phone) {
    const rawPhone = String(phone).replace(/[^0-9]/g, '');
    if (rawPhone.length >= 10) {
      const last10 = rawPhone.slice(-10);
      userData.ph = await sha256('91' + last10); // India country code + phone
    }
  }

  // Hash name (lowercase, trim)
  if (name) {
    const cleanName = String(name).trim().toLowerCase();
    // Split first and last name
    const parts = cleanName.split(/\s+/);
    if (parts.length >= 2) {
      userData.fn = await sha256(parts[0]);
      userData.ln = await sha256(parts.slice(1).join(' '));
    } else {
      userData.fn = await sha256(cleanName);
    }
  }

  // External ID (order ID for dedup)
  if (orderId) {
    userData.external_id = await sha256(String(orderId));
  }

  // Browser cookies
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  // IP and User Agent (not hashed per Meta's requirements)
  if (ip && ip !== 'unknown') {
    userData.client_ip_address = ip;
  }
  if (ua) {
    userData.client_user_agent = ua;
  }

  return userData;
}

// ============================================================
// Build custom data object for the event
// ============================================================
function buildCustomData({ value, currency = 'INR', orderId, contentName, contentType }) {
  const customData = { currency };

  if (value !== undefined && value !== null) {
    customData.value = parseFloat(value);
  }

  if (contentName) {
    customData.content_name = contentName;
  }

  if (contentType) {
    customData.content_type = contentType;
  } else {
    customData.content_type = 'product';
  }

  customData.content_ids = ['AVN-6PRO-001'];
  customData.contents = [{
    id: 'AVN-6PRO-001',
    quantity: 1,
    item_price: value || 0
  }];

  if (orderId) {
    customData.order_id = orderId;
  }

  return customData;
}

// ============================================================
// Send event to Facebook/Meta Conversion API
// ============================================================
async function sendCAPIEvent({
  env,
  eventName,
  eventId,
  userData,
  customData,
  eventSourceUrl = '',
  actionSource = 'website',
  timeout = 4000,
  retries = 1
}) {
  if (!env.META_ACCESS_TOKEN || !env.META_PIXEL_ID) {
    return { skipped: true, reason: 'meta_credentials_missing' };
  }

  const pixelId = env.META_PIXEL_ID;
  const accessToken = env.META_ACCESS_TOKEN;
  const apiVersion = 'v22.0';
  const url = `https://graph.facebook.com/${apiVersion}/${pixelId}/events?access_token=${accessToken}`;

  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      event_source_url: eventSourceUrl,
      action_source: actionSource,
      user_data: userData,
      custom_data: customData,
    }],
    test_event_code: env.META_TEST_EVENT_CODE || '',
  };

  // Remove empty test event code
  if (!payload.test_event_code) {
    delete payload.test_event_code;
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseData = await response.json().catch(() => ({}));
      console.log(`[CAPI] ${eventName} (${eventId}) attempt ${attempt + 1}: ${response.status}`, JSON.stringify(responseData));

      if (response.ok) {
        return {
          ok: true,
          events_received: responseData?.events_received || 1,
          fbtrace_id: responseData?.fbtrace_id || '',
        };
      }

      // Rate limited? Wait and retry
      if (response.status === 429 && attempt < retries) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      lastError = `Meta API error: ${response.status} - ${JSON.stringify(responseData).slice(0, 200)}`;

      // Non-retryable errors
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        break;
      }
    } catch (err) {
      lastError = String(err.message || err);
      if (err.name === 'AbortError') {
        lastError = 'Request timeout';
      }
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  return { ok: false, error: lastError || 'Failed after retries' };
}

export { sendCAPIEvent, buildUserData, buildCustomData };
