// Bills and payments coming up — read from bank messages (card statements, phone and power bills,
// automatic payments) or added by hand — with reminders 2 days before and on the due day.
import { store } from './store.js';
import { native } from './native.js';
import * as L from './logic.js';
import { $, esc, icon, tile, pushPage, actionSheet, alert, toast, haptic, promptText, pickAmount, pickDate } from './ui.js';
import { openEditor } from './editor.js';
import { planReminders } from './plans.js';

const SHOW_DAYS_AHEAD = 30;

export function unpaidBills(state = store.state) {
  return state.bills.filter(b => !b.paid).sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

function due(b, today = L.todayISO()) {
  if (b.paid) return { text: `Paid${b.paidOn ? ` ${L.shortDate(b.paidOn)}` : ''}`, color: 'var(--green)' };
  const days = L.daysBetween(today, b.dueDate);
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} late`, color: 'var(--red)' };
  if (days === 0) return { text: 'Due today', color: 'var(--red)' };
  if (days === 1) return { text: 'Due tomorrow', color: 'var(--orange)' };
  if (days <= 3) return { text: `Due in ${days} days`, color: 'var(--orange)' };
  return { text: `Due ${L.shortDate(b.dueDate)}`, color: 'var(--label-2)' };
}

function billRow(b) {
  const d = due(b);
  const extra = [b.autopay ? 'Auto-pay' : '', b.minDue ? `min ${store.money(b.minDue)}` : ''].filter(Boolean).join(' · ');
  return `<button class="row tap" data-bill="${esc(b.id)}">
    ${tile(b.autopay ? 'arrows-clockwise' : 'receipt', b.paid ? 'gray' : b.autopay ? 'indigo' : 'orange', 'lg')}
    <div class="row-main"><div class="row-text">
      <div class="row-title">${esc(b.name)}</div>
      <div class="row-sub"><span style="color:${d.color};font-weight:500">${esc(d.text)}</span>${extra ? ` · ${esc(extra)}` : ''}</div>
    </div><span class="tx-amount">${esc(store.money(b.amount))}</span></div>
  </button>`;
}

/** The "Bills Due" card on Summary: unpaid bills due within a month (and late ones). */
export function billsCardHTML() {
  const today = L.todayISO();
  const list = unpaidBills().filter(b => L.daysBetween(today, b.dueDate) <= SHOW_DAYS_AHEAD);
  if (!list.length) return '';
  const total = list.reduce((sum, b) => sum + b.amount, 0);
  return `
    <div class="section" style="margin-top:12px">
      <div class="section-title"><h2>Bills Due</h2><button class="link" data-bills-all>See All</button></div>
      <div class="list">${list.slice(0, 3).map(billRow).join('')}</div>
      ${list.length > 1 ? `<div class="section-footer">${list.length} bills · ${esc(store.money(total))} in all</div>` : ''}
    </div>`;
}

/** Handles taps on bill rows anywhere. Returns true when it was one. */
export function handleBillClick(e) {
  const row = e.target.closest('[data-bill]');
  if (row) { billActions(row.dataset.bill); return true; }
  if (e.target.closest('[data-bills-all]')) { openBills(); return true; }
  return false;
}

async function billActions(id) {
  const b = store.state.bills.find(x => x.id === id);
  if (!b) return;
  const card = /card/i.test(b.name);
  const choice = await actionSheet({
    title: b.name,
    message: `${store.money(b.amount)} · ${due(b).text}`,
    actions: b.paid
      ? [{ text: 'Mark as Not Paid', value: 'unpaid' }, { text: 'Delete', value: 'delete', style: 'destructive' }]
      : [
          { text: card ? 'Paid — Add the Payment' : 'Paid — Add as Expense', value: 'record', icon: 'check-circle' },
          { text: 'Mark as Paid', value: 'paid', icon: 'check' },
          { text: 'Change Amount', value: 'amount', icon: 'pencil-simple' },
          { text: 'Change Due Date', value: 'date', icon: 'calendar-blank' },
          { text: 'Delete', value: 'delete', style: 'destructive' },
        ],
  });
  if (choice === 'paid') {
    store.setBillPaid(id, true);
    haptic('success');
    toast(`${b.name} marked paid`, { iconName: 'check-circle', actionText: 'Undo', onAction: () => store.setBillPaid(id, false) });
  } else if (choice === 'unpaid') {
    store.setBillPaid(id, false);
  } else if (choice === 'record') {
    // A card bill moves money from the bank to the card; anything else is spending
    const preset = card
      ? { type: 'transfer', amount: b.amount, accountId: store.account('bank') ? 'bank' : null, toAccountId: store.account('card') ? 'card' : null, note: b.name }
      : { type: 'expense', amount: b.amount, note: b.name };
    openEditor(null, { ...preset, onSave: fields => { const tx = store.addTransaction(fields); store.setBillPaid(id, true); return tx; } });
  } else if (choice === 'amount') {
    const value = await pickAmount({ title: 'Bill Amount', initial: b.amount, currency: store.currency, allowZero: false });
    if (value) store.saveBill({ ...b, amount: value });
  } else if (choice === 'date') {
    const picked = await pickDate(b.dueDate, { title: 'Due Date' });
    if (picked) store.saveBill({ ...b, dueDate: picked });
  } else if (choice === 'delete') {
    store.deleteBill(id);
    toast('Bill deleted', { actionText: 'Undo', onAction: () => store.saveBill(b) });
  }
}

async function addBill() {
  const name = await promptText({ title: 'New Bill', placeholder: 'Rent, electricity, school fees…' });
  if (!name) return;
  const amount = await pickAmount({ title: name, currency: store.currency, allowZero: false, doneText: 'Next' });
  if (!amount) return;
  const dueDate = await pickDate(L.addDays(L.todayISO(), 7), { title: 'Due Date' });
  if (!dueDate) return;
  store.saveBill({ name, amount, dueDate });
  haptic('success');
  toast('Bill added — you’ll be reminded', { iconName: 'bell' });
}

export function openBills() {
  let unsubscribe = () => {};
  const page = pushPage({
    title: 'Bills',
    rightHTML: `<button class="icon-btn" aria-label="Add bill">${icon('plus')}</button>`,
    onRight: addBill,
    onClose: () => unsubscribe(),
    render: content => {
      const unpaid = unpaidBills();
      const paid = store.state.bills.filter(b => b.paid).sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
      const remind = store.state.settings.billReminders !== false;
      const total = unpaid.reduce((sum, b) => sum + b.amount, 0);
      const next = unpaid[0];
      content.innerHTML = `
        ${unpaid.length ? `<div class="ju-card page-answer">
            <div class="ju-eyebrow">To pay</div>
            <div class="big num">${esc(store.money(total))}</div>
            <div class="ju-muted">${unpaid.length} bill${unpaid.length === 1 ? '' : 's'} · next ${esc(next.name)}, ${esc(L.shortDate(next.dueDate))}</div>
          </div>
          <div class="section"><div class="section-header">To Pay</div><div class="list">${unpaid.map(billRow).join('')}</div></div>`
          : `<div class="empty" style="padding-top:8vh">${icon('receipt', true)}<strong>No bills due</strong>Card statements, phone and power bills from your bank messages show up here.
              <div><button class="btn" data-bill-add>${icon('plus')} Add a Bill</button></div></div>`}
        ${native.isApp ? `
        <div class="section">
          <div class="list">
            <label class="row">${tile('bell-ringing', 'red')}<div class="row-main"><span class="row-title" style="flex:1">Remind Me</span>
            <span class="switch"><input type="checkbox" data-remind ${remind ? 'checked' : ''}><span></span></span></div></label>
          </div>
          <div class="section-footer">A notification 2 days before a bill is due, and on the day. Bills read from bank messages are marked paid when your bank says the payment arrived.</div>
        </div>` : ''}
        ${paid.length ? `<div class="section"><div class="section-header">Paid</div><div class="list">${paid.slice(0, 20).map(billRow).join('')}</div></div>` : ''}`;
    },
  });
  page.content.addEventListener('click', e => {
    if (e.target.closest('[data-bill-add]')) { addBill(); return; }
    handleBillClick(e);
  });
  page.content.addEventListener('change', async e => {
    const input = e.target.closest('[data-remind]');
    if (!input) return;
    if (input.checked) {
      const allowed = await native.requestNotifications();
      if (!allowed.ok) {
        input.checked = false;
        alert({ title: 'Notifications are off', message: 'Allow notifications for Expenses in your phone’s settings to get bill reminders.' });
        return;
      }
    }
    store.setSetting('billReminders', input.checked);
  });
  unsubscribe = store.subscribe(() => page.refresh());
}

/** Gives the phone this list of bill reminders (2 days before and on the day, at 9 am). */
export function syncBillReminders() {
  if (!native.isApp) return;
  const list = [];
  if (store.state.settings.billReminders !== false) {
    const now = Date.now();
    for (const b of unpaidBills()) {
      for (const before of [2, 0]) {
        const day = L.parseISO(L.addDays(b.dueDate, -before));
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0).getTime();
        if (at <= now) continue;
        list.push({
          id: `${b.id}|${before}`,
          title: before ? `${b.name} is due in 2 days` : `${b.name} is due today`,
          text: `${store.money(b.amount)}${b.minDue ? ` (minimum ${store.money(b.minDue)})` : ''}${b.autopay ? ' · auto-pay: keep money in the account' : ''}`,
          at,
        });
      }
    }
  }
  if (store.state.settings.billReminders !== false) list.push(...planReminders());
  else if (store.state.settings.evening && store.state.settings.evening.enabled) list.push(...planReminders().filter(r => r.id.startsWith('eve|')));
  // The soonest first, so the evening notes always fit in
  list.sort((a, b) => a.at - b.at);
  native.setBillReminders(list.slice(0, 60));
}
