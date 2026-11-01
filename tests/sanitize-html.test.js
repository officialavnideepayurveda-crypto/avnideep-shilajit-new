// ============================================================
// Blog HTML sanitizer (functions/api/_lib/sanitizeHtml.js)
//
// The old implementation stripped tags with regexes, which misses
// entity-encoded, malformed and attribute-encoded payloads. These tests pin
// the parser-based behaviour: markup that is not on the allowlist is gone,
// dangerous URL schemes are gone, and text content survives.
// ============================================================
import { describe, it, expect } from 'vitest';
import { sanitizeBlogHtml } from '../functions/api/_lib/sanitizeHtml.js';

const s = (html) => sanitizeBlogHtml(html);
const lower = (html) => s(html).toLowerCase();

describe('sanitizeBlogHtml - script and event handlers', () => {
  it('drops <script> blocks and their contents', () => {
    const out = lower('<p>Hello</p><script>alert(1)</script>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('hello');
  });

  it('drops svg/onload payloads', () => {
    const out = lower('<svg onload="alert(1)"><circle /></svg><p>ok</p>');
    expect(out).not.toContain('onload');
    expect(out).not.toContain('svg');
    expect(out).toContain('ok');
  });

  it('drops img onerror handlers but keeps the image', () => {
    const out = lower('<img src="https://cdn.avnideepayurveda.in/a.webp" onerror="alert(1)" alt="x">');
    expect(out).not.toContain('onerror');
    expect(out).toContain('cdn.avnideepayurveda.in');
  });

  it('drops iframe, object and embed', () => {
    const out = lower('<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="y">');
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('object');
    expect(out).not.toContain('embed');
  });

  it('drops malformed / unclosed tags without leaking their attributes', () => {
    const out = lower('<p onclick="alert(1)">hi<p>there');
    expect(out).not.toContain('onclick');
  });
});

describe('sanitizeBlogHtml - URL schemes', () => {
  it('removes javascript: hrefs', () => {
    const out = lower('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
  });

  it('removes data: URLs on images and links', () => {
    const out = lower('<img src="data:text/html;base64,PHN2Zz4="><a href="data:text/html,x">x</a>');
    expect(out).not.toContain('data:');
  });

  it('removes protocol-relative URLs', () => {
    const out = lower('<img src="//evil.example/x.png">');
    expect(out).not.toContain('//evil.example');
  });

  it('keeps https links and forces rel=noopener noreferrer', () => {
    const out = s('<a href="https://avnideepayurveda.in/x">x</a>');
    expect(out).toContain('https://avnideepayurveda.in/x');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe('sanitizeBlogHtml - encoded payloads', () => {
  it('neutralises entity-encoded angle brackets', () => {
    const out = lower('&lt;script&gt;alert(1)&lt;/script&gt;');
    // Encoded markup stays inert text: no live <script> element is produced.
    expect(out).not.toContain('<script');
  });

  it('drops entity-encoded javascript: on an href', () => {
    const out = lower('<a href="java&#115;cript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });
});

describe('sanitizeBlogHtml - legitimate content survives', () => {
  it('keeps headings, paragraphs, lists, bold and tables', () => {
    const html =
      '<h2>Heading</h2><p><strong>Bold</strong> and <em>italic</em></p>' +
      '<ul><li>One</li><li>Two</li></ul>' +
      '<table><thead><tr><th scope="col">A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';
    const out = s(html);
    expect(out).toContain('<h2>Heading</h2>');
    expect(out).toContain('<strong>Bold</strong>');
    expect(out).toContain('<li>One</li>');
    expect(out).toContain('<th scope="col">A</th>');
  });

  it('handles null / undefined input', () => {
    expect(s(null)).toBe('');
    expect(s(undefined)).toBe('');
  });
});
