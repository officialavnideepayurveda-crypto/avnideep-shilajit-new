// ============================================================
// PAYMENT SELECTION — every product page opens on Prepaid (UPI/Card),
// COD stays one click away at its MRP price, and one selection drives
// every price surface (main price, sticky bar, CTA, checkout summary).
//
//   COD price      = MRP
//   Prepaid price  = Math.round(MRP * 0.8)   (the project's INR rounding)
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const EXT_SCRIPT = /<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g;
const json = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');

// One row per PDP: page key, its own MRPs, and the derived COD / prepaid.
const PAGES = [
  {
    name: 'pain oil',
    html: 'pain-oil/index.html',
    app: 'pain-oil/app-oil.v3.js',
    url: 'https://avnideepayurveda.in/pain-oil/',
    packs: [{ mrp: 349, cod: 349, pre: 279 }, { mrp: 698, cod: 698, pre: 558 }, { mrp: 1047, cod: 1047, pre: 838 }],
  },
  {
    name: 'shilajit',
    html: 'shilajit/index.html',
    app: 'shilajit/app-shilajit.v3.js',
    url: 'https://avnideepayurveda.in/shilajit/',
    packs: [{ mrp: 2500, cod: 2500, pre: 2000 }, { mrp: 5000, cod: 5000, pre: 4000 }, { mrp: 7500, cod: 7500, pre: 6000 }],
  },
  {
    name: 'hair oil',
    html: 'hair-oil/index.html',
    app: 'hair-oil/app-hairoil.v3.js',
    url: 'https://avnideepayurveda.in/hair-oil/',
    packs: [{ mrp: 499, cod: 499, pre: 399 }, { mrp: 998, cod: 998, pre: 798 }, { mrp: 1497, cod: 1497, pre: 1198 }],
  },
  {
    name: 'herbal balm',
    html: 'herbal-balm/index.html',
    app: 'herbal-balm/app-balm.v3.js',
    url: 'https://avnideepayurveda.in/herbal-balm/',
    packs: [{ mrp: 349, cod: 349, pre: 279 }, { mrp: 698, cod: 698, pre: 558 }, { mrp: 1047, cod: 1047, pre: 838 }],
  },
];

function bootPage(page) {
  const html = read(page.html).replace(EXT_SCRIPT, '');
  const dom = new JSDOM(html, {
    url: page.url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      if (page.cart) w.localStorage.setItem('avn_cart_v1', JSON.stringify(page.cart));
      if (page.pref) w.localStorage.setItem('avn_pay_pref', page.pref);
      w.fetch = (u) => {
        const target = String(u);
        if (target.includes('payment-config')) {
          return json({ ok: true, data: { razorpay_enabled: true, key_id: 'rzp_test_x', cod_enabled: true, checkout_mode: 'advance' } });
        }
        if (target.includes('/razorpay/create-order')) {
          return json({ ok: true, data: { id: 'order_TEST', amount: 0, currency: 'INR', key_id: 'rzp_test_x' } });
        }
        return json({ ok: true, data: { order_id: 'AVN-TEST' } });
      };
      w.fbq = () => {}; w.gtag = () => {}; w.dataLayer = [];
      w.scrollTo = () => {};
      w.open = () => null;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
      w.ResizeObserver = class { observe() {} disconnect() {} };
      w.Razorpay = class { on() {} open() {} };
    },
  });
  const w = dom.window;
  // Same order as production: assets/cart.js first (it owns the cart drawer and
  // window.AVN_CART_STATE), then the page's app bundle.
  for (const rel of ['assets/cart.js', page.app]) {
    const s = w.document.createElement('script');
    s.textContent = read(rel);
    w.document.body.appendChild(s);
  }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return w;
}

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const txt = (w, id) => w.document.getElementById(id).textContent;
const checkedPay = (w) => w.document.querySelector('input[name="paymentMethod"]:checked').value;
const selPay = (w) => w.document.querySelector('.ap-pack[data-pay].on').getAttribute('data-pay');
const card = (w, pay) => w.document.querySelector(`.ap-pack[data-pay="${pay}"]`);
const payRadio = (w, value) => w.document.querySelector(`input[name="paymentMethod"][value="${value}"]`);

async function switchInPopup(w, value) {
  const radio = payRadio(w, value);
  expect(radio, value + ' radio').toBeTruthy();
  radio.checked = true;
  radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  await settle(200);
}

// The home page has no pack selector: its checkout popup is fed by the cart and
// by app.v3.js, which used to print hard-coded ₹1,125 / ₹1,250 on the cards.
const HOME = {
  name: 'home',
  html: 'index.html',
  app: 'app.v3.js',
  url: 'https://avnideepayurveda.in/',
  cart: { shilajit: 1 },
};

const cardText = (w) => [...w.document.querySelectorAll('.pay-card')].map((c) => c.textContent.replace(/\s+/g, ' ').trim());

async function openHomeCheckout(w) {
  w.document.querySelector('[data-cart-open]').click();
  await settle(250);
  w.document.querySelector('[data-cart-checkout]').click();
  await settle(500);
}

describe('home cart checkout', () => {
  it('opens on Prepaid ₹2,000 and prints the real card prices, not ₹1,125 / ₹1,250', async () => {
    const w = bootPage(HOME);
    await openHomeCheckout(w);

    expect(checkedPay(w)).toBe('prepaid');
    expect(txt(w, 'sAmt')).toBe(inr(2000));
    expect(txt(w, 'sTot')).toBe(inr(2000));
    const cards = cardText(w);
    expect(cards[0]).toContain(inr(2000));
    expect(cards[0]).toContain(inr(2500));
    expect(cards[0]).toContain('SAVE ' + inr(500));
    expect(cards[0]).not.toContain(inr(1125));
    expect(cards[1]).toContain(inr(2500));
    expect(txt(w, 'oBtn')).toContain(inr(2000));
  });

  it('switching to COD quotes ₹2,500 and is remembered for the next visit', async () => {
    const w = bootPage(HOME);
    await openHomeCheckout(w);
    await switchInPopup(w, 'cod');

    expect(txt(w, 'sTot')).toBe(inr(2500));
    // the COD button books the ₹100 advance and names the ₹2,400 balance
    expect(txt(w, 'oBtn')).toContain(inr(100));
    expect(txt(w, 'oBtn')).toContain(inr(2400));
    expect(w.localStorage.getItem('avn_pay_pref')).toBe('C');
  });

  it('restores a COD choice made on a product page', async () => {
    const w = bootPage({ ...HOME, pref: 'C' });
    await openHomeCheckout(w);

    expect(checkedPay(w)).toBe('cod');
    expect(txt(w, 'sTot')).toBe(inr(2500));
  });
});

describe.each(PAGES)('$name product page', (page) => {
  const first = page.packs[0];

  it('opens on Prepaid: ₹' + first.pre + ' primary, ₹' + first.cod + ' COD still offered', async () => {
    const w = bootPage(page);
    await settle(300);

    // Prepaid is selected before the customer touches anything…
    expect(selPay(w)).toBe('P');
    expect(checkedPay(w)).toBe('prepaid');
    expect(card(w, 'P').classList.contains('on')).toBe(true);
    expect(card(w, 'C').classList.contains('on')).toBe(false);

    // …and it is the price shown everywhere on the page.
    expect(w.document.querySelector('.ap-price b').textContent).toBe(inr(first.pre));
    expect(w.document.querySelector('.ap-price s').textContent).toBe(inr(first.cod));
    expect(w.document.querySelector('.ap-price .off').textContent).toBe('20% OFF');
    expect(w.document.querySelector('.ap-sub').textContent).toContain('COD ' + inr(first.cod));
    expect(w.document.querySelector('.ap-sub').textContent).toContain('Prepaid ' + inr(first.pre));
    expect(w.document.querySelector('.rx-cta').textContent).toBe('Order ' + inr(first.pre));
    expect(w.document.querySelector('#sticky .si .p').textContent).toContain(inr(first.pre));
    expect(txt(w, 'sAmt')).toBe(inr(first.pre));
    expect(txt(w, 'sTot')).toBe(inr(first.pre));

    // COD is visible and priced at MRP, never hidden or discounted.
    expect(card(w, 'C')).toBeTruthy();
    expect(w.document.querySelector('.pay-card:not(.recommended) .pay-top > b').textContent).toBe(inr(first.cod));
  });

  it('switching to COD repaints every surface with ₹' + first.cod + ', and back to ₹' + first.pre, async () => {
    const w = bootPage(page);
    await settle(300);

    card(w, 'C').click();
    await settle(150);
    expect(selPay(w)).toBe('C');
    expect(checkedPay(w)).toBe('cod');
    expect(w.document.querySelector('.ap-price b').textContent).toBe(inr(first.cod));
    expect(w.document.querySelector('.ap-price s')).toBeNull(); // COD is the MRP: no fake strike-through
    expect(w.document.querySelector('.ap-price .off').textContent).toBe('COD');
    expect(w.document.querySelector('.rx-cta').textContent).toBe('Order ' + inr(first.cod));
    expect(w.document.querySelector('#sticky .si .p').textContent.trim()).toBe(inr(first.cod));
    expect(txt(w, 'sAmt')).toBe(inr(first.cod));
    expect(txt(w, 'sTot')).toBe(inr(first.cod));
    expect(txt(w, 'oBtn')).toContain(inr(first.cod));
    expect(w.localStorage.getItem('avn_pay_pref')).toBe('C');

    card(w, 'P').click();
    await settle(150);
    expect(selPay(w)).toBe('P');
    expect(w.document.querySelector('.ap-price b').textContent).toBe(inr(first.pre));
    expect(w.document.querySelector('.ap-price s').textContent).toBe(inr(first.cod));
    expect(txt(w, 'sTot')).toBe(inr(first.pre));
  });

  it('each pack uses its own MRP: prepaid is 20% off, COD equals MRP', async () => {
    const w = bootPage(page);
    await settle(300);

    for (let i = 0; i < page.packs.length; i += 1) {
      card(w, 'P').click();
      await settle(120);
      const pack = page.packs[i];
      w.document.querySelector(`#apSize .ap-size[data-pack="${i}"]`).click();
      await settle(150);

      expect(w.document.querySelector('.ap-price b').textContent).toBe(inr(pack.pre));
      expect(w.document.querySelector('.ap-price s').textContent).toBe(inr(pack.mrp));
      expect(txt(w, 'sAmt')).toBe(inr(pack.pre));

      card(w, 'C').click();
      await settle(120);
      expect(w.document.querySelector('.ap-price b').textContent).toBe(inr(pack.cod));
      expect(txt(w, 'sTot')).toBe(inr(pack.cod));
    }
  });

  it('a change made inside the checkout popup repaints the page and persists', async () => {
    const w = bootPage(page);
    await settle(300);

    w.openOrderPopup();
    await settle(250);
    expect(checkedPay(w)).toBe('prepaid');
    expect(txt(w, 'sTot')).toBe(inr(first.pre));
    expect(txt(w, 'oBtn')).toContain(inr(first.pre));

    await switchInPopup(w, 'cod');
    expect(selPay(w)).toBe('C');
    expect(w.localStorage.getItem('avn_pay_pref')).toBe('C');
    expect(w.document.querySelector('.ap-price b').textContent).toBe(inr(first.cod));
    expect(txt(w, 'sTot')).toBe(inr(first.cod));

    // reopening keeps COD instead of silently snapping back to Prepaid
    w.openOrderPopup();
    await settle(250);
    expect(checkedPay(w)).toBe('cod');
    expect(txt(w, 'sTot')).toBe(inr(first.cod));
  });
});
