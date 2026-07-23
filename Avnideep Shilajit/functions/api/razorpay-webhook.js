// Razorpay Webhook Handler - Cloudflare Edge
// Handles: payment.captured, payment.failed, order.paid, refund.processed
// Signature verification using HMAC SHA256
// Location: /api/razorpay-webhook

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
export async function onRequestPost({ request, env, context }) {
  try {
    // Read raw body text
    const rawBody = await request.text();
    const signature = request.headers.get("X-Razorpay-Signature") || "";
    
    // Get webhook secret from env
    const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
    
    if (webhookSecret) {
      // Verify webhook signature
      const isValid = await verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        console.error("WEBHOOK_INVALID_SIGNATURE");
        return new Response(
          JSON.stringify({ ok: false, error: "Invalid signature" }),
          { status: 401, headers: jsonHeaders }
        );
      }
    } else {
      console.warn("WEBHOOK_SECRET_NOT_CONFIGURED - skipping signature verification");
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
    
    // Fire-and-forget Telegram notification
    sendTelegramNotification(event, env).catch(() => {});
    
    switch (eventName) {
      case "payment.captured":
        // Payment successfully captured - update order in D1
        if (env.DB && payment.order_id) {
          try {
            await env.DB.prepare(
              `UPDATE orders SET 
                payment_status = 'paid',
                payment_captured = 1,
                razorpay_payment_id = ?,
                razorpay_order_id = ?,
                webhook_verified = 1,
                status = CASE WHEN status = 'pending' THEN 'paid' ELSE status END,
                updated_at = ?
              WHERE razorpay_order_id = ?`
            ).bind(
              payment.id || "",
              payment.order_id || "",
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
        
      case "payment.failed":
        // Payment failed - update order
        if (env.DB && payment.order_id) {
          try {
            await env.DB.prepare(
              `UPDATE orders SET 
                payment_status = 'failed',
                payment_captured = 0,
                status = 'payment_failed',
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
        
      case "order.paid":
        // Order fully paid - update status
        if (env.DB && order_payload.id) {
          try {
            await env.DB.prepare(
              `UPDATE orders SET 
                payment_status = 'paid',
                payment_captured = 1,
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
