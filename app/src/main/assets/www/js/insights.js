// The Insights tab, built the Hub way: one card that answers "how much did I spend?" (with the chart),
// number tiles, where it went, the biggest expenses, and every tool as a big tile with its own answer.
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
import { openNetWorth, openTax } from './worth.js';
import { openChallenges } from './easy.js';
import { openFamily, familyOn } from './family.js';
import { openFees, openRefunds, openCashback, openShopping, openDocuments, openYear, tipsHTML } from './more.js';

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
      body.innerHTML = `<div class="ju-card home-card"><div class="empty">${icon('chart-bar')}<strong>Nothing here yet</strong>No transactions in this ${s.kind}.
        <div><button class="ju-btn primary" data-ins-add>${icon('plus')} Add an Expense</button></div></div></div>`;
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
    const saved = t.income - t.expense;

    const biggest = inPeriod.filter(x => x.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 5);

    const per = s.kind === 'year' ? 'month' : 'day';
    const money = v => esc(store.money(v));
    const tile4 = (value, label, small, color) => `<div class="ju-tile money still"><b${color ? ` style="color:${color}"` : ''}>${value}</b><span>${esc(label)}</span><small>${small}</small></div>`;
    const card = (title, right, inner) => `<div class="ju-card home-card"><div class="head"><h2>${esc(title)}</h2>${right || ''}</div>${inner}</div>`;

    body.innerHTML = `
      <div class="ju-card ins-answer">
        <div class="ins-top">
          <div class="ju-eyebrow">${sel ? esc(sel.longLabel) : 'Total spent'}</div>
          ${!sel && change !== null ? `<span class="ju-pill ${change > 0 ? 'bad' : 'ok'}">${icon(change > 0 ? 'arrow-up' : 'arrow-down')} ${Math.abs(change)}%</span>` : ''}
        </div>
        <div class="big num">${money(sel ? sel.total : t.expense)}</div>
        <div class="ju-muted ju-small">${sel ? `Tap the bar again to see the whole ${s.kind}` : (change !== null ? `${change > 0 ? 'More' : 'Less'} than ${running ? `at this point ${PREVIOUS_LABEL[s.kind]}` : PREVIOUS_LABEL[s.kind]} (${money(prev.expense)})` : `Average ${money(average)} per ${unit}`)}</div>
        <div class="chart-wrap">${bars(buckets, { height: 160, selected: s.selected, average, highlight: nowIndex, formatAxis: v => store.money(v, { compact: true }) })}</div>
      </div>

      <div class="ju-tiles home-tiles">
        ${tile4(money(t.income), 'Income', t.income ? 'came in' : 'none added', 'var(--ok)')}
        ${tile4(money(t.expense), 'Spent', `${inPeriod.filter(x => x.type === 'expense').length} expenses`)}
        ${tile4(money(saved), 'Kept', t.income ? (saved >= 0 ? `${Math.round((saved / t.income) * 100)}% of income` : 'more than earned') : 'add your income', saved < 0 ? 'var(--bad)' : '')}
        ${tile4(money(average), `Per ${per}`, 'on average')}
      </div>

      ${cats.length ? card('Where it went', '', `
        <div class="ins-donut">${donut(segments, { center: `<small>Spent</small><strong>${esc(store.money(t.expense, { compact: t.expense >= 10000000 }))}</strong>` })}</div>
        <div class="legend">
          ${shownCats.map(r => {
            const c = store.category(r.categoryId);
            return `<button class="legend-row" data-cat="${esc(r.categoryId)}" style="text-align:left;width:100%">
              <span class="legend-dot" style="--c:var(--${esc(c.color)})"></span>
              <span class="legend-name">${esc(c.name)}</span>
              <span class="legend-value">${money(r.total)}</span>
              <span class="legend-pct">${Math.round((r.total / t.expense) * 100)}%</span>
            </button>`;
          }).join('')}
          ${restTotal ? `<div class="legend-row"><span class="legend-dot" style="--c:var(--gray)"></span><span class="legend-name">${cats.length - 8} more</span><span class="legend-value">${money(restTotal)}</span><span class="legend-pct">${Math.round((restTotal / t.expense) * 100)}%</span></div>` : ''}
        </div>
        <div class="ju-muted ju-small" style="margin-top:8px">Tap a category to see its transactions.</div>`) : ''}

      ${biggest.length ? card('Biggest expenses', '', `<div class="list">${biggest.map(x => txRow(x, { swipe: false, showDate: true })).join('')}</div>`) : ''}

      ${s.kind === 'month' ? `<div class="ins-share"><button class="ju-btn" data-picture="${range.start}">${icon('image-square')} Share ${esc(L.parseISO(range.start).toLocaleDateString('en-IN', { month: 'long' }))} as a Picture</button></div>` : ''}`;
    body.insertAdjacentHTML('beforeend', extrasHTML());
  }

  /** Regular payments found in your spending, and every tool as a big tile that answers its own question. */
  function extrasHTML() {
    const st = store.state;
    const subs = L.detectSubscriptions(st.transactions);
    const perMonth = subs.reduce((sum, x) => sum + x.perMonth, 0);
    const tags = L.tagSummaries(st.transactions).length;
    const people = L.personBalances(st.transactions).filter(p => p.balance).length;
    const bills = st.bills.filter(b => !b.paid).length;
    const taxTotal = L.taxSummary(st.transactions, id => store.category(id).name).reduce((sum, x) => sum + x.total, 0);
    const unclaimed = st.transactions.filter(t => t.business && t.type === 'expense' && !t.claimed).length;
    const warranties = L.warranties(st.transactions).length;
    const n = (count, one, many, none) => (count ? `${count} ${count === 1 ? one : many}` : none);
    const tools = [
      ['worth', 'scales', 'teal', 'Net Worth', store.money(L.netWorth(st).total)],
      ['bills', 'receipt', 'orange', 'Bills', n(bills, 'to pay', 'to pay', 'All paid')],
      ['tax', 'percent', 'green', 'Tax Saving', taxTotal ? `${store.money(taxTotal)} this year` : 'Nothing yet'],
      ['goals', 'piggy-bank', 'pink', 'Goals', n(st.goals.length, 'goal', 'goals', 'Save for something')],
      ['emis', 'bank', 'indigo', 'Loans & EMIs', n(st.emis.length, 'running', 'running', 'None')],
      ['people', 'hand-coins', 'teal', 'Lent & Borrowed', n(people, 'person', 'people', 'All settled')],
      ['trips', 'airplane-tilt', 'cyan', 'Trips & Events', n(tags, 'tag', 'tags', 'None yet')],
      ['calendar', 'calendar-dots', 'red', 'Calendar', 'Day by day'],
      ['challenges', 'flame', 'orange', 'No-Spend Challenges', n(st.challenges.length, 'running', 'running', 'Start one')],
      ['claims', 'briefcase', 'brown', 'Business Expenses', n(unclaimed, 'to claim', 'to claim', 'All claimed')],
      ['warranties', 'shield-check', 'green', 'Warranties', n(warranties, 'active', 'active', 'None')],
      ['family', 'users', 'blue', 'Family', familyOn() ? `Sharing as ${st.settings.memberName}` : 'Off'],
      ['shopping', 'shopping-cart-simple', 'green', 'Shopping List', n(st.shopping.length, 'to buy', 'to buy', 'Nothing to buy')],
      ['documents', 'files', 'indigo', 'Documents & Renewals', (() => { const d = st.documents.filter(x => L.docStatus(x).expired || L.docStatus(x).soon).length; return d ? `${d} to renew soon` : n(st.documents.length, 'kept', 'kept', 'Add insurance, PUC…'); })()],
      ['refunds', 'arrow-u-up-left', 'orange', 'Refunds', (() => { const w = L.refunds(st.transactions).filter(x => !x.status.done).length; return w ? `${w} waiting` : 'None waiting'; })()],
      ['cashback', 'gift', 'pink', 'Cashback & Points', (() => { const c = L.cashbackSummary(st.transactions, st.sms.points); return c.total ? `${store.money(c.total)} this year` : 'None yet'; })()],
      ['fees', 'bank', 'gray', 'Bank Charges', (() => { const f = L.feesSummary(st.transactions); return f.total ? `${store.money(f.total)} this year` : 'None this year'; })()],
      ['year', 'calendar-check', 'red', 'Your Year', `${L.todayISO().slice(0, 4)} so far`],
    ];
    return `
      ${subs.length ? `<div class="ju-card home-card"><div class="head"><h2>Regular payments</h2></div>
        <div class="list">${subs.slice(0, 8).map(x => {
          const c = store.category(x.categoryId);
          return `<div class="row">${tile(c.icon, c.color, 'lg')}<div class="row-main"><div class="row-text">
            <div class="row-title">${esc(x.name)}</div>
            <div class="row-sub">${esc(FREQUENCY_SHORT[x.frequency])} · next ${esc(L.shortDate(x.nextDate))}</div>
          </div><span class="tx-amount">${esc(store.money(x.amount))}</span></div></div>`;
        }).join('')}</div>
        <div class="ju-muted ju-small" style="margin-top:8px">Found in your spending: the same payee, a steady amount, at a regular gap. About ${esc(store.money(perMonth))} a month in all.</div>
      </div>` : ''}
      ${tipsHTML()}
      <div class="ju-group ins-tools-head"><span>Tools</span></div>
      <div class="ju-tiles tool-tiles">
        ${tools.map(([key, ic, color, label, small]) => `<button class="ju-tile tool-tile" data-open="${key}">${tile(ic, color, 'lg')}<span>${esc(label)}</span><small>${esc(small)}</small></button>`).join('')}
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
      ({ trips: openTrips, people: openPeople, bills: openBills, calendar: openCalendar, goals: openGoals, emis: openEmis, warranties: openWarranties, claims: openClaims, worth: openNetWorth, tax: openTax, challenges: openChallenges, family: openFamily, shopping: openShopping, documents: openDocuments, refunds: openRefunds, cashback: openCashback, fees: openFees, year: openYear })[open.dataset.open]();
      return;
    }
    if (e.target.closest('[data-ins-add]')) { openEditor(); return; }
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
