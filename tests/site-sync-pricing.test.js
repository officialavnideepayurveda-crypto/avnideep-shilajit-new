// ============================================================
// site-sync.js must treat the admin's explicit price triple as
// authoritative. Regression: it used to rebuild every price from MRP
// (oil became ₹349 / ₹279 instead of ₹349 / ₹320 / ₹299), so the live
// payment cards disagreed with the admin catalogue and the server.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const PRODUCTS = [
  {
    id: 'oil', name: 'Pain Relief Oil 60ml', sku: 'AVN-OIL-001',
    price_cod: 349, price_advance: 320, price_prepaid: 299, mrp: 349,
    in_stock: 1, out_of_stock: false,
  },
  {
    id: 'shilajit', name: '6Pro Shilajit Capsules', sku: 'AVN-6PRO-001',
    price_cod: 1250, price_advance: 1200, price_prepaid: 1000, mrp: 1250,
    in_stock: 1, out_of_stock: false,
  },
];

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('site-sync respects configured payment prices', () => {
  it('keeps the explicit COD / advance / prepaid values from /api/products', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://avnideepayurveda.in/pain-oil/',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(w) {
        w.fetch = async (url) => {
          if (String(url).includes('/api/products')) {
            return { ok: true, status: 200, json: async () => ({ ok: true, products: PRODUCTS }) };
          }
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        };
      },
    });
    const w = dom.window;
    w.eval(read('assets/cart.js'));
    // The PDP's own pack table (the shape that used to be skipped).
    w.AP_PACKS = [{ mrp: 349, cod: 349, adv: 349, pre: 279, sku: 'AVN-OIL-001' }];
    let repainted = 0;
    w.apSyncPrice = () => { repainted++; };
    w.updatePay = () => { repainted++; };
    w.eval(read('assets/site-sync.js'));
    await settle();

    const oil = w.AVN_ADMIN_PRODUCTS.oil;
    expect(oil.cod).toBe(349);
    expect(oil.advance).toBe(320);
    expect(oil.prepaid).toBe(299);

    // The PDP preview and payment cards are repainted from the new values.
    expect(w.AP_PACKS[0].pre).toBe(299);
    expect(w.AP_PACKS[0].adv).toBe(320);
    expect(repainted).toBe(2);
  });
});
