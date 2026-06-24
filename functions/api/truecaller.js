// ============================================================
// Truecaller Callback Handler - Deep Link verification
// ============================================================
// This endpoint handles callbacks from Truecaller after user
// verifies via deep link. Truecaller sends a server-side POST
// with verification data.
//
// Configure this URL in Truecaller Developer Dashboard:
// https://shop.avnideepayurveda.in/api/truecaller
// ============================================================

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Handle OPTIONS (CORS preflight)
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// Handle GET - health check & verification status page
export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // If Truecaller redirected back with params, forward to main page
  const tcStatus = url.searchParams.get("tc_status");
  const tcPhone = url.searchParams.get("tc_phone");
  const tcName = url.searchParams.get("tc_name");

  if (tcStatus) {
    // Redirect back to homepage with verification params
    const redirectUrl = new URL("/", url.origin);
    redirectUrl.searchParams.set("tc_status", tcStatus);
    if (tcPhone) redirectUrl.searchParams.set("tc_phone", tcPhone);
    if (tcName) redirectUrl.searchParams.set("tc_name", tcName);
    
    return Response.redirect(redirectUrl.toString(), 302);
  }

  // Health check / docs
  return new Response(
    JSON.stringify({
      ok: true,
      message: "Truecaller callback endpoint active",
      info: "Configure this URL as your callback in Truecaller Developer Dashboard",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    }
  );
}

// Handle POST - receive verification data from Truecaller server
export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const data = await request.json();
    const { requestNonce, accessToken, status, phone, name } = data;

    console.log("Truecaller callback received:", { status, phone, name });

    // If we got phone and name directly, save the lead
    if (status === "verified" || (phone && phone.length >= 10)) {
      const cleanPhone = phone.replace(/\D/g, "").slice(-10);
      const userName = name || "";

      // Save to D1 database if available
      if (env.DB) {
        try {
          // Ensure leads table exists
          await env.DB.exec(
            "CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT UNIQUE, source TEXT DEFAULT 'truecaller', created_at TEXT DEFAULT (datetime('now')))"
          );
          
          // Insert or update
          await env.DB.prepare(
            "INSERT INTO leads (name, phone, source) VALUES (?, ?, 'truecaller') ON CONFLICT(phone) DO UPDATE SET name = ?"
          ).bind(userName, cleanPhone, userName).run();
        } catch (dbErr) {
          console.error("DB error:", dbErr);
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          status: "received",
          phone: cleanPhone,
          name: userName,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // If we only got accessToken, log it (would need to exchange via Truecaller API)
    // Note: Full token exchange requires TRUECALLER_APP_SECRET env var
    if (accessToken) {
      console.log("Access token received:", accessToken);
      return new Response(
        JSON.stringify({
          ok: true,
          status: "token_received",
          message: "Token received. Configure TRUECALLER_APP_SECRET for auto-verification.",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: "Invalid data" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (err) {
    console.error("Truecaller callback error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
}
