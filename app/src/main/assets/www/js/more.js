// 1.6: bank charges, refunds, cashback & points, the shopping list, documents & renewals, the year in
// review, paying with UPI, and savings tips. Every page opens with one card that answers its question.
import { store } from './store.js';
import { native } from './native.js';
import * as L from './logic.js';
import { esc, icon, tile, pushPage, actionSheet, alert, toast, haptic, promptText, pickAmount, pickDate } from './ui.js';
import { txRow } from './rows.js';
import { openEditor, showPhoto } from './editor.js';
import { upiLink, isUpiId } from './qr.js';

const money = v => store.money(v);
const day = iso => L.shortDate(iso);

function livePage(options) {
  let unsubscribe = () => {};
  const page = pushPage({ ...options, onClose: () => unsubscribe() });
  unsubscribe = store.subscribe(() => page.refresh());
  return page;
}

const answer = (eyebrow, figure, line, extra = '') => `<div class="ju-card page-answer">
  <div class="ju-eyebrow">${esc(eyebrow)}</div><div class="big num">${esc(figure)}</div>
  <div class="ju-muted">${line}</div>${extra}</div>`;

const openTx = e => {
  const row = e.target.closest('.tx-row');
  const tx = row && store.state.transactions.find(t => t.id === row.dataset.id);
  if (tx) openEditor(tx);
};

// ---------- Bank charges

export function openFees() {
  const page = livePage({
    title: 'Bank Charges',
    render: content => {
      const f = L.feesSummary(store.state.transactions);
      content.innerHTML = f.list.length ? `
        ${answer(`This year · ${f.start.slice(0, 4)}`, money(f.total), `${f.list.length} charge${f.list.length === 1 ? '' : 's'} taken by your bank and cards`)}
        <div class="section"><div class="list">${f.list.slice(0, 60).map(t => txRow(t, { swipe: false, showDate: true })).join('')}</div>
          <div class="section-footer">Found in your bank messages: annual fees, SMS charges, minimum-balance charges, late fees, interest. Most banks waive an annual fee if you ask, and paid SMS alerts can be switched off — this app reads them anyway.</div></div>`
        : `<div class="empty" style="padding-top:8vh">${icon('bank', true)}<strong>No bank charges this year</strong>Annual fees, SMS charges, late fees and interest from your bank messages are added up here.</div>`;
    },
  });
  page.content.addEventListener('click', openTx);
}

// ---------- Refunds

export async function expectRefund(tx) {
  const choice = await actionSheet({
    title: `Waiting for money back from ${tx.note || 'this'}?`,
    message: 'When the refund arrives in your bank, it’s found by itself. You’ll get a nudge if it takes more than a week.',
    actions: [
      { text: `All of it · ${money(tx.amount)}`, value: 'all', icon: 'arrow-u-up-left' },
      { text: 'Part of It…', value: 'part', icon: 'pencil-simple' },
    ],
  });
  if (!choice) return;
  let amount = 0;
  if (choice === 'part') {
    amount = await pickAmount({ title: 'How much comes back?', initial: tx.amount, currency: store.currency, allowZero: false });
    if (!amount) return;
  }
  store.setRefund(tx.id, amount);
  haptic('success');
  toast('Waiting for the refund — Insights → Refunds', { iconName: 'arrow-u-up-left' });
}

export function openRefunds() {
  const page = livePage({
    title: 'Refunds',
    render: content => {
      const list = L.refunds(store.state.transactions);
      const waiting = list.filter(x => !x.status.done);
      const total = waiting.reduce((sum, x) => sum + (x.t.refund.amount || x.t.amount), 0);
      const row = ({ t, status }) => `<button class="row tap" data-refund="${esc(t.id)}">${tile(status.done ? 'check-circle' : 'hourglass-medium', status.done ? 'green' : status.waiting >= 7 ? 'orange' : 'gray', 'lg')}
        <div class="row-main"><div class="row-text"><div class="row-title">${esc(t.note || store.category(t.categoryId).name)}</div>
        <div class="row-sub">${status.done ? `Back on ${esc(day(status.done))}` : `Waiting ${status.waiting} day${status.waiting === 1 ? '' : 's'} · since ${esc(day(t.refund.since))}`}</div></div>
        <span class="tx-amount">${esc(money(t.refund.amount || t.amount))}</span></div></button>`;
      content.innerHTML = list.length ? `
        ${waiting.length ? answer('Waiting to come back', money(total), `${waiting.length} refund${waiting.length === 1 ? '' : 's'}${waiting.some(x => x.status.waiting >= 7) ? ' · some over a week — follow up' : ''}`) : answer('All refunds', 'All back', 'Nothing is waiting.')}
        <div class="section"><div class="list">${list.map(row).join('')}</div>
          <div class="section-footer">To add one: open the purchase in Transactions and tap “Expect a Refund”.</div></div>`
        : `<div class="empty" style="padding-top:8vh">${icon('arrow-u-up-left', true)}<strong>No refunds waiting</strong>Returned something or cancelled an order? Open it in Transactions and tap “Expect a Refund” — you’ll know when the money is back.</div>`;
    },
  });
  page.content.addEventListener('click', async e => {
    const row = e.target.closest('[data-refund]');
    const tx = row && store.state.transactions.find(t => t.id === row.dataset.refund);
    if (!tx) return;
    const done = L.refundStatus(tx, store.state.transactions).done;
    const choice = await actionSheet({ title: tx.note || 'Refund', actions: [
      ...(done ? [] : [{ text: 'It Came Back', value: 'back', icon: 'check-circle' }]),
      { text: 'Open the Purchase', value: 'open', icon: 'receipt' },
      { text: done ? 'Remove from This List' : 'Stop Waiting', value: 'clear', style: 'destructive' },
    ] });
    if (choice === 'back') { store.refundArrived(tx.id); haptic('success'); }
    else if (choice === 'open') openEditor(tx);
    else if (choice === 'clear') store.clearRefund(tx.id);
  });
}

// ---------- Cashback & reward points

export function openCashback() {
  const page = livePage({
    title: 'Cashback & Points',
    render: content => {
      const c = L.cashbackSummary(store.state.transactions, store.state.sms.points);
      content.innerHTML = c.list.length || c.cards.length ? `
        ${answer('Cashback this year', money(c.total), `${c.list.length} credit${c.list.length === 1 ? '' : 's'} back from cards and apps`)}
        ${c.cards.length ? `<div class="section"><div class="section-header">Reward points</div><div class="list">${c.cards.map(p => `
          <div class="row">${tile('star', 'yellow', 'lg')}<div class="row-main"><div class="row-text">
            <div class="row-title">${esc([p.bank, p.last4 ? `••${p.last4}` : ''].filter(Boolean).join(' '))}</div>
            <div class="row-sub">${p.earned ? `+${p.earned.toLocaleString('en-IN')} last time · ` : ''}${esc(day(L.toISO(new Date(p.time))))}</div></div>
            <span class="tx-amount">${p.points !== null && p.points !== undefined ? `${p.points.toLocaleString('en-IN')} pts` : '—'}</span></div></div>`).join('')}</div>
          <div class="section-footer">From your card messages. Points often expire — use them before they do.</div></div>` : ''}
        ${c.list.length ? `<div class="section"><div class="section-header">Cashback</div><div class="list">${c.list.slice(0, 40).map(t => txRow(t, { swipe: false, showDate: true })).join('')}</div></div>` : ''}`
        : `<div class="empty" style="padding-top:8vh">${icon('gift', true)}<strong>No cashback yet</strong>Cashback credits and reward points from your bank and card messages are collected here.</div>`;
    },
  });
  page.content.addEventListener('click', openTx);
}

// ---------- Shopping list

async function addItem() {
  const name = await promptText({ title: 'Add to the List', placeholder: 'Milk, shoes, a gift…', maxLength: 40 });
  if (!name) return;
  const price = await pickAmount({ title: `${name}: about how much?`, subtitle: 'Leave at 0 if you don’t know', currency: store.currency, allowZero: true, doneText: 'Add' });
  if (price === null) return;
  store.addShopping(name, price);
  haptic('success');
}

export function openShopping() {
  const page = livePage({
    title: 'Shopping List',
    rightHTML: `<button class="icon-btn" aria-label="Add">${icon('plus')}</button>`,
    onRight: addItem,
    render: content => {
      const list = store.state.shopping;
      const total = list.reduce((sum, x) => sum + (x.price || 0), 0);
      content.innerHTML = list.length ? `
        ${answer('To buy', `${list.length} thing${list.length === 1 ? '' : 's'}`, total ? `about ${esc(money(total))} in all` : 'add prices to see the total')}
        <div class="section"><div class="list">${list.map(x => `
          <div class="row shop-row"><button class="shop-tick" data-bought="${esc(x.id)}" aria-label="Bought ${esc(x.name)}">${icon('circle')}</button>
            <button class="row-main tap" data-item="${esc(x.id)}"><span class="row-title" style="flex:1">${esc(x.name)}</span>
            <span class="row-value">${x.price ? esc(money(x.price)) : ''}</span></button></div>`).join('')}</div>
          <div class="section-footer">Tick it when you buy it: it becomes an expense, ready to check and add.</div></div>
        <div style="padding:0 16px"><button class="ju-btn" data-add-item style="width:100%">${icon('plus')} Add to the List</button></div>`
        : `<div class="empty" style="padding-top:8vh">${icon('shopping-cart-simple', true)}<strong>Nothing to buy</strong>Plan what you need with rough prices, then tick things off as you buy them.
          <div><button class="btn" data-add-item>${icon('plus')} Add to the List</button></div></div>`;
    },
  });
  page.content.addEventListener('click', async e => {
    if (e.target.closest('[data-add-item]')) { addItem(); return; }
    const bought = e.target.closest('[data-bought]');
    if (bought) {
      const item = store.state.shopping.find(x => x.id === bought.dataset.bought);
      if (!item) return;
      openEditor(null, {
        type: 'expense', note: item.name, ...(item.price ? { amount: item.price } : {}), categoryId: store.likelyCategory('expense'),
        source: 'From your shopping list',
        onSave: fields => { const tx = store.addTransaction(fields); store.removeShopping(item.id); return tx; },
      });
      return;
    }
    const row = e.target.closest('[data-item]');
    const item = row && store.state.shopping.find(x => x.id === row.dataset.item);
    if (!item) return;
    const choice = await actionSheet({ title: item.name, actions: [
      { text: item.price ? 'Change Price' : 'Add a Price', value: 'price', icon: 'pencil-simple' },
      { text: 'Rename', value: 'name', icon: 'textbox' },
      { text: 'Remove', value: 'remove', style: 'destructive' },
    ] });
    if (choice === 'price') {
      const price = await pickAmount({ title: item.name, initial: item.price || 0, currency: store.currency, allowZero: true });
      if (price !== null) store.updateShopping(item.id, { price });
    } else if (choice === 'name') {
      const name = await promptText({ title: 'Rename', value: item.name, maxLength: 40 });
      if (name) store.updateShopping(item.id, { name });
    } else if (choice === 'remove') {
      store.removeShopping(item.id);
    }
  });
}

// ---------- Documents & renewals

async function newDocument() {
  const kind = await actionSheet({ title: 'What runs out?', actions: L.DOC_KINDS.map(k => ({ text: k.label, value: k.key, icon: k.icon })) });
  if (!kind) return;
  const k = L.docKind(kind);
  const name = kind === 'other' ? await promptText({ title: 'Name', placeholder: 'Gym membership, shop licence…', maxLength: 40 }) : k.label;
  if (!name) return;
  const expires = await pickDate(L.addMonths(L.todayISO(), 12), { title: 'Runs Out On' });
  if (!expires) return;
  const doc = store.saveDocument({ name, kind, expires });
  haptic('success');
  const photo = await alert({ title: 'Add a photo of it?', message: 'Keep a picture of the policy or card on this phone, to show when needed.',
    buttons: [{ text: 'Not Now', value: false, style: 'cancel' }, { text: 'Add Photo', value: true }] });
  if (photo) addDocPhoto(doc);
}

async function addDocPhoto(doc) {
  const picked = await native.pickPhoto();
  if (!picked.ok) { if (picked.error) toast(picked.error, { iconName: 'warning-circle' }); return; }
  if (await native.savePhoto(`doc-${doc.id}`, picked.dataUrl)) store.saveDocument({ ...doc, photo: true });
  else toast('Couldn’t save the photo', { iconName: 'warning-circle' });
}

export function openDocuments() {
  const page = livePage({
    title: 'Documents & Renewals',
    rightHTML: `<button class="icon-btn" aria-label="Add">${icon('plus')}</button>`,
    onRight: newDocument,
    render: content => {
      const docs = store.state.documents.slice().sort((a, b) => (a.expires < b.expires ? -1 : 1));
      const next = docs.find(d => !L.docStatus(d).expired) || docs[0];
      const row = d => {
        const s = L.docStatus(d);
        const k = L.docKind(d.kind);
        return `<button class="row tap" data-doc="${esc(d.id)}">${tile(k.icon, s.expired ? 'red' : s.soon ? 'orange' : 'gray', 'lg')}
          <div class="row-main"><div class="row-text"><div class="row-title">${esc(d.name)}${d.photo ? ` ${icon('camera')}` : ''}</div>
          <div class="row-sub">${s.expired ? `Ran out ${esc(day(d.expires))}` : `Until ${esc(day(d.expires))}`}</div></div>
          <span class="ju-pill ${s.expired ? 'bad' : s.soon ? 'warn' : ''}">${s.expired ? 'Renew' : s.days === 0 ? 'Today' : `${s.days} days`}</span></div></button>`;
      };
      content.innerHTML = docs.length ? `
        ${answer('Next to renew', next.name, (() => { const s = L.docStatus(next); return s.expired ? `ran out on ${esc(day(next.expires))}` : `in ${s.days} day${s.days === 1 ? '' : 's'} · ${esc(day(next.expires))}`; })())}
        <div class="section"><div class="list">${docs.map(row).join('')}</div>
          <div class="section-footer">You’ll be reminded a month before, a week before and on the day.</div></div>`
        : `<div class="empty" style="padding-top:8vh">${icon('files', true)}<strong>Never miss a renewal</strong>Car and bike insurance, PUC, driving licence, passport, health insurance — with a photo and a reminder before each runs out.
          <div><button class="btn" data-new-doc>${icon('plus')} Add a Document</button></div></div>`;
    },
  });
  page.content.addEventListener('click', async e => {
    if (e.target.closest('[data-new-doc]')) { newDocument(); return; }
    const row = e.target.closest('[data-doc]');
    const doc = row && store.state.documents.find(d => d.id === row.dataset.doc);
    if (!doc) return;
    const choice = await actionSheet({ title: doc.name, actions: [
      ...(doc.photo ? [{ text: 'View Photo', value: 'view', icon: 'image' }] : []),
      { text: 'Renewed — New Date', value: 'date', icon: 'calendar-blank' },
      { text: doc.photo ? 'Replace Photo' : 'Add Photo', value: 'photo', icon: 'camera' },
      { text: 'Rename', value: 'name', icon: 'textbox' },
      { text: 'Delete', value: 'delete', style: 'destructive' },
    ] });
    if (choice === 'view') {
      const url = await native.photoUrl(`doc-${doc.id}`);
      if (url) showPhoto(url);
    } else if (choice === 'date') {
      const expires = await pickDate(L.addMonths(doc.expires, 12), { title: 'Runs Out On' });
      if (expires) store.saveDocument({ ...doc, expires });
    } else if (choice === 'photo') {
      addDocPhoto(doc);
    } else if (choice === 'name') {
      const name = await promptText({ title: 'Rename', value: doc.name, maxLength: 40 });
      if (name) store.saveDocument({ ...doc, name });
    } else if (choice === 'delete') {
      if (doc.photo) native.deletePhoto(`doc-${doc.id}`);
      store.deleteDocument(doc.id);
    }
  });
}

/** Reminders for documents: a month before, a week before and on the day, at 9 in the morning. */
export function documentReminders(now = Date.now()) {
  const list = [];
  for (const d of store.state.documents) {
    for (const before of [30, 7, 0]) {
      const when = L.parseISO(L.addDays(d.expires, -before));
      const at = new Date(when.getFullYear(), when.getMonth(), when.getDate(), 9, 0).getTime();
      if (at <= now) continue;
      list.push({ id: `doc|${d.id}|${d.expires}|${before}`, title: before ? `${d.name} runs out in ${before === 30 ? 'a month' : 'a week'}` : `${d.name} runs out today`,
        text: `Valid until ${L.shortDate(d.expires)} — renew it in time.`, at, open: 'home' });
    }
  }
  return list;
}

// ---------- The year in review

function yearPicture(y) {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const g = c.getContext('2d');
  g.fillStyle = '#141416';
  g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = '#c2410c';
  g.fillRect(90, 120, 10, 120);
  g.fillStyle = '#f5f5f7';
  g.textBaseline = 'alphabetic';
  g.font = '800 96px Geist, system-ui, sans-serif';
  g.fillText(`My ${y.year}`, 130, 220);
  g.fillStyle = 'rgba(245,245,247,.6)';
  g.font = '600 34px Geist, system-ui, sans-serif';
  g.fillText('SPENT', 90, 380);
  g.fillStyle = '#f5f5f7';
  g.font = '800 120px Geist, system-ui, sans-serif';
  g.fillText(money(y.expense), 90, 500, 900);
  const line = (label, value, top) => {
    g.fillStyle = 'rgba(245,245,247,.6)';
    g.font = '600 32px Geist, system-ui, sans-serif';
    g.fillText(label, 90, top);
    g.fillStyle = '#f5f5f7';
    g.font = '750 52px Geist, system-ui, sans-serif';
    g.fillText(value, 90, top + 62, 900);
  };
  line('CAME IN', money(y.income), 620);
  line('KEPT', money(y.net), 760);
  line('BIGGEST MONTH', new Date(y.year, y.biggestMonth.month, 1).toLocaleDateString('en-IN', { month: 'long' }), 900);
  line('TOP SPEND', y.top[0] ? store.category(y.top[0].categoryId).name : '—', 1040);
  g.fillStyle = 'rgba(245,245,247,.45)';
  g.font = '500 28px Geist, system-ui, sans-serif';
  g.fillText(`${y.count} transactions · ${y.noSpendDays} no-spend days · made with Expenses`, 90, 1260, 900);
  return c.toDataURL('image/png');
}

function statementHtml(y) {
  const list = L.sortTransactions(L.inRange(store.state.transactions, y.start, y.end)).reverse();
  const rows = list.map(t => `<tr><td>${esc(t.date.split('-').reverse().join('-'))}</td><td>${esc(t.note || (t.categoryId ? store.category(t.categoryId).name : L.typeLabel(t)))}</td>
    <td>${esc(t.categoryId ? store.category(t.categoryId).name : L.typeLabel(t))}</td><td class="r">${t.type === 'expense' ? esc(money(t.amount)) : ''}</td><td class="r">${t.type === 'income' ? esc(money(t.amount)) : ''}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Statement ${y.year}</title><style>
    body{font:12px/1.4 system-ui,sans-serif;color:#000;background:#fff;margin:28px}h1{font-size:22px;margin:0 0 4px}.sub{color:#555;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}th,td{padding:5px 6px;border-bottom:1px solid #ddd;text-align:left}th{font-size:11px;text-transform:uppercase;color:#555}
    .r{text-align:right;white-space:nowrap}tfoot td{font-weight:700;border-top:2px solid #000}</style></head><body>
    <h1>Statement ${y.year}</h1><div class="sub">${list.length} transactions · made ${esc(day(L.todayISO()))}</div>
    <table><thead><tr><th>Date</th><th>For</th><th>Category</th><th class="r">Spent</th><th class="r">Received</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td class="r">${esc(money(y.expense))}</td><td class="r">${esc(money(y.income))}</td></tr></tfoot></table></body></html>`;
}

export function openYear() {
  let year = Number(L.todayISO().slice(0, 4));
  const page = livePage({
    title: 'Your Year',
    render: content => {
      const y = L.yearReview(store.state.transactions, year);
      const tileH = (value, label, small) => `<div class="ju-tile money still"><b>${esc(value)}</b><span>${esc(label)}</span><small>${esc(small)}</small></div>`;
      content.innerHTML = `
        <div class="period-nav"><button class="icon-btn" data-year="-1" aria-label="Year before">${icon('caret-left')}</button><strong>${year}</strong>
          <button class="icon-btn" data-year="1" aria-label="Next year" ${year >= Number(L.todayISO().slice(0, 4)) ? 'disabled style="opacity:.3"' : ''}>${icon('caret-right')}</button></div>
        ${y.count ? `
        ${answer(`${year}${y.days < 365 ? ' so far' : ''}`, money(y.expense), `spent · ${esc(money(y.income))} came in · ${esc(money(y.net))} kept`)}
        <div class="ju-tiles home-tiles">
          ${tileH(money(y.perDay), 'Per day', 'on average')}
          ${tileH(new Date(year, y.biggestMonth.month, 1).toLocaleDateString('en-IN', { month: 'long' }), 'Biggest month', money(y.biggestMonth.total))}
          ${tileH(String(y.noSpendDays), 'No-spend days', 'nothing spent')}
          ${tileH(String(y.count), 'Transactions', 'added this year')}
        </div>
        ${y.top.length ? `<div class="ju-card home-card"><div class="head"><h2>Where it went</h2></div><div class="list">${y.top.map(r => {
          const c = store.category(r.categoryId);
          return `<div class="row">${tile(c.icon, c.color, 'lg')}<div class="row-main"><span class="row-title" style="flex:1">${esc(c.name)}</span><span class="tx-amount">${esc(money(r.total))}</span></div></div>`;
        }).join('')}</div></div>` : ''}
        ${y.biggest ? `<div class="ju-card home-card"><div class="head"><h2>Biggest spend</h2></div><div class="list">${txRow(y.biggest, { swipe: false, showDate: true })}</div></div>` : ''}
        <div class="ins-share" style="display:grid;gap:8px">
          <button class="ju-btn primary" data-year-picture>${icon('image-square')} Share My ${year}</button>
          <button class="ju-btn" data-year-print>${icon('printer')} Print a Statement</button>
        </div>` : `<div class="empty" style="padding-top:6vh">${icon('calendar-blank', true)}<strong>Nothing in ${year}</strong>Transactions from this year show up here.</div>`}`;
    },
  });
  page.content.addEventListener('click', async e => {
    const step = e.target.closest('[data-year]');
    if (step && !step.disabled) { year += Number(step.dataset.year); haptic('selection'); page.refresh(); return; }
    const y = L.yearReview(store.state.transactions, year);
    if (e.target.closest('[data-year-picture]')) {
      const result = await native.sendImageWithText(`my-${year}.png`, yearPicture(y), `My ${year} with Expenses: ${money(y.expense)} spent, ${money(y.net)} kept.`);
      if (result && result.ok === false && !result.cancelled && result.error) toast(result.error, { iconName: 'warning-circle' });
      return;
    }
    if (e.target.closest('[data-year-print]')) {
      const result = await native.printHtml(statementHtml(y), `Statement ${year}`);
      if (result && !result.ok && result.error) alert({ title: 'Couldn’t make the statement', message: result.error });
      return;
    }
    openTx(e);
  });
}

// ---------- Pay with UPI (Android: hands the payment to GPay, PhonePe, Paytm…)

export const canPayUpi = () => native.isApp || /Android/i.test(navigator.userAgent || '');

/** Opens the phone's UPI app for this payment, then asks whether it went through. Resolves true only on a yes. */
export async function payWithUpi({ name = '', amount, note = '' }) {
  if (!canPayUpi() || !amount) return false;
  const contacts = store.state.settings.upiContacts;
  const key = L.personKey(name);
  let vpa = key && contacts[key];
  if (!vpa) {
    vpa = await promptText({ title: `${name ? `${name}’s` : 'Their'} UPI ID`, placeholder: 'name@okhdfcbank', maxLength: 80 });
    if (!vpa) return false;
    vpa = vpa.trim();
    if (!isUpiId(vpa)) { alert({ title: 'That isn’t a UPI ID', message: 'It looks like name@bank — for example 98xxxxxx10@ybl or name@okaxis.' }); return false; }
    if (key) { contacts[key] = vpa; store.saveKeepingTime(); }
  }
  const back = waitForReturn();
  location.href = upiLink({ vpa, name: name || vpa, amount, note: note || 'Paid with Expenses' });
  await back;
  return alert({
    title: `Did ${money(amount)} go to ${name || vpa}?`,
    message: 'Say yes only if your UPI app showed the payment as successful.',
    buttons: [{ text: 'No', value: false, style: 'cancel' }, { text: 'Yes, Paid', value: true }],
  });
}

function waitForReturn() {
  return new Promise(resolve => {
    let left = false;
    const finish = () => { document.removeEventListener('visibilitychange', onChange); resolve(); };
    const onChange = () => { if (document.hidden) left = true; else if (left) setTimeout(finish, 300); };
    document.addEventListener('visibilitychange', onChange);
    setTimeout(() => { if (!left) finish(); }, 5000); // no UPI app opened (or the page never hid): ask anyway
  });
}

// ---------- Savings tips (Insights)

export function tipsHTML() {
  const tips = L.savingsTips(store.state, { categoryName: id => store.category(id).name, money });
  if (!tips.length) return '';
  return `<div class="ju-card home-card"><div class="head"><h2>Ways to save</h2></div>
    <div class="list">${tips.map(t => `<div class="row tip-row">${tile(t.icon, 'green', 'lg')}<div class="row-main"><div class="row-text">
      <div class="row-title">${esc(t.title)}</div><div class="row-sub tip-text">${esc(t.text)}</div></div></div></div>`).join('')}</div>
    <div class="ju-muted ju-small" style="margin-top:6px">From your own spending in the last 30 days.</div></div>`;
}
