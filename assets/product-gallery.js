(function () {
  'use strict';

  var FALLBACK = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">' +
    '<rect width="800" height="800" fill="#f4f1e7"/>' +
    '<path d="M230 540l105-130 80 92 58-70 105 130H230z" fill="#d8d2c2"/>' +
    '<circle cx="330" cy="300" r="48" fill="#d8d2c2"/>' +
    '</svg>'
  );

  function toArray(list) {
    return Array.prototype.slice.call(list || []);
  }

  function srcOf(img) {
    return img.getAttribute('data-full') ||
      img.getAttribute('data-src') ||
      img.getAttribute('src') ||
      img.currentSrc ||
      '';
  }

  function altOf(img, main) {
    return img.getAttribute('data-alt') ||
      img.getAttribute('alt') ||
      (main && main.getAttribute('alt')) ||
      'Product image';
  }

  function unwrapSources(img) {
    var pic = img.parentNode;
    if (pic && pic.tagName === 'PICTURE') {
      toArray(pic.querySelectorAll('source')).forEach(function (source) {
        source.parentNode.removeChild(source);
      });
    }
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
  }

  function initGallery(root) {
    if (!root || root.__pgGallery) return root && root.__pgGallery;

    var main = root.querySelector('img.main, #mainImg');
    var thumbs = root.querySelector('#thumbs, .thumbs');
    if (!main || !thumbs) return null;

    var stage = document.createElement('div');
    stage.className = 'pg-stage';
    var stageHost = main.parentNode && main.parentNode.tagName === 'PICTURE' ? main.parentNode : main;
    stageHost.parentNode.insertBefore(stage, stageHost);
    stage.appendChild(stageHost);

    var items = [];
    var selected = -1;
    var startX = 0;
    var startY = 0;
    var dragging = false;
    var navPrev = document.createElement('button');
    var navNext = document.createElement('button');

    main.classList.add('pg-main');
    main.setAttribute('draggable', 'false');
    main.setAttribute('tabindex', '0');
    if (!main.getAttribute('aria-label')) {
      main.setAttribute('aria-label', 'Product image gallery. Use left and right arrow keys to change image.');
    }

    navPrev.type = 'button';
    navPrev.className = 'pg-nav pg-prev';
    navPrev.setAttribute('aria-label', 'Previous product image');
    navPrev.innerHTML = '&#8249;';
    navNext.type = 'button';
    navNext.className = 'pg-nav pg-next';
    navNext.setAttribute('aria-label', 'Next product image');
    navNext.innerHTML = '&#8250;';
    stage.appendChild(navPrev);
    stage.appendChild(navNext);

    function setActive(index) {
      selected = index;
      items.forEach(function (thumb, i) {
        var on = i === index;
        thumb.classList.toggle('on', on);
        thumb.setAttribute('aria-current', on ? 'true' : 'false');
      });
      if (index < 0 || !items[index]) return;
      var thumb = items[index];
      var thumbRect = thumb.getBoundingClientRect();
      var stripRect = thumbs.getBoundingClientRect();
      var left = thumbs.scrollLeft + thumbRect.left - stripRect.left -
        (thumbs.clientWidth - thumbRect.width) / 2;
      if (left < 0) left = 0;
      try {
        thumbs.scrollTo({ left: left, behavior: 'smooth' });
      } catch (e) {
        thumbs.scrollLeft = left;
      }
    }

    function setMain(src, alt, options) {
      options = options || {};
      if (!src) return;
      unwrapSources(main);
      main.classList.remove('pg-error');
      main.classList.add('pg-loading');
      main.setAttribute('data-gallery-locked', '1');
      main.setAttribute('data-gallery-src', src);
      if (alt) main.setAttribute('alt', alt);
      main.setAttribute('src', src);
      if (options.external) setActive(-1);
    }

    function preload(index) {
      if (!items.length) return;
      var thumb = items[((index % items.length) + items.length) % items.length];
      var src = thumb && srcOf(thumb);
      if (!src) return;
      var image = new Image();
      image.src = src;
    }

    function show(index) {
      if (!items.length) return;
      index = ((index % items.length) + items.length) % items.length;
      var thumb = items[index];
      var src = srcOf(thumb);
      setActive(index);
      if (!src) {
        main.classList.add('pg-error');
        main.classList.remove('pg-loading');
        main.setAttribute('src', FALLBACK);
        return;
      }
      setMain(src, altOf(thumb, main));
      preload(index + 1);
      preload(index - 1);
    }

    function step(delta) {
      if (!items.length) return;
      if (selected < 0) show(delta > 0 ? 0 : items.length - 1);
      else show(selected + delta);
    }

    function bindThumb(thumb) {
      if (thumb.__pgBound) return;
      thumb.__pgBound = true;
      thumb.setAttribute('role', 'button');
      thumb.setAttribute('tabindex', '0');
      thumb.addEventListener('error', function () {
        thumb.classList.add('pg-broken');
      });
    }

    function refresh() {
      var previousSrc = selected >= 0 && items[selected] ? srcOf(items[selected]) : '';
      items = toArray(thumbs.querySelectorAll('img')).filter(function (img) {
        return !img.hasAttribute('data-gallery-ignore');
      });
      items.forEach(bindThumb);

      root.classList.toggle('pg-multi', items.length > 1);
      root.classList.toggle('pg-single', items.length === 1);
      navPrev.disabled = items.length < 2;
      navNext.disabled = items.length < 2;

      if (!items.length) {
        selected = -1;
        return;
      }

      var next = selected;
      if (previousSrc) {
        var found = -1;
        for (var i = 0; i < items.length; i++) {
          if (srcOf(items[i]) === previousSrc) { found = i; break; }
        }
        if (found >= 0) next = found;
      }
      if (next < 0 || next >= items.length) {
        next = 0;
        for (var j = 0; j < items.length; j++) {
          if (items[j].classList.contains('on')) { next = j; break; }
        }
      }
      if (main.hasAttribute('data-gallery-locked') && selected < 0) {
        setActive(-1);
      } else {
        setActive(next);
      }
    }

    thumbs.addEventListener('click', function (event) {
      var target = event.target;
      while (target && target !== thumbs && target.tagName !== 'IMG') target = target.parentNode;
      if (!target || target.tagName !== 'IMG') return;
      var index = items.indexOf(target);
      if (index < 0) return;
      event.preventDefault();
      show(index);
    });

    thumbs.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      var target = event.target;
      if (!target || target.tagName !== 'IMG') return;
      var index = items.indexOf(target);
      if (index < 0) return;
      event.preventDefault();
      show(index);
    });

    navPrev.addEventListener('click', function (event) {
      event.preventDefault();
      step(-1);
    });
    navNext.addEventListener('click', function (event) {
      event.preventDefault();
      step(1);
    });

    main.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      }
    });

    main.addEventListener('load', function () {
      main.classList.remove('pg-loading');
    });
    main.addEventListener('error', function () {
      main.classList.remove('pg-loading');
      if (main.getAttribute('src') === FALLBACK) return;
      main.classList.add('pg-error');
      main.setAttribute('src', FALLBACK);
    });

    main.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse') return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      try {
        if (main.setPointerCapture) main.setPointerCapture(event.pointerId);
      } catch (e) {}
    });
    main.addEventListener('pointerup', function (event) {
      if (!dragging) return;
      dragging = false;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        step(dx < 0 ? 1 : -1);
      }
    });
    main.addEventListener('pointercancel', function () {
      dragging = false;
    });
    main.addEventListener('dragstart', function (event) {
      event.preventDefault();
    });

    var requested = main.getAttribute('data-gallery-requested-src');
    refresh();
    if (requested) {
      setMain(requested, main.getAttribute('alt'), { external: true });
      setActive(-1);
      main.removeAttribute('data-gallery-requested-src');
    }

    if (window.MutationObserver) {
      new MutationObserver(function () {
        refresh();
      }).observe(thumbs, { childList: true });
    }

    var api = {
      show: show,
      step: step,
      refresh: refresh,
      setSource: function (src, alt, options) {
        setMain(src, alt, options);
        setActive(-1);
      },
      getIndex: function () { return selected; }
    };
    root.__pgGallery = api;
    return api;
  }

  function roots() {
    return toArray(document.querySelectorAll('.ap-gal'));
  }

  function initAll() {
    roots().forEach(initGallery);
  }

  window.AVN_GALLERY = {
    init: initAll,
    setSource: function (src, alt, options) {
      var list = roots();
      for (var i = 0; i < list.length; i++) {
        var api = list[i].__pgGallery || initGallery(list[i]);
        if (api && list[i].querySelector('img.main, #mainImg')) {
          api.setSource(src, alt, options || { external: true });
          return true;
        }
      }
      return false;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
