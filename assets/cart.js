/* ==========================================================================
   AVNIDEEP CART — localStorage cart + slide-in drawer (Renee-style)
   Works on every page. No backend change: single-product carts route to the
   existing order popup (keeps Meta Pixel + CAPI funnel intact), mixed carts
   route to WhatsApp order with itemised message.
   ========================================================================== */
(function () {
  'use strict';

  // Two-step discount system:
  // Step 1: Selling Price (COD) = MRP - 10% of MRP, rounded
  // Step 2: Prepaid Price = Selling Price - 10% of Selling Price, rounded
  // Total discount against MRP for prepaid = 19% (not 20%)

  function computePrices(mrp) {
    // Step 1: Standard selling price (COD) = MRP - 10% of MRP
    const cod = Math.round(mrp * 0.9);
    // Step 2: Additional prepaid discount = 10% of selling price
    const prepaid = Math.round(cod * 0.9);
    return { cod, prepaid, mrp };
  }

  var PRODUCTS = {
    shilajit: {
      id: 'shilajit', sku: 'AVN-6PRO-001',
      name: '6Pro Shilajit Capsules', variant: '30 Capsules',
      img: 'https://cdn.avnideepayurveda.in/home/assets/shilajit-1.png',
      // MRP 2500: cod = 2250, prepaid = 2025
      ...computePrices(1250),
      url: '/shilajit/'
    },
    oil: {
      id: 'oil', sku: 'AVN-OIL-001',
      name: 'Pain Relief Oil', variant: '60ml',
      img: 'https://cdn.avnideepayurveda.in/pain-oil/oil-1.png',
      // MRP 499: cod = 449, prepaid = 404
      ...computePrices(349),
      url: '/pain-oil/'
    },
    shilajit2: {
      id: 'shilajit2', sku: 'AVN-6PRO-002',
      name: '6Pro Shilajit Capsules', variant: 'Pack of 2',
      img: 'https://cdn.avnideepayurveda.in/home/assets/packs/shilajit-2.png',
      // MRP 5000: cod = 4500, prepaid = 4050
      ...computePrices(5000),
      url: '/shilajit/'
    },
    shilajit3: {
      id: 'shilajit3', sku: 'AVN-6PRO-003',
      name: '6Pro Shilajit Capsules', variant: 'Pack of 3',
      img: 'https://cdn.avnideepayurveda.in/home/assets/packs/shilajit-3.png',
      // MRP 7500: cod = 6750, prepaid = 6075
      ...computePrices(7500),
      url: '/shilajit/'
    },
    oil2: {
      id: 'oil2', sku: 'AVN-OIL-002',
      name: 'Pain Relief Oil', variant: 'Pack of 2',
      img: 'https://cdn.avnideepayurveda.in/home/assets/packs/oil-2.png',
      // MRP 998: cod = 898, prepaid = 809
      ...computePrices(998),
      url: '/pain-oil/'
    },
    oil3: {
      id: 'oil3', sku: 'AVN-OIL-003',
      name: 'Pain Relief Oil', variant: 'Pack of 3',
      img: 'https://cdn.avnideepayurveda.in/home/assets/packs/oil-3.png',
      // MRP 1497: cod = 1348, prepaid = 1214
      ...computePrices(1497),
      url: '/pain-oil/'
    },
    hair: {
      id: 'hair', sku: 'AVN-HAIR-001',
      name: 'Herbal Hair Oil', variant: '100ml',
      img: 'https://cdn.avnideepayurveda.in/hair-oil/gallery/g1.webp',
      // MRP 499: cod = 449, prepaid = 404
      ...computePrices(465),
      url: '/hair-oil/'
    },
    hair2: {
      id: 'hair2', sku: 'AVN-HAIR-002',
      name: 'Herbal Hair Oil', variant: 'Pack of 2',
      img: 'https://cdn.avnideepayurveda.in/hair-oil/gallery/g1.webp',
      // MRP 998: cod = 898, prepaid = 809
      ...computePrices(998),
      url: '/hair-oil/'
    },
    hair3: {
      id: 'hair3', sku: 'AVN-HAIR-003',
      name: 'Herbal Hair Oil', variant: 'Pack of 3',
      img: 'https://cdn.avnideepayurveda.in/hair-oil/gallery/g1.webp',
      // MRP 1497: cod = 1348, prepaid = 1214
      ...computePrices(1497),
      url: '/hair-oil/'
    },
    balm: {
      id: 'balm', sku: 'AVN-BALM-001',
      name: 'Herbal Balm', variant: '10g Pack of 5',
      img: 'https://cdn.avnideepayurveda.in/herbal-balm/gallery/g1.webp',
      // MRP 349: cod = 314, prepaid = 283
      ...computePrices(349),
      url: '/herbal-balm/'
    },
    balm2: {
      id: 'balm2', sku: 'AVN-BALM-002',
      name: 'Herbal Balm', variant: 'Pack of 2',
      img: 'https://cdn.avnideepayurveda.in/herbal-balm/gallery/g1.webp',
      // MRP 698: cod = 628, prepaid = 566
      ...computePrices(698),
      url: '/herbal-balm/'
    },
    balm3: {
      id: 'balm3', sku: 'AVN-BALM-003',
      name: 'Herbal Balm', variant: 'Pack of 3',
      img: 'https://cdn.avnideepayurveda.in/herbal-balm/gallery/g1.webp',
      // MRP 1047: cod = 943, prepaid = 849
      ...computePrices(1047),
      url: '/herbal-balm/'
    }
  };

  var KEY = 'avn_cart_v1', FREE_ABOVE = 499, SHIP_FEE = 49;

  /* ---------- admin catalog overrides (set by site-sync.js from /api/products) ---------- */
  function AP() { return window.AVN_ADMIN_PRODUCTS || {}; }
  function isOOS(id) { return !!(window.AVN_OOS && window.AVN_OOS[id]); }
  function P(id) {
    var o = AP()[id];
    if (!o) return PRODUCTS[id];
    var base = PRODUCTS[id] || { id: id, variant: '', url: '/' };
    return {
      id: id, sku: o.sku || base.sku || id,
      name: o.name || base.name, variant: base.variant,
      img: o.img || base.img,
      cod: (o.cod != null ? o.cod : base.cod),
      prepaid: (o.prepaid != null ? o.prepaid : base.prepaid),
      mrp: (o.mrp != null ? o.mrp : base.mrp),
      url: base.url
    };
  }

  /* ---------- storage ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function store() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) {} publishState(); }
  var cart = load();

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
        '<p class="cart-note">7-day easy returns • Lab tested • Free shipping above ₹499</p>' +
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
        '<p>Shilajit, Pain Oil, Hair Oil ya Balm add karein — COD available, free shipping ₹499+</p>' +
        '<a class="cart-btn2" href="/#products">Shop Bestsellers</a>' +
        '</div>';
    } else {
      list.innerHTML = ids().map(function (k) {
        var p = P(k), q = cart[k];
        if (!p) return '';
        var save = p.mrp - p.cod;
        var preSave = p.cod - p.prepaid;
        return '' +
        '<div class="cart-it" data-key="' + k + '">' +
          '<img src="' + p.img + '" alt="' + p.name + '">' +
          '<div class="it-b">' +
            '<b>' + p.name + '</b><span class="it-v">' + p.variant + '</span>' +
            '<div class="it-p">' + inr(p.mrp) + 'unia ' + inr(p.cod) +
              (save > 0 ? ' <em>save ' + inr(save) + '</em>' : '') +
              (preSave > 0 ? ' <em>prepaid save ' + inr(preSave) + '</em>' : '') + '</div>' +
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

    /* shipping progress */
    var st = sub();
    var ship = dr.querySelector('[data-cart-ship]');
    if (!n) { ship.style.display = 'none'; }
    else {
      ship.style.display = '';
      if (st >= FREE_ABOVE) {
        ship.innerHTML = '<div class="ok">🎉 <b>FREE delivery</b> unlocked!</div><div class="bar"><i style="width:100%"></i></div>';
      } else {
        var left = FREE_ABOVE - st, pct = Math.min(100, Math.round(st / FREE_ABOVE * 100));
        ship.innerHTML = '<div>Sirf <b>' + inr(left) + '</b> aur — <b>FREE delivery</b> ke liye</div>' +
          '<div class="bar"><i style="width:' + pct + '%"></i></div>';
      }
    }

    /* totals */
    var mrpS = sum(function (p) { return p.mrp; });
    dr.querySelector('[data-cart-total]').textContent = inr(st);
    dr.querySelector('[data-cart-del]').textContent = !n ? '—' : (st >= FREE_ABOVE ? 'FREE' : inr(SHIP_FEE));
    var saved = mrpS - st;
    dr.querySelector('[data-cart-save]').innerHTML = saved > 0
      ? 'Aapki total bachat: <b>' + inr(saved) + '</b>' +
        ((cart.shilajit || cart.shilajit2 || cart.shilajit3) ? ' &nbsp;•&nbsp; <span class="pre-note">Prepaid par Shilajit par extra off</span>' : '')
      : '';

    var co = dr.querySelector('[data-cart-checkout]');
    co.disabled = !n;
    co.textContent = n ? 'Checkout — ' + inr(st + (st >= FREE_ABOVE ? 0 : SHIP_FEE)) : 'Checkout';
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

  function syncPack(id) {
    var page = pageOf(id);
    if (!page) return;
    var tail = id.slice(page.length); // '' | '2' | '3'
    var i = tail ? (parseInt(tail, 10) - 1) : 0;
    if (!(i >= 0 && i <= 2)) i = 0;
    try { localStorage.setItem('avn_pack', JSON.stringify({ page: page, i: i })); } catch (e) {}
  }

  function familyOf(id) { return pageOf(id); }

  /* ---------- cart -> checkout pricing state ---------- */
  function cartState() {
    var ks = ids().filter(function (k) { return !!P(k); });
    var fams = {}, items = [], codTotal = 0, prepaidTotal = 0, mrpTotal = 0;
    ks.forEach(function (k) {
      var p = P(k), f = pageOf(k);
      if (!p || !f) return;
      fams[f] = true;
      items.push({
        id: k, name: p.name, variant: p.variant, family: f, url: p.url,
        qty: cart[k], cod: p.cod * cart[k], prepaid: p.prepaid * cart[k], mrp: p.mrp * cart[k]
      });
      codTotal += p.cod * cart[k];
      prepaidTotal += p.prepaid * cart[k];
      mrpTotal += p.mrp * cart[k];
    });
    var families = Object.keys(fams);
    return {
      mixed: families.length > 1,
      families: families,
      items: items,
      count: itemCount(),
      codTotal: codTotal,
      prepaidTotal: prepaidTotal,
      mrpTotal: mrpTotal
    };
  }
  function publishState() {
    try { window.AVN_CART_STATE = cartState(); } catch (e) {}
  }

  /* Paint the popup's per-item summary lines and title. */
  function paintPopup() {
    [0, 150, 400, 900].forEach(function (delay) {
      setTimeout(function () {
        try {
          var st = window.AVN_CART_STATE;
          if (!st || !st.mixed || !st.items || !st.items.length) return;
          if (typeof window.renderCartLines === 'function') window.renderCartLines();
          var sum = document.querySelector('.summary');
          if (!sum) return;
          var first = sum.querySelector('.s-row span');
          if (first) first.textContent = 'Your Cart \u2014 ' + st.count + ' items';
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
      var here = location.pathname.replace(/\\/$/, '');
      var there = p.url.replace(/\\/$/, '');
      syncPack(last); // popup must price the pack that is actually in the cart
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
    lines.push('Delivery: ' + (st >= FREE_ABOVE ? 'FREE' : inr(SHIP_FEE)));
    lines.push('Total: ' + inr(st + (st >= FREE_ABOVE ? 0 : SHIP_FEE)));
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
          })\n        : [
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
      var here = (location.pathname || '/').replace(/\\/$/, '') || '/';
      dr.querySelectorAll('.rx-mnav-links a').forEach(function (a) {
        var h = (a.getAttribute('href') || '').split('#')[0].replace(/\\/$/, '') || '/';
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBadge);
  else renderBadge();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildMnav);
  else buildMnav();
})();