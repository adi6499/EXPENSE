// The small Google Apps Script the person puts in their own Google account (Settings → Bank Emails
// / Sync shows how). It (1) reads bank alert emails with read-only Gmail access and (2) keeps the
// app's data in the person's own Google Drive — one live copy for syncing phone ↔ computer, plus a
// dated backup a day (last 14). It can only see the files it made itself (drive.file).
// Kept as text here so the app can copy it with the person's own key filled in.

export const SCRIPT_VERSION = 2;

export const SCRIPT = String.raw`// Expenses — your Google helper (version 2)
// This runs in YOUR Google account and only answers the Expenses app that has the secret key below.
// Bank emails: it can only READ email and only looks at emails that look like bank alerts.
// Sync & backup: it keeps your Expenses data in your Google Drive ("Expenses data.json" and a
// dated "Expenses backup …" copy each day). It can only see files it made itself.
const KEY = '__KEY__';
const VERSION = 2;
const QUERY = '(debited OR credited OR spent OR withdrawn OR "transaction alert" OR txn OR "available balance" OR "amount due" OR "is due") -in:spam -in:trash -category:promotions -category:social';
const DAY = 86400000;
const MAX = 60;
const KEEP_BACKUPS = 14;

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!KEY || KEY.indexOf('KEY__') >= 0 || p.key !== KEY) return reply({ ok: false, error: 'wrong-key' });
  try {
    if (p.action === 'hello') return reply({ ok: true, version: VERSION });
    if (p.action === 'pull') return reply(pull());
    if (p.action === 'list') return reply({ ok: true, version: VERSION, backups: listBackups() });
    if (p.action === 'get') return reply({ ok: true, version: VERSION, data: readFile(p.id) });
    return reply(emails(Number(p.since) || 0));
  } catch (err) {
    return reply({ ok: false, error: 'script', message: String(err && err.message || err).slice(0, 300) });
  }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  if (!KEY || KEY.indexOf('KEY__') >= 0 || body.key !== KEY) return reply({ ok: false, error: 'wrong-key' });
  try {
    if (body.action === 'push') return reply(push(String(body.data || ''), Number(body.savedAt) || Date.now()));
    return reply({ ok: false, error: 'unknown-action' });
  } catch (err) {
    return reply({ ok: false, error: 'script', message: String(err && err.message || err).slice(0, 300) });
  }
}

// ---- Bank emails

function emails(sinceAsked) {
  const since = Math.max(sinceAsked, Date.now() - 31 * DAY);
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
  return { ok: true, version: VERSION, messages: messages, now: Date.now() };
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

// ---- Sync & backup in your Google Drive (only files this script made)

function drive(method, url, payload, contentType) {
  const options = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (payload !== undefined) { options.payload = payload; options.contentType = contentType || 'application/json'; }
  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Google Drive said ' + code + ': ' + res.getContentText().slice(0, 200));
  return res.getContentText();
}

function createFile(name) {
  return JSON.parse(drive('post', 'https://www.googleapis.com/drive/v3/files', JSON.stringify({ name: name, mimeType: 'application/json' }))).id;
}

function writeFile(id, text) {
  return drive('patch', 'https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', text, 'application/json') !== null;
}

function readFile(id) {
  return drive('get', 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media');
}

function listBackups() {
  const q = encodeURIComponent("name contains 'Expenses backup ' and trashed = false");
  const text = drive('get', 'https://www.googleapis.com/drive/v3/files?q=' + q + '&orderBy=name%20desc&pageSize=60&fields=files(id,name,size,modifiedTime)');
  return text ? (JSON.parse(text).files || []) : [];
}

function pull() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DATA_FILE');
  const data = id ? readFile(id) : null;
  return { ok: true, version: VERSION, data: data, savedAt: Number(props.getProperty('SAVED_AT')) || 0 };
}

function push(data, savedAt) {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('DATA_FILE');
  if (!id || !writeFile(id, data)) {
    id = createFile('Expenses data.json');
    writeFile(id, data);
    props.setProperty('DATA_FILE', id);
  }
  props.setProperty('SAVED_AT', String(savedAt));
  // One dated copy a day; the oldest beyond 14 go to the bin
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (props.getProperty('BACKUP_DAY') !== day) {
    const copy = createFile('Expenses backup ' + day + '.json');
    writeFile(copy, data);
    props.setProperty('BACKUP_DAY', day);
    listBackups().slice(KEEP_BACKUPS).forEach(function (f) {
      drive('patch', 'https://www.googleapis.com/drive/v3/files/' + f.id, JSON.stringify({ trashed: true }));
    });
  }
  return { ok: true, version: VERSION, savedAt: savedAt };
}

function reply(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

// Choose "test" at the top and press Run once: it asks for the permissions and shows what Expenses would get.
function test() {
  Logger.log(doGet({ parameter: { key: KEY, since: Date.now() - 3 * DAY } }).getContent());
  Logger.log('Backups in Drive: ' + listBackups().length);
}
`;

export const MANIFEST = `{
  "timeZone": "Asia/Kolkata",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "dependencies": {
    "enabledAdvancedServices": [{ "userSymbol": "Gmail", "serviceId": "gmail", "version": "v1" }]
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/script.external_request"
  ],
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
`;

/** The script with this person's secret key in it. */
export function scriptWithKey(key) {
  return SCRIPT.replace('__KEY__', key);
}
