// Business expenses: everything marked "Business" in one place, and a claim report (PDF) with the
// bill photos for a reimbursement or your accountant.
import { store } from './store.js';
import { native } from './native.js';
import * as L from './logic.js';
import { esc, icon, tile, pushPage, alert, toast, haptic } from './ui.js';
import { openEditor } from './editor.js';

const photoData = id => native.photoDataUrl(id);

/** The report as a printable page. */
async function reportHtml(items) {
  const total = items.reduce((s, t) => s + t.amount, 0);
  const photos = [];
  for (const t of items) if (t.photo) photos.push({ t, data: await photoData(t.id) });
  const rows = items.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(L.shortDate(t.date))}</td><td>${esc(t.note || '')}</td><td>${esc(store.category(t.categoryId).name)}</td><td class="r">${esc(store.money(t.amount))}</td></tr>`).join('');
  const range = `${L.shortDate(items[items.length - 1].date)} – ${L.shortDate(items[0].date)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Expense claim</title><style>
    body{font:14px/1.45 Inter,system-ui,sans-serif;color:#000;margin:32px}
    h1{font-size:24px;margin:0 0 4px}.sub{color:#666;margin-bottom:20px}
    table{width:100%;border-collapse:collapse}th,td{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
    th{font-size:12px;text-transform:uppercase;color:#666}.r{text-align:right;white-space:nowrap}
    tfoot td{font-weight:700;border-top:2px solid #000;border-bottom:0}
    .ph{page-break-inside:avoid;margin-top:24px}.ph img{max-width:100%;max-height:900px;border:1px solid #ddd}
    .ph p{margin:0 0 6px;font-weight:600}</style></head><body>
    <h1>Expense claim</h1><div class="sub">${esc(range)} · ${items.length} item${items.length === 1 ? '' : 's'} · made ${esc(L.shortDate(L.todayISO()))}</div>
    <table><thead><tr><th>#</th><th>Date</th><th>For</th><th>Category</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4">Total</td><td class="r">${esc(store.money(total))}</td></tr></tfoot></table>
    ${photos.filter(p => p.data).map(p => `<div class="ph"><p>Bill ${items.indexOf(p.t) + 1}: ${esc(p.t.note || '')} · ${esc(store.money(p.t.amount))}</p><img src="${p.data}"></div>`).join('')}
    </body></html>`;
}

export function openClaims() {
  let unsubscribe = () => {};
  const page = pushPage({
    title: 'Business Expenses',
    onClose: () => unsubscribe(),
    render: content => {
      const all = L.sortTransactions(store.state.transactions.filter(t => t.business && t.type === 'expense'));
      const open = all.filter(t => !t.claimed);
      const done = all.filter(t => t.claimed);
      const total = open.reduce((s, t) => s + t.amount, 0);
      if (!all.length) {
        content.innerHTML = `<div class="empty" style="padding-top:14vh">${icon('briefcase', true)}<strong>No business expenses</strong>When you add something you’ll claim back or give your accountant, tap <b>Business</b> in it (and add a photo of the bill). Then make one claim report here.</div>`;
        return;
      }
      const row = t => `<button class="row tap" data-tx="${esc(t.id)}">${tile(store.category(t.categoryId).icon, store.category(t.categoryId).color, 'lg')}
        <div class="row-main"><div class="row-text"><div class="row-title">${esc(t.note || store.category(t.categoryId).name)}</div>
        <div class="row-sub">${esc(L.shortDate(t.date))}${t.photo ? ' · bill photo' : ' · no photo'}${t.claimed ? ` · claimed ${esc(L.shortDate(t.claimed))}` : ''}</div></div>
        <span class="tx-amount">${esc(store.money(t.amount))}</span></div></button>`;
      content.innerHTML = `
        ${open.length ? `
        <div class="card" style="margin-top:12px"><div class="card-label">To claim</div><div class="hero-amount num" style="font-size:34px">${esc(store.money(total))}</div>
          <div class="hero-sub">${open.length} expense${open.length === 1 ? '' : 's'} not claimed yet</div>
          <div style="margin-top:14px"><button class="btn" data-report>${icon('file-pdf')} Make Claim Report</button></div></div>
        <div class="section"><div class="section-header">Not claimed</div><div class="list">${open.map(row).join('')}</div></div>` : ''}
        ${done.length ? `<div class="section"><div class="section-header">Claimed</div><div class="list">${done.slice(0, 30).map(row).join('')}</div></div>` : ''}`;
    },
  });
  page.content.addEventListener('click', async e => {
    const tx = e.target.closest('[data-tx]');
    if (tx) {
      const t = store.state.transactions.find(x => x.id === tx.dataset.tx);
      if (t) openEditor(t);
      return;
    }
    if (!e.target.closest('[data-report]')) return;
    const open = L.sortTransactions(store.state.transactions.filter(t => t.business && t.type === 'expense' && !t.claimed));
    if (!open.length) return;
    const html = await reportHtml(open);
    const result = await native.printHtml(html, `Expense claim ${L.todayISO()}`);
    if (!result.ok) {
      if (result.error) alert({ title: 'Couldn’t make the report', message: result.error });
      return;
    }
    const mark = await alert({
      title: 'Mark them as claimed?',
      message: `${open.length} expense${open.length === 1 ? '' : 's'} (${store.money(open.reduce((s, t) => s + t.amount, 0))}) move to “Claimed”, so the next report only has new ones.`,
      buttons: [{ text: 'Not Yet', value: false, style: 'cancel' }, { text: 'Mark Claimed', value: true }],
    });
    if (mark) {
      store.markClaimed(open.map(t => t.id));
      haptic('success');
      toast('Marked as claimed', { iconName: 'check-circle' });
    }
  });
  unsubscribe = store.subscribe(() => page.refresh());
}
