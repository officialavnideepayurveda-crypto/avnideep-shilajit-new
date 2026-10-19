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
  { mrp: 349, cod: 349, pre: 279 },  // Single
  { mrp: 698, cod: 698, pre: 558 },  // Pack of 2
  { mrp: 1047, cod: 1047, pre: 838 } // Pack of 3
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
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: { razorpay_enabled: true, key_id: 'rzp_test_x', cod_enabled: true, checkout_mode: 'advance' } }) });
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

describe('Pain Oil pricing: COD = MRP, prepaid = MRP - 20%', () => {
  it('Single Pack: MRP ₹349, COD ₹349, prepaid ₹279 (20% off, rounded)', () => {
    const { w } = bootPage();
    const single = w.AVN_CHECKOUT.pack('oil', 0);
    expect(single.mrp).toBe(349);
    expect(single.cod).toBe(349);
    expect(single.pre).toBe(279);
    // 349 * 0.8 = 279.20 → the project's Math.round gives 279, applied once
    expect(pricesFromMrp(349)).toEqual({ mrp: 349, cod: 349, prepaid: 279 });
    expect(w.AVN_CHECKOUT.fromMrp(349).prepaid).toBe(279);
  });

  it('Pack 2 and Pack 3 use their own configured MRP (698 / 1047)', () => {
    const { w } = bootPage();
    expect(w.AVN_CHECKOUT.pack('oil', 1)).toMatchObject({ mrp: 698, cod: 698, pre: 558 });
    expect(w.AVN_CHECKOUT.pack('oil', 2)).toMatchObject({ mrp: 1047, cod: 1047, pre: 838 });
    PACKS.forEach((p, i) => expect(w.AVN_CHECKOUT.pack('oil', i)).toMatchObject(p));
  });

  it('the PDP opens on Prepaid: header, selector, cards and summary quote ₹279 (COD ₹349)', async () => {
    const { w } = bootPage();
    await settle(300);
    // Prepaid (UPI/Card) is selected before the customer touches anything
    expect(w.document.querySelector('.ap-pack[data-pay].on').getAttribute('data-pay')).toBe('P');
    expect(w.document.querySelector('input[name="paymentMethod"]:checked').value).toBe('prepaid');
    // primary price = 20% off ₹349 = ₹279, MRP struck through
    expect(w.document.querySelector('.ap-price b').textContent).toBe('₹279');
    expect(w.document.querySelector('.ap-price s').textContent).toBe('₹349');
    expect(w.document.querySelector('.ap-price .off').textContent).toBe('20% OFF');
    expect(w.document.querySelector('.rx-cta').textContent).toBe('Order ₹279');
    expect(w.document.querySelector('#sticky .si .p').textContent).toContain('₹279');
    expect(w.document.querySelector('.ap-sub').textContent).toContain('COD ₹349');
    expect(w.document.querySelector('.ap-sub').textContent).toContain('Prepaid ₹279');
    // the pack selector still labels packs by MRP, not by the stale 499
    expect(w.document.querySelector('#apSize .ap-size.on .ap-size-bar').textContent).toBe('₹349');
    const bars = [...w.document.querySelectorAll('#apSize .ap-size-bar')].map((b) => b.textContent.trim());
    expect(bars).toEqual(['₹349', '₹698', '₹1,047']);
    // payment cards: prepaid ₹279 (strike ₹349), COD still visible at ₹349
    expect(w.document.querySelector('.pay-card.recommended .pay-prices b').textContent).toBe('₹279');
    expect(w.document.querySelector('.pay-card.recommended .pay-prices small').textContent).toBe('₹349');
    expect(w.document.querySelector('.pay-grid .pay-card:not(.recommended) .pay-top > b').textContent).toBe('₹349');
    // checkout summary defaults to the same prepaid figure
    expect(txt(w, 'sAmt')).toBe('₹279');
    expect(txt(w, 'sTot')).toBe('₹279');

    // opening the checkout keeps that selection (no form.reset() snap-back)
    w.openOrderPopup();
    await settle(200);
    expect(w.document.querySelector('input[name="paymentMethod"]:checked').value).toBe('prepaid');
    expect(txt(w, 'sTot')).toBe('₹279');
    expect(txt(w, 'oBtn')).toContain('₹279');
  });

  it('switching to COD repaints every surface with ₹349, and back to ₹279', async () => {
    const { w } = bootPage();
    await settle(300);

    w.document.querySelector('.ap-pack[data-pay="C"]').click();
    await settle(150);
    expect(w.document.querySelector('.ap-pack[data-pay="C"]').classList.contains('on')).toBe(true);
    expect(w.document.querySelector('input[name="paymentMethod"]:checked').value).toBe('cod');
    expect(w.document.querySelector('.ap-price b').textContent).toBe('₹349');
    expect(w.document.querySelector('.ap-price s')).toBeNull();
    expect(w.document.querySelector('.ap-price .off').textContent).toBe('COD');
    expect(w.document.querySelector('.rx-cta').textContent).toBe('Order ₹349');
    expect(w.document.querySelector('#sticky .si .p').textContent.trim()).toBe('₹349');
    expect(txt(w, 'sAmt')).toBe('₹349');
    expect(txt(w, 'sTot')).toBe('₹349');
    expect(txt(w, 'oBtn')).toContain('₹349');

    w.document.querySelector('.ap-pack[data-pay="P"]').click();
    await settle(150);
    expect(w.document.querySelector('.ap-price b').textContent).toBe('₹279');
    expect(w.document.querySelector('.ap-price s').textContent).toBe('₹349');
    expect(txt(w, 'sTot')).toBe('₹279');
  });

  it('single-pack checkout at default (Prepaid): total ₹279, no advance row, order saved 279', async () => {
    const { w, calls } = bootPage({ cart: { oil: 1 } });
    await openFromCart(w);
    expect(w.document.querySelector('input[name="paymentMethod"]:checked').value).toBe('prepaid');
    expect(txt(w, 'sTot')).toBe('₹279');
    expect(advanceRows(w).length).toBe(0);

    const { order, rzp } = await submit(w, calls);
    expect(order.body.amount).toBe(279);
    expect(rzp.body.amount).toBe(279);
  });

  it('single-pack COD checkout: total ₹349, ₹100 advance + ₹249 balance, order saved 349', async () => {
    const { w, calls } = bootPage({ cart: { oil: 1 } });
    await openFromCart(w);
    await selectPay(w, 'cod');

    expect(txt(w, 'sAmt')).toBe('₹349');
    expect(txt(w, 'sTot')).toBe('₹349');
    const adv = advanceRows(w);
    expect(adv.some((t) => t.includes('₹100'))).toBe(true);
    expect(adv.some((t) => t.includes('₹249'))).toBe(true);
    expect(adv.some((t) => t.includes('₹598'))).toBe(false);

    const { order, rzp } = await submit(w, calls);
    expect(order, 'order must be saved').toBeTruthy();
    expect(order.body.amount).toBe(349);
    // only the ₹100 advance goes through the gateway; it is not added twice
    expect(rzp.body.amount).toBe(100);
  });

  it('single-pack prepaid checkout: total ₹279, discount applied exactly once', async () => {
    const { w, calls } = bootPage({ cart: { oil: 1 } });
    await openFromCart(w);
    await selectPay(w, 'prepaid');

    expect(txt(w, 'sTot')).toBe('₹279');
    expect(advanceRows(w).length).toBe(0);
    // savings vs MRP = 349 - 279 = ₹70 (the same 20%, never counted twice)
    expect(txt(w, 'sSaveAmt')).toBe('₹70');
    const svBox = w.document.querySelector('.s-savings');
    expect(svBox.style.display).not.toBe('none');

    const { order, rzp } = await submit(w, calls);
    expect(order.body.amount).toBe(279);
    expect(rzp.body.amount).toBe(279);
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

    const adv = advanceRows(w);
    expect(adv.some((t) => t.includes('₹100'))).toBe(true);
    expect(adv.some((t) => t.includes('₹947'))).toBe(true);

    await selectPay(w, 'prepaid');
    expect(txt(w, 'sTot')).toBe('₹837');      // 279 + 558
    expect(w.document.getElementById('sSave').textContent).toContain('₹210'); // 1047 - 837
    expect(txt(w, 'sSaveAmt')).toBe('₹210');  // 1047 - 837 (the same 20%)

    const { order } = await submit(w, calls);
    expect(order.body.amount).toBe(837);
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
    expect(read('pain-oil/app-oil.v3.js')).toContain('{mrp:349,sku:');
    expect(read('functions/api/order.js')).toContain('oil:      [349, 698, 1047]');
  });
});
