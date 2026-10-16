import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

// tests/ -> project root
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const EXT_SCRIPT = /<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g;

// Boot a real product page exactly like production: inline scripts run, the
// app bundle loads last. `seed` pre-populates localStorage BEFORE the bundle
// executes, simulating a browser that has visited/ordered before.
function bootPage(htmlRel, url, { appRel, seed = {} } = {}) {
  const html = read(htmlRel).replace(EXT_SCRIPT, '');
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: {} }) });
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
  const s = w.document.createElement('script');
  s.textContent = read(appRel);
  w.document.body.appendChild(s);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return w;
}

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  ['shilajit/index.html', 'https://shop.avnideep.in/shilajit/', 'shilajit/app-shilajit.v3.js'],
  ['pain-oil/index.html', 'https://shop.avnideep.in/pain-oil/', 'pain-oil/app-oil.v3.js'],
  ['hair-oil/index.html', 'https://shop.avnideep.in/hair-oil/', 'hair-oil/app-hairoil.v3.js'],
  ['herbal-balm/index.html', 'https://shop.avnideep.in/herbal-balm/', 'herbal-balm/app-balm.v3.js'],
];

describe('a customer who already ordered still gets the checkout form', () => {
  it.each(PAGES)('%s: avn_order_placed in localStorage does not hide #oForm', async (htmlRel, url, appRel) => {
    const w = bootPage(htmlRel, url, {
      appRel,
      seed: { avn_order_placed: String(Date.now()) }, // they ordered before
    });
    await settle();

    const form = w.document.getElementById('oForm');
    expect(form, '#oForm must exist').toBeTruthy();
    // The old "order lock" set display:none on the form for repeat buyers.
    expect(form.style.display).not.toBe('none');
  });

  it('shilajit: repeat buyer can open the popup and see the form fields', async () => {
    const w = bootPage('shilajit/index.html', 'https://shop.avnideep.in/shilajit/', {
      appRel: 'shilajit/app-shilajit.v3.js',
      seed: { avn_order_placed: String(Date.now()) },
    });
    await settle();

    w.openOrderPopup();
    await settle();

    const overlay = w.document.getElementById('orderPopupOverlay');
    expect(overlay.classList.contains('active'), 'popup overlay opens').toBe(true);
    const form = w.document.getElementById('oForm');
    expect(form.style.display).not.toBe('none');
    expect(w.document.getElementById('cName'), 'name field visible').toBeTruthy();
    expect(w.document.getElementById('cAddress'), 'address field visible').toBeTruthy();
  });

  it.each(PAGES)('%s: fresh visitor (no flag) also gets the form', async (htmlRel, url, appRel) => {
    const w = bootPage(htmlRel, url, { appRel });
    await settle();
    const form = w.document.getElementById('oForm');
    expect(form, '#oForm must exist').toBeTruthy();
    expect(form.style.display).not.toBe('none');
  });

  it('no app bundle reads or writes the avn_order_placed lock anymore', () => {
    const bundles = [
      'app.v3.js',
      'shilajit/app-shilajit.v3.js',
      'pain-oil/app-oil.v3.js',
      'hair-oil/app-hairoil.v3.js',
      'herbal-balm/app-balm.v3.js',
    ];
    for (const b of bundles) {
      expect(read(b), b).not.toContain('avn_order_placed');
      expect(read(b), b).not.toContain('orderLockPopup');
    }
  });
});
