// A month in one picture (1080 × 1350 PNG, ready for WhatsApp): spent, income, kept, change from the
// month before, where the money went, the biggest spend. Shown on Summary in the first week of a
// month, and from Insights for any month.
import { store } from './store.js';
import { native } from './native.js';
import * as L from './logic.js';
import { $, esc, icon, tile, openSheet, toast } from './ui.js';

const COLORS = {
  red: '#ff3b30', orange: '#ff9500', yellow: '#ffcc00', green: '#34c759', mint: '#00c7be', teal: '#30b0c7',
  cyan: '#32ade6', blue: '#007aff', indigo: '#5856d6', purple: '#af52de', pink: '#ff2d55', brown: '#a2845e', gray: '#8e8e93',
};

/** The numbers for one month (monthStart = 'YYYY-MM-01'). */
export function monthData(monthStart) {
  const end = L.endOfMonth(monthStart);
  const all = store.state.transactions;
  const month = L.inRange(all, monthStart, end);
  const prevStart = L.addMonths(monthStart, -1);
  const t = L.totals(month);
  const prev = L.totals(L.inRange(all, prevStart, L.endOfMonth(prevStart)));
  const cats = L.byCategory(month).slice(0, 5).map(r => {
    const c = store.category(r.categoryId);
    return { name: c.name, color: COLORS[c.color] || COLORS.gray, total: r.total, pct: t.expense ? r.total / t.expense : 0 };
  });
  const biggest = month.filter(x => x.type === 'expense').sort((a, b) => b.amount - a.amount)[0] || null;
  return {
    label: L.parseISO(monthStart).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    monthName: L.parseISO(monthStart).toLocaleDateString('en-IN', { month: 'long' }),
    spent: t.expense,
    income: t.income,
    kept: t.income - t.expense,
    change: L.percentChange(t.expense, prev.expense),
    cats,
    biggest: biggest ? { amount: biggest.amount, note: biggest.note || store.category(biggest.categoryId).name } : null,
    count: month.length,
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Draws the picture; resolves a PNG data URL. */
export async function drawMonth(d) {
  try { await document.fonts.ready; } catch { /* draw with what is loaded */ }
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const font = (weight, size) => `${weight} ${size}px Inter, system-ui, sans-serif`;
  const money = v => store.money(v);

  ctx.fillStyle = '#f2f2f7';
  ctx.fillRect(0, 0, W, H);
  const pad = 72;

  ctx.fillStyle = '#8e8e93';
  ctx.font = font(600, 34);
  ctx.fillText('MY MONTH', pad, 128);
  ctx.fillStyle = '#000';
  ctx.font = font(700, 76);
  ctx.fillText(d.label, pad, 210);

  // Big card: spent
  roundRect(ctx, pad - 8, 262, W - 2 * pad + 16, 330, 40);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.fillStyle = '#8e8e93';
  ctx.font = font(600, 34);
  ctx.fillText('Spent', pad + 40, 338);
  ctx.fillStyle = '#000';
  ctx.font = font(700, 112);
  ctx.fillText(fit(ctx, money(d.spent), W - 2 * pad - 80), pad + 40, 458);
  if (d.change !== null) {
    const up = d.change > 0;
    ctx.font = font(600, 34);
    ctx.fillStyle = up ? '#ff3b30' : '#34c759';
    ctx.fillText(`${up ? '▲' : '▼'} ${Math.abs(d.change)}% ${up ? 'more' : 'less'} than last month`, pad + 40, 530);
  }

  // Income and kept
  const half = (W - 2 * pad - 24) / 2;
  const tiles = [
    ['Income', money(d.income), '#34c759'],
    [d.kept >= 0 ? 'You kept' : 'Over by', money(Math.abs(d.kept)), d.kept >= 0 ? '#007aff' : '#ff3b30'],
  ];
  tiles.forEach(([label, value, color], i) => {
    const x = pad - 8 + i * (half + 24);
    roundRect(ctx, x, 620, half + 8, 170, 36);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.fillStyle = '#8e8e93';
    ctx.font = font(600, 30);
    ctx.fillText(label, x + 36, 680);
    ctx.fillStyle = color;
    ctx.font = font(700, 54);
    ctx.fillText(fit(ctx, value, half - 50), x + 36, 752);
  });

  // Where it went
  roundRect(ctx, pad - 8, 818, W - 2 * pad + 16, 420, 40);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.font = font(700, 38);
  ctx.fillText('Where it went', pad + 40, 884);
  const barX = pad + 40;
  const barW = W - 2 * pad - 80;
  let x = barX;
  roundRect(ctx, barX, 910, barW, 26, 13);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#e5e5ea';
  ctx.fillRect(barX, 910, barW, 26);
  for (const c of d.cats) {
    const w = Math.max(4, c.pct * barW);
    ctx.fillStyle = c.color;
    ctx.fillRect(x, 910, w, 26);
    x += w;
  }
  ctx.restore();
  d.cats.slice(0, 5).forEach((c, i) => {
    const y = 990 + i * 48;
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(barX + 12, y - 11, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = font(500, 32);
    ctx.fillText(fit(ctx, c.name, 470), barX + 40, y);
    ctx.textAlign = 'right';
    ctx.fillText(money(c.total), barX + barW - 110, y);
    ctx.fillStyle = '#8e8e93';
    ctx.fillText(`${Math.round(c.pct * 100)}%`, barX + barW, y);
    ctx.textAlign = 'left';
  });
  if (!d.cats.length) {
    ctx.fillStyle = '#8e8e93';
    ctx.font = font(500, 32);
    ctx.fillText('No spending this month', barX, 1000);
  }

  ctx.fillStyle = '#8e8e93';
  ctx.font = font(500, 28);
  const foot = d.biggest ? `Biggest: ${money(d.biggest.amount)} · ${d.biggest.note}` : `${d.count} transactions`;
  ctx.fillText(fit(ctx, foot, W - 2 * pad - 180), pad, 1298);
  ctx.textAlign = 'right';
  ctx.fillText('Expenses', W - pad, 1298);
  ctx.textAlign = 'left';
  return canvas.toDataURL('image/png');
}

/** Opens the picture for a month with Share and Save. */
export async function openMonthPicture(monthStart) {
  const d = monthData(monthStart);
  const handle = openSheet({
    size: 'large',
    className: 'photo-sheet',
    html: `
      <header class="sheet-header" data-drag>
        <span></span><h2 class="sheet-title">${esc(d.label)}</h2><button class="nav-btn strong mp-done">Done</button>
      </header>
      <div class="photo-view"><div class="empty">${icon('image-square')}Drawing…</div></div>
      <div class="mp-actions">
        <button class="btn" data-mp="share">${icon('share-network')} Share</button>
        <button class="btn secondary" data-mp="save">${icon('download-simple')} Save</button>
      </div>`,
  });
  $('.mp-done', handle.el).addEventListener('click', () => handle.close('done'));
  const dataUrl = await drawMonth(d);
  $('.photo-view', handle.el).innerHTML = `<img alt="${esc(d.label)} summary" src="${dataUrl}">`;
  const name = `expenses-${monthStart.slice(0, 7)}.png`;
  handle.el.addEventListener('click', async e => {
    const btn = e.target.closest('[data-mp]');
    if (!btn) return;
    const result = await native.sendImage(btn.dataset.mp, name, dataUrl);
    if (result.ok && btn.dataset.mp === 'save') toast('Saved', { iconName: 'check-circle' });
  });
}

/** In the first week of a month: a banner offering last month's picture (once). */
export function summaryBannerHTML() {
  const today = L.todayISO();
  if (Number(today.slice(8, 10)) > 7) return '';
  const last = L.addMonths(L.startOfMonth(today), -1);
  if (store.state.settings.summarySeen === last.slice(0, 7)) return '';
  if (!L.inRange(store.state.transactions, last, L.endOfMonth(last)).length) return '';
  const name = L.parseISO(last).toLocaleDateString('en-IN', { month: 'long' });
  return `<div class="card banner" data-month-picture="${last}" role="button" style="margin-top:4px">
    ${tile('image-square', 'purple', 'lg')}
    <div class="banner-text"><strong>Your ${esc(name)} in one picture</strong>See it, then share it on WhatsApp.</div>
    <button class="icon-btn" data-month-dismiss aria-label="Close">${icon('x')}</button>
  </div>`;
}

export function handleSummaryClick(e) {
  const banner = e.target.closest('[data-month-picture]');
  if (!banner) return false;
  store.setSetting('summarySeen', banner.dataset.monthPicture.slice(0, 7));
  if (!e.target.closest('[data-month-dismiss]')) openMonthPicture(banner.dataset.monthPicture);
  return true;
}
