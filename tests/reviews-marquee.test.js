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
  for (const page of pages) {
    it(`${page}: marquee with 2 opposite-direction rows`, () => {
      const d = dom(page);
      const mq = d.querySelector('.revmq');
      expect(mq, page + ' needs .revmq').toBeTruthy();
      const rows = mq.querySelectorAll('.revmq-row');
      expect(rows.length).toBe(2);
      expect(rows[1].classList.contains('rev')).toBe(true);
    });

    it(`${page}: each row loops seamlessly (exact duplicate set)`, () => {
      const d = dom(page);
      d.querySelectorAll('.revmq-track').forEach((track) => {
        const cards = [...track.children];
        expect(cards.length % 2).toBe(0);
        const half = cards.length / 2;
        expect(half).toBeGreaterThanOrEqual(4);
        for (let i = 0; i < half; i++) {
          expect(cards[i].textContent).toBe(cards[i + half].textContent);
          expect(cards[i + half].getAttribute('aria-hidden')).toBe('true');
        }
      });
    });
  }

  it('home mixes shilajit + oil reviews; PDP pages stay product-specific', () => {
    const home = dom('index.html').querySelector('.revmq').textContent;
    expect(home).toContain('Shilajit');
    expect(home).toContain('Pain Oil');
    const oil = dom('pain-oil/index.html').querySelector('.revmq').textContent;
    expect(oil).not.toContain('Shilajit');
    const shi = dom('shilajit/index.html').querySelector('.revmq').textContent;
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
    const versions = { 'index.html': 'rx24', 'shilajit/index.html': 'rx24', 'pain-oil/index.html': 'rx24' };
    for (const page of Object.keys(versions)) {
      expect(read(page), page).toContain('/assets/renee-theme.css?v=' + versions[page]);
      expect(read(page), page).not.toContain('/assets/renee-theme.css?v=rx20');
    }
  });
});
