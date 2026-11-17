// Bank charges, double charges, refunds, cashback and points, payday, savings tips, documents, the year.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../app/src/main/assets/www/js/logic.js';
import * as S from '../app/src/main/assets/www/js/sms.js';

let n = 0;
const tx = over => ({ id: `t${++n}`, type: 'expense', amount: 10000, categoryId: 'food', accountId: 'upi', date: '2026-11-10', note: '', createdAt: n, ...over });
const D = new Date(2026, 10, 12, 10, 20).getTime();
const money = v => `₹${v / 100}`;

test('bank charges are found in messages and notes', () => {
  const fee = S.parseBankSms({ id: '1', address: 'AX-HDFCBK', body: 'Rs 590.00 debited from a/c XX1234 on 12-11-26 towards Annual Fee for Debit Card incl GST.', date: D });
  assert.equal(fee.fee, true);
  const sms = S.parseBankSms({ id: '2', address: 'VM-SBIINB', body: 'Your A/c XX5678 is debited by Rs.17.70 for SMS Alert Charges on 12Nov26.', date: D });
  assert.equal(sms.fee, true);
  const food = S.parseBankSms({ id: '3', address: 'AX-HDFCBK', body: 'Sent Rs.450.00 From HDFC Bank A/C *1234 To SWIGGY On 12/11/26 Ref 431234567891', date: D });
  assert.ok(!food.fee);
  const list = [tx({ fee: true, amount: 59000, date: '2026-03-01' }), tx({ note: 'Late payment fee', amount: 50000 }), tx({ note: 'Lunch' }), tx({ fee: true, date: '2025-12-31' })];
  assert.equal(L.feesSummary(list, '2026-11-17').total, 109000);
});

test('the same payment twice on one day is flagged', () => {
  const a = tx({ amount: 129900, note: 'Amazon', sms: { id: 'm1', payee: 'amazon', ref: '111' } });
  const b = tx({ amount: 129900, note: 'Amazon', sms: { id: 'm2', payee: 'amazon', ref: '222' } });
  const sameRef = tx({ amount: 50000, note: 'Uber', sms: { id: 'm3', payee: 'uber', ref: '9' } });
  const sameRef2 = tx({ amount: 50000, note: 'Uber', sms: { id: 'm4', payee: 'uber', ref: '9' } });
  const byHand = [tx({ amount: 2000, note: 'Chai' }), tx({ amount: 2000, note: 'Chai' })];
  const found = L.doubleCharges([a, b, sameRef, sameRef2, ...byHand], '2026-11-17');
  assert.equal(found.length, 1);
  assert.equal(found[0].a.id, a.id);
});

test('refunds: waiting, then found when the money comes back', () => {
  const buy = tx({ amount: 249900, note: 'Myntra', date: '2026-11-01', refund: { since: '2026-11-02' }, sms: { id: 'x', payee: 'myntra' } });
  assert.deepEqual(L.refundStatus(buy, [buy], '2026-11-17'), { waiting: 15 });
  const back = tx({ type: 'income', amount: 249900, note: 'Myntra', date: '2026-11-18', sms: { id: 'y', payee: 'myntra' } });
  assert.equal(L.refundStatus(buy, [buy, back], '2026-11-20').done, '2026-11-18');
  const other = tx({ type: 'income', amount: 249900, note: 'Salary', date: '2026-11-18' });
  assert.ok(!L.refundStatus(buy, [buy, other], '2026-11-20').done);
  const alerts = L.watchAlerts({ transactions: [buy], documents: [] }, money, '2026-11-17');
  assert.match(alerts[0].text, /not back after 15 days/);
});

test('cashback and reward points', () => {
  const cb = S.parseBankSms({ id: '5', address: 'AX-ICICIB', body: 'Cashback of Rs 50.00 credited to your ICICI Bank Account XX4321 on 12-Nov-26.', date: D });
  assert.equal(cb.type, 'income');
  assert.equal(cb.cashback, true);
  const pts = S.parsePoints({ address: 'AX-HDFCBK', body: 'You have earned 120 reward points on your HDFC Bank Credit Card XX1234. Total reward points balance is 4,560.', date: D });
  assert.deepEqual([pts.points, pts.earned, pts.last4], [4560, 120, '1234']);
  const sum = L.cashbackSummary([tx({ type: 'income', amount: 5000, cashback: true }), tx({ type: 'income', amount: 9900, note: 'Amazon cashback' })], {}, '2026-11-17');
  assert.equal(sum.total, 14900);
});

test('payday: safe to spend counts to the next salary', () => {
  assert.deepEqual(L.payPeriod(7, '2026-11-17'), { start: '2026-11-07', end: '2026-12-06', next: '2026-12-07', daysToSalary: 20 });
  assert.deepEqual(L.payPeriod(7, '2026-11-03'), { start: '2026-10-07', end: '2026-11-06', next: '2026-11-07', daysToSalary: 4 });
  assert.equal(L.payPeriod(31, '2026-11-17').next, '2026-11-30');
  const state = { transactions: [tx({ date: '2026-11-08', amount: 1000000 }), tx({ date: '2026-11-05', amount: 999900 })], budgets: { monthly: 3000000 }, bills: [], recurring: [], settings: { payday: 7 } };
  const safe = L.safeToSpend(state, '2026-11-17');
  assert.equal(safe.spent, 1000000);
  assert.equal(safe.daysToSalary, 20);
  assert.equal(safe.daysLeft, 20);
});

test('savings tips from your own spending', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push(tx({ note: 'Swiggy', amount: 45000, date: `2026-11-1${i}` }));
  const tips = L.savingsTips({ transactions: list }, { money }, '2026-11-17');
  assert.equal(tips[0].key, 'delivery');
  assert.match(tips[0].title, /₹2700 in 30 days/);
  assert.deepEqual(L.savingsTips({ transactions: [tx({})] }, { money }, '2026-11-17'), []);
});

test('documents running out', () => {
  const docs = [{ id: 'd1', name: 'Car insurance', kind: 'car-insurance', expires: '2026-11-30' }, { id: 'd2', name: 'PUC', kind: 'puc', expires: '2026-11-01' }, { id: 'd3', name: 'Passport', kind: 'passport', expires: '2030-01-01' }];
  const alerts = L.watchAlerts({ transactions: [], documents: docs }, money, '2026-11-17');
  assert.equal(alerts.length, 2);
  assert.match(alerts[0].text, /runs out in 13 days/);
  assert.match(alerts[1].text, /ran out/);
});

test('the year in review', () => {
  const list = [tx({ date: '2026-03-02', amount: 500000, categoryId: 'rent' }), tx({ date: '2026-03-03', amount: 20000 }), tx({ type: 'income', date: '2026-04-01', amount: 9000000, categoryId: 'salary' }), tx({ date: '2025-12-31' })];
  const y = L.yearReview(list, 2026, '2026-11-17');
  assert.equal(y.expense, 520000);
  assert.equal(y.income, 9000000);
  assert.equal(y.biggestMonth.month, 2);
  assert.equal(y.biggest.amount, 500000);
  assert.equal(y.top[0].categoryId, 'rent');
  assert.equal(y.noSpendDays, y.days - 2);
});
