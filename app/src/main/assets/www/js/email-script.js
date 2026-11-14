// The small Google Apps Script the person puts in their own Google account (Settings → Bank
// Emails shows how). It reads bank alert emails with read-only access and hands them to Expenses
// when asked with the secret key. Expenses itself reads them (sms.js), exactly like bank SMS.
// Kept as text here so the app can copy it with the person's own key filled in.

export const SCRIPT = String.raw`// Expenses — bank emails
// This runs in YOUR Google account. It can only READ email (it can't send, change or delete
// anything), it only looks at emails that look like bank alerts, and it only answers the
// Expenses app that has the secret key below.
const KEY = '__KEY__';
const QUERY = '(debited OR credited OR spent OR withdrawn OR "transaction alert" OR txn OR "available balance" OR "amount due" OR "is due") -in:spam -in:trash -category:promotions -category:social';
const DAY = 86400000;
const MAX = 60;

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!KEY || KEY.indexOf('KEY__') >= 0 || p.key !== KEY) return reply({ ok: false, error: 'wrong-key' });
  const since = Math.max(Number(p.since) || 0, Date.now() - 31 * DAY);
  const found = Gmail.Users.Messages.list('me', { q: 'after:' + Math.floor(since / 1000) + ' ' + QUERY, maxResults: MAX });
  const messages = [];
  (found.messages || []).forEach(function (item) {
    const m = Gmail.Users.Messages.get('me', item.id, { format: 'full' });
    const date = Number(m.internalDate);
    if (!(date > since)) return;
    const headers = {};
    (m.payload.headers || []).forEach(function (h) { headers[h.name.toLowerCase()] = h.value; });
    messages.push({ id: m.id, from: headers.from || '', subject: headers.subject || '', body: textOf(m.payload).slice(0, 1500), date: date });
  });
  messages.sort(function (a, b) { return a.date - b.date; });
  return reply({ ok: true, messages: messages, now: Date.now() });
}

// The email's text: the plain-text part, or the HTML part with the tags taken out
function textOf(payload) {
  let plain = '';
  let html = '';
  (function walk(part) {
    if (!part) return;
    const data = part.body && part.body.data;
    if (data && part.mimeType === 'text/plain' && !plain) plain = decode(data);
    if (data && part.mimeType === 'text/html' && !html) html = decode(data);
    (part.parts || []).forEach(walk);
  })(payload);
  const text = plain || html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#8377;|&#x20b9;|&#8360;/gi, '₹').replace(/&[a-z]+;/gi, ' ');
  return text.replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function decode(data) {
  const bytes = typeof data === 'string' ? Utilities.base64DecodeWebSafe(data) : data;
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

function reply(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

// Optional: choose "test" at the top and press Run to see what Expenses would get (in the log).
function test() {
  Logger.log(doGet({ parameter: { key: KEY, since: Date.now() - 3 * DAY } }).getContent());
}
`;

export const MANIFEST = `{
  "timeZone": "Asia/Kolkata",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "dependencies": {
    "enabledAdvancedServices": [{ "userSymbol": "Gmail", "serviceId": "gmail", "version": "v1" }]
  },
  "oauthScopes": ["https://www.googleapis.com/auth/gmail.readonly"],
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
`;

/** The script with this person's secret key in it. */
export function scriptWithKey(key) {
  return SCRIPT.replace('__KEY__', key);
}
