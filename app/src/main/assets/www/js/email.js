// Bank emails — for iPhone and the website too. A small script in the person's own Google account
// (email-script.js) reads bank alert emails; Expenses asks it for new ones now and then and reads
// them like bank SMS (same learning, and an SMS + email about one payment counts once).
import { store } from './store.js';
import { native } from './native.js';
import { $, esc, icon, tile, pushPage, alert, toast, haptic } from './ui.js';
import { takeBankMessages } from './messages.js';
import * as S from './sms.js';
import { scriptWithKey, MANIFEST } from './email-script.js';

const DAY = 86400000;
const CHECK_EVERY = 10 * 60000;
const URL_PATTERN = /^https:\/\/script\.google\.com\/(?:a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const CREATE_URL = 'https://script.google.com/home/projects/create';

const settings = () => store.state.settings.email;
export const emailConnected = () => !!(settings().url && settings().key);

export function emailStatusText() {
  if (!emailConnected()) return 'Off';
  return settings().enabled ? 'On' : 'Paused';
}

function newKey() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}

/** Asks the person's script for bank emails newer than since (ms). */
async function ask(url, key, since) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${url}?key=${encodeURIComponent(key)}&since=${Math.floor(since)}`, {
      signal: controller.signal, credentials: 'omit', redirect: 'follow', cache: 'no-store',
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      // A Google sign-in page instead of JSON: the script isn't shared with "Anyone"
      return { ok: false, error: /accounts\.google|<html/i.test(text) ? 'not-public' : 'bad-reply' };
    }
  } catch (err) {
    return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

const PROBLEMS = {
  'wrong-key': 'That link belongs to a different copy of the script. Copy the script again from step 3, paste it over the old one, then deploy again (Deploy → Manage deployments → edit → New version).',
  'not-public': 'Google asked to sign in. In the deployment, “Who has access” must be “Anyone”.',
  timeout: 'Your Google script took too long to answer. Try again in a minute.',
  network: native.isApp ? 'Couldn’t reach Google. Check the internet connection and the link.' : 'Couldn’t reach Google. Check the internet connection and that the link ends in /exec.',
  'bad-reply': 'The link didn’t answer like the Expenses script. Check it’s the Web app URL from Deploy.',
};

/** Turns the script's emails into bank messages Expenses can read. */
function asMessages(list) {
  return list.map(m => ({
    id: `mail-${m.id}`,
    address: '',
    body: S.emailText(m.subject, m.body),
    date: Number(m.date) || Date.now(),
    bank: S.bankFromEmail(m.from),
    via: 'email',
  }));
}

let checking = null;

/** Checks for new bank emails (at most every 10 minutes unless force). */
export function checkEmails({ quiet = true, force = false } = {}) {
  const e = settings();
  if (!emailConnected() || !e.enabled) return Promise.resolve(null);
  if (!force && Date.now() - (e.lastCheck || 0) < CHECK_EVERY) return Promise.resolve(null);
  if (checking) return checking;
  checking = (async () => {
    const since = e.lastDate || Date.now() - 7 * DAY;
    e.lastCheck = Date.now();
    const reply = await ask(e.url, e.key, since);
    if (!reply.ok) {
      store.save();
      if (!quiet) alert({ title: 'Couldn’t check bank emails', message: PROBLEMS[reply.error] || 'Please try again.' });
      return null;
    }
    const messages = asMessages(reply.messages || []);
    e.lastDate = messages.reduce((max, m) => Math.max(max, m.date), since);
    return takeBankMessages(messages, { quiet });
  })().finally(() => { checking = null; });
  return checking;
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const box = document.createElement('textarea');
    box.value = text;
    box.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(box);
    box.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    box.remove();
    if (!ok) {
      alert({ title: `Couldn’t copy the ${what}`, message: 'Use Share instead and send it to yourself (WhatsApp or email), then copy it from there on the computer.' });
      return;
    }
  }
  haptic('success');
  toast(`${what.charAt(0).toUpperCase()}${what.slice(1)} copied`, { iconName: 'check-circle' });
}

function share(text, fileName) {
  native.shareFile(fileName, 'text/plain', text);
}

export function openEmailSetup() {
  const e = settings();
  if (!e.key) {
    e.key = newKey();
    store.save();
  }
  let unsubscribe = () => {};
  const page = pushPage({
    title: 'Bank Emails',
    onClose: () => unsubscribe(),
    render: content => (emailConnected() ? renderConnected(content) : renderSetup(content)),
  });

  function renderConnected(content) {
    const s = settings();
    const last = s.lastCheck ? new Date(s.lastCheck).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'not yet';
    content.innerHTML = `
      <div class="card banner" style="margin-top:12px">
        ${tile('envelope-simple', s.enabled ? 'blue' : 'gray', 'lg')}
        <div class="banner-text"><strong>${s.enabled ? 'Reading bank emails' : 'Paused'}</strong>Last checked ${esc(last)}</div>
      </div>
      <div class="section">
        <div class="list">
          <label class="row">${tile('envelope-simple', 'blue')}<div class="row-main"><span class="row-title" style="flex:1">Read Bank Emails</span>
            <span class="switch"><input type="checkbox" data-em="enabled" ${s.enabled ? 'checked' : ''}><span></span></span></div></label>
          <button class="row tap" data-em="check">${tile('arrows-clockwise', 'green')}<div class="row-main"><span class="row-title" style="flex:1">Check Now</span></div></button>
        </div>
        <div class="section-footer">Expenses asks your Google script for new bank emails when it opens (at most every 10 minutes). They show up on Summary like bank SMS, and the same payment from an SMS and an email is added only once.</div>
      </div>
      <div class="section">
        <div class="list">
          <button class="row tap destructive center" data-em="disconnect"><div class="row-main"><span class="row-title">Disconnect</span></div></button>
        </div>
        <div class="section-footer">To stop it completely, also delete the “Expenses bank emails” project at script.google.com.</div>
      </div>`;
  }

  function renderSetup(content) {
    content.innerHTML = `
      <div class="section" style="margin-top:12px">
        <div class="card steps">
          <p style="margin:0 0 12px;font-size:15px;line-height:1.45">Banks email every transaction too. A small script in <b>your own Google account</b> can pass those emails to Expenses — on iPhone, Android or a computer. It can only <b>read</b> email, only looks at bank alerts, and only answers this app. Setting it up takes about 5 minutes and is easiest on a computer.</p>
          <ol>
            <li>Sign in to the Google account that gets your bank emails, and open Apps Script.
              <div class="step-buttons"><button class="btn secondary" data-em="open">${icon('arrow-square-out')} Open Apps Script</button></div></li>
            <li>Click ⚙ <b>Project Settings</b> (left), tick <b>Show "appsscript.json"</b>. Go back to <b>Editor</b> (&lt;&gt;), open <b>appsscript.json</b>, delete everything in it and paste these settings:
              <div class="step-buttons"><button class="btn secondary" data-em="copy-manifest">${icon('copy')} Copy Settings</button><button class="btn secondary" data-em="share-manifest">${icon('export')}</button></div></li>
            <li>Open <b>Code.gs</b>, delete everything and paste the script:
              <div class="step-buttons"><button class="btn secondary" data-em="copy-script">${icon('copy')} Copy Script</button><button class="btn secondary" data-em="share-script">${icon('export')}</button></div></li>
            <li>Name the project “Expenses bank emails”, press <b>Save</b> (💾). Then <b>Deploy → New deployment</b> → ⚙ <b>Web app</b> → Execute as <b>Me</b>, Who has access <b>Anyone</b> → <b>Deploy</b>.</li>
            <li>Google asks for permission: choose your account → <b>Advanced</b> → <b>Go to Expenses bank emails (unsafe)</b> → <b>Allow</b>. (Google says “unsafe” for every personal script that isn’t published — this one is yours.)</li>
            <li>Copy the <b>Web app URL</b> and paste it here:</li>
          </ol>
        </div>
      </div>
      <div class="section">
        <div class="list"><input class="prompt-input em-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></div>
        <div style="padding:12px 16px 0"><button class="btn" data-em="connect">Connect</button></div>
        <div class="section-footer">Expenses then checks for bank emails from the last 7 days. Your emails stay in your Google account; only bank alerts are passed to this app, and nothing goes anywhere else.${native.isApp ? '' : ' On the website, the emails you add are saved in this browser.'}</div>
      </div>`;
  }

  async function connect(button) {
    const input = $('.em-url', page.content);
    const url = (input.value || '').trim().replace(/\?.*$/, '');
    if (!URL_PATTERN.test(url)) {
      alert({ title: 'That isn’t the right link', message: 'Paste the “Web app URL” from Deploy. It starts with https://script.google.com/macros/s/ and ends with /exec.' });
      return;
    }
    button.disabled = true;
    button.textContent = 'Connecting…';
    const since = Date.now() - 7 * DAY;
    const reply = await ask(url, settings().key, since);
    button.disabled = false;
    button.textContent = 'Connect';
    if (!reply.ok) {
      alert({ title: 'Couldn’t connect', message: PROBLEMS[reply.error] || 'Please try again.' });
      return;
    }
    Object.assign(settings(), { url, enabled: true, lastDate: since, lastCheck: Date.now() });
    store.commit();
    haptic('success');
    const messages = asMessages(reply.messages || []);
    settings().lastDate = messages.reduce((max, m) => Math.max(max, m.date), since);
    const outcome = takeBankMessages(messages, { quiet: true });
    const found = outcome.added.length + outcome.queued;
    alert({
      title: 'Connected',
      message: found
        ? `Found ${found} transaction${found === 1 ? '' : 's'} in your bank emails from the last 7 days. ${outcome.queued ? 'They’re on Summary to check.' : ''}`
        : `Checked ${reply.messages ? reply.messages.length : 0} recent emails — no bank transactions in the last 7 days yet. New ones will show up by themselves.`,
    });
  }

  page.content.addEventListener('click', async ev => {
    const btn = ev.target.closest('[data-em]');
    if (!btn) return;
    const what = btn.dataset.em;
    if (what === 'open') window.open(CREATE_URL, '_blank');
    else if (what === 'copy-manifest') copy(MANIFEST, 'settings');
    else if (what === 'share-manifest') share(MANIFEST, 'appsscript.json');
    else if (what === 'copy-script') copy(scriptWithKey(settings().key), 'script');
    else if (what === 'share-script') share(scriptWithKey(settings().key), 'Code.gs.txt');
    else if (what === 'connect') connect(btn);
    else if (what === 'check') checkEmails({ quiet: false, force: true });
    else if (what === 'disconnect') {
      const ok = await alert({
        title: 'Disconnect bank emails?',
        message: 'Expenses stops asking your Google script for emails. Transactions already added stay.',
        buttons: [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'Disconnect', value: true, style: 'destructive' }],
      });
      if (ok) {
        Object.assign(settings(), { url: '', enabled: false, lastDate: 0, lastCheck: 0, key: newKey() });
        store.commit();
      }
    }
  });
  page.content.addEventListener('change', ev => {
    const input = ev.target.closest('[data-em="enabled"]');
    if (!input) return;
    settings().enabled = input.checked;
    store.commit();
    if (input.checked) checkEmails({ quiet: false, force: true });
  });
  unsubscribe = store.subscribe(() => {
    // Don't wipe a half-typed link while setting up
    if (emailConnected()) page.refresh();
  });
}
