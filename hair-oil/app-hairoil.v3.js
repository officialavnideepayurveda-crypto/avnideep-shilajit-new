// ============================================================

// Avnideep Ayurveda - App Script (extracted from index.html)

// ============================================================




// ===== REFERRAL COOKIE (Sprint 2) =====
// Writes the avnideep_ref cookie ONLY when the visitor arrived via ?ref=CODE.
// 30-day, last-touch (new ref overwrites old). Server reads it at order creation.
// ==========================================================================
(function () {
  try {
    var ref = new URLSearchParams(window.location.search).get('ref');
    // STRICT FIX: only valid partner codes (AVN + 6 unambiguous chars) may
    // overwrite the cookie. Junk ?ref= (e.g. TEST) must NOT clobber a prior
    // valid referral — matches server CODE_RE in functions/api/_lib/attribution.js
    if (ref && /^AVN[A-HJ-KM-NP-Z2-9]{6}$/i.test(ref.trim())) {
      // WARN-4 FIX: write a timestamp cookie so the server can enforce the 30-day window
      var secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = 'avnideep_ref=' + encodeURIComponent(ref.trim().toUpperCase()) +
        '; max-age=2592000; path=/; SameSite=Lax' + secure;
      document.cookie = 'avnideep_ref_ts=' + Math.floor(Date.now() / 1000) +
        '; max-age=2592000; path=/; SameSite=Lax' + secure;
    }
  } catch (e) {}
})();

// ===== AFFILIATE CLICK TRACKING (Sprint 4 analytics) =====
// Fires a beacon to the partner portal whenever this visitor has an
// active referral (fresh ?ref= or a stored avnideep_ref cookie).
// visitor_id persists (localStorage), session_id per tab (sessionStorage).
// Fire-and-forget: analytics must never slow or break the shop.
// ==========================================================================
(function () {
  try {
    var refCookie = (document.cookie.match(/(?:^|;\\s*)avnideep_ref=([^;]+)/) || [])[1] || '';
    var refParam = new URLSearchParams(window.location.search).get('ref') || '';
    var refCode = (refParam || decodeURIComponent(refCookie || '')).toUpperCase();
    if (!refCode || !/^[A-Z0-9]{4,16}$/.test(refCode)) return;

    var vid = '';
    try { vid = localStorage.getItem('avnideep_vid') || ''; } catch (e) {}
    if (!vid) {
      vid = 'v' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem('avnideep_vid', vid); } catch (e) {}
    }
    var sid = '';
    try { sid = sessionStorage.getItem('avnideep_sid') || ''; } catch (e) {}
    if (!sid) {
      sid = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { sessionStorage.setItem('avnideep_sid', sid); } catch (e) {}
    }
    var u = new URLSearchParams(window.location.search);
    var payload = {
      ref: refCode, visitor_id: vid, session_id: sid,
      landing_page: window.location.pathname + window.location.search,
      utm_source: u.get('utm_source') || '', utm_medium: u.get('utm_medium') || '',
      utm_campaign: u.get('utm_campaign') || ''
    };
    var beaconUrl = 'https://partners.avnideepayurveda.in/api/referral/click';
    var body = JSON.stringify(payload);
    // CORS FIX: text/plain = CORS "simple request" → NO preflight. sendBeacon
    // always sends with credentials:include, and an application/json blob forced
    // a preflight that browsers blocked (Access-Control-Allow-Credentials missing)
    // → clicks were silently dropped. text/plain sends everywhere, incl. FB/IG
    // in-app browsers. Endpoint parses the body via request.json() regardless.
    var sent = false;
    try { sent = navigator.sendBeacon(beaconUrl, new Blob([body], { type: 'text/plain' })); } catch (e) {}
    if (!sent) {
      try { fetch(beaconUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: true }).catch(function () {}); } catch (e2) {}
    }
  } catch (e) {}
})();

// ===== CHECKOUT UI (Script #7) =====
// ==========================================================================




// ===== Duplicate Order Lock: Check localStorage =====




// ===== Facebook CAPI Server-Side Event Forwarding =====
// Sends events to /api/events with matching event_id for Facebook dedup
var _capiQueue = [];

function _genEventId(eventName) {
  return eventName + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
}

function _sendCapiEvent(eventName, eventId, customData, userExtra) {
  try {
    fetch('/api/events', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        event_name: eventName,
        event_id: eventId,
        event_source_url: window.location.href.split('?')[0],
        custom_data: customData || {},
        user_data: Object.assign({
          client_user_agent: navigator.userAgent || '',
          fbp: getCookie('_fbp') || '',
          fbc: getCookie('_fbc') || ''
        }, userExtra || {})
      })
    }).catch(function(){});
  } catch(e){}
}

function trackFbEvent(eventName, params, eventId, userExtra) {
  if (!eventId) eventId = _genEventId(eventName);
  try {
    if (typeof fbq === 'function') {
      fbq('track', eventName, Object.assign({}, params || {}, {eventID: eventId}));
    }
  } catch(e){}
  _sendCapiEvent(eventName, eventId, params, userExtra);
}

// ==========================================================================
// MAIN APPLICATION (Script #9)
// ==========================================================================
(function() {



  "use strict";



  var $ = function(s,c){return (c||document).querySelector(s)};



  var $$ = function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};



  var body = document.body;






  var WA_URL = "https://wa.me/917060101043?text=Hello%20I%20want%20to%20order%20Avnideep%20Hair%20Oil";



  var submitting = false;




  var CHECKOUT_MODE = 'advance';

  /* Checkout helpers. The page's inline script is an IIFE, so these are NOT
     global - they must live here or build()/_sendCapiEvent() throw
     "getUtmParams is not defined" and the order is never posted. */
  var UTM_DEFAULTS = {source:'facebook', medium:'cpc', campaign:'avnideep_hairoil'};
  function getUtmParams(){
    var params = new URLSearchParams(window.location.search);
    return {
      source: params.get('utm_source') || UTM_DEFAULTS.source,
      medium: params.get('utm_medium') || UTM_DEFAULTS.medium,
      campaign: params.get('utm_campaign') || UTM_DEFAULTS.campaign
    };
  }
  function getCookie(name){
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : '';
  }
  function appendUtm(url){
    try{
      var u = new URL(url, window.location.origin);
      var utm = getUtmParams();
      if(!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', utm.source);
      if(!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', utm.medium);
      if(!u.searchParams.has('utm_campaign')) u.searchParams.set('utm_campaign', utm.campaign);
      return u.toString();
    }catch(e){ return url; }
  }
  function buildUtmLabel(){
    var utm = getUtmParams();
    return 'UTM: ' + utm.source + ' / ' + utm.medium + ' / ' + utm.campaign;
  }

  /* PACK SIZE pricing (synced with PDP #apSize selector + cart.js bundles) */
  var AP_PACKS=[
  {mrp:499,sku:'AVN-HAIR-001'},
  {mrp:998,sku:'AVN-HAIR-002'},
  {mrp:1497,sku:'AVN-HAIR-003'}];
  AP_PACKS.forEach(function(p){p.cod=p.mrp;p.pre=Math.round(p.mrp*0.8);p.adv=p.mrp;});
  /* A cart checkout prices EVERY line it holds (mixed cart, two packs of the
     same product, or a quantity > 1). A direct Buy Now still prices the pack
     selected on this page. All three read the same P() catalogue as the cart
     via AVN_CHECKOUT.pack, so admin/DB price overrides apply everywhere. */
  function cartPriced(){var CS=window.AVN_CART_STATE;return !!(CS&&CS.items&&CS.items.length&&(CS.mixed||CS.fromCart));}
  /* Quantity chosen next to Add to Cart / Buy Now also prices a direct order
     (the cart flow carries its own quantities in AVN_CART_STATE). */
  function directQty(){var el=document.getElementById('apQtyVal');var n=el?parseInt(el.textContent,10):1;return (n>=1&&n<=9)?n:1;}
  function directPack(){try{var p=JSON.parse(localStorage.getItem('avn_pack')||'null');if(p&&p.page==='hair'&&p.i>=0&&p.i<=2)return p.i+1;}catch(e){}return 1;}
  function withQty(q){var n=directQty();if(n===1)return q;return{pre:q.pre*n,adv:(q.adv||q.cod)*n,cod:q.cod*n,mrp:q.mrp*n,sku:q.sku,id:q.id,name:q.name,variant:q.variant,qty:n,unitPre:q.pre,unitAdv:(q.adv||q.cod),unitCod:q.cod,unitMrp:q.mrp};}
  function apPack(){var CS=window.AVN_CART_STATE;if(cartPriced())return{pre:CS.prepaidTotal,adv:(CS.advanceTotal||CS.codTotal),cod:CS.codTotal,mrp:CS.mrpTotal,sku:'AVN-CART'};var i=0,q=null;try{var p=JSON.parse(localStorage.getItem('avn_pack')||'null');if(p&&p.page==='hair'&&p.i>=0&&p.i<AP_PACKS.length)i=p.i;}catch(e){}if(window.AVN_CHECKOUT&&window.AVN_CHECKOUT.pack)q=window.AVN_CHECKOUT.pack('hair',i);return withQty(q||AP_PACKS[i]||AP_PACKS[0]);}
  function apPackN(){var CS=window.AVN_CART_STATE;if(cartPriced())return CS.count>1?' ('+CS.count+' items)':'';var extra='';try{var p=JSON.parse(localStorage.getItem('avn_pack')||'null');if(p&&p.page==='hair'&&p.i>0)extra=' (Pack of '+(p.i+1)+')';}catch(e){}if(directQty()>1)extra+=' \u00d7 '+directQty();return extra;}
  function cartItems(){var CS=window.AVN_CART_STATE;return CS&&CS.items?CS.items.map(function(x){return{id:x.id,family:x.family,pack:x.pack,qty:x.qty};}):[];}
  function cartLabel(){var CS=window.AVN_CART_STATE;return CS&&CS.items?CS.items.map(function(x){return x.name+' ('+x.variant+') \u00d7 '+x.qty;}).join('; '):'';}
  function getPay(){
    var c = $('input[name="paymentMethod"]:checked');
    return c ? c.value : 'prepaid';
  }
  function updatePay(){
    var m = getPay();
    var PK = apPack();
    var advAmt = (window.AVN_PAY && window.AVN_PAY.get && window.AVN_PAY.get() && window.AVN_PAY.get().advance_amount) || 100;
    var amt = m === 'prepaid' ? PK.pre : (m === 'advance' ? (PK.adv || PK.cod) : PK.cod);
    var rest = Math.max(0, amt - advAmt);
    var amtF = '₹'+Number(amt).toLocaleString('en-IN');
    var advF = '₹'+Number(advAmt).toLocaleString('en-IN');
    var restF = '₹'+Number(rest).toLocaleString('en-IN');
    var __CS = window.AVN_CART_STATE;
    var __mixed = cartPriced();
    if(!__mixed) $('#sAmt').textContent = amtF; /* cart: anchor/subtotal is painted by renderCartLines */
    $('#sTot').textContent = amtF;
    var __showSave = !!(m==='prepaid' && __CS && __CS.items && __CS.items.length>1 && (__CS.mixed||__CS.fromCart));
    var __saveRow = $('#sSave');
    if(__saveRow){ __saveRow.hidden = !__showSave; __saveRow.style.display = __showSave ? '' : 'none'; }
    var btn = $('#oBtn');
    if(btn){
      var mainText, subText;
      if(m === 'prepaid'){
        mainText = '⚡ Order Now - '+amtF;
        subText = '🔒 Secure Online Payment';
      } else if(m === 'cod'){
        mainText = '⚡ Order Now (COD) - '+amtF;
        subText = '🔒 No advance • Pay '+amtF+' on delivery';
      } else {
        mainText = '🔖 Book with '+advF+' Advance';
        subText = '🔐 Pay '+advF+' via Razorpay • Pay '+restF+' cash on delivery (Total '+amtF+')';
      }
      btn.innerHTML = '<span>'+mainText+'</span><small>'+subText+'</small>';
    }
    var ct = $('#ctaSub');
    if(ct){
      if(m === 'prepaid'){
        ct.textContent = '🔒 Secure Online Payment';
      } else if(m === 'cod'){
        ct.textContent = '🔐 FULL COD • No advance payment';
      } else {
        ct.textContent = '🔐 '+advF+' Advance • Pay '+restF+' cash on delivery';
      }
    }
    var cT = $('#codCardTitle'), cS = $('#codCardSub');
    if(cT || cS){
      if(m === 'prepaid'){
        if(cT) cT.textContent = '💵 Cash on Delivery';
        if(cS) cS.textContent = 'Pay on delivery (₹100 advance)';
      } else if(m === 'cod'){
        if(cT) cT.textContent = '💵 FULL COD';
        if(cS) cS.textContent = 'Pay ₹'+PK.cod+' on delivery • No advance';
      } else {
        if(cT) cT.textContent = '💰 '+advF+' Advance + COD';
        if(cS) cS.textContent = advF+' now via Razorpay • Pay '+restF+' cash on delivery';
      }
    }
    // Savings line: measured against MRP for the amount actually payable in
    // this method. The separate "prepaid discount" row is the COD -> prepaid
    // difference, so neither number is subtracted twice.
    var sv = $('#sSaveAmt');
    if(sv){
      var paid = m === 'prepaid' ? PK.pre : (m === 'advance' ? (PK.adv || PK.cod) : PK.cod);
      sv.textContent = '₹' + Number(Math.max(0, PK.mrp - paid)).toLocaleString('en-IN');
    }
    // Pack-aware pay-card prices + summary (matches PDP #apSize selection)
    try{
      var fmt = function(n){return '₹'+Number(n).toLocaleString('en-IN')};
      if(window.AVN_CHECKOUT && window.AVN_CHECKOUT.renderPayUI) window.AVN_CHECKOUT.renderPayUI((window.AVN_PAY && window.AVN_PAY.get && window.AVN_PAY.get()) || null);
      var nm = $('.summary .s-row span');
      if(nm && !__mixed) nm.textContent = 'Avnideep Hair Oil (100ml)'+apPackN()+(directQty()>1?' \u2014 '+fmt(PK.cod/directQty())+' each':'');
      var svB = $('#sSave b');
      if(svB) svB.textContent = '- '+fmt(PK.mrp-PK.pre);
    }catch(e){}
    /* Paint the one verified model for BOTH a direct pack and the whole cart:
       this is what adds the ₹100 advance / remaining-COD rows and keeps the
       discount row out unless the product rows show COD prices. */
    if(window.AVN_CHECKOUT && window.AVN_CHECKOUT.renderSummary){
      try{ window.AVN_CHECKOUT.renderSummary({method:m, checkoutMode:CHECKOUT_MODE, pack:PK}); }catch(e){}
    }
    if(__mixed && typeof window.renderCartLines === 'function'){ try{ window.renderCartLines(); }catch(e){} }
    $$('.pay-card').forEach(function(c){
      var i = $('input[name="paymentMethod"]', c);
      c.classList.toggle('selected', !!(i && i.checked));
    });
  }
  /* Expose pack-aware updater for popup open + PDP pack selector */
  try{window.updatePay = updatePay;}catch(e){}



  function initPay(){
    if(window.__payInit) return; window.__payInit = true;

    $$('input[name="paymentMethod"]').forEach(function(i){i.addEventListener('change', updatePay)});

    $$('.pay-card').forEach(function(c){
      c.addEventListener('click', function(){
        var r = $('input[name="paymentMethod"]', c);
        if(r){ r.checked = true; updatePay(); }
      });
    });

    updatePay();

  }



  function showErr(box, msg){
    box.textContent = msg;
    box.classList.add('show');
    if (box && typeof box.scrollIntoView === 'function') box.scrollIntoView({behavior:'smooth', block:'center'});
  }

  function showSuccess(method, orderId){
    var m = $('#sModal'), txt = $('#sMsg');

    var oidBox = $('#sOrderId'), oidTxt = $('#sOrderIdText');

    var waBtn = $('#sWaBtn');

    if(!m || !txt) return;



    if(method === 'prepaid'){
      txt.textContent = 'Your order will be confirmed after prepaid payment.';
    } else if(method === 'prepaid_whatsapp'){
      txt.innerHTML = 'Order could not be placed.<br>Sending via WhatsApp so we can confirm your order right away.';
    } else if(method === 'cod_whatsapp'){
      txt.innerHTML = 'Order could not be saved on the backend, so we are sending it via WhatsApp.<br><br>Please press the <strong>\"Send\"</strong> button on WhatsApp to confirm your order.';
    } else {
      txt.textContent = 'Your COD order has been saved. Our team will call you soon.';
    }



    // Show Order ID if available
    if(orderId && oidBox && oidTxt){
      oidTxt.textContent = orderId;
      oidBox.hidden = false;

      if(waBtn){
        waBtn.href = appendUtm('https://wa.me/917060101043?text=' + encodeURIComponent('Hi, my order ID is ' + orderId + '. I want to check the status.'));
      }

    } else if(oidBox){
      oidBox.hidden = true;
    }



    m.setAttribute('open','');
  }

  function closeSuccess(){
    var m = $('#sModal');
    if(m) m.removeAttribute('open');
    if(window.history && window.history.replaceState){
      var clean = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, clean);
    }
  }



  function build(status){
    var m = getPay();

    var utm = getUtmParams();

    return {
      orderId: 'AVN-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),
      name: $('#cName').value.trim(),
      phone: $('#tcPhoneInput').value.trim(),
      address: $('#cAddress') ? $('#cAddress').value.trim() : '',
      pincode: $('#cPincode') ? $('#cPincode').value.trim() : '',
      city: $('#cCity') ? $('#cCity').value.trim() : '',
      state: $('#cState') ? $('#cState').value.trim() : '',
      paymentMethod: m === 'prepaid' ? 'prepaid' : (m === 'cod' ? 'cod' : 'advance_cod'),

      amount: m === 'prepaid' ? apPack().pre : (m === 'advance' ? (apPack().adv || apPack().cod) : apPack().cod),

      product: cartPriced() ? cartLabel() : 'Avnideep Herbal Hair Oil 100ml' + apPackN(),
    items: cartPriced() ? cartItems() : [{family:'hair',pack:directPack(),qty:directQty()}],

      status: status,

      pageUrl: window.location.href,

      utm_source: utm.source,
      utm_medium: utm.medium,
      utm_campaign: utm.campaign,

      createdAt: new Date().toISOString(),

      userAgent: navigator.userAgent || '',

      fbp: getCookie('_fbp') || '',
      fbc: getCookie('_fbc') || ''
    };
  }



  function validate(p){
    if(p.name.length < 2){ $('#cName').focus(); return 'Please enter your full name.'; }
    if(!/^[6-9]\d{9}$/.test(p.phone)){ $('#tcPhoneInput').focus(); return 'Please enter a valid 10-digit mobile number.'; }
    if(!p.address || p.address.length < 5){ $('#cAddress').focus(); return 'Please enter your full address.'; }
    if(!p.pincode || p.pincode.length !== 6){ $('#cPincode').focus(); return 'Please enter a valid 6-digit PIN code.'; }
    return '';
  }






  // Fetch with timeout & retry for high-load resilience

  function fetchT(url, opt, ms){
    ms = ms || 10000;
    var ctrl = new AbortController();
    var t = setTimeout(function(){ctrl.abort()}, ms);
    return fetch(url, Object.assign({}, opt, {signal:ctrl.signal, keepalive:true}))
      .finally(function(){clearTimeout(t)});
  }

  async function sendOrder(payload, retries){
    retries = retries ?? 2;
    var lastErr = null;
    for(var i=0; i<=retries; i++){
      try{
        var r = await fetchT('/api/order', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload)
        }, 15000);

        var data = await r.json().catch(function(){return {ok:r.ok}});

        if(r.ok && (data.ok || (data.data && data.data.order_id))){


          if(!data.ok && data.data) data = Object.assign({ orderId: data.data.order_id, amount: data.data.amount }, data.data, { ok: true });
          return data;
        }

        if(r.status === 429){
          return {ok:false, error: data.error || 'Too many requests. Please try again in 1 minute.'};
        }

        // Server returned error
        lastErr = data.error || ('HTTP ' + r.status);
      }catch(e){
        lastErr = String(e.message || e);
      }

      if(i < retries){
        await new Promise(function(rs){setTimeout(rs, 600 * Math.pow(2,i))});
      }
    }
    throw new Error(lastErr || 'Order submit failed');
  }

  window.sendOrder = sendOrder;

  window.fetchT = fetchT;






  function initForm(){
    if(window.__formInit) return; window.__formInit = true;

    var form = $('#oForm'), err = $('#fErr'), btn = $('#oBtn');

    var phone = $('#cPhone'), pin = $('#cPin');

    if(!form) return;



    // Input sanitization

    if(phone) phone.addEventListener('input', function(){
      // Strip any leading +91 / 91 / 0 the customer types - store only the clean 10-digit number
      var __pd = phone.value.replace(/\D/g,'');
      if (__pd.length > 10) __pd = __pd.replace(/^(91|0)/,'');
      phone.value = __pd.slice(0,10);
    });

    if(pin) pin.addEventListener('input', function(){
      pin.value = pin.value.replace(/\D/g,'').slice(0,6);
    });



    // Auto-advance to next field when phone (10 digits) or pincode (6 digits) is complete

    if(phone){
      phone.addEventListener('input', function(){
        if(phone.value.length === 10 && pin) pin.focus();
      });
    }

    if(pin){
      pin.addEventListener('input', function(){
        if(pin.value.length === 6){
          var addr = $('#cAddr');
          if(addr) addr.focus();
        }
      });
    }



    // Prevent Enter key from submitting form in single-line inputs (avoids accidental submit)

    $$('#oForm input').forEach(function(input){
      input.addEventListener('keydown', function(e){
        if(e.key === 'Enter'){
          e.preventDefault();
          // Focus next field instead
          var inputs = $$('#oForm input, #oForm textarea');
          var idx = inputs.indexOf(input);
          if(idx >= 0 && inputs[idx+1]) inputs[idx+1].focus();
        }
      });
    });



    // Build pre-filled WhatsApp URL with all order details

    function buildWhatsAppOrder(payload){
      var msg = '*🛒 NEW ORDER - Avnideep Hair Oil*\n' +
        '━━━━━━━━━━━━━━━\n' +
        '🆔 Order ID: ' + payload.orderId + '\n' +
        '👤 Name: ' + payload.name + '\n' +
        '📞 Phone: ' + payload.phone + '\n' +
        '📍 Address: ' + (payload.address || 'N/A') + '\n' +
        '📮 Pincode: ' + (payload.pincode || 'N/A') + '\n' +
        '🏙️ City: ' + (payload.city || 'N/A') + '\n' +
        '💳 Payment: ' + payload.paymentMethod.toUpperCase() + '\n' +
        '💰 Amount: ₹' + payload.amount + '\n' +
        '━━━━━━━━━━━━━━━\n' +
        buildUtmLabel() + '\n' +
        'Please confirm my order.';
      return appendUtm('https://wa.me/917060101043?text=' + encodeURIComponent(msg));
    }





    form.addEventListener('submit', async function(e){
      e.preventDefault();

      if(submitting) return;

      err.classList.remove('show');



      var m = getPay();
      var advAmt = (window.AVN_PAY && window.AVN_PAY.get && window.AVN_PAY.get() && window.AVN_PAY.get().advance_amount) || 100;
      var isAdvance = m === 'advance';

      var payload = build(m === 'prepaid' ? 'payment_pending' : (isAdvance ? 'advance_paid' : 'cod_order'));

      if(m === 'prepaid'){
        try { sessionStorage.setItem('avn_prepaid_order', JSON.stringify(payload)); } catch(e){}
      }



      var v = validate(payload);

      if(v){ showErr(err, v); return; }
      // Checkout must not run on stale/hardcoded payment options.
      if(!(window.AVN_PAY && window.AVN_PAY.ready())){
        try { await window.AVN_PAY.load(true); }
        catch(cfgErr){ showErr(err, 'Payment options could not be loaded. Please retry.'); return; }
      }
      if(!(window.AVN_PAY && window.AVN_PAY.ready())){ showErr(err, 'Payment options could not be loaded. Please retry.'); return; }



      submitting = true;

      btn.disabled = true;

      var origHTML = btn.innerHTML;

      btn.innerHTML = '<span>⏳ Processing... Please wait</span>';



        trackFbEvent('Lead', {value:payload.amount, currency:'INR', content_name:apPack().sku, content_ids:[apPack().sku]}, null, {name: (payload.name||''), phone: (payload.phone||'')});



      if(m === 'prepaid'){

        // Create the server-priced order first. If this fails we must not
        // charge the customer: a payment with no order row cannot be verified.
        var preSave = null;
        try { preSave = await sendOrder(Object.assign({}, payload, { status: 'payment_pending' }), 0); }
        catch (preErr) { preSave = { ok: false, error: String(preErr.message || preErr) }; }
        if(!preSave || preSave.ok === false){
          showErr(err, (preSave && preSave.error) || 'Order could not be saved. Please retry.');
          btn.innerHTML = origHTML; btn.disabled = false; submitting = false;
          return;
        }
        var preOrder = preSave.order || {};
        payload.orderId = preOrder.orderId || preSave.orderId || payload.orderId;
        var preAmt = Number(preOrder.amount || preSave.amount);
        if (preAmt > 0) payload.amount = preAmt;

        // Open Razorpay checkout directly instead of redirecting to payment.html

        try {
          var rzpResult = await openRazorpayCheckout(payload);
          if (rzpResult.success) {
            window.location.href = '/thank-you.html?order_id=' + encodeURIComponent(rzpResult.orderId) + '&amount=' + encodeURIComponent(payload.amount) + '&name=' + encodeURIComponent(payload.product || '') + '&phone=' + encodeURIComponent(payload.phone) + '&method=prepaid&razorpay_payment_id=' + encodeURIComponent(rzpResult.razorpay_payment_id);
          } else {
            showErr(err, rzpResult.error || 'Payment failed. Please try again.');
            btn.innerHTML = origHTML;
            btn.disabled = false;
            submitting = false;
          }
        } catch(rzrErr) {
          console.error('RZP_ERR', rzrErr);
          showErr(err, rzrErr.message || 'Payment initiation failed. Try again or choose COD.');
          btn.innerHTML = origHTML;
          btn.disabled = false;
          submitting = false;
        }

        return;

      }



      // ADVANCE + COD: one server-priced order, then a Razorpay charge for
      // exactly the configured booking advance. The balance stays due on
      // delivery and is never charged twice.
      if(isAdvance){
        var cfgNow = (window.AVN_PAY && window.AVN_PAY.get && window.AVN_PAY.get()) || {};
        var advAmt = Number(cfgNow.advance_amount) > 0 ? Number(cfgNow.advance_amount) : 100;
        var advSave = null;
        try { advSave = await sendOrder(Object.assign({}, payload, { status: 'advance_pending' }), 0); }
        catch (advErr) { advSave = { ok: false, error: String(advErr.message || advErr) }; }
        if(!advSave || advSave.ok === false){
          showErr(err, (advSave && advSave.error) || 'Order could not be saved. Please retry.');
          btn.innerHTML = origHTML; btn.disabled = false; submitting = false;
          return;
        }
        var advOrder = advSave.order || {};
        payload.orderId = advOrder.orderId || advSave.orderId || payload.orderId;
        var advTotal = Number(advOrder.amount || advSave.amount);
        if (advTotal > 0) payload.amount = advTotal;
        payload.advanceAmount = advAmt;
        try {
          var rzpResult = await openRazorpayCheckout(payload, advAmt);
          if (rzpResult.success) {
            payload.paymentNote = '₹' + Number(advAmt).toLocaleString('en-IN') + ' advance paid via Razorpay (' + (rzpResult.razorpay_payment_id || '') + ') • Balance due on delivery';
            try{ sessionStorage.setItem('avn_last_order', payload.orderId); }catch(e){}
            window.location.href = '/thank-you?order_id=' + encodeURIComponent(payload.orderId) + '&amount=' + encodeURIComponent(payload.amount) + '&name=' + encodeURIComponent(payload.name) + '&phone=' + encodeURIComponent(payload.phone) + '&method=advance_cod&razorpay_payment_id=' + encodeURIComponent(rzpResult.razorpay_payment_id || '');
            return;
          } else {
            showErr(err, rzpResult.error || 'Advance payment failed. Please try again.');
            btn.innerHTML = origHTML; btn.disabled = false; submitting = false;
            return;
          }
        } catch(rzrErr) {
          console.error('RZP_ADV_ERR', rzrErr);
          showErr(err, rzrErr.message || 'Advance payment failed. Try again or choose another option.');
          btn.innerHTML = origHTML; btn.disabled = false; submitting = false;
          return;
        }
      }

      // Try backend API next

      var apiSuccess = false;

      var apiError = '';


      try{
        var result = await sendOrder(payload, 0); // No retry - prevents duplicate order + double Purchase event

        if(result && result.ok !== false){

          apiSuccess = true;

          try{ sessionStorage.setItem('avn_last_order', result.orderId || ''); }catch(e){}



        } else if(result && result.error){

          apiError = String(result.error);

        }

      }catch(ex){
        apiError = String(ex.message || ex || 'Unknown API error');

        console.warn('API unavailable, using WhatsApp fallback:', apiError);

        apiSuccess = false;

      }





      // Build WhatsApp pre-filled URL with order details

      var waOrderUrl = buildWhatsAppOrder(payload);



      if(m === 'prepaid'){

        if(apiSuccess){

          // Open Razorpay checkout directly instead of redirecting to payment.html

          try {
            var rzpResult = await openRazorpayCheckout(payload);
            if (rzpResult.success) {
              window.location.href = '/thank-you.html?order_id=' + encodeURIComponent(rzpResult.orderId) + '&amount=' + encodeURIComponent(payload.amount) + '&name=' + encodeURIComponent(payload.product || '') + '&phone=' + encodeURIComponent(payload.phone) + '&method=prepaid&razorpay_payment_id=' + encodeURIComponent(rzpResult.razorpay_payment_id);
            } else {
              showErr(err, rzpResult.error || 'Payment failed. Please try again.');
              btn.innerHTML = origHTML;
              btn.disabled = false;
              submitting = false;
            }
          } catch(rzrErr) {
            console.error('RZP_ERR', rzrErr);
            showErr(err, rzrErr.message || 'Payment initiation failed. Try again or choose COD.');
            btn.innerHTML = origHTML;
            btn.disabled = false;
            submitting = false;
          }

          return;

        }

        if(apiError){

          console.warn('Prepaid backend save failed:', apiError);

          showErr(err, 'Payment order could not be saved on the backend: ' + apiError + '. Sending WhatsApp fallback.');
        }

        showSuccess('prepaid_whatsapp', payload.orderId);



        setTimeout(function(){ window.open(waOrderUrl, '_blank', 'noopener'); }, 1000);

        form.reset();

        updatePay();

        btn.innerHTML = origHTML;

      } else {

        // COD flow: Show success when backend saved, otherwise use WhatsApp fallback

        if(apiSuccess){
          var orderId = result.orderId || payload.orderId;
          var isDup = result && result.duplicate === true;
          var dupParam = isDup ? '&duplicate=true' : '';
          window.location.href = '/thank-you?order_id=' + encodeURIComponent(orderId) + '&amount=' + encodeURIComponent(payload.amount) + '&name=' + encodeURIComponent(payload.name) + '&address=' + encodeURIComponent(payload.address||'') + '&pincode=' + encodeURIComponent(payload.pincode||'') + '&city=' + encodeURIComponent(payload.city||'') + '&phone=' + encodeURIComponent(payload.phone) + '&method=cod' + dupParam;

        } else {

          if(apiError){

            showErr(err, 'Order could not be saved on the backend: ' + apiError + '. Sending WhatsApp fallback.');

          }



          window.location.href = '/thank-you?order_id=' + encodeURIComponent(payload.orderId) + '&amount=' + encodeURIComponent(payload.amount) + '&name=' + encodeURIComponent(payload.name) + '&address=' + encodeURIComponent(payload.address||'') + '&pincode=' + encodeURIComponent(payload.pincode||'') + '&city=' + encodeURIComponent(payload.city||'') + '&method=cod_whatsapp&wa_url=' + encodeURIComponent(waOrderUrl);

          form.reset();

          updatePay();

          btn.innerHTML = origHTML;

        }

      }



      submitting = false;

      btn.disabled = false;

    });

  }







  function initSuccessModal(){
    var m = $('#sModal'), cb = $('#sClose');

    if(cb) cb.addEventListener('click', closeSuccess);

    if(m){
      m.addEventListener('click', function(e){ if(e.target === m) closeSuccess(); });
    }

    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){
        if(m && m.hasAttribute('open')) closeSuccess();
        var ex = $('.emodal.show');

        if(ex) ex.classList.remove('show');
      }

    });

  }
  function initFieldCheck(){
    var checks = [
      {id:'cName', test:function(v){return v.length >= 2}},
      {id:'cPhone', test:function(v){return /^[6-9]\d{9}$/.test(v)}}
    ];

    checks.forEach(function(c){
      var input = $('#'+c.id);
      if(!input) return;

      var field = input.closest('.form-field');
      var update = function(){
        if(c.test(input.value)) field.classList.add('valid');
        else field.classList.remove('valid');
      };

      input.addEventListener('input', update);
      input.addEventListener('blur', update);
    });
  }
  function initCheckoutTimer(){
    var thOld = document.getElementById('th-old');
    var tmOld = document.getElementById('tm-old');
    var tsOld = document.getElementById('ts-old');

    if(!thOld && !tmOld && !tsOld) return;

    function upd(){
      var h = $('#th') ? $('#th').textContent : '04';
      var m = $('#tm') ? $('#tm').textContent : '45';
      var s = $('#ts') ? $('#ts').textContent : '00';
      if(thOld) thOld.textContent = h;
      if(tmOld) tmOld.textContent = m;
      if(tsOld) tsOld.textContent = s;
    }

    upd();
    setInterval(upd, 1000);
  }function initLightbox(){
    var box = $('#glightbox');
    var img = $('#glImage');
    var close = $('#glClose');
    var prev = $('#glPrev');
    var next = $('#glNext');
    var counter = $('#glCounter');
    var items = $$('.gal-item img');

    if(!box || !items.length) return;

    var current = 0;

    function open(idx){
      current = idx;
      var src = items[current].getAttribute('src');
      img.setAttribute('src', src);
      counter.textContent = (current + 1) + ' / ' + items.length;
      box.classList.add('active');
      box.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      close.focus();
    }

    function closeBox(){
      box.classList.remove('active');
      box.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    function prevImg(){
      current = (current - 1 + items.length) % items.length;
      open(current);
    }

    function nextImg(){
      current = (current + 1) % items.length;
      open(current);
    }

    items.forEach(function(item, idx){
      item.parentElement.addEventListener('click', function(){ open(idx); });
      item.parentElement.setAttribute('tabindex', '0');
      item.parentElement.setAttribute('role', 'button');
    });

    close.addEventListener('click', closeBox);

    prev.addEventListener('click', prevImg);

    next.addEventListener('click', nextImg);

    // Restore nav visibility when a gallery item opens

    var restoreNav = function(){
      prev.style.display = '';
      next.style.display = '';
      counter.style.display = '';
    };

    // Certificate click handler

    var certImg = $('#certCardImg');

    if(certImg){
      certImg.parentElement.addEventListener('click', function(){
        if(img && items.length){
          img.setAttribute('src', certImg.getAttribute('src'));
          box.classList.add('active');
          box.setAttribute('aria-hidden', 'false');
          document.body.style.overflow = 'hidden';
          counter.textContent = 'Certificate';
          counter.style.display = '';
          prev.style.display = 'none';
          next.style.display = 'none';
          close.focus();
        }

      });
    }

    // When gallery items open, show nav

    items.forEach(function(item, idx){
      item.parentElement.addEventListener('click', restoreNav);
    });

    box.addEventListener('click', function(e){ if(e.target === box) closeBox(); });

    document.addEventListener('keydown', function(e){
      if(!box.classList.contains('active')) return;

      if(e.key === 'Escape') closeBox();

      if(e.key === 'ArrowLeft') prevImg();

    });
  }

  /* ============================================================
     RAZORPAY CHECKOUT
     This page calls openRazorpayCheckout() from the checkout handler but
     the function (and its helpers) were never defined here — the page does
     not load /app.v3.js. Result: `openRazorpayCheckout is not defined` ->
     prepaid AND advance-COD orders could never be paid or saved.
     Mirrors the working implementation in app.v3.js / herbal-balm.
     ============================================================ */
  function loadRazorpaySDK() {
    return new Promise(function(resolve, reject) {
      if (window.Razorpay) { resolve(window.Razorpay); return; }
      var s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = function() { resolve(window.Razorpay); };
      s.onerror = function() { reject(new Error('Failed to load Razorpay SDK')); };
      document.body.appendChild(s);
    });
  }
  var RZR_API = 'https://avnideep-admin-api.officialavnideepayurveda.workers.dev/api/admin';
  async function getPayConfig() {
    /* Credentials (razorpay_enabled/key_id) come from the admin worker; the three
       enable flags + default + flat advance come from the same-origin
       /api/payment-config (admin writes D1, that endpoint reads it). This keeps
       the storefront, the admin toggle and the backend in lock-step. */
    var cfg = { razorpay_enabled: false, cod_enabled: true, advance_enabled: true, prepaid_enabled: true, key_id: '', checkout_mode: CHECKOUT_MODE, advance_amount: 100 };
    try {
      var r = await fetch(RZR_API + '/payment-config');
      var d = await r.json();
      if (d && d.ok && d.data) cfg = Object.assign(cfg, { razorpay_enabled: d.data.razorpay_enabled !== false, key_id: d.data.key_id || '' });
    } catch(e) {}
    try {
      if (!(window.AVN_PAY && window.AVN_PAY.load)) throw new Error('payment config missing');
      await window.AVN_PAY.load(true);
      var s = (window.AVN_PAY && window.AVN_PAY.get) ? window.AVN_PAY.get() : null;
      if (s) {
        cfg.cod_enabled = s.cod_enabled;
        cfg.advance_enabled = s.advance_enabled;
        cfg.prepaid_enabled = s.prepaid_enabled;
        cfg.advance_amount = s.advance_amount;
        CHECKOUT_MODE = s.default_method === 'cod' ? 'full_cod' : 'advance';
        try { window.CHECKOUT_MODE = CHECKOUT_MODE; } catch(e){}
      } else if (cfg.checkout_mode) {
        CHECKOUT_MODE = cfg.checkout_mode === 'full_cod' ? 'full_cod' : 'advance';
        try { window.CHECKOUT_MODE = CHECKOUT_MODE; } catch(e){}
      }
    } catch(e) { throw new Error('Payment configuration unavailable. Please retry.'); }
    cfg.checkout_mode = CHECKOUT_MODE;
    return cfg;
  }
  async function createRzrOrder(amt, curr, receipt, cust) {
    var r = await fetch(RZR_API + '/razorpay/create-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amt, currency: curr || 'INR', receipt: receipt, customer: cust })
    });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Failed');
    return d.data;
  }
  async function verifyRzrPay(oid, pid, sig) {
    var r = await fetch(RZR_API + '/razorpay/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig })
    });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Verify failed');
    return d.data;
  }
  async function saveRzrOrder(od) {
    var r = await fetch(RZR_API + '/razorpay/save-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(od)
    });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Save failed');
    return d.data;
  }
  async function confirmRzrOrder(od) {
    var r = await fetchT('/api/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: od.orderId,
        name: od.name,
        phone: od.phone,
        amount: od.amount,
        autoConfirm: true,
        razorpay_order_id: od.razorpay_order_id,
        razorpay_payment_id: od.razorpay_payment_id,
        razorpay_signature: od.razorpay_signature
      })
    }, 15000);
    var d = await r.json().catch(function(){ return {}; });
    if (!r.ok || !d.ok) throw new Error(d.error || 'Payment could not be recorded');
    return d;
  }
  async function openRazorpayCheckout(payload, chargeAmount) {
    var config = await getPayConfig();
    if (!config.razorpay_enabled) throw new Error('Online payment disabled');
    if (!config.key_id) throw new Error('Gateway not configured');
    await loadRazorpaySDK();
    var cust = { name: payload.name, phone: payload.phone };
    var rzpOrder = await createRzrOrder(chargeAmount || payload.amount, 'INR', payload.orderId, cust);
    return new Promise(function(resolve, reject) {
      var opts = {
        key: rzpOrder.key_id || config.key_id,
        amount: rzpOrder.amount, currency: rzpOrder.currency || 'INR',
        name: 'Avnideep Ayurveda',
        description: (payload.product || 'Avnideep Herbal Hair Oil 100ml'),
        order_id: rzpOrder.id,
        prefill: { name: payload.name, contact: payload.phone },
        theme: { color: '#7A0C0C' },
        handler: async function(response) {
          try {
            var v = await verifyRzrPay(response.razorpay_order_id, response.razorpay_payment_id, response.razorpay_signature);
            if (v.verified) {
              payload.razorpay_order_id = response.razorpay_order_id;
              payload.razorpay_payment_id = response.razorpay_payment_id;
              payload.razorpay_signature = response.razorpay_signature;
              try { sessionStorage.setItem('avn_rzp', JSON.stringify({ order_id: payload.orderId, razorpay_order_id: response.razorpay_order_id, razorpay_payment_id: response.razorpay_payment_id, razorpay_signature: response.razorpay_signature })); } catch(e){}
              try { await confirmRzrOrder(payload); }
              catch (confirmErr) { console.error('RZP_CONFIRM_FAILED', confirmErr); }
              resolve({ success: true, orderId: payload.orderId, razorpay_payment_id: payload.razorpay_payment_id || '' });
            } else reject(new Error('Verification failed'));
          } catch(e) { reject(e); }
        },
        modal: { ondismiss: function() { reject(new Error('Cancelled')); } }
      };
      var rzp = new Razorpay(opts);
      rzp.on('payment.failed', function(r) { reject(new Error((r.error && r.error.description) || 'Payment failed')); });
      rzp.open();
    });
  }
  window.openRazorpayCheckout = openRazorpayCheckout;

  /* Bootstrap the popup checkout. index.html's inline submit handler bails out
     early ("Checkout handled by app.js"), so unless initForm() runs here the
     form has no live submit handler and no order is ever saved. Deferred to
     DOMContentLoaded because this bundle is parsed before <form id="oForm">. */
  function init(){
    try{ initPay(); }catch(e){}
    try{ updatePay(); }catch(e){}
    try{ initForm(); }catch(e){}
    /* Load the admin-driven payment config then repaint the three cards. */
    try{ getPayConfig().then(function(){ try{ updatePay(); }catch(e){} }).catch(function(){ try{ updatePay(); }catch(e){} }); }catch(e){}
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();