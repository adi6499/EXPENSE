// Shared row markup for transactions.
import { store } from './store.js';
import * as L from './logic.js';
import { esc, icon, tile } from './ui.js';

/** Icon, colour, title, small print and amount text for any kind of transaction. */
export function describe(t) {
  const account = store.account(t.accountId);
  if (t.type === 'transfer') {
    const to = store.account(t.toAccountId);
    const route = `${account ? account.name : '?'} → ${to ? to.name : '?'}`;
    return { iconName: 'arrows-left-right', color: 'blue', title: t.note || 'Transfer', sub: t.note ? `Transfer · ${route}` : route, amount: store.money(t.amount), kind: 'transfer' };
  }
  if (t.type === 'loan') {
    const gave = t.direction !== 'in';
    const parts = [gave ? `You gave ${t.person}` : `You got from ${t.person}`];
    if (account) parts.push(account.name);
    return { iconName: 'hand-coins', color: gave ? 'teal' : 'mint', title: t.note || t.person, sub: parts.join(' · '), amount: store.money(t.amount), kind: 'loan' };
  }
  const cat = store.category(t.categoryId);
  const parts = [];
  if (t.note) parts.push(cat.name);
  if (account) parts.push(account.name);
  return {
    iconName: cat.icon,
    color: cat.color,
    title: t.note || cat.name,
    sub: parts.join(' · '),
    fallbackSub: cat.name,
    amount: t.type === 'income' ? store.money(t.amount, { sign: true }) : store.money(t.amount),
    kind: t.type,
  };
}

/** A transaction row. swipe: wrap it so it can be swiped to delete (see ui.bindSwipeRows). */
export function txRow(t, { swipe = true, showDate = false } = {}) {
  const d = describe(t);
  let sub = d.sub;
  if (showDate) sub = [sub, L.shortDate(t.date)].filter(Boolean).join(' · ');
  if (!sub) sub = showDate ? '' : (d.fallbackSub || '');
  const marks = [
    t.recurringId ? `<span class="tx-repeat">${icon('repeat')}</span>` : '',
    t.sms ? `<span class="tx-repeat" title="From a bank message">${icon('chat-text')}</span>` : '',
    t.photo ? `<span class="tx-repeat" title="Has a photo">${icon('camera')}</span>` : '',
    t.tag ? `<span class="tx-tag">${esc(t.tag)}</span>` : '',
    t.by && t.by !== store.state.settings.memberName ? `<span class="tx-tag tx-by">${icon('user')} ${esc(t.by)}</span>` : '',
  ].filter(Boolean).join(' ');
  const inner = `
    ${tile(d.iconName, d.color, 'lg')}
    <div class="row-main">
      <div class="row-text">
        <div class="row-title">${esc(d.title)}</div>
        <div class="row-sub">${marks ? `${marks} ` : ''}${esc(sub)}</div>
      </div>
      <div class="tx-amount ${d.kind}">${esc(d.amount)}</div>
    </div>`;
  if (!swipe) return `<button class="row tap tx-row" data-id="${esc(t.id)}">${inner}</button>`;
  return `<div class="swipe-row" data-id="${esc(t.id)}" data-key="${esc(t.id)}">
    <button class="swipe-delete" aria-label="Delete">${icon('trash', true)}<span>Delete</span></button>
    <div class="swipe-content">${inner}</div>
  </div>`;
}
