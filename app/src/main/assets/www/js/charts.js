// Small hand-drawn SVG charts in the style of Apple Health / Screen Time.
import { esc } from './ui.js';

/** Activity-style ring. pct 0..1+ (over 1 shows a full ring in the warning colour). */
export function ring(pct, { size = 64, stroke = 9, color = 'var(--green)', track = 'var(--fill)' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = Math.max(0, Math.min(1, pct));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle class="ring-value" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - shown)}"
      transform="rotate(-90 ${size / 2} ${size / 2})" style="--c:${c}"/>
  </svg>`;
}

/** Donut with gaps between slices. segments: [{ value, color }]. */
export function donut(segments, { size = 168, stroke = 22, gap = 2.5, center = '' } = {}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = total > 0 ? segments.map(seg => {
    const length = (seg.value / total) * c;
    const visible = Math.max(0.001, length - (segments.length > 1 ? gap : 0));
    const arc = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--${esc(seg.color)})"
      stroke-width="${stroke}" stroke-dasharray="${visible} ${c - visible}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    offset += length;
    return arc;
  }).join('') : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="${stroke}"/>`;
  return `<div class="donut" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${arcs}</svg>
    <div class="donut-center">${center}</div>
  </div>`;
}

/**
 * Rounded bar chart with a dashed average line. buckets: [{ label, total }].
 * Labels are thinned out when there are many bars. Bars carry data-i for tapping.
 */
export function bars(buckets, { height = 150, selected = -1, average = 0, formatAxis = v => String(v), highlight = -1 } = {}) {
  const max = Math.max(1, ...buckets.map(b => b.total), average);
  const niceMax = niceCeil(max);
  const n = buckets.length;
  const labelEvery = n > 20 ? 7 : n > 12 ? 2 : 1;
  const avgTop = average > 0 ? (1 - average / niceMax) * 100 : null;
  return `<div class="bars" style="--h:${height}px">
    <div class="bars-grid">
      <span style="top:0" data-l="${esc(formatAxis(niceMax))}"></span>
      <span style="top:50%" data-l="${esc(formatAxis(niceMax / 2))}"></span>
      <span style="top:100%" data-l="0"></span>
    </div>
    ${avgTop !== null ? `<div class="bars-avg" style="top:${avgTop}%"><em>avg</em></div>` : ''}
    <div class="bars-cols" style="--n:${n}">
      ${buckets.map((b, i) => `
        <button class="bar-col ${i === selected ? 'sel' : ''} ${selected >= 0 && i !== selected ? 'dim' : ''} ${i === highlight ? 'now' : ''}" data-i="${i}" aria-label="${esc(b.longLabel || b.label)}">
          <span class="bar" style="height:${b.total > 0 ? Math.max(2, (b.total / niceMax) * 100) : 0}%"></span>
        </button>`).join('')}
    </div>
    <div class="bars-labels" style="--n:${n}">
      ${buckets.map((b, i) => `<span>${i % labelEvery === 0 ? esc(b.label) : ''}</span>`).join('')}
    </div>
  </div>`;
}

/** Rounds up to a tidy axis number: 1, 2, 2.5, 5 × 10^k. */
export function niceCeil(value) {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** Thin stacked bar of category shares. segments: [{ value, color }]. */
export function stackBar(segments) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return `<div class="stack-bar">${segments.map(s =>
    `<span style="flex:${s.value / total};background:var(--${esc(s.color)})"></span>`).join('')}</div>`;
}
