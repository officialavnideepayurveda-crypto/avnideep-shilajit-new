// ============================================================
// Checkout payment card must follow a deliberate product-page choice.
//
// Regression: tapping "Cash on Delivery ₹349" on the product page changed the
// price there, but the checkout still had Prepaid selected — a customer could
// pay ₹299 online after choosing COD at ₹349. Now:
//   - the tap moves the checkout card immediately, and
//   - it is remembered for the next paint (and the next visit),
//   - while a first-ever visit still opens on the admin default.
// ============================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const CART_JS = readFileSync(resolve(ROOT, "assets/cart.js"), "utf8");

function boot({ choice } = {}) {
  const payCards = ["cod", "advance", "prepaid"]
    .map((kind) => `<label class="pay-card" data-pay-card="${kind}">
        <input type="radio" name="paymentMethod" value="${kind}">
      </label>`)
    .join("");
  const html =
    "<!doctype html><html><body>" +
    `<div class="ap-packs">
       <div class="ap-pack" data-pay="C"><b>Cash on Delivery</b></div>
       <div class="ap-pack on" data-pay="P"><b>Prepaid</b></div>
     </div>` +
    `<form id="oForm"><div class="pay-grid">${payCards}</div></form>` +
    `<script>${CART_JS}</script></body></html>`;

  const dom = new JSDOM(html, {
    url: "https://avnideepayurveda.in/pain-oil/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = () => Promise.reject(new Error("offline (test)"));
      w.fbq = function () {};
      if (choice) w.localStorage.setItem("avn_pay_choice", choice);
    },
  });
  return dom.window;
}

const checked = (w) => {
  const el = w.document.querySelector('input[name="paymentMethod"]:checked');
  return el ? el.value : "";
};
const tap = (w, pay) =>
  w.document.querySelector(`.ap-pack[data-pay="${pay}"]`).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

const PAY_CFG = { cod_enabled: true, advance_enabled: true, prepaid_enabled: true, default_method: "prepaid", advance_amount: 100 };

describe("checkout payment card follows the product page", () => {
  it("a first visit opens on the admin default", () => {
    const w = boot();
    w.AVN_CHECKOUT.renderPayUI(PAY_CFG);
    expect(checked(w)).toBe("prepaid");
  });

  it("tapping COD moves the checkout card immediately", () => {
    const w = boot();
    w.AVN_CHECKOUT.renderPayUI(PAY_CFG);
    expect(checked(w)).toBe("prepaid");

    tap(w, "C");
    expect(checked(w)).toBe("cod");

    tap(w, "P");
    expect(checked(w)).toBe("prepaid");
  });

  it("the tapped choice survives the next paint", () => {
    const w = boot();
    tap(w, "C");
    w.AVN_CHECKOUT.renderPayUI(PAY_CFG);
    expect(checked(w)).toBe("cod");
  });

  it("the tapped choice survives a reload", () => {
    const w = boot({ choice: "C" });
    w.AVN_CHECKOUT.renderPayUI(PAY_CFG);
    expect(checked(w)).toBe("cod");
  });

  it("an admin default of COD still wins when nothing was tapped", () => {
    const w = boot();
    w.AVN_CHECKOUT.renderPayUI({ ...PAY_CFG, default_method: "cod" });
    expect(checked(w)).toBe("cod");
  });

  it("never selects a method the admin disabled", () => {
    const w = boot({ choice: "C" });
    w.AVN_CHECKOUT.renderPayUI({ ...PAY_CFG, cod_enabled: false });
    expect(checked(w)).toBe("prepaid");
  });
});
