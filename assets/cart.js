/* ==========================================================================
   AVNIDEEP CART — localStorage cart + slide-in drawer (Renee-style)
   Works on every page. No backend change: single-product carts route to the
   existing order popup (keeps Meta Pixel + CAPI funnel intact), mixed carts
   route to WhatsApp order with itemised message.
   ========================================================================== */
(function () {
  'use strict';

  // PRICING RULE — one rule for the whole site (server twin:
  // functions/api/_lib/pricing.js). Three options per product, all from one
  // configurable price triple (admin/D1 `products` row):
  //   cod      = "Pay on Delivery" total (MRP by default)
  //   advance  = "Book with ₹X" TOTAL (defaults to COD when not configured)
  //   prepaid  = MRP - 20% by default (or the explicit admin price)
  // Fields left 0 are DERIVED so a line item can never carry a made-up number.
  var PREPAID_OFF = 0.2;

  function posInt(n) {
    var v = Math.round(Number(n));
    return (isFinite(v) && v > 0) ? v : 0;
  }

  function computePrices(mrp, explicit) {
    var m = Math.max(0, Math.round(Number(mrp) || 0));
    var e = explicit || {};
    var cod = posInt(e.cod) || m;
    var prepaid = posInt(e.prepaid) || Math.round(m * (1 - PREPAID_OFF));
    var advance = posInt(e.advance) || cod;
    return { mrp: m, cod: cod, advance: advance, prepaid: prepaid };
  }

  var PRODUCTS = {
    shilajit: {
      id: 'shilajit', sku: 'AVN-6PRO-001',
      name: '6Pro Shilajit Capsules', variant: '30 Capsules',
      img: 'https://cdn.avnideepayurveda.in/home/assets/shilajit-1.png',
      // MRP only — COD/prepaid are derived from it below (and from the
      // admin/D1 MRP by site-sync.js once /api/products answers).
      mrp: 1250,
      // Configured booking-advance TOTAL (₹100 now + ₹1,100 on delivery).
      explicit: { advance: 1200 },
      url: '/shilajit/'
    },
    oil: {
      id: 'oil', sku: 'AVN-OIL-001',
      name: 'Pain Relief Oil', variant: '60ml',
      img: 'https://cdn.avnideepayurveda.in/pain-oil/oil-1.png',
    mrp: 349, // COD 349; advance total 320 (₹100 now + ₹220 later); prepaid 299
      explicit: { advance: 320, prepaid: 299 },
      url: '/pain-oil/'
    },
    shilajit2: {
      id: 'shilajit2', sku: 'AVN-6PRO-002',
      name: '6Pro Shilajit Capsules', variant: 'Pack of 2',
      img: 'https://cdn.avnideepayurveda.in/home/assets/packs/shilajit-2.png',
      mrp: 2500, // COD 2500, prepaid 2000
      url: '/shilajit/'
    },
    shilajit3: {
      id: 'shilajit3', sku: 'AVN-6PRO-003',
      name: '6Pro Shilajit Capsules', variant: 'Pack of 3',
      img: 'https://cdn.avnideepayurveda.in/home/assets/packs/shilajit-3.png',
      mrp: 3750, // COD 3750, prepaid 3000
      url: '/shilajit/'
    },
    oil2: {
      id: 'oil2', sku: 'AVN-OIL-002',
      name: 'Pain Relief Oil', variant: 'Pack of 2',
      img: 'https://cdn.avnideepayurveda.in/home/assets/packs/oil-2.png',
    mrp: 698, // COD 698, prepaid 558
      url: '/pain-oil/'
    },
    oil3: {
      id: 'oil3', sku: 'AVN-OIL-003',
      name: 'Pain Relief Oil', variant: 'Pack of 3',
      img: 'https://cdn.avnideepayurveda.in/home/assets/packs/oil-3.png',
    mrp: 1047, // COD 1047, prepaid 838
      url: '/pain-oil/'
    },
    hair: {
      id: 'hair', sku: 'AVN-HAIR-001',
      name: 'Herbal Hair Oil', variant: '100ml',
      img: 'https://cdn.avnideepayurveda.in/hair-oil/gallery/g1.webp',
      mrp: 499, // COD 499, prepaid 399 (no admin row yet)
      url: '/hair-oil/'
    },
    hair2: {
      id: 'hair2', sku: 'AVN-HAIR-002',
      name: 'Herbal Hair Oil', variant: 'Pack of 2',
      img: 'https://cdn.avnideepayurveda.in/hair-oil/gallery/g1.webp',
      mrp: 998, // COD 998, prepaid 798
      url: '/hair-oil/'
    },
    hair3: {
      id: 'hair3', sku: 'AVN-HAIR-003',
      name: 'Herbal Hair Oil', variant: 'Pack of 3',
      img: 'https://cdn.avnideepayurveda.in/hair-oil/gallery/g1.webp',
      mrp: 1497, // COD 1497, prepaid 1198
      url: '/hair-oil/'
    },
    balm: {
      id: 'balm', sku: 'AVN-BALM-001',
      name: 'Herbal Balm', variant: '10g Pack of 5',
      img: 'https://cdn.avnideepayurveda.in/herbal-balm/gallery/g1.webp',
      mrp: 349, // COD 349, prepaid 279 (no admin row yet)
      url: '/herbal-balm/'
    },
    balm2: {
      id: 'balm2', sku: 'AVN-BALM-002',
      name: 'Herbal Balm', variant: 'Pack of 2',
      img: 'https://cdn.avnideepayurveda.in/herbal-balm/gallery/g1.webp',
      mrp: 698, // COD 698, prepaid 558
      url: '/herbal-balm/'
    },
    balm3: {
      id: 'balm3', sku: 'AVN-BALM-003',
      name: 'Herbal Balm', variant: 'Pack of 3',
      img: 'https://cdn.avnideepayurveda.in/herbal-balm/gallery/g1.webp',
      mrp: 1047, // COD 1047, prepaid 838
      url: '/herbal-balm/'
    }
  };

  // Derive the three selling prices from the MRP exactly once, at load.
  Object.keys(PRODUCTS).forEach(function (k) {
    var pr = computePrices(PRODUCTS[k].mrp, PRODUCTS[k].explicit);
    PRODUCTS[k].cod = pr.cod;
    PRODUCTS[k].advance = pr.advance;
    PRODUCTS[k].prepaid = pr.prepaid;
    PRODUCTS[k].mrp = pr.mrp;
  });

  var KEY = 'avn_cart_v1';

  /* ---------- admin catalog overrides (set by site-sync.js from /api/products) ---------- */
  function AP() { return window.AVN_ADMIN_PRODUCTS || {}; }
  function isOOS(id) { return !!(window.AVN_OOS && window.AVN_OOS[id]); }
  function P(id) {
    var o = AP()[id];
    if (!o) return PRODUCTS[id];
    var base = PRODUCTS[id] || { id: id, variant: '', url: '/' };
    // The admin/D1 row is the source of truth: its explicit COD / advance /
    // prepaid prices win; any field left 0 is derived from the MRP.
    var pr = computePrices(o.mrp != null && o.mrp > 0 ? o.mrp : base.mrp, {
      cod: o.price_cod != null ? o.price_cod : o.cod,
      advance: o.price_advance != null ? o.price_advance : o.advance,
      prepaid: o.price_prepaid != null ? o.price_prepaid : o.prepaid
    });
    return {
      id: id, sku: o.sku || base.sku || id,
      name: o.name || base.name, variant: base.variant,
      img: o.img || base.img,
      cod: pr.cod,
      advance: pr.advance,
      prepaid: pr.prepaid,
      mrp: pr.mrp,
      url: base.url
    };
  }

  /* ---------- storage ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function store() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) {} publishState(); }
  var cart = load();
  var dropped = false;

  /* ---------- helpers ---------- */
  function ids() { return Object.keys(cart).filter(function (k) { return cart[k] > 0; }); }
  function itemCount() { var n = 0; ids().forEach(function (k) { n += cart[k]; }); return n; }
  function sum(fn) { var s = 0; ids().forEach(function (k) { var p = P(k); if (p) s += fn(p) * cart[k]; }); return s; }
  function inr(n) { return '₹' + n.toLocaleString('en-IN'); }
  function track(event, params) { try { if (typeof fbq === 'function') fbq('track', event, params); } catch (e) {} }

  function sub(totalSo) { return sum(function (p) { return p.cod; }); }

  /* ---------- drawer DOM (built once) ---------- */
  var ov, dr;
  function build() {
    if (dr) return;
    ov = document.createElement('div');
    ov.className = 'cart-ov'; ov.setAttribute('data-cart-close', '');
    dr = document.createElement('aside');
    dr.className = 'cart-dr'; dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-label', 'Your cart');
    dr.innerHTML =
      '<div class="cart-h">' +
        '<div><b>Your Cart</b><span class="cart-sub" data-cart-sub>0 items</span></div>' +
        '<button type="button" class="cart-x" data-cart-close aria-label="Close cart">&times;</button>' +
      '</div>' +
      '<div class="cart-ship" data-cart-ship></div>' +
      '<div class="cart-items" data-cart-items></div>' +
      '<div class="cart-f">' +
        '<div class="cart-save" data-cart-save></div>' +
        '<div class="cart-row"><span>Subtotal</span><b data-cart-total>₹0</b></div>' +
        '<div class="cart-row cart-shipline"><span>Delivery</span><b data-cart-del>—</b></div>' +
        '<button type="button" class="cart-btn" data-cart-checkout>Checkout — COD / Prepaid</button>' +
        '<button type="button" class="cart-btn2" data-cart-wa>Order on WhatsApp</button>' +
        '<p class="cart-note">7-day easy returns • Lab tested • Free shipping</p>' +
      '</div>';
    document.body.appendChild(ov);
    document.body.appendChild(dr);
  }

  /* ---------- render ---------- */
  function renderBadge() {
    var n = itemCount();
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = n;
      el.classList.toggle('on', n > 0);
    });
  }

  function render() {
    build();
    renderBadge();
    var list = dr.querySelector('[data-cart-items]');
    var n = itemCount();
    dr.querySelector('[data-cart-sub]').textContent = n + (n === 1 ? ' item' : ' items');

    if (!n) {
      list.innerHTML =
        '<div class="cart-empty">' +
        '<div class="e-ico">🛍️</div><b>Cart khaali hai</b>' +
        '<p>Shilajit, Pain Oil, Hair Oil ya Balm add karein — COD available, free shipping</p>' +
        '<a class="cart-btn2" href="/#products">Shop Bestsellers</a>' +
        '</div>';
    } else {
      list.innerHTML = ids().map(function (k) {
        var p = P(k), q = cart[k];
        if (!p) return '';
        var preSave = p.cod - p.prepaid;
        return '' +
        '<div class="cart-it" data-key="' + k + '">' +
          '<img src="' + p.img + '" alt="' + p.name + '">' +
          '<div class="it-b">' +
            '<b>' + p.name + '</b><span class="it-v">' + p.variant + '</span>' +
            '<div class="it-p">' + inr(p.cod) +
              (preSave > 0 ? ' <em>prepaid ' + inr(p.prepaid) + ' \u00b7 20% off</em>' : '') + '</div>' +
            '<div class="it-q">' +
              '<button type="button" data-cart-dec aria-label="Decrease">−</button>' +
              '<span>' + q + '</span>' +
              '<button type="button" data-cart-inc aria-label="Increase">+</button>' +
              '<button type="button" class="it-rm" data-cart-rm>Remove</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<b class="it-lt">' + inr(p.cod * q) + '</b>' +
        '</div>';
      }).join('');
    }

    /* shipping — always free, so the drawer total matches the order total */
    var st = sub();
    var ship = dr.querySelector('[data-cart-ship]');
    if (!n) { ship.style.display = 'none'; }
    else {
      ship.style.display = '';
      ship.innerHTML = '<div class="ok">🎉 <b>FREE delivery</b> on all orders</div><div class="bar"><i style="width:100%"></i></div>';
    }

    /* totals — the drawer quotes the method the customer last chose
       (Prepaid is the site default), so the figure here is the same one the
       checkout will open with. Every line still shows both prices. */
    var mrpS = sum(function (p) { return p.mrp; });
    var preS = sum(function (p) { return p.prepaid; });
    var advS = sum(function (p) { return p.advance; });
    var method = '';
    try { method = localStorage.getItem('avn_pay_pref') || ''; } catch (e) {}
    if (method !== 'C' && method !== 'A' && method !== 'P') {
      method = (PAY && PAY.default_method === 'cod') ? 'C' : (PAY && PAY.default_method === 'advance') ? 'A' : 'P';
    }
    var shown = method === 'C' ? st : (method === 'A' ? advS : preS);
    dr.querySelector('[data-cart-total]').textContent = inr(shown);
    var lbl = dr.querySelector('.cart-f .cart-row span');
    if (lbl) lbl.textContent = method === 'C' ? 'Subtotal (COD)' : (method === 'A' ? 'Subtotal (Advance + COD)' : 'Subtotal (Prepaid)');
    dr.querySelector('[data-cart-del]').textContent = !n ? '—' : 'FREE';
    // COD is the MRP price, so the only saving that exists is the prepaid 20%.
    var saved = st - (method === 'A' ? advS : preS);
    dr.querySelector('[data-cart-save]').innerHTML = (saved > 0 && n)
      ? (method === 'A' ? 'Advance booking discount \u2014 bachat: ' : 'Prepaid par 20% off \u2014 bachat: ') + '<b>' + inr(saved) + '</b>'
      : '';

    var co = dr.querySelector('[data-cart-checkout]');
    co.disabled = !n;
    co.textContent = n ? 'Checkout — ' + inr(shown) : 'Checkout';
  }

  /* ---------- open / close ---------- */
  function openDr() { build(); render(); document.documentElement.classList.add('cart-lock'); ov.classList.add('on'); dr.classList.add('on'); }
  function closeDr() { if (!dr) return; document.documentElement.classList.remove('cart-lock'); ov.classList.remove('on'); dr.classList.remove('on'); }

  /* ---------- actions ---------- */
  function add(id, q) {
    if (!P(id) || isOOS(id)) return;
    cart[id] = (cart[id] || 0) + (q || 1);
    store(); renderBadge();
    track('AddToCart', { content_ids: [P(id).sku], content_name: P(id).name, value: P(id).cod * (q || 1), currency: 'INR' });
    openDr();
  }

  /* ---------- cart item -> PDP family ---------- */
  function pageOf(id) {
    if (id.indexOf('shilajit') === 0) return 'shilajit';
    if (id.indexOf('hair') === 0) return 'hair';
    if (id.indexOf('balm') === 0) return 'balm';
    if (id.indexOf('oil') === 0) return 'oil';
    return null;
  }

  function packOf(id) {
    var page = pageOf(id);
    if (!page) return 1;
    var tail = String(id).slice(page.length);
    var i = tail ? parseInt(tail, 10) : 1;
    return (i >= 1 && i <= 3) ? i : 1;
  }

  function syncPack(id) {
    var page = pageOf(id);
    if (!page) return;
    var tail = id.slice(page.length); // '' | '2' | '3'
    var i = tail ? (parseInt(tail, 10) - 1) : 0;
    if (!(i >= 0 && i <= 2)) i = 0;
    try { localStorage.setItem('avn_pack', JSON.stringify({ page: page, i: i })); } catch (e) {}
    // Keep the three payment cards in step with the pack the customer picked.
    try { if (typeof renderPayUI === 'function' && PAY_READY) renderPayUI(PAY); } catch (e) {}
  }

  function familyOf(id) { return pageOf(id); }

  // The pack the current product page is showing. The page bundles save the
  // selection in avn_pack; when that is missing (first paint, direct visit) the
  // URL family identifies the catalogue page, so the payment cards are never
  // priced from a zeroed placeholder.
  function pageFromPath() {
    var p = '';
    try { p = String(location.pathname || ''); } catch (e) {}
    if (/pain-oil/i.test(p)) return 'oil';
    if (/hair-oil/i.test(p)) return 'hair';
    if (/herbal-balm/i.test(p)) return 'balm';
    if (/shilajit/i.test(p)) return 'shilajit';
    return 'shilajit';
  }
  function activePack() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('avn_pack') || 'null'); } catch (e) {}
    var page = saved && saved.page && P(saved.page) ? saved.page : pageFromPath();
    var i = saved && saved.page === page ? parseInt(saved.i, 10) : 0;
    return packPrice(page, i);
  }

  /* ---------- cart -> checkout pricing state ---------- */
  // Set when the customer pressed Checkout (or landed with ?open=1). It tells
  // the order popup to price the WHOLE cart, including a cart that holds two
  // packs of the same product family or a quantity > 1. Without it a single
  // family cart is priced from avn_pack and its quantity was ignored.
  var cartCheckout = false;
  function cartState() {
    var ks = ids().filter(function (k) { return !!P(k); });
    var fams = {}, items = [], codTotal = 0, advanceTotal = 0, prepaidTotal = 0, mrpTotal = 0;
    ks.forEach(function (k) {
      var p = P(k), f = pageOf(k), qty = cart[k];
      if (!p || !f) return;
      fams[f] = true;
      // Keep the UNIT price separately: the line subtotal below is always
      // unit price x quantity (never a pre-computed or grand total).
      items.push({
        id: k, name: p.name, variant: p.variant, family: f, url: p.url,
        pack: packOf(k), qty: qty,
        unitCod: p.cod, unitAdvance: p.advance, unitPrepaid: p.prepaid, unitMrp: p.mrp,
        cod: p.cod * qty, advance: p.advance * qty, prepaid: p.prepaid * qty, mrp: p.mrp * qty
      });
      codTotal += p.cod * qty;
      advanceTotal += p.advance * qty;
      prepaidTotal += p.prepaid * qty;
      mrpTotal += p.mrp * qty;
    });
    var families = Object.keys(fams);
    return {
      mixed: families.length > 1,
      fromCart: cartCheckout,
      families: families,
      items: items,
      count: itemCount(),
      lineCount: items.length,
      codTotal: codTotal,
      advanceTotal: advanceTotal,
      prepaidTotal: prepaidTotal,
      mrpTotal: mrpTotal
    };
  }
  function publishState() {
    try { window.AVN_CART_STATE = cartState(); } catch (e) {}
  }

  /* Price of one pack, from the same catalogue P() uses (hard-coded PRODUCTS
     plus the admin/DB overrides in window.AVN_ADMIN_PRODUCTS). Every checkout
     surface (PDP inline script, app bundle, homepage) reads this so a price
     shown on the page can never drift from the price in the cart/summary. */
  function packPrice(page, idx) {
    var i = parseInt(idx, 10); if (!(i >= 0 && i <= 2)) i = 0;
    var id = page + (i > 0 ? String(i + 1) : '');
    var p = P(id);
    if (!p) return null;
    return { id: id, pre: p.prepaid, adv: p.advance, cod: p.cod, mrp: p.mrp, sku: p.sku, name: p.name, variant: p.variant };
  }

  /* ---------- checkout summary (single source of truth for the paint) ---------- */
  var ADVANCE_DEFAULT = 100;
  function fmtINR(n) { return '\u20b9' + Number(n || 0).toLocaleString('en-IN'); }

  // Normalised price model shared by the summary, the button copy, the Razorpay
  // gateway amount and the /api/order payload.
  //  - mixed cart: subtotal = sum of the COD line totals; the per-item rows sum
  //    to it, the prepaid discount row bridges COD -> prepaid, total = method total.
  //  - single pack: subtotal/line = pack price, total = method price.
  // The per-item (product) rows therefore never show the grand total.
  function methodKind(m) {
    m = String(m || '').toLowerCase();
    if (m === 'prepaid') return 'prepaid';
    if (m === 'advance' || m === 'advance_cod' || m === 'booking') return 'advance';
    return 'cod';
  }
  // payNow (online) + payLater (on delivery) === total, for every method.
  function splitPay(kind, total, advAmt) {
    var t = Math.max(0, Math.round(Number(total) || 0));
    var a = posInt(advAmt) || ADVANCE_DEFAULT;
    if (kind === 'prepaid') return { payNow: t, payLater: 0 };
    if (kind === 'advance') { var p = Math.min(a, t); return { payNow: p, payLater: t - p }; }
    return { payNow: 0, payLater: t };
  }

  function checkoutModel(opts) {
    opts = opts || {};
    var kind = methodKind(opts.method);
    var st = window.AVN_CART_STATE;
    // Price the cart when checkout started from the cart (any number of lines /
    // quantities) or when it is a mixed cart routed with ?open=1. A direct PDP
    // "Buy Now" with no cart checkout still prices the selected pack.
    var cartDriven = !!(st && st.items && st.items.length && (st.mixed || st.fromCart));
    var pack = opts.pack || activePack() || { pre: 0, cod: 0, adv: 0, mrp: 0 };
    var advAmt = (opts.advance == null) ? ((PAY && posInt(PAY.advance_amount)) || ADVANCE_DEFAULT) : opts.advance;
    var lines, codTot, advTot, preTot, mrpTot, count;
    if (cartDriven) {
      lines = st.items.map(function (it) {
        var qty = Math.max(1, parseInt(it.qty, 10) || 1);
        var unitCod = Number(it.unitCod != null ? it.unitCod : (it.cod / qty)) || 0;
        var unitAdv = Number(it.unitAdvance != null ? it.unitAdvance : (it.advance / qty)) || unitCod;
        var unitPrepaid = Number(it.unitPrepaid != null ? it.unitPrepaid : (it.prepaid / qty)) || 0;
        var unitMrp = Number(it.unitMrp != null ? it.unitMrp : (it.mrp / qty)) || 0;
        return {
          id: it.id, name: it.name, variant: it.variant, family: it.family,
          pack: it.pack, qty: qty,
          label: it.name + ' (' + it.variant + ')' + (qty > 1 ? ' \u00d7 ' + qty : ''),
          unit: unitCod, unitAdvance: unitAdv, unitPrepaid: unitPrepaid, unitMrp: unitMrp,
          cod: unitCod * qty, advance: unitAdv * qty, prepaid: unitPrepaid * qty, mrp: unitMrp * qty
        };
      });
      codTot = 0; advTot = 0; preTot = 0; mrpTot = 0;
      lines.forEach(function (ln) {
        codTot += ln.cod; advTot += ln.advance; preTot += ln.prepaid; mrpTot += ln.mrp;
      });
      count = lines.reduce(function (n, ln) { return n + ln.qty; }, 0);
    } else {
      lines = [];
      codTot = Number(pack.cod) || 0;
      advTot = Number(pack.adv != null ? pack.adv : pack.cod) || 0;
      preTot = Number(pack.pre) || 0;
      mrpTot = Number(pack.mrp) || 0;
      count = 1;
    }
    var total = kind === 'prepaid' ? preTot : kind === 'advance' ? advTot : codTot;
    // COD -> prepaid difference (shown as its own row in a mixed cart only).
    var prepaidDiscount = Math.max(0, codTot - preTot);
    // Booking-advance saving (COD -> advance total), shown only for the advance method.
    var advanceDiscount = Math.max(0, codTot - advTot);
    var split = splitPay(kind, total, advAmt);
    return {
      mixed: lines.length > 1, cartDriven: cartDriven, method: kind, count: count, lines: lines,
      subtotal: codTot, advanceTotal: advTot, prepaidTotal: preTot, mrpTotal: mrpTot,
      total: total, prepaidDiscount: prepaidDiscount, advanceDiscount: advanceDiscount,
      savings: Math.max(0, mrpTot - total),
      advance: split.payNow, payNow: split.payNow, payLater: split.payLater,
      checkoutMode: opts.checkoutMode || 'advance'
    };
  }

  // Paint the order popup's summary from a single verified model.
  // opts: { method, checkoutMode, advance, pack:{pre,cod,mrp}, singleLabel }
  function renderSummary(opts) {
    try {
      var model = checkoutModel(opts || {});
      var sum = document.querySelector('.order-popup .summary') || document.querySelector('.summary');
      if (!sum) return model;
      var fmt = fmtINR;

      // 1. anchor row: one product's own pack price, or the cart title + the
      //    sum of the line subtotals. It is NEVER the grand total of the order
      //    when the cart holds more than one line.
      var anchor = sum.querySelector('.s-row');
      if (anchor) {
        var sp = anchor.querySelector('span');
        var ab = anchor.querySelector('b') || sum.querySelector('#sAmt');
        var anchorValue = model.mixed ? model.subtotal : model.total;
        if (sp) {
          if (model.mixed) {
            sp.textContent = 'Your Cart \u2014 ' + model.count + ' items';
          } else if (model.cartDriven && model.lines.length === 1) {
            var only = model.lines[0];
            // Keep the PDP's own product label when it already names this line
            // (it may carry a friendlier name); the cart line only wins when
            // the quantity has to be spelled out.
            var base = (opts && opts.singleLabel) || sp.textContent || '';
            if (!base) base = only.name + ' (' + only.variant + ')';
            sp.textContent = only.qty > 1
              ? (base + ' \u00d7 ' + only.qty + ' \u2014 ' + fmt(only.unit) + ' each')
              : base;
          } else {
            sp.textContent = (opts && opts.singleLabel) || sp.textContent;
          }
        }
        if (ab) ab.textContent = fmt(anchorValue);
      }

      // 2. drop rows this function owns so repeat paints stay idempotent.
      var owned = sum.querySelectorAll('[data-cart-line],[data-adv-row]');
      for (var i = owned.length - 1; i >= 0; i--) { if (owned[i].parentNode) owned[i].parentNode.removeChild(owned[i]); }

      // 3. per-item rows for a multi-line cart, inserted after the anchor.
      //    Each row is unit selling price x quantity for THAT product only.
      if (model.mixed && anchor && anchor.parentNode) {
        var insertBefore = anchor.nextSibling;
        model.lines.forEach(function (ln) {
          var row = document.createElement('div');
          row.className = 's-row';
          row.setAttribute('data-cart-line', '');
          row.setAttribute('data-line-id', ln.id || '');
          row.setAttribute('data-line-qty', String(ln.qty));
          row.setAttribute('data-line-unit', String(ln.unit));
          row.setAttribute('data-line-subtotal', String(ln.cod));
          var s = document.createElement('span');
          s.textContent = ln.label + ' \u2014 ' + fmt(ln.unit) + ' each';
          var b = document.createElement('b');
          b.textContent = fmt(ln.cod);
          row.appendChild(s); row.appendChild(b);
          anchor.parentNode.insertBefore(row, insertBefore);
        });
      }

      // 4. prepaid discount row (shown only for prepaid).
      // The separate prepaid-discount row only belongs in the summary when the
      // product rows show COD amounts (a multi-line cart). A single product row
      // already shows the prepaid price, so adding the discount again would
      // subtract it twice.
      var saveRow = sum.querySelector('#sSave');
      if (saveRow) {
        // A discount row only belongs in a mixed cart: the per-item rows there
        // show COD amounts, so the method's saving needs its own bridging row.
        var showSave = model.mixed && (model.method === 'prepaid' || (model.method === 'advance' && model.advanceDiscount > 0));
        var disc = model.method === 'advance' ? model.advanceDiscount : model.prepaidDiscount;
        saveRow.hidden = !showSave;
        // The page CSS sets .s-row{display:flex}, which overrides the hidden
        // attribute; an inline display is required to actually hide the row.
        saveRow.style.display = showSave ? '' : 'none';
        var saveSp = saveRow.querySelector('span');
        if (saveSp) saveSp.textContent = model.method === 'advance' ? 'Advance booking discount' : 'Prepaid discount';
        var saveB = saveRow.querySelector('b');
        if (saveB) saveB.textContent = '- ' + fmt(disc);
      }

      // 5. total row = the amount actually charged for the selected method.
      var totB = sum.querySelector('#sTot');
      if (totB) totB.textContent = fmt(model.total);

      // 6. online-now / on-delivery split. Only the advance option has two
      //    payments; COD has a single amount due on delivery and prepaid has
      //    nothing left to collect.
      var totalRow = sum.querySelector('.s-row.s-total') || (totB && totB.parentNode && totB.parentNode.classList && totB.parentNode.classList.contains('s-row') ? totB.parentNode : null);
      if (model.method !== 'prepaid' && totalRow && totalRow.parentNode) {
        var advRef = totalRow.nextSibling;
        var pairs = model.method === 'advance'
          ? [['Pay online now (Razorpay)', model.payNow], ['Remaining \u2014 pay on delivery (COD)', model.payLater]]
          : [['Pay on delivery (COD)', model.payLater]];
        pairs.forEach(function (pair) {
          var row = document.createElement('div');
          row.className = 's-row'; row.setAttribute('data-adv-row', '');
          var s = document.createElement('span'); s.textContent = pair[0];
          var b = document.createElement('b'); b.textContent = fmt(pair[1]);
          row.appendChild(s); row.appendChild(b);
          totalRow.parentNode.insertBefore(row, advRef);
        });
      }

      // 7. savings line — against MRP for the method actually chosen. COD is
      //    priced at MRP (so no saving); prepaid saves exactly 20%. The whole
      //    block is hidden at zero instead of claiming a discount that is not
      //    there. It is never added to / subtracted from the prepaid-discount
      //    row above, so nothing is counted twice.
      var sv = sum.querySelector('#sSaveAmt');
      if (sv) sv.textContent = fmt(model.savings);
      var svBox = sum.querySelector('.s-savings');
      if (svBox) svBox.style.display = model.savings > 0 ? '' : 'none';

      return model;
    } catch (e) { return null; }
  }

  /* ---------- payment config (single source of truth: /api/payment-config) ----------
     Admin writes D1 settings; this same-origin endpoint reads them. The three
     enable flags, the default selection and the flat booking advance all come
     from here so admin, storefront and backend can never drift. */
  var PAY = window.AVN_PAY_CONFIG || null;
  var PAY_READY = !!PAY;
  var PAY_ERROR = '';
  var PAY_HAS_CONFIG = !!PAY;
  var PAY_USER_CHOSE = false;
  function normalizePayConfig(d) {
    var src = (d && d.data && typeof d.data === 'object') ? d.data : (d || {});
    var truthy = function (v, dflt) { return v == null || v === '' ? dflt : (v === true || v === 1 || v === '1' || v === 'true'); };
    var cfg = {
      cod_enabled: truthy(src.cod_enabled, true),
      advance_enabled: truthy(src.advance_enabled, true),
      prepaid_enabled: truthy(src.prepaid_enabled, true),
      default_method: String(src.default_method || '').toLowerCase(),
      advance_amount: posInt(src.advance_amount) || ADVANCE_DEFAULT
    };
    var aliases = { full_cod: 'cod', cod: 'cod', cash: 'cod', pay_on_delivery: 'cod', advance: 'advance', advance_cod: 'advance', booking: 'advance', prepaid: 'prepaid', prepaid_online: 'prepaid', online: 'prepaid' };
    var wanted = aliases[cfg.default_method];
    if (wanted) cfg.default_method = wanted;
    if (cfg.default_method !== 'cod' && cfg.default_method !== 'advance' && cfg.default_method !== 'prepaid') {
      var mode = String(src.checkout_mode || '').toLowerCase();
      cfg.default_method = aliases[mode] || 'prepaid';
    }
    if (!cfg.cod_enabled && !cfg.advance_enabled && !cfg.prepaid_enabled) {
      cfg.cod_enabled = true;
      cfg.default_method = 'cod';
    }
    if (cfg.default_method === 'cod' && !cfg.cod_enabled) cfg.default_method = 'advance';
    if (cfg.default_method === 'advance' && !cfg.advance_enabled) cfg.default_method = 'prepaid';
    if (cfg.default_method === 'prepaid' && !cfg.prepaid_enabled) cfg.default_method = 'cod';
    cfg.checkout_mode = cfg.default_method === 'cod' ? 'full_cod' : (cfg.default_method === 'prepaid' ? 'prepaid' : 'advance');
    return cfg;
  }
  function loadPayConfig(force) {
    if (PAY_READY && PAY && !force) return Promise.resolve(PAY);
    return fetch('/api/payment-config' + (force ? '?cb=' + Date.now() : ''), { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('config ' + r.status); return r.json(); })
      .then(function (d) {
        if (!d || d.ok !== true) throw new Error('config invalid');
        PAY = normalizePayConfig(d);
        window.AVN_PAY_CONFIG = PAY; PAY_READY = true; PAY_ERROR = ''; PAY_HAS_CONFIG = true;
        try { document.dispatchEvent(new CustomEvent('avn:payconfig', { detail: PAY })); } catch (e2) {}
        renderPayUI(PAY);
        try { if (dr) render(); } catch (e3) {}
        return PAY;
      })
      .catch(function (e) {
        PAY_READY = false;
        PAY_ERROR = 'Payment options could not be loaded. Please check your connection and retry.';
        try { document.dispatchEvent(new CustomEvent('avn:payconfig-error', { detail: { error: PAY_ERROR } })); } catch (e2) {}
        renderPayUI(null);
        throw e;
      });
  }
  try {
    window.AVN_PAY = {
      get: function () { return PAY; },
      load: loadPayConfig,
      split: splitPay,
      kind: methodKind,
      ready: function () { return PAY_READY; },
      error: function () { return PAY_ERROR; },
      normalize: normalizePayConfig
    };
  } catch (e) {}

  /* Paint the three payment cards from config + the current pack/cart totals.
     Each card carries data-pay-card="prepaid|advance|cod"; disabled options are
     hidden, the admin default is selected on first paint, and prices/labels are
     always derived (no hardcoded amounts in the markup). On a config failure
     every option is locked and a retry message is shown — checkout cannot
     continue with stale pricing. */
  function renderPayUI(cfg) {
    try {
      var grids = document.querySelectorAll('.pay-grid');
      if (!grids.length) return;
      var hasFlags = !!(cfg && (cfg.cod_enabled !== undefined || cfg.advance_enabled !== undefined || cfg.prepaid_enabled !== undefined));
      cfg = hasFlags ? cfg : PAY;
      var failed = !cfg;
      var codOn = !failed && cfg.cod_enabled !== false;
      var advOn = !failed && cfg.advance_enabled !== false;
      var preOn = !failed && cfg.prepaid_enabled !== false;
      var def = (!failed && cfg.default_method) ? cfg.default_method : 'prepaid';
      var advAmt = posInt(cfg && cfg.advance_amount) || ADVANCE_DEFAULT;
      var m = checkoutModel({ method: 'cod' });
      var cod = m.subtotal, adv = m.advanceTotal, pre = m.prepaidTotal;
      var kindOn = function (k) { return k === 'prepaid' ? preOn : k === 'advance' ? advOn : codOn; };
      grids.forEach(function (grid) {
        // Config error banner (created once, reused).
        var box = grid.parentNode.querySelector('.pay-config-error');
        if (failed) {
          if (!box) {
            box = document.createElement('div');
            box.className = 'pay-config-error';
            box.setAttribute('role', 'alert');
            var btn = document.createElement('button');
            btn.type = 'button'; btn.textContent = 'Retry';
            btn.addEventListener('click', function () { loadPayConfig(true).catch(function () {}); });
            box.appendChild(document.createTextNode(PAY_ERROR || 'Payment options could not be loaded. Please retry.'));
            box.appendChild(document.createElement('br'));
            box.appendChild(btn);
            grid.parentNode.insertBefore(box, grid);
          }
        } else if (box) { box.parentNode.removeChild(box); }

        grid.querySelectorAll('.pay-card').forEach(function (card) {
          var input = card.querySelector('input[name="paymentMethod"]');
          var kind = card.getAttribute('data-pay-card') || (input ? input.value : 'cod');
          var on = kindOn(kind);
          card.style.display = on ? '' : 'none';
          if (input) { input.disabled = !on; if (!on) input.checked = false; }
          var titleEl = card.querySelector('.pay-title') || card.querySelector('strong');
          var amtEl = card.querySelector('.pay-amt') || card.querySelector('.pay-prices b');
          var subEl = card.querySelector('.pay-sub') || card.querySelector('small');
          var saveEl = card.querySelector('.pay-save');
          var badgeEl = card.querySelector('.pay-badge') || card.querySelector('.save-badge');
          if (kind === 'cod') {
            if (titleEl) titleEl.textContent = 'Pay on Delivery';
            if (amtEl) amtEl.textContent = fmtINR(cod);
            if (subEl) subEl.textContent = 'Pay the full amount when your order arrives.';
            if (badgeEl) badgeEl.textContent = 'Pay on delivery';
            if (saveEl) saveEl.style.display = 'none';
          } else if (kind === 'advance') {
            var now = Math.min(advAmt, adv), rest = Math.max(0, adv - now), s = Math.max(0, cod - adv);
            if (titleEl) titleEl.textContent = 'Book with ' + fmtINR(now);
            if (amtEl) amtEl.textContent = fmtINR(adv);
            if (subEl) subEl.textContent = 'Pay ' + fmtINR(now) + ' now + ' + fmtINR(rest) + ' on delivery.';
            if (saveEl) { saveEl.hidden = s <= 0; saveEl.style.display = s > 0 ? '' : 'none'; saveEl.textContent = 'Save ' + fmtINR(s) + ' compared with Full COD.'; }
            if (badgeEl) badgeEl.style.display = 'none';
          } else {
            var sp = Math.max(0, cod - pre);
            if (titleEl) titleEl.textContent = 'Pay Online & Save';
            if (amtEl) amtEl.textContent = fmtINR(pre);
            if (subEl) subEl.textContent = 'Pay securely online. No payment due on delivery.';
            if (saveEl) { saveEl.hidden = sp <= 0; saveEl.style.display = sp > 0 ? '' : 'none'; saveEl.textContent = 'Save ' + fmtINR(sp) + ' compared with Full COD.'; }
            if (badgeEl) { badgeEl.style.display = ''; badgeEl.textContent = 'Lowest Price'; }
          }
        });

        // Selection: first paint follows the admin default; after the customer
        // has chosen, keep their choice as long as it is still enabled.
        var checked = grid.querySelector('input[name="paymentMethod"]:checked');
        if (!checked || checked.disabled || !PAY_USER_CHOSE) {
          var want = grid.querySelector('input[value="' + def + '"]');
          if (!want || want.disabled) {
            var radios = grid.querySelectorAll('input[name="paymentMethod"]');
            want = null;
            for (var i = 0; i < radios.length; i++) { if (!radios[i].disabled) { want = radios[i]; break; } }
          }
          if (want) { want.checked = true; try { want.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
        }
        grid.querySelectorAll('.pay-card').forEach(function (card) {
          var i = card.querySelector('input[name="paymentMethod"]');
          card.classList.toggle('selected', !!(i && i.checked));
        });
      });
    } catch (e) {}
  }

  // The first real customer click wins over the admin default for this visit.
  document.addEventListener('change', function (e) {
    if (e && e.target && e.target.name === 'paymentMethod' && e.target.checked) PAY_USER_CHOSE = true;
  }, true);

  try {
    window.AVN_CHECKOUT = {
      renderSummary: renderSummary,
      model: checkoutModel,
      cartState: cartState,
      packPrice: packPrice,
      pack: packPrice,
      fmt: fmtINR,
      split: splitPay,
      kind: methodKind,
      loadPayConfig: loadPayConfig,
      renderPayUI: renderPayUI,
      // Shared MRP rule: { mrp, cod: mrp, advance: cod, prepaid: mrp - 20% }.
      fromMrp: computePrices
    };
  } catch (e) {}

  /* Paint the popup's per-item summary lines and title (mixed carts only). */
  function paintPopup() {
    [0, 150, 400, 900].forEach(function (delay) {
      setTimeout(function () {
        try {
          var st = window.AVN_CART_STATE;
          if (!st || !st.items || !st.items.length) return;
          if (!st.mixed && !st.fromCart) return;
          if (window.AVN_CHECKOUT && window.AVN_CHECKOUT.renderSummary) {
            var mc = document.querySelector('input[name="paymentMethod"]:checked');
            window.AVN_CHECKOUT.renderSummary({ method: mc ? mc.value : 'cod' });
          } else if (typeof window.renderCartLines === 'function') {
            window.renderCartLines();
          }
        } catch (e) {}
      }, delay);
    });
  }

  function checkout() {
    try {
      // Drop stale ids (old app versions) that would crash P().url below.
      var ks = ids().filter(function (k) { return !!P(k); });
      if (!ks.length) return;
      // Purge the stale lines so the drawer stops showing them.
      Object.keys(cart).forEach(function (k) { if (!P(k)) { delete cart[k]; dropped = true; } });
      if (dropped) { store(); render(); }
      track('InitiateCheckout', { value: sub(), currency: 'INR', num_items: itemCount() });
      closeDr();
      // EVERY cart goes through the order popup, including a MIXED cart (two or
      // more product families). Mixed carts used to be dumped on WhatsApp from
      // this button because the popup could only price a single pack; window
      // .AVN_CART_STATE now carries the whole cart and apPack() prices from it.
      // A single-product cart leaves apPack() untouched, so that flow — the main
      // revenue path — is unchanged. The explicit "Order on WhatsApp" button
      // below still calls waOrder().
      var last = ks[ks.length - 1];
      var p = P(last);
      var here = location.pathname.replace(/\/$/, '');
      var there = p.url.replace(/\/$/, '');
      syncPack(last); // popup must price the pack that is actually in the cart
      // Carry the payment method the customer picked on THIS page into the
      // checkout. The same-page popup reads the selection directly; a ?open=1
      // handoff to another PDP restores it there (a fresh visit still defaults
      // to Prepaid). Never touches the cart lines or an already-created order.
      try {
        var payEl = document.querySelector('.ap-pack[data-pay].on');
        localStorage.setItem('avn_pay_pref', payEl ? payEl.getAttribute('data-pay') : 'P');
      } catch (e) {}
      cartCheckout = true; // price the whole cart, not just the last pack
      publishState(); // ...or the whole cart when it holds several products
      paintPopup();   // list the cart lines once the popup is up
      if (here === there && typeof openOrderPopup === 'function') { try { openOrderPopup(); } catch (e) {} }
      else { location.href = p.url + '?open=1'; }
    } catch (e) {}
  }

  function waOrder() {
    if (!ids().length) { location.href = 'https://wa.me/917060101043?text=' + encodeURIComponent('Hi Avnideep, mujhe order karna hai'); return; }
    var lines = ['*🛒 New Order — Avnideep Ayurveda*', ''];
    ids().forEach(function (k) {
      var p = P(k); if (!p) return;
      lines.push('• ' + p.name + ' (' + p.variant + ') × ' + cart[k] + ' — ' + inr(p.cod * cart[k]));
    });
    var st = sub();
    lines.push('', 'Subtotal: ' + inr(st));
    lines.push('Delivery: FREE');
    lines.push('Total: ' + inr(st));
    lines.push('', 'COD available? Address: ');
    window.open('https://wa.me/917060101043?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  }

  /* ---------- global delegation ---------- */
  document.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-cart-add]'))) { e.preventDefault(); var qEl = document.getElementById('apQtyVal'); var qq = qEl ? (parseInt(qEl.textContent, 10) || 1) : 1; add(t.getAttribute('data-cart-add'), qq); return; }
    if ((t = e.target.closest('[data-cart-open]'))) { e.preventDefault(); openDr(); return; }
    if ((t = e.target.closest('[data-cart-close]'))) { closeDr(); return; }
    if ((t = e.target.closest('[data-cart-checkout]'))) { checkout(); return; }
    if ((t = e.target.closest('[data-cart-wa]'))) { e.preventDefault(); waOrder(); return; }
    if ((t = e.target.closest('[data-cart-inc]'))) { bump(t, 1); return; }
    if ((t = e.target.closest('[data-cart-dec]'))) { bump(t, -1); return; }
    if ((t = e.target.closest('[data-cart-rm]'))) { bump(t, -999); return; }
  });

  function bump(btn, d) {
    var row = btn.closest('.cart-it'); if (!row) return;
    var k = row.getAttribute('data-key');
    cart[k] = (cart[k] || 0) + d;
    if (cart[k] <= 0) delete cart[k];
    store(); render();
  }

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDr(); });

  /* ---------- auto-open order popup when routed with ?open=1 ---------- */
  function openPopupNow() {
    if (typeof openOrderPopup === 'function') { try { openOrderPopup(); } catch (e) {} return; }
    var c = document.getElementById('checkout'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth' });
  }
  if (/[?&]open=1/.test(location.search) || location.hash === '#buynow') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(openPopupNow, 700); });
    else setTimeout(openPopupNow, 700);
  }

  /* ---------- mobile slide menu (auto-build from .rx-links, site-wide) ---------- */
  function buildMnav() {
    try {
      var nav = document.querySelector('.rx-nav');
      if (!nav || document.querySelector('.rx-mnav')) return;
      var links = document.querySelector('.rx-links');
      var items = links
        ? Array.prototype.slice.call(links.querySelectorAll('a')).map(function (a) {
            return { h: a.getAttribute('href'), t: a.textContent.trim(), on: a.classList.contains('on') };
          })
        : [
            { h: '/', t: 'Home' }, { h: '/shilajit/', t: 'Shilajit' },
            { h: '/pain-oil/', t: 'Pain Oil' }, { h: '/#products', t: 'Bestsellers' },
            { h: '/#reviews', t: 'Reviews' }, { h: '/contact-us', t: 'Contact' }
          ];
      var burger = null;
      if (!nav.querySelector('.rx-burger')) {
        burger = document.createElement('button');
        burger.type = 'button'; burger.className = 'rx-burger'; burger.setAttribute('aria-label', 'Open menu');
        burger.setAttribute('aria-expanded', 'false');
        burger.setAttribute('data-mnav-open', '');
        burger.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
        nav.insertBefore(burger, nav.firstChild);
      }
      var ov = document.createElement('div');
      ov.className = 'rx-mnav-ov'; ov.setAttribute('data-mnav-close', '');
      var dr = document.createElement('aside');
      dr.className = 'rx-mnav'; dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-label', 'Site menu');
      dr.innerHTML =
        '<div class="rx-mnav-h"><span style="display:flex;align-items:center;gap:10px">' +
          '<img src="https://cdn.avnideepayurveda.in/product-images/logoyes.png" alt="Avnideep">' +
          '<b>Menu</b></span>' +
          '<button type="button" class="rx-mnav-x" data-mnav-close aria-label="Close menu">&times;</button></div>' +
        '<nav class="rx-mnav-links">' +
          items.map(function (l) {
            return '<a href="' + l.h + '"' + (l.on ? ' class="on"' : '') + '><span>' + l.t + '</span><small>→</small></a>';
          }).join('') +
          '<a href="/#faq"><span>FAQ</span><small>→</small></a>' +
        '</nav>' +
        '<div class="rx-mnav-cta"><a class="rx-cta" href="/#products">Shop Now</a>' +
        '<a class="rx-mnav-call" href="tel:+917060101043">Call +91 70601 01043</a></div>';
      document.body.appendChild(ov);
      document.body.appendChild(dr);
      var here = (location.pathname || '/').replace(/\/$/, '') || '/';
      dr.querySelectorAll('.rx-mnav-links a').forEach(function (a) {
        var h = (a.getAttribute('href') || '').split('#')[0].replace(/\/$/, '') || '/';
        if (h === here) a.classList.add('on');
      });
      function openM() { ov.classList.add('on'); dr.classList.add('on'); document.documentElement.classList.add('mnav-lock'); syncBurger(true); }
      function closeM() { ov.classList.remove('on'); dr.classList.remove('on'); document.documentElement.classList.remove('mnav-lock'); syncBurger(false); }
      function syncBurger(open) {
        document.querySelectorAll('.rx-burger').forEach(function (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
      }
      document.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('[data-mnav-open],[data-mnav-close]') : null;
        if (t) {
          if (t.hasAttribute('data-mnav-open')) openM();
          else closeM();
          return;
        }
        var link = e.target && e.target.closest ? e.target.closest('.rx-mnav-links a, .rx-mnav-cta a') : null;
        if (link) closeM();
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeM(); });
    } catch (e) {}
  }

  /* ---------- public API ---------- */
  // Closing the order popup ends the cart checkout session, so a later
  // Buy Now on the same page prices the selected pack/quantity again.
  try {
    window.AVN_END_CART_CHECKOUT = function () {
      cartCheckout = false;
      try { if (window.AVN_CART_STATE) window.AVN_CART_STATE.fromCart = false; } catch (e) {}
    };
  } catch (e) {}

  window.AVN_CART = {
    add: function (id, q) { add(id, q || 1); },
    count: function () { return itemCount(); },
    items: function () { return ids().slice(); },
    renderBadges: function () { renderBadge(); }
  };

  /* ---------- init ---------- */
  // Publish the cart on load too, so a checkout that navigated to another
  // product page (?open=1) still finds AVN_CART_STATE there.
  publishState();
  // check-out() navigates to the last item's PDP with ?open=1; the rebuilt
  // state there must still know that the popup is a cart checkout.
  if (/[?&]open=1/.test(location.search) || location.hash === '#buynow') {
    try { window.AVN_CART_STATE.fromCart = true; } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBadge);
  else renderBadge();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildMnav);
  else buildMnav();
})();