// ============================================================
// Google Merchant Center feed (merchant-feed.xml).
//
// Merchant Center disapproves an item when the feed and the landing
// page disagree. These tests keep them in sync:
//  - the feed is well-formed XML and has the four base products
//  - each item has the attributes MC requires for a product without
//    a GTIN (brand + mpn + identifier_exists=no, price, availability)
//  - the feed price equals the price in that page's Product JSON-LD
//  - every link / image points at this site
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const SITE = 'https://avnideepayurveda.in';

// item id -> (landing page, expected price in INR)
const EXPECTED = {
  'avn-6pro-001': { page: 'shilajit/index.html', price: 1000 },
  'avn-oil-001': { page: 'pain-oil/index.html', price: 299 },
  'avn-hair-001': { page: 'hair-oil/index.html', price: 399 },
  'avn-balm-001': { page: 'herbal-balm/index.html', price: 279 },
};

function parseFeed() {
  const xml = read('merchant-feed.xml');
  const dom = new JSDOM('');
  const doc = new dom.window.DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  const NS = 'http://base.google.com/ns/1.0';
  const items = [...doc.getElementsByTagName('item')].map((item) => {
    const get = (tag) => {
      const node = item.getElementsByTagNameNS(NS, tag)[0];
      return node ? node.textContent.trim() : '';
    };
    return {
      id: get('id'),
      title: get('title'),
      description: get('description'),
      link: get('link'),
      image: get('image_link'),
      availability: get('availability'),
      price: get('price'),
      brand: get('brand'),
      mpn: get('mpn'),
      identifierExists: get('identifier_exists'),
      condition: get('condition'),
    };
  });
  return { xml, items };
}

function productOffer(page) {
  const html = read(page);
  const block = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/)[1];
  const data = JSON.parse(block);
  return data['@type'] === 'Product' ? data.offers : data;
}

describe('merchant-feed.xml', () => {
  it('is well-formed XML with exactly the four base products', () => {
    const { items } = parseFeed();
    expect(items.map((i) => i.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('carries the identifiers Merchant Center needs without GTINs', () => {
    const { items } = parseFeed();
    for (const item of items) {
      expect(item.brand).toBe('Avnideep Ayurveda');
      expect(item.mpn).toBeTruthy();
      expect(item.identifierExists).toBe('no');
      expect(item.condition).toBe('new');
      expect(item.availability).toBe('in stock');
      expect(item.image).toMatch(/^https:\/\/avnideepayurveda\.in\//);
      expect(item.link).toMatch(/^https:\/\/avnideepayurveda\.in\/.+\/$/);
      expect(item.title.length).toBeLessThanOrEqual(150);
      expect(item.description.length).toBeGreaterThan(200);
    }
  });

  it('prices every item exactly as the landing page does', () => {
    const { items } = parseFeed();
    for (const item of items) {
      const expected = EXPECTED[item.id];
      expect(expected, 'unexpected item id in feed: ' + item.id).toBeTruthy();
      expect(Number(item.price.replace(/[^\d.]/g, ''))).toBe(expected.price);
      expect(item.price.endsWith('INR')).toBe(true);
      expect(Number(productOffer(expected.page).price)).toBe(expected.price);
    }
  });

  it('links each item to the page whose canonical URL it uses', () => {
    const { items } = parseFeed();
    for (const item of items) {
      const html = read(EXPECTED[item.id].page);
      const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
      expect(canonical).toBe(item.link);
      expect(item.link.startsWith(SITE)).toBe(true);
    }
  });
});

describe('product JSON-LD', () => {
  it('declares mpn, brand, price and shipping on every product page', () => {
    for (const { page } of Object.values(EXPECTED)) {
      const html = read(page);
      const data = JSON.parse(html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/)[1]);
      expect(data['@type']).toBe('Product');
      expect(data.brand.name).toBe('Avnideep Ayurveda');
      expect(data.sku).toBeTruthy();
      expect(data.mpn).toBe(data.sku);
      expect(data.offers.priceCurrency).toBe('INR');
      expect(data.offers.availability).toBe('https://schema.org/InStock');
      expect(data.offers.itemCondition).toBe('https://schema.org/NewCondition');
      expect(data.offers.shippingDetails.shippingDestination.addressCountry).toBe('IN');
    }
  });
});
