/* ==========================================================================
   AVNIDEEP AUTH — customer login (mobile + PIN) + My Orders drawer
   Partner-portal style: first login with a mobile number creates the
   account (customer sets a 4-6 digit PIN). Orders are fetched by the
   logged-in mobile number. Runs on every page; NEVER throws — a
   failure here must not break cart, checkout or tracking.
   ========================================================================== */
(function () {
  'use strict';

  var AUTH_API = '/api/auth';
  var ORDERS_API = '/api/my-orders';
  var state = { loggedIn: false, name: '', mobile: '' };

  function $(s, c) { try { return (c || document).querySelector(s); } catch (e) { return null; } }
  function $all(s, c) { try { return Array.prototype.slice.call((c || document).querySelectorAll(s)); } catch (e) { return []; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function inr(n) { try { return '₹' + Number(n || 0).toLocaleString('en-IN'); } catch (e) { return '₹' + n; } }

  function normMobile(raw) {
    var d = String(raw || '').replace(/[^0-9]/g, '');
    if (d.length > 10) d = d.slice(-10);
    return /^[6-9]\d{9}$/.test(d) ? d : '';
  }

  async function post(action, payload) {
    try {
      var body = payload || {};
      body.action = action;
      var r = await fetch(AUTH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      return await r.json().catch(function () { return { ok: false, error: 'Network error. Please try again.' }; });
    } catch (e) {
      return { ok: false, error: 'Network error. Please try again.' };
    }
  }

  async function getJSON(url) {
    try {
      var r = await fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
      return await r.json().catch(function () { return { ok: false }; });
    } catch (e) {
      return { ok: false };
    }
  }

  /* ---------- status labels ---------- */
  var STATUS = [
    [/cancel|refund|fail/, 'Cancelled', 'cancel'],
    [/deliver/, 'Delivered', 'done'],
    [/ship|dispatch|transit/, 'Shipped', 'ship'],
    [/paid|success|confirm|prepaid/, 'Confirmed', 'done'],
  ];
  function statusLabel(raw) {
    var s = String(raw || '').toLowerCase();
    for (var i = 0; i < STATUS.length; i++) {
      if (STATUS[i][0].test(s)) return { t: STATUS[i][1], c: STATUS[i][2] };
    }
    return { t: 'Order placed', c: 'placed' };
  }
  function fmtDate(iso) {
    try {
      var d = new Date(String(iso || '').replace(' ', 'T') + (String(iso).indexOf('Z') < 0 && String(iso).indexOf('+') < 0 ? 'Z' : ''));
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return ''; }
  }

  /* ---------- login modal ---------- */
  var ov = null, box = null, stepBox = null, errBox = null;
  var flow = { mobile: '', exists: false, name: '' };

  function buildModal() {
    if (box) return;
    try {
      ov = document.createElement('div');
      ov.className = 'auth-ov';
      box = document.createElement('div');
      box.className = 'auth-modal';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Login or create account');
      box.innerHTML =
        '<button type="button" class="auth-x" data-auth-close aria-label="Close">&times;</button>' +
        '<div class="auth-h"><b id="authTitle">Login / Sign up</b><span id="authSub">Track orders faster with your mobile number</span></div>' +
        '<div class="auth-err" id="authErr" role="alert"></div>' +
        '<div id="authStep"></div>';
      stepBox = box.querySelector('#authStep');
      errBox = box.querySelector('#authErr');
      ov.appendChild(box);
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) {
        if (e.target === ov || (e.target.closest && e.target.closest('[data-auth-close]'))) closeModal();
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    } catch (e) {}
  }

  function showErr(msg) {
    try {
      if (!errBox) return;
      errBox.textContent = msg || '';
      errBox.style.display = msg ? '' : 'none';
    } catch (e) {}
  }

  function openModal() { buildModal(); if (!ov) return; renderMobileStep(); document.documentElement.classList.add('auth-lock'); ov.classList.add('on'); }
  function closeModal() { if (!ov) return; ov.classList.remove('on'); document.documentElement.classList.remove('auth-lock'); }

  function renderMobileStep() {
    showErr('');
    try {
      var t = $('#authTitle'); if (t) t.textContent = 'Login / Sign up';
      var st = $('#authSub'); if (st) st.textContent = 'Track orders faster with your mobile number';
      stepBox.innerHTML =
        '<div class="auth-field"><label for="authMobile">Mobile number</label>' +
        '<div class="phone-input-wrap"><span class="phone-prefix">+91</span>' +
        '<input id="authMobile" type="tel" inputmode="numeric" maxlength="10" placeholder="98765 43210" autocomplete="tel"></div></div>' +
        '<button type="button" class="auth-btn" id="authGo">Continue</button>' +
        '<p class="auth-note">First time here? You will set a 4-digit PIN on the next step.</p>';
      var input = $('#authMobile');
      var go = function () {
        var m = normMobile(input.value);
        if (!m) { showErr('Please enter a valid 10-digit mobile number.'); return; }
        var btn = $('#authGo');
        if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
        post('check', { mobile: m }).then(function (res) {
          if (!res || !res.ok) { showErr((res && res.error) || 'Network error. Please try again.'); if (btn) { btn.disabled = false; btn.textContent = 'Continue'; } return; }
          flow.mobile = m; flow.exists = !!res.exists; flow.name = res.name || '';
          if (flow.exists) renderPinStep();
          else renderRegisterStep();
        });
      };
      $('#authGo').addEventListener('click', go);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (e) {} }, 60);
    } catch (e) {}
  }

  function pinField(id, label, extra) {
    return '<div class="auth-field"><label for="' + id + '">' + label + '</label>' +
      '<input id="' + id + '" type="password" inputmode="numeric" maxlength="6" placeholder="••••" autocomplete="' + (extra || 'current-password') + '"></div>';
  }

  function renderPinStep() {
    showErr('');
    try {
      var t = $('#authTitle'); if (t) t.textContent = 'Welcome back' + (flow.name ? ', ' + flow.name.split(' ')[0] : '');
      var st = $('#authSub'); if (st) st.textContent = '+91 ' + flow.mobile;
      stepBox.innerHTML =
        pinField('authPin', 'Enter your PIN') +
        '<button type="button" class="auth-btn" id="authLogin">Login</button>' +
        '<button type="button" class="auth-link" id="authBack">← Use a different number</button>';
      var go = function () {
        var pin = ($('#authPin').value || '').trim();
        if (!/^\d{4,6}$/.test(pin)) { showErr('Please enter your 4–6 digit PIN.'); return; }
        var btn = $('#authLogin');
        if (btn) { btn.disabled = true; btn.textContent = 'Logging in…'; }
        post('login', { mobile: flow.mobile, pin: pin }).then(function (res) {
          if (res && res.ok) { onLoggedIn(res.name, res.mobile); return; }
          showErr((res && (res.error === 'not_found' ? 'Account not found. Please create a PIN first.' : res.error)) || 'Login failed.');
          var b2 = $('#authLogin');
          if (b2) { b2.disabled = false; b2.textContent = 'Login'; }
        });
      };
      $('#authLogin').addEventListener('click', go);
      $('#authPin').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      $('#authBack').addEventListener('click', renderMobileStep);
      setTimeout(function () { try { $('#authPin').focus({ preventScroll: true }); } catch (e) {} }, 60);
    } catch (e) {}
  }

  function renderRegisterStep() {
    showErr('');
    try {
      var t = $('#authTitle'); if (t) t.textContent = 'Create your account';
      var st = $('#authSub'); if (st) st.textContent = '+91 ' + flow.mobile + ' — set a PIN for faster login';
      stepBox.innerHTML =
        '<div class="auth-field"><label for="authName">Your name</label>' +
        '<input id="authName" type="text" placeholder="e.g., Rahul Sharma" autocomplete="name" maxlength="50"></div>' +
        pinField('authPin1', 'Set a 4–6 digit PIN', 'new-password') +
        pinField('authPin2', 'Confirm PIN', 'new-password') +
        '<button type="button" class="auth-btn" id="authCreate">Create account</button>' +
        '<button type="button" class="auth-link" id="authBack">← Use a different number</button>';
      var go = function () {
        var name = ($('#authName').value || '').trim();
        var p1 = ($('#authPin1').value || '').trim();
        var p2 = ($('#authPin2').value || '').trim();
        if (name.length < 2) { showErr('Please enter your name.'); return; }
        if (!/^\d{4,6}$/.test(p1)) { showErr('PIN must be 4–6 digits.'); return; }
        if (p1 !== p2) { showErr('PINs do not match. Please re-enter.'); return; }
        var btn = $('#authCreate');
        if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
        post('register', { mobile: flow.mobile, name: name, pin: p1, pin2: p2 }).then(function (res) {
          if (res && res.ok) { onLoggedIn(res.name, res.mobile); return; }
          if (res && res.error === 'exists') { flow.exists = true; renderPinStep(); return; }
          showErr((res && res.error) || 'Could not create account.');
          var b2 = $('#authCreate');
          if (b2) { b2.disabled = false; b2.textContent = 'Create account'; }
        });
      };
      $('#authCreate').addEventListener('click', go);
      $('#authBack').addEventListener('click', renderMobileStep);
      setTimeout(function () { try { $('#authName').focus({ preventScroll: true }); } catch (e) {} }, 60);
    } catch (e) {}
  }

  function onLoggedIn(name, mobile) {
    state.loggedIn = true; state.name = name || ''; state.mobile = mobile || '';
    closeModal();
    render();
    prefillCheckout();
    openOrders();
  }

  /* ---------- orders drawer ---------- */
  var dov = null, ddr = null, dlist = null;

  function buildDrawer() {
    if (ddr) return;
    try {
      dov = document.createElement('div');
      dov.className = 'auth-dov';
      ddr = document.createElement('aside');
      ddr.className = 'auth-dr';
      ddr.setAttribute('role', 'dialog');
      ddr.setAttribute('aria-label', 'My orders');
      ddr.innerHTML =
        '<div class="auth-drh"><div><b>My Orders</b><span class="auth-drsub" data-auth-drsub></span></div>' +
        '<button type="button" class="auth-x light" data-auth-drclose aria-label="Close">&times;</button></div>' +
        '<div class="auth-items" data-auth-items></div>' +
        '<div class="auth-drf"><a class="auth-call" href="tel:+917060101043">Need help? Call +91 70601 01043</a>' +
        '<p class="auth-note">Support: WhatsApp 9am–7pm</p></div>';
      dlist = ddr.querySelector('[data-auth-items]');
      document.body.appendChild(dov);
      document.body.appendChild(ddr);
      var close = function () { dov.classList.remove('on'); ddr.classList.remove('on'); document.documentElement.classList.remove('auth-lock'); };
      dov.addEventListener('click', close);
      ddr.querySelector('[data-auth-drclose]').addEventListener('click', close);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    } catch (e) {}
  }

  function openOrders() {
    if (!state.loggedIn) { openModal(); return; }
    buildDrawer();
    if (!ddr) return;
    try {
      var sub = ddr.querySelector('[data-auth-drsub]');
      if (sub) sub.textContent = '+91 ' + state.mobile;
      dlist.innerHTML = '<div class="auth-loading">Loading your orders…</div>';
      document.documentElement.classList.add('auth-lock');
      dov.classList.add('on'); ddr.classList.add('on');
      getJSON(ORDERS_API).then(function (res) {
        if (!res || !res.ok) {
          dlist.innerHTML = '<div class="auth-empty">Could not load orders. Please try again.</div>';
          return;
        }
        var list = res.orders || [];
        if (!list.length) {
          dlist.innerHTML = '<div class="auth-empty"><div class="e-ico">📦</div><b>No orders yet</b>' +
            '<p>Orders placed with +91 ' + esc(state.mobile) + ' will appear here.</p>' +
            '<a class="auth-btn" href="/#products">Shop Bestsellers</a></div>';
          return;
        }
        dlist.innerHTML = list.map(function (o) {
          var st = statusLabel(o.status);
          return '<div class="auth-ord"><div class="ord-top"><b>' + esc(o.product || 'Avnideep order') + '</b>' +
            '<span class="ord-st ' + st.c + '">' + st.t + '</span></div>' +
            '<div class="ord-meta"><span>#' + esc(o.order_id) + '</span><span>' + esc(fmtDate(o.created_at)) + '</span></div>' +
            '<div class="ord-bot"><span>' + inr(o.amount) + ' • ' + esc(String(o.payment_method || 'cod').toUpperCase()) + '</span></div></div>';
        }).join('');
      });
    } catch (e) {}
  }

  /* ---------- header icon + slide-menu entries ---------- */
  function injectIcon() {
    try {
      var icons = $('.rx-icons');
      if (!icons || $('.rx-acctbtn')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rx-acctbtn';
      btn.setAttribute('data-auth-open', '');
      btn.setAttribute('aria-label', 'Login or my account');
      btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5 19c1.4-3.2 4-4.6 7-4.6s5.6 1.4 7 4.6"/></svg><span class="acct-n" data-auth-init></span>';
      var cta = icons.querySelector('.rx-cta');
      if (cta) icons.insertBefore(btn, cta);
      else icons.appendChild(btn);
    } catch (e) {}
  }

  function menuHTML() {
    if (!state.loggedIn) {
      return '<a href="#" data-auth-open><span>Login / Sign up</span><small>→</small></a>';
    }
    return '<a href="#" data-auth-orders><span>My Orders</span><small>→</small></a>' +
      '<a href="#" data-auth-logout><span>Logout (' + esc(state.mobile) + ')</span><small>→</small></a>';
  }

  function injectMenu() {
    try {
      var nav = $('.rx-mnav-links');
      if (!nav) return false;
      var old = nav.querySelector('[data-auth-slot]');
      if (old) old.remove();
      var slot = document.createElement('div');
      slot.setAttribute('data-auth-slot', '');
      slot.innerHTML = menuHTML();
      nav.appendChild(slot);
      return true;
    } catch (e) { return false; }
  }

  var menuTries = 0;
  function ensureMenu() {
    if (injectMenu()) return;
    if (menuTries++ < 8) setTimeout(ensureMenu, 500);
  }

  function render() {
    try {
      var init = $('[data-auth-init]');
      if (init) {
        init.textContent = state.loggedIn && state.name ? state.name.trim().charAt(0).toUpperCase() : '';
        init.classList.toggle('on', !!(state.loggedIn && state.name));
      }
      var btn = $('.rx-acctbtn');
      if (btn) btn.setAttribute('aria-label', state.loggedIn ? ('My account (' + state.mobile + ')') : 'Login or my account');
      injectMenu();
    } catch (e) {}
  }

  async function logout() {
    try { await post('logout', {}); } catch (e) {}
    state.loggedIn = false; state.name = ''; state.mobile = '';
    render();
  }

  /* ---------- checkout prefill (logged-in customers skip typing) ---------- */
  function prefillCheckout() {
    if (!state.loggedIn) return;
    try {
      var nameEls = $all('#cName, input[name="name"]');
      var phoneEls = $all('#tcPhoneInput, input[name="phone"]');
      nameEls.forEach(function (el) { if (el && !el.value && state.name) el.value = state.name; });
      phoneEls.forEach(function (el) { if (el && !el.value && state.mobile) el.value = state.mobile; });
    } catch (e) {}
  }

  async function me() {
    var res = await getJSON(AUTH_API + '?action=me');
    if (res && res.loggedIn) {
      state.loggedIn = true; state.name = res.name || ''; state.mobile = res.mobile || '';
      prefillCheckout();
    }
    render();
  }

  /* ---------- global clicks ---------- */
  document.addEventListener('click', function (e) {
    try {
      var t = e.target && e.target.closest ? e.target.closest('[data-auth-open],[data-auth-orders],[data-auth-logout]') : null;
      if (!t) return;
      e.preventDefault();
      if (t.hasAttribute('data-auth-open')) {
        if (state.loggedIn) openOrders();
        else openModal();
      } else if (t.hasAttribute('data-auth-orders')) {
        openOrders();
      } else if (t.hasAttribute('data-auth-logout')) {
        logout();
      }
    } catch (err) {}
  });

  /* ---------- init (never throws) ---------- */
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { injectIcon(); ensureMenu(); me(); });
    } else {
      injectIcon(); ensureMenu(); me();
    }
    window.AVN_AUTH = {
      openLogin: function () { if (state.loggedIn) openOrders(); else openModal(); },
      openOrders: openOrders,
      state: state,
    };
  } catch (e) {
    try { window.AVN_AUTH = { openLogin: function () {}, openOrders: function () {}, state: state }; } catch (e2) {}
  }
})();
