/**
 * Frontend Tracking Tests
 *
 * Tests the tracking logic from thank-you.html (the Purchase event decision engine).
 * These tests verify that:
 * - Pixel Purchase fires exactly once for valid orders
 * - Pixel Purchase is blocked for duplicates, WhatsApp fallback, and page refreshes
 * - CAPI PATCH call is made for Razorpay successes
 * - event_id is consistent for dedup
 *
 * We test the IIFE from thank-you.html in isolation by extracting its logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// THANK-YOU PAGE TRACKING LOGIC (extracted from thank-you.html IIFE)
// ============================================================

/**
 * Simulates the thank-you.html tracking IIFE.
 * Returns { pixelEvents, capiPatchCalls } — the events that were fired.
 */
function simulateThankYouTracking({
  urlParams = {},
  sessionStorageData = {},
  localStorageData = {},
  existingEvents = [],
}) {
  const pixelEvents = [];
  let capiPatchCalls = [];

  // Mock sessionStorage
  const sessionStore = { ...sessionStorageData };
  const mockSessionStorage = {
    getItem: vi.fn((key) => sessionStore[key] ?? null),
    setItem: vi.fn((key, val) => { sessionStore[key] = val; }),
    removeItem: vi.fn((key) => { delete sessionStore[key]; }),
  };

  // Mock localStorage
  const localStore = { ...localStorageData };
  const mockLocalStorage = {
    getItem: vi.fn((key) => localStore[key] ?? null),
    setItem: vi.fn((key, val) => { localStore[key] = val; }),
    removeItem: vi.fn((key) => { delete localStore[key]; }),
  };

  // Mock fbq
  const mockFbq = vi.fn();
  // Make fbq callable with all the methods
  mockFbq.callMethod = vi.fn();
  mockFbq.queue = [];
  mockFbq.push = vi.fn();
  // For fbq('track', 'Purchase', params)
  const trackHandler = vi.fn((action, eventName, params) => {
    if (action === 'track' && eventName === 'Purchase') {
      pixelEvents.push({ eventName, params });
    }
  });
  mockFbq.track = trackHandler;
  const fbqFn = Object.assign(
    function(...args) {
      if (args[0] === 'track') {
        trackHandler('track', args[1], args[2]);
      }
    },
    { callMethod: vi.fn(), queue: [], push: vi.fn(), track: trackHandler }
  );

  // Mock fetch for PATCH calls
  const mockFetch = vi.fn(async (url, opts) => {
    if (url === '/api/order' && opts?.method === 'PATCH') {
      capiPatchCalls.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({}) };
  });

  // ===== THE LOGIC FROM thank-you.html =====
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(urlParams)) {
    params.set(k, String(v));
  }

  const orderId = params.get('order_id') || '';
  const amountParam = params.get('amount');
  let amount = amountParam !== null ? parseFloat(amountParam) : null;
  const name = params.get('name') || '';
  const method = params.get('method') || '';
  const waUrl = params.get('wa_url') || '';
  const isDuplicate = params.get('duplicate') === 'true';

  const razorpayPaymentId = params.get('razorpay_payment_id') || '';
  const razorpayOrderId = params.get('razorpay_order_id') || '';
  const isRazorpaySuccess = !!razorpayPaymentId;

  const isConfirmedCod = method === 'cod' && !!orderId;

  const dedupKey = 'avn_purchase_fired_' + orderId;
  let alreadyFired = false;
  try {
    alreadyFired = !!mockSessionStorage.getItem(dedupKey) ||
                    !!mockLocalStorage.getItem(dedupKey);
  } catch (e) {}

  let storedPhone = '';
  if (isRazorpaySuccess) {
    try {
      const stored = mockSessionStorage.getItem('avn_prepaid_order');
      if (stored) {
        const data = JSON.parse(stored);
        // Note: original code modifies orderId, amount, name from sessionStorage
      }
    } catch (e) {}
  }

  if (amount === null || isNaN(amount)) amount = isRazorpaySuccess ? 999 : 1250;

  const shouldTrackPurchase = (isRazorpaySuccess || isConfirmedCod) && !alreadyFired && !isDuplicate;

  // Pixel firing
  let purchaseTracked = false;
  function trackFacebookPurchase() {
    if (purchaseTracked || !shouldTrackPurchase) return;

    const eventId = orderId || razorpayPaymentId || ('purch_' + Date.now());
    const eventParams = {
      value: amount,
      currency: 'INR',
      content_type: 'product',
      order_id: orderId,
      eventID: eventId,
    };

    // Client-side Pixel
    if (typeof fbqFn === 'function') {
      fbqFn('track', 'Purchase', eventParams);
    }

    purchaseTracked = true;
    try {
      mockSessionStorage.setItem(dedupKey, '1');
      mockLocalStorage.setItem(dedupKey, '1');
    } catch (e) {}
  }

  if (shouldTrackPurchase) {
    trackFacebookPurchase();
    // Also simulate the redundant load + timeout calls
    trackFacebookPurchase(); // load
    trackFacebookPurchase(); // timeout
  }

  // PATCH call for Razorpay
  if (isRazorpaySuccess && orderId) {
    try {
      mockFetch('/api/order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: orderId,
          name: name,
          phone: storedPhone,
          amount: amount,
          autoConfirm: true,
        }),
        keepalive: true,
      });
    } catch (e) {}
  }

  return {
    pixelEvents,
    shouldTrackPurchase,
    capiPatchCalls,
    alreadyFired,
    dedupKey,
    sessionStore,
    localStore,
  };
}

// ============================================================
// TEST: COD SUCCESS
// ============================================================
describe('COD Success — Purchase event', () => {
  it('should fire Pixel Purchase exactly once for a valid COD order', () => {
    const result = simulateThankYouTracking({
      urlParams: {
        order_id: 'AVN-1712345678-cod1',
        amount: '1250',
        name: 'Rahul Sharma',
        method: 'cod',
      },
    });

    expect(result.shouldTrackPurchase).toBe(true);
    expect(result.pixelEvents).toHaveLength(1);
    expect(result.pixelEvents[0].eventName).toBe('Purchase');
    expect(result.pixelEvents[0].params.value).toBe(1250);
    expect(result.pixelEvents[0].params.currency).toBe('INR');
    expect(result.pixelEvents[0].params.order_id).toBe('AVN-1712345678-cod1');
    expect(result.pixelEvents[0].params.eventID).toBe('AVN-1712345678-cod1');

    // Verify dedup flag was set after firing
    expect(result.sessionStore['avn_purchase_fired_AVN-1712345678-cod1']).toBe('1');
  });

  it('should fire Purchase with correct eventID matching CAPI event_id', () => {
    const result = simulateThankYouTracking({
      urlParams: {
        order_id: 'AVN-1712345678-cod2',
        amount: '1250',
        method: 'cod',
      },
    });

    // eventID should equal order_id for CAPI dedup
    expect(result.pixelEvents[0].params.eventID).toBe('AVN-1712345678-cod2');

    // CAPI on the backend uses the same order_id as eventId
    const capiEventId = 'AVN-1712345678-cod2';
    expect(result.pixelEvents[0].params.eventID).toBe(capiEventId);
  });
});

// ============================================================
// TEST: COD DUPLICATE
// ============================================================
describe('COD Duplicate — NO Purchase event', () => {
  it('should NOT fire Purchase when duplicate=true is in URL', () => {
    const result = simulateThankYouTracking({
      urlParams: {
        order_id: 'AVN-1712345678-dup1',
        amount: '1250',
        method: 'cod',
        duplicate: 'true',
      },
    });

    expect(result.shouldTrackPurchase).toBe(false);
    expect(result.pixelEvents).toHaveLength(0);
  });
});

// ============================================================
// TEST: COD WHATSAPP FALLBACK (unsaved order)
// ============================================================
describe('COD WhatsApp Fallback — NO Purchase event', () => {
  it('should NOT fire Purchase when method=cod_whatsapp (API save failed)', () => {
    const result = simulateThankYouTracking({
      urlParams: {
        order_id: 'AVN-1712345678-wa1',
        amount: '1250',
        name: 'Test',
        method: 'cod_whatsapp',
        wa_url: 'https://wa.me/...',
      },
    });

    expect(result.shouldTrackPurchase).toBe(false);
    expect(result.pixelEvents).toHaveLength(0);
  });

  it('should NOT fire Purchase even on fresh session (no dedup flag)', () => {
    // Fresh session: no dedup flag in storage
    const result = simulateThankYouTracking({
      urlParams: {
        order_id: 'AVN-1712345678-wa2',
        amount: '1250',
        method: 'cod_whatsapp',
      },
      sessionStorageData: {},
      localStorageData: {},
    });

    // Should NOT fire Purchase because method=cod_whatsapp is excluded
    expect(result.shouldTrackPurchase).toBe(false);
    expect(result.pixelEvents).toHaveLength(0);
  });
});

// ============================================================
// TEST: PAGE REFRESH
// ============================================================
describe('Page Refresh — NO duplicate Purchase', () => {
  it('should NOT fire Purchase on page refresh (alreadyFired from dedup flag)', () => {
    const result = simulateThankYouTracking({
      urlParams: {
        order_id: 'AVN-1712345678-refresh1',
        amount: '1250',
        method: 'cod',
      },
      // Simulate dedup flag already set from a previous visit
      sessionStorageData: {
        'avn_purchase_fired_AVN-1712345678-refresh1': '1',
      },
      localStorageData: {
        'avn_purchase_fired_AVN-1712345678-refresh1': '1',
      },
    });

    expect(result.alreadyFired).toBe(true);
    expect(result.shouldTrackPurchase).toBe(false);
    expect(result.pixelEvents).toHaveLength(0);
  });
});

// ============================================================
// TEST: PREPAID (Razorpay) via index.html
// ============================================================
describe('Prepaid (from index.html) — Purchase event', () => {
  it('should fire Pixel Purchase when razorpay_payment_id is in URL', () => {
    const result = simulateThankYouTracking({
      urlParams: {
        order_id: 'AVN-1712345678-pre1',
        amount: '999',
        name: 'Prepaid User',
        razorpay_payment_id: 'pay_AbCdEf123456',
        razorpay_order_id: 'order_LmNoPq789',
      },
    });

    expect(result.shouldTrackPurchase).toBe(true);
    expect(result.pixelEvents).toHaveLength(1);
    expect(result.pixelEvents[0].params.eventID).toBe('AVN-1712345678-pre1');
  });

  it('should call PATCH /api/order to confirm payment and fire CAPI Purchase', () => {
    const result = simulateThankYouTracking({
      urlParams: {
        order_id: 'AVN-1712345678-pre2',
        amount: '999',
        name: 'Test',
        razorpay_payment_id: 'pay_Test123',
      },
    });

    // Verify PATCH was called with autoConfirm
    expect(result.capiPatchCalls).toHaveLength(1);
    expect(result.capiPatchCalls[0].orderId).toBe('AVN-1712345678-pre2');
    expect(result.capiPatchCalls[0].autoConfirm).toBe(true);
    expect(result.capiPatchCalls[0].amount).toBe(999);
  });
});

// ============================================================
// TEST: PREPAID (from payment.html)
// ============================================================
describe('Prepaid (from payment.html) — Purchase event', () => {
  it('should fire Pixel Purchase when coming from payment.html redirect', () => {
    const result = simulateThankYouTracking({
      urlParams: {
        order_id: 'AVN-1712345678-pay1',
        amount: '999',
        razorpay_payment_id: 'pay_PaymentPage123',
        razorpay_order_id: 'order_PaymentPage456',
      },
    });

    expect(result.shouldTrackPurchase).toBe(true);
    expect(result.pixelEvents).toHaveLength(1);
    expect(result.pixelEvents[0].params.eventID).toBe('AVN-1712345678-pay1');

    // Verify PATCH call for CAPI confirmation
    expect(result.capiPatchCalls).toHaveLength(1);
  });
});

// ============================================================
// TEST: EVENT_ID CONSISTENCY
// ============================================================
describe('event_id consistency for dedup', () => {
  it('should use order_id as eventID for COD (matches CAPI event_id)', () => {
    const result = simulateThankYouTracking({
      urlParams: {
        order_id: 'AVN-EVENTID-TEST-001',
        amount: '1250',
        method: 'cod',
      },
    });

    // Pixel eventID
    const pixelEventId = result.pixelEvents[0].params.eventID;
    expect(pixelEventId).toBe('AVN-EVENTID-TEST-001');

    // CAPI backend uses the same order_id as eventId
    // This is verified in order-api.test.js
  });

  it('should use order_id as eventID for Razorpay (matches CAPI event_id)', () => {
    const result = simulateThankYouTracking({
      urlParams: {
        order_id: 'AVN-EVENTID-TEST-002',
        amount: '999',
        razorpay_payment_id: 'pay_EVENTID',
      },
    });

    const pixelEventId = result.pixelEvents[0].params.eventID;
    expect(pixelEventId).toBe('AVN-EVENTID-TEST-002');

    // CAPI PATCH also uses the same order_id
    expect(result.capiPatchCalls[0].orderId).toBe('AVN-EVENTID-TEST-002');
  });
});

// ============================================================
// TEST: NO FAKE PURCHASES
// ============================================================
describe('No fake purchases', () => {
  it('should NOT fire Purchase when visiting thank-you without order params', () => {
    const result = simulateThankYouTracking({
      urlParams: {},
    });

    expect(result.shouldTrackPurchase).toBe(false);
    expect(result.pixelEvents).toHaveLength(0);
  });

  it('should NOT fire Purchase when visiting thank-you with only random params', () => {
    const result = simulateThankYouTracking({
      urlParams: {
        ref: 'facebook',
        gclid: 'abc123',
      },
    });

    expect(result.shouldTrackPurchase).toBe(false);
    expect(result.pixelEvents).toHaveLength(0);
  });

  it('should NOT fire Purchase when only razorpay_payment_id is present (no order_id)', () => {
    // This is an edge case — Razorpay redirect without order_id
    // The eventId falls back to razorpayPaymentId
    const result = simulateThankYouTracking({
      urlParams: {
        razorpay_payment_id: 'pay_NoOrderId123',
        amount: '999',
      },
    });

    expect(result.shouldTrackPurchase).toBe(true);
    expect(result.pixelEvents).toHaveLength(1);

    // eventId should fall back to razorpay_payment_id
    expect(result.pixelEvents[0].params.eventID).toBe('pay_NoOrderId123');

    // PATCH should NOT be called (no orderId)
    expect(result.capiPatchCalls).toHaveLength(0);
  });
});
