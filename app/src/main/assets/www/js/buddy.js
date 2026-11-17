// Money Buddy: tells you, in plain words, what you're doing, how you're spending and what you're losing.
// On Summary it shows the one thing that matters most; its page lists everything; after you add an
// expense it says a word if a plan is running low; and the evening note carries its top message.
// Simple rules on your own data — nothing is sent anywhere.
import { store } from './store.js';
import * as L from './logic.js';
import { esc, icon, pushPage, toast, haptic } from './ui.js';
import { nav } from './nav.js';
import { openPlan } from './plan.js';
import { openFees, openRefunds, openDocuments } from './more.js';

const opts = () => ({ money: v => store.money(v), categoryName: id => store.category(id).name });
export const buddyMessages = () => L.buddyMessages(store.state, opts());

const TONE_TILE = { bad: 'bad', warn: 'warn', info: 'blue', good: 'ok' };
const greeting = () => {
  const h = new Date().getHours();
  const name = store.state.settings.memberName;
  return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}${name ? `, ${name}` : ''}`;
};

const avatar = () => `<span class="buddy-avatar" aria-hidden="true">${icon('robot', true)}</span>`;

function bubble(m) {
  return `<div class="buddy-msg tone-${m.tone}" data-key="${esc(m.key)}">
    <span class="buddy-ic ${TONE_TILE[m.tone]}">${icon(m.icon, true)}</span>
    <div class="buddy-body"><b>${esc(m.title)}</b><p>${esc(m.text)}</p>
      <div class="buddy-acts">${m.action ? `<button class="ju-btn sm primary" data-buddy-go="${esc(m.action.go)}" data-arg="${esc(m.action.arg || '')}">${esc(m.action.label)}</button>` : ''}
        <button class="ju-btn sm ghost" data-buddy-ok="${esc(m.key)}">Got It</button></div></div>
  </div>`;
}

/** Summary: the buddy with its most important message (or a calm all-clear). */
export function buddyCardHTML() {
  const list = buddyMessages();
  if (!store.state.transactions.length) return '';
  const top = list[0];
  return `<div class="ju-card home-card buddy-card">
    <div class="buddy-head">${avatar()}<div class="grow"><b>Money Buddy</b><small>${esc(greeting())}</small></div>
      ${list.length > 1 ? `<button class="ju-btn ghost sm" data-buddy-all>All ${list.length} ${icon('caret-right')}</button>` : ''}</div>
    ${top ? bubble(top) : `<div class="buddy-msg tone-good"><span class="buddy-ic ok">${icon('check-circle', true)}</span><div class="buddy-body"><b>All good</b><p>Nothing needs your attention right now. I’ll tell you if something comes up.</p></div></div>`}
  </div>`;
}

/** Everything the buddy has to say, like a short chat. */
export function openBuddy() {
  let unsubscribe = () => {};
  const page = pushPage({
    title: 'Money Buddy',
    onClose: () => unsubscribe(),
    render: content => {
      const list = buddyMessages();
      const bad = list.filter(m => m.tone === 'bad').length;
      content.innerHTML = `
        <div class="buddy-intro">${avatar()}<div class="buddy-say"><b>${esc(greeting())}.</b> ${list.length
          ? `Here’s how your money is doing${bad ? ` — ${bad} thing${bad === 1 ? '' : 's'} need${bad === 1 ? 's' : ''} you` : ''}.`
          : 'Everything looks fine. I’ll tell you when something needs you.'}</div></div>
        <div class="buddy-list">${list.map(bubble).join('')}</div>
        <div class="section-footer" style="padding:4px 20px">I look at your own spending on this phone: your plan, bank charges, double charges, refunds, renewals and habits. Nothing is sent anywhere.</div>`;
    },
  });
  unsubscribe = store.subscribe(() => page.refresh());
  page.content.addEventListener('click', e => handleBuddyClick(e));
}

/** Taps on the buddy (card or page). Returns true when it was one. */
export function handleBuddyClick(e) {
  if (e.target.closest('[data-buddy-all]')) { openBuddy(); return true; }
  const ok = e.target.closest('[data-buddy-ok]');
  if (ok) {
    haptic('selection');
    store.dismissAlert(ok.dataset.buddyOk);
    return true;
  }
  const go = e.target.closest('[data-buddy-go]');
  if (!go) return false;
  const arg = go.dataset.arg;
  const today = L.todayISO();
  ({
    plan: openPlan,
    fees: openFees,
    refunds: openRefunds,
    documents: openDocuments,
    insights: () => nav.goTo('insights'),
    transactions: () => nav.goTo('activity'),
    category: () => nav.showActivity({
      categoryId: arg, type: 'expense',
      period: { key: 'custom', label: 'This Month', start: L.startOfMonth(today), end: L.endOfMonth(today) },
    }),
  })[go.dataset.buddyGo]();
  return true;
}

/** Right after an expense is added: a word if a plan is running low, used up, or it's outside the plan. */
let lastNudged = null;
export function nudgeAfterAdd(tx) {
  if (!tx || tx.id === lastNudged || store.state.settings.nudges === false) return;
  lastNudged = tx.id;
  const n = L.nudgeFor(store.state, tx, opts());
  if (!n) return;
  // Wait for any "Added · Undo" message to finish, so the buddy never hides an Undo
  let tries = 0;
  const show = () => {
    const open = document.querySelector('#toast.show');
    if (open && tries++ < 12) { setTimeout(show, 700); return; }
    toast(n.text, { iconName: n.tone === 'bad' ? 'warning-circle' : n.tone === 'warn' ? 'gauge' : 'robot', duration: 6000 });
  };
  setTimeout(show, 900);
}
