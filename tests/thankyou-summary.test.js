// ============================================================
// Order confirmation (thank-you.html) money breakdown.
//
// For the ₹100 advance + COD option the page must show the TOTAL order
// amount, the ₹100 already paid online, and the balance due on delivery —
// with the advance included in the total, never added on top of it.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const EXT_SCRIPT = /<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g;
const settle = (ms = 1000) => new Promise((r) => setTimeout(r, ms));

function boot(query) {
  const html = read('thank-you.html').replace(EXT_SCRIPT, '');
  const dom = new JSDOM(html, {
    url: 'https://avnideepayurveda.in/thank-you.html' + query,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
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
  it('₹100 advance + COD: total, advance paid now and remaining COD', async () => {
    const w = boot('?order_id=AVN-TEST-ADV&amount=2799&name=Test&method=advance_cod');
    await settle();

    expect(txt(w, 'displayAmount')).toContain('2,799');
    expect(shown(w, 'displayAdvanceRow')).toBe(true);
    expect(txt(w, 'displayAdvance')).toContain('100');
    expect(shown(w, 'displayCodRow')).toBe(true);
    expect(txt(w, 'displayCod')).toContain('2,699'); // 2799 - 100, not 2799 + 100
  });

  it('prepaid: the prepaid total is shown and no advance/COD split appears', async () => {
    const w = boot('?order_id=AVN-TEST-PRE&amount=2258&name=Test&method=prepaid');
    await settle();

    expect(txt(w, 'displayAmount')).toContain('2,258');
    expect(shown(w, 'displayAdvanceRow')).toBe(false);
    expect(shown(w, 'displayCodRow')).toBe(false);
  });

  it('COD: full total due on delivery, no advance row', async () => {
    const w = boot('?order_id=AVN-TEST-COD&amount=2799&name=Test&method=cod');
    await settle();

    expect(txt(w, 'displayAmount')).toContain('2,799');
    expect(shown(w, 'displayAdvanceRow')).toBe(false);
    expect(shown(w, 'displayCodRow')).toBe(false);
  });
});
