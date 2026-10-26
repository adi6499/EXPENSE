// The Transactions tab: search, filter, grouped by day, swipe to delete.
import { store } from './store.js';
import * as L from './logic.js';
import { $, esc, icon, tile, segmented, bindSegmented, bindSwipeRows, openFormSheet, actionSheet, toast, haptic } from './ui.js';
import { txRow } from './rows.js';

const PAGE_SIZE = 150;

function presetPeriod(key, today = L.todayISO()) {
  const som = L.startOfMonth(today);
  switch (key) {
    case 'this-month': return { key, label: 'This Month', start: som, end: L.endOfMonth(today) };
    case 'last-month': {
      const start = L.addMonths(som, -1);
      return { key, label: 'Last Month', start, end: L.endOfMonth(start) };
    }
    case 'last-3': return { key, label: 'Last 3 Months', start: L.addMonths(som, -2), end: L.endOfMonth(today) };
    case 'this-year': return { key, label: 'This Year', start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` };
    default: return null;
  }
}

export function createActivity(root, { openEditor, filterButton }) {
  const f = { query: '', type: 'all', period: null, categoryId: null, accountId: null };
  let limit = PAGE_SIZE;

  root.innerHTML = `
    <label class="search">${icon('magnifying-glass')}<input type="search" placeholder="Search" autocomplete="off" spellcheck="false" enterkeyhint="search"><button class="search-clear" hidden aria-label="Clear">${icon('x-circle', true)}</button></label>
    <div class="toolbar">${segmented([{ value: 'all', label: 'All' }, { value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }], 'all', 'type')}</div>
    <div class="chips act-chips" style="padding-bottom:12px"></div>
    <div class="summary-line act-summary"></div>
    <div class="act-list"></div>`;
  const searchInput = $('input', root);
  const clearBtn = $('.search-clear', root);

  function filtered() {
    const q = f.query.trim().toLowerCase();
    return L.sortTransactions(store.state.transactions.filter(t => {
      if (f.type !== 'all' && t.type !== f.type) return false;
      if (f.period && (t.date < f.period.start || t.date > f.period.end)) return false;
      if (f.categoryId && t.categoryId !== f.categoryId) return false;
      if (f.accountId && t.accountId !== f.accountId) return false;
      if (q) {
        const cat = store.category(t.categoryId).name;
        const acc = store.account(t.accountId);
        const amount = (t.amount / 100).toString();
        const hay = `${t.note} ${cat} ${acc ? acc.name : ''} ${amount}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }));
  }

  function renderChips() {
    const chips = [];
    if (f.period) chips.push(`<button class="chip on" data-clear="period">${icon('calendar-blank')}${esc(f.period.label)}<i class="ph ph-x chip-x"></i></button>`);
    if (f.categoryId) {
      const c = store.category(f.categoryId);
      chips.push(`<button class="chip on" data-clear="categoryId">${icon(c.icon, true)}${esc(c.name)}<i class="ph ph-x chip-x"></i></button>`);
    }
    if (f.accountId && store.account(f.accountId)) {
      const a = store.account(f.accountId);
      chips.push(`<button class="chip on" data-clear="accountId">${icon(a.icon, true)}${esc(a.name)}<i class="ph ph-x chip-x"></i></button>`);
    }
    const box = $('.act-chips', root);
    box.innerHTML = chips.join('');
    box.hidden = !chips.length;
    const active = !!(f.period || f.categoryId || f.accountId);
    filterButton.innerHTML = icon('funnel', active);
  }

  function render() {
    renderChips();
    const list = filtered();
    const t = L.totals(list);
    const summary = $('.act-summary', root);
    const listEl = $('.act-list', root);
    if (!store.state.transactions.length) {
      summary.textContent = '';
      listEl.innerHTML = `<div class="empty fade-in">${icon('receipt')}<strong>No transactions</strong>Everything you add shows up here.</div>`;
      return;
    }
    if (!list.length) {
      summary.textContent = '';
      listEl.innerHTML = `<div class="empty fade-in">${icon('magnifying-glass')}<strong>No results</strong>Try a different search or filter.</div>`;
      return;
    }
    const parts = [`${list.length} transaction${list.length === 1 ? '' : 's'}`];
    if (t.expense) parts.push(`spent ${store.money(t.expense)}`);
    if (t.income) parts.push(`received ${store.money(t.income)}`);
    summary.textContent = parts.join(' · ');

    const shown = list.slice(0, limit);
    const groups = L.groupByDay(shown);
    listEl.innerHTML = groups.map(g => `
      <div class="section" style="margin-bottom:22px">
        <div class="day-header"><span>${esc(L.dayLabel(g.date))}</span><span class="num">${esc(store.money(g.net, { sign: true }))}</span></div>
        <div class="list">${g.items.map(x => txRow(x)).join('')}</div>
      </div>`).join('') +
      (list.length > limit ? `<div style="padding:0 16px 16px"><button class="btn secondary act-more">Show ${Math.min(PAGE_SIZE, list.length - limit)} more</button></div>` : '');
  }

  // ---- Events

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearBtn.hidden = !searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      f.query = searchInput.value;
      limit = PAGE_SIZE;
      render();
    }, 120);
  });
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchInput.blur(); });
  clearBtn.addEventListener('click', e => {
    e.preventDefault();
    searchInput.value = '';
    clearBtn.hidden = true;
    f.query = '';
    render();
  });

  bindSegmented(root, (name, value) => {
    if (name !== 'type') return;
    f.type = value;
    if (f.categoryId && value !== 'all' && store.category(f.categoryId).type !== value) f.categoryId = null;
    limit = PAGE_SIZE;
    render();
  });

  root.addEventListener('click', e => {
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      f[clear.dataset.clear] = null;
      haptic('selection');
      render();
      return;
    }
    if (e.target.closest('.act-more')) {
      limit += PAGE_SIZE;
      render();
    }
  });

  bindSwipeRows(root, {
    onTap: id => {
      const tx = store.state.transactions.find(t => t.id === id);
      if (tx) openEditor(tx);
    },
    onDelete: id => {
      const removed = store.deleteTransaction(id);
      if (removed) toast('Transaction deleted', { actionText: 'Undo', duration: 6000, onAction: () => store.restoreTransaction(removed) });
    },
  });

  filterButton.addEventListener('click', openFilters);

  function openFilters() {
    const draft = { ...f };
    const periodKeys = ['all', 'this-month', 'last-month', 'last-3', 'this-year'];
    const periodLabels = { all: 'All Time', 'this-month': 'This Month', 'last-month': 'Last Month', 'last-3': 'Last 3 Months', 'this-year': 'This Year' };
    const handle = openFormSheet({
      title: 'Filter',
      cancelText: 'Reset',
      doneText: 'Done',
      size: 'auto',
      html: '<div class="filter-body"></div>',
      onDone: () => {
        Object.assign(f, draft);
        limit = PAGE_SIZE;
        render();
        return true;
      },
    });
    // "Reset" clears and applies straight away
    const reset = handle.el.querySelector('.sheet-cancel');
    reset.replaceWith(reset.cloneNode(true));
    handle.el.querySelector('.sheet-cancel').addEventListener('click', () => {
      Object.assign(f, { period: null, categoryId: null, accountId: null });
      render();
      handle.close('reset');
    });
    const body = $('.filter-body', handle.el);
    const paint = () => {
      const currentKey = draft.period ? draft.period.key : 'all';
      const cat = draft.categoryId ? store.category(draft.categoryId) : null;
      const acc = draft.accountId ? store.account(draft.accountId) : null;
      body.innerHTML = `
        <div class="section">
          <div class="section-header">Period</div>
          <div class="list">
            ${periodKeys.map(k => `<button class="row tap" data-period="${k}"><div class="row-main"><span class="row-title" style="flex:1">${periodLabels[k]}</span>${k === currentKey ? '<i class="ph ph-check row-check"></i>' : ''}</div></button>`).join('')}
            ${draft.period && draft.period.key === 'custom' ? `<button class="row tap" data-period="custom"><div class="row-main"><span class="row-title" style="flex:1">${esc(draft.period.label)}</span><i class="ph ph-check row-check"></i></div></button>` : ''}
          </div>
        </div>
        <div class="section">
          <div class="list">
            <button class="row tap" data-pick="category">${cat ? tile(cat.icon, cat.color) : tile('squares-four', 'orange')}<div class="row-main"><span class="row-title" style="flex:1">Category</span><span class="row-value">${esc(cat ? cat.name : 'Any')}</span><i class="ph ph-caret-right row-chevron"></i></div></button>
            <button class="row tap" data-pick="account">${acc ? tile(acc.icon, acc.color) : tile('wallet', 'green')}<div class="row-main"><span class="row-title" style="flex:1">Account</span><span class="row-value">${esc(acc ? acc.name : 'Any')}</span><i class="ph ph-caret-right row-chevron"></i></div></button>
          </div>
        </div>`;
    };
    body.addEventListener('click', async e => {
      const p = e.target.closest('[data-period]');
      if (p) {
        if (p.dataset.period !== 'custom') draft.period = presetPeriod(p.dataset.period);
        haptic('selection');
        paint();
        return;
      }
      const pick = e.target.closest('[data-pick]');
      if (!pick) return;
      if (pick.dataset.pick === 'category') {
        const types = draft.type === 'all' ? ['expense', 'income'] : [draft.type];
        const cats = store.state.categories.filter(c => types.includes(c.type));
        const choice = await actionSheet({
          title: 'Category',
          actions: [{ text: 'Any Category', value: '__any', checked: !draft.categoryId },
            ...cats.map(c => ({ text: types.length > 1 && c.type === 'income' ? `${c.name} (income)` : c.name, value: c.id, icon: c.icon, checked: c.id === draft.categoryId }))],
        });
        if (choice) draft.categoryId = choice === '__any' ? null : choice;
      } else {
        const choice = await actionSheet({
          title: 'Account',
          actions: [{ text: 'Any Account', value: '__any', checked: !draft.accountId },
            ...store.state.accounts.map(a => ({ text: a.name, value: a.id, icon: a.icon, checked: a.id === draft.accountId }))],
        });
        if (choice) draft.accountId = choice === '__any' ? null : choice;
      }
      paint();
    });
    paint();
  }

  return {
    render,
    /** Opens the list pre-filtered, e.g. from a category in Insights. */
    show({ categoryId = null, period = null, type = null } = {}) {
      f.categoryId = categoryId;
      f.period = period;
      f.accountId = null;
      f.query = '';
      searchInput.value = '';
      clearBtn.hidden = true;
      if (type) {
        f.type = type;
        const seg = $('.segmented', root);
        const buttons = [...seg.querySelectorAll('button')];
        buttons.forEach(b => b.classList.toggle('on', b.dataset.value === type));
        seg.style.setProperty('--i', buttons.findIndex(b => b.dataset.value === type));
      }
      limit = PAGE_SIZE;
      render();
    },
  };
}
