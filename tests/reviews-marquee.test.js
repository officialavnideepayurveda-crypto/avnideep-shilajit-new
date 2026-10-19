import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const dom = (rel) => new JSDOM(read(rel)).window.document;

describe('scrolling reviews marquee (Glowasy-style, 2 opposite rows)', () => {
  const pages = ['index.html', 'shilajit/index.html', 'pain-oil/index.html'];
  const reviewMq = (d) => [...d.querySelectorAll('.revmq')].filter((m) =>
    (m.getAttribute('aria-label') || '').toLowerCase().includes('review'));
  const herbsMq = (d) => [...d.querySelectorAll('.revmq')].filter((m) =>
    (m.getAttribute('aria-label') || '').toLowerCase().includes('ingredient'));
  for (const page of pages) {
    it(`${page}: marquee with 2 opposite-direction rows`, () => {
      const d = dom(page);
      const mqs = reviewMq(d);
      expect(mqs.length, page + ' needs a reviews .revmq').toBe(1);
      const rows = mqs[0].querySelectorAll('.revmq-row');
      expect(rows.length).toBe(2);
      expect(rows[1].classList.contains('rev')).toBe(true);
    });

    it(`${page}: each row loops seamlessly (exact duplicate set)`, () => {
      const d = dom(page);
      reviewMq(d).forEach((mq) => mq.querySelectorAll('.revmq-track').forEach((track) => {
        const cards = [...track.children];
        expect(cards.length % 2).toBe(0);
        const half = cards.length / 2;
        expect(half).toBeGreaterThanOrEqual(4);
        for (let i = 0; i < half; i++) {
          expect(cards[i].textContent).toBe(cards[i + half].textContent);
          expect(cards[i + half].getAttribute('aria-hidden')).toBe('true');
        }
      }));
    });
  }

  it('PDP herbs ride the same auto-scroll rows (shilajit 6, pain-oil 12, seamless halves)', () => {
    const counts = { 'shilajit/index.html': 6, 'pain-oil/index.html': 12 };
    for (const page of Object.keys(counts)) {
      const d = dom(page);
      const mqs = herbsMq(d);
      expect(mqs.length, page + ' needs a herbs .revmq').toBe(1);
      const tracks = mqs[0].querySelectorAll('.revmq-track');
      expect(tracks.length).toBe(2);
      let total = 0;
      tracks.forEach((track) => {
        const cards = [...track.children].filter((c) => c.classList.contains('bcard'));
        expect(cards.length % 2).toBe(0);
        const half = cards.length / 2;
        expect(half).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < half; i++) {
          expect(cards[i].textContent).toBe(cards[i + half].textContent);
          expect(cards[i + half].getAttribute('aria-hidden')).toBe('true');
        }
        total += half;
      });
      expect(total).toBe(counts[page]);
    }
  });

  it('home mixes shilajit + oil reviews; PDP pages stay product-specific', () => {
    const home = reviewMq(dom('index.html'))[0].textContent;
    expect(home).toContain('Shilajit');
    expect(home).toContain('Pain Oil');
    const oil = reviewMq(dom('pain-oil/index.html'))[0].textContent;
    expect(oil).not.toContain('Shilajit');
    const shi = reviewMq(dom('shilajit/index.html'))[0].textContent;
    expect(shi).not.toContain('Pain Relief Oil');
    expect(shi).not.toContain('Pain Oil');
  });

  it('theme css drives the motion (opposite keyframes, hover pause, reduced-motion)', () => {
    const css = read('assets/renee-theme.css');
    expect(css).toContain('@keyframes revmqL');
    expect(css).toContain('@keyframes revmqR');
    expect(css).toContain('animation-play-state:paused');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('pages load the marquee css (cache-busted past rx20)', () => {
    const versions = { 'index.html': 'rx29', 'shilajit/index.html': 'rx29', 'pain-oil/index.html': 'rx29' };
    for (const page of Object.keys(versions)) {
      expect(read(page), page).toContain('/assets/renee-theme.css?v=' + versions[page]);
      expect(read(page), page).not.toContain('/assets/renee-theme.css?v=rx20');
    }
  });
});
