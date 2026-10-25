// ============================================================
// Order confirmation (thank-you.html) money breakdown.
//
// The page must display the stored order totals (amount, online paid,
// COD due), not a hardcoded ₹100 or an unverified URL amount.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const EXT_SCRIPT = /<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g;
const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

function boot(query, order) {
  const html = read('thank-you.html').replace(EXT_SCRIPT, '');
  const dom = new JSDOM(html, {
    url: 'https://avnideepayurveda.in/thank-you.html' + query,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (u, o) => {
        const target = String(u);
        if ((o && o.method) === 'PATCH') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }
        if (target.includes('/api/order?') && order) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, order }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      };
      w.fbq = () => {};
      w.dataLayer = [];
      w.scrollTo = () => {};
      w.open = () => null;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    },
  });
  const w = dom.window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return w;
}

const txt = (w, id) => (w.document.getElementById(id) || {}).textContent || '';
const shown = (w, id) => {
  const el = w.document.getElementById(id);
  return !!el && el.style.display !== 'none';
};

describe('thank-you shows the same verified totals as checkout', () => {
  it('advance + COD: total, the verified online amount and the COD balance', async () => {
    const w = boot('?order_id=AVN-TEST-ADV&amount=2799&name=Test&phone=9876543210&method=advance_cod&razorpay_payment_id=pay_x', {
      orderId: 'AVN-TEST-ADV', amount: 2799, paymentMethod: 'advance_cod',
      paymentStatus: 'partially_paid', onlinePaid: 150, codDue: 2649,
    });
    await settle();

    expect(txt(w, 'displayAmount')).toContain('2,799');
    expect(shown(w, 'displayAdvanceRow')).toBe(true);
    expect(txt(w, 'displayAdvance')).toContain('150');
    expect(shown(w, 'displayCodRow')).toBe(true);
    expect(txt(w, 'displayCod')).toContain('2,649'); // 2799 - 150, not 2799 + 150
  });

  it('prepaid: the verified total is shown and no COD balance appears', async () => {
    const w = boot('?order_id=AVN-TEST-PRE&amount=2258&name=Test&phone=9876543210&method=prepaid&razorpay_payment_id=pay_y', {
      orderId: 'AVN-TEST-PRE', amount: 2258, paymentMethod: 'prepaid',
      paymentStatus: 'paid', onlinePaid: 2258, codDue: 0,
    });
    await settle();

    expect(txt(w, 'displayAmount')).toContain('2,258');
    expect(txt(w, 'displayAdvance')).toContain('2,258');
    expect(shown(w, 'displayCodRow')).toBe(false);
  });

  it('COD: the full stored total is due on delivery and no online payment is claimed', async () => {
    const w = boot('?order_id=AVN-TEST-COD&amount=2799&name=Test&phone=9876543210&method=cod', {
      orderId: 'AVN-TEST-COD', amount: 2799, paymentMethod: 'cod',
      paymentStatus: 'pending_collection', onlinePaid: 0, codDue: 2799,
    });
    await settle();

    expect(txt(w, 'displayAmount')).toContain('2,799');
    expect(shown(w, 'displayAdvanceRow')).toBe(false);
    expect(shown(w, 'displayCodRow')).toBe(true);
    expect(txt(w, 'displayCod')).toContain('2,799');
  });
});
