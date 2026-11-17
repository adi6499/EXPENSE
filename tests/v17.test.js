// The monthly plan: income split into amounts per kind of spending, what's left of each, suggestions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../app/src/main/assets/www/js/logic.js';

let n = 0;
const tx = over => ({ id: `p${++n}`, type: 'expense', amount: 10000, categoryId: 'food', accountId: 'upi', date: '2026-11-10', note: '', createdAt: n, ...over });

test('this month against the plan', () => {
  const budgets = { income: 5000000, categories: { rent: 1500000, food: 600000, groceries: 800000, other: 0 } };
  const transactions = [
    tx({ categoryId: 'rent', amount: 1500000, date: '2026-11-01' }),
    tx({ categoryId: 'food', amount: 700000 }),
    tx({ categoryId: 'groceries', amount: 300000 }),
    tx({ categoryId: 'shopping', amount: 200000 }),
    tx({ categoryId: 'food', amount: 999999, date: '2026-10-31' }), // last month
    tx({ type: 'income', categoryId: 'salary', amount: 5000000, date: '2026-11-01' }),
  ];
  const p = L.planStatus({ transactions, budgets }, '2026-11-17');
  assert.equal(p.income, 5000000);
  assert.equal(p.planned, 2900000);
  assert.equal(p.saving, 2100000);
  assert.equal(p.spent, 2700000);
  assert.equal(p.left, 2300000);
  assert.equal(p.unplanned, 200000);
  assert.deepEqual(p.groups.map(g => g.key), ['fixed', 'daily']);
  const food = p.groups[1].rows.find(r => r.categoryId === 'food');
  assert.deepEqual([food.planned, food.spent, food.left], [600000, 700000, -100000]);
  assert.deepEqual(p.groups[1].rows.map(r => r.categoryId), ['groceries', 'food']);
  assert.equal(L.planStatus({ transactions, budgets: {} }, '2026-11-17'), null);
});

test('the plan follows the salary day', () => {
  const budgets = { income: 5000000, categories: { food: 600000 } };
  const transactions = [tx({ amount: 100000, date: '2026-11-05' }), tx({ amount: 200000, date: '2026-11-08' })];
  const p = L.planStatus({ transactions, budgets, settings: { payday: 7 } }, '2026-11-17');
  assert.equal(p.start, '2026-11-07');
  assert.equal(p.groups[0].rows[0].spent, 200000);
});

test('suggested amounts: real spending first, else a usual share of income', () => {
  const history = [];
  for (const m of ['08', '09', '10']) history.push(tx({ categoryId: 'groceries', amount: 900000, date: `2026-${m}-05` }), tx({ categoryId: 'rent', amount: 1500000, date: `2026-${m}-01` }));
  const ideas = L.suggestPlan(history, 5000000, '2026-11-17');
  assert.equal(ideas.groceries, 900000);
  assert.equal(ideas.rent, 1500000);
  assert.equal(ideas.food, undefined); // history exists, nothing spent on it
  const fresh = L.suggestPlan([], 5000000, '2026-11-17');
  assert.equal(fresh.groceries, 600000); // 12% of ₹50,000
  assert.equal(fresh.rent, undefined);   // fixed costs are never guessed
});

const money = v => `₹${v / 100}`;

test('Money Buddy: what you lose and how you spend, most urgent first', () => {
  const state = {
    transactions: [
      tx({ categoryId: 'food', amount: 500000, date: '2026-11-10' }),
      tx({ categoryId: 'bills', amount: 59000, date: '2026-11-12', note: 'Annual fee', fee: true }),
      tx({ categoryId: 'rent', amount: 1800000, date: '2026-11-01' }),
    ],
    budgets: { income: 5000000, categories: { food: 600000, rent: 1500000 } },
    settings: { dismissed: {} }, documents: [], sms: {},
  };
  const list = L.buddyMessages(state, { money, categoryName: id => id }, '2026-11-17');
  const titles = list.map(m => m.title);
  assert.ok(titles.includes('rent: ₹3000 over the plan'));
  assert.ok(titles.includes('You lost ₹590 to bank charges'));
  assert.ok(titles.includes('food is going fast'));
  assert.equal(list[0].tone, 'bad');
  assert.ok(!titles.some(t => /bank charges this year/.test(t))); // not said twice
  // "Got It" hides a message
  state.settings.dismissed[list[0].key] = Date.now();
  assert.notEqual(L.buddyMessages(state, { money, categoryName: id => id }, '2026-11-17')[0].key, list[0].key);
});

test('a word right after adding an expense', () => {
  const budgets = { income: 5000000, categories: { food: 600000 } };
  const first = tx({ categoryId: 'food', amount: 400000, date: '2026-11-10' });
  const second = tx({ categoryId: 'food', amount: 100000, date: '2026-11-17' });
  const state = { transactions: [first, second], budgets };
  assert.match(L.nudgeFor(state, second, { money, categoryName: id => id }, '2026-11-17').text, /^food: 83% used, 14 days left/);
  const over = tx({ categoryId: 'food', amount: 200000, date: '2026-11-17' });
  assert.match(L.nudgeFor({ transactions: [first, second, over], budgets }, over, { money, categoryName: id => id }, '2026-11-17').text, /used up — ₹1000 over/);
  const outside = tx({ categoryId: 'shopping', amount: 50000, date: '2026-11-17' });
  assert.match(L.nudgeFor({ transactions: [outside], budgets }, outside, { money, categoryName: id => id }, '2026-11-17').text, /isn’t in your plan/);
  const small = tx({ categoryId: 'food', amount: 1000, date: '2026-11-02' });
  assert.equal(L.nudgeFor({ transactions: [small], budgets }, small, { money }, '2026-11-17'), null);
});
