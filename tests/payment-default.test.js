// ============================================================
// PAYMENT SELECTION — three options, admin-driven default
// ------------------------------------------------------------
//   Full COD   = configured COD total
//   Advance    = configured advance TOTAL + the flat booking advance now
//   Prepaid    = configured prepaid total (lowest price)
//
// The admin's default_method decides which card opens selected. It never
// disables the other two enabled cards.
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

function payCfg(over = {}) {
  return {
    ok: true,
    cod_enabled: true,
    advance_enabled: true,
    prepaid_enabled: true,
    default_method: 'advance',
    advance_amount: 100,
    checkout_mode: 'advance',
    ...over,
  };
}

const PAGES = [
  {
    name: 'pain oil', html: 'pain-oil/index.html', app: 'pain-oil/app-oil.v3.js',
    url: 'https://avnideepayurveda.in/pain-oil/',
    mrp: 349, cod: 349, adv: 320, pre: 299, pack: 'oil',
  },
  {
    name: 'shilajit', html: 'shilajit/index.html', app: 'shilajit/app-shilajit.v3.js',
    url: 'https://avnideepayurveda.in/shilajit/',
    mrp: 1250, cod: 1250, adv: 1200, pre: 1000, pack: 'shilajit',
  },
  {
    name: 'hair oil', html: 'hair-oil/index.html', app: 'hair-oil/app-hairoil.v3.js',
    url: 'https://avnideepayurveda.in/hair-oil/',
    mrp: 499, cod: 499, adv: 499, pre: 399, pack: 'hair',
  },
  {
    name: 'herbal balm', html: 'herbal-balm/index.html', app: 'herbal-balm/app-balm.v3.js',
    url: 'https://avnideepayurveda.in/herbal-balm/',
    mrp: 349, cod: 349, adv: 349, pre: 279, pack: 'balm',
  },
];

function bootPage(page, { cfg = payCfg() } = {}) {
  const html = read(page.html).replace(EXT_SCRIPT, '');
  const dom = new JSDOM(html, {
    url: page.url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      if (page.cart) w.localStorage.setItem('avn_cart_v1', JSON.stringify(page.cart));
      w.fetch = (u) => {
        const target = String(u);
        if (target.includes('/api/payment-config')) return json(cfg);
        if (target.includes('/payment-config')) return json({ ok: true, data: { razorpay_enabled: true, key_id: 'rzp_test_x' } });
        if (target.includes('/razorpay/create-order')) return json({ ok: true, data: { id: 'order_TEST', amount: 0, currency: 'INR', key_id: 'rzp_test_x' } });
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
  for (const rel of ['assets/cart.js', page.app]) {
    const s = w.document.createElement('script');
    s.textContent = read(rel);
    w.document.body.appendChild(s);
  }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return w;
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const txt = (w, id) => w.document.getElementById(id).textContent;
const checkedPay = (w) => w.document.querySelector('input[name="paymentMethod"]:checked').value;
const card = (w, pay) => w.document.querySelector(`.pay-card[data-pay-card="${pay}"]`);
const payRadio = (w, value) => w.document.querySelector(`input[name="paymentMethod"][value="${value}"]`);

async function selectPay(w, value) {
  const radio = payRadio(w, value);
  expect(radio, value + ' radio').toBeTruthy();
  radio.checked = true;
  radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  await settle(200);
}

const HOME = {
  name: 'home', html: 'index.html', app: 'app.v3.js',
  url: 'https://avnideepayurveda.in/', cart: { shilajit: 1 },
};

async function openHomeCheckout(w) {
  w.document.querySelector('[data-cart-open]').click();
  await settle(250);
  w.document.querySelector('[data-cart-checkout]').click();
  await settle(500);
}

describe('home cart checkout — three options', () => {
  it('opens on Advance (admin default), with all three cards priced from the catalogue', async () => {
    const w = bootPage(HOME);
    await openHomeCheckout(w);

    expect(checkedPay(w)).toBe('advance');
    expect(txt(w, 'sTot')).toBe(inr(1200));
    expect(card(w, 'cod').querySelector('.pay-amt').textContent).toBe(inr(1250));
    expect(card(w, 'advance').querySelector('.pay-amt').textContent).toBe(inr(1200));
    expect(card(w, 'prepaid').querySelector('.pay-amt').textContent).toBe(inr(1000));
    expect(card(w, 'advance').textContent).toContain('Save ' + inr(50));
    expect(card(w, 'prepaid').textContent).toContain('Save ' + inr(250));
    expect(txt(w, 'oBtn')).toContain(inr(100));
    expect(txt(w, 'oBtn')).toContain(inr(1100));
  });

  it('Full COD has no online charge and shows ₹1,250 due on delivery', async () => {
    const w = bootPage(HOME);
    await openHomeCheckout(w);
    await selectPay(w, 'cod');

    expect(txt(w, 'sTot')).toBe(inr(1250));
    expect(txt(w, 'oBtn')).toContain(inr(1250));
    expect(txt(w, 'oBtn')).not.toContain(inr(100));
  });

  it('Prepaid shows ₹1,000 and no balance due', async () => {
    const w = bootPage(HOME);
    await openHomeCheckout(w);
    await selectPay(w, 'prepaid');

    expect(txt(w, 'sTot')).toBe(inr(1000));
    expect(txt(w, 'oBtn')).toContain(inr(1000));
  });

  it('honours an admin default of Full COD without hiding the other options', async () => {
    const w = bootPage(HOME, { cfg: payCfg({ default_method: 'cod', checkout_mode: 'full_cod' }) });
    await openHomeCheckout(w);

    expect(checkedPay(w)).toBe('cod');
    expect(txt(w, 'sTot')).toBe(inr(1250));
    expect(payRadio(w, 'advance').disabled).toBe(false);
    expect(payRadio(w, 'prepaid').disabled).toBe(false);
  });

  it('a disabled option cannot be selected or submitted', async () => {
    const w = bootPage(HOME, { cfg: payCfg({ advance_enabled: false }) });
    await openHomeCheckout(w);

    expect(payRadio(w, 'advance').disabled).toBe(true);
    expect(card(w, 'advance').style.display).toBe('none');
    expect(checkedPay(w)).not.toBe('advance');
  });
});

describe.each(PAGES)('$name product page — three options', (page) => {
  it('renders the configured prices and opens on the admin default', async () => {
    const w = bootPage(page);
    await settle(500);

    expect(card(w, 'cod').querySelector('.pay-amt').textContent).toBe(inr(page.cod));
    expect(card(w, 'advance').querySelector('.pay-amt').textContent).toBe(inr(page.adv));
    expect(card(w, 'prepaid').querySelector('.pay-amt').textContent).toBe(inr(page.pre));
    expect(checkedPay(w)).toBe('advance');
    expect(txt(w, 'sTot')).toBe(inr(page.adv));
  });

  it('switching between the three options repaints the summary and CTA', async () => {
    const w = bootPage(page);
    await settle(500);

    await selectPay(w, 'cod');
    expect(txt(w, 'sTot')).toBe(inr(page.cod));
    expect(txt(w, 'oBtn')).toContain(inr(page.cod));

    await selectPay(w, 'advance');
    expect(txt(w, 'sTot')).toBe(inr(page.adv));
    expect(txt(w, 'oBtn')).toContain(inr(100));

    await selectPay(w, 'prepaid');
    expect(txt(w, 'sTot')).toBe(inr(page.pre));
    expect(txt(w, 'oBtn')).toContain(inr(page.pre));
  });
});
