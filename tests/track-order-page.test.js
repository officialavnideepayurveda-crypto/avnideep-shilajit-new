// ============================================================
// Public tracking page (track-order.html).
//
// Customers track with a MOBILE NUMBER only, so this must never
// require an order ID, and it must render every order found for
// that number.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const EXT_SCRIPT = /<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g;
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

function boot({ response, query = '' } = {}) {
  const html = read('track-order.html').replace(EXT_SCRIPT, '');
  const sent = [];
  const dom = new JSDOM(html, {
    url: 'https://avnideepayurveda.in/track-order' + query,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts) => {
        sent.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
        return Promise.resolve(response || { ok: true, json: async () => ({ ok: true, orders: [] }) });
      };
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    },
  });
  return { win: dom.window, sent };
}

function submit(w, phone) {
  w.document.getElementById('phone').value = phone;
  w.document.getElementById('trackForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}

const orderWithShipment = {
  order_id: 'AVN-10001',
  created_at: '2026-10-20T10:00:00.000Z',
  product: '6Pro Shilajit Capsules',
  amount: 2000,
  payment_method: 'cod',
  status: 'cod_order',
  status_label: 'Order placed (COD)',
  message: '',
  shipment: {
    awb: 'AWB123456',
    status: 'in_transit',
    status_label: 'In transit',
    expected_delivery_date: '2026-10-28T00:00:00.000Z',
    updated_at: '2026-10-24T09:00:00.000Z',
    timeline: [
      { label: 'In transit', at: '2026-10-24T09:00:00.000Z', location: 'Delhi' },
      { label: 'Shipment booked', at: '2026-10-22T09:00:00.000Z', location: 'Jaipur' },
    ],
  },
};

const orderWithoutShipment = {
  order_id: 'AVN-10002',
  created_at: '2026-10-21T10:00:00.000Z',
  product: 'Pain Relief Oil 60ml',
  amount: 349,
  payment_method: 'cod',
  status: 'cod_order',
  status_label: 'Order placed (COD)',
  shipment: null,
  message: 'Your order is confirmed. Tracking will appear after despatch.',
};

describe('track-order page', () => {
  it('tracks with the mobile number alone and sends no order ID', async () => {
    const { win, sent } = boot({
      response: { ok: true, json: async () => ({ ok: true, count: 1, orders: [orderWithShipment] }) },
    });
    submit(win, '+91 98765 43210');
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain('/api/track-order');
    expect(sent[0].body).toEqual({ phone: '9876543210', order_id: '', awb: '' });

    const result = win.document.getElementById('trackResult');
    expect(result.querySelectorAll('.trk-order')).toHaveLength(1);
    expect(result.textContent).toContain('AVN-10001');
    expect(result.textContent).toContain('AWB123456');
    expect(result.querySelectorAll('.trk-timeline li')).toHaveLength(2);
  });

  it('lists every order found for the number, newest first', async () => {
    const { win } = boot({
      response: { ok: true, json: async () => ({ ok: true, count: 2, orders: [orderWithShipment, orderWithoutShipment] }) },
    });
    submit(win, '9876543210');
    await settle();

    const result = win.document.getElementById('trackResult');
    const cards = [...result.querySelectorAll('.trk-order')];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('AVN-10001');
    expect(cards[1].textContent).toContain('AVN-10002');
    expect(cards[1].textContent).toContain('Tracking will appear after despatch');
    expect(result.textContent).toContain('2 orders found');
  });

  it('shows the API error without breaking the form', async () => {
    const { win } = boot({
      response: { ok: false, json: async () => ({ ok: false, error: 'No order found for this mobile number.' }) },
    });
    submit(win, '9999999999');
    await settle();

    const result = win.document.getElementById('trackResult');
    expect(result.querySelector('.trk-error').textContent).toContain('No order found');
    const btn = win.document.getElementById('trackBtn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Track my order');
  });

  it('rejects an invalid mobile number before calling the API', async () => {
    const { win, sent } = boot();
    submit(win, '123');
    await settle();

    expect(sent).toHaveLength(0);
    expect(win.document.getElementById('trackResult').querySelector('.trk-error').textContent).toMatch(/valid 10-digit mobile number/i);
  });

  it('prefills the number from ?phone=', async () => {
    const { win } = boot({ query: '?phone=9876543210' });
    expect(win.document.getElementById('phone').value).toBe('9876543210');
  });
});
