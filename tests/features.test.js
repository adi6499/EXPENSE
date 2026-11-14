// Transfers, loans, trips, regular payments, heads-up alerts, speaking, balances and bills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../app/src/main/assets/www/js/logic.js';
import * as S from '../app/src/main/assets/www/js/sms.js';

globalThis.window = globalThis.window || {};
const { createDefaultState, normalizeState } = await import('../app/src/main/assets/www/js/store.js');

const tx = (over) => ({ id: Math.random().toString(36).slice(2), type: 'expense', amount: 10000, categoryId: 'food', accountId: 'upi', date: '2026-11-10', note: '', createdAt: 1, ...over });

test('transfers and loans are not spending or income', () => {
  const list = [
    tx({ amount: 50000 }),
    tx({ type: 'income', amount: 200000 }),
    tx({ type: 'transfer', amount: 300000, accountId: 'bank', toAccountId: 'cash', categoryId: null }),
    tx({ type: 'loan', amount: 70000, direction: 'out', person: 'Rahul', categoryId: null }),
  ];
  assert.deepEqual(L.totals(list), { income: 200000, expense: 50000, net: 150000 });
  assert.equal(L.groupByDay(L.sortTransactions(list))[0].net, 150000);
});

test('account balances follow transfers and loans', () => {
  const accounts = [{ id: 'bank', openingBalance: 1000000 }, { id: 'cash', openingBalance: 0 }, { id: 'upi', openingBalance: 0 }];
  const b = L.accountBalances(accounts, [
    tx({ type: 'transfer', amount: 200000, accountId: 'bank', toAccountId: 'cash' }),
    tx({ amount: 5000, accountId: 'cash' }),
    tx({ type: 'loan', direction: 'out', amount: 30000, accountId: 'bank', person: 'A' }),
    tx({ type: 'loan', direction: 'in', amount: 10000, accountId: 'upi', person: 'A' }),
  ]);
  assert.equal(b.get('bank'), 1000000 - 200000 - 30000);
  assert.equal(b.get('cash'), 195000);
  assert.equal(b.get('upi'), 10000);
});

test('who owes whom', () => {
  const people = L.personBalances([
    tx({ type: 'loan', direction: 'out', amount: 150000, person: 'Rahul', date: '2026-11-01' }),
    tx({ type: 'loan', direction: 'in', amount: 50000, person: ' rahul ', date: '2026-11-05' }),
    tx({ type: 'loan', direction: 'in', amount: 20000, person: 'Amit' }),
    tx({ type: 'loan', direction: 'out', amount: 1000, person: 'Neha' }),
    tx({ type: 'loan', direction: 'in', amount: 1000, person: 'Neha' }),
  ]);
  assert.deepEqual(people.map(p => [p.key, p.balance]), [['rahul', 100000], ['amit', -20000], ['neha', 0]]);
});

test('trips: totals per tag', () => {
  const tags = L.tagSummaries([
    tx({ tag: 'Goa', amount: 100000, date: '2026-10-01' }),
    tx({ tag: 'goa', amount: 50000, date: '2026-10-03' }),
    tx({ tag: 'Wedding', amount: 900000, date: '2026-11-02' }),
    tx({ amount: 999 }),
  ]);
  assert.equal(tags[0].tag, 'Wedding');
  assert.deepEqual([tags[1].spent, tags[1].start, tags[1].end, tags[1].count], [150000, '2026-10-01', '2026-10-03', 2]);
});

test('regular payments: steady payee, amount and gap; not irregular shopping', () => {
  const list = [
    tx({ note: 'Netflix', amount: 64900, date: '2026-08-12' }),
    tx({ note: 'Netflix', amount: 64900, date: '2026-09-12' }),
    tx({ note: 'Netflix', amount: 64900, date: '2026-10-12' }),
    tx({ note: 'Gym', amount: 150000, date: '2026-10-01' }),
    tx({ note: 'Gym', amount: 150000, date: '2026-10-31' }),
    tx({ note: 'Swiggy', amount: 30000, date: '2026-10-02' }),
    tx({ note: 'Swiggy', amount: 52000, date: '2026-10-09' }),
    tx({ note: 'Swiggy', amount: 41000, date: '2026-10-14' }),
    tx({ note: 'Old plan', amount: 9900, date: '2026-05-01' }),
    tx({ note: 'Old plan', amount: 9900, date: '2026-06-01' }),
  ];
  const subs = L.detectSubscriptions(list, '2026-11-14');
  assert.deepEqual(subs.map(s => [s.name, s.frequency, s.nextDate]), [['Gym', 'monthly', '2026-11-30'], ['Netflix', 'monthly', '2026-11-12']]);
});

test('heads up: category pace, budget pace, big spend', () => {
  const list = [];
  for (let d = 1; d <= 14; d++) list.push(tx({ date: `2026-10-${String(d).padStart(2, '0')}`, amount: 10000 }));
  for (let d = 1; d <= 14; d++) list.push(tx({ date: `2026-11-${String(d).padStart(2, '0')}`, amount: 30000 }));
  list.push(tx({ date: '2026-11-13', amount: 2500000, categoryId: 'shopping', note: 'Phone' }));
  const alerts = L.computeAlerts({ transactions: list, budgets: { monthly: 3000000 }, categoryName: id => id }, v => `₹${v / 100}`, '2026-11-14');
  const keys = alerts.map(a => a.key.split('|')[0]);
  assert.deepEqual(keys, ['pace', 'up', 'big']);
  assert.match(alerts[1].text, /^food is 200% higher/);
});

test('speaking a transaction', () => {
  const today = '2026-11-14';
  assert.deepEqual(L.parseSpoken('spent 450 on petrol yesterday', today), { amount: 45000, type: 'expense', date: '2026-11-13', note: 'Petrol' });
  assert.deepEqual(L.parseSpoken('received 5000 salary', today), { amount: 500000, type: 'income', date: today, note: 'Salary' });
  assert.equal(L.parseSpoken('two hundred fifty for auto', today).amount, 25000);
  assert.equal(L.parseSpoken('1.5k groceries', today).amount, 150000);
  assert.equal(L.parseSpoken('rent', today).amount, 0);
});

test('saved data keeps transfers, loans, tags, photos and bills', () => {
  const state = normalizeState({
    transactions: [
      { id: 'a', type: 'transfer', amount: 100, date: '2026-11-01', accountId: 'bank', toAccountId: 'cash', categoryId: 'food' },
      { id: 'b', type: 'loan', amount: 100, date: '2026-11-01', person: 'Rahul', direction: 'in', tag: 'Goa', photo: true },
      { id: 'c', type: 'weird', amount: 100, date: '2026-11-01' },
    ],
    bills: [{ id: 'x', name: 'Card', amount: 100, dueDate: '2026-11-20' }, { id: 'y', amount: 'no' }],
    settings: { activeTag: 'Goa' },
  });
  assert.deepEqual([state.transactions[0].type, state.transactions[0].toAccountId, state.transactions[0].categoryId], ['transfer', 'cash', null]);
  assert.deepEqual([state.transactions[1].person, state.transactions[1].direction, state.transactions[1].tag, state.transactions[1].photo], ['Rahul', 'in', 'Goa', true]);
  assert.equal(state.transactions[2].type, 'expense');
  assert.equal(state.bills.length, 1);
  assert.equal(state.settings.activeTag, 'Goa');
  assert.deepEqual(createDefaultState().bills, []);
});

const D = new Date(2026, 10, 12, 10, 20).getTime();
const msg = (address, body) => ({ id: '1', address, body, date: D });

test('bank messages: balances and card limits', () => {
  assert.deepEqual(S.parseBalance(msg('AX-HDFCBK', 'Avl Bal in A/c XX1234 is Rs 10,000.00 as on 12-11-26')),
    { key: 'HDFC Bank|1234', bank: 'HDFC Bank', last4: '1234', amount: 1000000, kind: 'balance', time: D });
  assert.equal(S.parseBalance(msg('AX-ICICIT', 'INR 1,234.00 spent using ICICI Bank Card XX1234 on 12-Nov-26 on AMAZON. Avl Limit: INR 50,000.00.')).kind, 'limit');
  assert.equal(S.parseBalance(msg('AX-HDFCBK', '123456 is your OTP. Avl Bal Rs 500')), null);
  assert.equal(S.parseBalance(msg('+919876543210', 'my bal is Rs 500 a/c 1234')), null);
});

test('bank messages: bills due, automatic payments, and payments received', () => {
  const card = S.parseBill(msg('AX-HDFCBK', 'Your HDFC Bank Credit Card XX1234 statement: Total due Rs 12,345, Min due Rs 620, due date 20-Nov'));
  assert.deepEqual([card.name, card.amount, card.minDue, card.dueDate, card.autopay], ['HDFC card ••1234', 1234500, 62000, '2026-11-20', false]);
  const phone = S.parseBill(msg('VM-AIRTEL', 'Your Airtel postpaid bill of Rs 499 is due on 20-Nov-2026.'));
  assert.deepEqual([phone.name, phone.amount, phone.dueDate], ['Airtel', 49900, '2026-11-20']);
  const autopay = S.parseBill(msg('AX-HDFCBK', 'Rs 199 will be debited from your a/c XX1234 on 15-Nov for NETFLIX mandate'));
  assert.deepEqual([autopay.name, autopay.amount, autopay.autopay], ['Netflix', 19900, true]);
  assert.equal(S.parseBill(msg('AX-HDFCBK', 'Rs 500 debited from a/c XX1234 on 12-11-26 to SWIGGY')), null);
  assert.equal(S.messageDate('5 Jan', new Date(2026, 11, 20).getTime()), '2027-01-05');
  const paid = S.parseBillPaid(msg('AX-SBICRD', 'Payment of Rs 5,000.00 received towards your SBI Card ending 1234 on 12-Nov-26.'));
  assert.deepEqual(paid, { key: 'sbi card|1234', bank: 'SBI Card', last4: '1234', amount: 500000 });
});

test('bank messages: ATM cash and card bills become transfers', () => {
  const state = createDefaultState();
  const atm = S.parseBankSms(msg('AD-ATMSBI', 'Rs.2000 withdrawn at SBI ATM S1ANxxx from A/cX5678 on 12Nov26.'));
  assert.equal(atm.transfer, 'cash');
  const t = S.toTransaction(atm, state);
  assert.deepEqual([t.type, t.accountId, t.toAccountId], ['transfer', 'bank', 'cash']);
  const bill = S.parseBankSms(msg('AX-HDFCBK', 'Rs 5000.00 debited from a/c XX1234 on 12-11-26 towards HDFC Credit Card bill payment.'));
  assert.equal(S.toTransaction(bill, state).toAccountId, 'card');
  const spend = S.parseBankSms(msg('AX-SBICRD', 'Rs.500.00 spent on your SBI Credit Card ending 1234 at SWIGGY on 12/11/26.'));
  assert.equal(spend.transfer, '');
  // A running trip tags spending found in messages
  state.settings.activeTag = 'Goa';
  assert.equal(S.toTransaction(spend, state).tag, 'Goa');
});
