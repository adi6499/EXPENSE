import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../app/src/main/assets/www/js/sms.js';

// store.js talks to window.Native when it loads; outside a browser there is no window
globalThis.window = globalThis.window || {};
const { createDefaultState, normalizeState } = await import('../app/src/main/assets/www/js/store.js');

const DAY = new Date(2026, 10, 12, 10, 20).getTime(); // 12 Nov 2026, 10:20

const parse = (address, body, options) => S.parseBankSms({ id: '1', address, body, date: DAY }, options);

// [sender, message, type, amount in paise, payee, last digits]
const MONEY_MESSAGES = [
  ['AX-HDFCBK', 'Sent Rs.500.00\nFrom HDFC Bank A/C *1234\nTo ZOMATO\nOn 12/11/26\nRef 431234567890\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808', 'expense', 50000, 'Zomato', '1234'],
  ['VM-HDFCBK-S', 'Credit Alert!\nRs.500.00 credited to HDFC Bank A/c XX1234 on 12-11-26 from VPA john.doe@okaxis (UPI 431234567890)', 'income', 50000, 'John Doe', '1234'],
  ['JD-HDFCBK', 'Spent Rs.1234 On HDFC Bank Card 1234 At AMAZON On 2026-11-12:10:20:30 Bal Rs.45000 Not You? Call 18002586161/SMS BLOCK DC 1234 to 7308080808', 'expense', 123400, 'Amazon', '1234'],
  ['AD-SBIUPI', 'Dear UPI user A/C X1234 debited by 500.0 on date 12Nov26 trf to JOHN DOE Refno 431234567890. If not u? call 1800111109. -SBI', 'expense', 50000, 'John Doe', '1234'],
  ['BZ-SBIUPI-S', 'Dear SBI UPI User, ur A/cX1234 credited by Rs500 on 12Nov26 by (Ref no 431234567890)', 'income', 50000, '', '1234'],
  ['JM-ICICIT', 'ICICI Bank Acct XX123 debited for Rs 500.00 on 12-Nov-26; ZOMATO credited. UPI:431234567890. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766.', 'expense', 50000, 'Zomato', '123'],
  ['VK-ICICIB', 'Dear Customer, Acct XX123 is credited with Rs 500.00 on 12-Nov-26 from JOHN DOE. UPI:431234567890-ICICI Bank.', 'income', 50000, 'John Doe', '123'],
  ['AX-ICICIT-S', 'INR 1,234.00 spent using ICICI Bank Card XX1234 on 12-Nov-26 on AMAZON. Avl Limit: INR 50,000.00. If not you, call 1800 2662/SMS BLOCK 1234 to 9215676766.', 'expense', 123400, 'Amazon', '1234'],
  ['AX-AXISBK', 'INR 500.00 debited\nA/c no. XX1234\n12-11-26, 10:20:30\nUPI/P2M/431234567890/SWIGGY\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank', 'expense', 50000, 'Swiggy', '1234'],
  ['AX-AXISBK', 'INR 2,500.00 credited\nA/c no. XX1234\n12-11-26, 10:20:30 IST\nUPI/P2A/431234567890/JOHN DOE\n- Axis Bank', 'income', 250000, 'John Doe', '1234'],
  ['VM-KOTAKB', 'Sent Rs.500.00 from Kotak Bank AC X1234 to john.doe@okaxis on 12-11-26.UPI Ref 431234567890. Not you, https://kotak.com/KBANKT/Fraud', 'expense', 50000, 'John Doe', '1234'],
  ['VM-KOTAKB', 'Received Rs.500.00 in your Kotak Bank AC X1234 from john.doe@okaxis on 12-11-26.UPI Ref:431234567890.', 'income', 50000, 'John Doe', '1234'],
  ['AD-SBIINB', 'Your A/C XXXXX1234 has a debit by transfer of Rs 5,000.00 on 12/11/26. Avl Bal Rs 10,000.00.-SBI', 'expense', 500000, '', '1234'],
  ['AD-SBIINB', 'Dear Customer, Your A/c XX1234 has been credited with INR 85,000.00 on 01-Nov-2026 towards SALARY NOV 2026. Avl Bal: INR 1,00,000.00', 'income', 8500000, 'Salary Nov 2026', '1234'],
  ['AD-ATMSBI', 'Dear Customer, Rs.2000 withdrawn at SBI ATM S1ANxxx from A/cX1234 on 12Nov26 Transaction Number 1234. Available Balance Rs.10000. If not withdrawn by you, forward this SMS to 9223008333', 'expense', 200000, 'Cash withdrawal', '1234'],
  ['AX-SBICRD', 'Rs.500.00 spent on your SBI Credit Card ending 1234 at SWIGGY on 12/11/26. Trxn. Ref No. 123456789. Not you? Call 18001801290', 'expense', 50000, 'Swiggy', '1234'],
  ['AX-AMEXIN', "Alert: You've spent INR 500.00 on your AMEX card ** 12345 at AMAZON PAY INDIA PVT LTD on 12 November 2026 at 10:20 AM IST.", 'expense', 50000, 'Amazon Pay', '12345'],
  ['JD-PAYTMB', 'Paid Rs.120 to Chai Point from Paytm Payments Bank a/c 1234. UPI Ref: 431234567890', 'expense', 12000, 'Chai Point', '1234'],
  ['VM-HDFCBK', 'Refund of Rs 499.00 credited to your HDFC Bank Credit Card XX1234 from AMAZON on 12-11-26', 'income', 49900, 'Amazon', '1234'],
  ['VM-HDFCBK', 'Your HDFC Bank Credit Card XX1234 was used for Rs. 750.50 at UBER INDIA on 12-11-26. Avl limit: Rs 45,000', 'expense', 75050, 'Uber India', '1234'],
  ['AX-CANBNK', 'An amount of INR 1,500.00 has been DEBITED to your account XXX1234 on 12/11/2026 towards UPI/DR/431234567890/BIGBASKET. Total Avail.bal INR 20,000.00 - Canara Bank', 'expense', 150000, 'Bigbasket', '1234'],
  ['5676791', 'Your a/c no. XXXXXXXX1234 is credited by Rs.50,000.00 on 01-11-2026 by a/c linked to mobile 9XXXXXX123 (IMPS Ref no 123456789012).', 'income', 5000000, '', '1234'],
];

test('reads debits and credits from common Indian bank messages', () => {
  for (const [address, body, type, amount, payee, last4] of MONEY_MESSAGES) {
    const f = parse(address, body);
    assert.ok(f, `should read: ${body}`);
    assert.equal(f.type, type, `direction of: ${body}`);
    assert.equal(f.amount, amount, `amount of: ${body}`);
    assert.equal(f.merchant, payee, `payee of: ${body}`);
    assert.equal(f.last4, last4, `account of: ${body}`);
    assert.equal(f.date, '2026-11-12');
  }
});

test('knows the bank from the sender', () => {
  assert.equal(parse('AX-HDFCBK', MONEY_MESSAGES[0][1]).bank, 'HDFC Bank');
  assert.equal(parse('BZ-SBIUPI-S', MONEY_MESSAGES[4][1]).bank, 'SBI');
  assert.equal(parse('AX-SBICRD', MONEY_MESSAGES[15][1]).bank, 'SBI Card');
  assert.equal(S.bankName('JM-ICICIT'), 'ICICI Bank');
  assert.equal(S.bankName('+919876543210'), '');
  assert.equal(S.senderHeader('VM-HDFCBK-S'), 'HDFCBK');
});

test('kind: card, UPI, bank or cash machine', () => {
  assert.equal(parse('JD-HDFCBK', MONEY_MESSAGES[2][1]).kind, 'card');
  assert.equal(parse('AX-HDFCBK', MONEY_MESSAGES[0][1]).kind, 'upi');
  assert.equal(parse('AD-SBIINB', MONEY_MESSAGES[12][1]).kind, 'bank');
  assert.equal(parse('AD-ATMSBI', MONEY_MESSAGES[14][1]).kind, 'atm');
});

test('keeps the bank reference number', () => {
  assert.equal(parse('AX-HDFCBK', MONEY_MESSAGES[0][1]).ref, '431234567890');
  assert.equal(parse('AX-AXISBK', MONEY_MESSAGES[8][1]).ref, '431234567890');
  assert.equal(parse('JM-ICICIT', MONEY_MESSAGES[5][1]).ref, '431234567890');
});

test('ignores messages that are not a finished transaction', () => {
  const ignored = [
    ['AX-HDFCBK', '123456 is the OTP for txn of INR 500.00 at AMAZON on HDFC Bank card ending 1234. Valid till 10:25. Do not share OTP for security reasons'],
    ['AX-HDFCBK', 'Your HDFC Bank Credit Card XX1234 statement: Total due Rs 12,345, Min due Rs 620, due date 20-Nov'],
    ['AX-ICICIT', 'John Doe has requested money from you on Google Pay. On approving, INR 500 will be debited from your account'],
    ['AX-HDFCBK', 'Your transaction of Rs 500 at AMAZON failed due to insufficient balance in A/c XX1234'],
    ['AX-HDFCBK-P', 'Get a pre-approved personal loan of Rs 5,00,000 credited instantly! Apply now'],
    ['AX-HDFCBK', 'Avl Bal in A/c XX1234 is Rs 10,000.00 as on 12-11-26'],
    ['+919876543210', 'I sent Rs 500 to you, please check'],
    ['AX-HDFCBK', 'UPI Mandate of Rs 199.00 for NETFLIX has been successfully created on your A/c XX1234'],
    ['AX-HDFCBK', 'Rs 199 will be debited from your a/c XX1234 on 15-Nov for NETFLIX'],
    ['AX-SBICRD', 'Payment of Rs 5,000.00 received towards your SBI Card ending 1234 on 12-Nov-26. Thank you.'],
    ['AX-ICICIT', 'We have received payment of Rs.5000 for your ICICI Bank Credit Card XX1234.'],
    ['AX-AMAZON', 'Payment of Rs 500 received for your Amazon order #403-123'],
    ['AX-HDFCBK', 'Upcoming debit of Rs 199 on 15-Nov for NETFLIX from A/c XX1234'],
    ['AX-HDFCBK', ''],
  ];
  for (const [address, body] of ignored) assert.equal(parse(address, body), null, `should ignore: ${body}`);
});

test('a message the person shares themselves is read from any sender', () => {
  const body = 'Rs 250 debited from a/c XX1234 to swiggy.stores@axisbank. UPI Ref 431234567890';
  assert.equal(parse('', 'Paid Rs 250 to Raju', { trusted: true }).amount, 25000);
  const f = parse('', body, { trusted: true });
  assert.equal(f.merchant, 'Swiggy Stores');
  assert.equal(f.bank, '');
  assert.equal(parse('+919876543210', 'Paid Rs 250 to Raju'), null);
});

test('balances and limits are never taken as the amount', () => {
  assert.equal(S.findAmount('Avl Bal Rs 9,000.00 after Rs 1,000 debited'), 100000);
  assert.equal(S.findAmount('Rs.1,23,456.78 debited'), 12345678);
  assert.equal(S.findAmount('debited by 500.0 on date'), 50000);
  assert.equal(S.findAmount('₹ 99 spent'), 9900);
});

test('payee names are tidied', () => {
  assert.equal(S.prettyName('ZOMATO LTD'), 'Zomato');
  assert.equal(S.prettyName('swiggy.stores@axisbank'), 'Swiggy Stores');
  assert.equal(S.prettyName('paytmqr2810050501011abcd@paytm'), '');
  assert.equal(S.prettyName('9876543210@ybl'), '');
  assert.equal(S.prettyName('BANK OF BARODA'), 'Bank of Baroda');
  assert.equal(S.prettyName('Chai Point'), 'Chai Point');
});

test('guesses categories: what you chose before, then well-known shops', () => {
  const state = createDefaultState();
  const swiggy = parse('AX-AXISBK', MONEY_MESSAGES[8][1]);
  assert.equal(S.guessCategory(swiggy, state), 'food');
  const salary = parse('AD-SBIINB', MONEY_MESSAGES[13][1]);
  assert.equal(S.guessCategory(salary, state), 'salary');
  const person = parse('AD-SBIUPI', MONEY_MESSAGES[3][1]);
  assert.equal(S.guessCategory(person, state), 'other');
  // A past transaction with the same note wins
  state.transactions.push({ id: 'a', type: 'expense', amount: 100, categoryId: 'rent', accountId: 'upi', date: '2026-10-01', note: 'John Doe', createdAt: 1 });
  assert.equal(S.guessCategory(person, state), 'rent');
  // A choice made in the editor for this payee wins over everything
  S.learnAdded(state, person, { categoryId: 'gifts', accountId: 'bank', note: 'John Doe' }, { explicit: true });
  assert.equal(S.guessCategory(person, state), 'gifts');
  assert.equal(S.guessAccount(person, state), 'bank');
});

const message = (n, extra = {}) => ({ ...parse('AX-AXISBK', MONEY_MESSAGES[8][1]), id: `m${n}`, ref: `ref${n}`, ...extra });

test('learns: a payee added twice with the same category is then added automatically', () => {
  const state = createDefaultState();
  assert.equal(S.decide(message(1), state), 'ask');
  S.learnAdded(state, message(1), { categoryId: 'food', note: 'Swiggy' });
  assert.equal(S.decide(message(2), state), 'ask');
  S.learnAdded(state, message(2), { categoryId: 'food', note: 'Swiggy' });
  assert.equal(S.decide(message(3), state), 'add');
  // A different category starts the count again
  S.learnAdded(state, message(3), { categoryId: 'groceries', note: 'Swiggy' }, { explicit: true });
  assert.equal(S.decide(message(4), state), 'ask');
  assert.equal(S.guessCategory(message(4), state), 'groceries');
  // Undoing an automatic add stops the trust
  S.learnAdded(state, message(4), { categoryId: 'groceries' });
  assert.equal(S.decide(message(5), state), 'add');
  S.learnUndone(state, message(5));
  assert.equal(S.decide(message(5), state), 'ask');
  // One that looks typed in by hand is always asked about
  S.learnAdded(state, message(5), { categoryId: 'groceries' });
  S.learnAdded(state, message(6), { categoryId: 'groceries' });
  state.transactions.push({ id: 'hand', type: 'expense', amount: 50000, categoryId: 'food', accountId: 'upi', date: '2026-11-12', note: '', createdAt: 1 });
  assert.equal(S.decide(message(7), state), 'ask');
});

test('learns: a payee ignored twice is then skipped, and your own name for a payee is kept', () => {
  const state = createDefaultState();
  S.learnIgnored(state, message(1));
  assert.equal(S.decide(message(2), state), 'ask');
  S.learnIgnored(state, message(2));
  assert.equal(S.decide(message(3), state), 'ignore');
  // Adding it again (by checking it) brings it back
  S.learnAdded(state, message(3), { categoryId: 'food', note: 'Lunch at work' }, { explicit: true });
  assert.equal(S.decide(message(4), state), 'ask');
  assert.equal(S.toTransaction(message(4), state).note, 'Lunch at work');
  assert.equal(S.toTransaction(message(4), state).sms.payee, 'swiggy');
  // Choosing in Settings → Learned wins over the counts
  const key = S.payeeKey('Swiggy');
  state.sms.payees[key].mode = 'auto';
  assert.equal(S.decide(message(5), state), 'add');
  state.sms.payees[key].mode = 'ignore';
  assert.equal(S.decide(message(5), state), 'ignore');
  // Editing a transaction later teaches the new category and name
  state.sms.payees[key].mode = 'ask';
  S.learnEdited(state, { categoryId: 'health', note: 'Doctor', sms: { id: 'x', payee: key } });
  assert.equal(S.guessCategory(message(6), state), 'health');
  assert.equal(S.toTransaction(message(6), state).note, 'Doctor');
});

test('the same pasted message gets the same id', () => {
  assert.equal(S.textId('Rs 5 debited  from A/c 1'), S.textId('Rs 5 debited from A/c 1'));
  assert.notEqual(S.textId('Rs 5 debited'), S.textId('Rs 6 debited'));
});

test('saved data keeps message details and learning, and drops broken entries', () => {
  const state = normalizeState({
    transactions: [{ id: 't', type: 'expense', amount: 100, date: '2026-11-12', sms: { id: 9, ref: '123', payee: 'swiggy' } }],
    sms: { enabled: true, pending: [{ id: 'a', amount: 100, date: '2026-11-12' }, { id: 'b', amount: 'x' }, null], payees: { swiggy: { categoryId: 'food', seen: 2 } }, merchants: { old: 'x' } },
  });
  assert.deepEqual(state.transactions[0].sms, { id: '9', ref: '123', payee: 'swiggy' });
  assert.equal(state.sms.pending.length, 1);
  assert.equal(state.sms.enabled, true);
  assert.equal(state.sms.autoAdd, false);
  assert.equal(state.sms.payees.swiggy.seen, 2);
  assert.equal(state.sms.merchants, undefined);
  assert.deepEqual(normalizeState(null).sms.pending, []);
});

test('guesses accounts by kind', () => {
  const state = createDefaultState();
  assert.equal(S.guessAccount(parse('JD-HDFCBK', MONEY_MESSAGES[2][1]), state), 'card');
  assert.equal(S.guessAccount(parse('AX-HDFCBK', MONEY_MESSAGES[0][1]), state), 'upi');
  assert.equal(S.guessAccount(parse('AD-SBIINB', MONEY_MESSAGES[12][1]), state), 'bank');
});

test('spots the same transaction twice', () => {
  const state = createDefaultState();
  const f = parse('AX-HDFCBK', MONEY_MESSAGES[0][1]);
  assert.equal(S.alreadyHave(f, state), false);
  state.transactions.push({ id: 'x', ...S.toTransaction(f, state), createdAt: 1 });
  assert.equal(S.alreadyHave(f, state), true);
  // Same bank reference from a second message
  assert.equal(S.alreadyHave({ ...f, id: 'other' }, state), true);
  // Typed in by hand the day before
  const fresh = createDefaultState();
  fresh.transactions.push({ id: 'y', type: 'expense', amount: 50000, categoryId: 'food', accountId: 'upi', date: '2026-11-11', note: 'Lunch', createdAt: 1 });
  assert.equal(S.looksTypedIn(f, fresh), true);
});
