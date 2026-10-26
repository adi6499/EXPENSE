// Settings sub-pages: categories, accounts, budgets, repeating transactions, currency, appearance.
import { store, COLORS, CATEGORY_ICONS, ACCOUNT_ICONS } from './store.js';
import * as L from './logic.js';
import {
  $, $$, esc, icon, tile, pushPage, openFormSheet, alert, actionSheet, pickAmount,
  segmented, bindSegmented, haptic, toast,
} from './ui.js';

function pushLive(options) {
  let unsubscribe = () => {};
  const page = pushPage({ ...options, onClose: () => unsubscribe() });
  unsubscribe = store.subscribe(() => page.refresh());
  return page;
}

// ---------- Category editor (also used from the transaction editor's "New" button)

export function openCategoryEditor({ category = null, type = 'expense', onSaved } = {}) {
  const editing = !!category;
  const draft = category ? { ...category } : { name: '', type, icon: 'tag', color: COLORS[store.categories(type).length % COLORS.length] };
  const fallbackId = draft.type === 'income' ? 'other_in' : 'other';

  const handle = openFormSheet({
    title: editing ? 'Edit Category' : 'New Category',
    doneText: editing ? 'Save' : 'Add',
    html: `
      <div class="preview-tile"><span class="cat-preview"></span></div>
      <div class="section">
        <div class="list">
          <label class="row"><div class="row-main"><input class="row-input left cat-name" placeholder="Category name" maxlength="30" value="${esc(draft.name)}" autocomplete="off"></div></label>
        </div>
      </div>
      <div class="section">
        <div class="section-header">Colour</div>
        <div class="list"><div class="color-grid">${COLORS.map(c => `<button style="--c:var(--${c})" data-color="${c}" aria-label="${c}"></button>`).join('')}</div></div>
      </div>
      <div class="section">
        <div class="section-header">Icon</div>
        <div class="list"><div class="icon-grid">${CATEGORY_ICONS.map(i => `<button data-icon="${i}" aria-label="${i}">${icon(i)}</button>`).join('')}</div></div>
      </div>
      ${editing && draft.id !== fallbackId ? `<div class="section"><div class="list"><button class="row tap destructive center cat-delete"><div class="row-main"><span class="row-title">Delete Category</span></div></button></div></div>` : ''}`,
    onDone: () => {
      draft.name = $('.cat-name', handle.el).value.trim();
      if (!draft.name) {
        haptic('error');
        $('.cat-name', handle.el).focus();
        return false;
      }
      const duplicate = store.categories(draft.type).find(c => c.name.toLowerCase() === draft.name.toLowerCase() && c.id !== draft.id);
      if (duplicate) {
        alert({ title: 'Name already used', message: `There is already a category called "${duplicate.name}".` });
        return false;
      }
      if (!draft.id) draft.id = L.uid();
      store.saveCategory(draft);
      haptic('success');
      if (onSaved) onSaved(store.category(draft.id));
      return true;
    },
  });
  const paint = () => {
    $('.cat-preview', handle.el).innerHTML = tile(draft.icon, draft.color, 'xl');
    $$('[data-color]', handle.el).forEach(b => b.classList.toggle('on', b.dataset.color === draft.color));
    $$('[data-icon]', handle.el).forEach(b => b.classList.toggle('on', b.dataset.icon === draft.icon));
  };
  handle.el.addEventListener('click', async e => {
    const color = e.target.closest('[data-color]');
    if (color) { draft.color = color.dataset.color; haptic('selection'); paint(); return; }
    const ic = e.target.closest('[data-icon]');
    if (ic) { draft.icon = ic.dataset.icon; haptic('selection'); paint(); return; }
    if (e.target.closest('.cat-delete')) {
      const count = store.usageCount('categoryId', draft.id);
      const ok = await alert({
        title: `Delete "${draft.name}"?`,
        message: count ? `${count} transaction${count === 1 ? '' : 's'} will move to "Other".` : 'This cannot be undone.',
        buttons: [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'Delete', value: true, style: 'destructive' }],
      });
      if (ok) {
        store.deleteCategory(draft.id);
        handle.close('deleted');
      }
    }
  });
  paint();
  if (!editing) setTimeout(() => $('.cat-name', handle.el).focus(), 450);
  return handle;
}

export function openCategories() {
  let type = 'expense';
  pushLive({
    title: 'Categories',
    backText: 'Settings',
    rightHTML: `<button class="icon-btn" aria-label="Add category">${icon('plus')}</button>`,
    onRight: () => openCategoryEditor({ type }),
    render: (content, page) => {
      const cats = store.categories(type);
      content.innerHTML = `
        <div class="toolbar" style="padding-top:12px">${segmented([{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }], type, 'type')}</div>
        <div class="section">
          <div class="list">
            ${cats.map(c => {
              const count = store.usageCount('categoryId', c.id);
              return `<button class="row tap" data-cat="${esc(c.id)}">${tile(c.icon, c.color)}
                <div class="row-main"><span class="row-title" style="flex:1">${esc(c.name)}</span>
                <span class="row-value">${count || ''}</span>${icon('caret-right')}</div></button>`;
            }).join('')}
            <button class="row tap" data-add>${tile('plus', 'blue')}<div class="row-main"><span class="row-title" style="color:var(--blue)">Add Category</span></div></button>
          </div>
          <div class="section-footer">The number shows how many transactions use each category. Deleting a category moves its transactions to "Other".</div>
        </div>`;
      $$('.ph-caret-right', content).forEach(i => i.classList.add('row-chevron'));
      if (!page._bound) {
        page._bound = true;
        bindSegmented(content, (name, value) => { type = value; page.refresh(); });
        content.addEventListener('click', e => {
          const row = e.target.closest('[data-cat]');
          if (row) openCategoryEditor({ category: store.category(row.dataset.cat) });
          if (e.target.closest('[data-add]')) openCategoryEditor({ type });
        });
      }
    },
  });
}

// ---------- Accounts

export function openAccountEditor({ account = null, onSaved } = {}) {
  const editing = !!account;
  const draft = account ? { ...account } : { name: '', icon: 'wallet', color: 'blue', openingBalance: 0 };

  const handle = openFormSheet({
    title: editing ? 'Edit Account' : 'New Account',
    doneText: editing ? 'Save' : 'Add',
    html: `
      <div class="preview-tile"><span class="acc-preview"></span></div>
      <div class="section">
        <div class="list">
          <label class="row"><div class="row-main"><input class="row-input left acc-name" placeholder="Account name (e.g. HDFC, Paytm)" maxlength="30" value="${esc(draft.name)}" autocomplete="off"></div></label>
          <button class="row tap acc-opening"><div class="row-main"><span class="row-title" style="flex:1">Starting balance</span><span class="row-value acc-opening-value"></span>${icon('caret-right')}</div></button>
        </div>
        <div class="section-footer">Optional. The money that was in this account before you started tracking, so its balance is right.</div>
      </div>
      <div class="section">
        <div class="section-header">Colour</div>
        <div class="list"><div class="color-grid">${COLORS.map(c => `<button style="--c:var(--${c})" data-color="${c}" aria-label="${c}"></button>`).join('')}</div></div>
      </div>
      <div class="section">
        <div class="section-header">Icon</div>
        <div class="list"><div class="icon-grid">${ACCOUNT_ICONS.map(i => `<button data-icon="${i}" aria-label="${i}">${icon(i)}</button>`).join('')}</div></div>
      </div>
      ${editing ? `<div class="section"><div class="list"><button class="row tap destructive center acc-delete"><div class="row-main"><span class="row-title">Delete Account</span></div></button></div></div>` : ''}`,
    onDone: () => {
      draft.name = $('.acc-name', handle.el).value.trim();
      if (!draft.name) {
        haptic('error');
        $('.acc-name', handle.el).focus();
        return false;
      }
      if (!draft.id) draft.id = L.uid();
      store.saveAccount(draft);
      haptic('success');
      if (onSaved) onSaved(store.account(draft.id));
      return true;
    },
  });
  $$('.ph-caret-right', handle.el).forEach(i => i.classList.add('row-chevron'));
  const paint = () => {
    $('.acc-preview', handle.el).innerHTML = tile(draft.icon, draft.color, 'xl');
    $('.acc-opening-value', handle.el).textContent = store.money(draft.openingBalance || 0);
    $$('[data-color]', handle.el).forEach(b => b.classList.toggle('on', b.dataset.color === draft.color));
    $$('[data-icon]', handle.el).forEach(b => b.classList.toggle('on', b.dataset.icon === draft.icon));
  };
  handle.el.addEventListener('click', async e => {
    const color = e.target.closest('[data-color]');
    if (color) { draft.color = color.dataset.color; haptic('selection'); paint(); return; }
    const ic = e.target.closest('[data-icon]');
    if (ic) { draft.icon = ic.dataset.icon; haptic('selection'); paint(); return; }
    if (e.target.closest('.acc-opening')) {
      const value = await pickAmount({ title: 'Starting Balance', initial: draft.openingBalance || 0, currency: store.currency });
      if (value !== null) { draft.openingBalance = value; paint(); }
      return;
    }
    if (e.target.closest('.acc-delete')) {
      const count = store.usageCount('accountId', draft.id);
      const ok = await alert({
        title: `Delete "${draft.name}"?`,
        message: count ? `Its ${count} transaction${count === 1 ? '' : 's'} will be kept, without an account.` : 'This cannot be undone.',
        buttons: [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'Delete', value: true, style: 'destructive' }],
      });
      if (ok) {
        store.deleteAccount(draft.id);
        handle.close('deleted');
      }
    }
  });
  paint();
  if (!editing) setTimeout(() => $('.acc-name', handle.el).focus(), 450);
  return handle;
}

export function openAccounts() {
  pushLive({
    title: 'Accounts',
    backText: 'Settings',
    rightHTML: `<button class="icon-btn" aria-label="Add account">${icon('plus')}</button>`,
    onRight: () => openAccountEditor(),
    render: (content, page) => {
      const balances = L.accountBalances(store.state.accounts, store.state.transactions);
      const total = [...balances.values()].reduce((a, b) => a + b, 0);
      content.innerHTML = `
        <div class="card" style="margin-top:12px">
          <div class="card-label">${icon('wallet', true)} Total balance</div>
          <div class="hero-amount num" style="font-size:34px">${esc(store.money(total))}</div>
          <div class="hero-sub">Starting balances plus everything you earned, minus what you spent.</div>
        </div>
        <div class="section">
          <div class="list">
            ${store.state.accounts.map(a => `
              <button class="row tap" data-acc="${esc(a.id)}">${tile(a.icon, a.color)}
                <div class="row-main"><span class="row-title" style="flex:1">${esc(a.name)}</span>
                <span class="row-value" style="color:${balances.get(a.id) < 0 ? 'var(--red)' : 'var(--label-2)'}">${esc(store.money(balances.get(a.id) || 0))}</span>${icon('caret-right')}</div>
              </button>`).join('')}
            <button class="row tap" data-add>${tile('plus', 'blue')}<div class="row-main"><span class="row-title" style="color:var(--blue)">Add Account</span></div></button>
          </div>
          <div class="section-footer">Accounts are where money is paid from — cash, UPI, a bank account or a card.</div>
        </div>`;
      $$('.ph-caret-right', content).forEach(i => i.classList.add('row-chevron'));
      if (!page._bound) {
        page._bound = true;
        content.addEventListener('click', e => {
          const row = e.target.closest('[data-acc]');
          if (row) openAccountEditor({ account: store.account(row.dataset.acc) });
          if (e.target.closest('[data-add]')) openAccountEditor();
        });
      }
    },
  });
}

// ---------- Budgets

export function openBudgets() {
  pushLive({
    title: 'Budgets',
    backText: 'Settings',
    render: (content, page) => {
      const today = L.todayISO();
      const month = L.inRange(store.state.transactions, L.startOfMonth(today), L.endOfMonth(today));
      const spent = new Map(L.byCategory(month).map(r => [r.categoryId, r.total]));
      const total = L.totals(month).expense;
      const monthly = store.state.budgets.monthly;
      const catBudgets = store.state.budgets.categories;
      const barColor = pct => (pct >= 1 ? 'red' : pct >= 0.8 ? 'orange' : 'green');
      content.innerHTML = `
        <div class="section" style="margin-top:12px">
          <div class="section-header">Monthly budget</div>
          <div class="list">
            <button class="row tap" data-monthly>${tile('target', 'red')}
              <div class="row-main"><span class="row-title" style="flex:1">Every month</span>
              <span class="row-value">${monthly ? esc(store.money(monthly)) : 'Not set'}</span>${icon('caret-right')}</div>
            </button>
          </div>
          ${monthly ? `<div class="section-footer">${esc(store.money(total))} spent so far this month (${Math.round((total / monthly) * 100)}%).</div>` : '<div class="section-footer">Set a limit for all spending in a month. The Summary shows how much is left.</div>'}
        </div>
        <div class="section">
          <div class="section-header">Category budgets</div>
          <div class="list">
            ${store.categories('expense').map(c => {
              const budget = catBudgets[c.id] || 0;
              const used = spent.get(c.id) || 0;
              const pct = budget ? used / budget : 0;
              return `<button class="row tap" data-cat="${esc(c.id)}">${tile(c.icon, c.color)}
                <div class="row-main">
                  <div class="row-text">
                    <div class="row-title">${esc(c.name)}</div>
                    ${budget ? `<div class="row-sub">${esc(store.money(used))} of ${esc(store.money(budget))}</div>
                    <div class="progress" style="margin-top:6px;--c:var(--${barColor(pct)})"><span style="width:${Math.min(100, pct * 100)}%"></span></div>` : ''}
                  </div>
                  <span class="row-value">${budget ? '' : 'None'}</span>${icon('caret-right')}
                </div>
              </button>`;
            }).join('')}
          </div>
          <div class="section-footer">Optional limits for single categories, like Food or Shopping. Set 0 to remove one.</div>
        </div>`;
      $$('.ph-caret-right', content).forEach(i => i.classList.add('row-chevron'));
      if (!page._bound) {
        page._bound = true;
        content.addEventListener('click', async e => {
          if (e.target.closest('[data-monthly]')) {
            const value = await pickAmount({ title: 'Monthly Budget', subtitle: 'The most you want to spend in a month', initial: store.state.budgets.monthly, currency: store.currency });
            if (value !== null) store.setMonthlyBudget(value);
            return;
          }
          const row = e.target.closest('[data-cat]');
          if (row) {
            const cat = store.category(row.dataset.cat);
            const value = await pickAmount({ title: cat.name, subtitle: 'Monthly limit for this category', initial: store.state.budgets.categories[cat.id] || 0, currency: store.currency });
            if (value !== null) store.setCategoryBudget(cat.id, value);
          }
        });
      }
    },
  });
}

// ---------- Repeating transactions

export function openRepeating() {
  pushLive({
    title: 'Repeating',
    backText: 'Settings',
    render: (content, page) => {
      const rules = [...store.state.recurring].sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
      content.innerHTML = rules.length ? `
        <div class="section" style="margin-top:12px">
          <div class="list">
            ${rules.map(r => {
              const cat = store.category(r.categoryId);
              return `<button class="row tap" data-rule="${esc(r.id)}">${tile(cat.icon, cat.color, 'lg')}
                <div class="row-main">
                  <div class="row-text"><div class="row-title">${esc(r.note || cat.name)}</div>
                  <div class="row-sub">${esc(L.FREQUENCY_LABELS[r.frequency])} · next ${esc(L.shortDate(r.nextDate))}</div></div>
                  <span class="tx-amount ${r.type}">${esc(r.type === 'income' ? store.money(r.amount, { sign: true }) : store.money(r.amount))}</span>
                </div>
              </button>`;
            }).join('')}
          </div>
          <div class="section-footer">These are added automatically on their date. Tap one to stop it.</div>
        </div>` : `
        <div class="empty fade-in">
          ${icon('repeat')}
          <strong>Nothing repeating yet</strong>
          For rent, salary or subscriptions: when you add one, tap <b>Repeat</b> and choose how often. It will be added for you automatically.
        </div>`;
      if (!page._bound) {
        page._bound = true;
        content.addEventListener('click', async e => {
          const row = e.target.closest('[data-rule]');
          if (!row) return;
          const rule = store.rule(row.dataset.rule);
          const choice = await actionSheet({
            title: rule.note || store.category(rule.categoryId).name,
            message: `${L.FREQUENCY_LABELS[rule.frequency]} · ${store.money(rule.amount)}. Transactions already added stay.`,
            actions: [{ text: 'Stop Repeating', value: 'stop', style: 'destructive' }],
          });
          if (choice === 'stop') {
            store.deleteRule(rule.id);
            toast('Stopped repeating', { iconName: 'repeat' });
          }
        });
      }
    },
  });
}

// ---------- Simple choice pages

function choicePage({ title, options, current, onPick, footer = '' }) {
  return pushPage({
    title,
    backText: 'Settings',
    render: (content, page) => {
      const value = current();
      content.innerHTML = `
        <div class="section" style="margin-top:12px">
          <div class="list">
            ${options.map(o => `<button class="row tap" data-value="${esc(o.value)}">
              ${o.tile || ''}
              <div class="row-main"><div class="row-text"><div class="row-title">${esc(o.label)}</div>${o.sub ? `<div class="row-sub">${esc(o.sub)}</div>` : ''}</div>
              ${o.value === value ? `<i class="ph ph-check row-check"></i>` : ''}</div>
            </button>`).join('')}
          </div>
          ${footer ? `<div class="section-footer">${esc(footer)}</div>` : ''}
        </div>`;
      if (!page._bound) {
        page._bound = true;
        content.addEventListener('click', e => {
          const row = e.target.closest('[data-value]');
          if (!row) return;
          haptic('selection');
          onPick(row.dataset.value);
          page.refresh();
        });
      }
    },
  });
}

export function openCurrency() {
  choicePage({
    title: 'Currency',
    options: L.CURRENCIES.map(c => ({ value: c.code, label: `${c.name}`, sub: `${c.code} · ${c.symbol}` })),
    current: () => store.state.settings.currency,
    onPick: code => store.setSetting('currency', code),
    footer: 'Only changes how amounts are shown. Amounts are not converted.',
  });
}

export function openAppearance(onChange) {
  choicePage({
    title: 'Appearance',
    options: [
      { value: 'auto', label: 'Automatic', sub: 'Follows your phone’s light / dark setting' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
    current: () => store.state.settings.appearance,
    onPick: value => {
      store.setSetting('appearance', value);
      onChange();
    },
  });
}

