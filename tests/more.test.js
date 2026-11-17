// Safe to spend, questions, bill scanning, splitting, goals, EMIs, warranties, calendar, sync merge, QR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../app/src/main/assets/www/js/logic.js';
import { qrMatrix, upiLink, isUpiId } from '../app/src/main/assets/www/js/qr.js';

const tx = over => ({ id: Math.random().toString(36).slice(2), type: 'expense', amount: 10000, categoryId: 'food', accountId: 'upi', date: '2026-11-10', note: '', createdAt: 1, ...over });

test('safe to spend today', () => {
  const today = '2026-11-17'; // 14 days left including today
  const state = {
    transactions: [tx({ amount: 1000000, date: '2026-11-05' }), tx({ type: 'income', amount: 9000000 })],
    budgets: { monthly: 3000000 },
    bills: [
      { name: 'Airtel', amount: 49900, dueDate: '2026-11-20', paid: false },
      { name: 'HDFC card ••1234', amount: 900000, dueDate: '2026-11-25', paid: false },
      { name: 'Old', amount: 50000, dueDate: '2026-11-02', paid: false },
    ],
    recurring: [{ active: true, type: 'expense', amount: 64900, nextDate: '2026-11-22', frequency: 'monthly', anchorDay: 22 }],
  };
  const s = L.safeToSpend(state, today);
  assert.equal(s.left, 3000000 - 1000000 - 49900 - 64900);
  assert.equal(s.daysLeft, 14);
  assert.equal(s.perDay, 134000); // ₹1,340 (rounded down to ₹10)
  assert.equal(L.safeToSpend({ ...state, budgets: {} }, today), null);
  assert.equal(L.safeToSpend({ ...state, transactions: [tx({ amount: 4000000, date: '2026-11-05' })] }, today).perDay, 0);
});

test('questions in search', () => {
  const today = '2026-11-17';
  let q = L.parseQuery('swiggy this month', today);
  assert.deepEqual([q.text, q.period.start, q.period.end, q.kind], ['swiggy', '2026-11-01', '2026-11-30', null]);
  q = L.parseQuery('How much did I spend on petrol in the last 3 months?', today);
  assert.deepEqual([q.text, q.period.start, q.period.end, q.kind], ['petrol', '2026-09-01', '2026-11-17', 'expense']);
  q = L.parseQuery('food in october', today);
  assert.deepEqual([q.text, q.period.start, q.period.end], ['food', '2026-10-01', '2026-10-31']);
  q = L.parseQuery('salary received in december', today);
  assert.deepEqual([q.text, q.period.start, q.kind], ['salary', '2025-12-01', 'income']);
  q = L.parseQuery('rent last year', today);
  assert.deepEqual([q.text, q.period.start, q.period.end], ['rent', '2025-01-01', '2025-12-31']);
  q = L.parseQuery('zomato', today);
  assert.deepEqual([q.text, q.period], ['zomato', null]);
});

test('reading a scanned shop bill', () => {
  const bill = [
    'SHREE SAGAR RESTAURANT', 'Shop 12, MG Road, Pune', 'GSTIN 27ABCDE1234F1Z5', 'TAX INVOICE', 'Date: 15/11/2026  Time: 20:14',
    'Paneer Tikka 1 x 280.00   280.00', 'Butter Naan  4 x 50.00    200.00', 'Sub Total 480.00', 'CGST 2.5% 12.00', 'SGST 2.5% 12.00',
    'Round off 0.00', 'Grand Total  ₹ 504.00', 'Thank you! Visit again',
  ].join('\n');
  assert.deepEqual(L.parseReceipt(bill, '2026-11-17'), { amount: 50400, merchant: 'Shree Sagar Restaurant', date: '2026-11-15' });
  const mart = ['DMart', 'Avenue Supermarts Ltd', 'Items: 12  Qty: 15', 'Total Savings 120.00', 'NET AMOUNT', '1,249.50', 'Paid by UPI 1,249.50'].join('\n');
  assert.equal(L.parseReceipt(mart, '2026-11-17').amount, 124950);
  assert.equal(L.parseReceipt('Chai stall\nTea 20.00\nSamosa 15.00', '2026-11-17').amount, 2000);
  assert.deepEqual(L.parseReceipt('', '2026-11-17'), { amount: 0, merchant: '', date: '' });
});

test('splitting adds up to the paisa', () => {
  assert.deepEqual(L.splitAmount(240000, 4), [60000, 60000, 60000, 60000]);
  assert.deepEqual(L.splitAmount(100000, 3), [33334, 33333, 33333]);
  assert.equal(L.splitAmount(99999, 7).reduce((a, b) => a + b, 0), 99999);
});

test('goals, EMIs and warranties', () => {
  const g = L.goalProgress({ target: 3000000, byDate: '2027-03-15', added: [{ amount: 600000 }, { amount: 400000 }] }, '2026-11-17');
  assert.deepEqual([g.saved, g.left, g.monthsLeft, g.perMonth, g.done], [1000000, 2000000, 4, 500000, false]);
  const rule = { id: 'r1', nextDate: '2026-12-05' };
  const e = L.emiStatus({ months: 12, amount: 500000 }, rule, [tx({ recurringId: 'r1' }), tx({ recurringId: 'r1' }), tx({ recurringId: 'x' })]);
  assert.deepEqual([e.paid, e.left, e.leftAmount, e.nextDate, e.done], [2, 10, 5000000, '2026-12-05', false]);
  const w = L.warranties([tx({ warranty: '2027-01-01', note: 'Fridge' }), tx({ warranty: '2026-12-01', note: 'Phone' }), tx({})], '2026-11-17');
  assert.deepEqual(w.map(x => [x.tx.note, x.daysLeft]), [['Phone', 14], ['Fridge', 45]]);
  // An EMI stops after its last month
  const emiRule = { id: 'e', active: true, type: 'expense', amount: 500000, nextDate: '2026-10-05', frequency: 'monthly', anchorDay: 5, endDate: '2026-11-05' };
  const made = L.runRecurring([emiRule], '2027-02-01');
  assert.deepEqual(made.map(t => t.date), ['2026-10-05', '2026-11-05']);
  assert.equal(emiRule.active, false);
});

test('month calendar', () => {
  const weeks = L.monthCalendar('2026-11-01', [tx({ date: '2026-11-03', amount: 5000 }), tx({ date: '2026-11-03', amount: 2500 }), tx({ date: '2026-10-31' })]);
  assert.equal(weeks[0][0].date, '2026-10-26'); // Monday
  assert.equal(weeks[weeks.length - 1][6].date, '2026-12-06');
  assert.ok(weeks.every(w => w.length === 7));
  const nov3 = weeks.flat().find(d => d.date === '2026-11-03');
  assert.deepEqual([nov3.spent, nov3.count, nov3.inMonth], [7500, 2, true]);
  assert.equal(weeks.flat().find(d => d.date === '2026-10-31').count, 0); // outside the month: not counted
});

test('merging phone and computer copies', () => {
  const base = { settings: { lock: true, currency: 'INR' }, sms: { enabled: true, pending: [], payees: {} }, categories: [], accounts: [] };
  const phone = { ...base, savedAt: 200, transactions: [
    { id: 'a', amount: 100, createdAt: 10 },
    { id: 'b', amount: 200, createdAt: 10, updatedAt: 150 },
  ], deleted: { c: 120 } };
  const computer = { ...base, settings: { lock: false, currency: 'USD' }, sms: { enabled: false, pending: [], payees: { swiggy: { categoryId: 'food' } } }, savedAt: 300, transactions: [
    { id: 'b', amount: 999, createdAt: 10, updatedAt: 100 },
    { id: 'c', amount: 300, createdAt: 10 },
    { id: 'd', amount: 400, createdAt: 250 },
  ], deleted: {} };
  const merged = L.mergeStates(phone, computer);
  assert.deepEqual(merged.transactions.map(t => [t.id, t.amount]).sort(), [['a', 100], ['b', 200], ['d', 400]]);
  assert.equal(merged.settings.currency, 'USD'); // saved later on the computer
  assert.equal(merged.settings.lock, true); // this phone's own lock
  assert.equal(merged.sms.enabled, true);
  assert.deepEqual(merged.sms.payees, { swiggy: { categoryId: 'food' } });
  assert.equal(merged.savedAt, 300);
});

test('UPI QR codes', () => {
  const link = upiLink({ vpa: 'jinesh@okicici', name: 'Jinesh V', amount: 60000, note: 'Dinner' });
  assert.equal(link, 'upi://pay?pa=jinesh%40okicici&pn=Jinesh%20V&am=600.00&cu=INR&tn=Dinner');
  const m = qrMatrix(link);
  assert.equal(m.length, 37); // version 5
  // The three corner squares are where readers expect them
  for (const [x, y] of [[0, 0], [30, 0], [0, 30]]) {
    assert.equal(m[y][x], true);
    assert.equal(m[y + 1][x + 1], false);
    assert.equal(m[y + 3][x + 3], true);
  }
  assert.equal(isUpiId('jinesh.vasa@okicici'), true);
  assert.equal(isUpiId('9876543210@ybl'), true);
  assert.equal(isUpiId('not an id'), false);
});
