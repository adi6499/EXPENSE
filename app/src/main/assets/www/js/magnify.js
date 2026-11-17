// The glass bars as a magnifying glass: what passes under the bottom bar (and the top bars) is
// shown SHARP and BIGGER, and stretches towards the rounded rim, like looking through a thick lens.
// Works where the browser can bend what is behind an element (Chrome, Edge, the Android app); an
// iPhone keeps plain clear glass. Cosmetic only: any failure leaves the plain glass in place.
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

const canBend = () => isChromium() && !(navigator.connection && navigator.connection.saveData);

/** Puts the magnifier on every bar marked data-mag (call after bars appear, change size, or the glass level changes). */
export function refresh() {
  try {
    const bars = [...document.querySelectorAll('[data-mag]')];
    const level = document.documentElement.dataset.juGlass; // set by the kit: solid / frosted / clear
    const on = canBend() && level !== 'solid' && level !== 'frosted';
    for (const el of bars) {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (!on || !w || !h) {
        el.style.webkitBackdropFilter = '';
        el.style.backdropFilter = '';
        continue;
      }
      const kind = el.dataset.mag === 'flat' ? 'flat' : 'pill';
      const f = `url(#${filterFor(w, h, kind)}) blur(calc((1 - var(--g)) * 22px)) brightness(var(--mag-bright, 1.04))`;
      el.style.webkitBackdropFilter = f;
      el.style.backdropFilter = f;
    }
  } catch {
    /* plain glass stays */
  }
}

/** Takes the magnifier off a bar (the side menu on a computer is plain glass). */
export function clear(el) {
  if (!el) return;
  el.style.webkitBackdropFilter = '';
  el.style.backdropFilter = '';
}
