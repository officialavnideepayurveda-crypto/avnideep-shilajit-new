import { describe, it, expect } from "vitest";
import { onRequestPost } from "../functions/api/track-order.js";

function makeEnv({ enabled = "1", order = null, events = [] } = {}) {
  const DB = {
    prepare(sql) {
      return {
        bind() {
          return {
            first: async () => {
              if (sql.includes("FROM settings")) return { value: enabled };
              if (sql.includes("FROM orders o")) return order;
              return null;
            },
            all: async () => {
              if (sql.includes("FROM ekart_shipment_events")) return { results: events };
              return { results: [] };
            },
          };
        },
        first: async () => {
          if (sql.includes("FROM settings")) return { value: enabled };
          return null;
        },
      };
    },
  };
  return { DB };
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
  status: "processing",
  created_at: "2026-10-20T10:00:00.000Z",
  payment_method: "cod",
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

describe("POST /api/track-order", () => {
  it("is unavailable until public tracking is enabled", async () => {
    const res = await onRequestPost({
      request: request({ order_id: "AVN-10001", phone: "9876543210" }),
      env: makeEnv({ enabled: "0" }),
    });
    expect(res.status).toBe(503);
  });

  it("requires an order/AWB and a valid phone", async () => {
    const res = await onRequestPost({
      request: request({ order_id: "", phone: "123" }),
      env: makeEnv(),
    });
    expect(res.status).toBe(400);
  });

  it("does not reveal whether an order exists when the phone does not match", async () => {
    const res = await onRequestPost({
      request: request({ order_id: "AVN-10001", phone: "9999999999" }),
      env: makeEnv({ order: baseOrder }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain("AWB123456");
  });

  it("returns tracking without exposing address, name or phone", async () => {
    const res = await onRequestPost({
      request: request({ order_id: "AVN-10001", phone: "9876543210" }),
      env: makeEnv({
        order: baseOrder,
        events: [
          { mapped_status: "in_transit", status: "in_transit", event_at: "2026-10-22T09:00:00.000Z", location: "Delhi" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.shipment.awb).toBe("AWB123456");
    expect(body.shipment.timeline).toHaveLength(1);
    expect(body.shipment.timeline[0].location).toBe("Delhi");
    const text = JSON.stringify(body);
    expect(text).not.toContain("9876543210");
    expect(text).not.toContain("Test Buyer");
    expect(text).not.toContain("Janpath");
  });

  it("returns a confirmation message before a shipment exists", async () => {
    const res = await onRequestPost({
      request: request({ order_id: "AVN-10001", phone: "9876543210" }),
      env: makeEnv({ order: { ...baseOrder, shipment_id: null, awb: "", latest_status: "", shipment_status: "" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shipment).toBe(null);
    expect(body.message).toMatch(/tracking number/i);
  });
});
