// GST on bills, investments and net worth, tax summary, streaks, quick adds, evening note, family invites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../app/src/main/assets/www/js/logic.js';
import * as S from '../app/src/main/assets/www/js/sms.js';

globalThis.window = globalThis.window || {};
const { createDefaultState } = await import('../app/src/main/assets/www/js/store.js');

const tx = over => ({ id: Math.random().toString(36).slice(2), type: 'expense', amount: 10000, categoryId: 'food', accountId: 'upi', date: '2026-11-10', note: '', createdAt: 1, ...over });

test('GST on a scanned bill', () => {
  const bill = 'ABC TRADERS\nGSTIN: 27ABCDE1234F1Z5\nBearing 6205 2 x 450.00 900.00\nSub Total 900.00\nCGST @9% 81.00\nSGST @9% 81.00\nGrand Total 1,062.00';
  assert.deepEqual(L.receiptGst(bill), { gst: 16200, gstin: '27ABCDE1234F1Z5' });
  assert.deepEqual(L.receiptGst('IGST 18% 1,800.00\nTotal 11,800.00'), { gst: 180000, gstin: '' });
  assert.deepEqual(L.receiptGst('Tea 20.00\nTotal 20.00'), { gst: 0, gstin: '' });
  assert.equal(L.receiptGst('Prices incl. GST 18.00').gst, 0);
});

test('SIPs, FDs and PPF from bank messages are savings, not spending', () => {
  const D = new Date(2026, 10, 12, 10, 20).getTime();
  const sip = S.parseBankSms({ id: '1', address: 'AX-HDFCBK', body: 'Rs 5000.00 debited from a/c XX1234 on 12-11-26 towards SIP ICICI Prudential Mutual Fund. Avl Bal Rs 20,000', date: D });
  assert.equal(sip.transfer, 'invest');
  const state = createDefaultState();
  const t = S.toTransaction(sip, state);
  assert.deepEqual([t.type, t.accountId, t.toAccountId], ['transfer', 'bank', 'invest']);
  const zerodha = S.parseBankSms({ id: '2', address: 'AX-HDFCBK', body: 'Sent Rs.10000.00 From HDFC Bank A/C *1234 To ZERODHA BROKING On 12/11/26 Ref 431234567890', date: D });
  assert.equal(zerodha.transfer, 'invest');
  const food = S.parseBankSms({ id: '3', address: 'AX-HDFCBK', body: 'Sent Rs.450.00 From HDFC Bank A/C *1234 To SWIGGY On 12/11/26 Ref 431234567891', date: D });
  assert.equal(food.transfer, '');
});

test('net worth', () => {
  const accounts = [
    { id: 'bank', name: 'Bank', openingBalance: 10000000 },
    { id: 'card', name: 'Credit Card', openingBalance: 0 },
    { id: 'invest', name: 'Investments', openingBalance: 0, kind: 'investment' },
    { id: 'gold', name: 'Gold', openingBalance: 0, kind: 'investment', value: 2000000 },
  ];
  const transactions = [
    tx({ amount: 300000, accountId: 'card' }),
    tx({ type: 'transfer', amount: 500000, accountId: 'bank', toAccountId: 'invest' }),
    tx({ type: 'loan', direction: 'out', amount: 100000, accountId: 'bank', person: 'Rahul' }),
  ];
  const w = L.netWorth({ accounts, transactions, emis: [], recurring: [] });
  assert.deepEqual(w, { total: 9400000 + 500000 + 2000000 + 100000 - 300000, cash: 9400000, invested: 2500000, owedToYou: 100000, cardDues: 300000, youOwe: 0, emiLeft: 0 });
});

test('tax-saving summary for the financial year', () => {
  assert.deepEqual(L.taxYear('2026-02-10'), { start: '2025-04-01', end: '2026-03-31', label: 'FY 2025–26' });
  assert.equal(L.taxYear('2026-11-17').start, '2026-04-01');
  const list = [
    tx({ note: 'LIC premium', amount: 2500000, date: '2026-06-01', categoryId: 'bills' }),
    tx({ type: 'transfer', note: 'PPF', amount: 15000000, date: '2026-07-01' }),
    tx({ note: 'Star Health renewal', amount: 1800000, date: '2026-08-01', categoryId: 'health' }),
    tx({ note: 'House rent', amount: 2000000, date: '2026-09-01', categoryId: 'rent' }),
    tx({ note: 'LIC premium', amount: 999, date: '2026-03-01' }), // last financial year
    tx({ note: 'Lunch', amount: 5000, date: '2026-09-02', tax: '80C' }), // chosen by hand
    tx({ note: 'LIC', amount: 100, date: '2026-09-03', tax: 'none' }), // taken out by hand
  ];
  const sum = L.taxSummary(list, id => ({ rent: 'Rent & Home' }[id] || ''), '2026-11-17');
  const by = Object.fromEntries(sum.map(s => [s.key, s.total]));
  assert.equal(by['80C'], 2500000 + 15000000 + 5000);
  assert.equal(by['80D'], 1800000);
  assert.equal(by.HRA, 2000000);
  assert.equal(sum.find(s => s.key === '80C').left, 0);
});

test('no-spend streaks', () => {
  const ch = { categoryId: 'food', startDate: '2026-11-01' };
  const list = [tx({ date: '2026-11-03' }), tx({ date: '2026-11-10' }), tx({ date: '2026-11-12', categoryId: 'fuel' })];
  assert.deepEqual(L.streak(ch, list, '2026-11-17'), { current: 7, best: 7, spentToday: false });
  assert.deepEqual(L.streak({ categoryId: null, startDate: '2026-11-01' }, list, '2026-11-17'), { current: 5, best: 6, spentToday: false });
  assert.equal(L.streak(ch, [tx({ date: '2026-11-17' })], '2026-11-17').current, 0);
});

test('quick add ideas from what you add often', () => {
  const list = [];
  for (let i = 0; i < 5; i++) list.push(tx({ note: 'Chai', amount: 2000, date: `2026-11-1${i}` }));
  for (let i = 0; i < 3; i++) list.push(tx({ note: 'Auto', amount: 6000, date: `2026-11-0${i + 1}` }));
  list.push(tx({ note: 'Auto', amount: 9000 }), tx({ note: 'Lunch', amount: 20000 }));
  assert.deepEqual(L.frequentSpends(list, '2026-11-17').map(g => [g.note, g.amount, g.count]), [['Chai', 2000, 5], ['Auto', 6000, 3]]);
});

test('evening summary words', () => {
  const money = v => `₹${v / 100}`;
  const state = { transactions: [tx({ date: '2026-11-17', amount: 85000 })], budgets: { monthly: 3000000 }, bills: [], recurring: [] };
  const e = L.eveningSummary(state, money, '2026-11-17');
  assert.equal(e.title, 'Today: ₹850 spent');
  assert.match(e.text, /under your safe amount/);
  assert.equal(L.eveningSummary({ ...state, transactions: [] }, money, '2026-11-17').title, 'No spending recorded today');
});

test('family invite codes', () => {
  const invite = L.makeInvite({ url: 'https://script.google.com/macros/s/AKfy_123-x/exec', key: 'abc23', from: 'Jinesh ✓' });
  assert.match(invite, /^EXPENSES-FAMILY-[A-Za-z0-9_-]+$/);
  assert.deepEqual(L.readInvite(`Join my Expenses! Code: ${invite} — paste it in the app`), { url: 'https://script.google.com/macros/s/AKfy_123-x/exec', key: 'abc23', from: 'Jinesh ✓' });
  assert.equal(L.readInvite('EXPENSES-FAMILY-bm90IGpzb24'), null);
  assert.equal(L.readInvite(L.makeInvite({ url: 'https://evil.example/x', key: 'k' })), null);
});
