import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('homepage hero corner-line frame', () => {
  const html = read('index.html');
  const css = read('assets/renee-theme.css');

  it('frame lives inside the hero slider with 4 corners', () => {
    const d = new JSDOM(html).window.document;
    const frames = d.querySelector('.rx-hero .rx-frames');
    expect(frames, '.rx-frames').toBeTruthy();
    const frame = frames.querySelector('.rx-frame.play');
    expect(frame, '.rx-frame.play').toBeTruthy();
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    for (const c of ['tl', 'tr', 'br', 'bl']) {
      const corner = frame.querySelector('i.' + c + ' svg path');
      expect(corner, 'corner ' + c).toBeTruthy();
      expect(corner.getAttribute('pathLength')).toBe('1');
      expect(corner.getAttribute('d')).toBeTruthy();
    }
  });

  it('frame never blocks clicks and hero content is untouched', () => {
    expect(css).toContain('pointer-events:none');
    const d = new JSDOM(html).window.document;
    expect(d.querySelectorAll('.rx-hero .slide').length).toBe(2);
    expect(d.querySelector('.rx-hero-nav'), 'nav').toBeTruthy();
    expect(d.querySelector('#dots'), 'dots').toBeTruthy();
    expect(d.querySelector('.rx-hero img').getAttribute('src')).toContain('banner-shilajit-desktop.png');
  });

  it('draw technique: dashoffset animation, staggered delays, premium easing', () => {
    expect(css).toContain('stroke-dasharray:1;stroke-dashoffset:1');
    expect(css).toContain('@keyframes rxDraw');
    expect(css).toContain('cubic-bezier(.22,.61,.36,1)');
    expect(css).toContain('.rx-frame.play i.tr path{animation-delay:.18s}');
    expect(css).toContain('.rx-frame.play i.bl path{animation-delay:.54s}');
    expect(css).toContain('stroke:var(--rx-gold)');
  });

  it('respects prefers-reduced-motion', () => {
    expect(css).toMatch(/prefers-reduced-motion[^}]*\.rx-frame/);
  });

  it('replays on manual nav only (not auto-advance)', () => {
    expect(html).toContain('function replayHeroFrame()');
    expect(html).toContain("querySelectorAll('.rx-hero-nav,#dots button')");
    // auto timer calls go() directly — no replay hook inside go()
    const goFn = html.match(/function go\(n\)\{[^}]*\}/);
    expect(goFn && goFn[0]).not.toContain('replayHeroFrame');
  });

  it('homepage loads frame css (cache-busted)', () => {
    expect(html).toContain('/assets/renee-theme.css?v=rx22');
  });

  it('manual nav click restarts the draw (live DOM check)', () => {
    const stripped = html.replace(/<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g, '');
    const dom = new JSDOM(stripped, { url: 'https://shop.avnideep.in/', runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window;
    const frame = w.document.querySelector('.rx-frame');
    expect(frame.classList.contains('play')).toBe(true);
    w.document.querySelector('.rx-hero-next').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    expect(frame.classList.contains('play')).toBe(true);
    expect(typeof w.replayHeroFrame).toBe('function');
  });
});
