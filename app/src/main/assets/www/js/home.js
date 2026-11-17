// The Summary tab: this month at a glance.
import { store } from './store.js';
import * as L from './logic.js';
import { esc, icon, tile, bindSwipeRows, toast, alert } from './ui.js';
import { stackBar } from './charts.js';
import { txRow } from './rows.js';
import { messagesCardHTML, bindFindingRows, onRowTap, onRowDelete } from './messages.js';
import { billsCardHTML, handleBillClick } from './bills.js';
import { peopleCardHTML, handlePeopleClick } from './people.js';
import { tripBannerHTML, handleTripClick } from './trips.js';
import { summaryBannerHTML, handleSummaryClick } from './summary.js';
import { openAccounts } from './manage.js';
import { goalsCardHTML, handleGoalClick } from './plans.js';
import { native } from './native.js';
import {
  privacyButtonHTML, togglePrivacy, quickAddsHTML, doQuickAdd, openQuickAdds, streaksHTML, openChallenges,
  checklistHTML, hideChecklist,
} from './easy.js';

/** "Heads up": a category well above last month, heading over budget, an unusually big spend. */
function alertsHTML() {
  const st = store.state;
  const alerts = L.computeAlerts(
    { transactions: st.transactions, budgets: st.budgets, categoryName: id => store.category(id).name },
    v => store.money(v),
  ).filter(a => !st.settings.dismissed[a.key]);
  if (!alerts.length) return '';
  return `
    <div class="ju-card home-card">
      <div class="head"><h2>Heads Up</h2></div>
      <div class="list">
        ${alerts.map(a => `<div class="row heads-up">${tile(a.icon, a.color)}<div class="row-main">
          <span class="heads-up-text">${esc(a.text)}</span>
          <button class="icon-btn" data-dismiss="${esc(a.key)}" aria-label="Dismiss">${icon('x')}</button></div></div>`).join('')}
      </div>
    </div>`;
}

/** Bank balances from the newest bank messages (no typing needed). */
function balancesHTML() {
  const list = Object.values(store.state.sms.balances || {}).sort((a, b) => b.time - a.time).slice(0, 4);
  if (!list.length) return '';
  return `
    <div class="ju-card home-card">
      <div class="head"><h2>Bank Balances</h2><button class="ju-btn ghost sm" data-open-accounts>Accounts</button></div>
      <div class="list">
        ${list.map(b => {
          const when = new Date(b.time);
          const date = L.toISO(when);
          const limit = b.kind === 'limit';
          return `<div class="row">${tile(limit ? 'credit-card' : 'bank', limit ? 'orange' : 'blue', 'lg')}<div class="row-main"><div class="row-text">
            <div class="row-title">${esc([b.bank, b.last4 ? `••${b.last4}` : ''].filter(Boolean).join(' '))}</div>
            <div class="row-sub">${limit ? 'Available limit' : 'Balance'} · ${esc(L.shortDate(date))}, ${esc(when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }))}</div>
          </div><span class="tx-amount">${esc(store.money(b.amount))}</span></div></div>`;
        }).join('')}
      </div>
      <div class="ju-small ju-muted" style="margin-top:6px">From your bank’s latest messages.</div>
    </div>`;
}

export function createHome(root, { openEditor, goTo, openBudgets, quickStartStep }) {
  const canScan = () => native.canScan();
  const canSpeak = () => native.canListen();

  /** The answer first: one dark card with this month's spending, and the everyday buttons. */
  function heroHTML(t, monthName) {
    const st = store.state;
    const budget = st.budgets.monthly;
    const pct = budget ? t.expense / budget : 0;
    const amountText = store.money(t.expense);
    let line;
    if (!budget) line = `spent in ${esc(monthName)} · <button class="hero-link" data-act="budget">Set a budget</button>`;
    else if (t.expense <= budget) line = `spent in ${esc(monthName)} · <strong>${esc(store.money(budget - t.expense))}</strong> left of ${esc(store.money(budget))}`;
    else line = `spent in ${esc(monthName)} · <strong class="over">${esc(store.money(t.expense - budget))}</strong> over your ${esc(store.money(budget))} budget`;
    const safe = L.safeToSpend(st);
    const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    return `
      <div class="ju-hero money-hero">
        <div class="hero-top"><div class="ju-eyebrow">${esc(date)}</div>${privacyButtonHTML()}</div>
        <div class="big ${amountText.length > 11 ? 'long' : ''}">${esc(amountText)}</div>
        <div class="line">${line}</div>
        ${budget ? `<div class="ju-bar" role="img" aria-label="${Math.round(pct * 100)}% of your budget used"><i style="width:${Math.min(100, pct * 100)}%;background:${pct >= 1 ? 'var(--bad)' : pct >= 0.8 ? 'var(--warn)' : 'var(--ok)'}"></i></div>` : ''}
        ${safe ? `<button class="safe ${safe.perDay ? '' : 'none'}" data-safe>${icon('hand-coins')}<span>Safe to spend today</span><strong>${esc(store.money(safe.perDay))}</strong></button>` : ''}
        <div class="acts">
          <button class="ju-btn accent" data-act="add">${icon('plus')} Add</button>
          ${canScan() ? `<button class="ju-btn soft" data-act="scan">${icon('scan')} Scan Bill</button>` : ''}
          ${canSpeak() ? `<button class="ju-btn soft" data-act="speak">${icon('microphone')} Speak</button>` : ''}
        </div>
      </div>`;
  }

  /** A card with a heading and rows (kit: ju-card). */
  const cardHTML = (title, buttonHTML, body) => `
    <div class="ju-card home-card"><div class="head"><h2>${esc(title)}</h2>${buttonHTML || ''}</div>${body}</div>`;

  function render() {
    const st = store.state;
    const today = L.todayISO();
    const monthStart = L.startOfMonth(today);
    const month = L.inRange(st.transactions, monthStart, L.endOfMonth(today));
    const t = L.totals(month);
    const monthName = L.parseISO(today).toLocaleDateString('en-IN', { month: 'long' });

    if (!st.transactions.length) {
      root.innerHTML = `
        ${heroHTML(t, monthName)}
        ${checklistHTML()}
        ${quickAddsHTML()}
        ${tripBannerHTML()}
        ${messagesCardHTML()}
        ${billsCardHTML()}
        ${balancesHTML()}
        ${peopleCardHTML()}`;
      return;
    }

    // Number tiles
    const todaySpent = L.totals(month.filter(x => x.date === today)).expense;
    const weekStart = L.startOfWeek(today);
    const weekSpent = L.totals(L.inRange(st.transactions, weekStart, today)).expense;
    const daysSoFar = L.daysBetween(monthStart, today) + 1;
    const dailyAvg = Math.round(t.expense / daysSoFar / 100) * 100;
    const tile4 = (value, label, small, color) => `<div class="ju-tile money still"><b${color ? ` style="color:${color}"` : ''}>${esc(value)}</b><span>${esc(label)}</span><small>${esc(small)}</small></div>`;

    // Categories
    const cats = L.byCategory(month);
    const top = cats.slice(0, 4);
    const rest = cats.slice(4).reduce((s, r) => s + r.total, 0);
    const segments = top.map(r => ({ value: r.total, color: store.category(r.categoryId).color }));
    if (rest) segments.push({ value: rest, color: 'gray' });

    // Category budgets that are close or over
    const catBudgets = Object.entries(st.budgets.categories)
      .map(([id, limit]) => ({ id, limit, used: (cats.find(r => r.categoryId === id) || { total: 0 }).total }))
      .filter(b => store.state.categories.some(c => c.id === b.id))
      .sort((a, b) => b.used / b.limit - a.used / a.limit);

    // Upcoming repeats in the next 14 days
    const soon = L.addDays(today, 14);
    const upcoming = st.recurring.filter(r => r.active && r.nextDate <= soon).sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1)).slice(0, 3);

    const recent = L.sortTransactions(st.transactions).slice(0, 6);

    root.innerHTML = `
      ${tripBannerHTML()}
      ${summaryBannerHTML()}
      ${heroHTML(t, monthName)}
      ${quickAddsHTML()}

      <div class="ju-tiles home-tiles">
        ${tile4(store.money(todaySpent), 'Today', `daily avg ${store.money(dailyAvg)}`)}
        ${tile4(store.money(weekSpent), 'This week', 'since Monday')}
        ${tile4(store.money(t.income), 'Income', `in ${monthName}`, 'var(--ok)')}
        ${tile4(store.money(t.net), 'Balance', 'income − spent', t.net < 0 ? 'var(--bad)' : '')}
      </div>

      ${streaksHTML()}
      ${checklistHTML()}
      ${alertsHTML()}
      ${messagesCardHTML()}
      ${billsCardHTML()}

      ${top.length ? cardHTML('Where it went', `<button class="ju-btn ghost sm" data-act="insights">Insights ${icon('caret-right')}</button>`, `
        <div style="margin-top:10px">${stackBar(segments)}</div>
        <div class="legend">
          ${top.map(r => {
            const c = store.category(r.categoryId);
            return `<div class="legend-row"><span class="legend-dot" style="--c:var(--${esc(c.color)})"></span><span class="legend-name">${esc(c.name)}</span><span class="legend-value">${esc(store.money(r.total))}</span><span class="legend-pct">${Math.round((r.total / t.expense) * 100)}%</span></div>`;
          }).join('')}
        </div>`) : ''}

      ${balancesHTML()}
      ${peopleCardHTML()}
      ${goalsCardHTML()}

      ${catBudgets.length ? cardHTML('Budgets', `<button class="ju-btn ghost sm" data-act="budget">Edit</button>`, `
        <div class="list">
          ${catBudgets.map(b => {
            const c = store.category(b.id);
            const p = b.used / b.limit;
            const color = p >= 1 ? 'bad' : p >= 0.8 ? 'warn' : 'ok';
            return `<div class="row">${tile(c.icon, c.color)}<div class="row-main"><div class="row-text">
              <div style="display:flex;justify-content:space-between;gap:8px"><span class="row-title">${esc(c.name)}</span><span class="row-value" style="font-size:14px">${esc(store.money(b.used))} / ${esc(store.money(b.limit))}</span></div>
              <div class="ju-bar" style="margin-top:7px"><i style="width:${Math.min(100, p * 100)}%;background:var(--${color})"></i></div>
            </div></div></div>`;
          }).join('')}
        </div>`) : ''}

      ${upcoming.length ? cardHTML('Coming up', '', `
        <div class="list">
          ${upcoming.map(r => {
            const c = store.category(r.categoryId);
            return `<div class="row">${tile(c.icon, c.color, 'lg')}<div class="row-main"><div class="row-text">
              <div class="row-title">${esc(r.note || c.name)}</div><div class="row-sub">${icon('repeat')} ${esc(L.shortDate(r.nextDate))}</div></div>
              <span class="tx-amount ${r.type}">${esc(r.type === 'income' ? store.money(r.amount, { sign: true }) : store.money(r.amount))}</span></div></div>`;
          }).join('')}
        </div>`) : ''}

      ${cardHTML('Recent', `<button class="ju-btn ghost sm" data-act="activity">See All ${icon('caret-right')}</button>`, `<div class="list tx-list">${recent.map(x => txRow(x)).join('')}</div>`)}`;
  }

  bindFindingRows(root);
  root.addEventListener('click', e => {
    if (handleBillClick(e) || handlePeopleClick(e) || handleTripClick(e) || handleSummaryClick(e) || handleGoalClick(e)) return;
    if (e.target.closest('[data-privacy]')) { togglePrivacy(); render(); return; }
    const quick = e.target.closest('[data-quick]');
    if (quick) { doQuickAdd(quick.dataset.quick); return; }
    if (e.target.closest('[data-quick-edit]')) { openQuickAdds(); return; }
    if (e.target.closest('[data-open-challenges]')) { openChallenges(); return; }
    if (e.target.closest('[data-qs-hide]')) { hideChecklist(); return; }
    const qs = e.target.closest('[data-qs]');
    if (qs) { if (quickStartStep) quickStartStep(qs.dataset.qs); return; }
    if (e.target.closest('[data-safe]')) {
      const safe = L.safeToSpend(store.state);
      if (safe) alert({
        title: `${store.money(safe.perDay)} a day`,
        message: `Budget ${store.money(safe.budget)}\n− spent so far ${store.money(safe.spent)}\n− bills still due ${store.money(safe.billsLeft)}\n− repeating payments to come ${store.money(safe.repeatsLeft)}\n= ${store.money(Math.max(0, safe.left))} for the ${safe.daysLeft} day${safe.daysLeft === 1 ? '' : 's'} left`,
        steps: true,
      });
      return;
    }
    const dismiss = e.target.closest('[data-dismiss]');
    if (dismiss) { store.dismissAlert(dismiss.dataset.dismiss); return; }
    if (e.target.closest('[data-open-accounts]')) { openAccounts(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const name = act.dataset.act;
    if (name === 'add') openEditor();
    if (name === 'scan') openEditor(null, { scan: true });
    if (name === 'speak') openEditor(null, { speak: true });
    if (name === 'activity') goTo('activity');
    if (name === 'insights') goTo('insights');
    if (name === 'budget') openBudgets();
  });

  bindSwipeRows(root, {
    onTap: id => {
      if (onRowTap(id)) return;
      const tx = store.state.transactions.find(t => t.id === id);
      if (tx) openEditor(tx);
    },
    onDelete: id => {
      if (onRowDelete(id)) return;
      const removed = store.deleteTransaction(id);
      if (removed) toast('Transaction deleted', { actionText: 'Undo', duration: 6000, onAction: () => store.restoreTransaction(removed) });
    },
  });

  return { render };
}
