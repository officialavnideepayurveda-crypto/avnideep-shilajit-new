import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

function bootCart(pathname) {
  const html = '<!doctype html><html><body>' +
    '<a href="/shilajit/" data-cart-add="shilajit">Add pack 1</a>' +
    '<a href="/shilajit/" data-cart-add="shilajit2">Add pack 2</a>' +
    '<a href="/shilajit/" data-cart-add="shilajit3">Add pack 3</a>' +
    '<a href="/pain-oil/" data-cart-add="oil">Add oil 1</a>' +
    '<a href="/pain-oil/" data-cart-add="oil2">Add oil pack 2</a>' +
    '<a href="/pain-oil/" data-cart-add="oil3">Add oil pack 3</a>' +
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
      w.openedUrls = [];
      w.openOrderPopup = function () { w.openedPopup++; };
      w.open = function (url) { w.openedUrls.push(String(url)); return null; };
    },
  });
  return dom.window;
}
const click = (w, sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

describe('cart checkout button: every cart opens the order popup (WhatsApp is only the explicit button)', () => {
  it('Pack 1 + Pack 2 (Pack 2 added last) -> popup with Pack of 2', () => {
    const w = bootCart('/shilajit/');
    click(w, '[data-cart-add="shilajit"]');
    click(w, '[data-cart-add="shilajit2"]');
    click(w, '[data-cart-checkout]');
    expect(w.openedPopup).toBe(1);
    expect(w.openedUrls.length).toBe(0);
    expect(JSON.parse(w.localStorage.getItem('avn_pack'))).toEqual({ page: 'shilajit', i: 1 });
  });

  it('Pack 2 then Pack 1 (Pack 1 added last) -> popup with Pack of 1', () => {
    const w = bootCart('/shilajit/');
    click(w, '[data-cart-add="shilajit2"]');
    click(w, '[data-cart-add="shilajit"]');
    click(w, '[data-cart-checkout]');
    expect(w.openedPopup).toBe(1);
    expect(w.openedUrls.length).toBe(0);
    expect(JSON.parse(w.localStorage.getItem('avn_pack'))).toEqual({ page: 'shilajit', i: 0 });
  });

  it('oil Pack 1 + Pack 3 -> popup with oil Pack of 3', () => {
    const w = bootCart('/pain-oil/');
    click(w, '[data-cart-add="oil"]');
    click(w, '[data-cart-add="oil3"]');
    click(w, '[data-cart-checkout]');
    expect(w.openedPopup).toBe(1);
    expect(w.openedUrls.length).toBe(0);
    expect(JSON.parse(w.localStorage.getItem('avn_pack'))).toEqual({ page: 'oil', i: 2 });
  });

  it('mixed cart (shilajit + oil) goes to the checkout popup, not WhatsApp', () => {
    const w = bootCart('/shilajit/');
    click(w, '[data-cart-add="shilajit"]');
    click(w, '[data-cart-add="oil2"]'); // oil added last -> its PDP hosts the popup
    click(w, '[data-cart-checkout]');
    // Used to open wa.me here. It now routes to the other product's PDP with
    // ?open=1 (jsdom cannot follow location.href, so only assert it is NOT
    // WhatsApp); tests/cart-mixed-checkout.test.js covers what the popup then
    // charges.
    expect(w.openedPopup).toBe(0);
    expect(w.openedUrls.filter((u) => /wa\.me/.test(u)), 'must not route to WhatsApp').toEqual([]);
    expect(w.AVN_CART_STATE.mixed).toBe(true);
    expect(w.AVN_CART_STATE.families.sort()).toEqual(['oil', 'shilajit']);
  });

  it('mixed cart whose last line is on this page opens the popup here, with the whole cart priced', () => {
    const w = bootCart('/shilajit/');
    click(w, '[data-cart-add="oil"]');
    click(w, '[data-cart-add="shilajit"]'); // shilajit last -> stays on /shilajit/
    click(w, '[data-cart-checkout]');
    expect(w.openedPopup).toBe(1);
    expect(w.openedUrls.length).toBe(0);
    expect(w.AVN_CART_STATE.mixed).toBe(true);
    expect(w.AVN_CART_STATE.items.length).toBe(2);
    // COD = MRP (oil 349 + shilajit 1,250); prepaid = MRP - 20%
    expect(w.AVN_CART_STATE.codTotal).toBe(349 + 1250);
    expect(w.AVN_CART_STATE.prepaidTotal).toBe(299 + 1000);
    expect(w.AVN_CART_STATE.count).toBe(2);
  });

  it('a single-product cart is not marked mixed', () => {
    const w = bootCart('/shilajit/');
    click(w, '[data-cart-add="shilajit"]');
    click(w, '[data-cart-checkout]');
    expect(w.AVN_CART_STATE.mixed).toBe(false);
    expect(w.openedPopup).toBe(1);
    expect(w.openedUrls.length).toBe(0);
  });

  it('the explicit Order-on-WhatsApp button still routes to WhatsApp', () => {
    const w = bootCart('/shilajit/');
    click(w, '[data-cart-add="shilajit"]');
    click(w, '[data-cart-add="oil"]');
    w.document.body.insertAdjacentHTML('beforeend', '<button type="button" data-cart-wa>WA</button>');
    click(w, '[data-cart-wa]');
    expect(w.openedUrls.length).toBe(1);
    expect(w.openedUrls[0]).toContain('wa.me');
    expect(w.openedPopup).toBe(0);
  });

  it('stale unknown ids do not crash checkout; valid line still opens popup', () => {
    const w = bootCart('/shilajit/');
    w.localStorage.setItem('avn_cart_v1', JSON.stringify({ ghost_old_id: 1 }));
    click(w, '[data-cart-add="shilajit3"]');
    expect(() => click(w, '[data-cart-checkout]')).not.toThrow();
    expect(w.openedPopup).toBe(1);
    expect(JSON.parse(w.localStorage.getItem('avn_pack'))).toEqual({ page: 'shilajit', i: 2 });
  });
});

describe('cart drawer total: no shipping fee is ever added', () => {
  const money = (n) => '\u20b9' + n.toLocaleString('en-IN');
  const openDrawer = (w) => {
    w.document.body.insertAdjacentHTML('beforeend', '<button type="button" data-cart-open>cart</button>');
    click(w, '[data-cart-open]');
  };

  it('a single oil pack shows FREE delivery and the configured prepaid total', () => {
    const w = bootCart('/pain-oil/');
    click(w, '[data-cart-add="oil"]'); // MRP 349, configured prepaid 299
    openDrawer(w);
    const dr = w.document.querySelector('.cart-dr');
    expect(dr.querySelector('[data-cart-total]').textContent).toBe(money(299));
    expect(dr.querySelector('.cart-f .cart-row span').textContent).toBe('Subtotal (Prepaid)');
    expect(dr.querySelector('[data-cart-del]').textContent).toBe('FREE');
    expect(dr.querySelector('[data-cart-checkout]').textContent).toBe('Checkout \u2014 ' + money(299));
    expect(dr.querySelector('.cart-note').textContent).toContain('Free shipping');
    expect(dr.querySelector('[data-cart-ship]').innerHTML).toContain('FREE delivery');
    // both prices stay visible on the line so COD is never hidden
    const line = dr.querySelector('.cart-it .it-p').textContent;
    expect(line).toContain(money(349));
    expect(line).toContain(money(299));
  });

  it('a deliberate COD choice quotes ₹349 in the drawer', () => {
    const w = bootCart('/pain-oil/');
    w.localStorage.setItem('avn_pay_pref', 'C');
    click(w, '[data-cart-add="oil"]');
    openDrawer(w);
    const dr = w.document.querySelector('.cart-dr');
    expect(dr.querySelector('[data-cart-total]').textContent).toBe(money(349));
    expect(dr.querySelector('.cart-f .cart-row span').textContent).toBe('Subtotal (COD)');
    expect(dr.querySelector('[data-cart-checkout]').textContent).toBe('Checkout \u2014 ' + money(349));
  });

  it('the WhatsApp order text lines carry no shipping fee either', () => {
    const w = bootCart('/pain-oil/');
    click(w, '[data-cart-add="oil"]');
    w.document.body.insertAdjacentHTML('beforeend', '<button type="button" data-cart-wa>WA</button>');
    click(w, '[data-cart-wa]');
    const lines = decodeURIComponent(w.openedUrls[0].split('text=')[1]).split('\n');
    expect(lines).toContain('Delivery: FREE');
    expect(lines).toContain('Total: ' + money(349));
  });
});
