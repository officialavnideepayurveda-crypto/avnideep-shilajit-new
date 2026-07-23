var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/utils/jwt.js
function base64UrlEncode(str) {
  const uint8 = new TextEncoder().encode(str);
  const base64 = btoa(String.fromCharCode(...uint8));
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
__name(base64UrlEncode, "base64UrlEncode");
function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binaryStr = atob(str);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
__name(base64UrlDecode, "base64UrlDecode");
async function hmacSha256(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const sigStr = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return sigStr.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
__name(hmacSha256, "hmacSha256");
async function signJWT(payload, secret, expiresIn = "24h") {
  const header = { alg: "HS256", typ: "JWT" };
  let exp = Math.floor(Date.now() / 1e3);
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (match) {
    const num = parseInt(match[1]);
    const unit = match[2];
    const mult = { s: 1, m: 60, h: 3600, d: 86400 };
    exp += num * (mult[unit] || 3600);
  } else {
    exp += 86400;
  }
  const now = Math.floor(Date.now() / 1e3);
  const tokenPayload = { ...payload, iat: now, exp };
  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(tokenPayload));
  const signature = await hmacSha256(secret, headerEncoded + "." + payloadEncoded);
  return headerEncoded + "." + payloadEncoded + "." + signature;
}
__name(signJWT, "signJWT");
async function verifyJWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerEncoded, payloadEncoded, signature] = parts;
    const expectedSig = await hmacSha256(secret, headerEncoded + "." + payloadEncoded);
    if (signature !== expectedSig) return null;
    const payloadStr = base64UrlDecode(payloadEncoded);
    const payload = JSON.parse(payloadStr);
    const now = Math.floor(Date.now() / 1e3);
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch (err) {
    console.error("JWT verify error:", err);
    return null;
  }
}
__name(verifyJWT, "verifyJWT");

// src/utils/response.js
function corsHeaders(env, requestOrigin) {
  const allowedOrigins = [
    "https://admin.avnideepayurveda.in",
    env.ALLOWED_ORIGIN
  ].filter(Boolean);
  let origin = "https://admin.avnideepayurveda.in";
  if (requestOrigin) {
    const match = allowedOrigins.find((o) => o === requestOrigin);
    if (match) origin = match;
    else if (requestOrigin.match(/^https:\/\/.*\.(pages|workers)\.dev$/)) origin = requestOrigin;
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function getHeaders(extraHeaders) {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    ...extraHeaders || {}
  };
}
__name(getHeaders, "getHeaders");
function success(data, status = 200, cors = null) {
  const resp = new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: getHeaders(cors || {})
  });
  return resp;
}
__name(success, "success");
function successPaginated(data, pagination, status = 200, cors = null) {
  const resp = new Response(JSON.stringify({ ok: true, data, pagination }), {
    status,
    headers: getHeaders(cors || {})
  });
  return resp;
}
__name(successPaginated, "successPaginated");
function error(message, status = 400, cors = null) {
  const resp = new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: getHeaders(cors || {})
  });
  return resp;
}
__name(error, "error");
function textResponse(data, contentType, filename, cors = null) {
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": 'attachment; filename="' + filename + '"',
      "Cache-Control": "no-store",
      ...cors || {}
    }
  });
}
__name(textResponse, "textResponse");
function addCorsToResponse(response, corsHeaders2) {
  if (corsHeaders2) {
    Object.entries(corsHeaders2).forEach(([key, val]) => {
      response.headers.set(key, val);
    });
  }
  return response;
}
__name(addCorsToResponse, "addCorsToResponse");

// src/handlers/auth.js
async function sha256Hex(data) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(data));
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex;
}
__name(sha256Hex, "sha256Hex");
async function authenticate(request, env) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    return await verifyJWT(token, env.JWT_SECRET);
  } catch (err) {
    console.error("Auth error:", err);
    return null;
  }
}
__name(authenticate, "authenticate");
async function handleLogin(request, env) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return error("Email and password are required");
    }
    const allowedIdentities = [
      env.ADMIN_EMAIL,
      "AvnideepAyurveda"
    ].filter(Boolean);
    if (!allowedIdentities.includes(email)) {
      return error("Invalid credentials", 401);
    }
    const storedCreds = env.ADMIN_PASSWORD_HASH;
    if (!storedCreds) {
      return error("Server configuration error", 500);
    }
    const parts = storedCreds.split(":");
    if (parts.length !== 2) {
      return error("Server configuration error", 500);
    }
    const salt = parts[0];
    const storedHash = parts[1];
    const inputHash = await sha256Hex(salt + password);
    let match = true;
    if (inputHash.length !== storedHash.length) match = false;
    for (let i = 0; i < Math.max(inputHash.length, storedHash.length); i++) {
      if (inputHash[i] !== (storedHash[i] || "")) match = false;
    }
    if (!match) {
      return error("Invalid credentials", 401);
    }
    const token = await signJWT(
      { email, role: "admin" },
      env.JWT_SECRET,
      "24h"
    );
    return success({
      token,
      email: env.ADMIN_EMAIL,
      expiresIn: "24h"
    });
  } catch (err) {
    console.error("Login error:", err);
    return error("Login failed", 500);
  }
}
__name(handleLogin, "handleLogin");

// src/utils/db.js
function buildPagination(url) {
  const page = parseInt(url.searchParams.get("page")) || 1;
  const limit = Math.min(parseInt(url.searchParams.get("limit")) || 20, 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
__name(buildPagination, "buildPagination");
function buildOrderFilters(url) {
  const filters = [];
  const params = [];
  const search = url.searchParams.get("search");
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const landingPage = url.searchParams.get("landing_page");
  if (status && status !== "all") {
    filters.push("status = ?");
    params.push(status);
  }
  if (from) {
    filters.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    filters.push("created_at <= ?");
    params.push(to + "T23:59:59Z");
  }
  if (landingPage) {
    filters.push("landing_page = ?");
    params.push(landingPage);
  }
  if (search && search.trim()) {
    const term = "%" + search.trim() + "%";
    filters.push("(name LIKE ? OR phone LIKE ? OR order_id LIKE ? OR city LIKE ?)");
    params.push(term, term, term, term);
  }
  return { filters, params };
}
__name(buildOrderFilters, "buildOrderFilters");
function buildWhereClause(filters) {
  if (filters.length === 0) return "";
  return " WHERE " + filters.join(" AND ");
}
__name(buildWhereClause, "buildWhereClause");
async function getTotalCount(db, filters, params) {
  const whereClause = buildWhereClause(filters);
  const result = await db.prepare("SELECT COUNT(*) as total FROM orders" + whereClause).bind(...params).first();
  return result ? result.total : 0;
}
__name(getTotalCount, "getTotalCount");

// src/handlers/orders.js
async function handleListOrders(request, env, url) {
  try {
    const { page, limit, offset } = buildPagination(url);
    const { filters, params } = buildOrderFilters(url);
    const whereClause = buildWhereClause(filters);
    const total = await getTotalCount(env.DB, filters, params);
    const query = "SELECT * FROM orders" + whereClause + " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const resultParams = [...params, limit, offset];
    const { results } = await env.DB.prepare(query).bind(...resultParams).all();
    return successPaginated(results || [], {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error("List orders error:", err);
    return error("Failed to fetch orders", 500);
  }
}
__name(handleListOrders, "handleListOrders");
async function handleOrderDetail(request, env, orderId) {
  try {
    const order = await env.DB.prepare(
      "SELECT * FROM orders WHERE order_id = ?"
    ).bind(orderId).first();
    if (!order) {
      return error("Order not found", 404);
    }
    return success(order);
  } catch (err) {
    console.error("Order detail error:", err);
    return error("Failed to fetch order", 500);
  }
}
__name(handleOrderDetail, "handleOrderDetail");
async function handleUpdateStatus(request, env, orderId) {
  try {
    const body = await request.json();
    const { status } = body;
    if (!status) {
      return error("Status is required");
    }
    const validStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled", "refunded"];
    if (!validStatuses.includes(status)) {
      return error("Invalid status. Must be one of: " + validStatuses.join(", "));
    }
    const existing = await env.DB.prepare(
      "SELECT order_id FROM orders WHERE order_id = ?"
    ).bind(orderId).first();
    if (!existing) {
      return error("Order not found", 404);
    }
    await env.DB.prepare(
      "UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ?"
    ).bind(status, (/* @__PURE__ */ new Date()).toISOString(), orderId).run();
    return success({ orderId, status, updated: true });
  } catch (err) {
    console.error("Update status error:", err);
    return error("Failed to update order status", 500);
  }
}
__name(handleUpdateStatus, "handleUpdateStatus");
async function handleExportOrders(request, env, url) {
  try {
    const { filters, params } = buildOrderFilters(url);
    const whereClause = buildWhereClause(filters);
    const format = url.searchParams.get("format") || "csv";
    const query = "SELECT * FROM orders" + whereClause + " ORDER BY created_at DESC";
    const { results } = await env.DB.prepare(query).bind(...params).all();
    if (!results || results.length === 0) {
      return error("No orders found to export", 404);
    }
    if (format === "csv") {
      const headers = Object.keys(results[0]);
      let csv = headers.join(",") + "\n";
      for (const row of results) {
        const values = headers.map((h) => {
          const val = row[h];
          if (val === null || val === void 0) return "";
          const str = String(val);
          if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        });
        csv += values.join(",") + "\n";
      }
      const filename = "orders_export_" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".csv";
      return textResponse(csv, "text/csv; charset=utf-8", filename);
    }
    if (format === "excel") {
      const headers = Object.keys(results[0]);
      let tsv = headers.join("	") + "\n";
      for (const row of results) {
        const values = headers.map((h) => {
          const val = row[h];
          return val === null || val === void 0 ? "" : String(val);
        });
        tsv += values.join("	") + "\n";
      }
      const filename = "orders_export_" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".xls";
      return textResponse(tsv, "application/vnd.ms-excel; charset=utf-8", filename);
    }
    return error("Unsupported format. Use 'csv' or 'excel'", 400);
  } catch (err) {
    console.error("Export error:", err);
    return error("Failed to export orders", 500);
  }
}
__name(handleExportOrders, "handleExportOrders");

// src/handlers/dashboard.js
async function handleDashboard(request, env, url) {
  try {
    const period = url.searchParams.get("period") || "all";
    let dateFilter = "";
    let dateParam = null;
    const now = /* @__PURE__ */ new Date();
    if (period === "today") {
      const today2 = now.toISOString().slice(0, 10);
      dateFilter = " WHERE created_at >= ?";
      dateParam = today2;
    } else if (period === "week") {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      dateFilter = " WHERE created_at >= ?";
      dateParam = weekAgo.toISOString();
    } else if (period === "month") {
      const monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      dateFilter = " WHERE created_at >= ?";
      dateParam = monthAgo.toISOString();
    }
    const queries = [];
    if (dateParam) {
      queries.push(env.DB.prepare("SELECT COUNT(*) as total FROM orders" + dateFilter).bind(dateParam).first());
    } else {
      queries.push(env.DB.prepare("SELECT COUNT(*) as total FROM orders").first());
    }
    if (dateParam) {
      queries.push(
        env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as revenue FROM orders WHERE payment_method = 'prepaid' AND status IN ('confirmed','delivered','shipped') AND created_at >= ?").bind(dateParam).first()
      );
    } else {
      queries.push(
        env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as revenue FROM orders WHERE payment_method = 'prepaid' AND status IN ('confirmed','delivered','shipped')").first()
      );
    }
    let statusQuery = "SELECT status, COUNT(*) as count FROM orders";
    let statusParams = [];
    if (dateParam) {
      statusQuery += " WHERE created_at >= ?";
      statusParams.push(dateParam);
    }
    statusQuery += " GROUP BY status";
    queries.push(
      env.DB.prepare(statusQuery).bind(...statusParams).all()
    );
    if (dateParam) {
      queries.push(env.DB.prepare("SELECT COUNT(*) as total FROM orders" + dateFilter).bind(dateParam).first());
    } else {
      queries.push(env.DB.prepare("SELECT COUNT(*) as total FROM orders").first());
    }
    const today = now.toISOString().slice(0, 10);
    queries.push(
      env.DB.prepare("SELECT COUNT(*) as count FROM orders WHERE created_at >= ?").bind(today).first()
    );
    const results = await Promise.all(queries);
    const totalOrders = results[0]?.total || 0;
    const totalRevenue = results[1]?.revenue || 0;
    const statusCounts = {};
    const statusRows = results[2]?.results || [];
    for (const row of statusRows) {
      statusCounts[row.status] = row.count;
    }
    const statuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
    for (const s of statuses) {
      if (!statusCounts[s]) statusCounts[s] = 0;
    }
    const todayOrders = results[4]?.count || 0;
    return success({
      period,
      totalOrders,
      totalRevenue,
      todayOrders,
      statusCounts,
      pendingOrders: statusCounts.pending || 0
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    return error("Failed to fetch dashboard data", 500);
  }
}
__name(handleDashboard, "handleDashboard");

// src/index.js
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;
    const requestOrigin = request.headers.get("Origin");
    const cors = corsHeaders(env, requestOrigin);
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }
    try {
      if (path === "/api/admin/health" || path === "/") {
        return addCorsToResponse(success({ status: "ok", service: "avnideep-admin-api", version: "1.0.0" }), cors);
      }
      if (path === "/api/admin/auth/login" && method === "POST") {
        return addCorsToResponse(await handleLogin(request, env), cors);
      }
      if (path === "/api/admin/auth/verify" && method === "GET") {
        const payload = await authenticate(request, env);
        if (!payload) return addCorsToResponse(error("Unauthorized", 401), cors);
        return addCorsToResponse(success({ valid: true, email: payload.email }), cors);
      }
      const authPayload = await authenticate(request, env);
      if (!authPayload) {
        return addCorsToResponse(error("Unauthorized - Invalid or expired token", 401), cors);
      }
      if (path === "/api/admin/dashboard" && method === "GET") {
        return addCorsToResponse(await handleDashboard(request, env, url), cors);
      }
      if (path === "/api/admin/orders/export" && method === "GET") {
        return addCorsToResponse(await handleExportOrders(request, env, url), cors);
      }
      if (path === "/api/admin/orders" && method === "GET") {
        return addCorsToResponse(await handleListOrders(request, env, url), cors);
      }
      const orderMatch = path.match(/^\/api\/admin\/orders\/([^\/]+)$/);
      if (orderMatch) {
        const orderId = orderMatch[1];
        if (method === "GET") {
          return addCorsToResponse(await handleOrderDetail(request, env, orderId), cors);
        }
      }
      const statusMatch = path.match(/^\/api\/admin\/orders\/([^\/]+)\/status$/);
      if (statusMatch && method === "PATCH") {
        const orderId = statusMatch[1];
        return addCorsToResponse(await handleUpdateStatus(request, env, orderId), cors);
      }
      return addCorsToResponse(error("Route not found", 404), cors);
    } catch (err) {
      console.error("Admin API Error:", err);
      return addCorsToResponse(error("Internal server error", 500), cors);
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
