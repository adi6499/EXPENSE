/* Jinharsh UI kit - the small script that goes with jinharsh-ui.css.
   Everything here is cosmetic and guarded: if any part fails, the page still works, just plainer.

   JUI.setGlass(n)      0 = solid, 30 = frosted, 100 = clear. Remembered on this device.
   JUI.setDark(on)      true / false / 'auto' (follow the phone). Remembered on this device.
   JUI.lens()           the "liquid glass" bend on every element marked data-ju-lens (Chrome and Edge only; others keep plain glass).
   JUI.toast('text')    a small message at the bottom.
   JUI.flip(container)  call BEFORE you redraw a list, then call the function it returns AFTER: the rows glide to their new places. */
(function () {
  'use strict';
  var H = document.documentElement, KEY = 'jui_';
  var get = function (k) { try { return localStorage.getItem(KEY + k); } catch (e) { return null; } };
  var put = function (k, v) { try { localStorage.setItem(KEY + k, v); } catch (e) {} };
  var calm = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  function setGlass(n, keep) {
    n = Math.max(0, Math.min(100, Math.round(+n) || 0));
    H.dataset.juGlass = n < 5 ? 'solid' : n < 55 ? 'frosted' : 'clear';
    H.style.setProperty('--g', n / 100); H.style.setProperty('--gp', n + '%');
    if (keep !== false) put('glass', n);
    try { lens(); } catch (e) {}
    return n;
  }
  function setDark(on, keep) {
    var dark = on === 'auto' ? (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) : !!on;
    H.classList.toggle('dark', dark); if (keep !== false) put('dark', on === 'auto' ? 'auto' : dark ? '1' : '0');
    return dark;
  }

  /* ---- the lens: what is behind the bar looks stretched towards its rim, like thick glass.
     A displacement map (one colour per pixel = "show what is THIS far away instead") shaped like the element, used through an SVG filter in
     backdrop-filter. Only Chrome-family browsers can bend what is behind an element. iPhones and Firefox keep the plain glass - do not chase it.
     Numbers: stretch under the rim, stretch on the middle line, how fast one becomes the other. Hub uses 11 / 2.2 / 1.3 (Ariba used 7 / 1.4). */
  var M_RIM = 11, M_MID = 2.2, M_Q = 1.3, lensKey = '';
  function shift(inset, rad) {
    var x = Math.min(1, Math.max(0, inset) / rad), a = 1 / M_RIM, b = 1 / M_MID;
    var shown = 1 - (a * (1 - x) + (b - a) * (1 - Math.pow(x, M_Q + 1)) / (M_Q + 1));
    return rad * (x - shown);
  }
  function mapOf(w, h, flat) {
    var c = document.createElement('canvas'); c.width = flat ? 2 : w; c.height = h;
    var cx = c.getContext('2d'), img = cx.createImageData(c.width, h), d = img.data, rad = flat ? h : Math.min(h, w) / 2, max = .01, k, px, py;
    for (k = 0; k <= rad * 4; k++) max = Math.max(max, Math.abs(shift(k / 4, rad)));
    for (py = 0; py < h; py++) for (px = 0; px < c.width; px++) {
      var i = (py * c.width + px) * 4, r = 128, g = 128;
      if (flat) g = Math.round(128 + shift(h - py - .5, h) / max * 127);
      else {
        var sx = Math.max(rad, Math.min(w - rad, px + .5)), sy = Math.max(rad, Math.min(h - rad, py + .5));
        var dx = px + .5 - sx, dy = py + .5 - sy, dist = Math.sqrt(dx * dx + dy * dy), t = shift(rad - dist, rad) / max;
        r = Math.round(128 + (dist ? dx / dist : 0) * t * 127); g = Math.round(128 + (dist ? dy / dist : 0) * t * 127);
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = 128; d[i + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    return { url: c.toDataURL('image/png'), scale: Math.round(max * 2 * 100) / 100 };
  }
  function lens() {
    try {
      var els = [].slice.call(document.querySelectorAll('[data-ju-lens]'));
      var chrome = /Chrome\/\d+/.test(navigator.userAgent || ''), slow = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.connection && navigator.connection.saveData);
      var clear = H.dataset.juGlass !== 'solid' && H.dataset.juGlass !== 'frosted';
      if (!chrome || slow || !clear || !els.length) { els.forEach(function (el) { el.style.webkitBackdropFilter = ''; el.style.backdropFilter = ''; }); return; }
      var NS = 'http://www.w3.org/2000/svg', svg = document.getElementById('juLensSvg'), defs = '', key = '';
      if (!svg) { svg = document.createElementNS(NS, 'svg'); svg.id = 'juLensSvg'; svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true'); svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none'; document.body.appendChild(svg); }
      els.forEach(function (el, i) { key += Math.round(el.offsetWidth) + 'x' + Math.round(el.offsetHeight) + '|'; el.dataset.juLensId = 'juLens' + i; });
      if (key !== lensKey) {
        els.forEach(function (el) {
          var w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight), flat = el.dataset.juLens === 'flat'; if (!w || !h) return;
          var m = mapOf(w, h, flat);
          defs += '<filter id="' + el.dataset.juLensId + '" x="0" y="0" width="' + w + '" height="' + h + '" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feImage href="' + m.url + '" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="none" result="m"/><feDisplacementMap in="SourceGraphic" in2="m" scale="' + m.scale + '" xChannelSelector="R" yChannelSelector="G"/></filter>';
        });
        svg.innerHTML = '<defs>' + defs + '</defs>'; lensKey = key;
      }
      els.forEach(function (el) { var f = 'url(#' + el.dataset.juLensId + ') blur(var(--gblur)) brightness(var(--lens-bright))'; el.style.webkitBackdropFilter = f; el.style.backdropFilter = f; });
    } catch (e) { /* plain glass stays */ }
  }

  function toast(text, ms) {
    try {
      var old = document.querySelector('.ju-toast'); if (old) old.remove();
      var t = document.createElement('div'); t.className = 'ju-toast'; t.textContent = text; (document.querySelector('.ju body') || document.body).appendChild(t);
      setTimeout(function () { t.remove(); }, ms || 2400);
    } catch (e) {}
  }

  /* rows that glide: var done = JUI.flip(listEl);  ...redraw the list (each row needs a stable data-key)...  done(); */
  function flip(box) {
    var was = {}; try { [].forEach.call(box.querySelectorAll('[data-key]'), function (el) { was[el.dataset.key] = el.getBoundingClientRect().top; }); } catch (e) {}
    return function () {
      try {
        if (calm()) return;
        [].forEach.call(box.querySelectorAll('[data-key]'), function (el) {
          if (!el.animate) return; var y = was[el.dataset.key], now = el.getBoundingClientRect().top, d = y == null ? 10 : y - now;
          if (Math.abs(d) < 1 || Math.abs(d) > 900) return;
          var a = el.animate([{ transform: 'translateY(' + d + 'px)' }, { transform: 'none' }], { duration: y == null ? 260 : 300, easing: 'cubic-bezier(.25,.8,.25,1)' });
          setTimeout(function () { try { a.finish(); } catch (e) {} }, 400); // also ended by a timer, so a browser that pauses animations still shows the finished list
        });
      } catch (e) {}
    };
  }

  // start: what was chosen last time on this device, else clear glass and the phone's own light/dark
  try { var g = get('glass'); setGlass(g == null ? 100 : +g, false); var d = get('dark'); setDark(d == null || d === 'auto' ? 'auto' : d === '1', false); } catch (e) {}
  var rt = 0; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(lens, 180); }, { passive: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lens); else setTimeout(lens, 0);

  window.JUI = { setGlass: setGlass, setDark: setDark, lens: lens, toast: toast, flip: flip };
})();
