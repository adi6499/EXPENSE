import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../app/src/main/assets/www/js/logic.js';

test('money formats with Indian grouping and drops .00', () => {
  assert.equal(L.formatMoney(125050, 'INR'), '₹1,250.50');
  assert.equal(L.formatMoney(12345600, 'INR'), '₹1,23,456');
  assert.equal(L.formatMoney(-5000, 'INR'), '−₹50');
  assert.equal(L.formatMoney(5000, 'INR', { sign: true }), '+₹50');
  assert.equal(L.formatMoney(0, 'INR'), '₹0');
  assert.equal(L.formatMoney(199, 'USD'), '$1.99');
});

test('keypad typing rules', () => {
  let t = '';
  for (const k of ['0', '0', '5']) t = L.typeKey(t, k);
  assert.equal(t, '5');
  for (const k of ['.', '2', '5', '9']) t = L.typeKey(t, k);
  assert.equal(t, '5.25');
  assert.equal(L.typeKey('5.25', '.'), '5.25');
  assert.equal(L.typeKey('', '.'), '0.');
  assert.equal(L.typeKey('12', 'back'), '1');
  assert.equal(L.typeKey('9999999999', '1'), '9999999999');
  assert.equal(L.typeKey('', '00'), '0');
  assert.equal(L.typeKey('12', '00'), '1200');
  assert.equal(L.typedToMinor('5.25'), 525);
  assert.equal(L.typedToMinor('0.1'), 10);
  assert.equal(L.minorToTyped(125050), '1250.5');
  assert.equal(L.minorToTyped(125005), '1250.05');
  assert.equal(L.minorToTyped(125000), '1250');
  assert.equal(L.formatTyped('1250.5', 'INR'), '1,250.5');
  assert.equal(L.formatTyped('100000.', 'INR'), '1,00,000.');
});

test('amount parsing from spreadsheets', () => {
  assert.equal(L.parseAmount('₹1,250.50'), 125050);
  assert.equal(L.parseAmount('(500)'), -50000);
  assert.equal(L.parseAmount('-75.5'), -7550);
  assert.equal(L.parseAmount('1,200 Dr'), -120000);
  assert.ok(Number.isNaN(L.parseAmount('')));
  assert.ok(Number.isNaN(L.parseAmount('abc')));
  assert.equal(L.parseAmount(12.5), 1250);
});

test('dates', () => {
  assert.equal(L.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(L.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(L.startOfWeek('2026-10-24'), '2026-10-19'); // Saturday → Monday
  assert.equal(L.endOfMonth('2028-02-10'), '2028-02-29');
  assert.equal(L.dayLabel('2026-10-24', '2026-10-24'), 'Today');
  assert.equal(L.dayLabel('2026-10-23', '2026-10-24'), 'Yesterday');
  assert.deepEqual(L.periodRange('week', 0, '2026-10-24'), { start: '2026-10-19', end: '2026-10-25' });
  assert.deepEqual(L.periodRange('month', -1, '2026-03-31'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(L.periodRange('year', 0, '2026-10-24'), { start: '2026-01-01', end: '2026-12-31' });
});

test('repeating keeps the day of month and catches up', () => {
  assert.equal(L.nextOccurrence('2026-01-31', 'monthly', 31), '2026-02-28');
  assert.equal(L.nextOccurrence('2026-02-28', 'monthly', 31), '2026-03-31');
  assert.equal(L.nextOccurrence('2024-02-29', 'yearly', 29), '2025-02-28');
  assert.equal(L.nextOccurrence('2026-10-24', 'weekly'), '2026-10-31');
  const rules = [{ id: 'r', active: true, type: 'expense', amount: 1500000, categoryId: 'rent', accountId: 'bank', note: 'Rent', frequency: 'monthly', anchorDay: 5, nextDate: '2026-08-05' }];
  const created = L.runRecurring(rules, '2026-10-24');
  assert.deepEqual(created.map(t => t.date), ['2026-08-05', '2026-09-05', '2026-10-05']);
  assert.equal(rules[0].nextDate, '2026-11-05');
  assert.equal(L.runRecurring(rules, '2026-10-24').length, 0);
  assert.equal(created[0].recurringId, 'r');
});

test('totals, categories and series', () => {
  const tx = [
    { type: 'expense', amount: 1000, categoryId: 'food', date: '2026-10-01' },
    { type: 'expense', amount: 3000, categoryId: 'rent', date: '2026-10-02' },
    { type: 'expense', amount: 500, categoryId: 'food', date: '2026-10-02' },
    { type: 'income', amount: 10000, categoryId: 'salary', date: '2026-10-01' },
  ];
  assert.deepEqual(L.totals(tx), { income: 10000, expense: 4500, net: 5500 });
  assert.deepEqual(L.byCategory(tx).map(r => [r.categoryId, r.total]), [['rent', 3000], ['food', 1500]]);
  const month = L.seriesFor('month', { start: '2026-10-01', end: '2026-10-31' }, tx);
  assert.equal(month.length, 31);
  assert.equal(month[1].total, 3500);
  const year = L.seriesFor('year', { start: '2026-01-01', end: '2026-12-31' }, tx);
  assert.equal(year[9].total, 4500);
  assert.equal(L.percentChange(150, 100), 50);
  assert.equal(L.percentChange(100, 0), null);
});

test('CSV round trip with quotes, commas and new lines', () => {
  const rows = [['Date', 'Note'], ['2026-10-01', 'Tea, "special"\nwith friends']];
  assert.deepEqual(L.parseCSV(L.toCSV(rows)), rows);
  assert.deepEqual(L.parseCSV('﻿a;b\r\n1;2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('import: old Google Sheet columns', () => {
  const csv = 'DATE ,PARTICULAR,AMOUNT,INCOME,BANK ,CATEGORY,ID\n' +
    '15/04/2026,Swiggy,350,,JUPITER,Dining,a1\n' +
    '01/04/2026,Salary,,50000,HDFC,Salary,a2\n' +
    ',,,,,,\n' +
    '02/04/2026,Broken row,,,HDFC,Other,a3\n';
  const result = L.readImportRows(L.parseCSV(csv));
  assert.equal(result.order, 'dmy');
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.items, [
    { date: '2026-04-15', type: 'expense', amount: 35000, categoryName: 'Dining', accountName: 'JUPITER', note: 'Swiggy' },
    { date: '2026-04-01', type: 'income', amount: 5000000, categoryName: 'Salary', accountName: 'HDFC', note: 'Salary' },
  ]);
});

test('import: our own export and month-first dates', () => {
  const ours = 'Date,Type,Amount,Category,Account,Note\n2026-10-01,Income,100.00,Salary,Bank,Oct\n2026-10-02,Expense,20.50,Food & Dining,UPI,"Tea, snacks"';
  const a = L.readImportRows(L.parseCSV(ours));
  assert.equal(a.items[0].type, 'income');
  assert.equal(a.items[1].amount, 2050);
  assert.equal(a.items[1].note, 'Tea, snacks');
  const us = 'Date,Description,Amount\n04/25/2026,Coffee,4.50\n05/01/2026,Book,12';
  const b = L.readImportRows(L.parseCSV(us));
  assert.equal(b.order, 'mdy');
  assert.equal(b.items[1].date, '2026-05-01');
  const guess = L.readImportRows(L.parseCSV('Date,Amount\n04/05/2026,10'));
  assert.equal(guess.orderGuessed, true);
  assert.equal(guess.items[0].date, '2026-05-04');
  assert.equal(L.readImportRows(L.parseCSV('Date,Amount\n04/05/2026,10'), 'mdy').items[0].date, '2026-04-05');
});

test('import: bank statement with signed amounts and a preamble', () => {
  const csv = 'Account statement\nName: Test\nTxn Date,Narration,Amount\n1 Oct 2026,UPI/Swiggy,-250.00\n2-Oct-2026,Salary credit,"45,000.00"';
  const r = L.readImportRows(L.parseCSV(csv));
  assert.deepEqual(r.items.map(i => [i.date, i.type, i.amount]), [['2026-10-01', 'expense', 25000], ['2026-10-02', 'income', 4500000]]);
  assert.ok(L.readImportRows(L.parseCSV('Foo,Bar\n1,2')).error);
});

test('note suggestions prefer prefix matches and remember category', () => {
  const tx = [
    { type: 'expense', note: 'Swiggy', categoryId: 'food', accountId: 'upi', date: '2026-10-01', createdAt: 1 },
    { type: 'expense', note: 'Swiggy', categoryId: 'food', accountId: 'upi', date: '2026-10-02', createdAt: 2 },
    { type: 'expense', note: 'Big Swiggy order', categoryId: 'food', accountId: 'card', date: '2026-10-03', createdAt: 3 },
    { type: 'income', note: 'Swiggy refund', categoryId: 'refunds', accountId: 'upi', date: '2026-10-03', createdAt: 4 },
  ];
  const s = L.noteSuggestions(tx, 'swi', 'expense');
  assert.deepEqual(s.map(x => x.note), ['Swiggy', 'Big Swiggy order']);
  assert.equal(s[0].categoryId, 'food');
  assert.deepEqual(L.noteSuggestions(tx, 's', 'expense'), []);
});
