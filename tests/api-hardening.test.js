// ============================================================
// Regression tests for the 5 bugs fixed in the Oct-2026 audit.
//
// These run the REAL handlers against a REAL SQLite database through a
// D1-shaped adapter. The adapter deliberately reproduces D1's line-by-line SQL
// limitation — which only affects exec(): prepare("multi-line") is fine (that is
// why `orders`/`leads` bootstrapped at runtime but `customers`/`products`, which
// went through exec(), never did). A regression that reintroduces
// `DB.exec(MULTI_LINE_SCHEMA)` fails here.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { onRequestPost as authPost } from '../functions/api/auth.js';
import { onRequestPost as orderPost } from '../functions/api/order.js';

// tests/ -> project root
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
// Reuse the new bootstrap migration as the schema for a provisioned database.
const BOOTSTRAP_SQL = readFileSync(resolve(ROOT, 'migrations/0001_bootstrap_tables.sql'), 'utf8');

// Never reach the network (Telegram / email / Meta CAPI).
beforeEach(() => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
});

// ---------- D1-shaped adapter over a real SQLite database ----------
function makeD1(db, { mimicLineLimit = true } = {}) {
  return {
    // prepare() handles multi-line SQL on real D1 — no restriction here.
    prepare(sql) {
      const state = { params: [] };
      const api = {
        bind(...p) { state.params = p; return api; },
        first() {
          const row = db.prepare(sql).get(...state.params);
          return row === undefined ? null : row;
        },
        all() { return { results: db.prepare(sql).all(...state.params) }; },
        run() {
          const r = db.prepare(sql).run(...state.params);
          return { success: true, meta: { changes: Number(r.changes || 0) } };
        },
      };
      return api;
    },
    async exec(sql) {
      if (mimicLineLimit && /\n/.test(sql)) {
        throw new Error('D1_EXEC_ERROR: Error in line 1: incomplete input: SQLITE_ERROR');
      }
      db.exec(sql);
    },
  };
}

function makeKV() {
  const m = new Map();
  return {
    async get(k, opts) {
      if (!m.has(k)) return null;
      return opts && opts.type === 'json' ? JSON.parse(m.get(k)) : m.get(k);
    },
    async put(k, v) { m.set(k, String(v)); },
  };
}

function makeEnv(db) {
  return { DB: makeD1(db), RATE_LIMIT_KV: makeKV(), ALLOWED_ORIGIN: 'https://avnideepayurveda.in' };
}

function jsonReq(body, headers = {}) {
  return {
    headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
    json: async () => body,
    clone() { return this; },
  };
}

const noop = () => {};
// A completely blank database — nothing bootstrapped yet.
const emptyDb = () => new DatabaseSync(':memory:');
// A provisioned database (what the fixed migration chain produces).
// order.js caches its bootstrap in a module-level flag, so the order tests use
// this instead of relying on per-isolate bootstrap against a fresh DB.
const provisionedDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(BOOTSTRAP_SQL);
  return db;
};

const orderBody = (over = {}) => ({
  name: 'Regression Probe',
  phone: over.phone || '9876543210',
  paymentMethod: 'cod',
  amount: over.amount ?? 1250,
  pincode: '110001',
  address: '12 Test Street',
  city: 'Delhi',
  product: 'Avnideep 6Pro Shilajit Capsules',
  ...over,
});

async function postOrder(env, body) {
  const res = await orderPost({ request: jsonReq(body, { Origin: 'https://avnideepayurveda.in' }), env, waitUntil: noop });
  return { status: res.status, data: await res.json() };
}

// ============================================================
// BUG #1 — customer auth schema never created (500 on check/register/login)
// ============================================================
describe('BUG #1: /api/auth bootstraps its schema', () => {
  let env;
  beforeEach(() => { env = makeEnv(emptyDb()); });

  const call = (action, extra) =>
    authPost({ request: jsonReq({ action, ...extra }), env }).then((r) => r.json().then((d) => ({ status: r.status, data: d })));

  it('registers a customer instead of returning 500', async () => {
    const r = await call('register', { mobile: '9876512345', name: 'Test User', pin: '1234', pin2: '1234' });
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
    expect(r.data.mobile).toBe('9876512345');
  });

  it('check / login / me all work end-to-end', async () => {
    await call('register', { mobile: '9876512345', name: 'Test User', pin: '1234', pin2: '1234' });

    const check = await call('check', { mobile: '9876512345' });
    expect(check.status).toBe(200);
    expect(check.data).toMatchObject({ ok: true, exists: true, name: 'Test User' });

    const checkNew = await call('check', { mobile: '9876599999' });
    expect(checkNew.data).toMatchObject({ ok: true, exists: false });

    const login = await call('login', { mobile: '9876512345', pin: '1234' });
    expect(login.status).toBe(200);
    expect(login.data.ok).toBe(true);

    const badPin = await call('login', { mobile: '9876512345', pin: '9999' });
    expect(badPin.status).toBe(401);
  });
});

// ============================================================
// BUG #4 — /api/products 500 when the products table doesn't exist yet
// ============================================================
describe('BUG #4: /api/products bootstraps its schema', () => {
  it('returns 200 on a database that has never had a products table', async () => {
    vi.resetModules();
    const { onRequestGet } = await import('../functions/api/products.js');
    const env = makeEnv(emptyDb()); // no tables at all

    const res = await onRequestGet({ env });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.products)).toBe(true);
    expect(data.products).toEqual([]);
  });
});

// ============================================================
// BUG #3 — order amount taken verbatim from the client
// ============================================================
describe('BUG #3: /api/order validates the amount', () => {
  let env;
  beforeEach(() => { env = makeEnv(provisionedDb()); });

  const bad = [1, 0, -500, 'abc', 999999999, NaN, Infinity];

  it.each(bad)('rejects amount %p with 400', async (amount) => {
    const r = await postOrder(env, orderBody({ amount }));
    expect(r.status).toBe(400);
    expect(r.data.ok).toBe(false);
  });

  it('accepts genuine catalogue amounts', async () => {
    for (const amount of [279, 349, 499, 698, 2500]) {
      const r = await postOrder(env, orderBody({ amount }));
      expect(r.status, `amount ${amount}: ${JSON.stringify(r.data)}`).toBe(200);
      expect(r.data.ok).toBe(true);
    }
  });
});

// ============================================================
// Server-side fallback pricing: what gets SAVED when the caller
// omits `amount` (the old CODE_PRICES/PRICE_MAP pair saved oil 314
// and the wrong prepaid price entirely).
// ============================================================
describe('/api/order prices the pack server-side when amount is omitted', () => {
  let db, env;
  beforeEach(() => { db = provisionedDb(); env = makeEnv(db); });

  const savedAmount = (phone) =>
    db.prepare('SELECT amount FROM orders WHERE phone = ?').get(phone).amount;

  it.each([
    // PRICING RULE: COD = MRP, prepaid = MRP - 20%.
    // oil MRP 349 / 698 / 1047 · shilajit 2500 / 5000 / 7500 ·
    // balm 349 / 698 / 1047 · hair 499 / 998 / 1497
    ['Avnideep Pain Relief Oil 60ml', 'cod', 349],
    ['Avnideep Pain Relief Oil 60ml', 'prepaid', 279],
    ['Avnideep Pain Relief Oil 60ml (Pack of 3)', 'cod', 1047],
    ['Avnideep Pain Relief Oil 60ml (Pack of 2)', 'prepaid', 558],
    ['Avnideep 6Pro Shilajit Capsules (Pack of 3)', 'prepaid', 6000],
    ['Avnideep 6Pro Shilajit Capsules (Pack of 2)', 'prepaid', 4000],
    ['Avnideep Herbal Balm 10g (Pack of 2)', 'cod', 698],
    ['Avnideep Herbal Hair Oil 100ml (Pack of 3)', 'cod', 1497],
  ])('%s / %s -> Rs.%i', async (product, paymentMethod, expected) => {
    const phone = '9876500001';
    const body = orderBody({ product, paymentMethod, phone });
    delete body.amount;
    const r = await postOrder(env, body);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(savedAmount(phone)).toBe(expected);
  });
});

// ============================================================
// BUG #5 — rate limit: one phone number could place unlimited orders
// ============================================================
describe('BUG #5: /api/order rate limiting', () => {
  let env;
  beforeEach(() => { env = makeEnv(provisionedDb()); });

  it('caps a single phone number instead of letting it through unbounded', { timeout: 60000 }, async () => {
    const phone = '9999888777';
    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const r = await postOrder(env, orderBody({ phone, amount: 500 + i }));
      if (r.status === 429) limited++;
      else if (r.status === 200) ok++;
    }
    // Request #1 runs the IP branch (seen_phone is not armed yet) and writes
    // seen_phone; requests #2..#11 hit the per-phone quota (10 allowed);
    // request #12 onwards is limited. So 11 get through in total — bounded,
    // where the old code let all 40 through.
    expect(ok).toBe(11);
    expect(limited).toBe(29);
  });

  it('still rate-limits distinct phones by IP (limiter itself keeps working)', { timeout: 60000 }, async () => {
    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const r = await postOrder(env, orderBody({ phone: '9' + String(100000000 + i), amount: 700 + i }));
      if (r.status === 429) limited++;
      else if (r.status === 200) ok++;
    }
    expect(ok).toBe(30);      // MAX_REQUESTS per IP per minute
    expect(limited).toBe(10); // the remainder
  });
});
