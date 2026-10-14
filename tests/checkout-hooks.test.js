import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// tests/ -> project root
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const PAGES = {
  // duplicate /home page removed — the real homepage is now index.html at the repo root
  home: readFileSync(resolve(ROOT, 'index.html'), 'utf8'),
  painOil: readFileSync(resolve(ROOT, 'pain-oil/index.html'), 'utf8'),
  shilajit: readFileSync(resolve(ROOT, 'shilajit/index.html'), 'utf8'),
};

const POPUP_IDS = [
  'orderPopupOverlay', 'oForm', 'cName', 'tcPhoneInput', 'cAddress',
  'cPincode', 'cCity', 'cState', 'oBtn', 'sAmt', 'sTot', 'fErr',
  'oNext1', 'oBack2', 'oNext2', 'oBack3',
];

function localImages(html, pageDir) {
  const out = [];
  const re = /(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    let v = m[1].split(' ')[0].split('?')[0];
    if (/^(https?:|data:|#|tel:|mailto:)/.test(v)) continue;
    const disk = v.startsWith('/')
      ? resolve(ROOT, v.slice(1))
      : resolve(ROOT, pageDir, v);
    if (/\.(png|jpe?g|webp|svg|gif|avif)$/i.test(disk)) out.push(disk);
  }
  return [...new Set(out)];
}

describe('checkout hooks stay wired', () => {
  it('pain-oil + shilajit keep every popup + form id the checkout JS needs', () => {
    for (const html of [PAGES.painOil, PAGES.shilajit]) {
      for (const id of POPUP_IDS) {
        expect(html.includes(`id="${id}"`) || html.includes(`id='${id}'`), id).toBe(true);
      }
      expect(html.includes('data-scroll="checkout"')).toBe(true);
    }
  });

  it('pricing rules are consistent (shilajit 999/1250, oil 249)', () => {
    expect(PAGES.shilajit.includes('999')).toBe(true);
    expect(PAGES.shilajit.includes('1,250')).toBe(true);
    expect(PAGES.shilajit.includes('AVN-6PRO-001')).toBe(true);
    expect(PAGES.shilajit.includes('AVN-OIL-001')).toBe(false);
    expect(PAGES.shilajit.includes('avn_end_v2')).toBe(false);
    expect(PAGES.painOil.includes('AVN-OIL-001')).toBe(true);
  });

  it('removed combo leaves no dead #combo links on home', () => {
    expect(PAGES.home.includes('href="#combo"')).toBe(false);
    expect(PAGES.home.includes('id="combo"')).toBe(false);
  });

  it('every local image referenced by the 3 pages exists on disk', () => {
    const missing = [];
    for (const [html, dir] of [[PAGES.home, ''], [PAGES.painOil, 'pain-oil'], [PAGES.shilajit, 'shilajit']]) {
      for (const disk of localImages(html, dir)) {
        if (!existsSync(disk)) missing.push(disk.replace(ROOT, ''));
      }
    }
    expect(missing).toEqual([]);
  });

  it('pixel events fire once per page (no duplicate ViewContent on load)', () => {
    // home fires its page ViewContent from a body script, oil/shilajit from head;
    // video-play ViewContents are action-gated and must not be counted here
    const homeVC = (PAGES.home.match(/fbq\(\s*'track'\s*,\s*'ViewContent',\{content_name:'AVN-HOME'/g) || []).length;
    expect(homeVC, 'home page ViewContent').toBe(1);
    for (const [label, html] of [['pain-oil', PAGES.painOil], ['shilajit', PAGES.shilajit]]) {
      const head = html.slice(0, html.indexOf('</head>'));
      const headVC = (head.match(/fbq\(\s*'track'\s*,\s*'ViewContent'/g) || []).length;
      expect(headVC, `${label} head ViewContent`).toBe(1);
    }
  });
});
