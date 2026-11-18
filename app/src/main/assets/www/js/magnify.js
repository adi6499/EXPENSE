// The glass bars as a magnifying glass: what passes under the bottom bar (and the top bars) is
// shown SHARP and BIGGER, and stretches towards the rounded rim, like looking through a thick lens.
// Works where the browser can bend what is behind an element (Chrome, Edge, the Android app); iPhone,
// Safari and Firefox get the same look as an enlarged live copy of the page under the bottom bar
// (see "the copy lens" below). Cosmetic only: any failure leaves the plain glass in place.
//
// How: one picture per bar size (a "displacement map": each pixel says where to look instead),
// used through an SVG filter in backdrop-filter. Bars opt in with data-mag ("" = the round bottom
// bar, "flat" = a top bar). The glass level from Settings still rules: Clear shows the magnifier
// with no blur; Frosted and Solid fall back to the kit's plain glass.

const LOOK = {
  pill: { m: 1.5, mx: 1.42, rim: 0.31 },  // bottom bar: strongly magnified both ways, big stretch at the rim
  flat: { m: 1.3, mx: 1, rim: 0.3 },      // top bars: magnified top-to-bottom, stretched at the edges
};

const maps = new Map(); // "w×h×kind" → { id, url, scale }
let svg = null;
let count = 0;

/** Where a pixel at distance u (0 = middle, 1 = rim) shows from: magnified in the middle, stretched near the rim. */
const sampleAt = (u, { m, rim }) => (u - rim * u * u * u) / m;

function makeMap(w, h, kind) {
  const look = LOOK[kind];
  const ox = new Float32Array(w * h);
  const oy = new Float32Array(w * h);
  let max = 0.01;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = px + 0.5;
      const y = py + 0.5;
      let dx = 0;
      let dy = 0;
      if (kind === 'flat') {
        const half = h / 2;
        const d = y - half;
        const u = Math.min(1, Math.abs(d) / half);
        dy = Math.sign(d) * sampleAt(u, look) * half - d;
      } else {
        // A pill: distance from its middle line, round at both ends
        const rad = h / 2;
        const sx = Math.max(rad, Math.min(w - rad, x));
        const vx = x - sx;
        const vy = y - rad;
        const dist = Math.hypot(vx, vy);
        if (dist > 0) {
          const u = Math.min(1, dist / rad);
          const k = (sampleAt(u, look) * rad - dist) / dist;
          dx = vx * k;
          dy = vy * k;
        }
        // …and widened along its length, like one long magnifying glass
        dx += -(x - w / 2) * (1 - 1 / look.mx);
      }
      const i = py * w + px;
      ox[i] = dx;
      oy[i] = dy;
      max = Math.max(max, Math.abs(dx), Math.abs(dy));
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = Math.round(128 + (ox[i] / max) * 127);
    img.data[i * 4 + 1] = Math.round(128 + (oy[i] / max) * 127);
    img.data[i * 4 + 2] = 128;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), scale: Math.round(max * 2 * 100) / 100 };
}

function filterFor(w, h, kind) {
  const key = `${w}x${h}x${kind}`;
  let entry = maps.get(key);
  if (entry) return entry.id;
  const { url, scale } = makeMap(w, h, kind);
  entry = { id: `mag${++count}`, url, scale };
  maps.set(key, entry);
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    svg.innerHTML = '<defs></defs>';
    document.body.appendChild(svg);
  }
  svg.firstChild.insertAdjacentHTML('beforeend',
    `<filter id="${entry.id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
    `<feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="m" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/></filter>`);
  return entry.id;
}

/**
 * Can this browser bend what is behind a bar? Every Chromium browser can (Chrome, Edge, Brave, Opera,
 * Samsung Internet, the Android app) — found by its engine, not its name, so it still works when the
 * browser pretends to be an iPhone (developer tools) or hides its version. Safari and every iPhone
 * browser (all WebKit) cannot, and Firefox draws no bend: those keep the plain clear glass.
 */
function isChromium() {
  try {
    if (window.chrome) return true;
    const brands = navigator.userAgentData && navigator.userAgentData.brands;
    if (brands && brands.some(b => /Chromium|Chrome|Edge|Opera|Brave/i.test(b.brand))) return true;
  } catch { /* fall through to the name */ }
  return /Chrome\/\d+|Chromium\/\d+|EdgA?\/\d+|SamsungBrowser\/\d+/.test(navigator.userAgent || '') && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent || '');
}

/** While testing: ?lens=copy in the address draws the iPhone version in any browser. */
const forceCopy = /[?&]lens=copy\b/.test(location.search);

const canGlass = () => {
  try { return CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'); } catch { return false; }
};

const canBend = () => !forceCopy && isChromium() && !(navigator.connection && navigator.connection.saveData);

const clearLevel = () => {
  const level = document.documentElement.dataset.juGlass; // set by the kit: solid / frosted / clear
  return level !== 'solid' && level !== 'frosted';
};

/** Puts the magnifier on every bar marked data-mag (call after bars appear, change size, the tab changes, or the glass level changes). */
export function refresh() {
  try {
    const bars = [...document.querySelectorAll('[data-mag]')];
    const bend = canBend() && clearLevel();
    for (const el of bars) {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (!bend || !w || !h) {
        el.style.webkitBackdropFilter = '';
        el.style.backdropFilter = '';
        continue;
      }
      const kind = el.dataset.mag === 'flat' ? 'flat' : 'pill';
      const f = `url(#${filterFor(w, h, kind)}) blur(calc((1 - var(--g)) * 22px)) brightness(var(--mag-bright, 1.04))`;
      el.style.webkitBackdropFilter = f;
      el.style.backdropFilter = f;
    }
    // Browsers that cannot bend what is behind the round bottom bar get an enlarged copy of the page instead
    const pill = document.querySelector('.tabbar[data-mag=""]');
    if (pill && !canBend() && canGlass() && clearLevel()) copyStart(pill);
    else copyStop();
  } catch {
    copyStop(); /* plain glass stays */
  }
}

/** Takes the magnifier off a bar (the side menu on a computer is plain glass). */
export function clear(el) {
  if (!el) return;
  el.style.webkitBackdropFilter = '';
  el.style.backdropFilter = '';
  if (el.classList.contains('tabbar')) copyStop();
}

// ---------------------------------------------------------------- the copy lens (iPhone, Safari, Firefox)
//
// Those browsers cannot bend what is behind an element (WebKit bug 245510). So under the round bottom bar
// sits a layer holding a live copy of the page on show, enlarged by the same amounts as the bending lens
// (1.42 × 1.5, about the bar's centre) and moved in step with scrolling. The bar itself is then left
// clear so the copy shows. The same way Music Flow does it.
//   - position: on every scroll the copy is moved so the point of the page under the bar's centre is at
//     the centre of the copy (no layout reads while scrolling);
//   - content: when the page changes, the copy is made again — never more than a few times a second,
//     never mid-scroll;
//   - a page too long to copy cheaply keeps plain glass.

const SX = LOOK.pill.mx;
const SY = LOOK.pill.m;
const TOO_LONG = 3600;
const lens = { bar: null, under: null, page: null, scroller: null, watcher: null, timer: 0, lastBuilt: 0, lastScrolled: 0, at: { bx: 0, by: 0, bw: 0, bh: 0, px: 0, top: 0 } };

const activeScroller = () => document.querySelector('.tab-page.active .scroller');

function place() {
  const { page, scroller, at } = lens;
  if (!page || !scroller) return;
  const pTop = at.top - scroller.scrollTop;
  const tx = at.bw / 2 + SX * (at.px - (at.bx + at.bw / 2));
  const ty = at.bh / 2 + SY * (pTop - (at.by + at.bh / 2));
  page.style.transform = `matrix(${SX}, 0, 0, ${SY}, ${tx.toFixed(2)}, ${ty.toFixed(2)})`;
}

function measure() {
  const { bar, under, page, scroller, at } = lens;
  if (!bar || !under || !page || !scroller) return;
  // offsetLeft/Top ignore the bar's own animations, which getBoundingClientRect would not
  at.bx = bar.offsetLeft;
  at.by = bar.offsetTop;
  at.bw = bar.offsetWidth;
  at.bh = bar.offsetHeight;
  const home = under.parentElement.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const cs = getComputedStyle(scroller);
  at.px = box.left - home.left + (parseFloat(cs.paddingLeft) || 0);
  at.top = box.top - home.top + (parseFloat(cs.paddingTop) || 0);
  page.style.width = `${scroller.clientWidth}px`;
  place();
}

function build() {
  const { under, page, scroller, bar } = lens;
  if (!under || !page || !scroller) return;
  lens.lastBuilt = performance.now();
  if (scroller.getElementsByTagName('*').length > TOO_LONG) {
    page.replaceChildren();
    under.hidden = true;
    delete bar.dataset.copy;
    return;
  }
  under.hidden = false;
  bar.dataset.copy = '1';
  const holder = document.createElement('div');
  for (const child of scroller.children) holder.appendChild(child.cloneNode(true));
  holder.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  holder.querySelectorAll('[autofocus]').forEach(n => n.removeAttribute('autofocus'));
  holder.querySelectorAll('img').forEach(n => { n.decoding = 'sync'; n.loading = 'eager'; });
  page.replaceChildren(...holder.childNodes);
  measure();
}

/** The page changed: make the copy again soon, but never more than a few times a second, and never mid-scroll. */
function rebuildSoon() {
  if (lens.timer || !lens.under) return;
  const run = () => {
    lens.timer = 0;
    if (!lens.under || document.hidden) return;
    if (performance.now() - lens.lastScrolled < 150) { lens.timer = setTimeout(run, 170); return; }
    try { build(); } catch { copyStop(); }
  };
  lens.timer = setTimeout(run, Math.max(90, 360 - (performance.now() - lens.lastBuilt)));
}

const onScroll = () => { lens.lastScrolled = performance.now(); place(); };

/** Follows the tab on show (a different page scrolls under the bar). */
function follow() {
  const scroller = activeScroller();
  if (!scroller || scroller === lens.scroller) return;
  if (lens.scroller) lens.scroller.removeEventListener('scroll', onScroll);
  if (lens.watcher) lens.watcher.disconnect();
  lens.scroller = scroller;
  scroller.addEventListener('scroll', onScroll, { passive: true });
  lens.watcher = new MutationObserver(rebuildSoon);
  lens.watcher.observe(scroller, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'src', 'hidden'] });
  build();
}

function copyStart(bar) {
  if (lens.under) { follow(); measure(); return; }
  const home = bar.parentElement;
  if (!home) return;
  lens.bar = bar;
  lens.under = document.createElement('div');
  lens.under.className = 'lens-under';
  lens.under.setAttribute('aria-hidden', 'true');
  lens.under.setAttribute('inert', '');
  lens.page = document.createElement('div');
  lens.page.className = 'lens-page';
  lens.under.appendChild(lens.page);
  home.insertBefore(lens.under, bar); // just below the bar it belongs to
  window.addEventListener('resize', measure, { passive: true });
  try { follow(); } catch { copyStop(); }
}

function copyStop() {
  if (lens.timer) { clearTimeout(lens.timer); lens.timer = 0; }
  if (lens.watcher) lens.watcher.disconnect();
  if (lens.scroller) lens.scroller.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', measure);
  if (lens.under) lens.under.remove();
  if (lens.bar) delete lens.bar.dataset.copy;
  Object.assign(lens, { bar: null, under: null, page: null, scroller: null, watcher: null });
}
