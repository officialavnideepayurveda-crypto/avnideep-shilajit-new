(function () {
  if (window.AvLoader) return;

  var MIN_SHOW = 550;
  var MAX_SHOW = 3500;
  var start = Date.now();
  var hidden = false;
  var root = document.documentElement;

  var CSS = [
    'html.av-loading{overflow:hidden!important}',
    '.av-loader{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;',
    'background:radial-gradient(120% 120% at 50% 0%,#17523b 0%,#123B2C 45%,#08211a 100%);',
    'opacity:1;visibility:visible;transition:opacity .45s ease,visibility .45s ease;-webkit-tap-highlight-color:transparent}',
    '.av-loader.av-out{opacity:0;visibility:hidden;pointer-events:none}',
    '.av-loader-in{display:flex;flex-direction:column;align-items:center;gap:16px;animation:av-in .5s cubic-bezier(.22,.61,.36,1) both}',
    '.av-loader-badge{position:relative;width:100px;height:100px;display:grid;place-items:center;border-radius:50%;',
    'background:#fff;box-shadow:0 20px 60px -20px rgba(0,0,0,.6),0 0 0 1px rgba(201,162,75,.35)}',
    '.av-loader-badge::after{content:"";position:absolute;inset:-20px;border-radius:50%;',
    'background:radial-gradient(circle,rgba(201,162,75,.3),transparent 70%);animation:av-pulse 2.2s ease-in-out infinite}',
    '.av-loader-badge img{width:78px;height:auto;display:block;border-radius:8px;position:relative;z-index:1}',
    '.av-loader-ring{position:absolute;inset:-7px;border-radius:50%;',
    'background:conic-gradient(from 0deg,rgba(201,162,75,0) 0deg,#C9A24B 200deg,#F4DFA4 320deg,rgba(201,162,75,0) 360deg);',
    '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3.5px));',
    'mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3.5px));',
    'animation:av-spin .9s linear infinite}',
    '.av-loader-name{font:700 14px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.24em;',
    'text-transform:uppercase;color:#F4DFA4}',
    '.av-loader-name b{color:#C9A24B;font-weight:700}',
    '.av-loader-bar{width:136px;height:3px;border-radius:99px;background:rgba(255,255,255,.14);overflow:hidden}',
    '.av-loader-bar i{display:block;height:100%;width:45%;border-radius:99px;',
    'background:linear-gradient(90deg,#C9A24B,#F4DFA4);animation:av-bar 1.1s ease-in-out infinite}',
    '.av-loader-txt{font:600 10.5px/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.2em;',
    'text-transform:uppercase;color:rgba(255,255,255,.5)}',
    '@keyframes av-spin{to{transform:rotate(360deg)}}',
    '@keyframes av-pulse{0%,100%{transform:scale(.92);opacity:.5}50%{transform:scale(1.06);opacity:1}}',
    '@keyframes av-bar{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}',
    '@keyframes av-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
    '@media(prefers-reduced-motion:reduce){.av-loader-ring,.av-loader-bar i,.av-loader-badge::after,.av-loader-in{animation:none}}'
  ].join('');

  var style = document.createElement('style');
  style.id = 'avLoaderCSS';
  style.textContent = CSS;
  (document.head || root).appendChild(style);

  var el = document.createElement('div');
  el.id = 'avLoader';
  el.className = 'av-loader';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-label', 'Loading');
  el.innerHTML = '<div class="av-loader-in">' +
    '<div class="av-loader-badge"><span class="av-loader-ring"></span>' +
    '<img src="/assets/logo-240.webp" alt="Avnideep Ayurveda" width="120" height="74" decoding="async"></div>' +
    '<div class="av-loader-name">Avnideep <b>Ayurveda</b></div>' +
    '<div class="av-loader-bar"><i></i></div>' +
    '<div class="av-loader-txt">Loading</div>' +
    '</div>';

  root.appendChild(el);
  root.classList.add('av-loading');

  function mount() {
    if (document.body && el.parentNode !== document.body) document.body.appendChild(el);
  }

  function hide() {
    if (hidden) return;
    hidden = true;
    el.classList.add('av-out');
    root.classList.remove('av-loading');
  }

  function show() {
    if (!hidden) return;
    hidden = false;
    mount();
    root.classList.add('av-loading');
    el.classList.remove('av-out');
  }

  function reveal() {
    var wait = Math.max(0, MIN_SHOW - (Date.now() - start));
    setTimeout(hide, wait);
  }

  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    reveal();
  } else {
    document.addEventListener('DOMContentLoaded', reveal, { once: true });
  }
  setTimeout(hide, MAX_SHOW);

  window.addEventListener('pageshow', function (e) {
    if (e.persisted) hide();
  });

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.hasAttribute('data-no-loader') || a.hasAttribute('download')) return;
    var t = a.getAttribute('target');
    if (t && t !== '_self') return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(javascript:|mailto:|tel:|sms:)/i.test(href)) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.origin !== location.origin) return;
    if (url.href === location.href) return;
    if (url.hash && url.pathname === location.pathname && url.search === location.search) return;
    show();
    setTimeout(function () { if (e.defaultPrevented) hide(); }, 0);
    setTimeout(hide, 12000);
  }, true);

  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM') return;
    if (f.hasAttribute('data-no-loader')) return;
    show();
    setTimeout(function () { if (e.defaultPrevented) hide(); }, 0);
    setTimeout(hide, 12000);
  }, true);

  window.AvLoader = { show: show, hide: hide };
})();
