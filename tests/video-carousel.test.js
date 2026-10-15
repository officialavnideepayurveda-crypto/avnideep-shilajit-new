import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

// tests/ -> project root
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const PAGES = [
  // duplicate /home page removed — the real homepage is now index.html at the repo root
  { label: 'home', file: 'index.html' },
  { label: 'pain-oil', file: 'pain-oil/index.html' },
];

const VIDEOS = 5;

function load(file) {
  const html = readFileSync(resolve(ROOT, file), 'utf8');
  // Silent virtual console: these pages also run analytics/3rd-party snippets
  // whose globals only exist on the live site (fbevents.js, app-oil.v3.js ...).
  return new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `https://shop.avnideep.in/${file.replace('/index.html', '/')}`,
    virtualConsole: new VirtualConsole(),
  });
}

const settle = () => new Promise((done) => setTimeout(done, 0));

// jsdom has no layout engine, so every slide is 0px wide and one slide moves the
// track by exactly one gap. That makes the current index readable from the transform.
function indexOf(window, region) {
  const track = region.querySelector('[data-vcar-track]');
  const styles = window.getComputedStyle(track);
  const gap = parseFloat(styles.columnGap || styles.gap);
  const step = Number.isNaN(gap) ? 12 : gap;
  const match = /translate3d\((-?[\d.]+)px/.exec(track.style.transform);
  if (!match) return null;
  const index = Math.round(-parseFloat(match[1]) / step);
  return index === 0 ? 0 : index; // normalise -0
}

function selectedDot(region) {
  const dots = [...region.querySelectorAll('[data-vcar-dot]')];
  return dots.findIndex((dot) => dot.getAttribute('aria-selected') === 'true');
}

for (const { label, file } of PAGES) {
  describe(`video carousel — ${label}`, () => {
    it('renders all five reviews as click-to-play facades (no eager iframes)', async () => {
      const { window } = load(file);
      await settle();

      const region = window.document.querySelector('[data-vcar]');
      expect(region).toBeTruthy();
      expect(region.querySelectorAll('.vcar-item')).toHaveLength(VIDEOS);

      // perf: zero eager iframes on page load
      expect(region.querySelectorAll('iframe')).toHaveLength(0);

      // five facades, each with a valid YouTube id + thumbnail
      const facades = region.querySelectorAll('.yt-facade[data-yt]');
      expect(facades).toHaveLength(VIDEOS);
      for (const b of facades) {
        expect(b.getAttribute('data-yt')).toMatch(/^[A-Za-z0-9_-]{6,16}$/);
        const thumb = b.querySelector('img');
        expect(thumb).toBeTruthy();
        expect(thumb.getAttribute('src')).toContain('i.ytimg.com/vi/');
      }

      // clicking a facade lazy-loads the iframe
      facades[0].click();
      await settle();
      const frames = region.querySelectorAll('iframe');
      expect(frames).toHaveLength(1);
      expect(frames[0].getAttribute('src')).toContain('youtube-nocookie.com/embed/');

      // the old static grid must be gone
      expect(window.document.querySelector('.video-grid')).toBeNull();
    });

    it('starts on the first slide with the previous arrow disabled', async () => {
      const { window } = load(file);
      await settle();

      const region = window.document.querySelector('[data-vcar]');
      expect(indexOf(window, region)).toBe(0);
      expect(region.querySelector('[data-vcar-prev]').disabled).toBe(true);
      expect(region.querySelector('[data-vcar-next]').disabled).toBe(false);
      expect(selectedDot(region)).toBe(0);
      expect(region.querySelectorAll('[data-vcar-dot]')).toHaveLength(VIDEOS);
    });

    it('advances and rewinds with the arrows without running past the ends', async () => {
      const { window } = load(file);
      await settle();

      const region = window.document.querySelector('[data-vcar]');
      const prev = region.querySelector('[data-vcar-prev]');
      const next = region.querySelector('[data-vcar-next]');

      for (let i = 0; i < VIDEOS + 3; i += 1) next.click();

      expect(indexOf(window, region)).toBe(VIDEOS - 1);
      expect(next.disabled).toBe(true);
      expect(prev.disabled).toBe(false);
      expect(selectedDot(region)).toBe(VIDEOS - 1);

      prev.click();
      expect(indexOf(window, region)).toBe(VIDEOS - 2);
      expect(next.disabled).toBe(false);

      for (let i = 0; i < VIDEOS + 3; i += 1) prev.click();

      expect(indexOf(window, region)).toBe(0);
      expect(prev.disabled).toBe(true);
    });

    it('jumps to a slide when a dot is clicked', async () => {
      const { window } = load(file);
      await settle();

      const region = window.document.querySelector('[data-vcar]');
      const dots = region.querySelectorAll('[data-vcar-dot]');

      dots[2].click();
      expect(indexOf(window, region)).toBe(2);
      expect(selectedDot(region)).toBe(2);

      dots[0].click();
      expect(indexOf(window, region)).toBe(0);
      expect(selectedDot(region)).toBe(0);
    });

    it('responds to arrow keys and to a swipe', async () => {
      const { window } = load(file);
      await settle();

      const region = window.document.querySelector('[data-vcar]');
      const track = region.querySelector('[data-vcar-track]');

      region.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(indexOf(window, region)).toBe(1);

      region.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      expect(indexOf(window, region)).toBe(0);

      const drag = (type, x) =>
        track.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: 10, bubbles: true }));

      drag('pointerdown', 300);
      drag('pointerup', 100);
      expect(indexOf(window, region)).toBe(1);

      drag('pointerdown', 100);
      drag('pointerup', 300);
      expect(indexOf(window, region)).toBe(0);

      // a short drag is not a swipe: it snaps back to the same slide
      drag('pointerdown', 200);
      drag('pointerup', 215);
      expect(indexOf(window, region)).toBe(0);
    });
  });
}
