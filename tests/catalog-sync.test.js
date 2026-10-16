import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

// tests/ -> project root
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

// Boot a page with the real cart.js + site-sync.js inline scripts, plus a
// button like the ones site-sync renders for admin-created products.
function bootCatalogPage() {
  const html = '<!doctype html><html><body>' +
    '<span data-cart-count>0</span>' +
    '<a href="#cart" data-cart-open>Cart</a>' +
    '<div id="newRow"><button type="button" data-site-add="newthing">ADD</button></div>' +
    '<script>' + read('assets/cart.js') + '</script>' +
    '<script>' + read('assets/site-sync.js') + '</script>' +
    '</body></html>';
  const dom = new JSDOM(html, {
    url: 'https://shop.avnideep.in/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = () => Promise.reject(new Error('offline (test)'));
      w.fbq = function () {};
      w.gtag = function () {};
      w.dataLayer = [];
    },
  });
  return dom.window;
}

const ADMIN_PRODUCT = {
  newthing: { name: 'Admin Product', sku: 'AVN-NEW-001', prepaid: 100, cod: 100, mrp: 200, img: '/x.png' },
};

describe('admin-catalog "ADD" stays in sync with the cart', () => {
  it('cart.js exposes window.AVN_CART for other scripts to add through', () => {
    const w = bootCatalogPage();
    expect(w.AVN_CART, 'window.AVN_CART must be exposed by cart.js').toBeTruthy();
    expect(typeof w.AVN_CART.add).toBe('function');
    expect(typeof w.AVN_CART.renderBadges).toBe('function');
  });

  it('adding an admin product updates localStorage, the drawer AND the badge together', () => {
    const w = bootCatalogPage();
    w.AVN_ADMIN_PRODUCTS = ADMIN_PRODUCT;

    w.document.querySelector('[data-site-add="newthing"]')
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

    // what checkout reads
    expect(JSON.parse(w.localStorage.getItem('avn_cart_v1'))).toEqual({ newthing: 1 });
    // what the cart's own in-memory state believes
    expect(w.AVN_CART.count()).toBe(1);
    // what the customer actually sees in the drawer + badge
    const row = w.document.querySelector('.cart-it[data-key="newthing"]');
    expect(row, 'cart drawer must render a row for the admin product').toBeTruthy();
    expect(row.textContent).toContain('Admin Product');
    expect(w.document.querySelector('[data-cart-count]').textContent).toBe('1');
  });

  it('site-sync routes the add through AVN_CART rather than writing localStorage alone', () => {
    const sync = read('assets/site-sync.js');
    expect(sync).toContain('window.AVN_CART.add(id, 1)');
  });
});

describe('every product page is discoverable', () => {
  const PRODUCTS = ['shilajit', 'pain-oil', 'hair-oil', 'herbal-balm'];

  it('sitemap.xml lists all four product pages', () => {
    const sitemap = read('sitemap.xml');
    for (const p of PRODUCTS) {
      expect(sitemap, p + ' missing from sitemap').toContain('<loc>https://shop.avnideep.in/' + p + '/</loc>');
    }
  });

  it('each product page canonical matches its sitemap entry', () => {
    for (const p of PRODUCTS) {
      expect(read(p + '/index.html'), p).toContain('rel="canonical" href="https://shop.avnideep.in/' + p + '/"');
    }
  });

  // Regression: hair-oil and herbal-balm existed as pages but were linked from
  // nowhere, so the storefront looked like a two-product shop.
  it('the homepage "In the Spotlight" grid shows one card per product', () => {
    const grid = read('index.html').match(/<section[^>]*id="products"[\s\S]*?<\/section>/)[0];
    expect((grid.match(/class="rx-pcard"/g) || []).length, 'card count').toBe(4);
    const expected = [['shilajit', 'shilajit'], ['pain-oil', 'oil'], ['hair-oil', 'hair'], ['herbal-balm', 'balm']];
    for (const [path, cartId] of expected) {
      expect(grid, path).toContain('href="/' + path + '/"');
      expect(grid, path + ' add-to-cart').toContain('data-cart-add="' + cartId + '"');
    }
  });

  it('every page links all four products from the header nav and the footer Shop list', () => {
    const PAGES = [
      'index.html', 'about-us.html', 'contact-us.html', 'disclaimer.html',
      'privacy-policy.html', 'refund-policy.html', 'shipping-policy.html',
      'terms-and-conditions.html', 'shilajit/index.html', 'pain-oil/index.html',
      'hair-oil/index.html', 'herbal-balm/index.html',
    ];
    for (const page of PAGES) {
      const html = read(page);
      const nav = html.match(/<nav class="rx-links"[^>]*>([\s\S]*?)<\/nav>/)[1];
      const catbar = html.match(/<div class="rx-catbar-in">([\s\S]*?)<\/div>/)[1];
      const shop = html.match(/<nav aria-label="Shop">[\s\S]*?<ul>([\s\S]*?)<\/ul>/)[1];
      for (const p of PRODUCTS) {
        const link = 'href="/' + p + '/"';
        expect(nav, `${page} nav ${p}`).toContain(link);
        expect(catbar, `${page} catbar ${p}`).toContain(link);
        expect(shop, `${page} footer ${p}`).toContain(link);
        // exactly once — a duplicated link means the insert ran twice
        expect((nav.match(new RegExp(link, 'g')) || []).length, `${page} nav dup ${p}`).toBe(1);
        expect((catbar.match(new RegExp(link, 'g')) || []).length, `${page} catbar dup ${p}`).toBe(1);
      }
    }
  });
});
