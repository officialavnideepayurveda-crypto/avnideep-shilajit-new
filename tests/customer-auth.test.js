/**
 * Customer login tests (mobile + PIN, partner-style).
 *
 * Backend (functions/api/auth.js, functions/api/my-orders.js):
 * - PINs are hashed (SHA-256 + per-customer salt), never stored raw
 * - sessions are random tokens, httpOnly cookie, brute-force lockout
 * - my-orders only returns the logged-in mobile's orders, no addresses
 *
 * Frontend (assets/auth.js):
 * - login modal + header icon + slide-menu entries + orders drawer
 * - everything is failure-isolated (auth must never break the site)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const authApi = read('functions/api/auth.js');
const ordersApi = read('functions/api/my-orders.js');
const authJs = read('assets/auth.js');
const css = read('assets/renee-theme.css');

describe('auth backend: PIN safety (partner-style)', () => {
  it('stores only salted SHA-256 PIN hashes, never the raw PIN', () => {
    expect(authApi).toContain('pin_hash');
    expect(authApi).toContain('pin_salt');
    expect(authApi).toContain('crypto.subtle');
    expect(authApi).toContain('SHA-256');
    // no INSERT/UPDATE may persist a raw pin value
    expect(authApi).not.toMatch(/INSERT INTO customers\([^)]*pin[^_]/);
    expect(authApi).not.toContain('pin: pin');
  });

  it('validates mobile (10-digit, 6-9 start) and PIN (4-6 digits)', () => {
    expect(authApi).toContain('/^[6-9]\\d{9}$/');
    expect(authApi).toContain('/^\\d{4,6}$/');
  });

  it('locks out brute force (5 wrong PINs -> temporary lock)', () => {
    expect(authApi).toContain('failed_attempts');
    expect(authApi).toContain('locked_until');
    expect(authApi).toContain('MAX_FAILS');
    expect(authApi).toContain('429');
  });

  it('exposes check / register / login / logout / me actions', () => {
    for (const a of ['"check"', '"register"', '"login"', '"logout"', '"me"']) {
      expect(authApi, a).toContain(a);
    }
  });

  it('first login creates the account (register path)', () => {
    expect(authApi).toContain('INSERT INTO customers');
    expect(authApi).toContain('INSERT INTO customer_sessions');
  });
});

describe('auth backend: session cookie', () => {
  it('uses an httpOnly, SameSite, Secure session cookie', () => {
    expect(authApi).toContain('HttpOnly');
    expect(authApi).toContain('SameSite=Lax');
    expect(authApi).toContain('Secure');
    expect(authApi).toContain('avn_cust');
  });

  it('stores only the token hash server-side (leak-safe sessions)', () => {
    expect(authApi).toContain('token_hash');
    expect(authApi).toContain('sha256hex("avn_cust:" + token)');
  });

  it('logout deletes the session and clears the cookie', () => {
    expect(authApi).toContain('DELETE FROM customer_sessions');
    expect(authApi).toContain('Max-Age=0');
  });

  it('sessions expire (30 days) and guests get loggedIn:false', () => {
    expect(authApi).toContain('expires_at');
    expect(authApi).toContain('loggedIn');
  });
});

describe('my-orders backend: mobile-scoped, privacy-safe', () => {
  it('requires a valid session (401 otherwise)', () => {
    expect(ordersApi).toContain('401');
    expect(ordersApi).toContain('customer_sessions');
  });

  it('matches orders by last-10-digit mobile (handles +91/spaces)', () => {
    expect(ordersApi).toContain('-10)');
  });

  it('returns order summary only — no address/pincode leak', () => {
    const sel = ordersApi.match(/SELECT[\s\S]*?FROM orders/);
    expect(sel, 'orders SELECT').toBeTruthy();
    expect(sel[0]).not.toContain('address');
    expect(sel[0]).not.toContain('pincode');
    expect(ordersApi).toContain('order_id');
    expect(ordersApi).toContain('LIMIT 20');
  });

  it('responses are never cached', () => {
    expect(ordersApi).toContain('no-store');
  });
});

describe('auth frontend: login modal + account UI', () => {
  it('builds a mobile -> PIN / set-PIN modal flow', () => {
    expect(authJs).toContain('auth-modal');
    expect(authJs).toContain("post('check', { mobile: m })");
    expect(authJs).toContain('renderPinStep');
    expect(authJs).toContain('renderRegisterStep');
  });

  it('injects a header account icon and slide-menu entries', () => {
    expect(authJs).toContain('rx-acctbtn');
    expect(authJs).toContain('rx-mnav-links');
    expect(authJs).toContain('data-auth-orders');
    expect(authJs).toContain('data-auth-logout');
  });

  it('opens a My Orders drawer with status pills', () => {
    expect(authJs).toContain('auth-dr');
    expect(authJs).toContain('/api/my-orders');
    expect(authJs).toContain('ord-st');
  });

  it('prefills checkout name/phone for logged-in customers', () => {
    expect(authJs).toContain('prefillCheckout');
    expect(authJs).toContain('tcPhoneInput');
  });

  it('is failure-isolated: try/catch + network-error fallbacks', () => {
    expect(authJs).toContain('Network error');
    const catches = (authJs.match(/catch \(e/g) || []).length;
    expect(catches).toBeGreaterThan(5);
  });

  it('exposes a safe AVN_AUTH bridge', () => {
    expect(authJs).toContain('window.AVN_AUTH');
    expect(authJs).toContain('openLogin');
    expect(authJs).toContain('openOrders');
  });
});

describe('auth styles + wiring (site must not break)', () => {
  it('theme has login modal, account button and orders drawer styles', () => {
    expect(css).toContain('.auth-modal');
    expect(css).toContain('.rx-acctbtn');
    expect(css).toContain('.auth-dr');
    expect(css).toContain('.ord-st');
  });

  it('every cart.js page also loads auth.js (header/menu coverage)', () => {
    const pages = [
      'index.html',
      'shilajit/index.html',
      'pain-oil/index.html',
      'about-us.html',
      'contact-us.html',
    ];
    for (const p of pages) {
      expect(read(p), p).toContain('/assets/auth.js?v=1');
    }
  });

  it('auth modal works with zero layout shift risk (fixed overlay)', () => {
    expect(css).toMatch(/\.auth-ov\{[^}]*position:fixed/);
    expect(css).toMatch(/\.auth-dr\{[^}]*position:fixed/);
  });

  it('login UI boots in a real DOM without throwing', async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div class="rx-nav"><a class="rx-logo" href="/">L</a>' +
        '<nav class="rx-links"></nav><div class="rx-icons"></div></div>' +
        '<script>' + authJs + '</script></body></html>',
      { url: 'https://shop.avnideep.in/', runScripts: 'dangerously', pretendToBeVisual: true,
        beforeParse(w) { w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, loggedIn: false }) }); } }
    );
    const w = dom.window;
    // DOMContentLoaded fires async after parse — wait for boot
    for (let i = 0; i < 50 && !w.document.querySelector('.rx-acctbtn'); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(w.document.querySelector('.rx-acctbtn'), 'account icon').toBeTruthy();
    expect(w.AVN_AUTH, 'bridge').toBeTruthy();
    expect(() => w.AVN_AUTH.openLogin()).not.toThrow();
    expect(w.document.querySelector('.auth-modal'), 'modal').toBeTruthy();
  });
});

describe('customer_auth migration SQL', () => {
  it('creates customers + sessions tables with needed indexes', () => {
    const sql = read('migrations/0005_customer_auth.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS customers');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS customer_sessions');
    expect(sql).toContain('pin_hash');
    expect(sql).toContain('token_hash');
  });
});
