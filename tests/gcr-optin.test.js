// ============================================================
// Google Customer Reviews opt-in (assets/gcr-optin.js + thank-you.html).
//
// Contract: a survey opt-in goes out ONLY for a real, non-duplicate order that
// has a usable customer email, and it carries the Merchant Center id, order id,
// delivery country, a delivery date 6 days out and (when a GTIN is configured)
// the ordered products. No email -> no opt-in, no platform.js request.
// ============================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");
const GCR_SRC = read("assets/gcr-optin.js");
const EXT_SCRIPT = /<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g;
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

function loadGcr() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://avnideepayurveda.in/",
    runScripts: "dangerously",
  });
  dom.window.eval(GCR_SRC);
  return dom.window;
}

function bootThankYou(query, { email, order, duplicate } = {}) {
  let html = read("thank-you.html")
    .replace('<script src="/assets/gcr-optin.js?v=1" defer></script>', `<script>${GCR_SRC}</script>`)
    .replace(EXT_SCRIPT, "");
  const dom = new JSDOM(html, {
    url: "https://avnideepayurveda.in/thank-you.html" + query + (duplicate ? "&duplicate=true" : ""),
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) {
      if (email) w.sessionStorage.setItem("avn_gcr_email", email);
      w.fetch = (u, o) => {
        const target = String(u);
        if ((o && o.method) === "PATCH") {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }
        if (target.includes("/api/order?") && order) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, order }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      };
      w.fbq = () => {};
      w.dataLayer = [];
      w.scrollTo = () => {};
      w.open = () => null;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    },
  });
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded", { bubbles: true }));
  return dom.window;
}

describe("opt-in config", () => {
  it("accepts plausible emails and rejects junk", () => {
    const w = loadGcr();
    expect(w.AVN_GCR.isEmail("buyer@example.com")).toBe(true);
    expect(w.AVN_GCR.isEmail("  buyer.name+tag@mail.co.in ")).toBe(true);
    expect(w.AVN_GCR.isEmail("")).toBe(false);
    expect(w.AVN_GCR.isEmail("buyer@")).toBe(false);
    expect(w.AVN_GCR.isEmail("buyer@@example.com")).toBe(false);
    expect(w.AVN_GCR.isEmail("not-an-email")).toBe(false);
  });

  it("computes the delivery date in IST, 6 days out", () => {
    const w = loadGcr();
    // 2026-01-01 20:00 UTC == 2026-01-02 01:30 IST -> +6 days = 2026-01-08
    expect(w.AVN_GCR.etaDate(6, new Date("2026-01-01T20:00:00Z"))).toBe("2026-01-08");
    expect(w.AVN_GCR.isoDate(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });

  it("refuses to build without an order id or an email", () => {
    const w = loadGcr();
    expect(w.AVN_GCR.build({ orderId: "", email: "a@b.co" })).toBe(null);
    expect(w.AVN_GCR.build({ orderId: "AVN-1", email: "" })).toBe(null);
    expect(w.AVN_GCR.build({ orderId: "AVN-1", email: "nope" })).toBe(null);
  });

  it("builds the documented payload for a valid order", () => {
    const w = loadGcr();
    const cfg = w.AVN_GCR.build({ orderId: "AVN-1234", email: "buyer@example.com", skus: ["AVN-6PRO-001"] });
    expect(cfg).toMatchObject({
      merchant_id: "543428508",
      order_id: "AVN-1234",
      email: "buyer@example.com",
      delivery_country: "IN",
      opt_in_style: "BOTTOM_TRAY",
    });
    expect(cfg.estimated_delivery_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No GS1 barcode configured for this SKU yet -> store-level survey only.
    expect(cfg.products).toBeUndefined();
  });

  it("adds per-product ratings once a real GTIN is configured", () => {
    const w = loadGcr();
    w.AVN_GCR.gtin["AVN-6PRO-001"] = "8901234567890";
    w.AVN_GCR.gtin["AVN-OIL-001"] = "12345678";
    w.AVN_GCR.gtin["AVN-HAIR-001"] = "not-a-gtin";
    const cfg = w.AVN_GCR.build({
      orderId: "AVN-9",
      email: "buyer@example.com",
      skus: ["AVN-6PRO-001", "AVN-OIL-001", "AVN-HAIR-001"],
    });
    expect(cfg.products).toEqual([{ gtin: "8901234567890" }, { gtin: "12345678" }]);
  });

  it("maps order labels to catalogue SKUs", () => {
    const w = loadGcr();
    expect(w.AVN_GCR.skusFromText("Avnideep 6Pro Shilajit Capsules")).toContain("AVN-6PRO-001");
    expect(w.AVN_GCR.skusFromText("Pain Relief Oil 60ml")).toContain("AVN-OIL-001");
    expect(w.AVN_GCR.skusFromText("Herbal Hair Oil")).toContain("AVN-HAIR-001");
    expect(w.AVN_GCR.skusFromText("")).toEqual([]);
  });

  it("loads Google's platform.js once and renders through gapi", async () => {
    const w = loadGcr();
    const calls = [];
    w.gapi = { load: (name, cb) => { calls.push(name); cb(); }, surveyoptin: { render: (cfg) => calls.push(cfg) } };
    const cfg = w.AVN_GCR.build({ orderId: "AVN-77", email: "buyer@example.com" });

    expect(w.AVN_GCR.render(cfg)).toBe(true);
    expect(w.AVN_GCR.render(cfg)).toBe(true); // idempotent
    const scripts = w.document.querySelectorAll("#gcr-platform-js");
    expect(scripts.length).toBe(1);
    expect(scripts[0].src).toContain("apis.google.com/js/platform.js");

    w.renderOptIn();
    expect(calls[0]).toBe("surveyoptin");
    expect(calls[1]).toMatchObject({ order_id: "AVN-77", merchant_id: "543428508" });
  });
});

describe("checkout email field", () => {
  function checkoutDom() {
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <form id="oForm">
          <div class="form-field"><label for="cName">Full Name *</label><input id="cName" name="name"></div>
          <div class="form-field"><label for="tcPhoneInput">Mobile *</label><input id="tcPhoneInput" name="phone"></div>
        </form></body></html>`,
      { url: "https://avnideepayurveda.in/", runScripts: "dangerously" }
    );
    dom.window.eval(GCR_SRC);
    // The real pages load this with `defer`, so the field is installed on
    // DOMContentLoaded; jsdom keeps the document "loading" until we say so.
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded", { bubbles: true }));
    return dom.window;
  }

  it("injects one optional email field, right after the name field", () => {
    const w = checkoutDom();
    const fields = w.document.querySelectorAll("[data-gcr-email]");
    expect(fields.length).toBe(1);
    const input = fields[0];
    expect(input.type).toBe("email");
    expect(input.required).toBe(false);
    expect(input.closest(".form-field").previousElementSibling.querySelector("#cName")).toBeTruthy();

    w.AVN_GCR.installEmailField(); // must not duplicate
    expect(w.document.querySelectorAll("[data-gcr-email]").length).toBe(1);
  });

  it("remembers a valid email for the confirmation page and clears junk", () => {
    const w = checkoutDom();
    const input = w.document.querySelector("[data-gcr-email]");
    input.value = "buyer@example.com";
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    expect(w.sessionStorage.getItem("avn_gcr_email")).toBe("buyer@example.com");

    input.value = "buyer@";
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    expect(w.sessionStorage.getItem("avn_gcr_email")).toBe(null);
  });
});

describe("thank-you page wiring", () => {
  it("fires the opt-in for a confirmed order with an email", async () => {
    const w = bootThankYou("?order_id=AVN-TY-1&amount=1000&name=Shilajit&phone=9876543210&method=cod", {
      email: "buyer@example.com",
      order: { orderId: "AVN-TY-1", amount: 1000, paymentMethod: "cod", product: "Avnideep 6Pro Shilajit Capsules" },
    });
    await settle(2200);

    const cfg = w.__AVN_GCR_OPTS;
    expect(cfg).toBeTruthy();
    expect(cfg.order_id).toBe("AVN-TY-1");
    expect(cfg.email).toBe("buyer@example.com");
    expect(cfg.delivery_country).toBe("IN");
    expect(w.document.getElementById("gcr-platform-js")).toBeTruthy();
  }, 10000);

  it("stays silent without a customer email", async () => {
    const w = bootThankYou("?order_id=AVN-TY-2&amount=1000&name=Shilajit&phone=9876543210&method=cod", {
      order: { orderId: "AVN-TY-2", amount: 1000, paymentMethod: "cod" },
    });
    await settle(2200);
    expect(w.__AVN_GCR_OPTS).toBeUndefined();
    expect(w.document.getElementById("gcr-platform-js")).toBe(null);
  }, 10000);

  it("stays silent for duplicate orders", async () => {
    const w = bootThankYou("?order_id=AVN-TY-3&amount=1000&name=Shilajit&phone=9876543210&method=cod", {
      email: "buyer@example.com",
      duplicate: true,
      order: { orderId: "AVN-TY-3", amount: 1000, paymentMethod: "cod" },
    });
    await settle(2200);
    expect(w.__AVN_GCR_OPTS).toBeUndefined();
  }, 10000);
});
