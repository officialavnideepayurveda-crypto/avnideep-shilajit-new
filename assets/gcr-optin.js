/* Google Customer Reviews (GCR) opt-in helper — Avnideep Ayurveda
 *
 * Two jobs:
 *   1. Checkout pages: inject an optional email field into #oForm and remember
 *      the address in sessionStorage, so the confirmation page can ask Google
 *      to send a survey. Nothing is sent anywhere from here.
 *   2. thank-you.html: build the opt-in config (merchant_id, order_id, email,
 *      delivery_country, estimated_delivery_date, products[]) and load Google's
 *      platform.js only after the page is idle.
 *
 * The module must not slow the store down: ~4 KB, no frameworks, no network
 * until render() is explicitly called.
 */
(function () {
  "use strict";

  var MERCHANT_ID = "543428508";
  var COUNTRY = "IN";
  var EMAIL_KEY = "avn_gcr_email";
  var OPT_IN_STYLE = "BOTTOM_TRAY";

  /* Per-product ratings need real GS1 barcodes (8/12/13/14 digits). Internal
   * SKUs are NOT GTINs, so they are left empty: until a barcode is filled in,
   * the survey still runs and counts towards the STORE rating, which is what
   * shows next to Shopping ads. Fill a value in and the same survey also
   * produces a product-level rating for that SKU.
   */
  var GTIN = {
    "AVN-6PRO-001": "",
    "AVN-OIL-001": "",
    "AVN-HAIR-001": "",
    "AVN-BALM-001": ""
  };

  /* Order label -> SKU, for orders where only a product name is known. */
  var SKU_BY_WORD = [
    ["shilajit", "AVN-6PRO-001"],
    ["6pro", "AVN-6PRO-001"],
    ["pain", "AVN-OIL-001"],
    ["oil 60", "AVN-OIL-001"],
    ["hair", "AVN-HAIR-001"],
    ["balm", "AVN-BALM-001"]
  ];

  function isEmail(value) {
    var v = String(value == null ? "" : value).trim();
    // Deliberately simple: GCR only needs a plausible address, and the survey
    // is what proves deliverability.
    return /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+){1,3}$/.test(v) && v.length <= 120;
  }

  function istParts(date) {
    // IST is a fixed +05:30 offset, no DST.
    var t = new Date((date ? date.getTime() : Date.now()) + 330 * 60 * 1000);
    return {
      d: t.getUTCDate(),
      m: t.getUTCMonth() + 1,
      y: t.getUTCFullYear(),
      h: t.getUTCHours(),
      min: t.getUTCMinutes()
    };
  }

  function isoDate(date) {
    var p = istParts(date);
    var mm = String(p.m).padStart(2, "0");
    var dd = String(p.d).padStart(2, "0");
    return p.y + "-" + mm + "-" + dd;
  }

  /** Estimated delivery date: today (IST) + N days, as YYYY-MM-DD. */
  function etaDate(days, from) {
    var base = from ? new Date(from.getTime()) : new Date();
    var d = Number(days);
    if (!isFinite(d) || d < 0) d = 6;
    base.setTime(base.getTime() + d * 24 * 60 * 60 * 1000);
    return isoDate(base);
  }

  function skusFromText(text) {
    var t = String(text || "").toLowerCase();
    var out = [];
    for (var i = 0; i < SKU_BY_WORD.length; i++) {
      if (t.indexOf(SKU_BY_WORD[i][0]) !== -1) {
        if (out.indexOf(SKU_BY_WORD[i][1]) === -1) out.push(SKU_BY_WORD[i][1]);
      }
    }
    return out;
  }

  function productsFor(skus) {
    var out = [];
    var list = Array.isArray(skus) ? skus : [];
    for (var i = 0; i < list.length; i++) {
      var gtin = String(GTIN[list[i]] || "").trim();
      if (/^\d{8}$|^\d{12,14}$/.test(gtin)) out.push({ gtin: gtin });
    }
    return out;
  }

  /**
   * Builds the object handed to gapi.surveyoptin.render, or null when the
   * opt-in must not run (no confirmed order id, no usable email).
   */
  function build(opts) {
    var o = opts || {};
    var orderId = String(o.orderId || "").trim();
    var email = String(o.email || "").trim();
    if (!orderId || !isEmail(email)) return null;

    var cfg = {
      merchant_id: MERCHANT_ID,
      order_id: orderId.slice(0, 80),
      email: email,
      delivery_country: o.country || COUNTRY,
      estimated_delivery_date: o.eta || etaDate(6),
      opt_in_style: OPT_IN_STYLE
    };

    var products = productsFor(o.skus);
    if (products.length) cfg.products = products;
    return cfg;
  }

  function injectPlatformScript() {
    if (document.getElementById("gcr-platform-js")) return;
    var s = document.createElement("script");
    s.id = "gcr-platform-js";
    s.async = true;
    s.defer = true;
    s.src = "https://apis.google.com/js/platform.js?onload=renderOptIn";
    (document.body || document.head || document.documentElement).appendChild(s);
  }

  /** Renders the opt-in overlay for a config produced by build(). */
  function render(cfg) {
    if (!cfg) return false;
    window.___gcfg = window.___gcfg || { lang: "en" };
    window.renderOptIn = function () {
      try {
        window.gapi.load("surveyoptin", function () {
          window.gapi.surveyoptin.render(cfg);
        });
      } catch (e) {}
    };
    injectPlatformScript();
    return true;
  }

  /* ---------- checkout: optional email field + capture ---------- */

  function storeEmail(value) {
    try {
      if (isEmail(value)) sessionStorage.setItem(EMAIL_KEY, String(value).trim());
      else sessionStorage.removeItem(EMAIL_KEY);
    } catch (e) {}
  }

  function installEmailField() {
    var form = document.getElementById("oForm");
    if (!form || form.querySelector("[data-gcr-email]")) return;

    var nameWrap = (document.getElementById("cName") || {}).closest
      ? document.getElementById("cName").closest(".form-field")
      : null;

    var wrap = document.createElement("div");
    wrap.className = "form-field";
    wrap.setAttribute("data-gcr-field", "1");

    var label = document.createElement("label");
    label.setAttribute("for", "gcrEmail");
    label.textContent = "Email (optional)";

    var input = document.createElement("input");
    input.id = "gcrEmail";
    input.name = "email";
    input.type = "email";
    input.inputMode = "email";
    input.autocomplete = "email";
    input.maxLength = 120;
    input.placeholder = "you@example.com — order updates & review invite";
    input.setAttribute("data-gcr-email", "1");

    wrap.appendChild(label);
    wrap.appendChild(input);

    if (nameWrap && nameWrap.parentNode) nameWrap.parentNode.insertBefore(wrap, nameWrap.nextSibling);
    else form.insertBefore(wrap, form.firstChild);
  }

  function onInput(event) {
    var el = event.target;
    if (!el || !el.getAttribute || !el.getAttribute("data-gcr-email")) return;
    storeEmail(el.value);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", installEmailField);
    } else {
      installEmailField();
    }
  }

  window.AVN_GCR = {
    MERCHANT_ID: MERCHANT_ID,
    EMAIL_KEY: EMAIL_KEY,
    gtin: GTIN,
    build: build,
    render: render,
    isEmail: isEmail,
    etaDate: etaDate,
    isoDate: isoDate,
    skusFromText: skusFromText,
    productsFor: productsFor,
    installEmailField: installEmailField
  };
})();
