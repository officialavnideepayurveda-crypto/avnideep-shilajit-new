// Razorpay Webhook Handler - Cloudflare Edge
// Handles: payment.captured, payment.failed, order.paid, refund.processed
// Signature verification using HMAC SHA256
// Location: /api/razorpay-webhook

import {
  paymentKind,
  toPaise,
  fromPaise,
  verifiedPaymentState,
  DEFAULT_ADVANCE_AMOUNT,
} from "./_lib/pricing";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Razorpay-Signature"
};

// ============================================================
// HELPERS
// ============================================================
function getIST(isoString) {
  try {
    return new Date(isoString).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true
    });
  } catch { return isoString; }
}

async function verifyWebhookSignature(body, signature, webhookSecret) {
  if (!signature || !webhookSecret) return false;
  
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(webhookSecret);
    const messageData = typeof body === "string" ? encoder.encode(body) : body;
    
    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData,
      { name: "HMAC", hash: "SHA-256" },
      false, ["sign"]
    );
    
    const expectedSig = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const expectedHex = Array.from(new Uint8Array(expectedSig))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    
    // Constant-time comparison
    if (expectedHex.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expectedHex.length; i++) {
      diff |= expectedHex.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  } catch (err) {
    console.error("WEBHOOK_SIG_VERIFY_ERR", String(err.message || err));
    return false;
  }
}

async function sendTelegramNotification(event, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  
  const payment = event.payload?.payment || event.payload?.order || {};
  const amount = (payment.amount || 0) / 100;
  const orderId = payment.order_id || payment.id || "unknown";
  const paymentId = payment.id || payment.payment?.id || "unknown";
  const status = event.event;
  
  const emoji = status.includes("captured") || status.includes("paid") ? "✅" : "❌";
  const text = [
    `${emoji} *RAZORPAY ${status.toUpperCase()}*`,
    `━━━━━━━━━━━━━━━━━━`,
    `🆔 Order: \`${orderId}\``,
    `💳 Payment: \`${paymentId}\``,
    `💰 Amount: *₹${amount}*`,
    `🕒 Time: ${getIST(event.created_at)}`,
  ].join("\n");
  
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      })
    });
  } catch {}
}

// ============================================================
// WEBHOOK HANDLER
// ============================================================
export async function onRequestPost({ request, env, waitUntil }) {
  try {
    // Read raw body text
    const rawBody = await request.text();
    const signature = request.headers.get("X-Razorpay-Signature") || "";
    
    // Get webhook secret from env
    const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;

    // Fail CLOSED: never accept an unverified webhook. Without this, an unset
    // secret let anyone POST forged payment.captured / refund.processed events.
    if (!webhookSecret) {
      console.error("WEBHOOK_SECRET_NOT_CONFIGURED");
      return new Response(
        JSON.stringify({ ok: false, error: "Webhook secret not configured" }),
        { status: 500, headers: jsonHeaders }
      );
    }
    const isValid = await verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      console.error("WEBHOOK_INVALID_SIGNATURE");
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid signature" }),
        { status: 401, headers: jsonHeaders }
      );
    }
    
    // Parse event
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid JSON body" }),
        { status: 400, headers: jsonHeaders }
      );
    }
    
    const eventName = event.event;
    const payload = event.payload || {};
    const payment = payload.payment || {};
    const order_payload = payload.order || {};
    
    console.log("WEBHOOK_RECEIVED", { event: eventName, order_id: payment.order_id, payment_id: payment.id });
    
    // Telegram notification - kept alive via waitUntil so it isn't cancelled
    // when the response returns.
    const telegramPromise = sendTelegramNotification(event, env).catch(() => {});
    if (typeof waitUntil === "function") waitUntil(telegramPromise);
    
    switch (eventName) {
      case "payment.captured":
        // Payment captured by the gateway. Distinguish a full prepaid payment
        // from a booking advance: the stored order decides, never the event.
        if (env.DB && payment.order_id) {
          try {
            const row = await env.DB.prepare(
              "SELECT * FROM orders WHERE razorpay_order_id = ? OR razorpay_payment_id = ?"
            ).bind(payment.order_id || "", payment.id || "").first();
            if (!row) {
              // Order row not found yet - ask Razorpay to retry
              return new Response(
                JSON.stringify({ ok: false, error: "Order not found yet", retry: true }),
                { status: 503, headers: jsonHeaders }
              );
            }

            const method = paymentKind(row.payment_method);
            if (method === "cod") {
              console.warn("WEBHOOK_CAPTURED_FOR_COD", { order: row.order_id });
              return new Response(
                JSON.stringify({ ok: true, event: eventName, processed: false, note: "COD order has no online capture" }),
                { status: 200, headers: jsonHeaders }
              );
            }
            const totalPaise = Number(row.amount_paise) > 0 ? Number(row.amount_paise) : toPaise(row.amount);
            const duePaise = Number(row.online_due_paise) > 0
              ? Number(row.online_due_paise)
              : (method === "prepaid" ? totalPaise : toPaise(row.advance_amount || DEFAULT_ADVANCE_AMOUNT));
            const expected = method === "prepaid" ? totalPaise : Math.min(duePaise, totalPaise);
            // Reject a captured amount that cannot be this order's online due
            // (e.g. a ₹1 Razorpay order replayed against a prepaid order).
            if (payment.amount != null && Number(payment.amount) !== expected) {
              console.error("WEBHOOK_AMOUNT_MISMATCH", { order: row.order_id, captured: payment.amount, expected });
              return new Response(
                JSON.stringify({ ok: false, error: "Captured amount does not match the order" }),
                { status: 409, headers: jsonHeaders }
              );
            }
            const state = verifiedPaymentState(method, fromPaise(totalPaise), fromPaise(expected));
            const updRes = await env.DB.prepare(
              `UPDATE orders SET
                payment_status = ?,
                payment_captured = ?,
                razorpay_payment_id = ?,
                razorpay_order_id = ?,
                webhook_verified = 1,
                status = ?,
                amount_paise = ?,
                online_due_paise = ?,
                online_due_amount = ?,
                online_paid_paise = ?,
                online_paid_amount = ?,
                advance_amount = ?,
                cod_due_paise = ?,
                cod_due = ?,
                updated_at = ?
              WHERE order_id = ? AND (razorpay_payment_id IS NULL OR razorpay_payment_id = '' OR razorpay_payment_id = ?)`
            ).bind(
              state.paymentStatus,
              method === "prepaid" ? 1 : 0,
              payment.id || "",
              payment.order_id || "",
              state.orderStatus,
              totalPaise,
              expected,
              fromPaise(expected),
              state.onlinePaidPaise,
              fromPaise(state.onlinePaidPaise),
              fromPaise(state.onlinePaidPaise),
              state.codDuePaise,
              fromPaise(state.codDuePaise),
              new Date().toISOString(),
              row.order_id,
              payment.id || ""
            ).run();
            const changes = (updRes && updRes.meta && updRes.meta.changes) || 0;
            if (changes === 0) {
              return new Response(
                JSON.stringify({ ok: true, event: eventName, processed: false, note: "Already recorded" }),
                { status: 200, headers: jsonHeaders }
              );
            }
          } catch (dbErr) {
            console.error("WEBHOOK_DB_UPDATE_FAILED", String(dbErr.message || dbErr));
            return new Response(
              JSON.stringify({ ok: false, error: "DB update failed" }),
              { status: 503, headers: jsonHeaders }
            );
          }
        }
        return new Response(
          JSON.stringify({ ok: true, event: eventName, processed: true }),
          { status: 200, headers: jsonHeaders }
        );
        
      case "payment.failed":
        // Payment failed - update order
        if (env.DB && payment.order_id) {
          try {
            await env.DB.prepare(
              `UPDATE orders SET 
                payment_status = 'failed',
                payment_captured = 0,
                status = CASE WHEN payment_status IN ('paid','partially_paid') THEN status ELSE 'payment_failed' END,
                webhook_verified = 1,
                updated_at = ?
              WHERE razorpay_order_id = ?
                AND payment_status NOT IN ('paid','partially_paid')`
            ).bind(
              new Date().toISOString(),
              payment.order_id
            ).run();
          } catch (dbErr) {
            console.error("WEBHOOK_DB_UPDATE_FAILED", String(dbErr.message || dbErr));
          }
        }
        return new Response(
          JSON.stringify({ ok: true, event: eventName, processed: true }),
          { status: 200, headers: jsonHeaders }
        );
        
      case "order.paid":
        // Order fully paid - update status
        if (env.DB && order_payload.id) {
          try {
            await env.DB.prepare(
              `UPDATE orders SET 
                payment_status = CASE WHEN payment_method = 'prepaid' THEN 'paid' ELSE 'partially_paid' END,
                payment_captured = CASE WHEN payment_method = 'prepaid' THEN 1 ELSE 0 END,
                status = CASE WHEN payment_method = 'prepaid' THEN 'paid' ELSE 'advance_paid' END,
                advance_amount = CASE WHEN payment_method = 'prepaid' THEN amount ELSE online_due_amount END,
                online_paid_amount = CASE WHEN payment_method = 'prepaid' THEN amount ELSE online_due_amount END,
                online_paid_paise = online_due_paise,
                cod_due = CASE WHEN payment_method = 'prepaid' THEN 0 ELSE amount - online_due_amount END,
                cod_due_paise = CASE WHEN payment_method = 'prepaid' THEN 0 ELSE amount_paise - online_due_paise END,
                webhook_verified = 1,
                updated_at = ?
              WHERE razorpay_order_id = ?`
            ).bind(
              new Date().toISOString(),
              order_payload.id
            ).run();
          } catch (dbErr) {
            console.error("WEBHOOK_DB_UPDATE_FAILED", String(dbErr.message || dbErr));
          }
        }
        return new Response(
          JSON.stringify({ ok: true, event: eventName, processed: true }),
          { status: 200, headers: jsonHeaders }
        );
        
      case "refund.processed":
        // Refund processed - update order
        if (env.DB && payment.order_id) {
          try {
            await env.DB.prepare(
              `UPDATE orders SET 
                refund_status = 'processed',
                status = 'refunded',
                webhook_verified = 1,
                updated_at = ?
              WHERE razorpay_order_id = ?`
            ).bind(
              new Date().toISOString(),
              payment.order_id
            ).run();
          } catch (dbErr) {
            console.error("WEBHOOK_DB_UPDATE_FAILED", String(dbErr.message || dbErr));
          }
        }
        return new Response(
          JSON.stringify({ ok: true, event: eventName, processed: true }),
          { status: 200, headers: jsonHeaders }
        );
        
      default:
        // Unknown event - acknowledge but don't process
        console.log("WEBHOOK_UNKNOWN_EVENT", eventName);
        return new Response(
          JSON.stringify({ ok: true, event: eventName, processed: false, note: "Unknown event type" }),
          { status: 200, headers: jsonHeaders }
        );
    }
  } catch (err) {
    console.error("WEBHOOK_ERROR", err);
    return new Response(
      JSON.stringify({ ok: false, error: "Webhook processing failed" }),
      { status: 500, headers: jsonHeaders }
    );
  }
}

// CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: jsonHeaders });
}
