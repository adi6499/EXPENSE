// The everyday helpers: one-tap quick adds, no-spend streaks, hiding amounts, the Getting started
// list for new people, and "What's new" once after an update.
import { store } from './store.js';
import { native } from './native.js';
import * as L from './logic.js';
import { esc, icon, tile, pushPage, actionSheet, toast, haptic, promptText, pickAmount, openSheet } from './ui.js';

export const APP_VERSION = '1.7.0'; // the What's new list's version (a small fix release keeps it, so the list isn't shown again)
const settings = () => store.state.settings;

function livePage(options) {
  let unsubscribe = () => {};
  const page = pushPage({ ...options, onClose: () => unsubscribe() });
  unsubscribe = store.subscribe(() => page.refresh());
  return page;
}

// ---------- Hiding amounts (for when someone is looking at your screen)

export function applyPrivacy() {
  document.documentElement.classList.toggle('hide-amounts', !!settings().hideAmounts);
}

export function togglePrivacy() {
  const hide = !settings().hideAmounts;
  store.setSetting('hideAmounts', hide);
  applyPrivacy();
  haptic('selection');
  toast(hide ? 'Amounts hidden — tap the eye to show them' : 'Amounts showing', { iconName: hide ? 'eye-slash' : 'eye' });
}

export const privacyButtonHTML = () =>
  `<button class="ju-icon" data-privacy aria-label="${settings().hideAmounts ? 'Show amounts' : 'Hide amounts'}">${icon(settings().hideAmounts ? 'eye-slash' : 'eye')}</button>`;

// ---------- One-tap quick adds

const quickLabel = q => `${q.note} ${store.money(q.amount)}`;

export function quickAddsHTML() {
  const list = settings().quickAdds;
  if (!list.length) return '';
  return `<div class="quick-row">${list.map(q => `<button class="ju-chip" data-quick="${esc(q.id)}">${icon('lightning')}${esc(quickLabel(q))}</button>`).join('')}
    <button class="ju-chip" data-quick-edit aria-label="Change quick buttons">${icon('pencil-simple')}</button></div>`;
}

export function doQuickAdd(id) {
  const tx = store.quickAdd(id);
  if (!tx) return;
  haptic('success');
  toast(`Added ${tx.note} · ${store.money(tx.amount)}`, {
    iconName: 'lightning', actionText: 'Undo', duration: 5000,
    onAction: () => store.deleteTransaction(tx.id),
  });
}

/** The first two buttons also sit on the phone's home-screen widget. */
export function syncWidgetQuick() {
  const list = settings().quickAdds;
  native.setWidgetQuick(list[0] ? quickLabel(list[0]) : '', list[1] ? quickLabel(list[1]) : '');
}

async function newQuickAdd() {
  const note = await promptText({ title: 'Button Name', placeholder: 'Chai, Auto, Milk, Petrol…', maxLength: 24 });
  if (!note) return;
  const amount = await pickAmount({ title: `${note}: how much?`, currency: store.currency, allowZero: false });
  if (!amount) return;
  const cats = store.categories('expense');
  const guess = store.likelyCategory('expense');
  const categoryId = await actionSheet({ title: 'Category', actions: cats.map(c => ({ text: c.name, value: c.id, icon: c.icon, checked: c.id === guess })) });
  if (!categoryId) return;
  addQuick({ note, amount, categoryId, accountId: settings().lastAccountId || null });
}

function addQuick(q) {
  const list = settings().quickAdds;
  if (list.length >= 6) { toast('Six buttons at most — remove one first', { iconName: 'lightning' }); return; }
  store.saveQuickAdds([...list, { id: L.uid(), ...q }]);
  syncWidgetQuick();
  haptic('success');
}

export function openQuickAdds() {
  const page = livePage({
    title: 'Quick Buttons',
    rightHTML: `<button class="icon-btn" aria-label="New button">${icon('plus')}</button>`,
    onRight: newQuickAdd,
    render: content => {
      const list = settings().quickAdds;
      const have = new Set(list.map(q => `${q.note.toLowerCase()}|${q.amount}`));
      const ideas = L.frequentSpends(store.state.transactions).filter(g => !have.has(`${g.note.toLowerCase()}|${g.amount}`));
      content.innerHTML = `
        <div class="section" style="margin-top:12px"><div class="section-header">Your buttons</div><div class="list">
          ${list.length ? list.map((q, i) => {
            const c = store.category(q.categoryId);
            return `<button class="row tap" data-q="${esc(q.id)}">${tile(c.icon, c.color)}<div class="row-main"><div class="row-text">
              <div class="row-title">${esc(q.note)}</div><div class="row-sub">${esc(c.name)}${i < 2 && native.isApp ? ' · also on the widget' : ''}</div></div>
              <span class="tx-amount">${esc(store.money(q.amount))}</span></div></button>`;
          }).join('') : `<div class="row"><div class="row-main"><span class="row-title" style="flex:1;color:var(--label-2)">None yet</span></div></div>`}
        </div><div class="section-footer">One tap on Summary adds it for today — no typing. ${native.isApp ? 'The first two also show on the home-screen widget.' : ''}</div></div>
        ${ideas.length ? `<div class="section"><div class="section-header">You often add</div><div class="list">
          ${ideas.map((g, i) => `<button class="row tap" data-idea="${i}">${tile('plus', 'green')}<div class="row-main"><div class="row-text">
            <div class="row-title">${esc(g.note)}</div><div class="row-sub">${g.count} times in 2 months</div></div>
            <span class="tx-amount">${esc(store.money(g.amount))}</span></div></button>`).join('')}
        </div><div class="section-footer">Tap one to make it a button.</div></div>` : ''}
        <div class="section"><div class="list"><button class="row tap" data-new>${tile('plus', 'blue')}<div class="row-main"><span class="row-title" style="flex:1">Make a Button</span><i class="ph ph-caret-right row-chevron"></i></div></button></div></div>`;
      content._ideas = ideas;
    },
  });
  page.content.addEventListener('click', async e => {
    if (e.target.closest('[data-new]')) { newQuickAdd(); return; }
    const idea = e.target.closest('[data-idea]');
    if (idea) {
      const g = page.content._ideas[Number(idea.dataset.idea)];
      addQuick({ note: g.note, amount: g.amount, categoryId: g.categoryId, accountId: g.accountId || null });
      return;
    }
    const row = e.target.closest('[data-q]');
    if (!row) return;
    const choice = await actionSheet({ actions: [
      { text: 'Change Amount', value: 'amount', icon: 'pencil-simple' },
      { text: 'Move to the Front', value: 'front', icon: 'arrow-up' },
      { text: 'Remove Button', value: 'remove', style: 'destructive' },
    ] });
    const list = settings().quickAdds;
    const q = list.find(x => x.id === row.dataset.q);
    if (!q || !choice) return;
    if (choice === 'amount') {
      const amount = await pickAmount({ title: q.note, initial: q.amount, currency: store.currency, allowZero: false });
      if (amount) store.saveQuickAdds(list.map(x => (x.id === q.id ? { ...x, amount } : x)));
    } else if (choice === 'front') {
      store.saveQuickAdds([q, ...list.filter(x => x.id !== q.id)]);
    } else {
      store.saveQuickAdds(list.filter(x => x.id !== q.id));
    }
    syncWidgetQuick();
  });
}

// ---------- No-spend challenges

const PRESETS = [
  { name: 'No eating out', categoryId: 'food', icon: 'fork-knife' },
  { name: 'No shopping', categoryId: 'shopping', icon: 'bag' },
  { name: 'No spending at all', categoryId: null, icon: 'prohibit' },
];

async function startChallenge() {
  const actions = [
    ...PRESETS.filter(p => !p.categoryId || store.state.categories.some(c => c.id === p.categoryId)).map((p, i) => ({ text: p.name, value: `p${i}`, icon: p.icon })),
    { text: 'Pick a Category…', value: 'pick', icon: 'squares-four' },
  ];
  const choice = await actionSheet({ title: 'Start a Challenge', message: 'Count the days in a row you don’t spend on it. Try to beat your best!', actions });
  if (!choice) return;
  if (choice === 'pick') {
    const id = await actionSheet({ title: 'No spending on…', actions: store.categories('expense').map(c => ({ text: c.name, value: c.id, icon: c.icon })) });
    if (!id) return;
    store.startChallenge({ name: `No ${store.category(id).name.toLowerCase()}`, categoryId: id });
  } else {
    const p = PRESETS[Number(choice.slice(1))];
    store.startChallenge({ name: p.name, categoryId: p.categoryId });
  }
  haptic('success');
  toast('Challenge started — good luck!', { iconName: 'flame' });
}

const dayWord = n => `${n} day${n === 1 ? '' : 's'}`;

/** A small card per running challenge for Summary. */
export function streaksHTML() {
  const list = store.state.challenges;
  if (!list.length) return '';
  return `<div class="ju-tiles streak-tiles" style="margin-top:12px">${list.slice(0, 2).map(c => {
    const s = L.streak(c, store.state.transactions);
    return `<button class="ju-tile" data-open-challenges><b>${icon('flame', true)} ${esc(dayWord(s.current))}</b><span>${esc(c.name)}</span>
      <small>${s.spentToday ? 'Spent today — start again tomorrow' : s.current >= s.best && s.current > 1 ? 'Your best yet!' : `Best ${esc(dayWord(s.best))}`}</small></button>`;
  }).join('')}</div>`;
}

export function openChallenges() {
  const page = livePage({
    title: 'No-Spend Challenges',
    rightHTML: `<button class="icon-btn" aria-label="Start a challenge">${icon('plus')}</button>`,
    onRight: startChallenge,
    render: content => {
      const list = store.state.challenges;
      content.innerHTML = list.length ? `
        <div class="section" style="margin-top:12px"><div class="list">${list.map(c => {
          const s = L.streak(c, store.state.transactions);
          return `<button class="row tap" data-ch="${esc(c.id)}">${tile('flame', s.current ? 'orange' : 'gray', 'lg')}<div class="row-main"><div class="row-text">
            <div class="row-title">${esc(c.name)}</div><div class="row-sub">Best ${esc(dayWord(s.best))} · since ${esc(L.shortDate(c.startDate))}</div></div>
            <span class="tx-amount">${esc(dayWord(s.current))}</span></div></button>`;
        }).join('')}</div><div class="section-footer">A day counts when you add nothing in it. Tap one to stop it.</div></div>
        <div class="section"><div class="list"><button class="row tap" data-start>${tile('plus', 'blue')}<div class="row-main"><span class="row-title" style="flex:1">Start Another</span><i class="ph ph-caret-right row-chevron"></i></div></button></div></div>` : `
        <div class="empty" style="padding:12vh 24px 12px">${icon('flame', true)}<strong>Save by skipping</strong>Pick something to stop for a while — eating out, shopping — and watch the days add up.
          <div><button class="btn" data-start>${icon('plus')} Start a Challenge</button></div></div>`;
    },
  });
  page.content.addEventListener('click', async e => {
    if (e.target.closest('[data-start]')) { startChallenge(); return; }
    const row = e.target.closest('[data-ch]');
    if (!row) return;
    const choice = await actionSheet({ actions: [{ text: 'Stop This Challenge', value: 'stop', style: 'destructive' }] });
    if (choice === 'stop') store.endChallenge(row.dataset.ch);
  });
}

// ---------- Getting started (for someone new): a short list of the things that make the app useful

function steps() {
  const st = store.state;
  const s = st.settings;
  return [
    { key: 'add', done: st.transactions.length > 0, title: 'Add your first expense', button: 'Add' },
    { key: 'budget', done: !!st.budgets.income, title: 'Plan your month', button: 'Plan' },
    native.isApp
      ? { key: 'sms', done: !!st.sms.enabled, title: 'Let it read bank messages', button: 'Turn On' }
      : { key: 'email', done: !!(s.email.url && s.email.enabled), title: 'Connect bank emails', button: 'Connect' },
    { key: 'quick', done: s.quickAdds.length > 0, title: 'Make a quick button', button: 'Make' },
    { key: 'backup', done: !!(s.sync.enabled || s.backup.folder || s.backup.last), title: 'Keep a backup', button: 'Set Up' },
  ];
}

export function checklistHTML() {
  if (settings().quickStart.hidden) return '';
  const list = steps();
  const left = list.filter(x => !x.done);
  if (!left.length) return '';
  const done = list.length - left.length;
  return `<div class="ju-card quick-start" style="margin-top:12px">
    <div class="qs-head"><div><div class="ju-eyebrow">Getting started</div><h2 style="margin:4px 0 0">${done} of ${list.length} done</h2></div>
      <button class="ju-btn ghost sm" data-qs-hide>Hide</button></div>
    <div class="ju-bar" style="margin:12px 0 6px"><i style="width:${(done / list.length) * 100}%"></i></div>
    ${list.map(x => `<div class="ju-row qs-row ${x.done ? 'done' : ''}">${icon(x.done ? 'check-circle' : 'circle', x.done)}
      <span class="grow"><b>${esc(x.title)}</b></span>${x.done ? '' : `<button class="ju-btn sm ${x === left[0] ? 'primary' : ''}" data-qs="${x.key}">${esc(x.button)}</button>`}</div>`).join('')}
  </div>`;
}

export function hideChecklist() {
  store.setSetting('quickStart', { ...settings().quickStart, hidden: true });
  toast('Hidden — you’ll find all of it in Settings', { iconName: 'check' });
}

// ---------- What's new (once, after an update)

const NEW_THINGS = [
  ['calendar-check', 'Plan your month', 'Your income, split into rent, EMIs, food, travel… and what’s left of each, every day.'],
  ['house', 'A simpler Summary', 'What you spent, your plan, what needs doing — and everything else one tap away under More.'],
  ['robot', 'Money Buddy', 'Tells you how you’re spending and what you’re losing: plans running low, bank charges, double charges, renewals.'],
  ['gauge', 'A word after adding', '“Food: 82% used, 12 days left — about ₹90 a day from here.” Settings → Money Buddy Tips.'],
]

export function maybeShowWhatsNew() {
  const s = settings();
  if (s.seenVersion === APP_VERSION) return;
  const upgrading = store.state.transactions.length > 0 && s.onboarded;
  store.setSetting('seenVersion', APP_VERSION);
  if (!upgrading) return;
  const handle = openSheet({
    size: 'large',
    html: `<header class="sheet-header" data-drag><span></span><h2 class="sheet-title">What’s New</h2><button class="nav-btn strong wn-done">Done</button></header>
      <div class="sheet-body" style="padding:8px 20px 24px">
        <div class="ju-eyebrow" style="text-align:center;margin:6px 0 14px">Expenses ${esc(APP_VERSION)}</div>
        ${NEW_THINGS.map(([i, t, d]) => `<div class="ju-row" style="cursor:default">${tile(i, 'gray', 'lg')}<span class="grow"><b>${esc(t)}</b><small>${esc(d)}</small></span></div>`).join('')}
        <button class="ju-btn primary wn-done" style="width:100%;margin-top:18px">Continue</button>
      </div>`,
  });
  handle.el.addEventListener('click', e => { if (e.target.closest('.wn-done')) handle.close('done'); });
}
