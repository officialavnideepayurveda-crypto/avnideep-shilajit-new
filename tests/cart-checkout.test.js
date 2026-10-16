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
    url: 'https://shop.avnideep.in' + pathname,
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

describe('cart checkout button: same-family lines open the popup, not WhatsApp', () => {
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

  it('truly mixed cart (shilajit + oil) still goes to WhatsApp', () => {
    const w = bootCart('/shilajit/');
    click(w, '[data-cart-add="shilajit"]');
    click(w, '[data-cart-add="oil2"]');
    click(w, '[data-cart-checkout]');
    expect(w.openedPopup).toBe(0);
    expect(w.openedUrls.length).toBe(1);
    expect(w.openedUrls[0]).toContain('wa.me');
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
