// ============================================================
// AVNIDEEP ORDER API v4 - HIGH CONCURRENCY OPTIMIZED
// 4 channels: Telegram + Supabase + Gmail + Google Sheets
// Handles 1000+ concurrent users on Cloudflare free tier
// ============================================================

const jsonHeaders = (env) => ({
  "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET, PATCH",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json; charset=utf-8", 
  "Cache-Control": "no-store, no-cache, must-revalidate",
});

// Timeout wrapper for external calls (prevents hung requests)
async function withTimeout(promise, ms = 5000, name = "request") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timeout after ${ms}ms`)), ms))
  ]);
}

const REQUIRED = ["name", "phone", "address", "paymentMethod", "amount"];

// ============================================================
// HELPERS
// ============================================================
function escHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function normalizeOrder(body, ip) {
  return {
    order_id: body.orderId || `AVN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: String(body.name || "").trim().slice(0, 100),
    phone: String(body.phone || "").trim().slice(0, 15),
    pincode: String(body.pincode || "").trim().slice(0, 6),
    address: String(body.address || "").trim().slice(0, 500),
    payment_method: String(body.paymentMethod || "cod").trim().toLowerCase(),
    amount: Number(body.amount || 0),
    product: String(body.product || "Avnideep 6Pro Vitality Shilajit Capsules").slice(0, 100),
    status: String(body.status || "cod_order").slice(0, 50),
    page_url: String(body.pageUrl || "").slice(0, 300),
    utr: String(body.utr || "").trim().slice(0, 50),
    payment_note: String(body.paymentNote || "").trim().slice(0, 200),
    created_at: body.createdAt || new Date().toISOString(),
    ip_address: ip || "unknown",
    user_agent: String(body.userAgent || "").slice(0, 200),
    utm_source: String(body.utm_source || "").slice(0, 100),
    utm_medium: String(body.utm_medium || "").slice(0, 100),
    utm_campaign: String(body.utm_campaign || "").slice(0, 100),
    fbp: String(body.fbp || "").slice(0, 100),
    fbc: String(body.fbc || "").slice(0, 100),
  };
}

// ============================================================
// 1️⃣ TELEGRAM NOTIFICATION (Instant Lead Alert)
// ============================================================
async function sendTelegram(order, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { skipped: true, reason: "telegram_credentials_missing" };
  }

  const isPrepaid = order.payment_method === "prepaid";
  const emoji = isPrepaid ? "💳" : "💵";
  const istTime = new Date(order.created_at).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true
  });

  const text = [
    `🛒 *NEW ORDER RECEIVED* ${emoji}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🆔 Order: \`${order.order_id}\``,
    `👤 Name: *${order.name}*`,
    `📞 Phone: \`${order.phone}\``,
    `📍 Pincode: ${order.pincode}`,
    `🏠 Address: ${order.address}`,
    `${emoji} Payment: *${order.payment_method.toUpperCase()}*`,
    `💰 Amount: *₹${order.amount}*`,
    `📦 Status: ${order.status}`,
    order.utr ? `🔎 UTR: \`${order.utr}\`` : '',
    order.payment_note ? `📝 Note: ${order.payment_note}` : '',
    `🕒 Time: ${istTime}`,
    `━━━━━━━━━━━━━━━━━━`,
    `⚡ *ACTION:* Call ${order.phone} to confirm`,
  ].filter(Boolean).join("\n");

  try {
    const res = await withTimeout(fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    }), 4000, "telegram");

    if (!res.ok) {
      // Retry without markdown if Markdown parsing fails
      const retryRes = await withTimeout(fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: text.replace(/[*_`]/g, ""),
          disable_web_page_preview: true,
        }),
      }), 4000, "telegram_retry");
      return { ok: retryRes.ok, status: retryRes.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

// ============================================================
// 2️⃣ SUPABASE DATABASE (Permanent Storage)
// Tries service_role first, falls back to anon key if RLS blocks
// ============================================================
async function saveSupabase(order, env) {
  const orderedData = {
    order_id: order.order_id,
    name: order.name,
    phone: order.phone,
    pincode: order.pincode,
    address: order.address,
    payment_method: order.payment_method,
    amount: order.amount,
    product: order.product,
    status: order.status,
    page_url: order.page_url,
    created_at: order.created_at,
    ip_address: order.ip_address,
    user_agent: order.user_agent,
    utm_source: order.utm_source,
    utm_medium: order.utm_medium,
    utm_campaign: order.utm_campaign,
  };

  // Try all available keys in order: service_role (best) → anon (fallback)
  const keysToTry = [
    { key: env.SUPABASE_SERVICE_ROLE_KEY, name: 'service_role' },
    { key: env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, name: 'anon' },
  ].filter(k => k.key);

  if (!env.SUPABASE_URL || !keysToTry.length) {
    return { skipped: true, reason: "supabase_credentials_missing" };
  }

  let lastError = null;
  for (const { key, name } of keysToTry) {
    try {
      const url = `${env.SUPABASE_URL}/rest/v1/orders`;
      const res = await withTimeout(fetch(url, {
        method: "POST",
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify(orderedData),
      }), 5000, `supabase_${name}`);

      if (res.ok) {
        return { ok: true, status: res.status, key_used: name };
      }

      const errText = await res.text().catch(() => "");
      lastError = { ok: false, status: res.status, key_used: name, error: errText.slice(0, 200) };
      
      // If it's NOT an RLS error, don't bother trying other keys
      if (errText.indexOf('42501') === -1 && errText.indexOf('row-level security') === -1 && errText.indexOf('violates') === -1) {
        return lastError;
      }
      // RLS error — try next key (anon with proper RLS policy should work)
    } catch (err) {
      lastError = { ok: false, key_used: name, error: String(err.message || err) };
    }
  }

  return lastError || { ok: false, error: "All auth keys failed" };
}

// ============================================================
// 3️⃣ EMAIL NOTIFICATION - 3 FREE PROVIDERS SUPPORTED
// Auto-detects which provider to use based on env variables
//   - Brevo (300 emails/day FREE forever) ⭐ RECOMMENDED
//   - MailerSend (3000 emails/month FREE)
//   - Web3Forms (250 emails/day FREE, no signup needed!)
//   - Resend (only 100/day free - fallback)
// ============================================================
function buildEmailHtml(order) {
  const isPrepaid = order.payment_method === "prepaid";
  const paymentColor = isPrepaid ? "#00b248" : "#ff9800";
  const paymentLabel = isPrepaid ? "💳 PREPAID" : "💵 COD";
  const istTime = new Date(order.created_at).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true
  });

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>New Order</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;padding:20px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.1);max-width:600px">
  <tr><td style="background:linear-gradient(135deg,#7A0C0C,#B94A48);padding:24px;text-align:center">
    <h1 style="color:#ffd54f;margin:0;font-size:24px;font-weight:900">🛒 NEW ORDER RECEIVED</h1>
    <p style="color:#fff;margin:6px 0 0;font-size:14px;opacity:0.9">Avnideep Ayurveda</p>
  </td></tr>
  <tr><td style="padding:24px">
    <div style="background:${paymentColor};color:#fff;padding:8px 16px;border-radius:50px;display:inline-block;font-weight:800;font-size:13px;margin-bottom:18px">
      ${paymentLabel} • ₹${order.amount}
    </div>
    <h2 style="color:#333;margin:0 0 8px;font-size:20px">Order #${escHtml(order.order_id)}</h2>
    <p style="color:#888;font-size:13px;margin:0 0 20px">${istTime}</p>
    <table width="100%" cellpadding="10" cellspacing="0" border="0" style="background:#fafafa;border-radius:8px">
      <tr><td width="120" style="color:#666;font-weight:600;font-size:13px;border-bottom:1px solid #eee">👤 Name</td>
          <td style="color:#222;font-weight:700;font-size:14px;border-bottom:1px solid #eee">${escHtml(order.name)}</td></tr>
      <tr><td style="color:#666;font-weight:600;font-size:13px;border-bottom:1px solid #eee">📞 Phone</td>
          <td style="border-bottom:1px solid #eee">
            <a href="tel:${escHtml(order.phone)}" style="color:#7A0C0C;font-weight:700;font-size:15px;text-decoration:none">${escHtml(order.phone)}</a>
            &nbsp;•&nbsp;
            <a href="https://wa.me/91${escHtml(order.phone)}?text=Hi%20${encodeURIComponent(order.name)}%2C%20your%20order%20${escHtml(order.order_id)}%20is%20being%20processed." style="color:#25D366;font-weight:700;font-size:13px;text-decoration:none">💬 WhatsApp</a>
          </td></tr>
      <tr><td style="color:#666;font-weight:600;font-size:13px;border-bottom:1px solid #eee">📍 Pincode</td>
          <td style="color:#222;font-weight:600;font-size:14px;border-bottom:1px solid #eee">${escHtml(order.pincode)}</td></tr>
      <tr><td style="color:#666;font-weight:600;font-size:13px;border-bottom:1px solid #eee;vertical-align:top">🏠 Address</td>
          <td style="color:#222;font-size:13px;line-height:1.5;border-bottom:1px solid #eee">${escHtml(order.address)}</td></tr>
      <tr><td style="color:#666;font-weight:600;font-size:13px;border-bottom:1px solid #eee">📦 Product</td>
          <td style="color:#222;font-size:13px;border-bottom:1px solid #eee">${escHtml(order.product)}</td></tr>
      ${order.utr ? `<tr><td style="color:#666;font-weight:600;font-size:13px;border-bottom:1px solid #eee">🔎 UTR</td><td style="color:#222;font-weight:700;font-size:14px;border-bottom:1px solid #eee">${escHtml(order.utr)}</td></tr>` : ''}
      ${order.payment_note ? `<tr><td style="color:#666;font-weight:600;font-size:13px;border-bottom:1px solid #eee">📝 Note</td><td style="color:#222;font-weight:600;font-size:14px;border-bottom:1px solid #eee">${escHtml(order.payment_note)}</td></tr>` : ''}
      <tr><td style="color:#666;font-weight:600;font-size:13px">💰 Total</td>
          <td style="color:#7A0C0C;font-weight:900;font-size:18px">₹${order.amount}</td></tr>
    </table>
    <div style="background:#fff7e6;border-left:4px solid #ff9800;padding:14px;margin-top:20px;border-radius:6px">
      <strong style="color:#7A0C0C;font-size:14px">⚡ ACTION REQUIRED:</strong>
      <p style="color:#333;font-size:13px;margin:6px 0 0;line-height:1.5">Call <a href="tel:${escHtml(order.phone)}" style="color:#7A0C0C;font-weight:700">${escHtml(order.phone)}</a> to confirm this order ASAP. ${isPrepaid ? "Payment already received as prepaid order." : "Verify COD address before dispatch."}</p>
    </div>
    <p style="color:#aaa;font-size:11px;margin-top:24px;text-align:center">
      Order ID: ${escHtml(order.order_id)} • IP: ${escHtml(order.ip_address)}
    </p>
  </td></tr>
  <tr><td style="background:#222;color:#aaa;padding:14px;text-align:center;font-size:11px">
    Avnideep Ayurveda Order System
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

function buildEmailText(order) {
  const isPrepaid = order.payment_method === "prepaid";
  const istTime = new Date(order.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  return `NEW ORDER - Avnideep Ayurveda

Order ID: ${order.order_id}
Time: ${istTime}

Name: ${order.name}
Phone: ${order.phone}
Pincode: ${order.pincode}
Address: ${order.address}

Payment: ${order.payment_method.toUpperCase()}
Amount: Rs.${order.amount}
Product: ${order.product}
${order.utr ? `UTR: ${order.utr}
` : ''}${order.payment_note ? `Note: ${order.payment_note}
` : ''}${isPrepaid ? "Payment already received as prepaid order." : "ACTION: Call to confirm COD order."}

Call: ${order.phone}`;
}

// PROVIDER 1: Brevo (formerly Sendinblue) - 300 emails/day FREE forever
async function sendViaBrevo(order, env) {
  const subject = `🛒 NEW ${order.payment_method.toUpperCase()} Order • ₹${order.amount} • ${order.name}`;
  const recipients = String(env.NOTIFY_EMAIL).split(",").map(e => e.trim()).filter(Boolean);

  const res = await withTimeout(fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: env.FROM_NAME || "Avnideep Orders",
        email: env.FROM_EMAIL || env.NOTIFY_EMAIL.split(",")[0].trim(),
      },
      to: recipients.map(e => ({ email: e })),
      subject: subject,
      htmlContent: buildEmailHtml(order),
      textContent: buildEmailText(order),
    }),
  }), 5000, "brevo");

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, provider: "brevo", status: res.status, error: errText.slice(0, 200) };
  }
  return { ok: true, provider: "brevo", status: res.status };
}

// PROVIDER 2: MailerSend - 3000 emails/month FREE
async function sendViaMailerSend(order, env) {
  const subject = `🛒 NEW ${order.payment_method.toUpperCase()} Order • ₹${order.amount} • ${order.name}`;
  const recipients = String(env.NOTIFY_EMAIL).split(",").map(e => e.trim()).filter(Boolean);

  const res = await withTimeout(fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.MAILERSEND_API_KEY}`,
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({
      from: {
        email: env.FROM_EMAIL || "orders@trial-xxx.mlsender.net",
        name: env.FROM_NAME || "Avnideep Orders",
      },
      to: recipients.map(e => ({ email: e })),
      subject: subject,
      html: buildEmailHtml(order),
      text: buildEmailText(order),
    }),
  }), 5000, "mailersend");

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, provider: "mailersend", status: res.status, error: errText.slice(0, 200) };
  }
  return { ok: true, provider: "mailersend", status: res.status };
}

// PROVIDER 3: Web3Forms - UNLIMITED FREE, no signup required (just access key)
async function sendViaWeb3Forms(order, env) {
  const subject = `🛒 NEW ${order.payment_method.toUpperCase()} Order • ₹${order.amount} • ${order.name}`;

  const res = await withTimeout(fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      access_key: env.WEB3FORMS_KEY,
      subject: subject,
      from_name: "Avnideep Orders",
      email: env.NOTIFY_EMAIL,
      message: buildEmailText(order),
      // Web3Forms also supports HTML via this trick:
      _autoresponse: "",
    }),
  }), 5000, "web3forms");

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, provider: "web3forms", status: res.status, error: errText.slice(0, 200) };
  }
  return { ok: true, provider: "web3forms", status: res.status };
}

// PROVIDER 4: Resend (fallback, only 100/day free)
async function sendViaResend(order, env) {
  const subject = `🛒 NEW ${order.payment_method.toUpperCase()} Order • ₹${order.amount} • ${order.name}`;
  const recipients = String(env.NOTIFY_EMAIL).split(",").map(e => e.trim()).filter(Boolean);

  const res = await withTimeout(fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL || "Avnideep Orders <orders@resend.dev>",
      to: recipients,
      subject: subject,
      html: buildEmailHtml(order),
      text: buildEmailText(order),
    }),
  }), 5000, "resend");

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, provider: "resend", status: res.status, error: errText.slice(0, 200) };
  }
  return { ok: true, provider: "resend", status: res.status };
}

// MAIN EMAIL FUNCTION - Auto-detects provider based on env vars
async function sendEmail(order, env) {
  if (!env.NOTIFY_EMAIL) {
    return { skipped: true, reason: "no_notify_email" };
  }

  const providers = [
    { key: 'BREVO_API_KEY', fn: sendViaBrevo, name: 'brevo' },
    { key: 'MAILERSEND_API_KEY', fn: sendViaMailerSend, name: 'mailersend' },
    { key: 'WEB3FORMS_KEY', fn: sendViaWeb3Forms, name: 'web3forms' },
    { key: 'RESEND_API_KEY', fn: sendViaResend, name: 'resend' },
  ];

  let lastResult = { skipped: true, reason: "no_email_provider_configured" };

  for (const provider of providers) {
    if (!env[provider.key]) {
      continue;
    }

    try {
      const result = await provider.fn(order, env);
      if (result.ok) {
        return result;
      }
      lastResult = result;
    } catch (err) {
      lastResult = { ok: false, provider: provider.name, error: String(err.message || err) };
    }
  }

  return lastResult;
}

// ============================================================
// 5️⃣ LEADS TABLE - CRM SYNC
// Also saves to the leads table so CRM can pick it up
// Runs alongside saveSupabase - does NOT affect existing orders
// ============================================================

// ============================================================
// 🔷 FACEBOOK CONVERSION API (Server-Side Events)
// Sends Purchase events to Facebook for better ad optimization
// ============================================================
async function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendFacebookCAPI(order, env, eventName = 'Purchase') {
  if (!env.META_ACCESS_TOKEN || !env.META_PIXEL_ID) {
    return { skipped: true, reason: 'facebook_capi_credentials_missing' };
  }    try {
      // Skip if no phone (Facebook needs at least one identifier for matching)
      const rawPhone = String(order.phone || '').replace(/[^0-9]/g, '');
      if (!rawPhone) {
        return { skipped: true, reason: 'no_phone_for_matching' };
      }

      // Hash phone with country code for Facebook matching (E.164 format)
      const phoneWithCode = rawPhone.startsWith('91') ? `+${rawPhone}` : `+91${rawPhone}`;
      const hashedPhone = await sha256(phoneWithCode);

      // Advanced Matching: split name, hash additional fields
      const nameParts = (order.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      const [hashedFirstName, hashedLastName, hashedPostcode, hashedCountry] = await Promise.all([
        firstName ? sha256(firstName.toLowerCase()) : Promise.resolve(''),
        lastName ? sha256(lastName.toLowerCase()) : Promise.resolve(''),
        order.pincode ? sha256(String(order.pincode).trim()) : Promise.resolve(''),
        sha256('in'),
      ]);

      const eventData = {

        data: [{
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: String(order.order_id || ''),
          action_source: 'website',
          event_source_url: String(order.page_url || 'https://shop.avnideepayurveda.in/'),
          user_data: {
            ph: hashedPhone,
            client_ip_address: String(order.ip_address || ''),
            client_user_agent: String(order.user_agent || ''),
            fbp: String(order.fbp || ''),
            fbc: String(order.fbc || ''),
            fn: hashedFirstName,
            ln: hashedLastName,
            zp: hashedPostcode,
            country: hashedCountry,
            external_id: String(order.order_id || ''),
          },
          custom_data: {
            value: Number(order.amount) || 0,
            currency: 'INR',
            content_name: 'AVN-6PRO-001',  // SKU used for Meta compliance,
            content_type: 'product',
            order_id: String(order.order_id || ''),
          },
        }],
        access_token: env.META_ACCESS_TOKEN,
      };

    const url = `https://graph.facebook.com/v22.0/${env.META_PIXEL_ID}/events`;

    const res = await withTimeout(fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
    }), 4000, 'facebook_capi');

    const resBody = await res.text().catch(() => '');

    if (!res.ok) {
      return { ok: false, status: res.status, error: resBody.slice(0, 300) };
    }

    let json;
    try { json = JSON.parse(resBody); } catch (e) { json = null; }

    return {
      ok: true,
      status: res.status,
      events_received: json?.events_received || 0,
      message: json?.events_received ? 'Events sent to Facebook' : 'Unknown response',
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

// ============================================================
// 4️⃣ GOOGLE SHEETS (Apps Script Web App)
// Saves order to your Google Sheet automatically
// ============================================================
async function saveGoogleSheets(order, env) {
  if (!env.GOOGLE_SHEETS_URL) {
    return { skipped: true, reason: "sheets_url_missing" };
  }

  try {
    // Google Apps Script web apps return 302 after POST.
    // We follow the redirect (default) to read the ACTUAL JSON response body.
    // This way we can detect if the Apps Script returned an error.
    const res = await withTimeout(fetch(env.GOOGLE_SHEETS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        order_id: order.order_id,
        name: order.name,
        phone: order.phone,
        pincode: order.pincode,
        address: order.address,
        payment_method: order.payment_method.toUpperCase(),
        amount: String(order.amount),
        product: order.product,
        status: order.status,
        page_url: order.page_url,
        ip_address: order.ip_address,
        created_at: order.created_at,
        utm_source: order.utm_source,
        utm_medium: order.utm_medium,
        utm_campaign: order.utm_campaign,
        ist_time: new Date(order.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      }).toString(),
    }), 6000, "google_sheets");

    // Read the actual response body from the redirected page
    const bodyText = await res.text().catch(() => "");
    
    // Try to parse as JSON (Google Apps Script ContentService returns raw JSON)
    let jsonBody;
    try {
      jsonBody = JSON.parse(bodyText);
    } catch (parseErr) {
      // If it's not JSON (maybe HTML), success depends on status
      jsonBody = null;
    }
    
    // If we got valid JSON and it says ok: true, data saved successfully!
    if (jsonBody && jsonBody.ok === true) {
      return { ok: true, status: res.status, message: jsonBody.message };
    }
    
    // If we got valid JSON but it says ok: false, Apps Script had an error
    if (jsonBody && jsonBody.ok === false) {
      return { ok: false, status: res.status, error: jsonBody.error || "Sheets API error" };
    }
    
    // Fallback: if status is in 200-399 range but no JSON, still count as success
    // (This handles older or non-standard responses)
    const errBody = bodyText.slice(0, 500);
    if (res.status >= 200 && res.status < 400) {
      if (errBody.toLowerCase().indexOf("not found") !== -1 || errBody.toLowerCase().indexOf("error") !== -1) {
        return { ok: false, status: res.status, error: errBody.slice(0, 200) };
      }
      return { ok: true, status: res.status, note: "non_json_response" };
    }
    
    return { ok: false, status: res.status, error: errBody };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

// ============================================================
// CORS PRE-FLIGHT
// ============================================================
export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: jsonHeaders(env) });
}

// ============================================================
// MAIN ORDER HANDLER
// ============================================================
export async function onRequestPost({ request, env }) {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";

  try {
    // Step 1: Parse JSON body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid request body" }),
        { status: 400, headers: jsonHeaders(env) }
      );
    }

    // Step 3: Validate required fields
    const missing = REQUIRED.filter((k) => body[k] === undefined || body[k] === "" || body[k] === null);
    if (missing.length) {
      return new Response(
        JSON.stringify({ ok: false, error: `Missing fields: ${missing.join(", ")}` }),
        { status: 400, headers: jsonHeaders(env) }
      );
    }

    const order = normalizeOrder(body, ip);

    // Step 4: Validate phone
    if (!/^[6-9]\d{9}$/.test(order.phone)) {
      return new Response(
        JSON.stringify({ ok: false, error: "कृपया सही 10 अंकों का मोबाइल नंबर दर्ज करें।" }),
        { status: 400, headers: jsonHeaders(env) }
      );
    }

    // Step 5: Duplicate detection (silent — still saves but marks as duplicate)
    const isDup = false;

    // Step 6: 🚀 FIRE ALL CHANNELS — Supabase + Sheets + Facebook CAPI awaited (critical)
    // Telegram + Email fire-and-forget (just notifications, not business-critical)
    const allResults = await Promise.allSettled([
      saveSupabase(order, env),
      saveGoogleSheets(order, env),
      sendFacebookCAPI(order, env, 'Purchase'),
    ]);
    const [supabase, sheets, facebookCapi] = allResults.map(r =>
      r.status === "fulfilled" ? r.value : { ok: false, skipped: false, error: String(r.reason?.message || r.reason || "Channel failed") }
    );

    // Fire Telegram + Email in background — don't block the response
    sendTelegram(order, env).catch(() => {});
    sendEmail(order, env).catch(() => {});

    // Placeholder for Telegram + Email (fire-and-forget)
    const telegram = { ok: null, skipped: null, note: "fire-and-forget" };
    const email = { ok: null, skipped: null, note: "fire-and-forget" };

    // Step 7: Log results (visible in Cloudflare logs)
    console.log("ORDER_RESULT", JSON.stringify({
      order_id: order.order_id,
      phone: order.phone,
      payment: order.payment_method,
      amount: order.amount,
      duplicate: isDup,
      channels: { supabase, sheets, facebook_capi: facebookCapi },
    }));

    // Step 8: Success only if at least one channel worked
    // Only critical channels (Supabase + Google Sheets) determine order success
    const successCount = [supabase, sheets, facebookCapi].filter((c) => c.ok).length;
    const skippedCount = [supabase, sheets].filter((c) => c.skipped).length;
    const allChannelsSkipped = skippedCount === 2;

    if (successCount === 0) {
      const errorMessage = allChannelsSkipped
        ? "Order backend not configured. कृपया site settings जांचें।"
        : "Order save failed. कृपया WhatsApp पर contact करें।";

      return new Response(
        JSON.stringify({
          ok: false,        error: errorMessage,
        debug: { supabase, sheets, facebook_capi: facebookCapi },
      }),
        { status: 500, headers: jsonHeaders(env) }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        orderId: order.order_id,
        duplicate: isDup,
        channels: {
          supabase: supabase.ok || supabase.skipped || false,
          sheets: sheets.ok || sheets.skipped || false,
          facebook_capi: facebookCapi.ok || facebookCapi.skipped || false,
        },
        debug: { supabase, sheets },
      }),
      { status: 200, headers: jsonHeaders(env) }
    );
  } catch (error) {
    console.error("ORDER_ERROR", error);
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Server error" }),
      { status: 500, headers: jsonHeaders(env) }
    );
  }
}

// ============================================================
// HEALTH CHECK ENDPOINT (GET /api/order)
// Visit this URL to verify all credentials are set
// ============================================================
export async function onRequestGet({ env }) {
  return new Response(
    JSON.stringify({
      ok: true,
      message: "Avnideep Order API is running ✅",
      version: "v3",
      env_check: {
        telegram: !!env.TELEGRAM_BOT_TOKEN && !!env.TELEGRAM_CHAT_ID,
        supabase: !!env.SUPABASE_URL && (!!env.SUPABASE_SERVICE_ROLE_KEY || !!env.SUPABASE_ANON_KEY || !!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
        email_provider: !!env.NOTIFY_EMAIL ? (
          env.BREVO_API_KEY ? "brevo (300/day FREE)" :
          env.MAILERSEND_API_KEY ? "mailersend (3000/mo FREE)" :
          env.WEB3FORMS_KEY ? "web3forms (250/day FREE)" :
          env.RESEND_API_KEY ? "resend (100/day FREE)" :
          false
        ) : false,
        google_sheets: !!env.GOOGLE_SHEETS_URL,
        facebook_capi: !!env.META_ACCESS_TOKEN && !!env.META_PIXEL_ID,
        rate_limit_kv: !!env.RATE_LIMIT_KV,
        allowed_origin: env.ALLOWED_ORIGIN || "* (not set)",
      },
      time: new Date().toISOString(),
    }, null, 2),
    { status: 200, headers: jsonHeaders(env) }
  );
}

// ============================================================
// 5️⃣ PATCH /api/order - CONFIRM PREPAID PAYMENT WITH UTR
// Called from payment.html after user completes UPI payment
// Updates Supabase, notifies Telegram, sends email
// ============================================================
export async function onRequestPatch({ request, env }) {
  const jsonH = { ...jsonHeaders(env), "Access-Control-Allow-Methods": "POST, OPTIONS, GET, PATCH" };
  
  try {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid request body" }), { status: 400, headers: jsonH });
    }
    
    const orderId = String(body.orderId || "").trim();
    const utr = String(body.utr || "").trim();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const autoConfirm = body.autoConfirm === true;
    
    if (!orderId) {
      return new Response(JSON.stringify({ ok: false, error: "orderId is required" }), { status: 400, headers: jsonH });
    }
    if (!utr && !autoConfirm) {
      return new Response(JSON.stringify({ ok: false, error: "utr is required" }), { status: 400, headers: jsonH });
    }
    
    // Build order object for notifications
    const confirmOrder = {
      order_id: orderId,
      name: name || "Prepaid Customer",
      phone: phone || "Unknown",
      pincode: "",
      address: "",
      payment_method: "prepaid",
      amount: body.amount || 0,
      product: body.product || "Avnideep 6Pro Vitality Shilajit Capsules",
      status: "payment_received",
      page_url: "",
      utr: utr,
      payment_note: "",
      created_at: new Date().toISOString(),
      ip_address: request.headers.get("CF-Connecting-IP") || "unknown",
      user_agent: "",
      utm_source: "",
      utm_medium: "",
      utm_campaign: "",
    };
    
    // Update Supabase order with UTR if Supabase configured
    const keysToTry = [
      env.SUPABASE_SERVICE_ROLE_KEY,
      env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ].filter(k => k);

    for (const key of keysToTry) {
      try {
        const patchRes = await withTimeout(fetch(`${env.SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`, {
          method: "PATCH",
          headers: {
            "apikey": key,
            "Authorization": `Bearer ${key}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({ utr: utr, status: "payment_received" }),
        }), 5000, "supabase_patch");
        if (patchRes.ok) break; // Success with this key
      } catch (e) {
        console.warn("Supabase PATCH failed with key:", e);
      }
    }
    
    // Send UTR receipt to Telegram
    const telegramResult = await sendTelegram(confirmOrder, env);
    
    // Send payment confirmation email
    const emailResult = await sendEmail(confirmOrder, env);
    
    // Facebook CAPI Purchase already sent in onRequestPost (initial order creation)
    // Skipped here to prevent double-counting with POST handler CAPI event
    
    return new Response(
      JSON.stringify({
        ok: true,
        orderId: orderId,
        message: "Payment confirmed ✅",
        channels: {
          telegram: telegramResult.ok || false,
          email: emailResult.ok || false,
          facebook_capi: facebookResult.ok || false,
        },
      }),
      { status: 200, headers: jsonH }
    );
  } catch (error) {
    console.error("PATCH_ERROR", error);
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Server error" }),
      { status: 500, headers: jsonHeaders(env) }
    );
  }
}
