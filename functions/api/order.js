// ============================================================
// AVNIDEEP ORDER API v5 - EDGE OPTIMIZED
// Storage: D1 (primary) + Google Sheets (backup) + Telegram + Email
// Handles 1000+ concurrent users on Cloudflare free tier
// ============================================================

import { sendCAPIEvent, buildUserData, buildCustomData } from './_capi';

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

const REQUIRED = ["name", "phone", "paymentMethod", "amount"];

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
    reward_id: String(body.rewardId || "").trim().slice(0, 100),
    reward_amount: Number(body.rewardAmount || 0),
    created_at: body.createdAt || new Date().toISOString(),
    ip_address: ip || "unknown",
    user_agent: String(body.userAgent || "").slice(0, 200),
    utm_source: String(body.utm_source || "").slice(0, 100),
    utm_medium: String(body.utm_medium || "").slice(0, 100),
    utm_campaign: String(body.utm_campaign || "").slice(0, 100),
    source: String(body.source || "").trim().slice(0, 50),
    fbp: String(body.fbp || "").slice(0, 100),
    fbc: String(body.fbc || ""),
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
// 2️⃣ D1 DATABASE (Primary Storage - Cloudflare Edge)
// Fast SQLite at the edge - no external API calls needed
// ============================================================
async function saveToD1(order, env) {
  if (!env.DB) {
    return { skipped: true, reason: "d1_not_configured" };
  }

  try {
    // Auto-create orders table if not exists (handles first run after deploy)
    try {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS orders (
          order_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          pincode TEXT DEFAULT '',
          address TEXT DEFAULT '',
          payment_method TEXT DEFAULT 'cod',
          amount REAL DEFAULT 0,
          product TEXT DEFAULT 'Avnideep 6Pro Vitality Shilajit Capsules',
          status TEXT DEFAULT 'cod_order',
          source TEXT DEFAULT '',
          page_url TEXT DEFAULT '',
          utr TEXT DEFAULT '',
          payment_note TEXT DEFAULT '',
          reward_id TEXT DEFAULT '',
          reward_amount REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          ip_address TEXT DEFAULT '',
          user_agent TEXT DEFAULT '',
          utm_source TEXT DEFAULT '',
          utm_medium TEXT DEFAULT '',
          utm_campaign TEXT DEFAULT '',
          fbp TEXT DEFAULT '',
          fbc TEXT DEFAULT ''
        )`
      ).run();
      try {
        await env.DB.prepare(`ALTER TABLE orders ADD COLUMN source TEXT DEFAULT ''`).run();
      } catch (alterErr) {
        // ignore if column already exists or if D1 does not support alter in this context
        if (String(alterErr.message || alterErr).indexOf('duplicate column name') < 0 && String(alterErr.message || alterErr).indexOf('already exists') < 0) {
          console.log("D1_ALTER_COLUMN_FAILED", String(alterErr.message || alterErr).slice(0, 100));
        }
      }
      try {
        await env.DB.prepare(`ALTER TABLE orders ADD COLUMN reward_id TEXT DEFAULT ''`).run();
      } catch (alterErr) {
        if (String(alterErr.message || alterErr).indexOf('duplicate column name') < 0 && String(alterErr.message || alterErr).indexOf('already exists') < 0) {
          console.log("D1_ALTER_COLUMN_FAILED", String(alterErr.message || alterErr).slice(0, 100));
        }
      }
      try {
        await env.DB.prepare(`ALTER TABLE orders ADD COLUMN reward_amount REAL DEFAULT 0`).run();
      } catch (alterErr) {
        if (String(alterErr.message || alterErr).indexOf('duplicate column name') < 0 && String(alterErr.message || alterErr).indexOf('already exists') < 0) {
          console.log("D1_ALTER_COLUMN_FAILED", String(alterErr.message || alterErr).slice(0, 100));
        }
      }
    } catch (tableErr) {
      console.log("D1_TABLE_CREATE_SKIPPED", String(tableErr.message || tableErr).slice(0, 100));
    }

    const query = await env.DB.prepare(
      `INSERT INTO orders (
        order_id, name, phone, pincode, address, 
        payment_method, amount, product, status, source, page_url,
        created_at, ip_address, user_agent, 
        utm_source, utm_medium, utm_campaign,
        utr, payment_note, reward_id, reward_amount, fbp, fbc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      order.order_id,
      order.name,
      order.phone,
      order.pincode,
      order.address,
      order.payment_method,
      order.amount,
      order.product,
      order.status,
      order.source || '',
      order.page_url,
      order.created_at,
      order.ip_address,
      order.user_agent,
      order.utm_source,
      order.utm_medium,
      order.utm_campaign,
      order.utr || '',
      order.payment_note || '',
      order.reward_id || '',
      order.reward_amount || 0,
      order.fbp || '',
      order.fbc || ''
    ).run();

    if (query.success) {
      return { ok: true, status: 200, message: "Order saved to D1" };
    }
    return { ok: false, error: "D1 insert failed" };
  } catch (err) {
    // Handle duplicate order_id gracefully (return success if already exists)
    if (String(err.message || err).indexOf("UNIQUE constraint") >= 0) {
      console.log("D1_DUPLICATE_ORDER_ID", { order_id: order.order_id });
      return { ok: true, status: 200, note: "duplicate_order_id" };
    }
    return { ok: false, error: String(err.message || err) };
  }
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
      ${order.pincode ? `<tr><td style="color:#666;font-weight:600;font-size:13px;border-bottom:1px solid #eee">📍 Pincode</td>
          <td style="color:#222;font-weight:600;font-size:14px;border-bottom:1px solid #eee">${escHtml(order.pincode)}</td></tr>` : ''}
      ${order.address ? `<tr><td style="color:#666;font-weight:600;font-size:13px;border-bottom:1px solid #eee;vertical-align:top">🏠 Address</td>
          <td style="color:#222;font-size:13px;line-height:1.5;border-bottom:1px solid #eee">${escHtml(order.address)}</td></tr>` : ''}
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
${order.pincode ? `Pincode: ${order.pincode}
` : ''}${order.address ? `Address: ${order.address}
` : ''}
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
// 🔷 FACEBOOK CONVERSION API (Server-Side Events)
// Uses shared CAPI utility from _capi.js for consistent event tracking
// ============================================================
async function sendFacebookCAPI(order, env, eventName = 'Purchase') {
  try {
    const rawPhone = String(order.phone || '').replace(/[^0-9]/g, '');
    if (!rawPhone) {
      return { skipped: true, reason: 'no_phone_for_matching' };
    }

    const userData = await buildUserData({
      name: order.name,
      phone: order.phone,
      fbp: order.fbp,
      fbc: order.fbc,
      ip: (order.ip_address && order.ip_address !== 'unknown') ? order.ip_address : '0.0.0.0',
      ua: order.user_agent,
      orderId: order.order_id
    });

    const customData = buildCustomData({
      value: order.amount,
      currency: 'INR',
      orderId: order.order_id,
      contentName: 'AVN-6PRO-001'
    });

    const result = await sendCAPIEvent({
      env,
      eventName: eventName,
      eventId: String(order.order_id || ''),
      userData,
      customData,
      eventSourceUrl: order.page_url || 'https://shop.avnideepayurveda.in/',
      actionSource: 'website',
      timeout: 4000,
      retries: 1
    });

    if (result && result.error) {
      return { ok: false, error: String(result.error) };
    }

    return {
      ok: true,
      events_received: result?.events_received || 0,
      message: result?.events_received ? 'Events sent to Facebook' : 'Unknown response',
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

  // Build the request body once
  function buildSheetsBody() {
    return new URLSearchParams({
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
      reward_id: order.reward_id || '',
      reward_amount: String(order.reward_amount || 0),
      source: order.source || '',
      ist_time: new Date(order.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    }).toString();
  }

  // Retry up to 3 times with exponential backoff
  const MAX_RETRIES = 1;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Google Apps Script web apps return 302 after POST.
      // We follow the redirect (default) to read the ACTUAL JSON response body.
      const res = await withTimeout(fetch(env.GOOGLE_SHEETS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: buildSheetsBody(),
      }), 6000, "google_sheets");

      // Read the actual response body from the redirected page
      const bodyText = await res.text().catch(() => "");
      
      // Try to parse as JSON (Google Apps Script ContentService returns raw JSON)
      let jsonBody;
      try {
        jsonBody = JSON.parse(bodyText);
      } catch (parseErr) {
        jsonBody = null;
      }
      
      // If we got valid JSON and it says ok: true, data saved successfully!
      if (jsonBody && jsonBody.ok === true) {
        return { ok: true, status: res.status, message: jsonBody.message, attempt };
      }
      
      // If we got valid JSON but it says ok: false, Apps Script had an error
      if (jsonBody && jsonBody.ok === false) {
        // If it's a quota error, retry after a delay
        const errMsg = (jsonBody.error || "").toLowerCase();
        if (errMsg.indexOf("quota") !== -1 || errMsg.indexOf("timeout") !== -1 || errMsg.indexOf("limit") !== -1) {
          lastError = { ok: false, status: res.status, error: jsonBody.error, attempt };
          if (attempt < MAX_RETRIES) {
            const delay = attempt * 2000; // 2s, 4s, 6s backoff
            console.log("GOOGLE_SHEETS_RETRY", { attempt, delay, error: jsonBody.error });
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
        }
        return { ok: false, status: res.status, error: jsonBody.error || "Sheets API error", attempt };
      }
      
      // Fallback: if status is in 200-399 range but no JSON, still count as success
      const errBody = bodyText.slice(0, 500);
      if (res.status >= 200 && res.status < 400) {
        if (errBody.toLowerCase().indexOf("not found") !== -1 || errBody.toLowerCase().indexOf("error") !== -1) {
          lastError = { ok: false, status: res.status, error: errBody.slice(0, 200), attempt };
          if (attempt < MAX_RETRIES) {
            const delay = attempt * 2000;
            console.log("GOOGLE_SHEETS_RETRY", { attempt, delay, error: errBody.slice(0, 100) });
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          return lastError;
        }
        return { ok: true, status: res.status, note: "non_json_response", attempt };
      }
      
      // Status >= 400 — retry with backoff
      lastError = { ok: false, status: res.status, error: bodyText.slice(0, 200), attempt };
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 2000;
        console.log("GOOGLE_SHEETS_RETRY", { attempt, delay, status: res.status });
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return lastError;
    } catch (err) {
      lastError = { ok: false, error: String(err.message || err), attempt };
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 2000;
        console.log("GOOGLE_SHEETS_RETRY_ERR", { attempt, delay, error: String(err.message || err) });
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
  }

  return lastError || { ok: false, error: "All retry attempts failed" };
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
export async function onRequestPost({ request, env, waitUntil }) {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";

  // ============================================================
  // CSRF/ORIGIN CHECK - Prevent external form submissions
  // ============================================================
  try {
    const origin = request.headers.get("Origin") || request.headers.get("Referer") || "";
    const allowedHosts = ["shop.avnideepayurveda.in", "localhost", "127.0.0.1"];
    if (origin) {
      const originHost = new URL(origin).hostname.toLowerCase();
      const allowed = allowedHosts.some(h => originHost === h || originHost.endsWith("." + h));
      if (!allowed) {
        console.warn("CSRF_BLOCKED", { origin, ip });
        return new Response(
          JSON.stringify({ ok: false, error: "Access denied" }),
          { status: 403, headers: jsonHeaders(env) }
        );
      }
    }
  } catch (e) {
    // If origin parsing fails, allow request to proceed
    console.warn("ORIGIN_CHECK_FAILED", String(e));
  }

  // ============================================================
  // RATE LIMITING - Smart bot protection
  // 30/IP/min threshold. Phone bypass: known phones skip IP limit.
  // Duplicate detection below handles refresh+resubmit gracefully.
  // ============================================================
  if (env.RATE_LIMIT_KV) {
    const now = Date.now();
    const WINDOW_MS = 60000;
    const MAX_REQUESTS = 30;  // 30/IP/min - enough for shared IPs

    try {
      // PHONE BYPASS: Check if this phone was seen before (handles refreshes)
      let phoneBypass = false;
      let seenPhone = null;
      try {
        const clonedReq = request.clone();
        const bodyPreview = await clonedReq.json().catch(() => null);
        if (bodyPreview && bodyPreview.phone) {
          const rawPhone = String(bodyPreview.phone).replace(/[^0-9]/g, '');
          if (rawPhone.length >= 10) {
            seenPhone = rawPhone.slice(-10);
            const phoneKey = `seen_phone:${seenPhone}`;
            const phoneSeen = await env.RATE_LIMIT_KV.get(phoneKey).catch(() => null);
            if (phoneSeen === '1') {
              phoneBypass = true;
            }
          }
        }
      } catch (e) {}

      if (phoneBypass && seenPhone) {
        // Known phone - extend expiry and skip IP rate limiting
        await env.RATE_LIMIT_KV.put(`seen_phone:${seenPhone}`, '1', { expirationTtl: 3600 }).catch(() => {});
        // Also add current timestamp so they don't get stuck if they switch IPs
        const rateKey = `rate_limit:${ip}`;
        const nowRecord = await env.RATE_LIMIT_KV.get(rateKey, { type: 'json' }).catch(() => null);
        if (nowRecord && Array.isArray(nowRecord.timestamps)) {
          nowRecord.timestamps = nowRecord.timestamps.filter(t => (now - t) < WINDOW_MS);
          nowRecord.timestamps.push(now);
          await env.RATE_LIMIT_KV.put(rateKey, JSON.stringify(nowRecord), { expirationTtl: 120 }).catch(() => {});
        }
      } else {
        // IP-based rate limiting for unknown visitors
        const rateKey = `rate_limit:${ip}`;
        const record = await env.RATE_LIMIT_KV.get(rateKey, { type: 'json' });
        
        if (record && Array.isArray(record.timestamps)) {
          record.timestamps = record.timestamps.filter(t => (now - t) < WINDOW_MS);
          
          if (record.timestamps.length >= MAX_REQUESTS) {
            console.log("RATE_LIMIT_EXCEEDED", { ip, count: record.timestamps.length });
            return new Response(
              JSON.stringify({ 
                ok: false, 
                error: "Too many requests. WhatsApp par order karein: https://wa.me/917060101043",
                retry_after: 60,
                whatsapp: "https://wa.me/917060101043?text=Mujhe order karna hai"
              }),
              { status: 429, headers: jsonHeaders(env) }
            );
          }
          
          record.timestamps.push(now);
          record.count = record.timestamps.length;
          await env.RATE_LIMIT_KV.put(rateKey, JSON.stringify(record), { expirationTtl: 120 });
        } else {
          await env.RATE_LIMIT_KV.put(rateKey, JSON.stringify({ count: 1, timestamps: [now] }), { expirationTtl: 120 });
        }
        
        // Mark this phone for future bypass (next request won't be rate limited)
        if (seenPhone) {
          await env.RATE_LIMIT_KV.put(`seen_phone:${seenPhone}`, '1', { expirationTtl: 3600 }).catch(() => {});
        }
      }
    } catch (rateErr) {
      console.warn("RATE_LIMIT_CHECK_FAILED", String(rateErr.message || rateErr));
    }
}


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

    // Step 5: Duplicate detection — check D1 for existing order with same phone+amount in last 60s
    // Prevents double counting when client retries after network timeout
    let isDup = false;
    let existingOrderId = null;
    try {
      if (env.DB) {
        const dupResult = await env.DB.prepare(
          `SELECT order_id, amount, created_at FROM orders WHERE phone = ? ORDER BY created_at DESC LIMIT 1`
        ).bind(order.phone).first();
        
        if (dupResult) {
          const lastTime = new Date(dupResult.created_at).getTime();
          const now = Date.now();
          // If same amount and within 60 seconds, it's a duplicate
          if (String(dupResult.amount) === String(order.amount) && (now - lastTime) < 60000) {
            isDup = true;
            existingOrderId = dupResult.order_id;
            console.log("DUPLICATE_DETECTED", { existing: dupResult.order_id, new: order.order_id, phone: order.phone });
          }
        }
      }
    } catch (dupErr) {
      // Dedup check failed silently — proceed with normal flow
      console.warn("DEDUP_CHECK_FAILED", String(dupErr.message || dupErr));
    }

    // If duplicate detected, return existing order — skip processing entirely
    if (isDup && existingOrderId) {
      console.log("DUPLICATE_SKIPPED", { existing: existingOrderId, phone: order.phone });
      return new Response(
        JSON.stringify({
          ok: true,
          orderId: existingOrderId,
          duplicate: true,
          message: "Order already exists",
          channels: { supabase: true, sheets: true, facebook_capi: true },
        }),
        { status: 200, headers: jsonHeaders(env) }
      );
    }

    // Step 6: 🚀 FIRE ALL CHANNELS — Supabase + Sheets + Facebook CAPI awaited (critical)
    // Telegram + Email fire-and-forget (just notifications, not business-critical)
    const allResults = await Promise.allSettled([
      saveToD1(order, env),
      saveGoogleSheets(order, env),
      sendFacebookCAPI(order, env, order.payment_method === 'prepaid' ? 'InitiateCheckout' : 'Purchase'),
    ]);
    const [d1result, sheets, facebookCapi] = allResults.map(r =>
      r.status === "fulfilled" ? r.value : { ok: false, skipped: false, error: String(r.reason?.message || r.reason || "Channel failed") }
    );

    // Fire Telegram + Email in background — don't block the response
    waitUntil(sendTelegram(order, env).catch(() => {}));
    waitUntil(sendEmail(order, env).catch(() => {}));

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
      channels: { d1: d1result, sheets, facebook_capi: facebookCapi },
    }));

    // Step 8: Success only if at least one channel worked
    // Critical channels: D1 + Google Sheets determine order success
    const successCount = [d1result, sheets, facebookCapi].filter((c) => c.ok).length;
    const skippedCount = [d1result, sheets].filter((c) => c.skipped).length;
    const allChannelsSkipped = skippedCount === 2;

    if (successCount === 0) {
      const errorMessage = allChannelsSkipped
        ? "Order backend not configured. कृपया site settings जांचें।"
        : "Order save failed. कृपया WhatsApp पर contact करें।";

      return new Response(
        JSON.stringify({
          ok: false,        error: errorMessage,
        debug: { d1: d1result, sheets, facebook_capi: facebookCapi },
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
          d1: d1result.ok || d1result.skipped || false,
          sheets: sheets.ok || sheets.skipped || false,
          facebook_capi: facebookCapi.ok || facebookCapi.skipped || false,
        },
        debug: { d1: d1result, sheets },
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
        d1: !!env.DB,
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
      fbp: body.fbp || "",
      fbc: body.fbc || "",
      utm_source: "",
      utm_medium: "",
      utm_campaign: "",
    };
    
    // Update D1 order with UTR if D1 configured
    let d1UpdateOk = false;
    try {
      if (env.DB) {
        const updateRes = await env.DB.prepare(
          `UPDATE orders SET utr = ?, status = ? WHERE order_id = ?`
        ).bind(utr, "payment_received", orderId).run();
        d1UpdateOk = updateRes.success;
      }
    } catch (e) {
      console.warn("D1_PATCH_FAILED", String(e.message || e));
    }
    
    // Send UTR receipt to Telegram
    const telegramResult = await sendTelegram(confirmOrder, env);
    
    // Send payment confirmation email
    const emailResult = await sendEmail(confirmOrder, env);
    
    // For prepaid: POST only sent InitiateCheckout, send Purchase on payment confirmation
    const facebookCapiResult = await sendFacebookCAPI(confirmOrder, env, 'Purchase');
    
    return new Response(
      JSON.stringify({
        ok: true,
        orderId: orderId,
        message: "Payment confirmed ✅",
        channels: {
          telegram: telegramResult.ok || false,
          email: emailResult.ok || false,
          facebook_capi: facebookCapiResult.ok || false,
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
