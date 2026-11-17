// The Transactions tab, built the Hub way: search, one card that answers "how much?", number
// tiles that filter (press again to clear), days of rows that open in place, swipe to delete.
import { store } from './store.js';
import * as L from './logic.js';
import { $, esc, icon, tile, bindSwipeRows, openFormSheet, actionSheet, toast, haptic } from './ui.js';
import { txRow, describe } from './rows.js';
import { native } from './native.js';
import { showPhoto } from './editor.js';
import { expectRefund } from './more.js';

/** The tiles: each is a count that filters the list below. */
const TYPE_TILES = [
  { key: 'expense', label: 'Spent', test: t => t.type === 'expense' },
  { key: 'income', label: 'Received', test: t => t.type === 'income' },
  { key: 'moved', label: 'Moved & lent', test: t => t.type === 'transfer' || t.type === 'loan' },
  { key: 'bank', label: 'From your bank', test: t => !!t.sms },
];
const typeTest = key => (TYPE_TILES.find(x => x.key === key) || {}).test || null;

/** The kit's gliding rows (cosmetic: a failure just skips the glide). */
const flip = el => { try { return window.JUI ? window.JUI.flip(el) : () => {}; } catch { return () => {}; } };

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
  const f = { query: '', type: 'all', period: null, categoryId: null, accountId: null, tag: null, person: null };
  let limit = PAGE_SIZE;

  root.innerHTML = `
    <label class="search">${icon('magnifying-glass')}<input type="search" placeholder="Search" autocomplete="off" spellcheck="false" enterkeyhint="search"><button class="search-clear" hidden aria-label="Clear">${icon('x-circle', true)}</button></label>
    <div class="act-answer"></div>
    <div class="ju-tiles act-tiles"></div>
    <div class="chips act-chips" style="padding-bottom:12px"></div>
    <div class="act-list"></div>`;
  const searchInput = $('input', root);
  const clearBtn = $('.search-clear', root);

  let asked = null; // the question read from the search box: { text, period, kind }
  let openId = null; // the row that is open in place

  /** Everything the search and filters allow, before the tiles' own filter. */
  function filteredBase() {
    asked = f.query.trim() ? L.parseQuery(f.query) : null;
    const q = asked ? asked.text : '';
    const period = f.period || (asked && asked.period);
    return L.sortTransactions(store.state.transactions.filter(t => {
      if (period && (t.date < period.start || t.date > period.end)) return false;
      if (f.categoryId && t.categoryId !== f.categoryId) return false;
      if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
      if (f.tag && String(t.tag || '').toLowerCase() !== f.tag.toLowerCase()) return false;
      if (f.person && L.personKey(t.person) !== L.personKey(f.person)) return false;
      if (q) {
        const cat = t.categoryId ? store.category(t.categoryId).name : '';
        const acc = store.account(t.accountId);
        const to = store.account(t.toAccountId);
        const amount = (t.amount / 100).toString();
        const hay = `${t.note} ${cat} ${acc ? acc.name : ''} ${to ? to.name : ''} ${t.person || ''} ${t.tag || ''} ${amount}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }));
  }

  function currentType() {
    return f.type !== 'all' ? f.type : (asked && asked.kind) || 'all';
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
    if (f.tag) chips.push(`<button class="chip on" data-clear="tag">${icon('tag', true)}${esc(f.tag)}<i class="ph ph-x chip-x"></i></button>`);
    if (f.person) chips.push(`<button class="chip on" data-clear="person">${icon('hand-coins', true)}${esc(f.person)}<i class="ph ph-x chip-x"></i></button>`);
    const box = $('.act-chips', root);
    box.innerHTML = chips.join('');
    box.hidden = !chips.length;
    const active = !!(f.period || f.categoryId || f.accountId || f.tag || f.person);
    filterButton.innerHTML = icon('funnel', active);
  }

  /** The answer first: one card with the figure for whatever is being looked at. */
  function answerHTML(list, type) {
    const t = L.totals(list);
    const period = f.period || (asked && asked.period);
    let figure = t.expense;
    let verb = 'spent';
    if (type === 'income' || (type !== 'moved' && !t.expense && t.income)) { figure = t.income; verb = 'received'; }
    if (type === 'moved') { figure = list.reduce((sum, x) => sum + x.amount, 0); verb = 'moved or lent'; }
    const cat = f.categoryId ? store.category(f.categoryId).name : '';
    const what = asked && asked.text ? ` on “${asked.text}”` : cat ? ` on ${cat}` : f.tag ? ` on ${f.tag}` : '';
    const when = period ? period.label : 'All time';
    const extra = verb === 'spent' && t.income ? ` · received ${store.money(t.income)}` : '';
    return `<div class="ju-card act-answer-card">
      <div class="ju-eyebrow">${esc(when)}${type === 'bank' ? ' · from your bank' : ''}</div>
      <div class="big num">${esc(store.money(figure))}</div>
      <div class="ju-muted">${esc(verb)}${esc(what)} · ${list.length} transaction${list.length === 1 ? '' : 's'}${esc(extra)}</div>
    </div>`;
  }

  /** Counts that filter: press one to show only those, press it again to show everything. */
  function tilesHTML(base, type) {
    return TYPE_TILES.map(x => {
      const items = base.filter(x.test);
      if (!items.length && x.key === 'bank') return '';
      const sum = items.reduce((total, t) => total + (t.type === 'income' && x.key === 'bank' ? 0 : t.amount), 0);
      return `<button class="ju-tile ${type === x.key ? 'on' : ''}" data-type="${x.key}" aria-pressed="${type === x.key}">
        <b>${items.length}</b><span>${esc(x.label)}</span><small class="num">${x.key === 'bank' ? 'added for you' : esc(store.money(sum))}</small></button>`;
    }).join('');
  }

  /** What opens under a row when it is pressed: its details and its buttons. */
  function openHTML(t) {
    const d = describe(t);
    const account = store.account(t.accountId);
    const facts = [];
    facts.push(['Date', L.dayLabel(t.date)]);
    if (t.type === 'expense' || t.type === 'income') facts.push(['Category', store.category(t.categoryId).name]);
    if (t.type === 'transfer') facts.push(['Moved', d.sub.replace(/^Transfer · /, '')]);
    else if (account) facts.push([t.type === 'income' ? 'Received in' : 'Paid with', account.name]);
    if (t.type === 'loan') facts.push([t.direction === 'in' ? 'Got from' : 'Gave to', t.person]);
    if (t.note && t.note.length > 24) facts.push(['Note', t.note]);
    if (t.tag) facts.push(['Trip or event', t.tag]);
    if (t.by) facts.push(['Added by', t.by]);
    if (t.business) facts.push(['Business', t.gst ? `Yes · GST ${store.money(t.gst)}` : 'Yes']);
    if (t.warranty) facts.push(['Warranty until', L.shortDate(t.warranty)]);
    if (t.recurringId) facts.push(['Repeats', 'Yes']);
    if (t.sms) facts.push(['Added from', 'your bank’s message']);
    if (t.fee) facts.push(['Bank charge', 'Yes']);
    const refund = L.refundStatus(t, store.state.transactions);
    if (refund) facts.push(['Refund', refund.done ? `Back on ${L.shortDate(refund.done)}` : `Waiting ${refund.waiting} day${refund.waiting === 1 ? '' : 's'}`]);
    return `<div class="tx-open" data-key="open-${esc(t.id)}" data-open-for="${esc(t.id)}">
      <dl class="tx-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="tx-open-acts">
        <button class="ju-btn primary sm" data-tx-edit>${icon('pencil-simple')} Edit</button>
        ${t.type === 'expense' || t.type === 'income' ? `<button class="ju-btn sm" data-tx-again>${icon('copy')} Add Again Today</button>` : ''}
        ${t.photo ? `<button class="ju-btn sm" data-tx-photo>${icon('image')} Photo</button>` : ''}
        ${t.type === 'expense' && !t.refund ? `<button class="ju-btn sm" data-tx-refund>${icon('arrow-u-up-left')} Expect a Refund</button>` : ''}
        ${t.refund && !(refund && refund.done) ? `<button class="ju-btn sm" data-tx-refunded>${icon('check-circle')} Refund Came</button>` : ''}
        <button class="ju-btn ghost sm tx-delete" data-tx-delete>${icon('trash')} Delete</button>
      </div>
    </div>`;
  }

  function rowEl(id) {
    return [...$('.act-list', root).querySelectorAll('.swipe-row')].find(r => r.dataset.id === id) || null;
  }

  function placeOpen() {
    const old = $('.tx-open', root);
    if (old) old.remove();
    root.querySelectorAll('.swipe-row.is-open').forEach(r => r.classList.remove('is-open'));
    const t = openId && store.state.transactions.find(x => x.id === openId);
    const row = t && rowEl(openId);
    if (!row) { openId = null; return; }
    row.classList.add('is-open');
    row.insertAdjacentHTML('afterend', openHTML(t));
  }

  /** Pressing a row opens it in place (no pop-up); pressing it again closes it. */
  function toggleOpen(id) {
    const done = flip($('.act-list', root));
    openId = openId === id ? null : id;
    placeOpen();
    done();
    haptic('selection');
  }

  function render() {
    renderChips();
    const base = filteredBase();
    const type = currentType();
    const test = typeTest(type);
    const list = test ? base.filter(test) : base;
    const answerEl = $('.act-answer', root);
    const tilesEl = $('.act-tiles', root);
    const listEl = $('.act-list', root);
    if (!store.state.transactions.length) {
      answerEl.innerHTML = '';
      tilesEl.innerHTML = '';
      listEl.innerHTML = `<div class="empty fade-in">${icon('receipt')}<strong>No transactions</strong>Everything you add shows up here.
        <div><button class="ju-btn primary" data-act-add>${icon('plus')} Add Your First Expense</button></div></div>`;
      return;
    }
    answerEl.innerHTML = answerHTML(list, type);
    tilesEl.innerHTML = tilesHTML(base, type);
    if (!list.length) {
      listEl.innerHTML = `<div class="empty fade-in">${icon('magnifying-glass')}<strong>Nothing here</strong>Nothing matches this search or filter.
        <div><button class="ju-btn primary" data-act-reset>Show Everything</button></div></div>`;
      return;
    }

    const shown = list.slice(0, limit);
    const groups = L.groupByDay(shown);
    listEl.innerHTML = groups.map(g => `
      <div class="act-day">
        <div class="ju-group"><span>${esc(L.dayLabel(g.date))}</span><span class="num">${esc(store.money(g.net, { sign: true }))}</span></div>
        <div class="list">${g.items.map(x => txRow(x)).join('')}</div>
      </div>`).join('') +
      (list.length > limit ? `<div style="padding:0 16px 16px"><button class="ju-btn act-more" style="width:100%">Show ${Math.min(PAGE_SIZE, list.length - limit)} more</button></div>` : '');
    if (openId) placeOpen();
  }

  function resetAll() {
    Object.assign(f, { query: '', type: 'all', period: null, categoryId: null, accountId: null, tag: null, person: null });
    searchInput.value = '';
    clearBtn.hidden = true;
    limit = PAGE_SIZE;
    render();
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

  root.addEventListener('click', e => {
    const tileBtn = e.target.closest('[data-type]');
    if (tileBtn) {
      const value = f.type === tileBtn.dataset.type ? 'all' : tileBtn.dataset.type;
      f.type = value;
      if (f.categoryId && (value === 'expense' || value === 'income') && store.category(f.categoryId).type !== value) f.categoryId = null;
      limit = PAGE_SIZE;
      haptic('selection');
      const done = flip($('.act-list', root));
      render();
      done();
      return;
    }
    if (e.target.closest('[data-act-add]')) { openEditor(); return; }
    if (e.target.closest('[data-act-reset]')) { resetAll(); return; }
    const open = e.target.closest('.tx-open');
    if (open) {
      const tx = store.state.transactions.find(t => t.id === open.dataset.openFor);
      if (!tx) return;
      if (e.target.closest('[data-tx-edit]')) openEditor(tx);
      else if (e.target.closest('[data-tx-again]')) {
        const { type, amount, categoryId, accountId, note, tag, business } = tx;
        const copy = store.addTransaction({ type, amount, categoryId, accountId, note, ...(tag ? { tag } : {}), ...(business ? { business } : {}), date: L.todayISO() });
        haptic('success');
        toast(`Added again for today · ${store.money(amount)}`, { iconName: 'copy', actionText: 'Undo', duration: 5000, onAction: () => store.deleteTransaction(copy.id) });
      } else if (e.target.closest('[data-tx-refund]')) {
        expectRefund(tx);
      } else if (e.target.closest('[data-tx-refunded]')) {
        store.refundArrived(tx.id);
        haptic('success');
      } else if (e.target.closest('[data-tx-photo]')) {
        native.photoUrl(tx.id).then(url => { if (url) showPhoto(url); });
      } else if (e.target.closest('[data-tx-delete]')) {
        openId = null;
        const removed = store.deleteTransaction(tx.id);
        haptic('warning');
        if (removed) toast('Transaction deleted', { actionText: 'Undo', duration: 6000, onAction: () => store.restoreTransaction(removed) });
      }
      return;
    }
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
    onTap: id => toggleOpen(id),
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
    show({ categoryId = null, period = null, type = null, tag = null, person = null } = {}) {
      f.categoryId = categoryId;
      f.period = period;
      f.accountId = null;
      f.tag = tag;
      f.person = person;
      f.query = '';
      searchInput.value = '';
      clearBtn.hidden = true;
      f.type = type || 'all';
      openId = null;
      limit = PAGE_SIZE;
      render();
    },
  };
}
