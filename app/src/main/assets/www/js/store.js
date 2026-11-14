// The app's data and every change to it. Saved to the phone after each change.
import * as L from './logic.js';
import * as S from './sms.js';
import { native } from './native.js';

const MAX_PENDING = 300;

function defaultSms() {
  return {
    enabled: false,   // read bank text messages (Android only)
    autoAdd: false,   // add them straight away instead of waiting for a check
    notify: true,     // a notification when a bank message arrives and the app is closed
    lastDate: 0,      // newest message already looked at (milliseconds)
    pending: [],      // found in messages, waiting to be checked and added
    payees: {},       // what was learned per payee (see "Learning" in sms.js)
    balances: {},     // 'HDFC Bank|1234' → { amount, kind: 'balance'|'limit', time } from the latest message
    accounts: {},     // 'HDFC Bank|1234' → account chosen for it
  };
}

export const COLORS = ['red', 'orange', 'yellow', 'green', 'mint', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown', 'gray'];

export const CATEGORY_ICONS = [
  'fork-knife', 'coffee', 'hamburger', 'pizza', 'wine', 'shopping-cart-simple', 'basket', 'bag', 't-shirt', 'sneaker',
  'car', 'motorcycle', 'bus', 'train', 'taxi', 'gas-pump', 'airplane-tilt', 'suitcase', 'house', 'lightning',
  'drop', 'wifi-high', 'phone', 'device-mobile', 'television', 'film-slate', 'game-controller', 'music-notes', 'heartbeat', 'pill',
  'first-aid', 'barbell', 'graduation-cap', 'book-open', 'baby', 'paw-print', 'gift', 'heart', 'sparkle', 'scissors',
  'wrench', 'hammer', 'plant', 'arrows-clockwise', 'receipt', 'bank', 'credit-card', 'money', 'piggy-bank', 'coins',
  'briefcase', 'storefront', 'laptop', 'trend-up', 'chart-line-up', 'hand-coins', 'arrow-u-up-left', 'user', 'users', 'tag',
  'dots-three',
];

export const ACCOUNT_ICONS = ['money', 'device-mobile', 'bank', 'credit-card', 'wallet', 'piggy-bank', 'coins', 'vault', 'hand-coins', 'qr-code'];

function defaultCategories() {
  const expense = [
    ['food', 'Food & Dining', 'fork-knife', 'orange'],
    ['groceries', 'Groceries', 'shopping-cart-simple', 'green'],
    ['transport', 'Transport', 'car', 'blue'],
    ['fuel', 'Fuel', 'gas-pump', 'brown'],
    ['shopping', 'Shopping', 'bag', 'pink'],
    ['bills', 'Bills & Utilities', 'lightning', 'yellow'],
    ['rent', 'Rent & Home', 'house', 'indigo'],
    ['health', 'Health', 'heartbeat', 'red'],
    ['entertainment', 'Entertainment', 'film-slate', 'purple'],
    ['education', 'Education', 'graduation-cap', 'teal'],
    ['travel', 'Travel', 'airplane-tilt', 'cyan'],
    ['subscriptions', 'Subscriptions', 'arrows-clockwise', 'mint'],
    ['gifts', 'Gifts & Donations', 'gift', 'red'],
    ['other', 'Other', 'dots-three', 'gray'],
  ].map(([id, name, icon, color]) => ({ id, name, icon, color, type: 'expense' }));
  const income = [
    ['salary', 'Salary', 'briefcase', 'green'],
    ['business', 'Business', 'storefront', 'blue'],
    ['freelance', 'Freelance', 'laptop', 'indigo'],
    ['investments', 'Investments', 'trend-up', 'teal'],
    ['gifts_in', 'Gifts', 'gift', 'pink'],
    ['refunds', 'Refunds', 'arrow-u-up-left', 'orange'],
    ['other_in', 'Other', 'dots-three', 'gray'],
  ].map(([id, name, icon, color]) => ({ id, name, icon, color, type: 'income' }));
  return [...expense, ...income];
}

function defaultAccounts() {
  return [
    { id: 'cash', name: 'Cash', icon: 'money', color: 'green', openingBalance: 0 },
    { id: 'upi', name: 'UPI', icon: 'device-mobile', color: 'purple', openingBalance: 0 },
    { id: 'bank', name: 'Bank', icon: 'bank', color: 'blue', openingBalance: 0 },
    { id: 'card', name: 'Credit Card', icon: 'credit-card', color: 'orange', openingBalance: 0 },
  ];
}

export function createDefaultState() {
  return {
    version: 1,
    transactions: [],
    categories: defaultCategories(),
    accounts: defaultAccounts(),
    recurring: [],
    budgets: { monthly: 0, categories: {} },
    bills: [],        // { id, name, amount, minDue, dueDate, paid, autopay, key, source }
    sms: defaultSms(),
    settings: {
      currency: 'INR',
      appearance: 'auto',
      lock: false,
      reminder: { enabled: false, hour: 21, minute: 0 },
      onboarded: false,
      lastAccountId: 'upi',
      glass: true,        // Liquid Glass look for the bars, buttons and pop-ups
      activeTag: '',      // a trip or event that new spending is tagged with until it ends
      dismissed: {},      // heads-up alerts already closed
      summarySeen: '',    // 'YYYY-MM' whose monthly picture was already shown
      // Bank emails: the person's own Google script (see email.js)
      email: { url: '', key: '', enabled: false, lastDate: 0, lastCheck: 0 },
    },
  };
}

/** Fills in anything missing so old or hand-edited data never crashes the app. */
export function normalizeState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== 'object') return base;
  const state = {
    version: 1,
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    categories: Array.isArray(raw.categories) && raw.categories.length ? raw.categories : base.categories,
    accounts: Array.isArray(raw.accounts) ? raw.accounts : base.accounts,
    recurring: Array.isArray(raw.recurring) ? raw.recurring : [],
    budgets: { ...base.budgets, ...(raw.budgets || {}) },
    bills: Array.isArray(raw.bills) ? raw.bills.filter(b => b && b.id && Number.isFinite(b.amount) && /^\d{4}-\d{2}-\d{2}$/.test(b.dueDate || '')) : [],
    sms: { ...base.sms, ...(raw.sms && typeof raw.sms === 'object' ? raw.sms : {}) },
    settings: { ...base.settings, ...(raw.settings || {}) },
  };
  const sms = state.sms;
  sms.pending = Array.isArray(sms.pending)
    ? sms.pending.filter(p => p && p.id && Number.isFinite(p.amount) && p.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date || '')).slice(0, MAX_PENDING)
    : [];
  for (const key of ['payees', 'accounts', 'balances']) if (!sms[key] || typeof sms[key] !== 'object') sms[key] = {};
  sms.lastDate = Number(sms.lastDate) || 0;
  delete sms.merchants;
  state.settings.reminder = { ...base.settings.reminder, ...(state.settings.reminder || {}) };
  if (!state.settings.dismissed || typeof state.settings.dismissed !== 'object') state.settings.dismissed = {};
  if (typeof state.settings.activeTag !== 'string') state.settings.activeTag = '';
  state.settings.email = { ...base.settings.email, ...(state.settings.email && typeof state.settings.email === 'object' ? state.settings.email : {}) };
  state.budgets.categories = state.budgets.categories || {};
  state.transactions = state.transactions
    .filter(t => t && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isFinite(t.amount))
    .map(t => ({
      id: t.id || L.uid(),
      type: ['expense', 'income', 'transfer', 'loan'].includes(t.type) ? t.type : 'expense',
      amount: Math.abs(Math.round(t.amount)),
      categoryId: t.type === 'transfer' || t.type === 'loan' ? null : t.categoryId || null,
      accountId: t.accountId || null,
      date: t.date,
      note: typeof t.note === 'string' ? t.note : '',
      createdAt: t.createdAt || Date.now(),
      ...(t.recurringId ? { recurringId: t.recurringId } : {}),
      ...(t.type === 'transfer' ? { toAccountId: t.toAccountId || null } : {}),
      ...(t.type === 'loan' ? { person: String(t.person || 'Someone'), direction: t.direction === 'in' ? 'in' : 'out' } : {}),
      ...(t.tag ? { tag: String(t.tag) } : {}),
      ...(t.photo ? { photo: true } : {}),
      ...(t.sms && typeof t.sms === 'object' && t.sms.id ? { sms: {
        id: String(t.sms.id),
        ...(t.sms.ref ? { ref: String(t.sms.ref) } : {}),
        ...(t.sms.payee ? { payee: String(t.sms.payee) } : {}),
      } } : {}),
    }));
  // Every type always keeps an "Other" category to fall back on
  for (const [id, type] of [['other', 'expense'], ['other_in', 'income']]) {
    if (!state.categories.some(c => c.id === id)) state.categories.push(base.categories.find(c => c.id === id) || { id, type, name: 'Other', icon: 'dots-three', color: 'gray' });
  }
  return state;
}

const UNKNOWN_CATEGORY = { id: null, name: 'Uncategorized', icon: 'question', color: 'gray', type: 'expense' };

export const store = {
  state: createDefaultState(),
  listeners: new Set(),
  saveFailed: false,

  load() {
    const text = native.load();
    let raw = null;
    if (text) {
      try { raw = JSON.parse(text); } catch { raw = null; }
    }
    this.state = normalizeState(raw);
    this.applyRecurring();
  },

  /** Re-reads the saved data (another browser tab changed it) and refreshes the screens. */
  reload() {
    this.load();
    for (const fn of this.listeners) fn(this.state);
  },

  save() {
    const ok = native.save(JSON.stringify(this.state));
    this.saveFailed = !ok;
    return ok;
  },

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  commit() {
    this.save();
    for (const fn of this.listeners) fn(this.state);
  },

  // ---- Lookups

  category(id) {
    return this.state.categories.find(c => c.id === id) || UNKNOWN_CATEGORY;
  },

  categories(type) {
    return this.state.categories.filter(c => c.type === type);
  },

  account(id) {
    return this.state.accounts.find(a => a.id === id) || null;
  },

  rule(id) {
    return this.state.recurring.find(r => r.id === id) || null;
  },

  get currency() {
    return this.state.settings.currency;
  },

  money(minor, opts) {
    return L.formatMoney(minor, this.state.settings.currency, opts);
  },

  /** Category used most for this type in the last 60 days (so the editor starts on a likely one). */
  likelyCategory(type) {
    const since = L.addDays(L.todayISO(), -60);
    const counts = new Map();
    for (const t of this.state.transactions) {
      if (t.type === type && t.date >= since) counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1);
    }
    let best = null;
    for (const [id, n] of counts) if (!best || n > best[1]) best = [id, n];
    const list = this.categories(type);
    return (best && list.some(c => c.id === best[0])) ? best[0] : (list[0] && list[0].id);
  },

  // ---- Transactions

  addTransaction(tx) {
    const t = { id: L.uid(), createdAt: Date.now(), note: '', ...tx };
    this.state.transactions.push(t);
    if (t.accountId) this.state.settings.lastAccountId = t.accountId;
    this.commit();
    return t;
  },

  updateTransaction(id, patch) {
    const t = this.state.transactions.find(x => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    this.commit();
    return t;
  },

  deleteTransaction(id) {
    const index = this.state.transactions.findIndex(x => x.id === id);
    if (index < 0) return null;
    const [removed] = this.state.transactions.splice(index, 1);
    this.commit();
    return removed;
  },

  restoreTransaction(tx) {
    if (!this.state.transactions.some(x => x.id === tx.id)) this.state.transactions.push(tx);
    this.commit();
  },

  // ---- Repeating

  /** Makes (or updates / removes) the repeat rule behind a transaction. */
  setRepeat(tx, frequency) {
    const existing = tx.recurringId ? this.rule(tx.recurringId) : null;
    if (frequency === 'never') {
      if (existing) this.state.recurring = this.state.recurring.filter(r => r.id !== existing.id);
      delete tx.recurringId;
      this.commit();
      return;
    }
    const rule = existing || { id: L.uid(), active: true, createdAt: Date.now() };
    Object.assign(rule, {
      type: tx.type,
      amount: tx.amount,
      categoryId: tx.categoryId,
      accountId: tx.accountId,
      note: tx.note,
      frequency,
      anchorDay: L.parseISO(tx.date).getDate(),
    });
    delete rule.toAccountId;
    delete rule.person;
    delete rule.direction;
    if (tx.type === 'transfer') rule.toAccountId = tx.toAccountId;
    if (tx.type === 'loan') Object.assign(rule, { person: tx.person, direction: tx.direction });
    if (!existing || existing.frequency !== frequency || !existing.nextDate || existing.nextDate <= tx.date) {
      rule.nextDate = L.nextOccurrence(tx.date, frequency, rule.anchorDay);
    }
    if (!existing) this.state.recurring.push(rule);
    tx.recurringId = rule.id;
    this.applyRecurring(false);
    this.commit();
  },

  deleteRule(id) {
    this.state.recurring = this.state.recurring.filter(r => r.id !== id);
    for (const t of this.state.transactions) if (t.recurringId === id) delete t.recurringId;
    this.commit();
  },

  /** Adds every repeating transaction that has come due. Returns how many were added. */
  applyRecurring(save = true) {
    const created = L.runRecurring(this.state.recurring);
    if (created.length) {
      this.state.transactions.push(...created);
      if (save) this.commit();
    }
    return created.length;
  },

  // ---- Categories & accounts

  saveCategory(cat) {
    const existing = this.state.categories.find(c => c.id === cat.id);
    if (existing) Object.assign(existing, cat);
    else this.state.categories.push({ ...cat, id: cat.id || L.uid() });
    this.commit();
  },

  /** Removes a category; its transactions move to that type's "Other". */
  deleteCategory(id) {
    const cat = this.category(id);
    const fallback = cat.type === 'income' ? 'other_in' : 'other';
    if (id === fallback) return false;
    for (const t of this.state.transactions) if (t.categoryId === id) t.categoryId = fallback;
    for (const r of this.state.recurring) if (r.categoryId === id) r.categoryId = fallback;
    delete this.state.budgets.categories[id];
    this.state.categories = this.state.categories.filter(c => c.id !== id);
    this.commit();
    return true;
  },

  moveCategory(id, direction) {
    const list = this.state.categories;
    const index = list.findIndex(c => c.id === id);
    const type = list[index].type;
    let swap = index + direction;
    while (swap >= 0 && swap < list.length && list[swap].type !== type) swap += direction;
    if (swap < 0 || swap >= list.length) return;
    [list[index], list[swap]] = [list[swap], list[index]];
    this.commit();
  },

  saveAccount(account) {
    const existing = this.state.accounts.find(a => a.id === account.id);
    if (existing) Object.assign(existing, account);
    else this.state.accounts.push({ openingBalance: 0, ...account, id: account.id || L.uid() });
    this.commit();
  },

  deleteAccount(id) {
    for (const t of this.state.transactions) {
      if (t.accountId === id) t.accountId = null;
      if (t.toAccountId === id) t.toAccountId = null;
    }
    for (const r of this.state.recurring) {
      if (r.accountId === id) r.accountId = null;
      if (r.toAccountId === id) r.toAccountId = null;
    }
    this.state.accounts = this.state.accounts.filter(a => a.id !== id);
    if (this.state.settings.lastAccountId === id) this.state.settings.lastAccountId = this.state.accounts[0] ? this.state.accounts[0].id : null;
    this.commit();
  },

  usageCount(field, id) {
    return this.state.transactions.filter(t => t[field] === id).length;
  },

  // ---- Budgets & settings

  setMonthlyBudget(minor) {
    this.state.budgets.monthly = minor;
    this.commit();
  },

  setCategoryBudget(id, minor) {
    if (minor > 0) this.state.budgets.categories[id] = minor;
    else delete this.state.budgets.categories[id];
    this.commit();
  },

  setSetting(key, value) {
    this.state.settings[key] = value;
    this.commit();
  },

  // ---- Bank text messages (see sms.js and messages.js)

  setSms(patch) {
    Object.assign(this.state.sms, patch);
    this.commit();
  },

  /**
   * Takes what was found in new messages and decides for each (see S.decide): add it now
   * (a payee it has learned, or "Add Without Asking"), skip it (a payee you always ignore),
   * or list it to check. Returns { added: [{ tx, finding }], queued, skipped }.
   */
  takeFindings(findings, newestDate = 0) {
    const sms = this.state.sms;
    const added = [];
    let queued = 0;
    let skipped = 0;
    const now = Date.now();
    for (const f of [...findings].sort((a, b) => a.time - b.time)) {
      if (S.alreadyHave(f, this.state)) continue;
      const decision = S.decide(f, this.state);
      if (decision === 'ignore') {
        skipped++;
      } else if (decision === 'add') {
        const tx = { id: L.uid(), createdAt: now + added.length, ...S.toTransaction(f, this.state) };
        this.state.transactions.push(tx);
        S.learnAdded(this.state, f, tx);
        added.push({ tx, finding: f });
      } else {
        sms.pending.push(f);
        queued++;
      }
    }
    sms.pending.sort((a, b) => b.time - a.time);
    if (sms.pending.length > MAX_PENDING) sms.pending.length = MAX_PENDING;
    if (newestDate > sms.lastDate) sms.lastDate = newestDate;
    if (added.length || queued || skipped) this.commit();
    else this.save();
    return { added, queued, skipped };
  },

  finding(id) {
    return this.state.sms.pending.find(p => p.id === id) || null;
  },

  /** A copy of what has been learned, so an Undo can put it back exactly. */
  learningSnapshot() {
    return JSON.parse(JSON.stringify({ payees: this.state.sms.payees, accounts: this.state.sms.accounts }));
  },

  /**
   * Adds one found transaction. choice: what was picked in the editor (learned, including the
   * name typed and the account). Returns { tx, before } (before: for Undo).
   */
  acceptFinding(id, choice = null) {
    const f = this.finding(id);
    if (!f) return null;
    const before = this.learningSnapshot();
    const guess = S.toTransaction(f, this.state);
    const tx = { id: L.uid(), createdAt: Date.now(), ...guess, ...(choice || {}), sms: guess.sms };
    S.learnAdded(this.state, f, tx, { explicit: !!choice });
    this.state.transactions.push(tx);
    this.state.sms.pending = this.state.sms.pending.filter(p => p.id !== id);
    this.commit();
    return { tx, before };
  },

  acceptAllFindings() {
    const now = Date.now();
    const before = this.learningSnapshot();
    const list = [...this.state.sms.pending].reverse();
    const added = list.map((f, i) => {
      const tx = { id: L.uid(), createdAt: now + i, ...S.toTransaction(f, this.state) };
      S.learnAdded(this.state, f, tx);
      return tx;
    });
    this.state.transactions.push(...added);
    this.state.sms.pending = [];
    this.commit();
    return { added, before };
  },

  ignoreFinding(id) {
    const f = this.finding(id);
    if (!f) return null;
    const before = this.learningSnapshot();
    S.learnIgnored(this.state, f);
    this.state.sms.pending = this.state.sms.pending.filter(p => p.id !== id);
    this.commit();
    return { finding: f, before };
  },

  /**
   * Undo: puts findings back on the list to check and takes out transactions made from them.
   * before: learning to put back; distrust: an automatic add was undone, so stop trusting the payee.
   */
  restoreFindings(findings, txIds = [], { before = null, distrust = false } = {}) {
    const ids = new Set(txIds);
    if (ids.size) this.state.transactions = this.state.transactions.filter(t => !ids.has(t.id));
    for (const f of findings) if (!this.finding(f.id)) this.state.sms.pending.push(f);
    this.state.sms.pending.sort((a, b) => b.time - a.time);
    if (before) Object.assign(this.state.sms, before);
    if (distrust) for (const f of findings) S.learnUndone(this.state, f);
    this.commit();
  },

  /** A transaction from a message was edited: learn the new category and name for its payee. */
  learnFromEdit(tx) {
    if (!tx || !tx.sms) return;
    S.learnEdited(this.state, tx);
    this.save();
  },

  /** Settings → Learned: 'auto' | 'ask' | 'ignore' | null (go back to learning by itself). */
  setPayeeMode(key, mode) {
    const p = this.state.sms.payees[key];
    if (!p) return;
    if (mode) p.mode = mode;
    else delete p.mode;
    if (mode === 'ask' || !mode) { p.seen = Math.min(p.seen || 0, 1); p.ignored = 0; }
    this.commit();
  },

  setPayeeCategory(key, categoryId) {
    const p = this.state.sms.payees[key];
    if (!p) return;
    p.categoryId = categoryId;
    this.commit();
  },

  forgetPayee(key) {
    delete this.state.sms.payees[key];
    this.commit();
  },

  forgetAllLearning() {
    this.state.sms.payees = {};
    this.state.sms.accounts = {};
    this.commit();
  },

  // ---- Balances and bills read from bank messages

  /** Keeps the newest balance per bank + account, and the bills (one per bill and due date). */
  takeMessageExtras({ balances = [], bills = [], paid = [] }) {
    let changed = false;
    const known = this.state.sms.balances;
    for (const b of balances) {
      if (!known[b.key] || known[b.key].time <= b.time) {
        known[b.key] = { amount: b.amount, kind: b.kind, time: b.time, bank: b.bank, last4: b.last4 };
        changed = true;
      }
    }
    for (const b of bills) {
      const same = this.state.bills.find(x => x.key === b.key && Math.abs(L.daysBetween(x.dueDate, b.dueDate)) <= 3);
      if (same) {
        if (same.source === 'sms' && !same.paid) Object.assign(same, { amount: b.amount, minDue: b.minDue, dueDate: b.dueDate });
        continue;
      }
      if (b.dueDate < L.addDays(L.todayISO(), -3)) continue; // long past
      this.state.bills.push({ id: L.uid(), key: b.key, name: b.name, amount: b.amount, minDue: b.minDue || 0, dueDate: b.dueDate,
        autopay: !!b.autopay, paid: false, source: 'sms', bank: b.bank || '', last4: b.last4 || '', createdAt: Date.now() });
      changed = true;
    }
    for (const p of paid) {
      const bill = this.state.bills.filter(x => !x.paid && x.key === p.key).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
      if (bill) { bill.paid = true; bill.paidOn = L.todayISO(); changed = true; }
    }
    // Paid bills disappear after a month
    const cutoff = L.addDays(L.todayISO(), -30);
    const before = this.state.bills.length;
    this.state.bills = this.state.bills.filter(b => !(b.paid && b.dueDate < cutoff) && !(b.autopay && b.dueDate < cutoff));
    if (this.state.bills.length !== before) changed = true;
    if (changed) this.commit();
    return changed;
  },

  saveBill(bill) {
    const existing = this.state.bills.find(b => b.id === bill.id);
    if (existing) Object.assign(existing, bill);
    else this.state.bills.push({ paid: false, minDue: 0, source: 'manual', key: `manual|${L.uid()}`, createdAt: Date.now(), ...bill, id: bill.id || L.uid() });
    this.commit();
  },

  setBillPaid(id, paid = true) {
    const bill = this.state.bills.find(b => b.id === id);
    if (!bill) return;
    bill.paid = paid;
    bill.paidOn = paid ? L.todayISO() : undefined;
    this.commit();
  },

  deleteBill(id) {
    this.state.bills = this.state.bills.filter(b => b.id !== id);
    this.commit();
  },

  /** Makes an account's balance match what the bank says, by setting its starting balance. */
  matchBalance(accountId, bankAmount) {
    const account = this.account(accountId);
    if (!account) return;
    const current = L.accountBalances([account], this.state.transactions).get(accountId);
    account.openingBalance = (account.openingBalance || 0) + (bankAmount - current);
    this.commit();
  },

  // ---- Trips, alerts, photos

  setActiveTag(tag) {
    this.state.settings.activeTag = String(tag || '').trim();
    this.commit();
  },

  renameTag(from, to) {
    const key = String(from).toLowerCase();
    for (const t of this.state.transactions) if (t.tag && t.tag.toLowerCase() === key) t.tag = to;
    if (this.state.settings.activeTag.toLowerCase() === key) this.state.settings.activeTag = to;
    this.commit();
  },

  dismissAlert(key) {
    const d = this.state.settings.dismissed;
    d[key] = 1;
    const keys = Object.keys(d);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete d[k];
    this.commit();
  },

  setPhoto(id, has) {
    const t = this.state.transactions.find(x => x.id === id);
    if (!t) return;
    if (has) t.photo = true;
    else delete t.photo;
    this.commit();
  },

  // ---- Bulk

  replaceAll(raw) {
    // Message reading belongs to this phone: keep its switches, learn the backup's choices
    const here = this.state.sms;
    this.state = normalizeState(raw);
    const backup = this.state.sms;
    this.state.sms = {
      ...here,
      lastDate: Math.max(here.lastDate, backup.lastDate),
      payees: { ...backup.payees, ...here.payees },
      accounts: { ...backup.accounts, ...here.accounts },
    };
    this.state.settings.onboarded = true;
    this.applyRecurring(false);
    this.commit();
  },

  eraseAll() {
    const keep = { currency: this.state.settings.currency, appearance: this.state.settings.appearance };
    const { enabled, autoAdd, notify, lastDate } = this.state.sms;
    this.state = createDefaultState();
    Object.assign(this.state.settings, keep, { onboarded: true });
    // Old messages stay read, so erasing doesn't bring them all back
    Object.assign(this.state.sms, { enabled, autoAdd, notify, lastDate });
    this.commit();
  },

  /** Adds imported rows, creating categories/accounts by name. Returns { added, duplicates }. */
  importItems(items) {
    const existing = new Set(this.state.transactions.map(L.duplicateKey));
    const findCategory = (name, type) => {
      if (!name) return type === 'income' ? 'other_in' : 'other';
      const key = name.trim().toLowerCase();
      let cat = this.state.categories.find(c => c.type === type && c.name.toLowerCase() === key);
      if (!cat) {
        const used = this.categories(type).length;
        cat = { id: L.uid(), type, name: name.trim(), icon: 'tag', color: COLORS[used % COLORS.length] };
        this.state.categories.push(cat);
      }
      return cat.id;
    };
    const findAccount = name => {
      if (!name) return null;
      const key = name.trim().toLowerCase();
      let acc = this.state.accounts.find(a => a.name.toLowerCase() === key);
      if (!acc) {
        acc = { id: L.uid(), name: name.trim(), icon: 'wallet', color: COLORS[(this.state.accounts.length * 3) % COLORS.length], openingBalance: 0 };
        this.state.accounts.push(acc);
      }
      return acc.id;
    };
    let added = 0;
    let duplicates = 0;
    const now = Date.now();
    for (const item of items) {
      if (existing.has(L.duplicateKey(item))) {
        duplicates++;
        continue;
      }
      const plain = item.type === 'income' || item.type === 'expense';
      this.state.transactions.push({
        id: L.uid(),
        type: item.type,
        amount: item.amount,
        categoryId: plain ? findCategory(item.categoryName, item.type) : null,
        accountId: findAccount(item.accountName),
        date: item.date,
        note: item.note || '',
        createdAt: now + added,
        ...(item.type === 'transfer' ? { toAccountId: findAccount(item.toAccountName) } : {}),
        ...(item.type === 'loan' ? { person: item.person, direction: item.direction } : {}),
        ...(item.tag ? { tag: item.tag } : {}),
      });
      added++;
    }
    this.commit();
    return { added, duplicates };
  },

  backupJSON() {
    return JSON.stringify({ app: 'expenses-app', backupVersion: 1, exportedAt: new Date().toISOString(), data: this.state }, null, 1);
  },
};

/** Reads a backup file's text. Returns the data, or null when it is not one of our backups. */
export function parseBackup(text) {
  try {
    const parsed = JSON.parse(text.replace(/^﻿/, ''));
    const data = parsed && parsed.app === 'expenses-app' ? parsed.data : parsed;
    if (!data || !Array.isArray(data.transactions)) return null;
    return data;
  } catch {
    return null;
  }
}
