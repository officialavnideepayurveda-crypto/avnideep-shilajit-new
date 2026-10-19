// ============================================================
// PRICING RULE — one rule for every surface.
//
//   COD price     = product MRP
//   Prepaid price = MRP - 20%
//
// Nothing else is discounted (the old "COD = MRP - 10%, prepaid = COD - 10%"
// chain is gone). These tests lock the rule in the shared helpers and in every
// catalogue the checkout can read, so a stale price can not drift back in.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { pricesFromMrp } from '../functions/api/_lib/pricing.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

// Product MRPs currently in the catalogue (admin/DB values).
const MRPS = {
  shilajit: [2500, 5000, 7500],
  oil: [349, 698, 1047],
  hair: [499, 998, 1497],
  balm: [349, 698, 1047],
};

function bootCart() {
  const dom = new JSDOM('<!doctype html><html><body><a data-cart-open></a></body></html>', {
    url: 'https://avnideepayurveda.in/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = () => Promise.reject(new Error('offline (test)'));
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    },
  });
  const s = dom.window.document.createElement('script');
  s.textContent = read('assets/cart.js');
  dom.window.document.body.appendChild(s);
  return dom.window;
}

describe('the shared MRP rule', () => {
  it('COD equals the MRP and prepaid is exactly 20% less', () => {
    for (const mrp of [349, 499, 698, 998, 1047, 1497, 2500, 5000, 7500]) {
      const p = pricesFromMrp(mrp);
      expect(p.cod, `COD for MRP ${mrp}`).toBe(mrp);
      expect(p.mrp).toBe(mrp);
      expect(p.prepaid, `prepaid for MRP ${mrp}`).toBe(Math.round(mrp * 0.8));
      expect(p.cod - p.prepaid).toBeGreaterThanOrEqual(0);
    }
  });

  it('server and storefront helpers agree for every catalogue MRP', () => {
    const w = bootCart();
    const fromMrp = w.AVN_CHECKOUT.fromMrp;
    expect(typeof fromMrp).toBe('function');
    for (const mrp of Object.values(MRPS).flat()) {
      expect(fromMrp(mrp), `MRP ${mrp}`).toEqual(pricesFromMrp(mrp));
    }
  });

  it('cart.js exposes COD = MRP for every pack, with no stale cod/prepaid literal', () => {
    const w = bootCart();
    Object.entries(MRPS).forEach(([family, mrps]) => {
      mrps.forEach((mrp, i) => {
        const pack = w.AVN_CHECKOUT.pack(family, i);
        expect(pack, `${family} pack ${i + 1}`).toBeTruthy();
        expect(pack.cod, `${family} pack ${i + 1} COD`).toBe(mrp);
        expect(pack.pre, `${family} pack ${i + 1} prepaid`).toBe(Math.round(mrp * 0.8));
        expect(pack.mrp).toBe(mrp);
      });
    });
  });

  it('admin/DB overrides are priced from their MRP, never their price_cod column', () => {
    const w = bootCart();
    // A stale pair that disagrees with the MRP — the MRP must win.
    w.AVN_ADMIN_PRODUCTS = {
      oil: { name: 'Pain Relief Oil', sku: 'AVN-OIL-001', cod: 249, prepaid: 199, mrp: 499 },
    };
    const pack = w.AVN_CHECKOUT.pack('oil', 0);
    expect(pack.cod).toBe(499);
    expect(pack.pre).toBe(399);
  });

  it('every catalogue file derives cod/prepaid from mrp (no hard-coded pairs)', () => {
    const files = [
      'assets/cart.js',
      'pain-oil/index.html', 'pain-oil/app-oil.v3.js',
      'shilajit/index.html', 'shilajit/app-shilajit.v3.js',
      'hair-oil/index.html', 'hair-oil/app-hairoil.v3.js',
      'herbal-balm/index.html', 'herbal-balm/app-balm.v3.js',
      'app.v3.js',
    ];
    for (const f of files) {
      const src = read(f);
      // A pack table must never carry its own `pre:` price again.
      // (`pre: 0` is an empty-options default, a price is 2+ digits.)
      expect(src, `${f} has a hard-coded prepaid price`).not.toMatch(/\bpre:\s*\d{2,}/);
      if (/AP_PACKS|CO_PACKS|ROOT_PACKS/.test(src)) {
        expect(src, `${f} must derive its prices from the MRP`).toMatch(/p\.cod\s*=\s*p\.mrp/);
      }
    }
  });
});
