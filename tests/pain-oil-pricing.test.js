// ============================================================
// PAIN OIL PRICING — the product config is the source of truth.
//
//   Avnideep Pain Oil 60ml MRPs (PDP pack selector): 349 / 698 / 1047
//   COD price      = MRP            → 349 / 698 / 1047
//   Prepaid price  = MRP - 20%      → 279 / 558 / 838  (Math.round, the
//                                     project's existing INR rounding)
//
// Regression: a stale admin seed carried oil MRP 499/998/1497, and with
// COD = MRP that made the PDP, cart, summary and order API quote ₹499 for
// the Single Pack instead of its configured ₹349.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { pricesFromMrp } from '../functions/api/_lib/pricing.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const EXT_SCRIPT = /<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g;

// Configured pack MRPs from the Pain Oil PDP pack selector.
const PACKS = [
  // Single pack carries the configured advance TOTAL ₹320 and prepaid ₹299.
  { mrp: 349, cod: 349, adv: 320, pre: 299 },
  { mrp: 698, cod: 698, adv: 698, pre: 558 },
  { mrp: 1047, cod: 1047, adv: 1047, pre: 838 }
];

function bootPage({ cart } = {}) {
  const calls = [];
  const wa = [];
  const html = read('pain-oil/index.html').replace(EXT_SCRIPT, '');
  const dom = new JSDOM(html, {
    url: 'https://avnideepayurveda.in/pain-oil/',
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
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: { razorpay_enabled: true, key_id: 'rzp_test_x', cod_enabled: true, default_method: 'prepaid', checkout_mode: 'prepaid' } }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: { order_id: 'AVN-TEST' } }) });
      };
      w.open = (u) => { wa.push(String(u)); return null; };
      w.fbq = () => {}; w.gtag = () => {}; w.dataLayer = [];
      w.scrollTo = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
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
  inject('pain-oil/app-oil.v3.js');
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return { w, calls, wa };
}

const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const txt = (w, id) => w.document.getElementById(id).textContent;
const lineTexts = (w) => [...w.document.querySelectorAll('.summary .s-row[data-cart-line]')].map((r) => r.textContent);
const advanceRows = (w) => [...w.document.querySelectorAll('.summary .s-row[data-adv-row]')].map((r) => r.textContent);

async function openFromCart(w) {
  w.document.querySelector('[data-cart-open]').click();
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

async function submit(w, calls) {
  const fill = (id, v) => { w.document.getElementById(id).value = v; };
  fill('cName', 'Test Buyer');
  fill('tcPhoneInput', '9876543210');
  fill('cAddress', '12 Test Street');
  fill('cPincode', '110001');
  fill('cCity', 'Delhi');
  w.document.getElementById('oForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  return {
    order: calls.find((c) => c.url.includes('/api/order') && c.method === 'POST'),
    rzp: calls.find((c) => c.url.includes('/razorpay/create-order')),
  };
}

describe('Pain Oil pricing: COD ₹349 / advance ₹320 / prepaid ₹299', () => {
  it('Single Pack: MRP ₹349, COD ₹349, advance TOTAL ₹320, prepaid ₹299', () => {
    const { w } = bootPage();
    const single = w.AVN_CHECKOUT.pack('oil', 0);
    expect(single.mrp).toBe(349);
    expect(single.cod).toBe(349);
    expect(single.adv).toBe(320);
    expect(single.pre).toBe(299);
    // The default rule still derives MRP - 20% when no admin override exists.
    expect(pricesFromMrp(349)).toEqual({ mrp: 349, cod: 349, prepaid: 279, advance: 349 });
    expect(w.AVN_CHECKOUT.fromMrp(349).prepaid).toBe(279);
  });

  it('Pack 2 and Pack 3 use their own configured MRP (698 / 1047)', () => {
    const { w } = bootPage();
    expect(w.AVN_CHECKOUT.pack('oil', 1)).toMatchObject({ mrp: 698, cod: 698, pre: 558 });
    expect(w.AVN_CHECKOUT.pack('oil', 2)).toMatchObject({ mrp: 1047, cod: 1047, pre: 838 });
    PACKS.forEach((p, i) => expect(w.AVN_CHECKOUT.pack('oil', i)).toMatchObject(p));
  });

  it('the PDP and checkout both open on Prepaid ₹299', async () => {
    const { w } = bootPage();
    await settle(300);
    // The top selector is a price preview (Prepaid by default).
    expect(w.document.querySelector('.ap-pack[data-pay].on').getAttribute('data-pay')).toBe('P');
    expect(w.document.querySelector('.ap-price b').textContent).toBe('₹299');
    expect(w.document.querySelector('.ap-price s').textContent).toBe('₹349');
    expect(w.document.querySelector('.ap-sub').textContent).toContain('Prepaid ₹299');
    // The checkout opens on the prepaid default: ₹299, nothing due on delivery.
    expect(w.document.querySelector('input[name="paymentMethod"]:checked').value).toBe('prepaid');
    expect(w.document.querySelector('.pay-card[data-pay-card="cod"] .pay-amt').textContent).toBe('₹349');
    expect(w.document.querySelector('.pay-card[data-pay-card="advance"] .pay-amt').textContent).toBe('₹320');
    expect(w.document.querySelector('.pay-card[data-pay-card="prepaid"] .pay-amt').textContent).toBe('₹299');
    expect(txt(w, 'sTot')).toBe('₹299');
    expect(txt(w, 'oBtn')).toContain('₹299');
  });

  it('the three checkout options repaint the summary and split (COD 349 / advance 320 / prepaid 299)', async () => {
    const { w } = bootPage();
    await settle(300);

    await selectPay(w, 'cod');
    expect(w.document.querySelector('input[name="paymentMethod"]:checked').value).toBe('cod');
    expect(txt(w, 'sAmt')).toBe('₹349');
    expect(txt(w, 'sTot')).toBe('₹349');
    expect(advanceRows(w).length).toBe(1); // one "Pay on delivery" row
    expect(txt(w, 'oBtn')).toContain('₹349');

    await selectPay(w, 'advance');
    expect(txt(w, 'sTot')).toBe('₹320');
    const adv = advanceRows(w);
    expect(adv.some((t) => t.includes('₹100'))).toBe(true);
    expect(adv.some((t) => t.includes('₹220'))).toBe(true);
    expect(txt(w, 'oBtn')).toContain('₹100');

    await selectPay(w, 'prepaid');
    expect(txt(w, 'sTot')).toBe('₹299');
    expect(advanceRows(w).length).toBe(0);
    expect(txt(w, 'oBtn')).toContain('₹299');
  });

  it('single-pack default (Prepaid): total ₹299, full ₹299 online, order saved 299', async () => {
    const { w, calls } = bootPage({ cart: { oil: 1 } });
    await openFromCart(w);
    expect(w.document.querySelector('input[name="paymentMethod"]:checked').value).toBe('prepaid');
    expect(txt(w, 'sTot')).toBe('₹299');
    expect(advanceRows(w).length).toBe(0);

    const { order, rzp } = await submit(w, calls);
    expect(order, 'order must be saved').toBeTruthy();
    expect(order.body.amount).toBe(299);
    expect(rzp.body.amount).toBe(299);
  });

  it('single-pack Full COD: total ₹349, NO online charge, ₹349 due on delivery', async () => {
    const { w, calls } = bootPage({ cart: { oil: 1 } });
    await openFromCart(w);
    await selectPay(w, 'cod');

    expect(txt(w, 'sAmt')).toBe('₹349');
    expect(txt(w, 'sTot')).toBe('₹349');
    const adv = advanceRows(w);
    expect(adv.length).toBe(1);
    expect(adv[0]).toContain('₹349');
    expect(adv.some((t) => t.includes('₹100'))).toBe(false);

    const { order, rzp } = await submit(w, calls);
    expect(order, 'order must be saved').toBeTruthy();
    expect(order.body.amount).toBe(349);
    // Full COD starts no gateway payment at all.
    expect(rzp).toBeUndefined();
  });

  it('single-pack prepaid checkout: total ₹299, discount applied exactly once', async () => {
    const { w, calls } = bootPage({ cart: { oil: 1 } });
    await openFromCart(w);
    await selectPay(w, 'prepaid');

    expect(txt(w, 'sTot')).toBe('₹299');
    expect(advanceRows(w).length).toBe(0);
    // savings vs MRP = 349 - 299 = ₹50 (never counted twice)
    expect(txt(w, 'sSaveAmt')).toBe('₹50');
    const svBox = w.document.querySelector('.s-savings');
    expect(svBox.style.display).not.toBe('none');

    const { order, rzp } = await submit(w, calls);
    expect(order.body.amount).toBe(299);
    expect(rzp.body.amount).toBe(299);
  });

  it('COD savings block is hidden (COD is priced at MRP, no phantom discount)', async () => {
    const { w } = bootPage({ cart: { oil: 1 } });
    await openFromCart(w);
    await selectPay(w, 'cod');
    expect(txt(w, 'sSaveAmt')).toBe('₹0');
    expect(w.document.querySelector('.s-savings').style.display).toBe('none');
  });

  it('quantity 2 multiplies the unit price: cart and order total = ₹698', async () => {
    const { w, calls } = bootPage({ cart: { oil: 2 } });
    await openFromCart(w);
    await selectPay(w, 'cod');

    expect(w.AVN_CART_STATE.codTotal).toBe(698);
    expect(txt(w, 'sAmt')).toBe('₹698');
    expect(txt(w, 'sTot')).toBe('₹698');

    const { order } = await submit(w, calls);
    expect(order.body.amount).toBe(698);
    expect(order.body.items).toEqual([{ id: 'oil', family: 'oil', pack: 1, qty: 2 }]);
  });

  it('cart with Single + Pack of 2: each line shows its own price, never the grand total', async () => {
    const { w, calls } = bootPage({ cart: { oil: 1, oil2: 1 } });
    await openFromCart(w);
    await selectPay(w, 'cod');

    // two packs of one family are still two independently priced lines
    expect(w.AVN_CHECKOUT.model({ method: 'cod' }).mixed).toBe(true);
    expect(txt(w, 'sAmt')).toBe('₹1,047');   // 349 + 698
    expect(txt(w, 'sTot')).toBe('₹1,047');
    const lines = lineTexts(w);
    expect(lines.length).toBe(2);
    expect(lines.some((t) => t.includes('₹349'))).toBe(true);
    expect(lines.some((t) => t.includes('₹698'))).toBe(true);
    expect(lines.some((t) => t.includes('₹1,047'))).toBe(false); // grand total ≠ a line

    // Full COD has no split row, so switch to advance for the ₹100 split.
    await selectPay(w, 'advance');
    expect(txt(w, 'sTot')).toBe('₹1,018');    // 320 + 698
    const adv = advanceRows(w);
    expect(adv.some((t) => t.includes('₹100'))).toBe(true);
    expect(adv.some((t) => t.includes('₹918'))).toBe(true);

    await selectPay(w, 'prepaid');
    expect(txt(w, 'sTot')).toBe('₹857');      // 299 + 558
    expect(w.document.getElementById('sSave').textContent).toContain('₹190'); // 1047 - 857
    expect(txt(w, 'sSaveAmt')).toBe('₹190');

    const { order } = await submit(w, calls);
    expect(order.body.amount).toBe(857);
    expect(order.body.items.length).toBe(2);
  });

  it('the checkout API payload carries the itemised cart, not a client grand total', async () => {
    const { w, calls } = bootPage({ cart: { oil: 1, oil3: 1 } });
    await openFromCart(w);
    await selectPay(w, 'cod');
    expect(txt(w, 'sAmt')).toBe('₹1,396');    // 349 + 1047

    const { order } = await submit(w, calls);
    expect(order.body.amount).toBe(1396);
    expect(order.body.items).toEqual([
      { id: 'oil', family: 'oil', pack: 1, qty: 1 },
      { id: 'oil3', family: 'oil', pack: 3, qty: 1 },
    ]);
  });

  it('no stale ₹499 oil price is left anywhere in the checkout source', () => {
    const files = [
      'assets/cart.js', 'assets/site-sync.js', 'pain-oil/index.html',
      'pain-oil/app-oil.v3.js', 'functions/api/order.js', 'index.html',
    ];
    for (const f of files) {
      const src = read(f);
      // no oil row may still carry the stale seeded MRPs 499 / 998 / 1497
      expect(src, `${f} still quotes the stale oil MRP`).not.toMatch(/(id:?'oil'|oil:\s*)[^\n]*mrp[:=]\s*(499|998|1497)\b/);
      expect(src, `${f} still has the stale seeded oil MRP`).not.toMatch(/\b(499|998|1497)\b[^\n]*AVN-OIL/);
    }
    // configured MRPs are present
    expect(read('pain-oil/index.html')).toContain("mrp:349");
    expect(read('pain-oil/app-oil.v3.js')).toContain("{mrp:349,explicit:{advance:320,prepaid:299}");
    expect(read('functions/api/order.js')).toContain('oil:      [349, 698, 1047]');
  });
});
