// Money lent and borrowed: who owes you, whom you owe, settling up and a friendly WhatsApp reminder.
import { store } from './store.js';
import * as L from './logic.js';
import { esc, icon, tile, pushPage, actionSheet } from './ui.js';
import { openEditor } from './editor.js';
import { nav } from './nav.js';
import { askToPay } from './split.js';

function personRow(p) {
  const owesYou = p.balance > 0;
  const settled = !p.balance;
  return `<button class="row tap" data-person="${esc(p.key)}">
    ${tile('hand-coins', settled ? 'gray' : owesYou ? 'teal' : 'orange', 'lg')}
    <div class="row-main"><div class="row-text">
      <div class="row-title">${esc(p.name)}</div>
      <div class="row-sub">${settled ? 'All settled' : owesYou ? 'Owes you' : 'You owe'} · ${esc(L.shortDate(p.last))}</div>
    </div><span class="tx-amount" style="color:${settled ? 'var(--label-2)' : owesYou ? 'var(--green)' : 'var(--red)'}">${esc(store.money(Math.abs(p.balance)))}</span></div>
  </button>`;
}

/** The "Lent & Borrowed" card on Summary: people with money still to settle. */
export function peopleCardHTML() {
  const open = L.personBalances(store.state.transactions).filter(p => p.balance);
  if (!open.length) return '';
  return `
    <div class="section" style="margin-top:12px">
      <div class="section-title"><h2>Lent &amp; Borrowed</h2><button class="link" data-people-all>See All</button></div>
      <div class="list">${open.slice(0, 3).map(personRow).join('')}</div>
    </div>`;
}

export function handlePeopleClick(e) {
  const row = e.target.closest('[data-person]');
  if (row) { personActions(row.dataset.person); return true; }
  if (e.target.closest('[data-people-all]')) { openPeople(); return true; }
  return false;
}

async function personActions(key) {
  const p = L.personBalances(store.state.transactions).find(x => x.key === key);
  if (!p) return;
  const owesYou = p.balance > 0;
  const owed = Math.abs(p.balance);
  const actions = [];
  if (p.balance > 0) actions.push({ text: `Got ${store.money(owed)} Back`, value: 'got-all', icon: 'check-circle' });
  if (p.balance < 0) actions.push({ text: `Paid ${store.money(owed)} Back`, value: 'paid-all', icon: 'check-circle' });
  actions.push({ text: 'Got Some Money', value: 'got', icon: 'arrow-down' });
  actions.push({ text: 'Gave Money', value: 'gave', icon: 'arrow-up' });
  if (owesYou) actions.push({ text: 'Ask to Pay (UPI code)', value: 'remind', icon: 'qr-code' });
  actions.push({ text: 'See Transactions', value: 'list', icon: 'list-bullets' });
  const choice = await actionSheet({
    title: p.name,
    message: p.balance ? `${owesYou ? `${p.name} owes you` : `You owe ${p.name}`} ${store.money(owed)}` : 'All settled',
    actions,
  });
  const loan = (direction, amount) => openEditor(null, { type: 'loan', direction, person: p.name, ...(amount ? { amount } : {}) });
  if (choice === 'got-all') loan('in', owed);
  else if (choice === 'paid-all') loan('out', owed);
  else if (choice === 'got') loan('in');
  else if (choice === 'gave') loan('out');
  else if (choice === 'list') nav.showActivity({ person: p.name });
  else if (choice === 'remind') askToPay({ name: p.name, amount: owed, note: '' });
}

export function openPeople() {
  let unsubscribe = () => {};
  const page = pushPage({
    title: 'Lent & Borrowed',
    rightHTML: `<button class="icon-btn" aria-label="Lend or borrow">${icon('plus')}</button>`,
    onRight: () => openEditor(null, { type: 'loan' }),
    onClose: () => unsubscribe(),
    render: content => {
      const people = L.personBalances(store.state.transactions);
      if (!people.length) {
        content.innerHTML = `<div class="empty" style="padding-top:14vh">${icon('hand-coins', true)}<strong>Nobody owes anybody</strong>When you lend money or borrow some, add it as a Loan and it’s tracked here until it’s paid back.</div>`;
        return;
      }
      const theyOwe = people.filter(p => p.balance > 0).reduce((s, p) => s + p.balance, 0);
      const youOwe = people.filter(p => p.balance < 0).reduce((s, p) => s - p.balance, 0);
      content.innerHTML = `
        <div class="stats" style="margin-top:12px">
          <div class="stat"><div class="stat-label">Owed to you</div><div class="stat-value" style="color:var(--green)">${esc(store.money(theyOwe))}</div></div>
          <div class="stat"><div class="stat-label">You owe</div><div class="stat-value" style="color:${youOwe ? 'var(--red)' : 'var(--label)'}">${esc(store.money(youOwe))}</div></div>
        </div>
        <div class="section"><div class="list">${people.map(personRow).join('')}</div>
        <div class="section-footer">Tap someone to record money back, lend more, or send a reminder.</div></div>`;
    },
  });
  page.content.addEventListener('click', e => handlePeopleClick(e));
  unsubscribe = store.subscribe(() => page.refresh());
}
