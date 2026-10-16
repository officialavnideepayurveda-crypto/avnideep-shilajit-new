import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('homepage hero gloss sweep (order-button shine family)', () => {
  const html = read('index.html');
  const css = read('assets/renee-theme.css');

  it('corner-frame is fully removed', () => {
    expect(html).not.toContain('rx-frame play');
    expect(html).not.toContain('replayHeroFrame');
    expect(css).not.toContain('rxDraw');
    expect(css).not.toContain('.rx-frame{');
    expect(css).not.toContain('.rx-frame ');
  });

  it('active slide carries a light sweep overlay', () => {
    expect(css).toContain('.rx-hero .slide.on::after');
    expect(css).toContain('@keyframes rx-hero-shine');
    expect(css).toContain('animation:rx-hero-shine 2.8s ease-in-out infinite');
    // same skewed-band language as the order buttons
    expect(css).toContain('skewX(-18deg)');
    expect(css).toContain('rgba(255,255,255,.22)');
  });

  it('sweep never blocks hero clicks and stays clipped to the banner', () => {
    const d = new JSDOM(html).window.document;
    const frames = d.querySelector('.rx-hero .rx-frames');
    expect(frames, '.rx-frames').toBeTruthy();
    expect(d.querySelectorAll('.rx-hero .slide').length).toBe(2);
    expect(d.querySelector('.rx-hero-nav'), 'nav').toBeTruthy();
    expect(d.querySelector('.rx-hero img').getAttribute('src')).toContain('banner-shilajit-desktop.png');
    expect(css).toMatch(/\.rx-hero \.slide\.on::after\{[^}]*pointer-events:none/);
    expect(css).toMatch(/\.rx-hero \.slide\.on::after\{[^}]*z-index:2/);
  });

  it('sweep restarts with each slide (tied to .on, no JS)', () => {
    // animation lives on .slide.on so every slide change retriggers it
    expect(css).toMatch(/\.rx-hero \.slide\.on::after\{[^}]*animation:/);
    expect(html).not.toContain('replayHeroFrame');
  });

  it('respects prefers-reduced-motion', () => {
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*?\.rx-hero \.slide\.on::after/);
  });

  it('homepage loads sweep css (cache-busted)', () => {
    expect(html).toContain('/assets/renee-theme.css?v=rx25');
  });
});
