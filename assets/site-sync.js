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
        // PDP pack arrays carry an SKU (not the admin id), so match the admin
        // row by SKU. Only single packs exist in the catalogue today; packs 2/3
        // keep their bundled MRP until the admin adds those rows.
        var key = p.id;
        if (!key) {
          var hit = Object.keys(admin).filter(function (k) { return admin[k] && p.sku && admin[k].sku === p.sku; })[0];
          if (hit) key = hit;
        }
        var o = key ? admin[key] : null;
        if (!o) return;
        if (o.prepaid != null) { p.pre = o.prepaid; changed = true; }
        if (o.advance != null) { p.adv = o.advance; changed = true; }
        if (o.cod != null) { p.cod = o.cod; changed = true; }
        if (o.mrp != null) { p.mrp = o.mrp; changed = true; }
      });
      // The DB prices above are the source of truth; repaint the PDP preview,
      // the three payment cards and an already-open order summary so none of
      // them can keep showing the bundled fallback.
      if (typeof window.apSyncPrice === 'function') {
        try { window.apSyncPrice(); } catch (e) {}
      }
      if (typeof window.updatePay === 'function') {
        try { window.updatePay(); } catch (e) {}
      }
      return changed;
    } catch (e) { return false; }
  }

  // Admin image URLs that we also ship as leaner same-origin WebP copies.
  // Same picture, a fraction of the bytes: keep the swap, lose the weight.
  var OPT_IMG = {
    'https://cdn.avnideepayurveda.in/home/assets/shilajit-1.png': {
      set: '/home/assets/shilajit-1-400.webp 400w, /home/assets/shilajit-1-900.webp 900w',
      sizes: '(max-width:760px) 92vw, 460px',
      src: '/home/assets/shilajit-1-900.webp'
    },
    'https://cdn.avnideepayurveda.in/pain-oil/oil-1.png': {
      set: '/pain-oil/oil-1-400.webp 400w, /pain-oil/oil-1-900.webp 900w',
      sizes: '(max-width:760px) 92vw, 460px',
      src: '/pain-oil/oil-1-900.webp'
    }
  };

  function pictureFor(img) {
    var pic = img.closest ? img.closest('picture') : null;
    if (pic) return pic;
    if (!img.parentNode) return null;
    pic = document.createElement('picture');
    img.parentNode.insertBefore(pic, img);
    pic.appendChild(img);
    return pic;
  }

  function applyImages(admin) {
    try {
      document.querySelectorAll('img[data-pimg]').forEach(function (img) {
        // The product gallery owns the main image after an explicit thumbnail,
        // arrow, swipe or pack change. Never let the async catalogue paint over it.
        if (img.hasAttribute('data-gallery-locked')) return;
        var o = admin[img.getAttribute('data-pimg')];
        if (!o || !o.img) return;
        var opt = OPT_IMG[o.img];
        if (opt) {
          var pic = pictureFor(img);
          if (!pic) return;
          var src = pic.querySelector('source');
          if (!src) {
            src = document.createElement('source');
            src.type = 'image/webp';
            pic.insertBefore(src, img);
          }
          src.setAttribute('srcset', opt.set);
          // Match the slot the image actually renders in (a 64px thumb should not
          // pull the 900w file). Fall back to the card size when layout is not
          // ready yet, e.g. a hidden sticky element.
          var w = 0;
          try { w = Math.round(img.getBoundingClientRect().width); } catch (e) {}
          src.setAttribute('sizes', w > 0 ? w + 'px' : opt.sizes);
          if (img.getAttribute('src') !== opt.src) img.setAttribute('src', opt.src);
          return;
        }
        if (img.getAttribute('src') === o.img) return;
        // A <picture> <source> outranks the src attribute, so the responsive
        // sources have to go before the admin-chosen image can show.
        var old = img.closest ? img.closest('picture') : null;
        if (old) Array.prototype.slice.call(old.querySelectorAll('source')).forEach(function (s) { s.remove(); });
        img.setAttribute('src', o.img);
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
          // PRICING RULE: MRP is the COD price, prepaid is MRP - 20%. The API
          // already derives them, but deriving again here means an older /
          // cached catalog response can never re-introduce a stale
          // price_cod / price_prepaid pair into the storefront.
          var rule = (window.AVN_CHECKOUT && window.AVN_CHECKOUT.fromMrp) || null;
          // The admin row's explicit COD / advance-total / prepaid prices are
          // authoritative. Only a zero field falls back to the MRP rule.
          var explicit = {
            cod: Number(p.price_cod) || 0,
            advance: Number(p.price_advance) || 0,
            prepaid: Number(p.price_prepaid) || 0
          };
          var mrp = Number(p.mrp) || explicit.cod || explicit.prepaid || 0;
          var pr = (rule && mrp > 0)
            ? rule(mrp, explicit)
            : { mrp: mrp, cod: explicit.cod, advance: explicit.advance, prepaid: explicit.prepaid };
          admin[p.id] = {
            name: p.name, sku: p.sku,
            prepaid: pr.prepaid, advance: pr.advance, cod: pr.cod, mrp: pr.mrp,
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
