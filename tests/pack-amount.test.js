import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

// tests/ -> project root
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const EXT_SCRIPT = /<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g;
const json = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });

// Boot a real product page in jsdom with its OWN inline scripts executing —
// exactly what production runs. External <script src> is stripped (nothing is
// fetched from the network) and third-party APIs are stubbed. Passing `app`
// appends the app bundle afterwards, mirroring the live load order
// (inline first, app bundle last).
//
// Every fetch the page makes is recorded in `calls` so tests can assert the
// money that actually reaches /api/order and Razorpay's create-order.
function bootPage(htmlRel, url, { app = false, appRel = null } = {}) {
  const calls = [];
  const html = read(htmlRel).replace(EXT_SCRIPT, '');
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (u, o) => {
        const target = String(u);
        let body = null;
        if (o && o.body) { try { body = JSON.parse(o.body); } catch (e) { body = o.body; } }
        calls.push({ url: target, method: (o && o.method) || 'GET', body });
        if (target.includes('/razorpay/create-order')) {
          return json({ ok: true, data: { id: 'order_TEST', amount: (body && body.amount) || 0, currency: 'INR', key_id: 'rzp_test_x' } });
        }
        if (target.includes('payment-config')) {
          return json({ ok: true, data: { razorpay_enabled: true, key_id: 'rzp_test_x', cod_enabled: true, checkout_mode: 'advance' } });
        }
        if (target.includes('/razorpay/verify')) return json({ ok: true, data: { verified: true } });
        return json({ ok: true, data: { order_id: 'AVN-TEST' } });
      };
      w.fbq = function () {};
      w.gtag = function () {};
      w.dataLayer = [];
      w.scrollTo = () => {};
      w.open = () => null;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.Razorpay = class { on() {} open() {} };
    },
  });
  const w = dom.window;
  if (app) {
    const s = w.document.createElement('script');
    s.textContent = read(appRel);
    w.document.body.appendChild(s);
    // the app bundle waits for DOMContentLoaded; the document is already parsed
    w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  }
  return { w, calls };
}

const setPack = (w, page, i) => w.localStorage.setItem('avn_pack', JSON.stringify({ page, i }));
const txt = (w, id) => w.document.getElementById(id).textContent;
const summary = (w) => w.document.querySelector('.summary .s-row span').textContent;
const fill = (w, id, v) => { const el = w.document.getElementById(id); expect(el, 'field #' + id).toBeTruthy(); el.value = v; };

function openCheckout(w, { prepaid = false } = {}) {
  w.openOrderPopup();
  if (prepaid) {
    const radio = w.document.querySelector('input[name="paymentMethod"][value="prepaid"]');
    expect(radio, 'prepaid radio').toBeTruthy();
    radio.checked = true;
    radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  }
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

describe('payment step shows AND charges the pack the customer selected', () => {
  it('shilajit: opening checkout shows pack 1 / 2 / 3 amounts, prepaid and COD', () => {
    const { w } = bootPage('shilajit/index.html', 'https://avnideepayurveda.in/shilajit/');

    setPack(w, 'shilajit', 0); openCheckout(w, { prepaid: true });
    expect(txt(w, 'sAmt')).toBe('₹999');
    expect(txt(w, 'sTot')).toBe('₹999');
    expect(txt(w, 'oBtn')).toContain('₹999');

    setPack(w, 'shilajit', 1); openCheckout(w, { prepaid: true });
    expect(txt(w, 'sAmt')).toBe('₹1,899');
    expect(txt(w, 'oBtn')).toContain('₹1,899');
    expect(summary(w)).toContain('(Pack of 2)');

    setPack(w, 'shilajit', 2); openCheckout(w, { prepaid: true });
    expect(txt(w, 'sAmt')).toBe('₹2,699');
    expect(txt(w, 'sTot')).toBe('₹2,699');
    expect(txt(w, 'oBtn')).toContain('₹2,699');
    expect(summary(w)).toContain('(Pack of 3)');

    // COD prices from the same pack
    setPack(w, 'shilajit', 2); openCheckout(w);
    expect(txt(w, 'sAmt')).toBe('₹3,350');
    expect(txt(w, 'oBtn')).toContain('₹3,350');
  });

  it('pain oil: opening checkout shows pack 2 / 3 amounts', () => {
    const { w } = bootPage('pain-oil/index.html', 'https://avnideepayurveda.in/pain-oil/');

    setPack(w, 'oil', 0); openCheckout(w, { prepaid: true });
    expect(txt(w, 'sAmt')).toBe('₹199');

    setPack(w, 'oil', 1); openCheckout(w, { prepaid: true });
    expect(txt(w, 'sAmt')).toBe('₹359');
    expect(txt(w, 'oBtn')).toContain('₹359');
    expect(summary(w)).toContain('(Pack of 2)');

    setPack(w, 'oil', 2); openCheckout(w);
    expect(txt(w, 'sAmt')).toBe('₹649');
    expect(summary(w)).toContain('(Pack of 3)');
  });

  it('hair oil: opening checkout shows pack 1 / 2 / 3 amounts, prepaid and COD', () => {
    const { w } = bootPage('hair-oil/index.html', 'https://avnideepayurveda.in/hair-oil/');

    setPack(w, 'hair', 0); openCheckout(w, { prepaid: true });
    expect(txt(w, 'sAmt')).toBe('₹465');
    expect(txt(w, 'sTot')).toBe('₹465');
    expect(txt(w, 'oBtn')).toContain('₹465');

    setPack(w, 'hair', 1); openCheckout(w, { prepaid: true });
    expect(txt(w, 'sAmt')).toBe('₹899');
    expect(txt(w, 'oBtn')).toContain('₹899');
    expect(summary(w)).toContain('(Pack of 2)');

    setPack(w, 'hair', 2); openCheckout(w);
    expect(txt(w, 'sAmt')).toBe('₹1,299');
    expect(txt(w, 'oBtn')).toContain('₹1,299');
    expect(summary(w)).toContain('(Pack of 3)');
  });

  it('herbal balm: opening checkout shows pack 1 / 2 / 3 amounts, prepaid and COD', () => {
    const { w } = bootPage('herbal-balm/index.html', 'https://avnideepayurveda.in/herbal-balm/');

    setPack(w, 'balm', 0); openCheckout(w, { prepaid: true });
    expect(txt(w, 'sAmt')).toBe('₹299');
    expect(txt(w, 'sTot')).toBe('₹299');
    expect(txt(w, 'oBtn')).toContain('₹299');

    setPack(w, 'balm', 1); openCheckout(w);
    expect(txt(w, 'sAmt')).toBe('₹549');
    expect(summary(w)).toContain('(Pack of 2)');

    setPack(w, 'balm', 2); openCheckout(w, { prepaid: true });
    expect(txt(w, 'sAmt')).toBe('₹799');
    expect(txt(w, 'oBtn')).toContain('₹799');
    expect(summary(w)).toContain('(Pack of 3)');
  });

  it('hair oil prepaid Pack of 2: the money sent to /api/order AND Razorpay is 899', async () => {
    const { w, calls } = bootPage('hair-oil/index.html', 'https://avnideepayurveda.in/hair-oil/', {
      app: true, appRel: 'hair-oil/app-hairoil.v3.js',
    });
    setPack(w, 'hair', 1);
    openCheckout(w, { prepaid: true });

    fill(w, 'cName', 'Test Buyer');
    fill(w, 'tcPhoneInput', '9876543210');
    fill(w, 'cAddress', '12 Test Street');
    fill(w, 'cPincode', '110001');
    fill(w, 'cCity', 'Delhi');
    w.document.getElementById('oForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const order = calls.find((c) => c.url.includes('/api/order') && c.method === 'POST');
    expect(order, 'order must be saved').toBeTruthy();
    expect(order.body.amount).toBe(899);
    expect(String(order.body.product)).toContain('(Pack of 2)');

    const rzp = calls.find((c) => c.url.includes('/razorpay/create-order'));
    expect(rzp, 'razorpay order must be created').toBeTruthy();
    expect(rzp.body.amount).toBe(899);
  });

  it('herbal balm prepaid Pack of 3: order + Razorpay carry 799', async () => {
    const { w, calls } = bootPage('herbal-balm/index.html', 'https://avnideepayurveda.in/herbal-balm/', {
      app: true, appRel: 'herbal-balm/app-balm.v3.js',
    });
    setPack(w, 'balm', 2);
    openCheckout(w, { prepaid: true });

    fill(w, 'cName', 'Test Buyer');
    fill(w, 'tcPhoneInput', '9876543210');
    fill(w, 'cAddress', '12 Test Street');
    fill(w, 'cPincode', '110001');
    fill(w, 'cCity', 'Delhi');
    w.document.getElementById('oForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const order = calls.find((c) => c.url.includes('/api/order') && c.method === 'POST');
    expect(order, 'order must be saved').toBeTruthy();
    expect(order.body.amount).toBe(799);
    expect(String(order.body.product)).toContain('(Pack of 3)');

    const rzp = calls.find((c) => c.url.includes('/razorpay/create-order'));
    expect(rzp, 'razorpay order must be created').toBeTruthy();
    expect(rzp.body.amount).toBe(799);
  });

  it('shilajit prepaid Pack of 3: the money sent to /api/order AND Razorpay is 2699', async () => {
    const { w, calls } = bootPage('shilajit/index.html', 'https://avnideepayurveda.in/shilajit/', {
      app: true, appRel: 'shilajit/app-shilajit.v3.js',
    });
    setPack(w, 'shilajit', 2);
    openCheckout(w, { prepaid: true });

    fill(w, 'cName', 'Test Buyer');
    fill(w, 'tcPhoneInput', '9876543210');
    fill(w, 'cAddress', '12 Test Street');
    fill(w, 'cPincode', '110001');
    fill(w, 'cCity', 'Delhi');
    w.document.getElementById('oForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const order = calls.find((c) => c.url.includes('/api/order') && c.method === 'POST');
    expect(order, 'order must be saved').toBeTruthy();
    expect(order.body.amount).toBe(2699);
    expect(String(order.body.product)).toContain('(Pack of 3)');
    expect(order.body.phone).toBe('9876543210');

    const rzp = calls.find((c) => c.url.includes('/razorpay/create-order'));
    expect(rzp, 'razorpay order must be created').toBeTruthy();
    expect(rzp.body.amount).toBe(2699);
  });

  it('shilajit prepaid Pack of 1 still charges 999 (no global overwrite)', async () => {
    const { w, calls } = bootPage('shilajit/index.html', 'https://avnideepayurveda.in/shilajit/', {
      app: true, appRel: 'shilajit/app-shilajit.v3.js',
    });
    setPack(w, 'shilajit', 0);
    openCheckout(w, { prepaid: true });
    fill(w, 'cName', 'Test Buyer');
    fill(w, 'tcPhoneInput', '9876543210');
    fill(w, 'cAddress', '12 Test Street');
    fill(w, 'cPincode', '110001');
    fill(w, 'cCity', 'Delhi');
    w.document.getElementById('oForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const rzp = calls.find((c) => c.url.includes('/razorpay/create-order'));
    expect(rzp.body.amount).toBe(999);
    const order = calls.find((c) => c.url.includes('/api/order') && c.method === 'POST');
    expect(order.body.amount).toBe(999);
    expect(String(order.body.product)).not.toContain('(Pack of');
  });

  it('pain oil prepaid Pack of 2: order + Razorpay carry 359', async () => {
    const { w, calls } = bootPage('pain-oil/index.html', 'https://avnideepayurveda.in/pain-oil/', {
      app: true, appRel: 'pain-oil/app-oil.v3.js',
    });
    setPack(w, 'oil', 1);
    openCheckout(w, { prepaid: true });
    fill(w, 'cName', 'Test Buyer');
    fill(w, 'tcPhoneInput', '9876543210');
    fill(w, 'cAddress', '12 Test Street');
    fill(w, 'cPincode', '110001');
    fill(w, 'cCity', 'Delhi');
    w.document.getElementById('oForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const order = calls.find((c) => c.url.includes('/api/order') && c.method === 'POST');
    expect(order, 'order must be saved').toBeTruthy();
    expect(order.body.amount).toBe(359);
    expect(String(order.body.product)).toContain('(Pack of 2)');
    const rzp = calls.find((c) => c.url.includes('/razorpay/create-order'));
    expect(rzp, 'razorpay order must be created').toBeTruthy();
    expect(rzp.body.amount).toBe(359);
  });
});

describe('cart checkout hands the cart item pack to the payment step', () => {
  function bootCart(pathname) {
    const html = '<!doctype html><html><body>' +
      '<a href="/shilajit/" data-cart-add="shilajit">Add pack 1</a>' +
      '<a href="/shilajit/" data-cart-add="shilajit3">Add pack 3</a>' +
      '<a href="/pain-oil/" data-cart-add="oil2">Add oil pack 2</a>' +
      '<a href="/hair-oil/" data-cart-add="hair2">Add hair pack 2</a>' +
      '<a href="/herbal-balm/" data-cart-add="balm3">Add balm pack 3</a>' +
      '<button type="button" data-cart-checkout>Checkout</button>' +
      '<script>' + read('assets/cart.js') + '</script>' +
      '</body></html>';
    const dom = new JSDOM(html, {
      url: 'https://avnideepayurveda.in' + pathname,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(w) {
        w.fetch = () => Promise.reject(new Error('offline (test)'));
        w.fbq = function () {};
        w.openedPopup = 0;
        w.openOrderPopup = function () { w.openedPopup++; };
      },
    });
    return dom.window;
  }
  const click = (w, sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  it('Pack of 3 in the cart -> avn_pack = shilajit pack 3 (popup prices pack 3)', () => {
    const w = bootCart('/shilajit/');
    click(w, '[data-cart-add="shilajit3"]');
    click(w, '[data-cart-checkout]');
    expect(JSON.parse(w.localStorage.getItem('avn_pack'))).toEqual({ page: 'shilajit', i: 2 });
    expect(w.openedPopup).toBe(1);
  });

  it('Pain oil Pack of 2 -> avn_pack = oil pack 2', () => {
    const w = bootCart('/pain-oil/');
    click(w, '[data-cart-add="oil2"]');
    click(w, '[data-cart-checkout]');
    expect(JSON.parse(w.localStorage.getItem('avn_pack'))).toEqual({ page: 'oil', i: 1 });
    expect(w.openedPopup).toBe(1);
  });

  it('Hair oil Pack of 2 -> avn_pack = hair pack 2 (popup prices pack 2)', () => {
    const w = bootCart('/hair-oil/');
    click(w, '[data-cart-add="hair2"]');
    click(w, '[data-cart-checkout]');
    expect(JSON.parse(w.localStorage.getItem('avn_pack'))).toEqual({ page: 'hair', i: 1 });
    expect(w.openedPopup).toBe(1);
  });

  it('Herbal balm Pack of 3 -> avn_pack = balm pack 3', () => {
    const w = bootCart('/herbal-balm/');
    click(w, '[data-cart-add="balm3"]');
    click(w, '[data-cart-checkout]');
    expect(JSON.parse(w.localStorage.getItem('avn_pack'))).toEqual({ page: 'balm', i: 2 });
    expect(w.openedPopup).toBe(1);
  });

  it('stale pack state is overwritten by a pack-of-1 cart item (never leaks pack 3 pricing)', () => {
    const w = bootCart('/shilajit/');
    // customer previously viewed Pack of 3 on the PDP, but the cart holds pack 1
    w.localStorage.setItem('avn_pack', JSON.stringify({ page: 'shilajit', i: 2 }));
    click(w, '[data-cart-add="shilajit"]');
    click(w, '[data-cart-checkout]');
    expect(JSON.parse(w.localStorage.getItem('avn_pack'))).toEqual({ page: 'shilajit', i: 0 });
    expect(w.openedPopup).toBe(1);
  });
});

describe('no pack-of-1 hard-coding left in the checkout code', () => {
  const shilajit = read('shilajit/index.html');
  const oil = read('pain-oil/index.html');

  it('shilajit inline checkout reads the pack instead of 999/1250 literals', () => {
    expect(shilajit).not.toMatch(/m === 'prepaid' \? 999 : 1250/);
    expect(shilajit).not.toContain("amount: m==='prepaid'?999:1250");
    expect(shilajit).toContain('function coPack()');
    expect(shilajit).toContain('coPackLabel()');
  });

  it('pain-oil inline checkout reads the pack instead of 249 literals', () => {
    expect(oil).not.toMatch(/m === 'prepaid' \? 249 : 249/);
    expect(oil).not.toContain("amount: m==='prepaid'?249:249");
    expect(oil).toContain('function coPack()');
    expect(oil).toContain('coPackLabel()');
  });

  it('app bundles stay pack-aware', () => {
    expect(read('shilajit/app-shilajit.v3.js')).toContain('apPack().pre : apPack().cod');
    expect(read('pain-oil/app-oil.v3.js')).toContain('apPack().pre : apPack().cod');
    expect(read('hair-oil/app-hairoil.v3.js')).toContain('apPack().pre : apPack().cod');
    expect(read('herbal-balm/app-balm.v3.js')).toContain('apPack().pre : apPack().cod');
  });

  // Regression: the pack selector and the checkout must agree on the
  // avn_pack.page id, otherwise Pack of 2/3 silently prices as Pack of 1.
  it('hair oil + balm pack selector and checkout share the SAME avn_pack page id', () => {
    const hair = read('hair-oil/index.html');
    const balm = read('herbal-balm/index.html');

    expect(hair).toContain("page==='hair'");
    expect(hair).toContain("page === 'hair'");
    expect(hair).not.toMatch(/page\s*:\s*'oil'/);

    expect(balm).toContain("page==='balm'");
    expect(balm).toContain("page === 'balm'");
    expect(balm).not.toMatch(/page\s*:\s*'oil'/);
  });

  it('hair oil + balm packs are known to cart.js so add-to-cart and pack sync work', () => {
    const cart = read('assets/cart.js');
    for (const id of ['hair', 'hair2', 'hair3', 'balm', 'balm2', 'balm3']) {
      expect(cart, 'cart.js product ' + id).toMatch(new RegExp("\\b" + id + ":\\s*\\{"));
    }
    expect(cart).toContain("if (id.indexOf('hair') === 0) return 'hair';");
    expect(cart).toContain("if (id.indexOf('balm') === 0) return 'balm';");
  });

  it('JS URLs are cache-busted so customers with a stale 1-year-immutable copy re-download', () => {
    expect(shilajit).toContain('app-shilajit.v3.js?v=20261018submitfix');
    expect(shilajit).not.toContain('app-shilajit.v3.js?v=20261017lockfix');
    expect(oil).toContain('app-oil.v3.js?v=20261018submitfix');
    expect(oil).not.toContain('app-oil.v3.js?v=20261017lockfix');
    // hair-oil/balm app bundles were edited too
    expect(read('hair-oil/index.html')).toContain('app-hairoil.v3.js?v=20261018submitfix');
    expect(read('herbal-balm/index.html')).toContain('app-balm.v3.js?v=20261018submitfix');
    // cart.js changed too -> every page that loads it must use the new URL
    for (const page of ['index.html', 'shilajit/index.html', 'pain-oil/index.html', 'hair-oil/index.html', 'herbal-balm/index.html']) {
      expect(read(page), page).toContain('/assets/cart.js?v=rx30');
      expect(read(page), page).not.toContain('/assets/cart.js?v=rx29');
      expect(read(page), page).toContain('/assets/site-sync.js?v=4');
      expect(read(page), page).not.toContain('/assets/site-sync.js?v=3"');
    }
  });

  it('EVERY first-party script/style reference carries a version query', () => {
    // A plain `cart.js` (no ?v=) keeps its URL across deploys, so the CDN and
    // returning browsers pin one copy — which is exactly how a fixed cart.js
    // stayed invisible while its ?v= token was not bumped.
    const pages = [
      'index.html', 'shilajit/index.html', 'pain-oil/index.html',
      'hair-oil/index.html', 'herbal-balm/index.html', 'about-us.html',
      'contact-us.html', 'privacy-policy.html', 'refund-policy.html',
      'shipping-policy.html', 'terms-and-conditions.html', 'disclaimer.html',
    ];
    for (const page of pages) {
      const src = read(page);
      const refs = [...src.matchAll(/(?:src|href)="([^"]*\.(?:js|css)(?:\?[^"]*)?)"/g)].map((m) => m[1]);
      const firstParty = refs.filter((r) => !/^https?:|^\/\//.test(r) && !/sw\.js/.test(r));
      const unversioned = firstParty.filter((r) => !r.includes('?v='));
      expect(unversioned, `${page}: unversioned local assets`).toEqual([]);
    }
  });
});

describe('payment.html paints the real order, not a fixed pack of 1', () => {
  const html = read('payment.html');

  it('amount/product/ref come from the URL', () => {
    expect(html).toContain("params.get('amount')");
    expect(html).toContain('.amount-value, .mobile-amount-value');
    expect(html).toContain('.product-name, .mobile-product');
    expect(html).toContain('Ref: #');
  });

  it('renders amount and pack name on load', () => {
    const dom = new JSDOM(html, {
      url: 'https://avnideepayurveda.in/payment.html?amount=2699&order_id=AVN-123&name=6Pro%20Shilajit%20Capsules%20(Pack%20of%203)',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(w) {
        w.fetch = () => Promise.reject(new Error('offline (test)'));
        w.fbq = function () {};
        w.gtag = function () {};
        w.dataLayer = [];
      },
    });
    const w = dom.window;
    expect(w.document.querySelector('.amount-value').textContent).toBe('₹2,699');
    expect(w.document.querySelector('.mobile-amount-value').textContent).toBe('₹2,699');
    expect(w.document.querySelector('.product-name').textContent).toContain('Pack of 3');
    expect(w.document.querySelector('.merchant-id').textContent).toContain('AVN-123');
  });
});
