// The add / edit transaction sheet: big amount, number pad, categories, note, date, account,
// repeat, trip tag, bill photo and speaking it. Four kinds: expense, income, transfer (between
// your own accounts) and loan (money you gave or got back from someone).
import { store } from './store.js';
import { native } from './native.js';
import * as L from './logic.js';
import * as S from './sms.js';
import {
  $, $$, esc, icon, tile, openSheet, actionSheet, pickDate, keypadHTML, bindKeypad,
  segmented, bindSegmented, amountSizeClass, haptic, toast, promptText, alert,
} from './ui.js';
import { openCategoryEditor, openAccountEditor } from './manage.js';

const TYPE_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'loan', label: 'Loan' },
];
const TYPE_TITLES = { expense: 'Expense', income: 'Income', transfer: 'Transfer', loan: 'Loan' };
const DIRECTION_OPTIONS = [{ value: 'out', label: 'I gave' }, { value: 'in', label: 'I got' }];
const hasCategories = type => type === 'expense' || type === 'income';

/**
 * existing: a transaction to edit, or null for a new one.
 * preset (new ones): { type, categoryId, date, amount, note, accountId, toAccountId, person, direction } to start from,
 * source: a small line saying where it came from (a bank message),
 * onSave(fields): adds it instead of the usual store.addTransaction; returns the transaction.
 */
export function openEditor(existing = null, preset = {}) {
  const editing = !!existing;
  const rule = existing && existing.recurringId ? store.rule(existing.recurringId) : null;
  const from = existing || preset;
  const accounts = store.state.accounts;
  const s = {
    type: from.type || 'expense',
    typed: existing ? L.minorToTyped(existing.amount) : (preset.amount > 0 ? L.minorToTyped(preset.amount) : ''),
    categoryId: from.categoryId || null,
    accountId: existing ? existing.accountId : (preset.accountId !== undefined ? preset.accountId : store.state.settings.lastAccountId),
    toAccountId: from.toAccountId || null,
    person: from.person || '',
    direction: from.direction === 'in' ? 'in' : 'out',
    date: from.date || L.todayISO(),
    note: from.note || '',
    tag: existing ? (existing.tag || '') : (preset.tag !== undefined ? preset.tag : store.state.settings.activeTag || ''),
    repeat: rule ? rule.frequency : 'never',
    photo: existing ? !!existing.photo : false, // a photo is saved for this transaction
    categoryTouched: editing || !!preset.categoryId,
  };
  const tagFromTrip = !existing && preset.tag === undefined && !!store.state.settings.activeTag;
  let photoData = null;   // a newly picked photo (data URL), saved with the transaction
  let photoRemoved = false;
  if (hasCategories(s.type) && (!s.categoryId || store.category(s.categoryId).type !== s.type)) s.categoryId = store.likelyCategory(s.type);
  if (s.accountId && !store.account(s.accountId)) s.accountId = accounts[0] ? accounts[0].id : null;
  if (!s.toAccountId || !store.account(s.toAccountId)) s.toAccountId = defaultOtherAccount(s.accountId);
  const original = JSON.stringify(s);

  function defaultOtherAccount(fromId) {
    const preferred = ['cash', 'card', 'bank', 'upi'].find(id => id !== fromId && store.account(id));
    return preferred || (accounts.find(a => a.id !== fromId) || {}).id || null;
  }

  const titleText = () => `${editing ? 'Edit' : 'New'} ${TYPE_TITLES[s.type]}`;
  const canSpeak = !editing && native.canListen();

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
          ${!editing && preset.source ? `<div class="editor-source">${icon('chat-text')}<span>${esc(preset.source)}</span></div>` : ''}
          <input class="note-input" type="text" maxlength="80" enterkeyhint="done" autocomplete="off" spellcheck="false">
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

  /** The note box is the person's name for a loan. */
  function paintNote() {
    const loan = s.type === 'loan';
    noteEl.placeholder = loan ? 'Who? (their name)' : 'Add a note';
    noteEl.value = loan ? s.person : s.note;
  }

  function paintAmount() {
    const text = s.typed ? L.formatTyped(s.typed, store.currency) : '0';
    $('.amount-value', root).textContent = text;
    amountEl.className = `amount-display ${s.typed ? '' : 'empty'} ${s.type === 'income' && s.typed ? 'income' : ''} ${amountSizeClass(text)}`;
    $('.kp-done', root).classList.toggle('off', !L.typedToMinor(s.typed));
  }

  function accountButton(which, id) {
    const a = store.account(id);
    return `<button class="xfer-acc" data-xfer="${which}">${tile(a ? a.icon : 'wallet', a ? a.color : 'gray', 'lg')}
      <span class="xfer-text"><small>${which === 'from' ? 'From' : 'To'}</small><strong>${esc(a ? a.name : 'Choose')}</strong></span></button>`;
  }

  function paintCategories(scroll = false) {
    catStrip.classList.toggle('special', !hasCategories(s.type));
    if (s.type === 'transfer') {
      catStrip.innerHTML = `<div class="xfer">${accountButton('from', s.accountId)}<span class="xfer-arrow">${icon('arrow-right')}</span>${accountButton('to', s.toAccountId)}</div>`;
      return;
    }
    if (s.type === 'loan') {
      const people = L.personBalances(store.state.transactions).slice(0, 8);
      catStrip.innerHTML = `
        <div class="loan-box">
          ${segmented(DIRECTION_OPTIONS, s.direction, 'dir')}
          ${people.length ? `<div class="loan-people">${people.map((p, i) => `<button class="chip ${L.personKey(p.name) === L.personKey(s.person) ? 'on' : ''}" data-person="${i}">${esc(p.name)}${p.balance ? ` · ${esc(store.money(Math.abs(p.balance)))}` : ''}</button>`).join('')}</div>` : ''}
        </div>`;
      catStrip._people = people;
      return;
    }
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
    const showPhoto = s.type !== 'transfer';
    const hasPhoto = !photoRemoved && (photoData || s.photo);
    $('.detail-row', root).innerHTML = `
      ${canSpeak ? `<button class="chip" data-detail="speak" aria-label="Speak">${icon('microphone')}Speak</button>` : ''}
      <button class="chip" data-detail="date">${icon('calendar-blank')}${esc(L.shortDate(s.date))}</button>
      ${s.type !== 'transfer' ? `<button class="chip" data-detail="account">${icon(account ? account.icon : 'wallet')}${esc(account ? account.name : 'No account')}</button>` : ''}
      <button class="chip ${s.tag ? 'on' : ''}" data-detail="tag">${icon('tag')}${esc(s.tag || 'Tag')}</button>
      ${showPhoto ? `<button class="chip ${hasPhoto ? 'on' : ''}" data-detail="photo">${icon('camera')}${hasPhoto ? 'Photo' : 'Add Photo'}</button>` : ''}
      <button class="chip ${s.repeat !== 'never' ? 'on' : ''}" data-detail="repeat">${icon('repeat')}${esc(s.repeat === 'never' ? 'Repeat' : L.FREQUENCY_LABELS[s.repeat])}</button>
      ${editing ? `<button class="chip danger" data-detail="delete" aria-label="Delete">${icon('trash')}Delete</button>` : ''}`;
  }

  function paintSuggestions() {
    const box = $('.suggestions', root);
    if (!editorEl.classList.contains('typing')) { box.innerHTML = ''; return; }
    if (s.type === 'loan') {
      const q = L.personKey(s.person);
      const names = L.personBalances(store.state.transactions).filter(p => q && p.key !== q && p.key.includes(q)).slice(0, 3);
      box.innerHTML = names.map((p, i) => `<button class="chip" data-sug="${i}">${esc(p.name)}</button>`).join('');
      box._list = names.map(p => ({ person: p.name }));
      return;
    }
    if (s.type === 'transfer') { box.innerHTML = ''; return; }
    const list = L.noteSuggestions(store.state.transactions, s.note, s.type);
    box.innerHTML = list.map((x, i) => `<button class="chip" data-sug="${i}">${esc(x.note)}</button>`).join('');
    box._list = list;
  }

  function applyRemembered(match) {
    if (!match || !hasCategories(s.type)) return;
    if (!s.categoryTouched && store.categories(s.type).some(c => c.id === match.categoryId)) {
      s.categoryId = match.categoryId;
      paintCategories(true);
    }
    if (match.accountId && store.account(match.accountId)) {
      s.accountId = match.accountId;
      paintDetails();
    }
  }

  function repaintAll() {
    $('.ed-title', root).textContent = titleText();
    paintNote();
    paintAmount();
    paintCategories(true);
    paintDetails();
  }

  function dirty() {
    return JSON.stringify(s) !== original || !!photoData || photoRemoved;
  }

  function shake(el) {
    haptic('error');
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  async function save() {
    const amount = L.typedToMinor(s.typed);
    if (!amount) return shake(amountEl);
    if (s.type === 'loan' && !s.person.trim()) {
      noteEl.focus();
      return shake(noteEl);
    }
    if (s.type === 'transfer' && (!s.accountId || !s.toAccountId || s.accountId === s.toAccountId)) {
      shake(catStrip);
      toast('Pick two different accounts', { iconName: 'warning-circle' });
      return;
    }
    const fields = {
      type: s.type,
      amount,
      categoryId: hasCategories(s.type) ? s.categoryId : null,
      accountId: s.accountId,
      date: s.date,
      note: s.type === 'loan' ? '' : s.note.trim(),
      toAccountId: s.type === 'transfer' ? s.toAccountId : undefined,
      person: s.type === 'loan' ? s.person.trim() : undefined,
      direction: s.type === 'loan' ? s.direction : undefined,
      // A running trip tags spending by default, not money moved between accounts or people
      tag: (tagFromTrip && !hasCategories(s.type) && s.tag === store.state.settings.activeTag) ? undefined : s.tag || undefined,
    };
    let tx;
    if (editing) {
      tx = store.updateTransaction(existing.id, fields);
      if (tx && tx.sms) store.learnFromEdit(tx); // a bank-message payee learns the new category/name
    } else if (preset.onSave) {
      tx = preset.onSave(fields);
    } else {
      tx = store.addTransaction(fields);
    }
    const hadRule = rule ? rule.frequency : 'never';
    if (tx && (s.repeat !== hadRule || (s.repeat !== 'never' && editing))) store.setRepeat(tx, s.repeat);
    haptic('success');
    handle.close('saved');
    if (tx && photoData) {
      const saved = await native.savePhoto(tx.id, photoData);
      if (saved) store.setPhoto(tx.id, true);
      else toast('Couldn’t save the photo', { iconName: 'warning-circle' });
    } else if (tx && photoRemoved && s.photo) {
      native.deletePhoto(tx.id);
      store.setPhoto(tx.id, false);
    }
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

  async function pickAccount(title, current, exclude) {
    const actions = accounts.filter(a => a.id !== exclude).map(a => ({ text: a.name, value: a.id, icon: a.icon, checked: a.id === current }));
    actions.push({ text: 'Add Account…', value: '__new', icon: 'plus' });
    const choice = await actionSheet({ title, actions });
    if (choice !== '__new') return choice;
    return new Promise(resolve => openAccountEditor({ onSaved: acc => resolve(acc.id) }));
  }

  // ---- Speaking: "spent 450 on petrol yesterday"

  async function speak() {
    const heard = await native.listen();
    if (!heard.ok) {
      if (heard.error) toast(heard.error, { iconName: 'warning-circle' });
      return;
    }
    const spoken = L.parseSpoken(heard.text);
    if (!spoken.amount) {
      toast(`Heard “${heard.text}” — say an amount too`, { iconName: 'microphone', duration: 5000 });
      return;
    }
    s.type = spoken.type;
    s.typed = L.minorToTyped(spoken.amount);
    s.date = spoken.date;
    s.note = spoken.note;
    const guess = S.guessCategory({ type: s.type, merchant: spoken.note, body: heard.text }, store.state);
    if (guess) { s.categoryId = guess; s.categoryTouched = true; }
    const seg = $('.segmented[data-name="type"]', root);
    $$('button', seg).forEach((b, i) => { const on = b.dataset.value === s.type; b.classList.toggle('on', on); if (on) seg.style.setProperty('--i', i); });
    repaintAll();
    haptic('success');
    toast(`Heard “${heard.text}”`, { iconName: 'microphone' });
  }

  // ---- Photo of the bill

  async function photoMenu() {
    const hasPhoto = !photoRemoved && (photoData || s.photo);
    if (!hasPhoto) {
      const picked = await native.pickPhoto();
      if (picked.ok) { photoData = picked.dataUrl; photoRemoved = false; paintDetails(); haptic('success'); }
      else if (picked.error) toast(picked.error, { iconName: 'warning-circle' });
      return;
    }
    const choice = await actionSheet({ actions: [
      { text: 'View Photo', value: 'view', icon: 'image' },
      { text: 'Replace Photo', value: 'replace', icon: 'camera' },
      { text: 'Remove Photo', value: 'remove', style: 'destructive' },
    ] });
    if (choice === 'view') {
      const url = photoData || await native.photoUrl(existing.id);
      if (url) showPhoto(url);
    } else if (choice === 'replace') {
      const picked = await native.pickPhoto();
      if (picked.ok) { photoData = picked.dataUrl; photoRemoved = false; paintDetails(); }
    } else if (choice === 'remove') {
      photoData = null;
      photoRemoved = true;
      paintDetails();
    }
  }

  // ---- Events

  $('.ed-cancel', root).addEventListener('click', cancel);
  $('.ed-save', root).addEventListener('click', save);

  bindSegmented(root, (name, value) => {
    if (name === 'dir') {
      s.direction = value;
      return;
    }
    if (name !== 'type') return;
    s.type = value;
    if (hasCategories(value) && (!s.categoryTouched || store.category(s.categoryId).type !== value)) s.categoryId = store.likelyCategory(value);
    if (value === 'transfer' && (!s.toAccountId || s.toAccountId === s.accountId)) s.toAccountId = defaultOtherAccount(s.accountId);
    repaintAll();
  });

  bindKeypad(root, key => {
    if (key === 'done') return save();
    s.typed = key === 'clear' ? '' : L.typeKey(s.typed, key);
    paintAmount();
  });

  catStrip.addEventListener('click', async e => {
    const xfer = e.target.closest('[data-xfer]');
    if (xfer) {
      const which = xfer.dataset.xfer;
      const picked = await pickAccount(which === 'from' ? 'From' : 'To', which === 'from' ? s.accountId : s.toAccountId, which === 'from' ? s.toAccountId : s.accountId);
      if (picked) {
        if (which === 'from') s.accountId = picked; else s.toAccountId = picked;
        paintCategories();
      }
      return;
    }
    const personChip = e.target.closest('[data-person]');
    if (personChip) {
      s.person = catStrip._people[Number(personChip.dataset.person)].name;
      noteEl.value = s.person;
      haptic('selection');
      paintCategories();
      return;
    }
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
      if (query && !editing && hasCategories(s.type)) {
        const match = L.sortTransactions(store.state.transactions).find(t => t.type === s.type && (t.note || '').trim().toLowerCase() === query);
        if (match) applyRemembered(match);
      }
      if (s.type === 'loan') paintCategories();
    }, 150);
  });
  noteEl.addEventListener('input', () => {
    if (s.type === 'loan') s.person = noteEl.value;
    else s.note = noteEl.value;
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
    if (match.person) {
      s.person = match.person;
      noteEl.value = match.person;
    } else {
      s.note = match.note;
      noteEl.value = match.note;
      applyRemembered(match);
    }
    haptic('selection');
    noteEl.blur();
  });

  $('.detail-row', root).addEventListener('click', async e => {
    const chip = e.target.closest('[data-detail]');
    if (!chip) return;
    const kind = chip.dataset.detail;
    if (kind === 'speak') {
      speak();
    } else if (kind === 'date') {
      const picked = await pickDate(s.date, { title: 'Date' });
      if (picked) { s.date = picked; paintDetails(); }
    } else if (kind === 'account') {
      const actions = accounts.map(a => ({ text: a.name, value: a.id, icon: a.icon, checked: a.id === s.accountId }));
      actions.push({ text: 'No Account', value: '__none', checked: !s.accountId });
      actions.push({ text: 'Add Account…', value: '__new', icon: 'plus' });
      const choice = await actionSheet({ title: s.type === 'income' || (s.type === 'loan' && s.direction === 'in') ? 'Received In' : 'Paid With', actions });
      if (choice === '__new') {
        openAccountEditor({ onSaved: acc => { s.accountId = acc.id; paintDetails(); } });
      } else if (choice === '__none') {
        s.accountId = null;
        paintDetails();
      } else if (choice) {
        s.accountId = choice;
        paintDetails();
      }
    } else if (kind === 'tag') {
      const tags = L.tagSummaries(store.state.transactions).map(t => t.tag);
      const active = store.state.settings.activeTag;
      if (active && !tags.some(t => t.toLowerCase() === active.toLowerCase())) tags.unshift(active);
      const choice = await actionSheet({
        title: 'Trip or Event',
        message: 'Tag spending to see what a trip, wedding or project cost in total.',
        actions: [
          ...tags.slice(0, 8).map(t => ({ text: t, value: `tag:${t}`, icon: 'tag', checked: t === s.tag })),
          { text: 'New Tag…', value: '__new', icon: 'plus' },
          ...(s.tag ? [{ text: 'No Tag', value: '__none' }] : []),
        ],
      });
      if (choice === '__new') {
        const name = await promptText({ title: 'New Tag', placeholder: 'Goa trip, Wedding, House repair…' });
        if (name) { s.tag = name; paintDetails(); }
      } else if (choice === '__none') {
        s.tag = '';
        paintDetails();
      } else if (choice) {
        s.tag = choice.slice(4);
        paintDetails();
      }
    } else if (kind === 'photo') {
      photoMenu();
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

  repaintAll();
  if (preset.speak && canSpeak) setTimeout(speak, 350);
  return handle;
}

/** Full-screen view of a bill photo. */
export function showPhoto(url) {
  const handle = openSheet({
    size: 'large',
    className: 'photo-sheet',
    html: `
      <header class="sheet-header" data-drag>
        <span></span><h2 class="sheet-title">Photo</h2><button class="nav-btn strong ph-done">Done</button>
      </header>
      <div class="photo-view"><img alt="Bill photo" src="${esc(url)}"></div>`,
  });
  $('.ph-done', handle.el).addEventListener('click', () => handle.close('done'));
  const img = $('img', handle.el);
  img.addEventListener('error', () => alert({ title: 'Photo not found', message: 'This photo is no longer on this device.' }));
}
