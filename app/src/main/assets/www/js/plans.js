// Savings goals, EMIs and warranties.
import { store } from './store.js';
import * as L from './logic.js';
import { esc, icon, tile, pushPage, actionSheet, alert, toast, haptic, promptText, pickAmount, pickDate } from './ui.js';
import { ring } from './charts.js';
import { openEditor, showPhoto } from './editor.js';
import { native } from './native.js';

function livePage(options) {
  let unsubscribe = () => {};
  const page = pushPage({ ...options, onClose: () => unsubscribe() });
  unsubscribe = store.subscribe(() => page.refresh());
  return page;
}

// ---------- Savings goals

function goalRow(g) {
  const p = L.goalProgress(g);
  const sub = p.done ? 'Reached — well done!' : [
    `${store.money(p.saved)} of ${store.money(g.target)}`,
    p.perMonth ? `${store.money(p.perMonth)}/month to make ${L.shortDate(g.byDate)}` : '',
  ].filter(Boolean).join(' · ');
  return `<button class="row tap" data-goal="${esc(g.id)}">
    <span class="goal-ring">${ring(p.pct, { size: 44, stroke: 6, color: p.done ? 'var(--green)' : 'var(--indigo)' })}<span>${Math.round(p.pct * 100)}%</span></span>
    <div class="row-main"><div class="row-text"><div class="row-title">${esc(g.name)}</div><div class="row-sub">${esc(sub)}</div></div>
    <i class="ph ph-caret-right row-chevron"></i></div></button>`;
}

/** Summary card: goals still being saved for. */
export function goalsCardHTML() {
  const goals = store.state.goals.filter(g => !L.goalProgress(g).done);
  if (!goals.length) return '';
  return `<div class="section" style="margin-top:12px">
    <div class="section-title"><h2>Goals</h2><button class="link" data-goals-all>See All</button></div>
    <div class="list">${goals.slice(0, 3).map(goalRow).join('')}</div></div>`;
}

export function handleGoalClick(e) {
  const row = e.target.closest('[data-goal]');
  if (row) { goalActions(row.dataset.goal); return true; }
  if (e.target.closest('[data-goals-all]')) { openGoals(); return true; }
  return false;
}

async function newGoal() {
  const name = await promptText({ title: 'New Goal', placeholder: 'Goa trip, new phone, emergency fund…' });
  if (!name) return;
  const target = await pickAmount({ title: name, subtitle: 'How much do you need?', currency: store.currency, allowZero: false, doneText: 'Next' });
  if (!target) return;
  const byDate = await pickDate(L.addMonths(L.todayISO(), 6), { title: 'By when?' });
  store.saveGoal({ name, target, byDate: byDate || '' });
  haptic('success');
}

async function goalActions(id) {
  const g = store.state.goals.find(x => x.id === id);
  if (!g) return;
  const p = L.goalProgress(g);
  const choice = await actionSheet({
    title: g.name,
    message: `${store.money(p.saved)} saved of ${store.money(g.target)}${p.perMonth && !p.done ? ` · put aside ${store.money(p.perMonth)} a month` : ''}`,
    actions: [
      { text: 'Add Money', value: 'add', icon: 'plus-circle' },
      { text: 'Change Target', value: 'target', icon: 'target' },
      { text: 'Change Date', value: 'date', icon: 'calendar-blank' },
      { text: 'Delete Goal', value: 'delete', style: 'destructive' },
    ],
  });
  if (choice === 'add') {
    const amount = await pickAmount({ title: `Add to ${g.name}`, currency: store.currency, allowZero: false, doneText: 'Add' });
    if (amount) {
      store.addToGoal(id, amount);
      haptic('success');
      if (L.goalProgress(store.state.goals.find(x => x.id === id)).done) toast(`${g.name}: goal reached!`, { iconName: 'confetti' });
    }
  } else if (choice === 'target') {
    const target = await pickAmount({ title: 'Target', initial: g.target, currency: store.currency, allowZero: false });
    if (target) store.saveGoal({ ...g, target });
  } else if (choice === 'date') {
    const byDate = await pickDate(g.byDate || L.todayISO(), { title: 'By when?' });
    if (byDate) store.saveGoal({ ...g, byDate });
  } else if (choice === 'delete') {
    store.deleteGoal(id);
  }
}

export function openGoals() {
  const page = livePage({
    title: 'Goals',
    rightHTML: `<button class="icon-btn" aria-label="New goal">${icon('plus')}</button>`,
    onRight: newGoal,
    render: content => {
      const goals = store.state.goals;
      content.innerHTML = goals.length
        ? `<div class="section" style="margin-top:12px"><div class="list">${goals.map(goalRow).join('')}</div>
            <div class="section-footer">Tap a goal to add money to it. Expenses works out how much to put aside each month.</div></div>`
        : `<div class="empty" style="padding-top:14vh">${icon('piggy-bank', true)}<strong>Save for something</strong>A trip, a phone, an emergency fund — set an amount and a date and see how much to put aside each month.<div><button class="btn" data-new>${icon('plus')} New Goal</button></div></div>`;
    },
  });
  page.content.addEventListener('click', e => {
    if (e.target.closest('[data-new]')) { newGoal(); return; }
    handleGoalClick(e);
  });
}

// ---------- EMIs

async function newEmi() {
  const name = await promptText({ title: 'New EMI', placeholder: 'Car loan, phone EMI, home loan…' });
  if (!name) return;
  const amount = await pickAmount({ title: `${name}: monthly EMI`, currency: store.currency, allowZero: false, doneText: 'Next' });
  if (!amount) return;
  const monthsText = await promptText({ title: 'How many EMIs are left?', placeholder: '12', maxLength: 3 });
  const months = parseInt(monthsText, 10);
  if (!months || months < 1) return;
  const startDate = await pickDate(L.todayISO(), { title: 'Date of the next EMI' });
  if (!startDate) return;
  const accounts = store.state.accounts.map(a => ({ text: a.name, value: a.id, icon: a.icon }));
  const accountId = await actionSheet({ title: 'Paid from', actions: accounts });
  if (!accountId) return;
  const category = store.state.categories.find(c => c.id === 'bills') || store.categories('expense')[0];
  store.saveEmi({ name, amount, months, day: L.parseISO(startDate).getDate(), startDate, accountId, categoryId: category ? category.id : null });
  haptic('success');
  toast('EMI added — it’s recorded each month by itself', { iconName: 'check-circle' });
}

export function openEmis() {
  const page = livePage({
    title: 'Loans & EMIs',
    rightHTML: `<button class="icon-btn" aria-label="New EMI">${icon('plus')}</button>`,
    onRight: newEmi,
    render: content => {
      const list = store.state.emis.map(e => ({ e, s: L.emiStatus(e, store.rule(e.ruleId), store.state.transactions) }));
      if (!list.length) {
        content.innerHTML = `<div class="empty" style="padding-top:14vh">${icon('bank', true)}<strong>No EMIs</strong>Add a loan or EMI and it’s recorded each month by itself, with what’s left to pay and a reminder before each one.<div><button class="btn" data-new>${icon('plus')} New EMI</button></div></div>`;
        return;
      }
      const leftTotal = list.reduce((sum, x) => sum + x.s.leftAmount, 0);
      content.innerHTML = `
        <div class="card" style="margin-top:12px"><div class="card-label">Still to pay</div><div class="hero-amount num" style="font-size:34px">${esc(store.money(leftTotal))}</div></div>
        <div class="section"><div class="list">${list.map(({ e, s }) => `
          <button class="row tap" data-emi="${esc(e.id)}">${tile('bank', s.done ? 'gray' : 'indigo', 'lg')}
            <div class="row-main"><div class="row-text"><div class="row-title">${esc(e.name)}</div>
              <div class="row-sub">${s.done ? 'All paid' : `${s.paid} of ${s.total} paid · next ${esc(L.shortDate(s.nextDate))}`}</div>
              <div class="progress" style="margin-top:6px;--c:var(--indigo)"><span style="width:${(s.paid / s.total) * 100}%"></span></div></div>
            <span class="tx-amount">${esc(store.money(e.amount))}</span></div></button>`).join('')}</div>
          <div class="section-footer">Each EMI is added on its date like a repeating expense, and stops after the last one. A reminder comes 2 days before.</div></div>`;
    },
  });
  page.content.addEventListener('click', async e => {
    if (e.target.closest('[data-new]')) { newEmi(); return; }
    const row = e.target.closest('[data-emi]');
    if (!row) return;
    const emi = store.state.emis.find(x => x.id === row.dataset.emi);
    const choice = await actionSheet({ title: emi.name, actions: [{ text: 'Delete EMI', value: 'delete', style: 'destructive' }] });
    if (choice === 'delete') {
      const ok = await alert({ title: `Delete ${emi.name}?`, message: 'Future EMIs stop being added. EMIs already recorded stay.', buttons: [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'Delete', value: true, style: 'destructive' }] });
      if (ok) store.deleteEmi(emi.id);
    }
  });
}

// ---------- Warranties

export function openWarranties() {
  const page = livePage({
    title: 'Warranties',
    render: content => {
      const list = L.warranties(store.state.transactions);
      if (!list.length) {
        content.innerHTML = `<div class="empty" style="padding-top:14vh">${icon('shield-check', true)}<strong>No warranties yet</strong>When you buy something with a warranty, open it, tap <b>Warranty</b> and add a photo of the bill. You’ll be reminded before it runs out.</div>`;
        return;
      }
      content.innerHTML = `<div class="section" style="margin-top:12px"><div class="list">${list.map(({ tx, until, daysLeft }) => `
        <button class="row tap" data-w="${esc(tx.id)}">${tile('shield-check', daysLeft < 0 ? 'gray' : daysLeft <= 30 ? 'orange' : 'green', 'lg')}
          <div class="row-main"><div class="row-text"><div class="row-title">${esc(tx.note || store.category(tx.categoryId).name)}</div>
          <div class="row-sub">${daysLeft < 0 ? `Ended ${esc(L.shortDate(until))}` : `Until ${esc(L.shortDate(until))} · ${daysLeft} days left`}${tx.photo ? ' · bill photo' : ''}</div></div>
          <span class="tx-amount">${esc(store.money(tx.amount))}</span></div></button>`).join('')}</div>
        <div class="section-footer">Reminders come a month and a week before a warranty ends. Tap one to see the bill.</div></div>`;
    },
  });
  page.content.addEventListener('click', async e => {
    const row = e.target.closest('[data-w]');
    if (!row) return;
    const tx = store.state.transactions.find(t => t.id === row.dataset.w);
    if (!tx) return;
    const choice = await actionSheet({ title: tx.note || 'Warranty', actions: [
      ...(tx.photo ? [{ text: 'Show the Bill', value: 'photo', icon: 'image' }] : []),
      { text: 'Open Transaction', value: 'open', icon: 'pencil-simple' },
    ] });
    if (choice === 'photo') showPhoto(await native.photoUrl(tx.id));
    if (choice === 'open') openEditor(tx);
  });
}

/** Reminders for EMIs (2 days before) and warranties (30 and 7 days before), like bill reminders. */
export function planReminders(now = Date.now()) {
  const list = [];
  const at9 = iso => { const d = L.parseISO(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0).getTime(); };
  for (const e of store.state.emis) {
    const s = L.emiStatus(e, store.rule(e.ruleId), store.state.transactions);
    if (s.done || !s.nextDate) continue;
    const at = at9(L.addDays(s.nextDate, -2));
    if (at > now) list.push({ id: `emi|${e.id}|${s.nextDate}`, title: `${e.name} is due in 2 days`, text: `${store.money(e.amount)} on ${L.shortDate(s.nextDate)} — keep it in the account`, at });
  }
  for (const { tx, until } of L.warranties(store.state.transactions)) {
    for (const days of [30, 7]) {
      const at = at9(L.addDays(until, -days));
      if (at > now) list.push({ id: `w|${tx.id}|${days}`, title: `Warranty ends in ${days} days`, text: `${tx.note || 'Your purchase'} — until ${L.shortDate(until)}. Get anything fixed now.`, at });
    }
  }
  return list;
}
