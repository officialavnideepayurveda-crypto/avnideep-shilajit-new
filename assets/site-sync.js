/* ============================================================
   AVNIDEEP site-sync.js — admin catalog → storefront (v1)
   - Fetches /api/products (admin-managed price/stock/images)
   - Overrides cart.js + PDP pack prices, disables OOS buttons,
     swaps product images, renders new admin products on home.
   - Best-effort: catalog fetch must NEVER break the page.
   ============================================================ */
(function () {
  'use strict';

  var KNOWN = ['shilajit', 'shilajit2', 'shilajit3', 'oil', 'oil2', 'oil3'];

  function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }

  function disableBtn(el) {
    try {
      el.classList.add('oos');
      el.setAttribute('disabled', 'disabled');
      el.setAttribute('aria-disabled', 'true');
      if (/add to cart/i.test(el.textContent || '')) el.innerHTML = 'Out of Stock';
    } catch (e) {}
  }

  function applyOOS(oos) {
    var ids = Object.keys(oos);
    if (!ids.length) return;
    ids.forEach(function (id) {
      document.querySelectorAll('[data-cart-add="' + id + '"]').forEach(disableBtn);
    });
    // PDP family: if every pack on this page is OOS, disable page buy buttons
    try {
      var packs = window.AP_PACKS || [];
      if (packs.length && packs.every(function (p) { return oos[p.id]; })) {
        document.querySelectorAll('.ap-buynow,[data-scroll="checkout"]').forEach(disableBtn);
        var note = document.createElement('div');
        note.className = 'oos-note';
        note.textContent = 'Abhi out of stock hai — jald wapas aayega.';
        var anchor = document.querySelector('.ap-price') || document.querySelector('.pdp-price');
        if (anchor && anchor.parentNode && !document.querySelector('.oos-note')) {
          anchor.parentNode.insertBefore(note, anchor.nextSibling);
        }
      }
    } catch (e) {}
  }

  function applyPacks(admin) {
    try {
      var packs = window.AP_PACKS;
      if (!packs || !packs.length) return false;
      var changed = false;
      packs.forEach(function (p) {
        var o = admin[p.id];
        if (!o) return;
        if (o.prepaid != null) { p.pre = o.prepaid; changed = true; }
        if (o.cod != null) { p.cod = o.cod; changed = true; }
        if (o.mrp != null) { p.mrp = o.mrp; changed = true; }
      });
      if (changed && typeof window.apSyncPrice === 'function') {
        try { window.apSyncPrice(); } catch (e) {}
      }
      return changed;
    } catch (e) { return false; }
  }

  function applyImages(admin) {
    try {
      document.querySelectorAll('img[data-pimg]').forEach(function (img) {
        var o = admin[img.getAttribute('data-pimg')];
        if (o && o.img && img.getAttribute('src') !== o.img) img.setAttribute('src', o.img);
      });
    } catch (e) {}
  }

  function renderNew(admin) {
    try {
      var box = document.getElementById('newRow');
      if (!box) return;
      var head = document.getElementById('newArrivalsHead');
      var fresh = Object.keys(admin).filter(function (id) { return KNOWN.indexOf(id) < 0; });
      if (!fresh.length) { box.style.display = 'none'; if (head) head.style.display = 'none'; return; }
      box.style.display = ''; if (head) head.style.display = '';
      box.innerHTML = fresh.map(function (id) {
        var p = admin[id];
        var oos = !!window.AVN_OOS[id];
        return '<article class="pcard" data-pname="' + String(p.name || '').replace(/"/g, '') + '">' +
          '<div class="pimg">' + (p.badge ? '<span class="off">' + p.badge + '</span>' : '') +
          (p.img ? '<img src="' + p.img + '" alt="' + String(p.name || '') + '" loading="lazy" decoding="async">' : '') +
          '</div><h3>' + (p.name || id) + '</h3>' +
          '<div class="prow"><div class="price"><b>' + inr(p.prepaid) + '</b>' +
          (p.mrp ? '<s>' + inr(p.mrp) + '</s>' : '') + '</div>' +
          (oos ? '<button class="addbtn oos" disabled>Out of Stock</button>'
               : '<button class="addbtn" data-site-add="' + id + '">ADD</button>') +
          '</div></article>';
      }).join('');
    } catch (e) {}
  }

  // Delegated add for dynamically rendered new products
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-site-add]') : null;
    if (!t) return;
    e.preventDefault();
    var id = t.getAttribute('data-site-add');
    try {
      if (window.AVN_CART && window.AVN_CART.add) {
        // cart.js owns the cart: going through it opens the drawer, updates the
        // badge and fires AddToCart, and keeps its in-memory copy in sync.
        window.AVN_CART.add(id, 1);
      } else {
        var key = 'avn_cart_v1';
        var cart = JSON.parse(localStorage.getItem(key) || '{}');
        cart[id] = (cart[id] || 0) + 1;
        localStorage.setItem(key, JSON.stringify(cart));
        if (window.AVN_CART && window.AVN_CART.renderBadges) window.AVN_CART.renderBadges();
      }
      document.dispatchEvent(new CustomEvent('avn:cart-add', { detail: { id: id } }));
    } catch (err) {}
  });

  function sync() {
    fetch('/api/products', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.products)) return;
        var admin = {}, oos = {};
        j.products.forEach(function (p) {
          if (!p || !p.id) return;
          admin[p.id] = {
            name: p.name, sku: p.sku,
            prepaid: p.price_prepaid, cod: p.price_cod, mrp: p.mrp,
            img: p.image_url, badge: p.badge
          };
          if (p.out_of_stock) oos[p.id] = true;
        });
        window.AVN_ADMIN_PRODUCTS = admin;
        window.AVN_OOS = oos;
        applyPacks(admin);
        applyOOS(oos);
        applyImages(admin);
        renderNew(admin);
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync);
  } else { sync(); }
})();
