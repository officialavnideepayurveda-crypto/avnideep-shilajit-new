// ============================================================
// IMAGE FIT — a CSS-sized photo must own its height.
//
// Regression: /home/assets/showcase-1-*.webp is a 1254x1254 square that ships
// with intrinsic width="1254" height="1254" attributes. Those attributes are
// presentational hints: they beat `aspect-ratio` unless the CSS also declares
// height. Without `height:auto` the story-split card rendered 577x1254 on
// desktop and 342x1254 on a 390px phone — a giant stretched photo on both.
//
// Rule kept here: any rule that gives an <img> (or .main image) an aspect-ratio
// must also let CSS own the height, so the pixel-height hint can never win.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const CSS_REL = 'assets/renee-theme.css';
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('image fit: intrinsic width/height attributes never out-rank CSS', () => {
  const css = read(CSS_REL);
  const html = read('index.html');

  const ruleBody = (selector) => {
    const m = css.match(new RegExp(rx(selector) + '\\{([^}]*)\\}'));
    return m ? m[1] : null;
  };

  it('the story-split card is a height-capped square, not a full-height photo', () => {
    const img = ruleBody('.rx-split-img');
    expect(img, '.rx-split-img rule').toBeTruthy();
    expect(img).toContain('height:auto');       // lets aspect-ratio decide the box
    expect(img).toContain('aspect-ratio:1/1');
    expect(img).toContain('max-height:520px');  // the same cap as the sizes="...520px" hint

    const media = ruleBody('.rx-split-media');
    expect(media).toContain('max-width:520px');
    expect(media).toMatch(/margin-inline:auto|margin:0 auto/);

    // the markup this rule targets really is an intrinsic-size square image
    expect(html).toMatch(/showcase-1-1000\.webp[^>]*>/);
    expect(html).toMatch(/<img width="1254" height="1254"[^>]*class="rx-split-img"/);
  });

  it('the doctor portrait keeps its 4:5 crop instead of its 768px pixel height', () => {
    const img = ruleBody('.rx-doc-frame img');
    expect(img).toContain('height:auto');
    expect(img).toContain('aspect-ratio:4/5');
    expect(html).toMatch(/<img width="676" height="768" src="https:\/\/cdn\.avnideepayurveda\.in\/home\/assets\/doctor\.webp"/);
  });

  it('every aspect-ratio rule that targets an image also sets height', () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
    // an <img> (or a .main image) as the final selector token
    const imageRules = rules.filter(({ sel, body }) => /aspect-ratio/.test(body) && /(^|[\s>])img\s*$|\s\.main\s*$/.test(sel));
    expect(imageRules.length, 'images with an aspect-ratio').toBeGreaterThan(0);
    imageRules.forEach(({ sel, body }) => {
      expect(body, `${sel} must not let a height="…" attribute win`).toMatch(/height:\s*(auto|100%)/);
    });
  });

  it('every page that loads the theme ships the fixed, cache-busted css', () => {
    const pages = [
      'index.html', 'about-us.html', 'contact-us.html', 'disclaimer.html',
      'privacy-policy.html', 'refund-policy.html', 'shipping-policy.html',
      'terms-and-conditions.html', 'pain-oil/index.html', 'shilajit/index.html',
      'hair-oil/index.html', 'herbal-balm/index.html',
    ];
    pages.forEach((p) => expect(read(p), p).toContain('/assets/renee-theme.css?v=rx30'));
  });
});
