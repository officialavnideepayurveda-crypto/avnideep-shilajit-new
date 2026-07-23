/**
 * Tests for functions/api/order.js — Backend Order API
 *
 * Paths tested:
 * 1. COD success → order saved to D1 + CAPI Purchase fired
 * 2. COD duplicate → no order saved, no CAPI Purchase
 * 3. COD failure → returns error, no order saved
 * 4. Prepaid → InitiateCheckout CAPI (not Purchase)
 * 5. PATCH endpoint → Purchase CAPI with idempotency
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// MOCKS
// ============================================================

// Track all CAPI events sent
const capiEvents = [];

// Mock _capi.js module
vi.mock('../functions/api/_capi.js', () => ({
  sendCAPIEvent: vi.fn(async ({ env, eventName, eventId }) => {
    capiEvents.push({ eventName, eventId });
    return { events_received: 1 };
  }),
  buildUserData: vi.fn(async ({ name, phone, fbp, fbc, ip, ua, orderId }) => ({
    ph: 'hashed_phone_' + (phone || ''),
    fn: 'hashed_fn_' + (name?.split(' ')[0]?.toLowerCase() || ''),
    ln: 'hashed_ln_' + (name?.split(' ')?.slice(1)?.join(' ')?.toLowerCase() || ''),
    country: 'hashed_in',
    client_ip_address: ip || '127.0.0.1',
    client_user_agent: ua || '',
    fbp: fbp || '',
    fbc: fbc || '',
    external_id: orderId ? 'hashed_order_' + orderId : '',
  })),
  buildCustomData: vi.fn(({ value, currency = 'INR', orderId, contentName }) => ({
    value: Number(value) || 0,
    currency,
    content_name: contentName || 'AVN-6PRO-001',
    content_type: 'product',
    ...(orderId ? { order_id: String(orderId) } : {}),
  })),
}));

// Mock D1 database
function createMockD1() {
  const store = new Map();
  const purchaseFlags = new Map();

  return {
    _store: store,
    _purchaseFlags: purchaseFlags,

    prepare: vi.fn((sql) => {
      const mockStmt = {
        bind: vi.fn((...args) => {
          const stmt = {
            run: vi.fn(async () => {
              // Handle INSERT
              if (sql.trim().startsWith('INSERT')) {
                const orderId = args[0];
                if (store.has(orderId)) {
                  throw new Error('UNIQUE constraint failed');
                }
                store.set(orderId, {
                  order_id: orderId,
                  name: args[1],
                  phone: args[2],
                  payment_method: args[5],
                  amount: args[6],
                });
                return { success: true };
              }
              // Handle UPDATE
              if (sql.trim().startsWith('UPDATE')) {
                // UPDATE orders SET purchase_capi_sent = 1 WHERE order_id = ?
                if (args.length === 1 && args[0] && sql.includes('purchase_capi_sent')) {
                  purchaseFlags.set(args[0], 1);
                  return { meta: { changes: 1 } };
                }
                // UPDATE orders SET utr = ?, status = ? WHERE order_id = ?
                if (args.length >= 2) {
                  // UTR update
                  return { success: true };
                }
                return { success: true };
              }
              return { success: true };
            }),
            first: vi.fn(async () => {
              // Handle SELECT purchase_capi_sent
              if (sql.includes('purchase_capi_sent')) {
                const orderId = args[0];
                if (!store.has(orderId)) return null;
                return { purchase_capi_sent: purchaseFlags.get(orderId) || 0 };
              }
              // Handle SELECT order_id FROM orders WHERE order_id = ?
              if (sql.includes('WHERE order_id =')) {
                const orderId = args[0];
                if (store.has(orderId)) return { order_id: orderId };
                return null;
              }
              // Handle SELECT order_id, amount, created_at FROM orders WHERE phone = ?
              if (sql.includes('WHERE phone =')) {
                // Find the most recent order for this phone
                const phone = args[0];
                let lastOrder = null;
                for (const [id, order] of store) {
                  if (order.phone === phone) {
                    lastOrder = { order_id: id, amount: order.amount, created_at: new Date().toISOString() };
                  }
                }
                return lastOrder;
              }
              return null;
            }),
          };
          return stmt;
        }),
        first: vi.fn(async () => null),
        run: vi.fn(async () => ({ success: true })),
      };

      // Handle raw preparation for CREATE TABLE
      if (sql.trim().startsWith('CREATE')) {
        return mockStmt;
      }

      // For ALTER TABLE, simulate success
      if (sql.trim().startsWith('ALTER')) {
        return mockStmt;
      }

      return mockStmt;
    }),

    // Helper to check state
    hasOrder(orderId) { return store.has(orderId); },
    getPurchaseCapiSent(orderId) { return purchaseFlags.get(orderId) || 0; },
    reset() { store.clear(); purchaseFlags.clear(); capiEvents.length = 0; },
  };
}

// ============================================================
// SETUP
// ============================================================

let mockD1;
let mockEnv;

beforeEach(() => {
  capiEvents.length = 0;
  mockD1 = createMockD1();
  mockEnv = {
    DB: mockD1,
    ALLOWED_ORIGIN: '*',
    META_ACCESS_TOKEN: 'test-token',
    META_PIXEL_ID: '123456789',
  };
});

// ============================================================
// TEST: COD SUCCESS
// ============================================================
describe('COD order — success path', () => {
  it('should save order to D1, fire Purchase CAPI, and return ok', async () => {
    const { onRequestPost } = await import('../functions/api/order.js');

    const body = {
      orderId: 'AVN-1712345678-test1',
      name: 'Rahul Sharma',
      phone: '9876543210',
      paymentMethod: 'cod',
      amount: 1250,
      product: 'Avnideep 6Pro Vitality Shilajit Capsules',
    };

    const request = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42' },
      body: JSON.stringify(body),
    });

    const response = await onRequestPost({ request, env: mockEnv, waitUntil: vi.fn() });
    const data = await response.json();

    // Verify response
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.orderId).toBe('AVN-1712345678-test1');
    expect(data.duplicate).toBe(false);

    // Verify order saved to D1
    expect(mockD1.hasOrder('AVN-1712345678-test1')).toBe(true);

    // Verify CAPI Purchase event fired
    const purchaseEvents = capiEvents.filter(e => e.eventName === 'Purchase');
    expect(purchaseEvents).toHaveLength(1);
    expect(purchaseEvents[0].eventId).toBe('AVN-1712345678-test1');

    // Verify InitiateCheckout was NOT fired for COD
    const icoEvents = capiEvents.filter(e => e.eventName === 'InitiateCheckout');
    expect(icoEvents).toHaveLength(0);

    // Verify purchase_capi_sent was marked
    expect(mockD1.getPurchaseCapiSent('AVN-1712345678-test1')).toBe(1);
  });
});

// ============================================================
// TEST: COD DUPLICATE
// ============================================================
describe('COD order — duplicate path', () => {
  it('should return duplicate:true and NOT fire CAPI Purchase', async () => {
    const { onRequestPost } = await import('../functions/api/order.js');

    // First order — save normally
    const body1 = {
      orderId: 'AVN-1712345678-dup1',
      name: 'Test User',
      phone: '9876543210',
      paymentMethod: 'cod',
      amount: 1250,
    };

    const req1 = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42' },
      body: JSON.stringify(body1),
    });
    await onRequestPost({ request: req1, env: mockEnv, waitUntil: vi.fn() });

    // Clear events from first order
    capiEvents.length = 0;

    // Second order — exact same orderId (duplicate by order_id)
    const body2 = {
      orderId: 'AVN-1712345678-dup1',
      name: 'Test User',
      phone: '9876543210',
      paymentMethod: 'cod',
      amount: 1250,
    };

    const req2 = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42' },
      body: JSON.stringify(body2),
    });
    const response2 = await onRequestPost({ request: req2, env: mockEnv, waitUntil: vi.fn() });
    const data2 = await response2.json();

    // Verify duplicate detection
    expect(response2.status).toBe(200);
    expect(data2.ok).toBe(true);
    expect(data2.duplicate).toBe(true);
    expect(data2.orderId).toBe('AVN-1712345678-dup1');

    // Verify NO CAPI Purchase event was fired for the duplicate
    const purchaseEvents = capiEvents.filter(e => e.eventName === 'Purchase');
    expect(purchaseEvents).toHaveLength(0);
  });

  it('should detect duplicate by phone+amount within 30 seconds', async () => {
    const { onRequestPost } = await import('../functions/api/order.js');

    // First order with unique ID
    const body1 = {
      orderId: 'AVN-1712345678-dup2a',
      name: 'Test User',
      phone: '9876543210',
      paymentMethod: 'cod',
      amount: 1250,
    };

    const req1 = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42' },
      body: JSON.stringify(body1),
    });
    const res1 = await onRequestPost({ request: req1, env: mockEnv, waitUntil: vi.fn() });
    expect((await res1.json()).ok).toBe(true);

    // Clear events
    capiEvents.length = 0;

    // Second order with DIFFERENT ID but same phone+amount
    const body2 = {
      orderId: 'AVN-1712345678-dup2b',
      name: 'Test User',
      phone: '9876543210',
      paymentMethod: 'cod',
      amount: 1250,
    };

    const req2 = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42' },
      body: JSON.stringify(body2),
    });
    const res2 = await onRequestPost({ request: req2, env: mockEnv, waitUntil: vi.fn() });
    const data2 = await res2.json();

    // Should be detected as duplicate
    expect(data2.duplicate).toBe(true);

    // Verify NO Purchase CAPI fired
    expect(capiEvents.filter(e => e.eventName === 'Purchase')).toHaveLength(0);
  });
});

// ============================================================
// TEST: COD FAILURE (no D1)
// ============================================================
describe('COD order — failure path', () => {
  it('should return 500 error when D1 is not configured', async () => {
    const { onRequestPost } = await import('../functions/api/order.js');

    const noDbEnv = {
      ...mockEnv,
      DB: null, // No D1 configured
      META_ACCESS_TOKEN: 'test-token',
      META_PIXEL_ID: '123456789',
    };

    const body = {
      orderId: 'AVN-1712345678-fail1',
      name: 'Test User',
      phone: '9876543210',
      paymentMethod: 'cod',
      amount: 1250,
    };

    const request = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42' },
      body: JSON.stringify(body),
    });

    const response = await onRequestPost({ request, env: noDbEnv, waitUntil: vi.fn() });

    // D1 not configured → should fail
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.ok).toBe(false);
  });
});

// ============================================================
// TEST: PREPAID (InitiateCheckout, not Purchase)
// ============================================================
describe('Prepaid order — InitiateCheckout path', () => {
  it('should fire InitiateCheckout CAPI (not Purchase) on POST', async () => {
    const { onRequestPost } = await import('../functions/api/order.js');

    const body = {
      orderId: 'AVN-1712345678-pre1',
      name: 'Prepaid User',
      phone: '9876543210',
      paymentMethod: 'prepaid',
      amount: 999,
      status: 'payment_pending',
    };

    const request = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42' },
      body: JSON.stringify(body),
    });

    const response = await onRequestPost({ request, env: mockEnv, waitUntil: vi.fn() });
    expect(response.status).toBe(200);

    // Verify InitiateCheckout was fired
    const icoEvents = capiEvents.filter(e => e.eventName === 'InitiateCheckout');
    expect(icoEvents).toHaveLength(1);

    // Verify Purchase was NOT fired on POST
    const purchEvents = capiEvents.filter(e => e.eventName === 'Purchase');
    expect(purchEvents).toHaveLength(0);
  });
});

// ============================================================
// TEST: PATCH ENDPOINT (Purchase confirmation)
// ============================================================
describe('PATCH /api/order — confirm prepaid payment', () => {
  it('should fire Purchase CAPI with idempotency check', async () => {
    const { onRequestPost, onRequestPatch } = await import('../functions/api/order.js');

    // First: Create a prepaid order via POST
    const postBody = {
      orderId: 'AVN-1712345678-patch1',
      name: 'Prepaid User',
      phone: '9876543210',
      paymentMethod: 'prepaid',
      amount: 999,
    };

    const postReq = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42' },
      body: JSON.stringify(postBody),
    });
    const postRes = await onRequestPost({ request: postReq, env: mockEnv, waitUntil: vi.fn() });
    const postData = await postRes.json();
    expect(postData.ok).toBe(true);

    // Clear events
    capiEvents.length = 0;

    // Second: Confirm via PATCH (as thank-you.html does)
    const patchBody = {
      orderId: 'AVN-1712345678-patch1',
      name: 'Prepaid User',
      phone: '9876543210',
      amount: 999,
      autoConfirm: true,
    };

    const patchReq = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42' },
      body: JSON.stringify(patchBody),
    });
    const patchRes = await onRequestPatch({ request: patchReq, env: mockEnv });
    const patchData = await patchRes.json();

    expect(patchRes.status).toBe(200);
    expect(patchData.ok).toBe(true);

    // Verify Purchase CAPI was fired with correct eventId
    const purchaseEvents = capiEvents.filter(e => e.eventName === 'Purchase');
    expect(purchaseEvents).toHaveLength(1);
    expect(purchaseEvents[0].eventId).toBe('AVN-1712345678-patch1');
  });

  it('should NOT fire Purchase CAPI twice for the same order (idempotency)', async () => {
    const { onRequestPost, onRequestPatch } = await import('../functions/api/order.js');

    // Step 1: Create order via POST
    const postBody = {
      orderId: 'AVN-1712345678-patch2',
      name: 'Test User',
      phone: '9876543210',
      paymentMethod: 'prepaid',
      amount: 999,
    };

    const postReq = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody),
    });
    await onRequestPost({ request: postReq, env: mockEnv, waitUntil: vi.fn() });

    // Clear events
    capiEvents.length = 0;

    // Step 2: First PATCH — should fire Purchase
    const patchBody1 = {
      orderId: 'AVN-1712345678-patch2',
      name: 'Test User',
      phone: '9876543210',
      amount: 999,
      autoConfirm: true,
    };

    const patchReq1 = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody1),
    });
    const res1 = await onRequestPatch({ request: patchReq1, env: mockEnv });
    expect((await res1.json()).ok).toBe(true);

    expect(capiEvents.filter(e => e.eventName === 'Purchase')).toHaveLength(1);

    // Step 3: Second PATCH — should NOT fire Purchase (idempotent)
    capiEvents.length = 0;
    const patchBody2 = {
      orderId: 'AVN-1712345678-patch2',
      name: 'Test User',
      phone: '9876543210',
      amount: 999,
      autoConfirm: true,
    };

    const patchReq2 = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody2),
    });
    const res2 = await onRequestPatch({ request: patchReq2, env: mockEnv });
    expect((await res2.json()).ok).toBe(true);

    // Should be blocked by purchase_capi_sent = 1
    expect(capiEvents.filter(e => e.eventName === 'Purchase')).toHaveLength(0);
  });

  it('should require orderId for PATCH', async () => {
    const { onRequestPatch } = await import('../functions/api/order.js');

    const patchBody = { amount: 999, autoConfirm: true };

    const patchReq = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    });
    const res = await onRequestPatch({ request: patchReq, env: mockEnv });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('orderId');
  });
});

// ============================================================
// TEST: VALIDATION
// ============================================================
describe('Order API — validation', () => {
  it('should reject missing required fields', async () => {
    const { onRequestPost } = await import('../functions/api/order.js');

    const body = { orderId: 'AVN-test' }; // Missing name, phone, paymentMethod, amount

    const request = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await onRequestPost({ request, env: mockEnv, waitUntil: vi.fn() });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Missing fields');
  });

  it('should reject invalid phone numbers', async () => {
    const { onRequestPost } = await import('../functions/api/order.js');

    const body = {
      orderId: 'AVN-test',
      name: 'Test User',
      phone: '12345', // Invalid — doesn't start with 6-9, not 10 digits
      paymentMethod: 'cod',
      amount: 1250,
    };

    const request = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await onRequestPost({ request, env: mockEnv, waitUntil: vi.fn() });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.ok).toBe(false);
  });

  it('should reject CSRF from unknown origins', async () => {
    const { onRequestPost } = await import('../functions/api/order.js');

    const restrictedEnv = {
      ...mockEnv,
      ALLOWED_ORIGIN: 'https://shop.avnideepayurveda.in',
    };

    const body = {
      orderId: 'AVN-test-csrf',
      name: 'Attacker',
      phone: '9876543210',
      paymentMethod: 'cod',
      amount: 1250,
    };

    const request = new Request('https://shop.avnideepayurveda.in/api/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://evil.com',
        'CF-Connecting-IP': '203.0.113.99',
      },
      body: JSON.stringify(body),
    });
    const response = await onRequestPost({ request, env: restrictedEnv, waitUntil: vi.fn() });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain('Access denied');
  });
});
