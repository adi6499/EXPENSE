// The add / edit transaction sheet: big amount, number pad, categories, note, date, account, repeat.
import { store } from './store.js';
import * as L from './logic.js';
import {
  $, $$, esc, icon, tile, openSheet, actionSheet, pickDate, keypadHTML, bindKeypad,
  segmented, bindSegmented, amountSizeClass, haptic, toast,
} from './ui.js';
import { openCategoryEditor, openAccountEditor } from './manage.js';

const TYPE_OPTIONS = [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }];

/** existing: a transaction to edit, or null for a new one. preset: { type, categoryId, date }. */
export function openEditor(existing = null, preset = {}) {
  const editing = !!existing;
  const rule = existing && existing.recurringId ? store.rule(existing.recurringId) : null;
  const s = {
    type: existing ? existing.type : (preset.type || 'expense'),
    typed: existing ? L.minorToTyped(existing.amount) : '',
    categoryId: existing ? existing.categoryId : (preset.categoryId || null),
    accountId: existing ? existing.accountId : store.state.settings.lastAccountId,
    date: existing ? existing.date : (preset.date || L.todayISO()),
    note: existing ? existing.note : '',
    repeat: rule ? rule.frequency : 'never',
    categoryTouched: editing || !!preset.categoryId,
  };
  if (!s.categoryId || store.category(s.categoryId).type !== s.type) s.categoryId = store.likelyCategory(s.type);
  if (s.accountId && !store.account(s.accountId)) s.accountId = store.state.accounts[0] ? store.state.accounts[0].id : null;
  const original = JSON.stringify(s);

  const titleText = () => `${editing ? 'Edit' : 'New'} ${s.type === 'income' ? 'Income' : 'Expense'}`;

  const handle = openSheet({
    size: 'large',
    className: 'editor-sheet',
    onDismissRequest: () => cancel(),
    html: `
      <header class="sheet-header" data-drag>
        <button class="nav-btn ed-cancel">Cancel</button>
        <h2 class="sheet-title ed-title">${titleText()}</h2>
        <button class="nav-btn strong ed-save">${editing ? 'Save' : 'Add'}</button>
      </header>
      <div class="editor">
        ${segmented(TYPE_OPTIONS, s.type, 'type')}
        <div class="editor-center">
          <div class="amount-display"><span class="amount-symbol">${esc(L.currencyInfo(store.currency).symbol)}</span><span class="amount-value"></span></div>
          <input class="note-input" type="text" placeholder="Add a note" maxlength="80" enterkeyhint="done" autocomplete="off" spellcheck="false" value="${esc(s.note)}">
          <div class="suggestions"></div>
        </div>
        <div class="cat-strip" role="listbox" aria-label="Category"></div>
        <div class="detail-row"></div>
        ${keypadHTML()}
      </div>`,
  });
  const root = handle.el;
  const editorEl = $('.editor', root);
  const amountEl = $('.amount-display', root);
  const noteEl = $('.note-input', root);
  const catStrip = $('.cat-strip', root);

  function paintAmount() {
    const text = s.typed ? L.formatTyped(s.typed, store.currency) : '0';
    $('.amount-value', root).textContent = text;
    amountEl.className = `amount-display ${s.typed ? '' : 'empty'} ${s.type === 'income' && s.typed ? 'income' : ''} ${amountSizeClass(text)}`;
    $('.kp-done', root).classList.toggle('off', !L.typedToMinor(s.typed));
  }

  function paintCategories(scroll = false) {
    const cats = store.categories(s.type);
    catStrip.innerHTML = cats.map(c => `
      <button class="cat-item ${c.id === s.categoryId ? 'on' : ''}" data-cat="${esc(c.id)}" role="option" aria-selected="${c.id === s.categoryId}">
        ${tile(c.icon, c.color, 'lg')}<span>${esc(c.name)}</span>
      </button>`).join('') + `
      <button class="cat-item more" data-cat-new>${tile('plus', 'gray', 'lg')}<span>New</span></button>`;
    if (scroll) {
      const on = $('.cat-item.on', catStrip);
      if (on) catStrip.scrollLeft = on.offsetLeft - catStrip.offsetWidth / 2 + on.offsetWidth / 2;
    }
  }

  function paintDetails() {
    const account = store.account(s.accountId);
    $('.detail-row', root).innerHTML = `
      <button class="chip" data-detail="date">${icon('calendar-blank')}${esc(L.shortDate(s.date))}</button>
      <button class="chip" data-detail="account">${icon(account ? account.icon : 'wallet')}${esc(account ? account.name : 'No account')}</button>
      <button class="chip ${s.repeat !== 'never' ? 'on' : ''}" data-detail="repeat">${icon('repeat')}${esc(s.repeat === 'never' ? 'Repeat' : L.FREQUENCY_LABELS[s.repeat])}</button>
      ${editing ? `<button class="chip danger" data-detail="delete" aria-label="Delete">${icon('trash')}Delete</button>` : ''}`;
  }

  function paintSuggestions() {
    const box = $('.suggestions', root);
    if (!editorEl.classList.contains('typing')) { box.innerHTML = ''; return; }
    const list = L.noteSuggestions(store.state.transactions, s.note, s.type);
    box.innerHTML = list.map((x, i) => `<button class="chip" data-sug="${i}">${esc(x.note)}</button>`).join('');
    box._list = list;
  }

  function applyRemembered(match) {
    if (!match) return;
    if (!s.categoryTouched && store.categories(s.type).some(c => c.id === match.categoryId)) {
      s.categoryId = match.categoryId;
      paintCategories(true);
    }
    if (match.accountId && store.account(match.accountId)) {
      s.accountId = match.accountId;
      paintDetails();
    }
  }

  function dirty() {
    return JSON.stringify(s) !== original;
  }

  function save() {
    const amount = L.typedToMinor(s.typed);
    if (!amount) {
      haptic('error');
      amountEl.classList.remove('shake');
      void amountEl.offsetWidth;
      amountEl.classList.add('shake');
      return;
    }
    const fields = {
      type: s.type,
      amount,
      categoryId: s.categoryId,
      accountId: s.accountId,
      date: s.date,
      note: s.note.trim(),
    };
    let tx;
    if (editing) {
      tx = store.updateTransaction(existing.id, fields);
    } else {
      tx = store.addTransaction(fields);
    }
    const hadRule = rule ? rule.frequency : 'never';
    if (tx && (s.repeat !== hadRule || (s.repeat !== 'never' && editing))) store.setRepeat(tx, s.repeat);
    haptic('success');
    handle.close('saved');
    if (!editing && s.date > L.todayISO()) toast(`Added for ${L.shortDate(s.date)}`, { iconName: 'calendar-blank' });
  }

  let askingToDiscard = false;
  async function cancel() {
    if (!dirty()) return handle.close('cancel');
    if (askingToDiscard) return;
    askingToDiscard = true;
    const choice = await actionSheet({
      actions: [{ text: 'Discard Changes', value: 'discard', style: 'destructive' }],
      cancelText: 'Keep Editing',
    });
    askingToDiscard = false;
    if (choice === 'discard') handle.close('cancel');
  }

  // ---- Events

  $('.ed-cancel', root).addEventListener('click', cancel);
  $('.ed-save', root).addEventListener('click', save);

  bindSegmented(root, (name, value) => {
    if (name !== 'type') return;
    s.type = value;
    if (!s.categoryTouched || store.category(s.categoryId).type !== value) s.categoryId = store.likelyCategory(value);
    $('.ed-title', root).textContent = titleText();
    paintAmount();
    paintCategories(true);
  });

  bindKeypad(root, key => {
    if (key === 'done') return save();
    s.typed = key === 'clear' ? '' : L.typeKey(s.typed, key);
    paintAmount();
  });

  catStrip.addEventListener('click', e => {
    if (e.target.closest('[data-cat-new]')) {
      openCategoryEditor({
        type: s.type,
        onSaved: cat => {
          s.categoryId = cat.id;
          s.categoryTouched = true;
          paintCategories(true);
        },
      });
      return;
    }
    const item = e.target.closest('[data-cat]');
    if (!item) return;
    s.categoryId = item.dataset.cat;
    s.categoryTouched = true;
    haptic('selection');
    $$('.cat-item', catStrip).forEach(el => {
      const on = el === item;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', on);
    });
  });

  noteEl.addEventListener('focus', () => {
    editorEl.classList.add('typing');
    paintSuggestions();
  });
  noteEl.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement === noteEl) return;
      editorEl.classList.remove('typing');
      paintSuggestions();
      // An exact match with an earlier note fills in its category and account
      const query = s.note.trim().toLowerCase();
      if (query && !editing) {
        const match = L.sortTransactions(store.state.transactions).find(t => t.type === s.type && (t.note || '').trim().toLowerCase() === query);
        if (match) applyRemembered(match);
      }
    }, 150);
  });
  noteEl.addEventListener('input', () => {
    s.note = noteEl.value;
    paintSuggestions();
  });
  noteEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') noteEl.blur();
  });

  const suggestionsEl = $('.suggestions', root);
  // pointerdown keeps the keyboard's focus so the tap lands on the chip
  suggestionsEl.addEventListener('pointerdown', e => { if (e.target.closest('[data-sug]')) e.preventDefault(); });
  suggestionsEl.addEventListener('click', e => {
    const chip = e.target.closest('[data-sug]');
    if (!chip) return;
    const match = suggestionsEl._list[Number(chip.dataset.sug)];
    s.note = match.note;
    noteEl.value = match.note;
    applyRemembered(match);
    haptic('selection');
    noteEl.blur();
  });

  $('.detail-row', root).addEventListener('click', async e => {
    const chip = e.target.closest('[data-detail]');
    if (!chip) return;
    const kind = chip.dataset.detail;
    if (kind === 'date') {
      const picked = await pickDate(s.date, { title: 'Date' });
      if (picked) { s.date = picked; paintDetails(); }
    } else if (kind === 'account') {
      const actions = store.state.accounts.map(a => ({ text: a.name, value: a.id, icon: a.icon, checked: a.id === s.accountId }));
      actions.push({ text: 'No Account', value: '__none', checked: !s.accountId });
      actions.push({ text: 'Add Account…', value: '__new', icon: 'plus' });
      const choice = await actionSheet({ title: 'Paid With', actions });
      if (choice === '__new') {
        openAccountEditor({ onSaved: acc => { s.accountId = acc.id; paintDetails(); } });
      } else if (choice === '__none') {
        s.accountId = null;
        paintDetails();
      } else if (choice) {
        s.accountId = choice;
        paintDetails();
      }
    } else if (kind === 'repeat') {
      const choice = await actionSheet({
        title: 'Repeat',
        message: 'Repeating transactions are added for you automatically.',
        actions: ['never', 'weekly', 'monthly', 'yearly'].map(f => ({ text: L.FREQUENCY_LABELS[f], value: f, checked: f === s.repeat })),
      });
      if (choice) { s.repeat = choice; paintDetails(); }
    } else if (kind === 'delete') {
      const choice = await actionSheet({
        message: rule ? 'This only deletes this one. To stop future repeats, set Repeat to Never.' : '',
        actions: [{ text: 'Delete Transaction', value: 'delete', style: 'destructive' }],
      });
      if (choice === 'delete') {
        const removed = store.deleteTransaction(existing.id);
        haptic('warning');
        handle.close('deleted');
        if (removed) toast('Transaction deleted', { actionText: 'Undo', duration: 6000, onAction: () => store.restoreTransaction(removed) });
      }
    }
  });

  paintAmount();
  paintCategories(true);
  paintDetails();
  return handle;
}
