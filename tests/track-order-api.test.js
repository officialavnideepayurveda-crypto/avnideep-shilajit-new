import { describe, it, expect } from "vitest";
import { onRequestPost } from "../functions/api/track-order.js";

/**
 * Minimal D1 stub. Every prepare() call records the SQL + bound params so the
 * tests can assert what the handler actually queried.
 */
function makeEnv({ enabled = "1", orders = [], events = [], noShipmentTable = false } = {}) {
  const calls = [];
  const DB = {
    prepare(sql) {
      const call = { sql, params: [] };
      calls.push(call);
      const run = () => {
        if (noShipmentTable && sql.includes("LEFT JOIN ekart_shipments")) {
          return { first: async () => { throw new Error("no such table: ekart_shipments"); }, all: async () => { throw new Error("no such table: ekart_shipments"); } };
        }
        if (sql.includes("FROM settings")) return { first: async () => ({ value: enabled }), all: async () => ({ results: [] }) };
        if (sql.includes("FROM orders o")) return { first: async () => orders[0] || null, all: async () => ({ results: orders }) };
        if (sql.includes("FROM ekart_shipment_events")) return { first: async () => null, all: async () => ({ results: events }) };
        if (sql.includes("FROM ekart_shipments")) return { first: async () => null, all: async () => ({ results: [] }) };
        return { first: async () => null, all: async () => ({ results: [] }) };
      };
      return {
        bind(...params) {
          call.params = params;
          return run();
        },
        ...run(),
      };
    },
  };
  return { env: { DB }, calls };
}

function request(body) {
  return new Request("https://avnideepayurveda.in/api/track-order", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify(body),
  });
}

const baseOrder = {
  order_id: "AVN-10001",
  phone: "+91 98765 43210",
  status: "cod_order",
  created_at: "2026-10-20T10:00:00.000Z",
  payment_method: "cod",
  product: "6Pro Shilajit Capsules",
  amount: 2000,
  shipment_id: 7,
  awb: "AWB123456",
  shipment_status: "in_transit",
  latest_status: "in_transit",
  latest_event: "Picked up",
  expected_delivery_date: "2026-10-25T00:00:00.000Z",
  booked_at: "2026-10-21T10:00:00.000Z",
  last_tracked_at: new Date().toISOString(),
  shipment_updated_at: "2026-10-22T09:00:00.000Z",
};

const secondOrder = {
  ...baseOrder,
  order_id: "AVN-10002",
  status: "payment_pending",
  shipment_id: null,
  awb: "",
  shipment_status: "",
  latest_status: "",
  latest_event: "",
};

describe("POST /api/track-order", () => {
  it("tracks with the mobile number alone (no order ID / AWB)", async () => {
    const { env, calls } = makeEnv({ orders: [baseOrder] });
    const res = await onRequestPost({ request: request({ phone: "9876543210" }), env });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(body.orders[0].order_id).toBe("AVN-10001");
    expect(body.orders[0].shipment.awb).toBe("AWB123456");

    // The phone is matched on the last 10 digits, never an exact string.
    const ordersQuery = calls.find((c) => c.sql.includes("FROM orders o"));
    expect(ordersQuery).toBeTruthy();
    expect(ordersQuery.sql).toContain("substr(");
    expect(ordersQuery.params).toEqual(["9876543210"]);
  });

  it("still works when the Ekart public-tracking toggle is off", async () => {
    const { env } = makeEnv({ enabled: "0", orders: [baseOrder] });
    const res = await onRequestPost({ request: request({ phone: "9876543210" }), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("still works when the settings table is missing", async () => {
    const { env } = makeEnv({ orders: [baseOrder] });
    env.DB.prepare = ((original) => (sql) => {
      if (sql.includes("FROM settings")) throw new Error("no such table: settings");
      return original(sql);
    })(env.DB.prepare.bind(env.DB));
    const res = await onRequestPost({ request: request({ phone: "9876543210" }), env });
    expect(res.status).toBe(200);
  });

  it("lists every order placed with the number, newest first", async () => {
    const { env } = makeEnv({ orders: [baseOrder, secondOrder] });
    const res = await onRequestPost({ request: request({ phone: "9876543210" }), env });
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.orders.map((o) => o.order_id)).toEqual(["AVN-10001", "AVN-10002"]);
    expect(body.orders[1].shipment).toBe(null);
    expect(body.orders[1].message).toMatch(/tracking will appear after despatch/i);
    expect(body.orders[1].status_label).toBe("Payment pending");
  });

  it("narrows the result when an order ID or AWB is supplied", async () => {
    const { env, calls } = makeEnv({ orders: [baseOrder] });
    const res = await onRequestPost({
      request: request({ phone: "+91 98765 43210", order_id: "AVN-10001", awb: "awb123456" }),
      env,
    });
    expect(res.status).toBe(200);
    const ordersQuery = calls.find((c) => c.sql.includes("FROM orders o"));
    expect(ordersQuery.params).toEqual(["9876543210", "AVN-10001", "AWB123456"]);
  });

  it("falls back to order status when the Ekart tables are missing", async () => {
    const { env } = makeEnv({ orders: [{ ...baseOrder, shipment_id: null, awb: "", latest_status: "", shipment_status: "" }], noShipmentTable: true });
    const res = await onRequestPost({ request: request({ phone: "9876543210" }), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.orders[0].shipment).toBe(null);
    expect(body.orders[0].status_label).toBe("Order placed (COD)");
  });

  it("requires a valid mobile number", async () => {
    const { env } = makeEnv({ orders: [baseOrder] });
    const res = await onRequestPost({ request: request({ phone: "123" }), env });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("returns a friendly 404 when the number has no orders", async () => {
    const { env } = makeEnv({ orders: [] });
    const res = await onRequestPost({ request: request({ phone: "9999999999" }), env });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/no order found/i);
  });

  it("never exposes name, address or the phone number", async () => {
    const { env } = makeEnv({
      orders: [baseOrder],
      events: [
        { shipment_id: 7, mapped_status: "in_transit", status: "in_transit", event_at: "2026-10-22T09:00:00.000Z", location: "Delhi" },
      ],
    });
    const res = await onRequestPost({ request: request({ phone: "9876543210" }), env });
    const body = await res.json();
    expect(body.orders[0].shipment.timeline).toHaveLength(1);
    expect(body.orders[0].shipment.timeline[0].location).toBe("Delhi");
    const text = JSON.stringify(body);
    expect(text).not.toContain("9876543210");
    expect(text).not.toContain("Test Buyer");
    expect(text).not.toContain("Janpath");
  });

  it("keeps the legacy single-order fields for older cached pages", async () => {
    const { env } = makeEnv({ orders: [baseOrder] });
    const res = await onRequestPost({ request: request({ phone: "9876543210" }), env });
    const body = await res.json();
    expect(body.order.order_id).toBe("AVN-10001");
    expect(body.order.order_status_label).toBe("Order placed (COD)");
    expect(body.shipment.awb).toBe("AWB123456");
  });
});
