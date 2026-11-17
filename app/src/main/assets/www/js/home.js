// The Summary tab: this month at a glance.
import { store } from './store.js';
import * as L from './logic.js';
import { esc, icon, tile, bindSwipeRows, toast, alert } from './ui.js';
import { txRow } from './rows.js';
import { messagesCardHTML, bindFindingRows, onRowTap, onRowDelete } from './messages.js';
import { billsCardHTML, handleBillClick } from './bills.js';
import { handlePeopleClick, openPeople } from './people.js';
import { tripBannerHTML, handleTripClick } from './trips.js';
import { summaryBannerHTML, handleSummaryClick } from './summary.js';
import { openAccounts, openRepeating } from './manage.js';
import { handleGoalClick, openGoals } from './plans.js';
import { openPlan, planCardHTML, setupCardHTML } from './plan.js';
import { buddyCardHTML, handleBuddyClick } from './buddy.js';
import { native } from './native.js';
import {
  privacyButtonHTML, togglePrivacy, quickAddsHTML, doQuickAdd, openQuickAdds, streaksHTML, openChallenges,
  checklistHTML, hideChecklist,
} from './easy.js';

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
        ${safe ? `<button class="safe ${safe.perDay ? '' : 'none'}" data-safe>${icon('hand-coins')}<span>Safe to spend today${safe.daysToSalary !== null ? ` · ${safe.daysToSalary} day${safe.daysToSalary === 1 ? '' : 's'} to salary` : ''}</span><strong>${esc(store.money(safe.perDay))}</strong></button>` : ''}
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

  /** Everything else, one short line each (opens its own page): bank balances, money owed, goals, repeats. */
  function moreHTML(today) {
    const st = store.state;
    const rows = [];
    const balances = Object.values(st.sms.balances || {}).filter(b => b.kind !== 'limit');
    if (balances.length) rows.push(['accounts', 'bank', 'blue', 'Bank balances', store.money(balances.reduce((sum, b) => sum + b.amount, 0))]);
    const people = L.personBalances(st.transactions).filter(p => p.balance);
    if (people.length) rows.push(['people', 'hand-coins', 'teal', 'Lent & borrowed', `${people.length} ${people.length === 1 ? 'person' : 'people'}`]);
    if (st.goals.length) rows.push(['goals', 'piggy-bank', 'pink', 'Goals', `${st.goals.length} goal${st.goals.length === 1 ? '' : 's'}`]);
    const soon = st.recurring.filter(r => r.active && r.nextDate <= L.addDays(today, 14)).length;
    if (soon) rows.push(['repeating', 'repeat', 'indigo', 'Coming up', `${soon} in 2 weeks`]);
    if (!rows.length) return '';
    return `<div class="ju-card home-card"><div class="head"><h2>More</h2></div><div class="list">${rows.map(([key, ic, color, label, value]) => `
      <button class="row tap" data-more="${key}">${tile(ic, color)}<div class="row-main"><span class="row-title" style="flex:1">${esc(label)}</span>
      <span class="row-value">${esc(value)}</span><i class="ph ph-caret-right row-chevron"></i></div></button>`).join('')}</div></div>`;
  }

  // The front page, kept short: the answer (spent and left), your plan — or one step to set it up —,
  // what needs doing, then the latest few. Everything else is one line under More.
  function render() {
    const st = store.state;
    const today = L.todayISO();
    const month = L.inRange(st.transactions, L.startOfMonth(today), L.endOfMonth(today));
    const t = L.totals(month);
    const monthName = L.parseISO(today).toLocaleDateString('en-IN', { month: 'long' });
    const planned = !!st.budgets.income;
    const recent = L.sortTransactions(st.transactions).slice(0, 5);

    root.innerHTML = `
      ${tripBannerHTML()}
      ${st.transactions.length ? summaryBannerHTML() : ''}
      ${heroHTML(t, monthName)}
      ${quickAddsHTML()}
      ${buddyCardHTML()}
      ${planned ? planCardHTML() : setupCardHTML()}
      ${messagesCardHTML()}
      ${billsCardHTML()}
      ${streaksHTML()}
      ${recent.length ? cardHTML('Recent', `<button class="ju-btn ghost sm" data-act="activity">See All ${icon('caret-right')}</button>`, `<div class="list tx-list">${recent.map(x => txRow(x)).join('')}</div>`) : ''}
      ${moreHTML(today)}
      ${planned ? checklistHTML() : ''}`;
  }

  bindFindingRows(root);
  root.addEventListener('click', e => {
    if (handleBillClick(e) || handlePeopleClick(e) || handleTripClick(e) || handleSummaryClick(e) || handleGoalClick(e)) return;
    if (e.target.closest('[data-plan]')) { openPlan(); return; }
    if (handleBuddyClick(e)) return;
    const more = e.target.closest('[data-more]');
    if (more) { ({ accounts: openAccounts, people: openPeople, goals: openGoals, repeating: openRepeating })[more.dataset.more](); return; }
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
    if (name === 'budget') openPlan();
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
