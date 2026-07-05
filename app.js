// ============================================================

// Avnideep Ayurveda - App Script (extracted from index.html)

// ============================================================



// ===== CHECKOUT UI (Script #7) =====




// === Duplicate Order Lock: Check localStorage ===



// ===== Facebook CAPI Server-Side Event Forwarding =====
// Sends events to /api/events with matching event_id for Facebook dedup
var _capiQueue = [];

function _genEventId(eventName) {
  return eventName + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
}

// Skip tracking for admin test orders (phone: 7060101043)
var ADMIN_PHONES = ['7060101043'];
function _isAdminPhone(phone) {
  if (!phone) return false;
  return ADMIN_PHONES.indexOf(String(phone).replace(/[^0-9]/g, '')) !== -1;
}

function _sendCapiEvent(eventName, eventId, customData) {
  try {
    fetch('/api/events', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        event_name: eventName,
        event_id: eventId,
        event_source_url: window.location.href.split('?')[0],
        custom_data: customData || {},
        user_data: {
          client_user_agent: navigator.userAgent || ''
        }
      })
    }).catch(function(){});
  } catch(e){}
}

function trackFbEvent(eventName, params, eventId, phone) {
  if (!eventId) eventId = _genEventId(eventName);
  if (phone && _isAdminPhone(phone)) return;
  try {
    if (typeof fbq === 'function') {
      fbq('track', eventName, Object.assign({}, params || {}, {eventID: eventId}));
    }
  } catch(e){}
  _sendCapiEvent(eventName, eventId, params);
}

function openOrderPopup(){
  var overlay = document.getElementById('orderPopupOverlay');
  if(!overlay) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  var form = document.getElementById('oForm');
  if(form) form.reset();
  if(typeof updatePay === 'function') updatePay();
  setTimeout(function(){
    var n = document.getElementById('cName');
    if(n) n.focus({preventScroll:true});
  }, 400);
}
function closeOrderPopup(e){
  if(e){
    var target = e.target;
    var clickedElement = target && target.nodeType === 1 ? target : target && target.parentElement;
    var isOverlayClick = target === e.currentTarget;
    var isCloseButton = clickedElement && clickedElement.closest('.popup-close');
    if(!isOverlayClick && !isCloseButton) return;
  }
  var overlay = document.getElementById('orderPopupOverlay');
  if(!overlay) return;
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  var err = document.getElementById('fErr');
  if(err) err.classList.remove('show');
}
window.openOrderPopup = openOrderPopup;
window.closeOrderPopup = closeOrderPopup;


(function(){


  try{


    var locked = localStorage.getItem('avn_order_placed');


    if(locked){


      


// ============================================================


// initCheckoutUI - checkout interactions (uses existing sendOrder for retry logic)


// ============================================================


function initCheckoutUI() {


  var pinInput = document.getElementById('cPin');





  // Disable old form handlers to prevent conflicts


  if (typeof window.__oldFormHandler === 'undefined') {


    window.__oldFormHandler = true;


  }





  if (pinInput) {


    pinInput.addEventListener('input', function() {


      this.value = this.value.replace(/\D/g, '').slice(0, 6);


    });


  }





  // Pincode delivery ETA


  pinInput.addEventListener('blur', function() {


    var pin = this.value.replace(/\D/g, '');


    if (pin.length === 6) {


      var etaEl = document.querySelector('.delivery-estimate span:last-child');


      if (etaEl) etaEl.textContent = '3-5 working days';


    }


  });





  // Sticky bar


  var stickyBar = document.getElementById('stickyBar');


  var checkoutSection = document.getElementById('checkout');


  function checkStickyBar() {


    if (!checkoutSection || !stickyBar) return;


    var isMobile = window.innerWidth < 768;


    if (isMobile) {


      stickyBar.classList.add('visible');


    } else {


      var rect = checkoutSection.getBoundingClientRect();


      if (rect.bottom < 0 || rect.top < window.innerHeight) {


        stickyBar.classList.add('visible');


      } else {


        stickyBar.classList.remove('visible');


      }


    }


  }


  window.addEventListener('scroll', checkStickyBar, { passive: true });


  window.addEventListener('resize', checkStickyBar);


  checkStickyBar();





  var stickyBtn = document.getElementById('stickyOrderBtn');


  if (stickyBtn && checkoutSection) {


    stickyBtn.addEventListener('click', function() {


      checkoutSection.scrollIntoView({ behavior: 'smooth', block: 'start' });


    });


  }





  // Payment selection


  document.querySelectorAll('.payment-card').forEach(function(card) {


    card.addEventListener('click', function() {


      document.querySelectorAll('.payment-card').forEach(function(c) { c.classList.remove('selected'); });


      this.classList.add('selected');


      var radio = this.querySelector('input[type="radio"]');


      if (radio) radio.checked = true;


      var btnText = document.querySelector('.btn-text');


      var btnSub = document.querySelector('.btn-sub-text');


      if (btnText && btnSub) {


        if (radio && radio.value === 'prepaid') {


          btnText.textContent = 'PAY \u20b9999';


          btnSub.textContent = 'Pay Online \u2022 Save \u20b9251';


        } else {


          btnText.textContent = 'PLACE ORDER';


          btnSub.textContent = 'Pay \u20b91,250 on Delivery';


        }


      }


    });


  });





  // Enter key navigation


  document.addEventListener('keydown', function(e) {


    if (e.key === 'Enter') {


      var activeStep = document.querySelector('.checkout-step.active');


      if (activeStep) {


        var step = parseInt(activeStep.dataset.step);


        if (step < 3) { e.preventDefault(); goToStep(step + 1); }


      }


    }


  });





  // Form submission - uses existing sendOrder() for retry logic with timeout


  var form = document.getElementById('oForm');


  var submitBtn = document.getElementById('oBtn');


  if (!form) return;





  form.addEventListener('submit', async function(e) {


    e.preventDefault();


    if (!validateStep(3)) return;


    if (!submitBtn) return;


    submitBtn.classList.add('loading');


    submitBtn.disabled = true;





    var paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'cod';


    var amount = paymentMethod === 'prepaid' ? 999 : 1250;





    var payload = {


      orderId: 'AVN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(),


      name: (document.getElementById('cName').value || '').trim(),


      phone: (document.getElementById('tcPhoneInput').value || '').replace(/\D/g, ''),


      paymentMethod: paymentMethod,


      amount: amount,


      product: 'Avnideep 6Pro Vitality Shilajit Capsules',


      status: paymentMethod === 'prepaid' ? 'prepaid_initiated' : 'cod_order',


      pageUrl: window.location.href,


      createdAt: new Date().toISOString()


    };

    try {
      var tcSaved = JSON.parse(localStorage.getItem('truecaller_user') || '{}');
      var payloadPhone = payload.phone.replace(/\D/g, '').slice(-10);
      var savedPhone = String(tcSaved.phone || '').replace(/\D/g, '').slice(-10);
      if (payloadPhone && savedPhone && payloadPhone === savedPhone) {
        payload.source = tcSaved.source || 'truecaller';
      } else {
        payload.source = 'website';
      }
    } catch (e) {
      payload.source = 'website';
    }


    // Facebook Lead event


    trackFbEvent('Lead', { content_name: 'AVN-6PRO-001', value: amount, currency: 'INR' });


    try { if (typeof dataLayer !== 'undefined') dataLayer.push({event:'Lead'}); } catch(e) {}





    // UTM params


    var utmParams = typeof getUtmParams === 'function' ? getUtmParams() : {source:'facebook', medium:'cpc', campaign:'avnideep_6pro'};


    payload.utm_source = utmParams.source;


    payload.utm_medium = utmParams.medium;


    payload.utm_campaign = utmParams.campaign;


    try {


      var fbp = document.cookie.split('; ').find(function(r) { return r.startsWith('_fbp='); });


      var fbc = document.cookie.split('; ').find(function(r) { return r.startsWith('_fbc='); });


      payload.fbp = fbp ? fbp.split('=')[1] : '';


      payload.fbc = fbc ? fbc.split('=')[1] : '';


    } catch(e) {}





    // Double-submission prevention


    var submitKey = 'order_submitted_' + payload.phone;


    var prevTime = localStorage.getItem(submitKey);


    if (prevTime && (Date.now() - parseInt(prevTime) < 300000)) {


      var errEl = document.getElementById('fErr');


      if (errEl) {


        errEl.innerHTML = '26a0Fe0f Already ordered from this phone. Please wait 5 minutes or <a href="https://wa.me/917060101043" target="_blank" style="color:#25D366;font-weight:700;text-decoration:none">Contact us on WhatsApp</a>';


        errEl.classList.add('show');


      }


      submitBtn.classList.remove('loading');


      submitBtn.disabled = false;


      return;


    }


    localStorage.setItem(submitKey, Date.now().toString());





    // Facebook InitiateCheckout


    trackFbEvent('InitiateCheckout', { content_name: 'AVN-6PRO-001', content_type: 'product', value: amount, currency: 'INR' });
n    // Live analytics: form_open
    _sendAnalytics('form_open');





    if (paymentMethod === 'prepaid') {


      // PREPAID: Open Razorpay checkout for online payment


      try {


        var rzpResult = await openRazorpayCheckout(payload);


        if (rzpResult.success) {


          sessionStorage.setItem('orderId', rzpResult.orderId);


          sessionStorage.setItem('orderName', payload.name);


          try {


            _sendAnalytics('purchase');


            if (typeof trackFbEvent === 'function') {


              trackFbEvent('Purchase', { value: payload.amount || 1250, currency: 'INR', content_ids: [payload.productId || 'AVN6PRO'], content_type: 'product' }, null, payload.phone);


            }


          } catch(an) {}


          try { sessionStorage.setItem('avn_purchase_fired_' + rzpResult.orderId, '1'); localStorage.setItem('avn_purchase_fired_' + rzpResult.orderId, '1'); } catch(e) {}
          window.location.href = '/thank-you.html?order_id=' + rzpResult.orderId;


        } else {


          var errEl = document.getElementById('orderError') || document.getElementById('fErr');


          if(errEl) {


            errEl.hidden = false;


            errEl.textContent = rzpResult.error || 'Payment failed. Try again or choose COD.';


          }


        }


      } catch(rzrErr) {


        console.error('RZR_ERR', rzrErr);


        var errEl = document.getElementById('orderError') || document.getElementById('fErr');


        if(errEl) {


          errEl.hidden = false;


          errEl.textContent = 'Payment failed. Try again or choose COD.';


        }


      }


    } else if (paymentMethod === 'razorpay') {


      // RAZORPAY: Online payment via Razorpay Checkout


      try {


        var rzpResult = await openRazorpayCheckout(payload);


        if (rzpResult.success) {


          sessionStorage.setItem('orderId', rzpResult.orderId);


          sessionStorage.setItem('orderName', payload.name);


          _sendAnalytics('purchase');

          try { trackFbEvent('Purchase', { content_name: 'AVN-6PRO-001', value: payload.amount, currency: 'INR' }, null, payload.phone); } catch(e) {}


          try { sessionStorage.setItem('avn_purchase_fired_' + rzpResult.orderId, '1'); localStorage.setItem('avn_purchase_fired_' + rzpResult.orderId, '1'); } catch(e) {}
          window.location.href = '/thank-you.html?order_id=' + encodeURIComponent(rzpResult.orderId);


        }


      } catch(e) {


        console.error('RZR_ERR', e);


        var errEl = document.getElementById('orderError') || document.getElementById('fErr');


        if (errEl) { errEl.textContent = e.message || 'Payment failed. Try again or choose COD.'; errEl.hidden = false; }


        submitBtn.classList.remove('loading');


        submitBtn.disabled = false;


        return;


      }

    } else {


      // COD: Use existing sendOrder() with retry logic


      try {


        var result = await sendOrder(payload, 2);


        if (result.ok || result.duplicate) {


          var orderId = result.orderId || payload.orderId;


          sessionStorage.setItem('orderId', orderId);


          sessionStorage.setItem('orderName', payload.name);


          sessionStorage.setItem('orderAmount', String(amount));


          sessionStorage.setItem('orderMethod', 'cod');
          try { sessionStorage.setItem('avn_purchase_fired_' + orderId, '1'); localStorage.setItem('avn_purchase_fired_' + orderId, '1'); } catch(e) {}


          try { if (typeof fbq === 'function' && !_isAdminPhone(payload.phone)) fbq('track', 'Purchase', { value: amount, currency: 'INR', content_name: 'AVN-6PRO-001', content_type: 'product', order_id: orderId, eventID: orderId }); } catch(e) {}


          window.location.href = '/thank-you.html?order_id=' + orderId + '&name=' + encodeURIComponent(payload.name) + '&amount=' + amount + '&method=cod';


        } else {


          throw new Error(result.error || 'Order failed');


        }


      } catch(err) {


        submitBtn.classList.remove('loading');


        submitBtn.disabled = false;


        var errEl = document.getElementById('fErr');


        if (errEl) {


          errEl.innerHTML = 'Warning: ' + (err.message || 'Something went wrong') + '<br><a href="https://wa.me/917060101043?text=I want to order Avnideep Shilajit" target="_blank" style="color:#25D366;font-weight:700;text-decoration:none">Click here to order via WhatsApp</a>';


          errEl.classList.add('show');


        }


      }


    }


  });


}





document.addEventListener('DOMContentLoaded', function(){


        if (document.querySelector('.checkout-section')) return;


        var popup = document.getElementById('orderLockPopup');


        var form = document.getElementById('oForm');


        if(popup) popup.style.display = 'flex';


        if(form) form.style.display = 'none';


      });


    }


    // Expose globally for DOMContentLoaded handler


    window.initCheckoutUI = initCheckoutUI;


  } catch(e){}


})();




// ===== MAIN APPLICATION (Script #9) =====




(function(){


"use strict";


var $ = function(s,c){return (c||document).querySelector(s)};


var $$ = function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};


var body = document.body;


var WA_URL = "https://wa.me/917060101043?text=Hello%20I%20want%20to%20order%20Avnideep%206Pro";


var submitting = false;


var UTM_DEFAULTS = {source:'facebook', medium:'cpc', campaign:'avnideep_6pro'};


// Google Sheets handled by backend (/api/order)





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


  }catch(e){


    return url;


  }


}


function buildUtmLabel(){


  var utm = getUtmParams();


  return 'UTM: ' + utm.source + ' / ' + utm.medium + ' / ' + utm.campaign;


}





function pad(n){return String(n).padStart(2,'0')}


function initTimer(){


  var th=$('#th'), tm=$('#tm'), ts=$('#ts');


  if(!th) return;


  var dur = 4*3600 + 45*60;


  var key = 'avn_end_v2';


  var endT;


  try{


    endT = parseInt(localStorage.getItem(key)||'0',10);


    var now = Math.floor(Date.now()/1000);


    if(!endT || now > endT){


      endT = now + dur;


      localStorage.setItem(key, String(endT));


    }


  }catch(e){ endT = Math.floor(Date.now()/1000)+dur; }


  


  function render(){


    var r = Math.max(0, endT - Math.floor(Date.now()/1000));


    if(r<=0){


      endT = Math.floor(Date.now()/1000)+dur;


      try{ localStorage.setItem(key, String(endT)) }catch(e){}


      r = dur;


    }


    th.textContent = pad(Math.floor(r/3600));


    tm.textContent = pad(Math.floor((r%3600)/60));


    ts.textContent = pad(r%60);


  }


  render();


  setInterval(render, 1000);


}


function initScroll(){


  $$('[data-scroll]').forEach(function(b){


    b.addEventListener('click', function(e){


      if(window._lastIC && Date.now() - window._lastIC < 3000) return; window._lastIC = Date.now();


      e.preventDefault();


      var t = $('#'+b.dataset.scroll);


      if(!t) return;


      _sendAnalytics('form_open');

      dataLayer.push({event:'InitiateCheckout', value:payload.amount, currency:'INR'});


      trackFbEvent('InitiateCheckout', {value:payload.amount, currency:'INR', content_name:'AVN-6PRO-001'});


      t.scrollIntoView({behavior:'smooth', block:'start'});


      setTimeout(function(){


        var n = $('#cName');


        if(n) n.focus({preventScroll:true});


      }, 700);


    });


  });


}


function initSticky(){


  var sb = $('#sbar');


  if(!sb) return;


  var c = $('#checkout');


  var ticking = false;


  function isOnCheckout(){


    if(!c) return false;


    var r = c.getBoundingClientRect();


    return r.top < window.innerHeight && r.bottom > 0;


  }


  function getStickyThreshold(){

    return window.innerWidth <= 540 ? 220 : 600;

  }


  function upd(){


    var show = window.scrollY > getStickyThreshold() && !isOnCheckout();


    sb.classList.toggle('show', show);


    sb.setAttribute('aria-hidden', show ? 'false' : 'true');


    body.classList.toggle('sb-on', show);


    ticking = false;


  }


  upd();


  window.addEventListener('scroll', function(){


    if(!ticking){ requestAnimationFrame(upd); ticking=true; }


  }, {passive:true});


}


function initFaq(){


  $$('.faq-q').forEach(function(q){


    q.addEventListener('click', function(){


      var item = q.closest('.faq-item');


      var wasOpen = item.classList.contains('open');


      $$('.faq-item').forEach(function(i){i.classList.remove('open')});


      if(!wasOpen) item.classList.add('open');


    });


  });


}


function initReviews(){


  var grid = $('.reviews-grid');


  var btn = $('#rvMoreBtn');


  if(!grid || !btn) return;


  var items = Array.prototype.slice.call(grid.querySelectorAll('.rv'));


  var visibleCount = 3;


  function update(){


    items.forEach(function(item, idx){


      item.classList.toggle('hidden', idx >= visibleCount);


    });


    if(visibleCount >= items.length){


      btn.textContent = 'All reviews shown';


      btn.disabled = true;


    }


  }


  btn.addEventListener('click', function(){


    visibleCount = Math.min(items.length, visibleCount + 3);


    update();


  });


  update();


}


function initVideo(){


  $$('[data-video]').forEach(function(b){


    function load(){


      var vid = b.dataset.video;


      if(!vid) return;


      var f = document.createElement('iframe');


      f.src = 'https://www.youtube-nocookie.com/embed/'+encodeURIComponent(vid)+'?autoplay=1&rel=0&modestbranding=1';


      f.title = 'Doctor Video';


      f.allow = 'accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture';


      f.allowFullscreen = true;


      f.style.cssText = 'width:100%;height:100%;border:0;border-radius:18px';


      b.innerHTML = '';


      b.style.aspectRatio = '16/9';


      b.appendChild(f);


      dataLayer.push({event:'ViewContent', content_name:'Avnideep 6Pro Vitality Shilajit'});


      trackFbEvent('ViewContent', {content_name:'Avnideep 6Pro Vitality Shilajit', content_type:'product'});


    }


    b.addEventListener('click', load);


    b.addEventListener('keydown', function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();load()}});


  });


}


function getPay(){


  var c = $('input[name="paymentMethod"]:checked');


  return c ? c.value : 'cod';


}


function updatePay(){


  var m = getPay();


  var amt = m === 'prepaid' ? 999 : 1250;


  $('#sAmt').textContent = '₹'+amt;


  $('#sTot').textContent = '₹'+amt;


  $('#sSave').hidden = m!=='prepaid';


  var btn = $('#oBtn');


  if(btn){


    var mainText = m==='prepaid' ? '⚡ अभी Order करें - ₹999' : '⚡ अभी COD Order करें - ₹1250';


    var subText = m==='prepaid' ? '🔒 Secure Online Payment' : '🔒 No advance payment • COD';


    btn.innerHTML = '<span>'+mainText+'</span><small>'+subText+'</small>';


  }


  // Savings line


  var sv = $('#sSaveAmt');


  if(sv){


    var total = 1250;


    sv.textContent = '₹' + total;


  }


  $$('.pay-card').forEach(function(c){


    var i = $('input[name="paymentMethod"]', c);


    c.classList.toggle('selected', !!(i && i.checked));


  });


}


function initPay(){


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


  box.scrollIntoView({behavior:'smooth', block:'center'});


}


function showSuccess(method, orderId){


  var m = $('#sModal'), txt = $('#sMsg');


  var oidBox = $('#sOrderId'), oidTxt = $('#sOrderIdText');


  var waBtn = $('#sWaBtn');


  if(!m || !txt) return;





  if(method === 'prepaid'){


    txt.textContent = 'Prepaid payment के बाद आपका ऑर्डर final confirm हो जाएगा।';


  } else if(method === 'prepaid_whatsapp'){


    txt.innerHTML = 'Order book नहीं हो पाया।<br>WhatsApp पर भेजा जा रहा है ताकि हम आपकी order तुरंत confirm कर सकें।';


  } else if(method === 'cod_whatsapp'){


    txt.innerHTML = 'Order backend पर सेव नहीं हुआ, इसलिए WhatsApp पर भेजा जा रहा है।<br><br>कृपया WhatsApp पर <strong>"Send"</strong> button दबाकर order confirm करें।';


  } else {


    txt.textContent = 'आपका COD ऑर्डर सेव हो गया। हमारी टीम जल्द कॉल करेगी।';


  }





  // Show Order ID if available


  if(orderId && oidBox && oidTxt){


    oidTxt.textContent = orderId;


    oidBox.hidden = false;


    if(waBtn){


      waBtn.href = appendUtm('https://wa.me/917060101043?text=' + encodeURIComponent('Hi, मेरा order ID: ' + orderId + ' है। Status check करना है।'));


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


    phone: $('#cPhone').value.trim(),


    paymentMethod: m,


    amount: 1250,


    product: 'Avnideep 6Pro Vitality Shilajit Capsules',


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


  if(p.name.length < 2){ $('#cName').focus(); return 'पूरा नाम दर्ज करें।'; }


  if(!/^[6-9]\d{9}$/.test(p.phone)){ $('#cPhone').focus(); return 'सही 10 अंकों का मोबाइल नंबर दर्ज करें।'; }


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


  retries = retries || 2;


  var lastErr = null;


  for(var i=0; i<=retries; i++){


    try{


      var r = await fetchT('/api/order', {


        method:'POST',


        headers:{'Content-Type':'application/json'},


        body:JSON.stringify(payload)


      }, 15000);





      var data = await r.json().catch(function(){return {ok:r.ok}});





      if(r.ok && data.ok){


        return data;


      }


      if(r.status === 429){


        return {ok:false, error: data.error || 'बहुत requests। 1 मिनट बाद try करें।'};


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


  var form = $('#oForm'), err = $('#fErr'), btn = $('#oBtn');


  var phone = $('#cPhone'), pin = $('#cPin');


  if(!form) return;





  // Input sanitization


  if(phone) phone.addEventListener('input', function(){


    phone.value = phone.value.replace(/\D/g,'').slice(0,10);


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


    var msg = '*🛒 NEW ORDER - Avnideep 6Pro*\n' +


      '━━━━━━━━━━━━━━━\n' +


      '🆔 Order ID: ' + payload.orderId + '\n' +


      '👤 Name: ' + payload.name + '\n' +


      '📞 Phone: ' + payload.phone + '\n' +


      ' Payment: ' + payload.paymentMethod.toUpperCase() + '\n' +


      '💰 Amount: ₹' + payload.amount + '\n' +


      '━━━━━━━━━━━━━━━\n' +


      buildUtmLabel() + '\n' +


      'कृपया मेरा order confirm करें।';


    return appendUtm('https://wa.me/917060101043?text=' + encodeURIComponent(msg));


  }





  form.addEventListener('submit', async function(e){


    e.preventDefault();


    if(submitting) return;


    err.classList.remove('show');





    var m = getPay();


    var payload = build(m==='prepaid' ? 'payment_pending' : 'cod_order');


    if(m === 'prepaid'){


      try { sessionStorage.setItem('avn_prepaid_order', JSON.stringify(payload)); } catch(e){}


    }


    var v = validate(payload);





    if(v){ showErr(err, v); return; }





    submitting = true;


    btn.disabled = true;


    var origHTML = btn.innerHTML;


    btn.innerHTML = '<span>⏳ Processing... कृपया रुकें</span>';





    dataLayer.push({event:'Lead', value:payload.amount, currency:'INR'});


      trackFbEvent('Lead', {value:payload.amount, currency:'INR', content_name:'AVN-6PRO-001'});





    if(m === 'prepaid'){


      // Fire-and-forget send to backend so D1 receives an initial record for prepaid orders


      try{


        fetch('/api/order', {


          method: 'POST',


          headers: {'Content-Type':'application/json'},


          body: JSON.stringify(payload),


          keepalive: true


        }).catch(function(e){ console.warn('background order save failed', e); });


      }catch(e){ console.warn('background order save error', e); }





      // Open Razorpay checkout directly instead of redirecting to payment.html
      try {
        var rzpResult = await openRazorpayCheckout(payload);
        if (rzpResult.success) {
          try { sessionStorage.setItem('avn_purchase_fired_' + rzpResult.orderId, '1'); localStorage.setItem('avn_purchase_fired_' + rzpResult.orderId, '1'); } catch(e) {}
          window.location.href = '/thank-you.html?order_id=' + encodeURIComponent(rzpResult.orderId);
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





    // Try backend API next


    var apiSuccess = false;


    var apiError = '';


    try{


      var result = await sendOrder(payload, 0); // No retry - prevents duplicate order + double Purchase event


      if(result && result.ok !== false){


        apiSuccess = true;


        try{ sessionStorage.setItem('avn_last_order', result.orderId || ''); }catch(e){}


      try{ localStorage.setItem('avn_order_placed', String(Date.now())); }catch(e){}


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
            try { sessionStorage.setItem('avn_purchase_fired_' + rzpResult.orderId, '1'); localStorage.setItem('avn_purchase_fired_' + rzpResult.orderId, '1'); } catch(e) {}
          window.location.href = '/thank-you.html?order_id=' + encodeURIComponent(rzpResult.orderId);
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


        showErr(err, 'Payment order backend पर सेव नहीं हुआ: ' + apiError + '। WhatsApp fallback भेजा जा रहा है।');


      }


      showSuccess('prepaid_whatsapp', payload.orderId);


      try{ if (!_isAdminPhone(payload.phone)) fbq('track', 'Purchase', {value:payload.amount, currency:'INR', content_name:'AVN-6PRO-001', content_type:'product', order_id:payload.orderId, eventID:payload.orderId, method:'whatsapp_fallback'}); }catch(e){}





      setTimeout(function(){ window.open(waOrderUrl, '_blank', 'noopener'); }, 1000);


      form.reset();


      updatePay();


      btn.innerHTML = origHTML;


    } else {


      // COD flow: Show success when backend saved, otherwise use WhatsApp fallback


      if(apiSuccess){


        try{ if (!_isAdminPhone(payload.phone)) fbq('track', 'Purchase', {value:payload.amount, currency:'INR', content_name:'AVN-6PRO-001', content_type:'product', order_id:payload.orderId, eventID:payload.orderId}); }catch(e){}


        window.location.href = '/thank-you?order_id=' + encodeURIComponent(payload.orderId) + '&amount=' + encodeURIComponent(payload.amount) + '&name=' + encodeURIComponent(payload.name) + '&method=cod';


      } else {


        if(apiError){


          showErr(err, 'ऑर्डर backend पर सेव नहीं हुआ: ' + apiError + '। WhatsApp fallback भेजा जा रहा है।');


        }


        try{ if (!_isAdminPhone(payload.phone)) fbq('track', 'Purchase', {value:payload.amount, currency:'INR', content_name:'AVN-6PRO-001', content_type:'product', order_id:payload.orderId, eventID:payload.orderId, method:'whatsapp_fallback'}); }catch(e){}


        window.location.href = '/thank-you?order_id=' + encodeURIComponent(payload.orderId) + '&amount=' + encodeURIComponent(payload.amount) + '&name=' + encodeURIComponent(payload.name) + '&method=cod_whatsapp&wa_url=' + encodeURIComponent(waOrderUrl);


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


    if(e.key === 'ArrowRight') nextImg();


  });


}


function setupVisibility(){


  var paused = false;


  var pausedStyles = document.createElement('style');


  pausedStyles.textContent = '.tab-hidden *{animation-play-state:paused!important;transition:none!important}';


  document.head.appendChild(pausedStyles);


  document.addEventListener('visibilitychange', function(){


    if(document.visibilityState === 'hidden'){


      document.body.classList.add('tab-hidden');


    } else {


      document.body.classList.remove('tab-hidden');


    }


  });


}


function init(){


  if (!document.querySelector('.checkout-section')) { setupVisibility(); }


  // Critical (immediate)


  initScroll();


  // Check if new 3-step checkout is present - skip old form handlers


  var isNewCheckout = document.querySelector(".checkout-section") !== null;


  if (!isNewCheckout) {


    initPay();


    updatePay();


    initForm();


    initSticky();


  } else {


    initFaq();


  }


  initReviews();


  initSuccessModal();





  // Above-fold visible (immediate but defer-friendly)


  initTimer();


  initSticky();


  initVideo();





  // Use requestIdleCallback for non-critical features (saves CPU on load)


  var idle = window.requestIdleCallback || function(fn){ return setTimeout(fn, 1) };





  idle(function(){


  


    initCheckoutTimer();


  });





  idle(function(){


  


  }, { timeout: 2000 });





  // Delayed non-essential








  setTimeout(initLightbox, 3000);


}





if(document.readyState === 'loading'){


  document.addEventListener('DOMContentLoaded', init);


} else {


  init();


}





// SW for repeat visit speed - registered after load + delay (won't compete with critical resources)


if('serviceWorker' in navigator){


  window.addEventListener('load', function(){


    setTimeout(function(){


      navigator.serviceWorker.register('/sw.js').catch(function(){});


    }, 2500);


  });


}


})();





// Social Proof Popup


function initSocialProof(){


  var notif = document.getElementById('spNotif');


  var img = document.getElementById('spImg');


  var nameEl = document.getElementById('spName');


  var cityEl = document.getElementById('spCity');


  var msgEl = document.getElementById('spMsg');


  var timeEl = document.getElementById('spTime');


  var closeBtn = document.getElementById('spClose');


  if(!notif || !nameEl) return;





  var names = ['Rahul S.','Amit K.','Vikram P.','Sandeep R.','Manish T.','Pankaj V.','Deepak M.','Sunil G.','Rajesh Y.','Nitin B.','Ankur D.','Vijay C.','Ravi H.','Gaurav L.','Arun W.','Sachin N.','Mukesh F.','Pradeep J.','Akash Q.','Rohit Z.'];


  var cities = ['Delhi','Mumbai','Lucknow','Patna','Jaipur','Pune','Ahmedabad','Indore','Bhopal','Varanasi','Agra','Nagpur','Thane','Kanpur','Noida','Ghaziabad','Faridabad','Gurugram','Ranchi','Jhansi'];


  var messages = [


    'ne abhi-abhi <strong>6Pro Vitality Shilajit</strong> order kiya',


    'ne <strong>COD</strong> par order kiya',


    'ne <strong>Prepaid</strong> karke <strong>Secure</strong> payment kare',


    'ne doctor ki salah ke baad <strong>6Pro</strong> order kiya',


    'ne <strong>6Pro Shilajit</strong> ka order kiya - <strong>2 Pack</strong>',


    'ne <strong>Free Delivery</strong> ke saath order kiya'


  ];


  var bottleImages = [


    'https://cdn.avnideepayurveda.in/Avnideep-shilajit/shilajit%20for%20web.jpg',


    'https://cdn.avnideepayurveda.in/Avnideep-shilajit/shilajit%20for%20web.jpg',


    'https://cdn.avnideepayurveda.in/Avnideep-shilajit/shilajit%20for%20web.jpg'


  ];





  function random(arr){ return arr[Math.floor(Math.random()*arr.length)] }





  function getTimeAgo(){


    var mins = Math.floor(Math.random()*8)+1;


    if(mins === 1) return '1 minute pahle';


    return mins + ' minute pahle';


  }





  var timeoutId = null;


  var schedId = null;


  var isShowing = false;





  function showNotif(){


    if(isShowing) return;


    isShowing = true;





    nameEl.textContent = random(names);


    cityEl.textContent = random(cities);


    timeEl.textContent = getTimeAgo();


    if(msgEl) msgEl.innerHTML = random(messages);


    img.setAttribute('src', random(bottleImages));





    notif.style.willChange = 'transform, opacity';


    notif.classList.add('show');





    if(timeoutId) clearTimeout(timeoutId);


    timeoutId = setTimeout(function(){


      hideNotif();


    }, 1500 + Math.random()*1000);


  }





  function hideNotif(){


    notif.classList.remove('show');


    notif.style.willChange = '';


    isShowing = false;


    if(timeoutId){ clearTimeout(timeoutId); timeoutId = null; }


    scheduleNext();


  }





  function scheduleNext(){


    if(schedId) clearTimeout(schedId);


    schedId = setTimeout(function(){


      if(!notif.classList.contains('show')){


        showNotif();


      }


    }, 1500 + Math.random()*500);


  }





  if(closeBtn){


    closeBtn.addEventListener('click', function(e){


      e.stopPropagation();


      hideNotif();


    });


  }





  notif.addEventListener('click', function(e){


    if(e.target === closeBtn) return;


    hideNotif();


    var checkout = document.getElementById('checkout');


    if(checkout){


      checkout.scrollIntoView({behavior:'smooth', block:'start'});


      setTimeout(function(){


        var nameInput = document.getElementById('cName');


        if(nameInput) nameInput.focus({preventScroll:true});


      }, 700);


    }


  });





  setTimeout(function(){ showNotif(); }, 4000);


}





// Start social proof (deferred - non-blocking)


(function(){


  var idle = window.requestIdleCallback || function(fn){ return setTimeout(fn, 1) };


  idle(function(){ initSocialProof(); }, { timeout: 3000 });


})();







// ===== TRUECALLER + STEP NAVIGATION (Script #10) =====
window.TRUECALLER_CLIENT_ID = "lb7qy5af48217614f406c8469d17e58a6c451";




// ============================================================


// NEW CHECKOUT JS - 3-Step Flow + Truecaller + Sticky Bar


// ============================================================





// --- Step Navigation ---


let currentStep = 1;


const totalSteps = 3;








function markStepComplete(step) {


  var steps = document.querySelectorAll('.progress-step');


  steps.forEach(function(el) {


    var s = parseInt(el.dataset.step);


    if (s === step) {


      el.classList.add('completed');


      el.classList.remove('active');


    }


  });


}





function goToStep(step) {


  if (step > currentStep) {


    if (!validateStep(currentStep)) return;


  }


  document.querySelectorAll('.checkout-step').forEach(el => el.classList.remove('active'));


  const target = document.querySelector('.checkout-step[data-step="' + step + '"]');


  if (target) target.classList.add('active');





  document.querySelectorAll('.progress-step').forEach(el => {


    const s = parseInt(el.dataset.step);


    el.classList.remove('active', 'completed');


    if (s === step) el.classList.add('active');


    else if (s < step) el.classList.add('completed');


  });





  const progressLines = document.querySelectorAll('.progress-line .progress-fill');


  progressLines.forEach((line, index) => {


    const lineNum = index + 1;


    if (step > lineNum) line.style.width = '100%';


    else if (step === lineNum) line.style.width = '50%';


    else line.style.width = '0%';


  });





  currentStep = step;


  setTimeout(() => {


    const firstInput = document.querySelector('.checkout-step[data-step="' + step + '"] input, .checkout-step[data-step="' + step + '"] textarea');


    if (firstInput && step !== 1) firstInput.focus();


  }, 350);


  document.getElementById('checkout').scrollIntoView({ behavior: 'smooth', block: 'center' });


}





function validateStep(step) {


  clearErrors();


  if (step === 1) {


    // Step 1 is always valid - Truecaller or manual handles phone validation


    return true;


  }


  if (step === 2) {


    let valid = true;


    const name = (document.getElementById('cName').value || '').trim();


    if (!name || name.length < 3) { showError('cName', 'Please enter your full name'); valid = false; }


    return valid;


  }


  return true;


}





function showError(fieldId, message) {


  const field = document.getElementById(fieldId);


  if (field) {


    field.classList.add('error');


    field.focus();


    const errEl = document.getElementById('fErr');


    if (errEl) { errEl.textContent = message; errEl.classList.add('show'); }


  }


}





function clearErrors() {


  document.querySelectorAll('.error').forEach(el => el.classList.remove('error'));


  const errEl = document.getElementById('fErr');


  if (errEl) { errEl.classList.remove('show'); errEl.textContent = ''; }


}





// ============================================================


// TRUECALLER LOGIC (Vanilla JS - converted from React)


// ============================================================


function initTruecaller() {


  var isAndroid = /android/.test(navigator.userAgent.toLowerCase());


  var isChrome = /chrome/.test(navigator.userAgent.toLowerCase());


  var isMobile = /mobile/.test(navigator.userAgent.toLowerCase());


  var isAvailable = isAndroid && isChrome && isMobile;





  var tcContainer = document.getElementById('tcContainer');


  var tcBtn = document.getElementById('tcBtn');


  var tcDivider = document.getElementById('tcDivider');


  var tcPhoneInput = document.getElementById('tcPhoneInput');


  var tcManualBtn = document.getElementById('tcManualBtn');


  var tcError = document.getElementById('tcError');


  var tcLoader = document.getElementById('tcLoader');


  var tcBtnText = document.getElementById('tcBtnText');





  if (isAvailable) {


    tcBtn.style.display = 'flex';


    tcDivider.style.display = 'flex';


  }





  // Check localStorage for previously verified user


  var savedUser = null;


  try {


    var saved = localStorage.getItem('truecaller_user');


    if (saved) savedUser = JSON.parse(saved);


  } catch(e) {}





  if (savedUser && savedUser.phone) {


    document.getElementById('tcPhoneInput').value = savedUser.phone;


    if (savedUser.name) document.getElementById('cName').value = savedUser.name;


    if (tcContainer) tcContainer.classList.add('tc-hidden');


    goToStep(2);


    showWelcome(savedUser.name || 'there');


    return;


  }





  // Check URL params for return from Truecaller deep link


  var urlParams = new URLSearchParams(window.location.search);


  var tcStatus = urlParams.get('tc_status');


  var tcName = urlParams.get('tc_name') || '';


  var tcPhone = urlParams.get('tc_phone') || '';





  if (tcStatus === 'verified' && tcPhone) {


    var verifiedData = { name: tcName, phone: tcPhone, source: 'truecaller', verifiedAt: new Date().toISOString() };


    try { localStorage.setItem('truecaller_user', JSON.stringify(verifiedData)); } catch(e) {}


    document.getElementById('tcPhoneInput').value = tcPhone;


    if (tcName) document.getElementById('cName').value = tcName;


    if (tcContainer) tcContainer.classList.add('tc-hidden');


    try { window.history.replaceState({}, '', window.location.pathname); } catch(e) {}


    saveTruecallerLead(verifiedData);


    goToStep(2);


    showWelcome(tcName || 'there');


    return;


  }





  // Truecaller button click - Deep Link approach


  tcBtn.addEventListener('click', function() {


    // Check if we're in return mode (user came back from app, needs to enter phone)


    if (window.__tcReturnMode) {


      var phone = document.getElementById('tcPhoneInput').value.replace(/\D/g, '');


      if (phone && phone.length === 10) {


        tcBtn.disabled = true;


        tcBtnText.textContent = 'Verifying...';


        tcLoader.style.display = 'inline-block';


        window.__tcReturnMode = false;


        handleTCReturn(phone);


      } else {


        tcError.textContent = 'Please enter a valid 10-digit phone number';


      }


      return;


    }


    tcBtn.disabled = true;


    tcBtnText.textContent = 'Opening Truecaller...';


    tcLoader.style.display = 'inline-block';


    tcError.textContent = '';





    var nonce = Date.now().toString(36) + Math.random().toString(36).substr(2, 10);


    var clientId = window.TRUECALLER_CLIENT_ID || '';





    // Deep link to open Truecaller app


    var deepLink = 'truecallersdk://truesdk/web_verify?' +


      'type=btmsheet' +


      '&partnerKey=' + clientId +


      '&partnerName=Avnideep' +


      '&requestNonce=' + nonce +


      '&lang=en';





    // Set flag so we know verification was attempted


    try { sessionStorage.setItem('tc_attempted', Date.now().toString()); } catch(e) {}





    var appOpened = false;


    var fallbackTimer = setTimeout(function() {


      if (!appOpened) {


        // App didn't open - show manual entry


        tcBtn.disabled = false;


        tcBtnText.textContent = 'Continue with Truecaller';


        tcLoader.style.display = 'none';


        tcError.textContent = 'Truecaller app not found. Please enter manually.';


        try { sessionStorage.removeItem('tc_attempted'); } catch(e) {}


      }


    }, 3000);





    // Detect when Truecaller app opened (page loses focus)


    window.addEventListener('blur', function() {


      appOpened = true;


      clearTimeout(fallbackTimer);


      tcBtnText.textContent = 'Verifying...';


    }, { once: true });





    // Detect when user comes back from Truecaller app


    document.addEventListener('visibilitychange', function onVisChange() {


      if (document.visibilityState === 'visible' && appOpened) {


        document.removeEventListener('visibilitychange', onVisChange);


        // User returned from Truecaller app - assume verified


        var phone = document.getElementById('tcPhoneInput').value.replace(/\D/g, '');


        if (!phone || phone.length !== 10) {


          // No phone entered - ask user to enter


          tcBtnText.textContent = 'Continue with phone';


          tcLoader.style.display = 'none';


          tcError.textContent = 'Enter your 10-digit number and tap Continue';


          tcBtn.disabled = false;


          // Set flag so button click calls handleTCReturn instead of deep link


          window.__tcReturnMode = true;


          try { sessionStorage.removeItem('tc_attempted'); } catch(e) {}


          return;


        }


        // Proceed with manual verification (Truecaller opened = user has account)


        handleTCReturn(phone);


      }


    });





    // Trigger deep link to open Truecaller app


    window.location.href = deepLink;


  });





  // Handle return from Truecaller app (either via redirect or manual return)


  function handleTCReturn(phone) {


    var data = { name: '', phone: phone, source: 'truecaller', verifiedAt: new Date().toISOString() };


    try { localStorage.setItem('truecaller_user', JSON.stringify(data)); } catch(e) {}


    document.getElementById('tcPhoneInput').value = phone;


    tcBtn.disabled = false;


    tcLoader.style.display = 'none';


    tcBtnText.textContent = 'Verified';


    if (tcContainer) tcContainer.classList.add('tc-hidden');


    saveTruecallerLead(data);


    goToStep(2);


    showWelcome('there');


    try { sessionStorage.removeItem('tc_attempted'); } catch(e) {}


  }





  function handleTruecallerResponse(response) {


    if (!response || response.status !== 'verified') {


      tcBtn.disabled = false;


      tcBtnText.textContent = 'Continue with Truecaller';


      tcLoader.style.display = 'none';


      tcError.textContent = 'Verification failed. Please enter manually.';


      return;


    }


    var payload = response.payload || {};


    var name = payload.name || '';


    var phone = (payload.phone || '').replace(/\D/g, '').slice(-10);


    if (!phone || phone.length < 10) {


      tcBtn.disabled = false;


      tcBtnText.textContent = 'Continue with Truecaller';


      tcLoader.style.display = 'none';


      tcError.textContent = 'Could not get phone number. Enter manually.';


      return;


    }


    var data = { name: name, phone: phone, source: 'truecaller', verifiedAt: new Date().toISOString() };


    try { localStorage.setItem('truecaller_user', JSON.stringify(data)); } catch(e) {}


    document.getElementById('tcPhoneInput').value = phone;


    if (name) document.getElementById('cName').value = name;


    if (tcContainer) tcContainer.classList.add('tc-hidden');


    showWelcome(name || 'there');


    // Save lead to API


    saveTruecallerLead(data);


    goToStep(2);


  }











  // Manual phone entry


  tcPhoneInput.addEventListener('input', function() {


    this.value = this.value.replace(/\D/g, '').slice(0, 10);


    tcError.textContent = '';


  });


  tcManualBtn.addEventListener('click', function() {


    var phone = tcPhoneInput.value.replace(/\D/g, '');


    if (!phone || phone.length !== 10 || !/^[6-9]/.test(phone)) {


      tcError.textContent = 'Please enter a valid 10-digit mobile number';


      return;


    }


    var data = { name: '', phone: phone, source: 'manual', verifiedAt: new Date().toISOString() };


    document.getElementById('tcPhoneInput').value = phone;


    if (tcContainer) tcContainer.classList.add('tc-hidden');


    saveTruecallerLead({ name: '', phone: phone, source: 'manual' });


    goToStep(2);


  });


  tcPhoneInput.addEventListener('keydown', function(e) {


    if (e.key === 'Enter') tcManualBtn.click();


  });


}





function saveTruecallerLead(data) {


  // Fire-and-forget: save lead to /api/leads


  var body = JSON.stringify({ name: data.name || '', phone: data.phone, source: data.source || 'truecaller' });


  fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body }).catch(function(e) {});


}





function showWelcome(name) {


  var firstName = name.split(' ')[0] || 'there';


  var overlay = document.createElement('div');


  overlay.className = 'tc-welcome-overlay';


  overlay.innerHTML = '<div class="tc-welcome-modal"><div class="tc-welcome-icon">✅</div><h3 class="tc-welcome-title">Welcome ' + firstName + ' 👋</h3><p class="tc-welcome-sub">Your details have been verified</p><div class="tc-welcome-loader"><div class="tc-welcome-spinner"></div><span>Redirecting to checkout...</span></div></div>';


  document.body.appendChild(overlay);


  setTimeout(function() {


    overlay.remove();


    document.getElementById('checkout').scrollIntoView({ behavior: 'smooth', block: 'center' });


  }, 2000);


}











// ============================================================
// RAZORPAY CHECKOUT
// ============================================================
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
  try {
    var r = await fetch(RZR_API + '/payment-config');
    var d = await r.json();
    return d.ok ? d.data : { razorpay_enabled: false, cod_enabled: true, key_id: '' };
  } catch(e) { return { razorpay_enabled: false, cod_enabled: true, key_id: '' }; }
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
async function openRazorpayCheckout(payload) {
  var config = await getPayConfig();
  if (!config.razorpay_enabled) throw new Error('Online payment disabled');
  if (!config.key_id) throw new Error('Gateway not configured');
  await loadRazorpaySDK();
  var cust = { name: payload.name, phone: payload.phone };
  var rzpOrder = await createRzrOrder(payload.amount, 'INR', payload.orderId, cust);
  return new Promise(function(resolve, reject) {
    var opts = {
      key: rzpOrder.key_id || config.key_id,
      amount: rzpOrder.amount, currency: rzpOrder.currency || 'INR',
      name: 'Avnideep Ayurveda',
      description: 'Avnideep 6Pro Vitality Shilajit Capsules',
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
            await saveRzrOrder(payload);
            resolve({ success: true, orderId: payload.orderId });
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

// Initialize on DOM ready
try{initCheckoutUI()}catch(e){}
try{initTruecaller()}catch(e){}
