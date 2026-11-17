// Net worth (what you own minus what you owe) and the tax-saving summary for the year.
import { store } from './store.js';
import * as L from './logic.js';
import { esc, icon, tile, pushPage, actionSheet, toast, haptic, promptText, pickAmount } from './ui.js';
import { openEditor } from './editor.js';

function livePage(options) {
  let unsubscribe = () => {};
  const page = pushPage({ ...options, onClose: () => unsubscribe() });
  unsubscribe = store.subscribe(() => page.refresh());
  return page;
}

async function addInvestment() {
  const name = await promptText({ title: 'Add an Investment', placeholder: 'Mutual funds, FD, PPF, Gold, Shares…' });
  if (!name) return;
  const value = await pickAmount({ title: `${name}: what is it worth now?`, currency: store.currency, allowZero: true });
  if (value === null) return;
  store.saveAccount({ name, icon: 'trend-up', color: 'teal', openingBalance: 0, kind: 'investment', value, valueDate: L.todayISO() });
  haptic('success');
}

export function openNetWorth() {
  const page = livePage({
    title: 'Net Worth',
    rightHTML: `<button class="icon-btn" aria-label="Add investment">${icon('plus')}</button>`,
    onRight: addInvestment,
    render: content => {
      const st = store.state;
      const w = L.netWorth(st);
      const balances = L.accountBalances(st.accounts, st.transactions);
      const investments = st.accounts.filter(L.isInvestmentAccount);
      const line = (label, value, sign, color) => `<div class="row"><div class="row-main"><span class="row-title" style="flex:1">${esc(label)}</span>
        <span class="row-value" style="color:${color}">${sign}${esc(store.money(value))}</span></div></div>`;
      content.innerHTML = `
        <div class="card" style="margin-top:12px"><div class="card-label">${icon('scales', true)} What you’re worth</div>
          <div class="hero-amount num" style="font-size:38px;color:${w.total < 0 ? 'var(--red)' : 'var(--label)'}">${esc(store.money(w.total))}</div>
          <div class="hero-sub">Everything you own, minus everything you owe.</div></div>
        <div class="section"><div class="section-header">You own</div><div class="list">
          ${line('Cash & bank', w.cash, '', 'var(--label)')}
          ${line('Investments', w.invested, '', 'var(--green)')}
          ${w.owedToYou ? line('Money people owe you', w.owedToYou, '', 'var(--green)') : ''}
        </div></div>
        <div class="section"><div class="section-header">You owe</div><div class="list">
          ${line('Credit card dues', w.cardDues, '−', 'var(--red)')}
          ${w.emiLeft ? line('EMIs still to pay', w.emiLeft, '−', 'var(--red)') : ''}
          ${w.youOwe ? line('Money you owe people', w.youOwe, '−', 'var(--red)') : ''}
        </div></div>
        <div class="section"><div class="section-header">Investments</div><div class="list">
          ${investments.length ? investments.map(a => {
            const value = Number.isFinite(a.value) ? a.value : balances.get(a.id) || 0;
            return `<button class="row tap" data-inv="${esc(a.id)}">${tile(a.icon || 'trend-up', a.color || 'teal', 'lg')}
              <div class="row-main"><div class="row-text"><div class="row-title">${esc(a.name)}</div>
              <div class="row-sub">${Number.isFinite(a.value) ? `Value updated ${esc(L.shortDate(a.valueDate || L.todayISO()))}` : `Put in ${esc(store.money(balances.get(a.id) || 0))}`}</div></div>
              <span class="tx-amount">${esc(store.money(value))}</span></div></button>`;
          }).join('') : `<div class="row"><div class="row-main"><span class="row-title" style="flex:1;color:var(--label-2)">None yet — tap + to add one</span></div></div>`}
        </div><div class="section-footer">SIPs, FDs, PPF and stock purchases from your bank messages go to Investments by themselves — they’re saving, not spending. Tap one to update what it’s worth today.</div></div>`;
    },
  });
  page.content.addEventListener('click', async e => {
    const row = e.target.closest('[data-inv]');
    if (!row) return;
    const a = store.account(row.dataset.inv);
    const choice = await actionSheet({ title: a.name, actions: [
      { text: 'Update What It’s Worth', value: 'value', icon: 'pencil-simple' },
      { text: 'Add Money to It', value: 'add', icon: 'plus-circle' },
    ] });
    if (choice === 'value') {
      const value = await pickAmount({ title: `${a.name}: worth now`, initial: Number.isFinite(a.value) ? a.value : 0, currency: store.currency });
      if (value !== null) store.saveAccount({ ...a, value, valueDate: L.todayISO() });
    } else if (choice === 'add') {
      openEditor(null, { type: 'transfer', accountId: store.account('bank') ? 'bank' : null, toAccountId: a.id, note: a.name });
    }
  });
}

export function openTax() {
  const page = livePage({
    title: 'Tax Saving',
    render: content => {
      const year = L.taxYear();
      const sections = L.taxSummary(store.state.transactions, id => store.category(id).name);
      content.innerHTML = `
        <div class="card" style="margin-top:12px"><div class="card-label">${icon('receipt', true)} ${esc(year.label)}</div>
          <div class="hero-sub" style="margin-top:4px">What you paid this year that can lower your income tax (old tax regime). Show this to whoever files your ITR.</div></div>
        <div class="section"><div class="list">${sections.map(s => `
          <button class="row tap" data-sec="${esc(s.key)}"><div class="row-main"><div class="row-text">
            <div class="row-title">${esc(s.label)}</div>
            <div class="row-sub">${s.items.length ? `${s.items.length} payment${s.items.length === 1 ? '' : 's'}` : esc(s.note)}${s.limit ? ` · up to ${esc(store.money(s.limit))}` : ''}</div>
            ${s.limit ? `<div class="progress" style="margin-top:6px;--c:var(--green)"><span style="width:${Math.min(100, (s.total / s.limit) * 100)}%"></span></div>` : ''}
          </div><span class="tx-amount">${esc(store.money(s.total))}</span></div></button>`).join('')}</div>
          <div class="section-footer">Payments are sorted by their names (LIC, PPF, Star Health, rent…). To put one in or take it out, open it and tap More → Tax.</div></div>`;
    },
  });
  page.content.addEventListener('click', async e => {
    const row = e.target.closest('[data-sec]');
    if (!row) return;
    const s = L.taxSummary(store.state.transactions, id => store.category(id).name).find(x => x.key === row.dataset.sec);
    if (!s.items.length) { toast(s.note, { iconName: 'receipt' }); return; }
    const choice = await actionSheet({ title: s.label, actions: s.items.slice(0, 12).map(t => ({ text: `${t.note || store.category(t.categoryId).name} · ${store.money(t.amount)}`, value: t.id })) });
    const tx = store.state.transactions.find(t => t.id === choice);
    if (tx) openEditor(tx);
  });
}
