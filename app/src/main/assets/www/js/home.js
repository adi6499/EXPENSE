// The Summary tab: this month at a glance.
import { store } from './store.js';
import * as L from './logic.js';
import { esc, icon, tile, bindSwipeRows, toast } from './ui.js';
import { ring, stackBar } from './charts.js';
import { txRow } from './rows.js';

export function createHome(root, { openEditor, goTo, openBudgets }) {
  function render() {
    const st = store.state;
    const today = L.todayISO();
    const monthStart = L.startOfMonth(today);
    const month = L.inRange(st.transactions, monthStart, L.endOfMonth(today));
    const t = L.totals(month);
    const monthName = L.parseISO(today).toLocaleDateString('en-IN', { month: 'long' });

    if (!st.transactions.length) {
      root.innerHTML = `
        <div class="card fade-in" style="margin-top:4px">
          <div class="empty" style="padding:24px 12px 12px">
            ${icon('wallet', true)}
            <strong>Start tracking</strong>
            Tap the blue <b>+</b> button whenever you spend or receive money. It takes two seconds.
            <div><button class="btn" data-act="add">${icon('plus')} Add your first expense</button></div>
          </div>
        </div>
        ${st.budgets.monthly ? '' : budgetPrompt()}`;
      return;
    }

    // Budget ring
    const budget = st.budgets.monthly;
    const pct = budget ? t.expense / budget : 0;
    const ringColor = pct >= 1 ? 'var(--red)' : pct >= 0.8 ? 'var(--orange)' : 'var(--green)';
    const amountText = store.money(t.expense);
    let budgetLine;
    if (!budget) budgetLine = `<button class="link" data-act="budget" style="font-size:15px">Set a monthly budget</button>`;
    else if (t.expense <= budget) budgetLine = `<strong class="num">${esc(store.money(budget - t.expense))}</strong> left of ${esc(store.money(budget))}`;
    else budgetLine = `<strong class="num" style="color:var(--red)">${esc(store.money(t.expense - budget))}</strong> over your ${esc(store.money(budget))} budget`;

    // Quick stats
    const todaySpent = L.totals(month.filter(x => x.date === today)).expense;
    const weekStart = L.startOfWeek(today);
    const weekSpent = L.totals(L.inRange(st.transactions, weekStart, today)).expense;
    const daysSoFar = L.daysBetween(monthStart, today) + 1;
    const dailyAvg = Math.round(t.expense / daysSoFar / 100) * 100;

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
      <div class="card" style="margin-top:4px">
        <div class="hero">
          <div class="hero-main">
            <div class="card-label">Spent in ${esc(monthName)}</div>
            <div class="hero-amount ${amountText.length > 11 ? 'size-m' : ''}">${esc(amountText)}</div>
            <div class="hero-sub">${budgetLine}</div>
          </div>
          ${budget ? `<div class="hero-ring">${ring(pct, { size: 76, stroke: 10, color: ringColor })}<div class="hero-ring-label">${Math.round(pct * 100)}%</div></div>` : ''}
        </div>
        <div class="split">
          <div><div class="split-label">${icon('arrow-down')} Income</div><div class="split-value" style="color:var(--green)">${esc(store.money(t.income))}</div></div>
          <div><div class="split-label">${icon('scales')} Balance</div><div class="split-value" style="color:${t.net < 0 ? 'var(--red)' : 'var(--label)'}">${esc(store.money(t.net))}</div></div>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><div class="stat-label">Today</div><div class="stat-value">${esc(store.money(todaySpent))}</div></div>
        <div class="stat"><div class="stat-label">This week</div><div class="stat-value">${esc(store.money(weekSpent))}</div></div>
        <div class="stat"><div class="stat-label">Daily avg</div><div class="stat-value">${esc(store.money(dailyAvg))}</div></div>
      </div>

      ${top.length ? `
      <div class="card" data-act="insights" role="button">
        <div class="card-label" style="justify-content:space-between"><span>Where it went</span><span class="link" style="font-size:15px;font-weight:500">Insights ${icon('caret-right')}</span></div>
        ${stackBar(segments)}
        <div class="legend">
          ${top.map(r => {
            const c = store.category(r.categoryId);
            return `<div class="legend-row"><span class="legend-dot" style="--c:var(--${esc(c.color)})"></span><span class="legend-name">${esc(c.name)}</span><span class="legend-value">${esc(store.money(r.total))}</span><span class="legend-pct">${Math.round((r.total / t.expense) * 100)}%</span></div>`;
          }).join('')}
        </div>
      </div>` : ''}

      ${catBudgets.length ? `
      <div class="section" style="margin-top:12px">
        <div class="section-title"><h2>Budgets</h2><button class="link" data-act="budget">Edit</button></div>
        <div class="list">
          ${catBudgets.map(b => {
            const c = store.category(b.id);
            const p = b.used / b.limit;
            const color = p >= 1 ? 'red' : p >= 0.8 ? 'orange' : 'green';
            return `<div class="row">${tile(c.icon, c.color)}<div class="row-main"><div class="row-text">
              <div style="display:flex;justify-content:space-between;gap:8px"><span class="row-title">${esc(c.name)}</span><span class="row-value" style="font-size:15px">${esc(store.money(b.used))} / ${esc(store.money(b.limit))}</span></div>
              <div class="progress" style="margin-top:7px;--c:var(--${color})"><span style="width:${Math.min(100, p * 100)}%"></span></div>
            </div></div></div>`;
          }).join('')}
        </div>
      </div>` : ''}

      ${upcoming.length ? `
      <div class="section" style="margin-top:12px">
        <div class="section-title"><h2>Coming up</h2></div>
        <div class="list">
          ${upcoming.map(r => {
            const c = store.category(r.categoryId);
            return `<div class="row">${tile(c.icon, c.color, 'lg')}<div class="row-main"><div class="row-text">
              <div class="row-title">${esc(r.note || c.name)}</div><div class="row-sub">${icon('repeat')} ${esc(L.shortDate(r.nextDate))}</div></div>
              <span class="tx-amount ${r.type}">${esc(r.type === 'income' ? store.money(r.amount, { sign: true }) : store.money(r.amount))}</span></div></div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <div class="section" style="margin-top:12px">
        <div class="section-title"><h2>Recent</h2><button class="link" data-act="activity">See All</button></div>
        <div class="list tx-list">${recent.map(x => txRow(x)).join('')}</div>
      </div>

      ${budget ? '' : budgetPrompt()}`;
  }

  function budgetPrompt() {
    return `<div class="card banner" data-act="budget" role="button">
      ${tile('target', 'red', 'lg')}
      <div class="banner-text"><strong>Set a monthly budget</strong>See how much you have left to spend each month.</div>
      <i class="ph ph-caret-right row-chevron"></i>
    </div>`;
  }

  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const name = act.dataset.act;
    if (name === 'add') openEditor();
    if (name === 'activity') goTo('activity');
    if (name === 'insights') goTo('insights');
    if (name === 'budget') openBudgets();
  });

  bindSwipeRows(root, {
    onTap: id => {
      const tx = store.state.transactions.find(t => t.id === id);
      if (tx) openEditor(tx);
    },
    onDelete: id => {
      const removed = store.deleteTransaction(id);
      if (removed) toast('Transaction deleted', { actionText: 'Undo', duration: 6000, onAction: () => store.restoreTransaction(removed) });
    },
  });

  return { render };
}
