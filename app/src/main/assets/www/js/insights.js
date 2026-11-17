// The Insights tab: spending over time, by category, income vs spending, biggest expenses.
import { store } from './store.js';
import * as L from './logic.js';
import { $, esc, icon, tile, segmented, bindSegmented, haptic } from './ui.js';
import { bars, donut } from './charts.js';
import { txRow } from './rows.js';
import { openTrips } from './trips.js';
import { openPeople } from './people.js';
import { openBills } from './bills.js';
import { openMonthPicture } from './summary.js';
import { openGoals, openEmis, openWarranties } from './plans.js';
import { openCalendar } from './calendar.js';
import { openClaims } from './claims.js';

const FREQUENCY_SHORT = { weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

const KIND_OPTIONS = [{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }];
const PREVIOUS_LABEL = { week: 'last week', month: 'last month', year: 'last year' };

export function createInsights(root, { openEditor, showActivity }) {
  const s = { kind: 'month', offset: 0, selected: -1 };

  root.innerHTML = `
    <div class="toolbar">${segmented(KIND_OPTIONS, s.kind, 'kind')}</div>
    <div class="period-nav">
      <button class="icon-btn" data-step="-1" aria-label="Previous">${icon('caret-left')}</button>
      <strong class="period-label"></strong>
      <button class="icon-btn" data-step="1" aria-label="Next">${icon('caret-right')}</button>
    </div>
    <div class="insights-body"></div>`;

  function render() {
    const today = L.todayISO();
    const range = L.periodRange(s.kind, s.offset, today);
    const prevRange = L.periodRange(s.kind, s.offset - 1, today);
    const all = store.state.transactions;
    const inPeriod = L.inRange(all, range.start, range.end);
    const t = L.totals(inPeriod);
    // While a period is still running, compare with the same stretch of the previous one
    const running = range.start <= today && today <= range.end;
    const prevEnd = !running ? prevRange.end
      : s.kind === 'year' ? L.addMonths(today, -12)
      : [L.addDays(prevRange.start, L.daysBetween(range.start, today)), prevRange.end].sort()[0];
    const prev = L.totals(L.inRange(all, prevRange.start, prevEnd));

    $('.period-label', root).textContent = L.periodLabel(s.kind, range, today);
    $('[data-step="1"]', root).disabled = s.offset >= 0;
    $('[data-step="1"]', root).style.opacity = s.offset >= 0 ? 0.3 : 1;

    const body = $('.insights-body', root);
    if (!inPeriod.length) {
      body.innerHTML = `<div class="card"><div class="empty">${icon('chart-bar')}<strong>Nothing here yet</strong>No transactions in this ${s.kind}.</div></div>`;
      body.insertAdjacentHTML('beforeend', extrasHTML());
      return;
    }

    // Spending over time
    const buckets = L.seriesFor(s.kind, range, all);
    const current = range.start <= today && today <= range.end;
    const elapsed = current
      ? (s.kind === 'year' ? Number(today.slice(5, 7)) : L.daysBetween(range.start, today) + 1)
      : buckets.length;
    const average = Math.round(t.expense / Math.max(1, elapsed) / 100) * 100;
    const nowIndex = current ? (s.kind === 'year' ? Number(today.slice(5, 7)) - 1 : L.daysBetween(range.start, today)) : -1;
    if (s.selected >= buckets.length) s.selected = -1;
    const sel = s.selected >= 0 ? buckets[s.selected] : null;
    const change = L.percentChange(t.expense, prev.expense);
    const unit = s.kind === 'year' ? 'month' : 'day';

    // Categories
    const cats = L.byCategory(inPeriod);
    const shownCats = cats.slice(0, 8);
    const restTotal = cats.slice(8).reduce((sum, r) => sum + r.total, 0);
    const segments = shownCats.map(r => ({ value: r.total, color: store.category(r.categoryId).color }));
    if (restTotal) segments.push({ value: restTotal, color: 'gray' });

    // Income vs spending
    const maxSide = Math.max(t.income, t.expense, 1);
    const saved = t.income - t.expense;

    const biggest = inPeriod.filter(x => x.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 5);

    body.innerHTML = `
      <div class="card">
        <div class="chart-readout">
          <div>
            <div class="chart-readout-label">${sel ? esc(sel.longLabel) : 'Total spent'}</div>
            <div class="chart-readout-value">${esc(store.money(sel ? sel.total : t.expense))}</div>
          </div>
          ${!sel && change !== null ? `<span class="delta ${change > 0 ? 'up' : 'down'}">${icon(change > 0 ? 'arrow-up' : 'arrow-down')}${Math.abs(change)}%</span>` : ''}
        </div>
        <div class="hero-sub" style="font-size:13px">${sel ? `Tap the bar again to see the whole ${s.kind}` : (change !== null ? `${change > 0 ? 'More' : 'Less'} than ${running ? `at this point ${PREVIOUS_LABEL[s.kind]}` : PREVIOUS_LABEL[s.kind]} (${esc(store.money(prev.expense))})` : `Average ${esc(store.money(average))} per ${unit}`)}</div>
        <div class="chart-wrap">${bars(buckets, { height: 160, selected: s.selected, average, highlight: nowIndex, formatAxis: v => store.money(v, { compact: true }) })}</div>
      </div>

      ${cats.length ? `
      <div class="card">
        <div class="card-label">By category</div>
        ${donut(segments, { center: `<small>Spent</small><strong>${esc(store.money(t.expense, { compact: t.expense >= 10000000 }))}</strong>` })}
        <div class="legend">
          ${shownCats.map(r => {
            const c = store.category(r.categoryId);
            return `<button class="legend-row" data-cat="${esc(r.categoryId)}" style="text-align:left;width:100%">
              <span class="legend-dot" style="--c:var(--${esc(c.color)})"></span>
              <span class="legend-name">${esc(c.name)}</span>
              <span class="legend-value">${esc(store.money(r.total))}</span>
              <span class="legend-pct">${Math.round((r.total / t.expense) * 100)}%</span>
            </button>`;
          }).join('')}
          ${restTotal ? `<div class="legend-row"><span class="legend-dot" style="--c:var(--gray)"></span><span class="legend-name">${cats.length - 8} more</span><span class="legend-value">${esc(store.money(restTotal))}</span><span class="legend-pct">${Math.round((restTotal / t.expense) * 100)}%</span></div>` : ''}
        </div>
      </div>` : ''}

      <div class="card">
        <div class="card-label">Income vs spending</div>
        <div style="display:grid;gap:12px;margin-top:14px">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:15px;margin-bottom:6px"><span>Income</span><strong class="num">${esc(store.money(t.income))}</strong></div>
            <div class="progress" style="height:10px;border-radius:5px;--c:var(--green)"><span style="width:${(t.income / maxSide) * 100}%"></span></div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:15px;margin-bottom:6px"><span>Spending</span><strong class="num">${esc(store.money(t.expense))}</strong></div>
            <div class="progress" style="height:10px;border-radius:5px;--c:var(--orange)"><span style="width:${(t.expense / maxSide) * 100}%"></span></div>
          </div>
        </div>
        <div class="hero-sub" style="margin-top:12px">${t.income
          ? (saved >= 0
            ? `You kept <strong style="color:var(--green)">${esc(store.money(saved))}</strong> — ${Math.round((saved / t.income) * 100)}% of your income.`
            : `You spent <strong style="color:var(--red)">${esc(store.money(-saved))}</strong> more than you earned.`)
          : 'Add income (like your salary) to see how much you keep.'}</div>
      </div>

      ${biggest.length ? `
      <div class="section">
        <div class="section-title"><h2>Biggest expenses</h2></div>
        <div class="list">${biggest.map(x => txRow(x, { swipe: false, showDate: true })).join('')}</div>
      </div>` : ''}

      ${s.kind === 'month' ? `<div style="padding:4px 16px 4px"><button class="btn secondary" data-picture="${range.start}">${icon('image-square')} Share ${esc(L.parseISO(range.start).toLocaleDateString('en-IN', { month: 'long' }))} as a Picture</button></div>` : ''}`;
    body.insertAdjacentHTML('beforeend', extrasHTML());
  }

  /** Regular payments found in your spending, and links to trips, people and bills. */
  function extrasHTML() {
    const subs = L.detectSubscriptions(store.state.transactions);
    const perMonth = subs.reduce((sum, x) => sum + x.perMonth, 0);
    const tags = L.tagSummaries(store.state.transactions).length;
    const people = L.personBalances(store.state.transactions).filter(p => p.balance).length;
    const bills = store.state.bills.filter(b => !b.paid).length;
    return `
      ${subs.length ? `
      <div class="section" style="margin-top:12px">
        <div class="section-title"><h2>Regular payments</h2></div>
        <div class="list">${subs.slice(0, 8).map(x => {
          const c = store.category(x.categoryId);
          return `<div class="row">${tile(c.icon, c.color, 'lg')}<div class="row-main"><div class="row-text">
            <div class="row-title">${esc(x.name)}</div>
            <div class="row-sub">${esc(FREQUENCY_SHORT[x.frequency])} · next ${esc(L.shortDate(x.nextDate))}</div>
          </div><span class="tx-amount">${esc(store.money(x.amount))}</span></div></div>`;
        }).join('')}</div>
        <div class="section-footer">Found in your spending: the same payee, a steady amount, at a regular gap. About ${esc(store.money(perMonth))} a month in all.</div>
      </div>` : ''}
      <div class="section" style="margin-top:12px">
        <div class="list">
          <button class="row tap" data-open="trips">${tile('airplane-tilt', 'cyan')}<div class="row-main"><span class="row-title" style="flex:1">Trips &amp; Events</span>${tags ? `<span class="row-value">${tags}</span>` : ''}<i class="ph ph-caret-right row-chevron"></i></div></button>
          <button class="row tap" data-open="people">${tile('hand-coins', 'teal')}<div class="row-main"><span class="row-title" style="flex:1">Lent &amp; Borrowed</span>${people ? `<span class="row-value">${people}</span>` : ''}<i class="ph ph-caret-right row-chevron"></i></div></button>
          <button class="row tap" data-open="calendar">${tile('calendar-dots', 'red')}<div class="row-main"><span class="row-title" style="flex:1">Calendar</span><i class="ph ph-caret-right row-chevron"></i></div></button>
          <button class="row tap" data-open="goals">${tile('piggy-bank', 'pink')}<div class="row-main"><span class="row-title" style="flex:1">Goals</span>${store.state.goals.length ? `<span class="row-value">${store.state.goals.length}</span>` : ''}<i class="ph ph-caret-right row-chevron"></i></div></button>
          <button class="row tap" data-open="emis">${tile('bank', 'indigo')}<div class="row-main"><span class="row-title" style="flex:1">Loans &amp; EMIs</span>${store.state.emis.length ? `<span class="row-value">${store.state.emis.length}</span>` : ''}<i class="ph ph-caret-right row-chevron"></i></div></button>
          <button class="row tap" data-open="warranties">${tile('shield-check', 'green')}<div class="row-main"><span class="row-title" style="flex:1">Warranties</span><i class="ph ph-caret-right row-chevron"></i></div></button>
          <button class="row tap" data-open="claims">${tile('briefcase', 'brown')}<div class="row-main"><span class="row-title" style="flex:1">Business Expenses</span><i class="ph ph-caret-right row-chevron"></i></div></button>
          <button class="row tap" data-open="bills">${tile('receipt', 'orange')}<div class="row-main"><span class="row-title" style="flex:1">Bills</span>${bills ? `<span class="row-value">${bills}</span>` : ''}<i class="ph ph-caret-right row-chevron"></i></div></button>
        </div>
      </div>`;
  }

  bindSegmented(root, (name, value) => {
    if (name !== 'kind') return;
    s.kind = value;
    s.offset = 0;
    s.selected = -1;
    render();
  });

  root.addEventListener('click', e => {
    const open = e.target.closest('[data-open]');
    if (open) {
      ({ trips: openTrips, people: openPeople, bills: openBills, calendar: openCalendar, goals: openGoals, emis: openEmis, warranties: openWarranties, claims: openClaims })[open.dataset.open]();
      return;
    }
    const picture = e.target.closest('[data-picture]');
    if (picture) { openMonthPicture(picture.dataset.picture); return; }
    const step = e.target.closest('[data-step]');
    if (step && !step.disabled) {
      s.offset = Math.min(0, s.offset + Number(step.dataset.step));
      s.selected = -1;
      haptic('selection');
      render();
      return;
    }
    const bar = e.target.closest('.bar-col');
    if (bar) {
      const i = Number(bar.dataset.i);
      s.selected = s.selected === i ? -1 : i;
      haptic('selection');
      render();
      return;
    }
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      const range = L.periodRange(s.kind, s.offset);
      showActivity({
        categoryId: cat.dataset.cat,
        type: 'expense',
        period: { key: 'custom', label: L.periodLabel(s.kind, range).replace('This Week · ', ''), start: range.start, end: range.end },
      });
      return;
    }
    const row = e.target.closest('.tx-row');
    if (row) {
      const tx = store.state.transactions.find(x => x.id === row.dataset.id);
      if (tx) openEditor(tx);
    }
  });

  return { render };
}
