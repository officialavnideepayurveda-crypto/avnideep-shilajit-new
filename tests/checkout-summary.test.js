// ============================================================
// Regression tests for the order-summary pricing bug.
//
// Bug: the first line of the order summary (the "product" row) showed the whole
// order's grand total. On a mixed cart the row read e.g.
// "Avnideep Pain Oil (60ml) (2 items)   ₹2,799" — the oil's own price is ₹449.
// The cart total was being written into #sAmt, the row that represents a single
// product.
//
// PRICING RULE covered here: COD price = product MRP, prepaid = MRP - 20%.
//
// The summary is now painted by window.AVN_CHECKOUT.renderSummary (assets/
// cart.js): a mixed cart shows a "Your Cart — N items" row with the SUBTOTAL and
// one row per product at that product's own price, then a distinct Total row.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const EXT_SCRIPT = /<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g;

function bootPage(htmlRel, appRel, { cart, url, admin } = {}) {
  const calls = [];
  const wa = [];
  const html = read(htmlRel).replace(EXT_SCRIPT, '');
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      if (cart) w.localStorage.setItem('avn_cart_v1', JSON.stringify(cart));
      if (admin) w.AVN_ADMIN_PRODUCTS = admin;
      w.fetch = (u, o) => {
        const target = String(u);
        let body = null;
        if (o && o.body) { try { body = JSON.parse(o.body); } catch (e) { body = o.body; } }
        calls.push({ url: target, method: (o && o.method) || 'GET', body });
        if (target.includes('/razorpay/create-order')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: { id: 'order_T', amount: (body && body.amount) || 0, currency: 'INR', key_id: 'rzp_test_x' } }) });
        }
        if (target.includes('payment-config')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: { razorpay_enabled: true, key_id: 'rzp_test_x', cod_enabled: true, checkout_mode: 'advance' } }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: { order_id: 'AVN-TEST' } }) });
      };
      w.open = (u) => { wa.push(String(u)); return null; };
      w.fbq = () => {}; w.gtag = () => {}; w.dataLayer = [];
      w.scrollTo = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
      w.ResizeObserver = class { observe() {} disconnect() {} };
      w.Razorpay = class { on() {} open() {} };
    },
  });
  const w = dom.window;
  const inject = (rel) => {
    const s = w.document.createElement('script');
    s.textContent = read(rel);
    w.document.body.appendChild(s);
  };
  inject('assets/cart.js');
  inject(appRel);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return { w, calls, wa };
}

const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

async function openFromCart(w) {
  const open = w.document.querySelector('[data-cart-open]');
  open.click();
  await settle(200);
  w.document.querySelector('[data-cart-checkout]').click();
  await settle(500);
}

async function selectPay(w, value) {
  const radio = w.document.querySelector(`input[name="paymentMethod"][value="${value}"]`);
  expect(radio, `${value} radio`).toBeTruthy();
  radio.checked = true;
  radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  await settle(200);
}

const txt = (w, id) => w.document.getElementById(id).textContent;
const lineTexts = (w) => [...w.document.querySelectorAll('.summary .s-row[data-cart-line]')].map((r) => r.textContent);
const advanceRows = (w) => [...w.document.querySelectorAll('.summary .s-row[data-adv-row]')].map((r) => r.textContent);

// The exact screenshot cart: Pain Oil (60ml) pack of 2 + Shilajit pack of 2.
// On the pain-oil PDP (oil is the last item, so checkout stays on this page).
const OIL_PAGE = 'pain-oil/index.html';
const OIL_APP = 'pain-oil/app-oil.v3.js';
// MRPs: shilajit pack of 2 = 5,000, oil pack of 2 = 698. COD = MRP.
const SCREENSHOT_CART = { shilajit2: 1, oil2: 1 };
const SCREENSHOT_COD = 5000 + 698;                 // 5698
const SCREENSHOT_PREPAID = 4000 + 558;             // 4558 (20% off)

describe('order summary prices each product, not the grand total', () => {
  it('mixed cart: product row shows the cart subtotal and each item its own price (COD)', async () => {
    const { w, wa } = bootPage(OIL_PAGE, OIL_APP, {
      cart: SCREENSHOT_CART, url: 'https://avnideepayurveda.in/pain-oil/',
    });
    await openFromCart(w);
    await selectPay(w, 'cod');

    expect(wa.filter((u) => /wa\.me/.test(u))).toEqual([]);
    expect(w.AVN_CART_STATE.mixed).toBe(true);

    // the anchor row is the cart title + subtotal, never a single product's line
    expect(w.document.querySelector('.summary .s-row span').textContent).toContain('Your Cart');
    expect(txt(w, 'sAmt')).toBe('₹5,698');
    expect(txt(w, 'sTot')).toBe('₹5,698');

    // one row per product, each at its OWN price
    const lines = lineTexts(w);
    expect(lines.length).toBe(2);
    expect(lines.some((t) => t.includes('₹5,000'))).toBe(true); // shilajit pack of 2 (MRP)
    expect(lines.some((t) => t.includes('₹698'))).toBe(true);   // oil pack of 2 (MRP)
    // the bug: the oil row used to show the ₹2,799 grand total
    expect(lines.some((t) => t.includes('₹5,698'))).toBe(false);
    expect(lines.some((t) => t.includes('Pain Relief Oil'))).toBe(true);
    expect(lines.some((t) => t.includes('Shilajit'))).toBe(true);

    // The prepaid discount row must not be visible on a COD order (the HTML
    // hidden attribute alone is overridden by .s-row{display:flex}).
    const discount = w.document.getElementById('sSave');
    expect(discount.hidden).toBe(true);
    expect(discount.style.display).toBe('none');

    // ₹100 advance + remaining COD are spelled out
    const adv = advanceRows(w);
    expect(adv.some((t) => t.includes('₹100'))).toBe(true);
    expect(adv.some((t) => t.includes('₹5,598'))).toBe(true);
  });

  it('mixed cart prepaid: subtotal stays COD, discount row bridges to the prepaid total', async () => {
    const { w } = bootPage(OIL_PAGE, OIL_APP, {
      cart: SCREENSHOT_CART, url: 'https://avnideepayurveda.in/pain-oil/',
    });
    await openFromCart(w);
    await selectPay(w, 'prepaid');

    expect(txt(w, 'sAmt')).toBe('₹5,698');            // subtotal (COD = MRP), not the prepaid total
    expect(txt(w, 'sTot')).toBe('₹4,558');            // 4000 + 798
    const save = w.document.getElementById('sSave');
    expect(save.hidden).toBe(false);
    expect(save.style.display).not.toBe('none');
    expect(save.textContent).toContain('₹1,140');     // 5698 - 4558 = 20%

    // per-item rows still show their own COD price
    const lines = lineTexts(w);
    expect(lines.some((t) => t.includes('₹698'))).toBe(true);
    expect(lines.some((t) => t.includes('₹5,000'))).toBe(true);

    // no advance/COD split when the whole order is prepaid
    expect(advanceRows(w).length).toBe(0);
  });

  it('single-product cart is unchanged: one pack price, no per-item rows', async () => {
    const { w } = bootPage(OIL_PAGE, OIL_APP, {
      cart: { oil: 1 }, url: 'https://avnideepayurveda.in/pain-oil/',
    });
    await openFromCart(w);
    await selectPay(w, 'cod');

    expect(w.AVN_CART_STATE.mixed).toBe(false);
    expect(txt(w, 'sAmt')).toBe('₹349');
    expect(txt(w, 'sTot')).toBe('₹349');
    expect(w.document.querySelectorAll('.summary .s-row[data-cart-line]').length).toBe(0);
    expect(w.document.querySelector('.summary .s-row span').textContent).toContain('Pain Oil');
  });

  it('the money sent to /api/order and Razorpay is the verified cart total', async () => {
    const { w, calls } = bootPage(OIL_PAGE, OIL_APP, {
      cart: SCREENSHOT_CART, url: 'https://avnideepayurveda.in/pain-oil/',
    });
    await openFromCart(w);
    await selectPay(w, 'cod');

    const fill = (id, v) => { w.document.getElementById(id).value = v; };
    fill('cName', 'Test Buyer');
    fill('tcPhoneInput', '9876543210');
    fill('cAddress', '12 Test Street');
    fill('cPincode', '110001');
    fill('cCity', 'Delhi');
    w.document.getElementById('oForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const order = calls.find((c) => c.url.includes('/api/order') && c.method === 'POST');
    expect(order, 'order must be saved').toBeTruthy();
    expect(order.body.amount).toBe(SCREENSHOT_COD);
    // the order carries the itemised cart so the backend can re-verify the total
    expect(Array.isArray(order.body.items)).toBe(true);
    expect(order.body.items.length).toBe(2);

    const rzp = calls.find((c) => c.url.includes('/razorpay/create-order'));
    expect(rzp, 'razorpay order must be created').toBeTruthy();
    // COD advance flow: only the ₹100 advance is charged online now…
    expect(rzp.body.amount).toBe(100);
    expect(rzp.body.advanceAmount == null || rzp.body.advanceAmount === 100).toBe(true);
    // …while the saved order carries the full verified cart total.
    expect(order.body.amount).toBe(SCREENSHOT_COD);
  });
});

describe('every cart line is priced from its own unit price and quantity', () => {
  it('two packs of the same product are two separate lines, not one pack total', async () => {
    const { w } = bootPage(OIL_PAGE, OIL_APP, {
      cart: { oil: 1, oil2: 1 }, url: 'https://avnideepayurveda.in/pain-oil/',
    });
    await openFromCart(w);
    await selectPay(w, 'cod');

    expect(txt(w, 'sAmt')).toBe('₹1,047'); // 499 + 998, not the last pack alone
    expect(txt(w, 'sTot')).toBe('₹1,047');
    const lines = lineTexts(w);
    expect(lines.length).toBe(2);
    expect(lines.some((t) => t.includes('₹349'))).toBe(true);
    expect(lines.some((t) => t.includes('₹698'))).toBe(true);
    expect(lines.some((t) => t.includes('₹1,047'))).toBe(false);

    const adv = advanceRows(w);
    expect(adv.some((t) => t.includes('₹100'))).toBe(true);
    expect(adv.some((t) => t.includes('₹947'))).toBe(true);

    await selectPay(w, 'prepaid');
    expect(txt(w, 'sTot')).toBe('₹837'); // 399 + 798
    expect(w.document.getElementById('sSave').textContent).toContain('₹210'); // 1047 - 837
    expect(txt(w, 'sSaveAmt')).toBe('₹210'); // MRP 1,047 - 837 (the same 20%, not twice)
  });

  it('quantity > 1 multiplies the unit price, for the summary and the order', async () => {
    const { w, calls } = bootPage(OIL_PAGE, OIL_APP, {
      cart: { oil: 2 }, url: 'https://avnideepayurveda.in/pain-oil/',
    });
    await openFromCart(w);
    await selectPay(w, 'cod');

    expect(w.document.querySelector('.summary .s-row span').textContent).toContain('× 2');
    expect(txt(w, 'sAmt')).toBe('₹698'); // 349 MRP x 2
    expect(txt(w, 'sTot')).toBe('₹698');
    expect(w.document.querySelectorAll('.summary .s-row[data-cart-line]').length).toBe(0);
    expect(advanceRows(w).some((t) => t.includes('₹598'))).toBe(true); // 998 - 100

    const fill = (id, v) => { w.document.getElementById(id).value = v; };
    fill('cName', 'Test Buyer');
    fill('tcPhoneInput', '9876543210');
    fill('cAddress', '12 Test Street');
    fill('cPincode', '110001');
    fill('cCity', 'Delhi');
    w.document.getElementById('oForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const order = calls.find((c) => c.url.includes('/api/order') && c.method === 'POST');
    expect(order.body.amount).toBe(698);
    expect(order.body.items).toEqual([{ id: 'oil', family: 'oil', pack: 1, qty: 2 }]);
    const rzp = calls.find((c) => c.url.includes('/razorpay/create-order'));
    expect(rzp.body.amount).toBe(100);
  });

  it('a direct Buy Now order uses the PDP quantity, not one pack', async () => {
    const { w, calls } = bootPage(OIL_PAGE, OIL_APP, {
      url: 'https://avnideepayurveda.in/pain-oil/',
    });
    w.document.getElementById('apQtyVal').textContent = '2';
    w.openOrderPopup();
    await settle(200);
    await selectPay(w, 'cod');

    expect(w.document.querySelector('.summary .s-row span').textContent).toContain('× 2');
    expect(txt(w, 'sAmt')).toBe('₹698');
    expect(txt(w, 'sTot')).toBe('₹698');

    const fill = (id, v) => { w.document.getElementById(id).value = v; };
    fill('cName', 'Test Buyer');
    fill('tcPhoneInput', '9876543210');
    fill('cAddress', '12 Test Street');
    fill('cPincode', '110001');
    fill('cCity', 'Delhi');
    w.document.getElementById('oForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const order = calls.find((c) => c.url.includes('/api/order') && c.method === 'POST');
    expect(order.body.amount).toBe(698);
    expect(order.body.items).toEqual([{ family: 'oil', pack: 1, qty: 2 }]);
  });

  it('admin/DB price overrides reach every line and the total', async () => {
    const { w } = bootPage(OIL_PAGE, OIL_APP, {
      cart: { shilajit: 1, oil2: 1 },
      url: 'https://avnideepayurveda.in/pain-oil/',
      admin: {
        shilajit: { name: '6Pro Shilajit Capsules', sku: 'AVN-6PRO-001', cod: 1300, prepaid: 1050, mrp: 2500 },
        oil2: { name: 'Pain Relief Oil', sku: 'AVN-OIL-002', cod: 599, prepaid: 479, mrp: 800 },
      },
    });
    await openFromCart(w);
    await selectPay(w, 'cod');

    // The override supplies an MRP; COD = MRP and prepaid = MRP - 20% win over
    // the stale cod/prepaid columns in the same override object.
    expect(txt(w, 'sAmt')).toBe('₹3,300'); // 2500 + 800
    const lines = lineTexts(w);
    expect(lines.some((t) => t.includes('₹2,500'))).toBe(true);
    expect(lines.some((t) => t.includes('₹800'))).toBe(true);

    await selectPay(w, 'prepaid');
    expect(txt(w, 'sTot')).toBe('₹2,640'); // 2000 + 640
    expect(w.document.getElementById('sSave').textContent).toContain('₹660'); // 3300 - 2640
  });
});

describe('no pack-of-1 hard-coding left in the homepage checkout', () => {
  const bundle = read('app.v3.js');
  it('app.v3.js prices the pack/cart instead of literal 999/1250', () => {
    expect(bundle).not.toMatch(/m === 'prepaid' \? 999 : 1250/);
    expect(bundle).not.toContain("mainText = '⚡ Order Now - ₹999'");
    expect(bundle).toContain('function rootPack()');
    expect(bundle).toContain("amount: m === 'prepaid' ? rootPack().pre : rootPack().cod");
  });
});
