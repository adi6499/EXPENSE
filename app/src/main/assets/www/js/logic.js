// Pure functions only: no DOM, no storage. Unit-tested in tests/logic.test.js.
// Money is always stored as whole minor units (paise/cents) so sums are exact.

export const CURRENCIES = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', locale: 'en-IN' },
  { code: 'USD', name: 'US Dollar', symbol: '$', locale: 'en-US' },
  { code: 'EUR', name: 'Euro', symbol: '€', locale: 'en-IE' },
  { code: 'GBP', name: 'British Pound', symbol: '£', locale: 'en-GB' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', locale: 'en-AE' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', locale: 'en-SA' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', locale: 'en-SG' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', locale: 'en-AU' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', locale: 'en-CA' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', locale: 'ja-JP' },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'Rs', locale: 'en-NP' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', locale: 'en-LK' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', locale: 'en-BD' },
];

export function currencyInfo(code) {
  return CURRENCIES.find(c => c.code === code) || CURRENCIES[0];
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- Dates (always local 'YYYY-MM-DD' strings, never time zones)

const pad = n => String(n).padStart(2, '0');

export function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function startOfMonth(iso) {
  return iso.slice(0, 8) + '01';
}

export function endOfMonth(iso) {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function addMonths(iso, months) {
  const d = parseISO(iso);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  target.setDate(Math.min(day, daysInMonth(target.getFullYear(), target.getMonth())));
  return toISO(target);
}

/** Monday of the week containing iso. */
export function startOfWeek(iso) {
  const d = parseISO(iso);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toISO(d);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((parseISO(toIso) - parseISO(fromIso)) / 86400000);
}

/** The date range for an insights period. kind: 'week' | 'month' | 'year'; offset 0 = current. */
export function periodRange(kind, offset = 0, today = todayISO()) {
  if (kind === 'week') {
    const start = addDays(startOfWeek(today), offset * 7);
    return { start, end: addDays(start, 6) };
  }
  if (kind === 'year') {
    const y = parseISO(today).getFullYear() + offset;
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  const start = addMonths(startOfMonth(today), offset);
  return { start, end: endOfMonth(start) };
}

export function periodLabel(kind, range, today = todayISO()) {
  const s = parseISO(range.start);
  const e = parseISO(range.end);
  if (kind === 'year') return String(s.getFullYear());
  if (kind === 'month') return s.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const sameMonth = s.getMonth() === e.getMonth();
  const left = s.toLocaleDateString('en-IN', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  const right = e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const label = `${left} – ${right}`;
  return range.start <= today && today <= range.end ? `This Week · ${label}` : label;
}

/** 'Today', 'Yesterday', or 'Mon, 21 Oct' (plus the year when it is not this year). */
export function dayLabel(iso, today = todayISO()) {
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const d = parseISO(iso);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString('en-IN', sameYear
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function shortDate(iso, today = todayISO()) {
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return parseISO(iso).toLocaleDateString('en-IN', sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------- Money

const formatterCache = new Map();
function formatter(currency, digits, compact) {
  const key = `${currency}|${digits}|${compact}`;
  if (!formatterCache.has(key)) {
    const info = currencyInfo(currency);
    const options = compact
      ? { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }
      : { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits };
    let nf;
    try {
      nf = new Intl.NumberFormat(info.locale, options);
    } catch {
      nf = new Intl.NumberFormat('en-US', options);
    }
    formatterCache.set(key, nf);
  }
  return formatterCache.get(key);
}

/**
 * formatMoney(125050, 'INR') → '₹1,250.50'; whole amounts drop the decimals ('₹1,250').
 * opts.sign adds '+' for positive numbers; negatives always get a real minus sign.
 */
export function formatMoney(minor, currency = 'INR', opts = {}) {
  const value = Math.round(minor || 0);
  const digits = currency === 'JPY' ? 0 : (value % 100 !== 0 || opts.decimals ? 2 : 0);
  const text = formatter(currency, digits, !!opts.compact).format(Math.abs(value) / 100);
  if (value < 0) return '−' + text;
  if (opts.sign && value > 0) return '+' + text;
  return text;
}

/** Number shown while typing on the keypad: '1250.5' → '1,250.5' in the currency's grouping. */
export function formatTyped(typed, currency = 'INR') {
  const [whole, fraction] = typed.split('.');
  const info = currencyInfo(currency);
  const grouped = new Intl.NumberFormat(info.locale, { maximumFractionDigits: 0 }).format(Number(whole || '0'));
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** '1,250.50' / '₹ 1250.5' / 1250.5 → 125050. Returns NaN when there is no number. */
export function parseAmount(value) {
  if (typeof value === 'number') return Math.round(value * 100);
  if (value == null) return NaN;
  let text = String(value).trim();
  if (!text) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  if (/^[-−–]/.test(text) || /[-−–]$/.test(text)) negative = true;
  if (/\bdr\.?$/i.test(text)) negative = true;
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned || !/[0-9]/.test(cleaned)) return NaN;
  const minor = Math.round(parseFloat(cleaned) * 100);
  if (!isFinite(minor)) return NaN;
  return negative ? -minor : minor;
}

/** Keypad typing rules: max 2 decimals, max 10 whole digits, no leading zeros. */
export function typeKey(current, key) {
  if (key === 'back') return current.slice(0, -1);
  if (key === '.') {
    if (current.includes('.')) return current;
    return (current || '0') + '.';
  }
  if (!/^\d+$/.test(key)) return current;
  let next = current === '0' ? key : current + key;
  if (next.startsWith('00')) next = '0';
  const [whole, fraction] = next.split('.');
  if (fraction !== undefined && fraction.length > 2) return current;
  if (whole.length > 10) return current;
  return next;
}

export function typedToMinor(typed) {
  if (!typed || typed === '.') return 0;
  return Math.round(parseFloat(typed) * 100) || 0;
}

export function minorToTyped(minor) {
  if (!minor) return '';
  const value = Math.abs(minor) / 100;
  return minor % 100 === 0 ? String(value) : value.toFixed(2).replace(/0$/, '');
}

// ---------- Aggregation

export function inRange(transactions, start, end) {
  return transactions.filter(t => t.date >= start && t.date <= end);
}

export function totals(transactions) {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, net: income - expense };
}

/** [{ categoryId, total, count }] biggest first. */
export function byCategory(transactions, type = 'expense') {
  const map = new Map();
  for (const t of transactions) {
    if (t.type !== type) continue;
    const row = map.get(t.categoryId) || { categoryId: t.categoryId, total: 0, count: 0 };
    row.total += t.amount;
    row.count += 1;
    map.set(t.categoryId, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** One bucket per day (week/month) or per month (year), with the expense total in each. */
export function seriesFor(kind, range, transactions, type = 'expense') {
  if (kind === 'year') {
    const year = Number(range.start.slice(0, 4));
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      key: `${year}-${pad(i + 1)}`,
      label: new Date(year, i, 1).toLocaleDateString('en-IN', { month: 'narrow' }),
      longLabel: new Date(year, i, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      total: 0,
    }));
    for (const t of transactions) {
      if (t.type !== type || t.date < range.start || t.date > range.end) continue;
      buckets[Number(t.date.slice(5, 7)) - 1].total += t.amount;
    }
    return buckets;
  }
  const count = daysBetween(range.start, range.end) + 1;
  const buckets = [];
  const index = new Map();
  for (let i = 0; i < count; i++) {
    const iso = addDays(range.start, i);
    const d = parseISO(iso);
    index.set(iso, buckets.length);
    buckets.push({
      key: iso,
      label: kind === 'week' ? d.toLocaleDateString('en-IN', { weekday: 'narrow' }) : String(d.getDate()),
      longLabel: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      total: 0,
    });
  }
  for (const t of transactions) {
    if (t.type !== type) continue;
    const i = index.get(t.date);
    if (i !== undefined) buckets[i].total += t.amount;
  }
  return buckets;
}

export function accountBalances(accounts, transactions) {
  const balances = new Map(accounts.map(a => [a.id, a.openingBalance || 0]));
  for (const t of transactions) {
    if (!balances.has(t.accountId)) continue;
    balances.set(t.accountId, balances.get(t.accountId) + (t.type === 'income' ? t.amount : -t.amount));
  }
  return balances;
}

/** Percent change from previous to current, or null when there is nothing to compare with. */
export function percentChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Newest first: by date, then by the time it was entered. */
export function sortTransactions(transactions) {
  return [...transactions].sort((a, b) => (b.date === a.date ? (b.createdAt || 0) - (a.createdAt || 0) : b.date < a.date ? -1 : 1));
}

/** [{ date, items, net }] for a list already sorted newest first. */
export function groupByDay(sorted) {
  const groups = [];
  let current = null;
  for (const t of sorted) {
    if (!current || current.date !== t.date) {
      current = { date: t.date, items: [], net: 0 };
      groups.push(current);
    }
    current.items.push(t);
    current.net += t.type === 'income' ? t.amount : -t.amount;
  }
  return groups;
}

/** Previous notes that start with (then contain) the typed text, most used first. */
export function noteSuggestions(transactions, typed, type, limit = 3) {
  const query = typed.trim().toLowerCase();
  if (query.length < 2) return [];
  const seen = new Map();
  for (const t of sortTransactions(transactions)) {
    const note = (t.note || '').trim();
    if (!note || t.type !== type) continue;
    const key = note.toLowerCase();
    if (key === query || !key.includes(query)) continue;
    const entry = seen.get(key) || { note, count: 0, last: t, starts: key.startsWith(query) };
    entry.count += 1;
    seen.set(key, entry);
  }
  return [...seen.values()]
    .sort((a, b) => (b.starts - a.starts) || (b.count - a.count))
    .slice(0, limit)
    .map(e => ({ note: e.note, categoryId: e.last.categoryId, accountId: e.last.accountId }));
}

// ---------- Repeating transactions

/** Next date after iso for a repeat rule. Monthly/yearly keep the original day (31st → 30th/28th → 31st). */
export function nextOccurrence(iso, frequency, anchorDay) {
  if (frequency === 'weekly') return addDays(iso, 7);
  const d = parseISO(iso);
  const months = frequency === 'yearly' ? 12 : 1;
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const day = Math.min(anchorDay || d.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
  target.setDate(day);
  return toISO(target);
}

/**
 * Creates every transaction that has come due (nextDate <= today) and moves each rule forward.
 * Returns the new transactions; mutates rules' nextDate.
 */
export function runRecurring(rules, today = todayISO(), now = Date.now()) {
  const created = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    let guard = 0;
    while (rule.nextDate <= today && guard < 1000) {
      created.push({
        id: uid(),
        type: rule.type,
        amount: rule.amount,
        categoryId: rule.categoryId,
        accountId: rule.accountId,
        note: rule.note || '',
        date: rule.nextDate,
        recurringId: rule.id,
        createdAt: now + created.length,
      });
      rule.nextDate = nextOccurrence(rule.nextDate, rule.frequency, rule.anchorDay);
      guard++;
    }
  }
  return created;
}

export const FREQUENCY_LABELS = { never: 'Never', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

// ---------- CSV

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCSV(rows) {
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

/** Parses CSV/TSV/semicolon files with quotes and line breaks inside quotes. */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best, ',');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export function exportCSV(state) {
  const cats = new Map(state.categories.map(c => [c.id, c.name]));
  const accounts = new Map(state.accounts.map(a => [a.id, a.name]));
  const rows = [['Date', 'Type', 'Amount', 'Category', 'Account', 'Note']];
  for (const t of sortTransactions(state.transactions)) {
    rows.push([
      t.date,
      t.type === 'income' ? 'Income' : 'Expense',
      (t.amount / 100).toFixed(2),
      cats.get(t.categoryId) || '',
      accounts.get(t.accountId) || '',
      t.note || '',
    ]);
  }
  return '﻿' + toCSV(rows);
}

// ---------- Import (our own CSV, the old Google Sheet, most bank statements)

const HEADER_NAMES = {
  date: ['date', 'txndate', 'transactiondate', 'valuedate', 'day', 'postingdate'],
  amount: ['amount', 'expense', 'expenses', 'debit', 'withdrawal', 'withdrawalamt', 'debitamount', 'spent', 'amt', 'amountinr'],
  income: ['income', 'credit', 'deposit', 'depositamt', 'creditamount', 'received'],
  type: ['type', 'transactiontype', 'kind', 'drcr', 'crdr'],
  category: ['category', 'categories', 'head', 'group'],
  account: ['account', 'bank', 'paidwith', 'mode', 'paymentmode', 'method', 'wallet', 'source'],
  note: ['note', 'notes', 'description', 'particular', 'particulars', 'narration', 'remarks', 'details', 'memo', 'title', 'item'],
};

const normalizeHeader = h => String(h || '').toLowerCase().replace(/[^a-z]/g, '');

function findColumns(row) {
  const cols = {};
  row.forEach((cell, i) => {
    const name = normalizeHeader(cell);
    for (const [field, names] of Object.entries(HEADER_NAMES)) {
      if (cols[field] === undefined && names.includes(name)) cols[field] = i;
    }
  });
  return cols;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function validDate(y, m, d) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m - 1) || y < 1990 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Reads one date cell. order: 'dmy' or 'mdy' for ambiguous numeric dates like 04/05/2026. */
export function parseFlexibleDate(value, order = 'dmy') {
  const text = String(value || '').trim();
  if (!text) return null;
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const dayFirst = a > 12 ? true : b > 12 ? false : order === 'dmy';
    return dayFirst ? validDate(+m[3], b, a) : validDate(+m[3], a, b);
  }
  m = text.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s,-]+(\d{2,4})/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (month >= 0) return validDate(+m[3], month + 1, +m[1]);
  }
  m = text.match(/^([A-Za-z]{3,})[\s-]+(\d{1,2}),?[\s-]+(\d{2,4})/);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) return validDate(+m[3], month + 1, +m[2]);
  }
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    // Excel serial day number
    const serial = Math.floor(+text);
    if (serial > 30000 && serial < 80000) {
      const d = new Date(1899, 11, 30 + serial);
      return toISO(d);
    }
  }
  return null;
}

/** Looks at all numeric dates to decide day-first vs month-first. */
export function detectDateOrder(values) {
  let dmy = 0;
  let mdy = 0;
  let ambiguous = 0;
  for (const value of values) {
    const m = String(value || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) continue;
    const a = +m[1];
    const b = +m[2];
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
    else if (a !== b) ambiguous++;
  }
  const order = mdy > dmy ? 'mdy' : 'dmy';
  return { order, guessed: dmy === 0 && mdy === 0 && ambiguous > 0 };
}

function typeFromText(text) {
  const t = normalizeHeader(text);
  if (['income', 'credit', 'cr', 'in', 'deposit', 'received'].includes(t)) return 'income';
  if (['expense', 'debit', 'dr', 'out', 'withdrawal', 'spent', 'payment'].includes(t)) return 'expense';
  return null;
}

/**
 * Turns CSV rows into transactions-to-be: { date, type, amount, categoryName, accountName, note }.
 * Returns { items, skipped, order, orderGuessed } or { error } when no usable columns are found.
 */
export function readImportRows(rows, forcedOrder) {
  let headerIndex = -1;
  let cols = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const found = findColumns(rows[i]);
    if (found.date !== undefined && (found.amount !== undefined || found.income !== undefined)) {
      headerIndex = i;
      cols = found;
      break;
    }
  }
  if (!cols) {
    return { error: "Couldn't find Date and Amount columns. The first row of the file should have headings like Date, Amount, Category, Note." };
  }

  const body = rows.slice(headerIndex + 1);
  const detected = detectDateOrder(body.map(r => r[cols.date]));
  const order = forcedOrder || detected.order;
  const cell = (r, field) => (cols[field] === undefined ? '' : String(r[cols[field]] ?? '').trim());

  // A single signed amount column (bank statements): negatives are spending, positives income
  const signed = cols.income === undefined && cols.type === undefined &&
    body.some(r => parseAmount(cell(r, 'amount')) < 0);

  const items = [];
  let skipped = 0;
  for (const r of body) {
    const date = parseFlexibleDate(cell(r, 'date'), order);
    const spent = parseAmount(cell(r, 'amount'));
    const earned = parseAmount(cell(r, 'income'));
    let type;
    let amount;
    if (!isNaN(earned) && earned !== 0 && (isNaN(spent) || spent === 0)) {
      type = 'income';
      amount = Math.abs(earned);
    } else if (!isNaN(spent) && spent !== 0) {
      const typed = typeFromText(cell(r, 'type'));
      type = typed || (signed && spent > 0 ? 'income' : 'expense');
      amount = Math.abs(spent);
    }
    if (!date || !amount) {
      skipped++;
      continue;
    }
    items.push({
      date,
      type,
      amount,
      categoryName: cell(r, 'category'),
      accountName: cell(r, 'account'),
      note: cell(r, 'note'),
    });
  }
  return { items, skipped, order, orderGuessed: detected.guessed && !forcedOrder };
}

export function duplicateKey(t) {
  return `${t.date}|${t.type}|${t.amount}|${(t.note || '').trim().toLowerCase()}`;
}
