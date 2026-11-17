// The bank-email script (runs in Google Apps Script) tried against a fake Gmail, and reading
// bank emails with the same rules as bank SMS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SCRIPT, MANIFEST, scriptWithKey } from '../app/src/main/assets/www/js/email-script.js';
import * as S from '../app/src/main/assets/www/js/sms.js';

globalThis.window = globalThis.window || {};
const { createDefaultState } = await import('../app/src/main/assets/www/js/store.js');

const NOW = Date.UTC(2026, 10, 12, 6, 0);
const b64 = text => Buffer.from(text, 'utf8').toString('base64url');

/** Runs the Apps Script code with fake Gmail / Utilities / ContentService. */
function runScript(key, mail) {
  const listed = [];
  const sandbox = {
    Date: class extends Date { static now() { return NOW; } },
    Gmail: { Users: { Messages: {
      list: (user, opts) => { listed.push(opts.q); return { messages: mail.map(m => ({ id: m.id })) }; },
      get: (user, id) => mail.find(m => m.id === id),
    } } },
    Utilities: {
      base64DecodeWebSafe: s => [...Buffer.from(s, 'base64url')],
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes.map(b => b & 255)).toString('utf8') }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: text => ({ setMimeType: () => ({ getContent: () => text }) }),
    },
    Logger: { log: () => {} },
    Math, JSON, Number, Buffer, String, encodeURIComponent,
    // A pretend Google Drive and script settings for sync & backup
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    ScriptApp: { getOAuthToken: () => 'token' },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    UrlFetchApp: { fetch: (url, options) => fakeDrive(url, options) },
  };
  sandbox.Utilities.formatDate = () => day.value;
  const props = {};
  const files = {};
  const day = { value: '2026-11-12' };
  let next = 1;
  const res = (code, text) => ({ getResponseCode: () => code, getContentText: () => text });
  function fakeDrive(url, options) {
    assert.equal(options.headers.Authorization, 'Bearer token');
    const method = options.method;
    if (method === 'post' && url.endsWith('/drive/v3/files')) {
      const id = 'f' + next++;
      files[id] = { name: JSON.parse(options.payload).name, content: '', trashed: false };
      return res(200, JSON.stringify({ id }));
    }
    let m = url.match(/upload\/drive\/v3\/files\/([^?]+)\?uploadType=media/);
    if (m) { if (!files[m[1]]) return res(404, ''); files[m[1]].content = options.payload; return res(200, '{}'); }
    m = url.match(/drive\/v3\/files\/([^?]+)\?alt=media/);
    if (m) { const file = files[decodeURIComponent(m[1])]; return file ? res(200, file.content) : res(404, ''); }
    if (url.includes('/drive/v3/files?q=')) {
      const list = Object.entries(files).filter(([, x]) => !x.trashed && x.name.startsWith('Expenses backup ')).map(([id, x]) => ({ id, name: x.name }))
        .sort((p, q) => (p.name < q.name ? 1 : -1));
      return res(200, JSON.stringify({ files: list }));
    }
    m = url.match(/drive\/v3\/files\/([^?]+)$/);
    if (m && method === 'patch') { files[m[1]].trashed = JSON.parse(options.payload).trashed; return res(200, '{}'); }
    throw new Error('unexpected Drive call ' + method + ' ' + url);
  }
  vm.createContext(sandbox);
  vm.runInContext(scriptWithKey(key), sandbox);
  return {
    call: params => JSON.parse(sandbox.doGet({ parameter: params }).getContent()),
    post: body => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()),
    listed, files, day,
  };
}

const MAIL = [
  { id: 'a', internalDate: String(NOW - 3600000), payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>' }, { name: 'Subject', value: 'UPI txn' }],
    parts: [{ mimeType: 'text/plain', body: { data: b64('Rs.500.00 has been debited from account **1234 to VPA swiggy@icici on 12-11-26.') } }] } },
  { id: 'b', internalDate: String(NOW - 7200000), payload: { mimeType: 'text/html', headers: [{ name: 'From', value: 'Axis Bank <alerts@axisbank.com>' }, { name: 'Subject', value: 'Credit' }],
    body: { data: b64('<html><style>p{}</style><p>INR&nbsp;2,000.00 credited to A/c no. XX9876</p><br>Avl balance &#8377;9,000</html>') } } },
  { id: 'old', internalDate: String(NOW - 40 * 86400000), payload: { mimeType: 'text/plain', headers: [], body: { data: b64('old') } } },
];

test('the Google script answers only with the right key', () => {
  const s = runScript('k123', MAIL);
  assert.deepEqual(s.call({ key: 'nope' }), { ok: false, error: 'wrong-key' });
  assert.deepEqual(runScript('__KEY__', MAIL).call({ key: '__KEY__' }), { ok: false, error: 'wrong-key' });
  assert.equal(SCRIPT.includes("'__KEY__'"), true);
});

test('the Google script returns new bank emails, oldest first, as text', () => {
  const s = runScript('k123', MAIL);
  const out = s.call({ key: 'k123', since: String(NOW - 86400000) });
  assert.equal(out.ok, true);
  assert.deepEqual(out.messages.map(m => m.id), ['b', 'a']);
  assert.equal(out.messages[1].from, 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>');
  assert.match(out.messages[1].body, /^Rs\.500\.00 has been debited/);
  assert.equal(out.messages[0].body, 'INR 2,000.00 credited to A/c no. XX9876\nAvl balance ₹9,000');
  assert.match(s.listed[0], /^after:\d+ \(debited OR credited/);
  // Never looks further back than a month
  runScript('k123', MAIL).call({ key: 'k123', since: '0' });
  const longAgo = runScript('k123', MAIL);
  longAgo.call({ key: 'k123', since: '0' });
  assert.equal(Number(longAgo.listed[0].match(/after:(\d+)/)[1]), Math.floor((NOW - 31 * 86400000) / 1000));
});

test('the script settings ask only for read-only Gmail and its own Drive files', () => {
  const manifest = JSON.parse(MANIFEST);
  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/script.external_request',
  ]);
  assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
  assert.equal(manifest.dependencies.enabledAdvancedServices[0].serviceId, 'gmail');
});

const D = new Date(2026, 10, 12, 10, 20).getTime();
const email = (from, subject, body) => {
  const bank = S.bankFromEmail(from);
  return { message: { id: 'mail-1', address: '', body: S.emailText(subject, body), date: D }, options: { bank, via: 'email' } };
};

test('bank emails are read like bank SMS', () => {
  const hdfc = email('HDFC Bank InstaAlerts <alerts@hdfcbank.net>', 'You have done a UPI txn',
    'Dear Customer, Rs.500.00 has been debited from account **1234 to VPA swiggy.stores@icici SWIGGY on 12-11-26. Your UPI transaction reference number is 431234567890. If you did not authorize this transaction, please report it. Never share your OTP.');
  const f = S.parseBankSms(hdfc.message, hdfc.options);
  assert.deepEqual([f.type, f.amount, f.merchant, f.last4, f.ref, f.bank, f.via], ['expense', 50000, 'Swiggy Stores', '1234', '431234567890', 'HDFC Bank', 'email']);
  const icici = email('ICICI Bank <credit_cards@icicibank.com>', 'Transaction alert',
    'Your ICICI Bank Credit Card XX4321 has been used for a transaction of INR 2,499.00 on Nov 12, 2026 at 10:20:30. Info: AMAZON. The Available Credit Limit on your card is INR 45,000.00.');
  assert.equal(S.parseBankSms(icici.message, icici.options).merchant, 'Amazon');
  assert.equal(S.parseBalance(icici.message, icici.options).kind, 'limit');
  const statement = email('SBI Card <statements@sbicard.com>', 'Statement', 'Total Amount Due: Rs 18,450.00. Minimum Amount Due: Rs 925.00. Payment Due Date: 05 Dec 2026. SBI Card ending 5555');
  assert.deepEqual([S.parseBill(statement.message, statement.options).name, S.parseBill(statement.message, statement.options).dueDate], ['SBI Card ••5555', '2026-12-05']);
  const shop = email('Swiggy <noreply@swiggy.in>', 'Order placed', 'Your order of Rs 349 has been placed. Paid via UPI.');
  assert.equal(S.parseBankSms(shop.message, shop.options), null);
  assert.equal(S.bankFromEmail('alerts@onlinesbi.sbi.co.in'), 'SBI');
  assert.equal(S.bankFromEmail('friend@gmail.com'), '');
});

test('the same payment from an SMS and an email counts once', () => {
  const state = createDefaultState();
  const sms = S.parseBankSms({ id: '7', address: 'AX-HDFCBK', body: 'Rs 500.00 debited from a/c XX1234 on 12-11-26 to SWIGGY', date: D });
  state.transactions.push({ id: 't', createdAt: 1, ...S.toTransaction(sms, state) });
  const mail = email('alerts@hdfcbank.net', 'Debit alert', 'Rs.500.00 has been debited from account **1234 on 12-11-26.');
  const fromMail = S.parseBankSms(mail.message, mail.options);
  assert.equal(S.alreadyHave(fromMail, state), true);
  // A different card, or another amount, is a different payment
  assert.equal(S.alreadyHave({ ...fromMail, last4: '9999' }, state), false);
  assert.equal(S.alreadyHave({ ...fromMail, amount: 50100 }, state), false);
  // Two SMS of the same amount on the same day are two payments
  assert.equal(S.alreadyHave({ ...sms, id: '8', via: undefined }, state), false);
});

test('the Google script keeps the data in Drive with one dated backup a day', () => {
  const s = runScript('k123', []);
  assert.deepEqual(s.call({ key: 'k123', action: 'hello' }), { ok: true, version: 2 });
  assert.deepEqual(s.call({ key: 'k123', action: 'pull' }), { ok: true, version: 2, data: null, savedAt: 0 });
  assert.deepEqual(s.post({ key: 'nope', action: 'push', data: '{}' }), { ok: false, error: 'wrong-key' });
  assert.equal(s.post({ key: 'k123', action: 'push', data: '{"a":1}', savedAt: 111 }).ok, true);
  assert.deepEqual(s.call({ key: 'k123', action: 'pull' }), { ok: true, version: 2, data: '{"a":1}', savedAt: 111 });
  s.post({ key: 'k123', action: 'push', data: '{"a":2}', savedAt: 222 });
  let backups = s.call({ key: 'k123', action: 'list' }).backups;
  assert.deepEqual(backups.map(b => b.name), ['Expenses backup 2026-11-12.json']); // one a day
  assert.equal(s.call({ key: 'k123', action: 'get', id: backups[0].id }).data, '{"a":1}');
  assert.equal(s.call({ key: 'k123', action: 'pull' }).data, '{"a":2}');
  // Fifteen days later only the newest 14 backups are kept
  for (let d = 13; d <= 27; d++) { s.day.value = '2026-11-' + d; s.post({ key: 'k123', action: 'push', data: '{"d":' + d + '}', savedAt: 300 + d }); }
  backups = s.call({ key: 'k123', action: 'list' }).backups;
  assert.equal(backups.length, 14);
  assert.equal(backups[0].name, 'Expenses backup 2026-11-27.json');
  // If the data file was deleted from Drive, a new one is made
  delete s.files.f1;
  assert.equal(s.post({ key: 'k123', action: 'push', data: '{"back":1}', savedAt: 999 }).ok, true);
  assert.equal(s.call({ key: 'k123', action: 'pull' }).data, '{"back":1}');
});
