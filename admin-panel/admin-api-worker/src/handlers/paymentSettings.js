// Payment Settings Handler - Razorpay + COD configuration
import { success, error } from "../utils/response.js";

// Get payment settings (public-safe - only returns key_id, not secret/webhook_secret)
export async function handleGetPaymentSettings(request, env) {
  try {
    // Try to get settings from D1
    let settings = null;
    try {
      settings = await env.DB.prepare(
        "SELECT id, provider, enabled, key_id, mode, created_at, updated_at FROM payment_settings WHERE provider = ?"
      ).bind("razorpay").first();
    } catch (dbErr) {
      // Table might not exist yet
      console.log("PAYMENT_SETTINGS_DB_ERR", String(dbErr.message || dbErr));
    }

    if (!settings) {
      // Return defaults
      return success({
        provider: "razorpay",
        enabled: false,
        key_id: "",
        mode: "test",
        connected: false
      });
    }

    // Check if secret is configured in env vars
    const secretConfigured = !!env.RAZORPAY_KEY_SECRET && !!env.RAZORPAY_WEBHOOK_SECRET;
    const keyIdConfigured = !!env.RAZORPAY_KEY_ID || !!settings.key_id;

    return success({
      id: settings.id,
      provider: settings.provider,
      enabled: settings.enabled === 1 || settings.enabled === true,
      key_id: settings.key_id || (env.RAZORPAY_KEY_ID || ""),
      mode: settings.mode || "test",
      connected: secretConfigured && keyIdConfigured,
      updated_at: settings.updated_at
    });
  } catch (err) {
    console.error("Get payment settings error:", err);
    return error("Failed to fetch payment settings", 500);
  }
}

// Public endpoint - returns safe config for frontend checkout
export async function handleGetPublicPaymentConfig(request, env) {
  try {
    let settings = null;
    try {
      settings = await env.DB.prepare(
        "SELECT enabled, key_id, mode FROM payment_settings WHERE provider = ?"
      ).bind("razorpay").first();
    } catch (dbErr) {
      console.log("PUBLIC_PAYMENT_CONFIG_DB_ERR", String(dbErr.message || dbErr));
    }

    const enabled = settings ? (settings.enabled === 1 || settings.enabled === true) : false;
    const keyId = settings?.key_id || env.RAZORPAY_KEY_ID || "";
    const mode = settings?.mode || "test";
    const secretConfigured = !!env.RAZORPAY_KEY_SECRET;

    return success({
      razorpay_enabled: enabled && !!keyId && secretConfigured,
      cod_enabled: true,
      key_id: keyId,
      mode: mode
    });
  } catch (err) {
    console.error("Public payment config error:", err);
    return success({ razorpay_enabled: false, cod_enabled: true, key_id: "", mode: "test" });
  }
}

// Update payment settings (admin only)
export async function handleUpdatePaymentSettings(request, env) {
  try {
    const body = await request.json();
    const { enabled, key_id, mode } = body;

    // Validate
    if (enabled !== undefined && typeof enabled !== "boolean") {
      return error("enabled must be a boolean");
    }
    if (key_id !== undefined && typeof key_id !== "string") {
      return error("key_id must be a string");
    }
    if (mode !== undefined && !["test", "live"].includes(mode)) {
      return error("mode must be 'test' or 'live'");
    }

    const now = new Date().toISOString();

    // Upsert into D1
    try {
      // Check if row exists
      const existing = await env.DB.prepare(
        "SELECT id FROM payment_settings WHERE provider = ?"
      ).bind("razorpay").first();

      if (existing) {
        // Update
        const updates = [];
        const params = [];
        
        if (enabled !== undefined) { updates.push("enabled = ?"); params.push(enabled ? 1 : 0); }
        if (key_id !== undefined) { updates.push("key_id = ?"); params.push(key_id); }
        if (mode !== undefined) { updates.push("mode = ?"); params.push(mode); }
        updates.push("updated_at = ?");
        params.push(now);
        params.push("razorpay");

        await env.DB.prepare(
          `UPDATE payment_settings SET ${updates.join(", ")} WHERE provider = ?`
        ).bind(...params).run();
      } else {
        // Insert
        await env.DB.prepare(
          "INSERT INTO payment_settings (provider, enabled, key_id, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(
          "razorpay",
          enabled !== undefined ? (enabled ? 1 : 0) : 0,
          key_id || "",
          mode || "test",
          now,
          now
        ).run();
      }
    } catch (dbErr) {
      console.error("PAYMENT_SETTINGS_SAVE_ERR", String(dbErr.message || dbErr));
      return error("Failed to save payment settings to database", 500);
    }

    // Also update env.RAZORPAY_KEY_ID if provided (for current worker instance)
    // Note: Permanent env vars must be set via wrangler secrets

    return success({
      saved: true,
      message: "Payment settings updated successfully. Note: RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET must be set via wrangler secrets."
    });
  } catch (err) {
    console.error("Update payment settings error:", err);
    return error("Failed to update payment settings", 500);
  }
}

// Connection test - verify Razorpay credentials work
export async function handleTestRazorpayConnection(request, env) {
  try {
    const keyId = env.RAZORPAY_KEY_ID;
    const keySecret = env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return success({
        connected: false,
        message: "Razorpay credentials not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET as Worker secrets."
      });
    }

    // Test by fetching balance (or simply create a test API call)
    const credentials = btoa(keyId + ":" + keySecret);
    const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
      headers: {
        "Authorization": "Basic " + credentials,
        "Content-Type": "application/json"
      }
    });

    if (res.ok) {
      return success({
        connected: true,
        message: "Razorpay credentials verified successfully."
      });
    }

    const errText = await res.text().catch(() => "");
    return success({
      connected: false,
      message: "Connection failed: " + (errText.slice(0, 200) || "HTTP " + res.status)
    });
  } catch (err) {
    console.error("Test connection error:", err);
    return success({
      connected: false,
      message: "Connection test error: " + String(err.message || err)
    });
  }
}
