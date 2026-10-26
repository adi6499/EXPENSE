// Shared row markup for transactions.
import { store } from './store.js';
import * as L from './logic.js';
import { esc, icon, tile } from './ui.js';

/** A transaction row. swipe: wrap it so it can be swiped to delete (see ui.bindSwipeRows). */
export function txRow(t, { swipe = true, showDate = false } = {}) {
  const cat = store.category(t.categoryId);
  const account = store.account(t.accountId);
  const title = t.note || cat.name;
  const parts = [];
  if (t.note) parts.push(cat.name);
  if (account) parts.push(account.name);
  if (showDate) parts.push(L.shortDate(t.date));
  const sub = parts.join(' · ') || (showDate ? '' : cat.name);
  const amount = t.type === 'income' ? store.money(t.amount, { sign: true }) : store.money(t.amount);
  const inner = `
    ${tile(cat.icon, cat.color, 'lg')}
    <div class="row-main">
      <div class="row-text">
        <div class="row-title">${esc(title)}</div>
        <div class="row-sub">${t.recurringId ? `<span class="tx-repeat">${icon('repeat')}</span> ` : ''}${esc(sub)}</div>
      </div>
      <div class="tx-amount ${t.type}">${esc(amount)}</div>
    </div>`;
  if (!swipe) return `<button class="row tap tx-row" data-id="${esc(t.id)}">${inner}</button>`;
  return `<div class="swipe-row" data-id="${esc(t.id)}">
    <button class="swipe-delete" aria-label="Delete">${icon('trash', true)}<span>Delete</span></button>
    <div class="swipe-content">${inner}</div>
  </div>`;
}
