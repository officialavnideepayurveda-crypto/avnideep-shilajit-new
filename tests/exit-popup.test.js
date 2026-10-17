/**
 * Exit-Intent Popup Tests
 *
 * Loads index.html in jsdom (with scripts running) and verifies the
 * ₹100-advance COD exit popup behavior:
 * - Shows when the visitor's mouse leaves the viewport (after min dwell time)
 * - Shows once per session (sessionStorage guard survives reload)
 * - Never shows if an order was already placed in this session
 * - Never shows while the order popup is open
 * - ESC / close / "No thanks" dismiss it
 * - CTA hides the exit popup and opens the order form
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let dom;

// jsdom's window has its own (real) Date realm, so the page scripts capture
// Date.now() at parse time from that realm. We patch it via beforeParse with
// a mutable fake clock so MIN_MS (8s) can be passed instantly in tests.
let currentFakeTime = 1_000_000;

function loadPage({ initialTime = 1_000_000, advanceMs = 8600 } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(initialTime);
  currentFakeTime = initialTime;

  dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://avnideepayurveda.in/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.Date.now = () => currentFakeTime;
    },
  });

  // Advance past MIN_MS (8000) so the popup is allowed to show
  currentFakeTime += advanceMs;
  vi.advanceTimersByTime(advanceMs);
  return dom;
}

function triggerExit() {
  const doc = dom.window.document;
  doc.dispatchEvent(new dom.window.MouseEvent('mouseout', {
    bubbles: true,
    cancelable: true,
    clientY: 0,
  }));
  // scheduleShow() waits 500ms before calling show()
  vi.advanceTimersByTime(600);
}

function exitPopupActive() {
  return dom.window.document.getElementById('exitPopup').classList.contains('active');
}

afterEach(() => {
  vi.useRealTimers();
  if (dom) { dom.window.close(); dom = null; }
});

describe('Exit-intent popup', () => {
  it('shows when the mouse leaves the viewport after minimum dwell time', () => {
    loadPage();
    expect(exitPopupActive()).toBe(false);

    triggerExit();

    expect(exitPopupActive()).toBe(true);
    expect(dom.window.document.getElementById('exitPopup').getAttribute('aria-hidden')).toBe('false');
    // Marks itself as shown so it never appears again this session
    expect(dom.window.sessionStorage.getItem('avn_exit_popup_shown')).toBe('1');
  });

  it('does not show before the 8s minimum dwell time', () => {
    // Only 3 seconds elapsed -> still below MIN_MS (8000)
    loadPage({ initialTime: 2_000_000, advanceMs: 3000 });

    triggerExit();

    expect(exitPopupActive()).toBe(false);
  });

  it('shows only once per session (sessionStorage guard)', () => {
    loadPage();
    triggerExit();
    expect(exitPopupActive()).toBe(true);

    // Dismiss it, then try to trigger again
    dom.window.document.getElementById('exitNo').click();
    expect(exitPopupActive()).toBe(false);

    triggerExit();
    expect(exitPopupActive()).toBe(false);
  });

  it('shows when the tab/app is switched (visibilitychange -> hidden)', () => {
    loadPage();

    // Simulate the browser hiding the tab (mobile exit signal)
    Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => true });
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));

    vi.advanceTimersByTime(600); // scheduleShow() waits 500ms
    expect(exitPopupActive()).toBe(true);
  });

  it('does not show if an order was already placed in this session', () => {
    loadPage();
    // Simulate a Purchase dedup flag left by a previous order
    dom.window.sessionStorage.setItem('avn_purchase_fired_AVN-TEST', '1');

    triggerExit();

    expect(exitPopupActive()).toBe(false);
  });

  it('does not show while the order popup is open', () => {
    loadPage();
    dom.window.document.getElementById('orderPopupOverlay').classList.add('active');

    triggerExit();

    expect(exitPopupActive()).toBe(false);
  });

  it('closes on ESC, close button, backdrop click and "No thanks"', () => {
    // Each dismissal needs a fresh page (the popup only shows once per load)
    const dismissers = [
      (w) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      (w) => w.document.getElementById('exitClose').click(),
      (w) => w.document.getElementById('exitPopup').dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
      (w) => w.document.getElementById('exitNo').click(),
    ];

    dismissers.forEach((dismiss) => {
      loadPage();
      triggerExit();
      expect(exitPopupActive()).toBe(true);
      dismiss(dom.window);
      expect(exitPopupActive()).toBe(false);
    });
  });

  it('CTA hides the exit popup and opens the order form', () => {
    loadPage();
    triggerExit();
    expect(exitPopupActive()).toBe(true);

    dom.window.document.getElementById('exitCta').click();

    expect(exitPopupActive()).toBe(false);
    // openOrderPopup() is defined by the page's own scripts
    expect(typeof dom.window.openOrderPopup).toBe('function');
    expect(dom.window.document.getElementById('orderPopupOverlay').classList.contains('active')).toBe(true);
  });
});
