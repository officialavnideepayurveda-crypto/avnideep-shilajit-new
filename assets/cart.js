/* ==========================================================================
   AVNIDEEP CART — localStorage cart + slide-in drawer (Renee-style)
   Works on every page. No backend change: single-product carts route to the
   existing order popup (keeps Meta Pixel + CAPI funnel intact), mixed carts
   route to WhatsApp order with itemised message.
   ========================================================================== */
(function () {
  'use strict';

  var PRODUCTS = {
    shilajit: {
      id: 'shilajit', sku: 'AVN-6PRO-001',
      name: '6Pro Shilajit Capsules', variant: '30 Capsules',
      img: '/home/assets/shilajit-1.png',
      cod: 1250, prepaid: 999, mrp: 2500, url: '/shilajit/'
    },
    oil: {
      id: 'oil', sku: 'AVN-OIL-001',
      name: 'Pain Relief Oil', variant: '60ml',
      img: '/pain-oil/oil-1.png',
      cod: 249, prepaid: 249, mrp: 499, url: '/pain-oil/'
    }
  };
  var KEY = 'avn_cart_v1', FREE_ABOVE = 499, SHIP_FEE = 49;

  /* ---------- storage ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function store() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) {} }
  var cart = load();

  /* ---------- helpers ---------- */
  function ids() { return Object.keys(cart).filter(function (k) { return cart[k] > 0; }); }
  function itemCount() { var n = 0; ids().forEach(function (k) { n += cart[k]; }); return n; }
  function sum(fn) { var s = 0; ids().forEach(function (k) { s += fn(PRODUCTS[k]) * cart[k]; }); return s; }
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
        '<p>Shilajit ya Pain Relief Oil add karein — COD available, free shipping ₹499+</p>' +
        '<a class="cart-btn2" href="/#products">Shop Bestsellers</a>' +
        '</div>';
    } else {
      list.innerHTML = ids().map(function (k) {
        var p = PRODUCTS[k], q = cart[k];
        var save = (p.mrp - p.cod) * q;
        return '' +
        '<div class="cart-it" data-key="' + k + '">' +
          '<img src="' + p.img + '" alt="' + p.name + '">' +
          '<div class="it-b">' +
            '<b>' + p.name + '</b><span class="it-v">' + p.variant + '</span>' +
            '<div class="it-p"><s>' + inr(p.mrp) + '</s> ' + inr(p.cod) +
              (save > 0 ? ' <em>save ' + inr(save) + '</em>' : '') + '</div>' +
            '<div class="it-q">' +
              '<button type="button" data-cart-dec aria-label="Decrease">−</button>' +
              '<span>' + q + '</span>' +
              '<button type="button" data-cart-inc aria-label="Increase">+</button>' +
              '<button type="button" class="it-rm" data-cart-rm>Remove</button>' +
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
        (cart.shilajit ? ' &nbsp;•&nbsp; <span class="pre-note">Prepaid par Shilajit sirf ₹999 (₹251 extra off)</span>' : '')
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
    if (!PRODUCTS[id]) return;
    cart[id] = (cart[id] || 0) + (q || 1);
    store(); renderBadge();
    track('AddToCart', { content_ids: [PRODUCTS[id].sku], content_name: PRODUCTS[id].name, value: PRODUCTS[id].cod * (q || 1), currency: 'INR' });
    openDr();
  }

  function checkout() {
    var ks = ids();
    if (!ks.length) return;
    track('InitiateCheckout', { value: sub(), currency: 'INR', num_items: itemCount() });
    closeDr();
    if (ks.length === 1) {
      var p = PRODUCTS[ks[0]];
      var here = location.pathname.replace(/\/$/, '');
      var there = p.url.replace(/\/$/, '');
      if (here === there && typeof openOrderPopup === 'function') { try { openOrderPopup(); } catch (e) {} }
      else { location.href = p.url + '?open=1'; }
    } else {
      waOrder();
    }
  }

  function waOrder() {
    if (!ids().length) { location.href = 'https://wa.me/917060101043?text=' + encodeURIComponent('Hi Avnideep, mujhe order karna hai'); return; }
    var lines = ['*🛒 New Order — Avnideep Ayurveda*', ''];
    ids().forEach(function (k) {
      var p = PRODUCTS[k];
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
    if ((t = e.target.closest('[data-cart-add]'))) { e.preventDefault(); add(t.getAttribute('data-cart-add'), 1); return; }
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

  /* ---------- init ---------- */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBadge);
  else renderBadge();
})();
