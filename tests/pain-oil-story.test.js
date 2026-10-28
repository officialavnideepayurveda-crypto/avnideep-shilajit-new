import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const HERBS = [
  'nirgundi', 'gandhapura', 'kapoor', 'pudina', 'malkangani', 'lavang',
  'dalchini', 'chir-pine', 'khas', 'alsi', 'nilgiri', 'til',
];

const EXT_SCRIPT = /<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g;

describe('pain-oil saveweb-style story', () => {
  const html = read('pain-oil/index.html');
  const css = read('pain-oil/pain-oil-merge.css');

  it('renders the long-form story below Active Offers, above the product tabs', () => {
    expect(html).toContain('<div class="po-merge" id="p-story">');
    expect(html.indexOf('ap-offers-h')).toBeLessThan(html.indexOf('id="p-story"'));
    expect(html.indexOf('id="p-story"')).toBeLessThan(html.indexOf('<div class="wrap">'));
    expect(html).toMatch(/pain-oil-merge\.css\?v=\d+/);
    expect(html).toContain('css/all.min.css?v=7');
    expect(html).not.toContain('class="hv-story"');
    expect(css).toContain('.pain-grid');
    expect(css).toContain('.conn-grid');
    expect(css).toContain('.ing-grid');
    expect(css).toContain('.faq-item.open .faq-a');
  });

  it('covers every pain area the oil is sold for', () => {
    // 6 symptom cards: knee, back, neck/shoulder, night, reach, driving
    expect((html.match(/class="pain-card"/g) || []).length).toBe(6);
    for (const area of ['घुटना', 'कमर', 'गर्दन-कंधा', 'रात में दर्द', 'ऊपर का सामान', 'गाड़ी चलाना']) {
      expect(html, area).toContain(area);
    }
    expect(html).not.toMatch(/कंधा जाम\? हाथ ऊपर उठाते ही/);
  });

  it('uses Avnideep herbs and product copy, not the reference site ingredients', () => {
    expect(html).toContain('Avnideep Pain Oil में क्या है?');
    const blocks = html.match(/class="ing-card"/g) || [];
    expect(blocks).toHaveLength(12);
    HERBS.forEach((herb) => {
      expect(html, herb).toContain(`herbs/circle/${herb}.webp`);
      expect(existsSync(resolve(ROOT, 'pain-oil/herbs/circle', `${herb}.webp`)), herb).toBe(true);
    });
    expect(html).not.toMatch(/Boswellia|Guggul|Ashwagandha|Shallaki|Dr\. JointPro/);
    expect(html).not.toContain('EssenceVeda');
  });

  it('every image referenced by the story exists on disk', () => {
    const story = html.slice(html.indexOf('id="p-story"'), html.indexOf('<div class="wrap">'));
    const srcs = [...story.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThanOrEqual(14);
    for (const src of srcs) {
      expect(existsSync(resolve(ROOT, 'pain-oil', src)), src).toBe(true);
    }
  });

  it('keeps the gallery, checkout and pricing hooks intact', () => {
    expect(html).toContain('id="mainImg"');
    expect(html).toContain('/assets/product-gallery.js?v=1');
    // Order flow ab sirf popup se chalta hai — inline "Confirm Your Order Now"
    // section page se hata diya gaya hai (sticky Buy Now popup kholta hai).
    expect(html).not.toContain('<section id="checkout">');
    expect(html).toContain('window.openOrderPopup = openOrderPopup');
    expect(html).toContain('id="sticky"');
    // FAQ ke neeche ke product blocks (benefits / ingredients / how-to) page se
    // intentionally hata diye gaye hain — sirf reviews + checkout + footer rehte hain.
    expect(html).not.toContain('id="p-benefits"');
    expect(html).not.toContain('id="p-ingredients"');
    expect(html).not.toContain('id="p-howto"');
  });

  it('routes the story CTAs into the existing checkout', () => {
    const story = html.slice(html.indexOf('id="p-story"'), html.indexOf('<div class="wrap">'));
    // checkout hamesha popup se khulta hai, is liye ek hi story CTA chahiye aur
    // wo #checkout + data-scroll dono ke saath aana chahiye (sticky bar ke
    // alawa story me koi doosra checkout trigger nahi hona chahiye).
    const ctas = story.match(/href="#checkout"/g) || [];
    expect(ctas.length).toBe(1);
    expect(story).toContain('data-scroll="checkout"');
    expect((story.match(/class="faq-q"/g) || []).length).toBe(6);
  });

  it('opens the story FAQ answers with the page\'s own accordion', async () => {
    const dom = new JSDOM(html.replace(EXT_SCRIPT, ''), {
      url: 'https://avnideepayurveda.in/pain-oil/',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(w) {
        w.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
        w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
        w.ResizeObserver = class { observe() {} disconnect() {} };
        w.scrollTo = () => {};
        w.fbq = () => {};
        w.dataLayer = [];
      }
    });
    // the page wires the accordion inside its DOMContentLoaded init
    await new Promise((done) => {
      if (dom.window.document.readyState === 'complete') return done();
      dom.window.addEventListener('load', done, { once: true });
      setTimeout(done, 3000);
    });
    const doc = dom.window.document;
    const items = [...doc.querySelectorAll('.po-merge .faq-item')];
    expect(items).toHaveLength(6);
    expect(items[0].classList.contains('open')).toBe(false);
    items[0].querySelector('.faq-q').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(items[0].classList.contains('open')).toBe(true);
    // opening another item closes the first one
    items[1].querySelector('.faq-q').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(items[1].classList.contains('open')).toBe(true);
    expect(items[0].classList.contains('open')).toBe(false);
  });
});
