// ============================================================
// Regression tests for the cart checkout fix.
//
// A cart holding two or more product families ("mixed cart") used to be dumped
// on WhatsApp when the customer pressed Checkout, because the order popup could
// only price a single pack (localStorage avn_pack). assets/cart.js now publishes
// the whole cart on window.AVN_CART_STATE and coPack()/apPack() price themselves
// from it, so every cart goes through the normal order popup.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const EXT_SCRIPT = /<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g;

// Boot a product page with its inline scripts, assets/cart.js and its app
// bundle — the same three layers production loads.
function bootPage(htmlRel, appRel, { cart, url } = {}) {
  const calls = [];
  const wa = []; // window.open targets (WhatsApp)
  const html = read(htmlRel).replace(EXT_SCRIPT, '');
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      if (cart) w.localStorage.setItem('avn_cart_v1', JSON.stringify(cart));
      w.fetch = (u, o) => {
        const target = String(u);
        let body = null;
        if (o && o.body) { try { body = JSON.parse(o.body); } catch (e) { body = o.body; } }
        calls.push({ url: target, method: (o && o.method) || 'GET', body });
        if (target.includes('/razorpay/create-order')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: { id: 'order_T', amount: (body && body.amount) || 0, currency: 'INR', key_id: 'rzp_test_x' } }) });
        }
        if (target.includes('payment-config')) {
          // matches the production checkout mode (see CHECKOUT_MODE in the bundles)
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
const fill = (w, id, v) => { const el = w.document.getElementById(id); if (el) el.value = v; };

// Select a payment method explicitly so these tests never depend on whichever
// card the page happens to preselect.
async function selectPay(w, value) {
  const radio = w.document.querySelector(`input[name="paymentMethod"][value="${value}"]`);
  expect(radio, `${value} radio`).toBeTruthy();
  radio.checked = true;
  radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  await settle(200);
}

async function submitOrder(w) {
  fill(w, 'cName', 'Test Buyer');
  fill(w, 'tcPhoneInput', '9876543210');
  fill(w, 'cAddress', '12 Test Street');
  fill(w, 'cPincode', '110001');
  fill(w, 'cCity', 'Delhi');
  w.document.getElementById('oForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}

function openFromCart(w) {
  const open = w.document.querySelector('[data-cart-open]');
  expect(open, 'cart opener').toBeTruthy();
  open.click();
  return settle(200).then(() => {
    const co = w.document.querySelector('[data-cart-checkout]');
    expect(co, 'checkout button').toBeTruthy();
    co.click();
    return settle();
  });
}

const SHILAJIT = 'shilajit/index.html';
const SHILAJIT_APP = 'shilajit/app-shilajit.v3.js';
// COD / prepaid per unit from assets/cart.js PRODUCTS
const MIXED = { hair: 1, shilajit: 1 };        // hair 465 + shilajit 1250
const MIXED_COD = 465 + 1250;                  // 1715
const MIXED_PREPAID = 465 + 999;               // 1464
const SINGLE = { shilajit: 1 };

describe('mixed cart checks out through the order popup (not WhatsApp)', () => {
  it('opens the popup and charges the whole cart, COD', async () => {
    // shilajit is last so checkout stays on this page instead of navigating
    const { w, calls, wa } = bootPage(SHILAJIT, SHILAJIT_APP, {
      cart: MIXED, url: 'https://shop.avnideep.in/shilajit/',
    });

    await openFromCart(w);
    await selectPay(w, 'cod');

    expect(wa.filter((u) => /wa\.me/.test(u)), 'must not route to WhatsApp').toEqual([]);
    expect(w.AVN_CART_STATE.mixed, 'cart is mixed').toBe(true);

    const overlay = w.document.getElementById('orderPopupOverlay');
    expect(overlay.classList.contains('active'), 'order popup is open').toBe(true);

    expect(w.document.getElementById('sTot').textContent).toBe('₹1,715');
    // the customer can see what they are buying
    const lines = w.document.querySelectorAll('.summary .s-row[data-cart-line]');
    expect(lines.length, 'one summary line per cart item').toBe(2);

    await submitOrder(w);
    const order = calls.find((c) => c.url.includes('/api/order') && c.method === 'POST');
    expect(order, 'order must be saved').toBeTruthy();
    expect(order.body.amount).toBe(MIXED_COD);
  });

  it('charges the prepaid total when prepaid is selected', async () => {
    const { w, calls, wa } = bootPage(SHILAJIT, SHILAJIT_APP, {
      cart: MIXED, url: 'https://shop.avnideep.in/shilajit/',
    });
    await openFromCart(w);
    await selectPay(w, 'prepaid');

    expect(w.document.getElementById('sTot').textContent).toBe('₹1,464');

    await submitOrder(w);
    const order = calls.find((c) => c.url.includes('/api/order') && c.method === 'POST');
    expect(order, 'order must be saved').toBeTruthy();
    expect(order.body.amount).toBe(MIXED_PREPAID);
    expect(wa.filter((u) => /wa\.me/.test(u))).toEqual([]);
  });

  it('renders the cart lines as soon as the popup opens, before any radio change', async () => {
    // window.updatePay is whichever copy ran last, and the app bundle's version
    // (which does not know about the cart) can overwrite the inline one. The
    // per-item lines must therefore be painted by openOrderPopup itself.
    const { w, wa } = bootPage(SHILAJIT, SHILAJIT_APP, {
      cart: MIXED, url: 'https://shop.avnideep.in/shilajit/',
    });
    await openFromCart(w);

    expect(wa.filter((u) => /wa\.me/.test(u))).toEqual([]);
    expect(w.document.querySelectorAll('.summary .s-row[data-cart-line]').length).toBe(2);
    expect(w.document.querySelector('.summary .s-row span').textContent).toContain('Your Cart');
  });

  it('the explicit Order-on-WhatsApp button still opens WhatsApp', async () => {
    const { w, wa } = bootPage(SHILAJIT, SHILAJIT_APP, {
      cart: MIXED, url: 'https://shop.avnideep.in/shilajit/',
    });
    const open = w.document.querySelector('[data-cart-open]');
    open.click();
    await settle(200);
    w.document.querySelector('[data-cart-wa]').click();
    await settle(200);
    expect(wa.some((u) => /wa\.me/.test(u)), 'WhatsApp button must still work').toBe(true);
  });

  it('a single-product cart is unchanged: one pack price, no WhatsApp', async () => {
    const { w, calls, wa } = bootPage(SHILAJIT, SHILAJIT_APP, {
      cart: SINGLE, url: 'https://shop.avnideep.in/shilajit/',
    });
    await openFromCart(w);
    await selectPay(w, 'cod');

    expect(wa.filter((u) => /wa\.me/.test(u))).toEqual([]);
    expect(w.AVN_CART_STATE.mixed, 'cart is not mixed').toBe(false);
    expect(w.document.getElementById('sTot').textContent).toBe('₹1,250');
    // no per-item rows for a single product
    expect(w.document.querySelectorAll('.summary .s-row[data-cart-line]').length).toBe(0);

    await submitOrder(w);
    const order = calls.find((c) => c.url.includes('/api/order') && c.method === 'POST');
    expect(order.body.amount).toBe(1250);
  });

  it('a cart that navigated to another PDP (?open=1) still prices from the cart', async () => {
    // checkout() navigates to the last item's page with ?open=1; cart.js
    // rebuilds AVN_CART_STATE from localStorage on load, so the popup there
    // must price the whole cart too.
    const { w, wa } = bootPage(SHILAJIT, SHILAJIT_APP, {
      cart: { shilajit: 1, hair: 1 }, // shilajit last -> lands on this page
      url: 'https://shop.avnideep.in/shilajit/?open=1',
    });
    await settle(1200);
    expect(wa.filter((u) => /wa\.me/.test(u))).toEqual([]);
    expect(w.document.getElementById('orderPopupOverlay').classList.contains('active')).toBe(true);
    await selectPay(w, 'cod');
    expect(w.document.getElementById('sTot').textContent).toBe('₹1,715');
  });
});
