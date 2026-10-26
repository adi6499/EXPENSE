// The app's data and every change to it. Saved to the phone after each change.
import * as L from './logic.js';
import { native } from './native.js';

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
    settings: {
      currency: 'INR',
      appearance: 'auto',
      lock: false,
      reminder: { enabled: false, hour: 21, minute: 0 },
      onboarded: false,
      lastAccountId: 'upi',
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
    settings: { ...base.settings, ...(raw.settings || {}) },
  };
  state.settings.reminder = { ...base.settings.reminder, ...(state.settings.reminder || {}) };
  state.budgets.categories = state.budgets.categories || {};
  state.transactions = state.transactions
    .filter(t => t && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isFinite(t.amount))
    .map(t => ({
      id: t.id || L.uid(),
      type: t.type === 'income' ? 'income' : 'expense',
      amount: Math.abs(Math.round(t.amount)),
      categoryId: t.categoryId || null,
      accountId: t.accountId || null,
      date: t.date,
      note: typeof t.note === 'string' ? t.note : '',
      createdAt: t.createdAt || Date.now(),
      ...(t.recurringId ? { recurringId: t.recurringId } : {}),
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
    for (const t of this.state.transactions) if (t.accountId === id) t.accountId = null;
    for (const r of this.state.recurring) if (r.accountId === id) r.accountId = null;
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

  // ---- Bulk

  replaceAll(raw) {
    this.state = normalizeState(raw);
    this.state.settings.onboarded = true;
    this.applyRecurring(false);
    this.commit();
  },

  eraseAll() {
    const keep = { currency: this.state.settings.currency, appearance: this.state.settings.appearance };
    this.state = createDefaultState();
    Object.assign(this.state.settings, keep, { onboarded: true });
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
      this.state.transactions.push({
        id: L.uid(),
        type: item.type,
        amount: item.amount,
        categoryId: findCategory(item.categoryName, item.type),
        accountId: findAccount(item.accountName),
        date: item.date,
        note: item.note || '',
        createdAt: now + added,
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
