/* ==========================================================================
   Avnideep — unified Meta Pixel + Conversions API (CAPI) tracking layer
   --------------------------------------------------------------------------
   Loaded synchronously in <head> on every page. It:
     • bootstraps the Meta Pixel stub immediately and queues PageView (the
       network bundle is still deferred for performance, so nothing is lost
       when someone bounces before fbevents.js finishes downloading);
     • provides window.AVN_META.track() which fires the browser Pixel and the
       server-side CAPI with the SAME event_id so Meta deduplicates them;
     • always passes eventID as the 4th fbq() argument (the correct place —
       inside custom data Meta ignores it and the event double-counts);
     • only sends PII to the server, where it is SHA-256 hashed. The browser
       Pixel never receives a name/phone/email (Meta policy compliant);
     • adds the funnel steps the site was missing: Contact and AddPaymentInfo.
   ========================================================================== */
(function () {
  'use strict';

  if (window.AVN_META) return;

  var cfg = window.AVN_META_CFG || {};
  var PIXEL = String(cfg.pixel || '1715387275770711');
  var LOAD_DELAY = typeof cfg.loadDelay === 'number' ? cfg.loadDelay : 1200; // kept for API compatibility
  var HOST = (location.hostname || '').toLowerCase();
  var DISABLED = HOST === 'localhost' || HOST === '127.0.0.1' || HOST === '::1' || HOST === '[::1]';

  /* --------------------------------------------------------- state / user */
  var identify = {};          // {name, phone, email} — memory only
  var pageFired = {};         // per-page dedup
  var lastPayMethod = '';

  /* ---------------------------------------------------------------- utils */
  function now() { return Date.now(); }
  function rand() { return Math.random().toString(36).slice(2, 10); }
  function genId(prefix) { return (prefix || 'evt') + '_' + now() + '_' + rand(); }

  /* One InitiateCheckout id per checkout session. The PDP/cart checkout click
     creates it, the order API reuses it for its CAPI event, and payment.html
     reuses it again — so Meta sees one checkout instead of 2-3. */
  function checkoutId(forceNew) {
    var KEY = 'avn_ic_id';
    try {
      var existing = sessionStorage.getItem(KEY);
      if (existing && !forceNew) return existing;
      var id = genId('ico');
      sessionStorage.setItem(KEY, id);
      return id;
    } catch (e) { return genId('ico'); }
  }
  function endCheckout() {
    try { sessionStorage.removeItem('avn_ic_id'); } catch (e) {}
  }

  function readCookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }

  /* fbevents.js sets _fbp when it runs. Because we defer that bundle for
     performance, create a matching _fbp up front so the very first CAPI
     event (PageView) already carries a browser id for better matching. */
  function ensureFbp() {
    if (readCookie('_fbp')) return;
    try {
      var val = 'fb.1.' + now() + '.' + Math.floor(Math.random() * 1e10);
      document.cookie = '_fbp=' + val + '; path=/; max-age=7776000; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) {}
  }

  /* ------------------------------------------------------- fbq bootstrap */
  /* Meta's own bootstrap, kept verbatim: fbevents.js expects the queue to live
     on the fbq function itself and takes the bundle over only when the stub is
     marked loaded. A bespoke stub (private queue, delayed bundle) sent events
     fired before takeover but silently dropped everything after it, which is
     why AddToCart / InitiateCheckout / Purchase never reached Meta. */
  if (!DISABLED && !window.fbq) {
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  }

  /* Queue init + PageView right away so they are never dropped. Only the
     115 KB fbevents bundle is delayed until the visitor shows intent. */
  if (!DISABLED) {
    ensureFbp();
    var pvId = genId('pv');
    try { window.fbq('init', PIXEL); } catch (e) {}
    try { window.fbq('track', 'PageView', {}, { eventID: pvId }); } catch (e) {}
    try { window.__avnPageViewFired = true; } catch (e) {}
    // Mirror PageView server-side with the same event_id (Meta dedups it).
    sendCapi('PageView', pvId, {}, location.href.split('#')[0]);
  }


  function normalize(data) {
    var d = {};
    var src = data || {};
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var v = src[k];
      if (v === undefined || v === null || v === '') continue;
      // eventID belongs in fbq options, never in custom data.
      if (k === 'eventID' || k === 'event_id') continue;
      d[k] = v;
    }
    if (d.value != null) d.value = Number(d.value) || 0;
    if (!d.currency) d.currency = 'INR';
    if (d.content_ids && !Array.isArray(d.content_ids)) d.content_ids = [String(d.content_ids)];
    if (!d.content_type && d.content_ids) d.content_type = 'product';
    if (d.num_items != null) d.num_items = Number(d.num_items) || 0;
    if (d.contents && !Array.isArray(d.contents)) d.contents = [d.contents];
    return d;
  }

  function dedupKey(event, d, explicit) {
    if (explicit) return event + '|' + explicit;
    var cid = d.content_ids ? d.content_ids.join(',') : (d.content_name || '');
    return event + '|' + cid + '|' + (d.value != null ? d.value : '');
  }

  function sendCapi(event, eventId, data, source) {
    try {
      var userData = {
        client_user_agent: navigator.userAgent || '',
        fbp: readCookie('_fbp'),
        fbc: readCookie('_fbc')
      };
      if (identify.name) userData.name = identify.name;
      if (identify.phone) userData.phone = identify.phone;
      if (identify.email) userData.email = identify.email;

      var body = JSON.stringify({
        event_name: event,
        event_id: eventId,
        event_source_url: source || (location.href.split('#')[0]),
        custom_data: data,
        user_data: userData
      });

      fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: body
      }).catch(function () {});
    } catch (e) {}
  }

  /* Fire a standard Meta event on the Pixel and the CAPI with one event_id. */
  function track(event, data, opts) {
    if (DISABLED) return '';
    opts = opts || {};
    var d = normalize(data);
    var eventId = opts.eventID ||
      (event === 'InitiateCheckout' ? checkoutId(!!opts.newCheckout) : genId(String(event || 'evt').toLowerCase()));
    var key = dedupKey(event, d, opts.dedupKey);

    if (opts.once !== false) {
      if (pageFired[key]) return '';
      pageFired[key] = 1;
    }

    try {
      if (typeof window.fbq === 'function') {
        window.fbq('track', event, d, { eventID: eventId });
      }
    } catch (e) {}

    if (opts.capi !== false) sendCapi(event, eventId, d, opts.source);
    return eventId;
  }

  /* Purchase has its own guard so a refresh/duplicate redirect can never
     double-count a sale (Pixel or CAPI). */
  function trackPurchase(orderId, value, opts) {
    if (DISABLED) return '';
    opts = opts || {};
    var key = 'avn_purchase_fired_' + (orderId || '');
    try {
      if (orderId && (sessionStorage.getItem(key) || localStorage.getItem(key))) return '';
    } catch (e) {}

    var eventId = opts.eventID || orderId || genId('purch');
    var data = normalize({
      value: value,
      currency: opts.currency || 'INR',
      content_type: opts.content_type || 'product',
      content_name: opts.content_name || 'AVN-6PRO-001',
      content_ids: opts.content_ids || (opts.content_name ? [opts.content_name] : ['AVN-6PRO-001']),
      order_id: orderId,
      num_items: opts.num_items
    });

    try {
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'Purchase', data, { eventID: eventId });
      }
    } catch (e) {}
    /* Prepaid orders already send Purchase CAPI from /api/order (same
       order_id => Meta dedups). Only COD needs the browser-side CAPI relay. */
    if (opts.capi !== false) sendCapi('Purchase', eventId, data, opts.source);

    try {
      if (orderId) {
        sessionStorage.setItem(key, '1');
        localStorage.setItem(key, '1');
      }
    } catch (e) {}
    return eventId;
  }

  /* ----------------------------------------------------- auto-bind funnel */
  function numFromPage() {
    var el = document.querySelector('[data-cart-total], #payAmount, #oTotal, .cart-total, .ap-total');
    if (!el) return undefined;
    var n = parseFloat(String(el.textContent || '').replace(/[^\d.]/g, ''));
    return isNaN(n) ? undefined : n;
  }

  function paymentChanged(value) {
    if (!value) return;
    // The product page's price cards use C/P/A; the checkout radios use the
    // long names. Normalize so the two paths share one dedup key.
    var map = { C: 'cod', P: 'prepaid', A: 'advance' };
    value = map[value] || value;
    if (value === lastPayMethod) return;
    lastPayMethod = value;
    var label = value === 'cod' ? 'Cash on Delivery' : (value === 'advance' ? 'Advance Payment' : 'Prepaid Online');
    var v = numFromPage();
    track('AddPaymentInfo', {
      content_name: 'AVN-6PRO-001',
      content_type: 'product',
      content_ids: ['AVN-6PRO-001'],
      value: v,
      currency: 'INR',
      payment_method: label
    }, { dedupKey: 'pay_' + value, once: true });
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var el = e.target;
      if (!el || !el.closest) return;
      var a = el.closest('a[href]');
      if (a) {
        var href = a.getAttribute('href') || '';
        if (href.indexOf('tel:') === 0) {
          track('Contact', { content_name: 'Phone Call', content_category: 'Contact' }, { dedupKey: 'tel' });
        } else if (/wa\.me|api\.whatsapp|whatsapp\.com/i.test(href)) {
          track('Contact', { content_name: 'WhatsApp', content_category: 'Contact' }, { dedupKey: 'wa' });
        }
      }
      var pay = el.closest('.ap-pack[data-pay], .pay-card, [data-pay]');
      if (pay) {
        var v = pay.getAttribute('data-pay') || (pay.value) || '';
        setTimeout(function () { paymentChanged(v); }, 60);
      }
    }, true);

    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.name === 'paymentMethod' && t.checked) {
        paymentChanged(t.value);
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  /* ------------------------------------------------------------ public API */
  window.AVN_META = {
    pixelId: PIXEL,
    track: track,
    trackPurchase: trackPurchase,
    identify: function (u) {
      if (!u) return;
      if (u.name) identify.name = u.name;
      if (u.phone) identify.phone = u.phone;
      if (u.email) identify.email = u.email;
    },
    eventId: genId,
    checkoutId: checkoutId,
    endCheckout: endCheckout,
    // CAPI-only helper (for page code that already fired the Pixel itself)
    capi: function (event, eventId, data, source) {
      if (DISABLED) return '';
      sendCapi(event, eventId || genId(String(event || 'evt').toLowerCase()), normalize(data), source);
      return eventId;
    },
    // helpers
    addToCart: function (p) { return track('AddToCart', p); },
    initiateCheckout: function (p, o) {
      o = o || {};
      o.eventID = o.eventID || checkoutId(true);
      return track('InitiateCheckout', p, o);
    },
    addPaymentInfo: function (p) { return track('AddPaymentInfo', p); },
    viewContent: function (p) { return track('ViewContent', p); },
    lead: function (p) { return track('Lead', p); },
    contact: function (p) { return track('Contact', p); },
    search: function (p) { return track('Search', p); }
  };
})();
