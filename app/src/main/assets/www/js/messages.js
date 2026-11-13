// Bank text messages: reads new ones (Android app only), lists what was found so each can be
// checked and added with one tap, and adds them as transactions. Reading a message is in sms.js.
import { store } from './store.js';
import { native } from './native.js';
import * as L from './logic.js';
import * as S from './sms.js';
import { $, esc, icon, tile, pushPage, bindSwipeRows, actionSheet, alert, toast, haptic, openFormSheet } from './ui.js';
import { openEditor } from './editor.js';

const ROW_PREFIX = 'sms:';
let checking = null;

/** True when this is the Android app and it can read text messages. */
export const canReadMessages = () => native.canReadSms();

function timeLabel(f) {
  const time = new Date(f.time).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${L.shortDate(f.date)}, ${time}`;
}

/** 'HDFC Bank ••1234 · 12 Nov, 10:20 am' */
export function sourceLabel(f) {
  const where = [f.bank, f.last4 ? `••${f.last4}` : ''].filter(Boolean).join(' ');
  return [where, timeLabel(f)].filter(Boolean).join(' · ');
}

function titleOf(f) {
  return f.merchant || (f.type === 'income' ? 'Money received' : 'Money spent');
}

// ---------- Reading new messages

/**
 * Reads messages that arrived since the last look and adds (or lists) what they say.
 * quiet: no message when nothing new was found.
 */
export function checkMessages({ quiet = true } = {}) {
  if (checking) return checking;
  checking = (async () => {
    const none = { added: [], queued: 0 };
    const sms = store.state.sms;
    if (!sms.enabled || !native.canReadSms()) return none;
    if (native.smsStatus() !== 'granted') {
      // SMS access was turned off in the phone's settings
      store.setSms({ enabled: false });
      native.setSmsOptions(false, false);
      toast('SMS access is off — bank messages aren’t being read', { iconName: 'warning-circle', duration: 5000 });
      return none;
    }
    const since = sms.lastDate;
    const result = await native.readSms(since);
    if (!result.ok) {
      if (!quiet) alert({ title: 'Couldn’t read messages', message: result.error || 'Please try again.' });
      return none;
    }
    let newest = since;
    const findings = [];
    for (const m of result.messages || []) {
      newest = Math.max(newest, Number(m.date) || 0);
      try {
        const f = S.parseBankSms(m);
        if (f) findings.push(f);
      } catch (err) {
        console.warn('Skipped a message that could not be read', err);
      }
    }
    const outcome = store.takeFindings(findings, newest);
    announce(outcome, quiet);
    return outcome;
  })().finally(() => { checking = null; });
  return checking;
}

function announce({ added, queued, skipped = 0 }, quiet) {
  if (added.length) {
    const text = added.length === 1
      ? `Added ${store.money(added[0].tx.amount)}${added[0].tx.note ? ` · ${added[0].tx.note}` : ''}`
      : `Added ${added.length} from your messages`;
    haptic('success');
    toast(text, {
      iconName: 'chat-text',
      actionText: 'Undo',
      duration: 6000,
      onAction: () => store.restoreFindings(added.map(a => a.finding), added.map(a => a.tx.id), { distrust: true }),
    });
  } else if (queued) {
    toast(`${queued} new from your bank messages`, { iconName: 'chat-text', actionText: 'Check', duration: 6000, onAction: openReview });
  } else if (!quiet) {
    toast(skipped ? `Nothing new — skipped ${skipped} you always ignore` : 'No new bank messages', { iconName: 'check-circle' });
  }
}

// ---------- Turning it on and off (Settings)

export async function turnOn() {
  if (native.smsStatus() !== 'granted') {
    const go = await alert({
      title: 'Read Bank SMS?',
      message: 'Expenses looks only at the messages your bank sends when money goes out or comes in, and turns them into transactions for you. Messages never leave this phone — the app has no internet access.',
      buttons: [{ text: 'Not Now', value: false, style: 'cancel' }, { text: 'Continue', value: true }],
    });
    if (!go) return false;
    const result = await native.requestSms();
    if (!result.ok) {
      const open = await alert({
        title: 'SMS access is off',
        message: result.blocked
          ? 'Android won’t ask again. In Settings, open Permissions → SMS and choose Allow.'
          : 'Expenses needs SMS access to read your bank’s messages.',
        buttons: result.blocked
          ? [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'Open Settings', value: true }]
          : [{ text: 'OK', value: false, style: 'cancel' }],
      });
      if (open) native.openAppSettings();
      return false;
    }
  }
  const monthStart = L.startOfMonth(L.todayISO());
  const monthName = L.parseISO(monthStart).toLocaleDateString('en-IN', { month: 'long' });
  const from = await actionSheet({
    title: 'Bring in earlier bank messages?',
    message: 'You can check each one before it’s added.',
    actions: [
      { text: `Since 1 ${monthName}`, value: 'month' },
      { text: 'Last 3 Months', value: '3m' },
      { text: 'Only New Messages', value: 'new' },
    ],
  });
  if (!from) return false;
  const start = from === 'month' ? monthStart : L.addMonths(monthStart, -2);
  const lastDate = from === 'new' ? Date.now() : L.parseISO(start).getTime() - 1;
  store.setSms({ enabled: true, lastDate });
  if (store.state.sms.notify) {
    const allowed = await native.requestNotifications();
    if (!allowed.ok) store.setSms({ notify: false });
  }
  native.setSmsOptions(true, store.state.sms.notify);
  haptic('success');
  if (from === 'new') {
    toast('Bank messages will appear here as they arrive', { iconName: 'chat-text', duration: 5000 });
    return true;
  }
  const outcome = await checkMessages({ quiet: false });
  if (outcome.queued) openReview();
  return true;
}

export function turnOff() {
  store.setSms({ enabled: false });
  native.setSmsOptions(false, false);
}

export async function setNotify(on) {
  if (on) {
    const allowed = await native.requestNotifications();
    if (!allowed.ok) {
      alert({ title: 'Notifications are off', message: 'Allow notifications for Expenses in your phone’s settings to hear about new bank messages.' });
      return false;
    }
  }
  store.setSms({ notify: on });
  native.setSmsOptions(store.state.sms.enabled, on);
  return true;
}

/** Keeps the phone's notification switch in step with the saved data (after a restore, say). */
export function syncPhone() {
  const sms = store.state.sms;
  native.setSmsOptions(sms.enabled && native.smsStatus() === 'granted', sms.notify);
}

// ---------- Rows (Summary card and the review page)

function findingRow(f, { full = false } = {}) {
  const cat = store.category(S.guessCategory(f, store.state));
  const amount = f.type === 'income' ? store.money(f.amount, { sign: true }) : store.money(f.amount);
  const typed = S.looksTypedIn(f, store.state);
  return `<div class="swipe-row ignorable" data-id="${ROW_PREFIX}${esc(f.id)}">
    <button class="swipe-delete" aria-label="Ignore">${icon('eye-slash', true)}<span>Ignore</span></button>
    <div class="swipe-content">
      ${tile(cat.icon, cat.color, 'lg')}
      <div class="row-main">
        <div class="row-text">
          <div class="sms-top"><span class="row-title">${esc(titleOf(f))}</span><span class="tx-amount ${f.type}">${esc(amount)}</span></div>
          <div class="row-sub">${typed ? `<span class="sms-warn">Added already?</span> · ` : ''}${esc(sourceLabel(f))}</div>
          ${full ? `<div class="sms-body">${esc(f.body)}</div>` : ''}
        </div>
        <button class="sms-add" data-sms-add="${esc(f.id)}" aria-label="Add ${esc(titleOf(f))}">${icon('plus-circle', true)}</button>
      </div>
    </div>
  </div>`;
}

/** The "From Messages" card on Summary. Empty when nothing is waiting. */
export function messagesCardHTML() {
  const list = store.state.sms.pending;
  if (!list.length) return '';
  const shown = list.slice(0, 3);
  return `
    <div class="section" style="margin-top:12px">
      <div class="section-title"><h2>From Messages</h2><button class="link" data-sms-act="all">Add All</button></div>
      <div class="list sms-list">
        ${shown.map(f => findingRow(f)).join('')}
        ${list.length > shown.length ? `<button class="row tap" data-sms-act="review"><div class="row-main"><span class="row-title" style="flex:1;color:var(--blue)">See All ${list.length}</span><i class="ph ph-caret-right row-chevron"></i></div></button>` : ''}
      </div>
      <div class="section-footer">Tap to check one, ${icon('plus-circle', true)} to add it as it is, or swipe left to ignore.</div>
    </div>`;
}

/**
 * Wires finding rows inside root. Call before the root's own bindSwipeRows, then route swipe
 * taps and deletes through onRowTap / onRowDelete (they return true when the row was ours).
 */
export function bindFindingRows(root) {
  // The ⊕ button sits inside a swipe row: catch it before the row treats it as a tap
  root.addEventListener('click', e => {
    const add = e.target.closest('[data-sms-add]');
    if (add) {
      e.stopPropagation();
      addOne(add.dataset.smsAdd);
      return;
    }
    const act = e.target.closest('[data-sms-act]');
    if (!act) return;
    e.stopPropagation();
    if (act.dataset.smsAct === 'all') addAll();
    if (act.dataset.smsAct === 'review') openReview();
  }, true);
}

export function onRowTap(id) {
  if (!String(id).startsWith(ROW_PREFIX)) return false;
  checkOne(id.slice(ROW_PREFIX.length));
  return true;
}

export function onRowDelete(id) {
  if (!String(id).startsWith(ROW_PREFIX)) return false;
  const result = store.ignoreFinding(id.slice(ROW_PREFIX.length));
  if (!result) return true;
  const p = S.payeeOf(result.finding, store.state);
  const learned = S.payeeMode(p) === 'ignore';
  toast(learned ? `Ignored — ${result.finding.merchant} will be skipped from now on` : 'Ignored', {
    actionText: 'Undo',
    duration: learned ? 7000 : 5000,
    onAction: () => store.restoreFindings([result.finding], [], { before: result.before }),
  });
  return true;
}

// ---------- Adding

function addOne(id) {
  const f = store.finding(id);
  if (!f) return;
  const result = store.acceptFinding(id);
  if (!result) return;
  const { tx, before } = result;
  haptic('success');
  toast(`Added ${store.money(tx.amount)}${tx.note ? ` · ${tx.note}` : ''}${learnedNote(f)}`, {
    iconName: 'check-circle',
    actionText: 'Undo',
    duration: 6000,
    onAction: () => store.restoreFindings([f], [tx.id], { before }),
  });
}

function addAll() {
  const findings = [...store.state.sms.pending];
  if (!findings.length) return;
  const { added, before } = store.acceptAllFindings();
  haptic('success');
  toast(`Added ${added.length} transaction${added.length === 1 ? '' : 's'}`, {
    iconName: 'check-circle',
    actionText: 'Undo',
    duration: 6000,
    onAction: () => store.restoreFindings(findings, added.map(t => t.id), { before }),
  });
}

/** ' — added automatically from now on' when this add made the payee trusted. */
function learnedNote(f) {
  const p = S.payeeOf(f, store.state);
  return p && !p.mode && S.payeeMode(p) === 'auto' && p.seen === S.TRUST_AFTER ? ' — now added automatically' : '';
}

/** Opens the editor filled in from the message, to change anything before adding. */
function checkOne(id) {
  const f = store.finding(id);
  if (!f) return;
  const guess = S.toTransaction(f, store.state);
  openEditor(null, {
    ...guess,
    source: sourceLabel(f),
    onSave: fields => {
      const result = store.acceptFinding(id, fields);
      const extra = result ? learnedNote(f) : '';
      if (extra) toast(`${result.tx.note || 'This payee'}${extra}`, { iconName: 'sparkle', duration: 5000 });
      return result && result.tx;
    },
  });
}

/** A bank message shared to Expenses from the Messages app: fill in a new transaction from it. */
export async function addFromSharedText(text) {
  const f = S.parseBankSms({ id: `shared-${Date.now()}`, address: '', body: String(text || ''), date: Date.now() }, { trusted: true });
  if (!f) {
    alert({ title: 'No amount found', message: 'Share a message that says how much was debited or credited, like “Rs 500 debited from A/c XX1234”.' });
    return;
  }
  if (S.alreadyHave(f, store.state)) {
    const go = await alert({
      title: 'Already added?',
      message: 'A transaction with the same bank reference number is already in Expenses.',
      buttons: [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'Add Anyway', value: true }],
    });
    if (!go) return;
  }
  const guess = S.toTransaction(f, store.state);
  openEditor(null, {
    ...guess,
    source: 'From a bank message',
    onSave: fields => {
      const tx = store.addTransaction({ ...fields, sms: guess.sms });
      S.learnAdded(store.state, f, tx, { explicit: true });
      store.save();
      return tx;
    },
  });
}

/**
 * A bank message that arrived by link (the website's #sms=… from an iPhone Shortcut): goes
 * through the same rules as messages read on Android — learned payees are added straight away.
 */
export function takeMessageText(text) {
  const body = String(text || '').trim();
  if (!body) return;
  const f = S.parseBankSms({ id: S.textId(body), address: '', body, date: Date.now() }, { trusted: true });
  if (!f) {
    toast('That message has no amount debited or credited', { iconName: 'warning-circle', duration: 5000 });
    return;
  }
  if (S.alreadyHave(f, store.state)) {
    toast('Already added', { iconName: 'check-circle' });
    return;
  }
  const outcome = store.takeFindings([f]);
  announce(outcome, false);
  if (outcome.queued) openReview();
}

/** Settings → Paste a Bank Message. */
export function openPaste() {
  const handle = openFormSheet({
    title: 'Bank Message',
    doneText: 'Next',
    size: 'auto',
    html: `
      <div class="section">
        <div class="list"><textarea class="paste-box" rows="6" placeholder="Paste the message your bank sent, like “Rs 500 debited from A/c XX1234 to SWIGGY…”" spellcheck="false"></textarea></div>
        <div class="section-footer">Copy it from your Messages app: press and hold the message, then Copy.</div>
      </div>`,
    onMount: h => setTimeout(() => { const box = $('.paste-box', h.el); if (box) box.focus(); }, 350),
    onDone: h => {
      const box = $('.paste-box', h.el);
      const text = box ? box.value.trim() : '';
      if (!text) return false;
      setTimeout(() => addFromSharedText(text), 380);
      return true;
    },
  });
}

// ---------- Review page

let reviewPage = null;

export function openReview() {
  if (reviewPage) return;
  let unsubscribe = null;
  reviewPage = pushPage({
    title: 'From Messages',
    backText: 'Back',
    rightHTML: `<button class="nav-btn strong" data-r="all">Add All</button>`,
    onRight: () => addAll(),
    onClose: () => {
      if (unsubscribe) unsubscribe();
      reviewPage = null;
    },
    render: content => {
      const list = store.state.sms.pending;
      const addAllBtn = $('[data-r="all"]', reviewPage ? reviewPage.el : document);
      if (addAllBtn) addAllBtn.disabled = !list.length;
      if (!list.length) {
        content.innerHTML = `<div class="empty" style="padding-top:18vh">${icon('check-circle', true)}<strong>All checked</strong>New bank messages show up here.</div>`;
        return;
      }
      content.innerHTML = `
        <div class="section">
          <div class="list sms-list sms-full">${list.map(f => findingRow(f, { full: true })).join('')}</div>
          <div class="section-footer">Tap one to check it, ${icon('plus-circle', true)} to add it as it is, or swipe left to ignore it. Category and account are guesses — what you pick is remembered for next time.</div>
        </div>`;
    },
  });
  const content = reviewPage.content;
  bindFindingRows(content);
  bindSwipeRows(content, { onTap: onRowTap, onDelete: onRowDelete });
  unsubscribe = store.subscribe(() => reviewPage && reviewPage.refresh());
  reviewPage.refresh();
}

// ---------- Settings → Learned: what Expenses has picked up, and changing it

const MODE_TEXT = { auto: 'Added automatically', ask: 'Asks you', ignore: 'Always ignored' };

export function openLearned() {
  let unsubscribe = null;
  const page = pushPage({
    title: 'Learned',
    onClose: () => { if (unsubscribe) unsubscribe(); },
    render: content => {
      const sms = store.state.sms;
      const payees = Object.entries(sms.payees).map(([key, p]) => ({ key, p, mode: S.payeeMode(p) }));
      const order = { auto: 0, ask: 1, ignore: 2 };
      payees.sort((a, b) => order[a.mode] - order[b.mode] || String(a.p.note || a.p.name).localeCompare(String(b.p.note || b.p.name)));
      const accounts = Object.entries(sms.accounts).filter(([, id]) => store.account(id));
      if (!payees.length && !accounts.length) {
        content.innerHTML = `<div class="empty" style="padding-top:16vh">${icon('sparkle', true)}<strong>Nothing learned yet</strong>Add or ignore a few bank transactions and Expenses starts remembering what you do.</div>`;
        return;
      }
      content.innerHTML = `
        ${payees.length ? `
        <div class="section">
          <div class="section-header">Payees</div>
          <div class="list">
            ${payees.map(({ key, p, mode }) => {
              const cat = p.categoryId ? store.category(p.categoryId) : null;
              const parts = [MODE_TEXT[mode]];
              if (cat && mode !== 'ignore') parts.push(cat.name);
              if (p.note && p.name) parts.push(`was “${p.name}”`);
              return `<button class="row tap" data-key="${esc(key)}">
                ${mode === 'ignore' ? tile('eye-slash', 'gray', 'lg') : tile(cat ? cat.icon : 'tag', cat ? cat.color : 'gray', 'lg')}
                <div class="row-main"><div class="row-text">
                  <div class="row-title">${esc(p.note || p.name)}</div>
                  <div class="row-sub">${mode === 'auto' ? `<span style="color:var(--green)">${icon('sparkle', true)}</span> ` : ''}${esc(parts.join(' · '))}</div>
                </div><i class="ph ph-caret-right row-chevron"></i></div>
              </button>`;
            }).join('')}
          </div>
          <div class="section-footer">Add the same payee twice with the same category and it’s added for you from then on. Ignore it twice and it’s skipped. Tap a payee to choose yourself.</div>
        </div>` : ''}
        ${accounts.length ? `
        <div class="section">
          <div class="section-header">Cards &amp; Accounts</div>
          <div class="list">
            ${accounts.map(([key, id]) => {
              const [bank, last4] = key.split('|');
              const account = store.account(id);
              return `<button class="row tap" data-acct="${esc(key)}">${tile(account.icon, account.color)}
                <div class="row-main"><span class="row-title" style="flex:1">${esc([bank, last4 ? `••${last4}` : ''].filter(Boolean).join(' ') || 'Unknown bank')}</span>
                <span class="row-value">${esc(account.name)}</span></div></button>`;
            }).join('')}
          </div>
          <div class="section-footer">Messages from these go to the account shown.</div>
        </div>` : ''}
        <div class="section">
          <div class="list">
            <button class="row tap destructive center" data-forget-all><div class="row-main"><span class="row-title">Forget Everything Learned</span></div></button>
          </div>
        </div>`;
    },
  });

  page.content.addEventListener('click', async e => {
    const payeeRow = e.target.closest('[data-key]');
    const acctRow = e.target.closest('[data-acct]');
    if (payeeRow) {
      const key = payeeRow.dataset.key;
      const p = store.state.sms.payees[key];
      if (!p) return;
      const mode = S.payeeMode(p);
      const choice = await actionSheet({
        title: p.note || p.name,
        actions: [
          { text: 'Add Automatically', value: 'auto', checked: mode === 'auto' },
          { text: 'Ask Me Each Time', value: 'ask', checked: mode === 'ask' },
          { text: 'Always Ignore', value: 'ignore', checked: mode === 'ignore' },
          { text: 'Change Category…', value: 'category' },
          { text: 'Forget', value: 'forget', style: 'destructive' },
        ],
      });
      if (choice === 'forget') store.forgetPayee(key);
      else if (choice === 'category') {
        const cats = store.categories(p.type || 'expense');
        const picked = await actionSheet({
          title: 'Category',
          actions: cats.map(c => ({ text: c.name, value: c.id, icon: c.icon, checked: c.id === p.categoryId })),
        });
        if (picked) store.setPayeeCategory(key, picked);
      } else if (choice) {
        store.setPayeeMode(key, choice);
      }
    } else if (acctRow) {
      const choice = await actionSheet({ actions: [{ text: 'Forget This Card or Account', value: 'forget', style: 'destructive' }] });
      if (choice === 'forget') {
        delete store.state.sms.accounts[acctRow.dataset.acct];
        store.commit();
      }
    } else if (e.target.closest('[data-forget-all]')) {
      const ok = await alert({
        title: 'Forget everything learned?',
        message: 'Payees and cards go back to being guessed. Your transactions stay as they are.',
        buttons: [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'Forget', value: true, style: 'destructive' }],
      });
      if (ok) store.forgetAllLearning();
    }
  });
  unsubscribe = store.subscribe(() => page.refresh());
}

// ---------- Website on iPhone: a Shortcuts automation sends each bank message here

export function openIphoneSetup() {
  const link = `${location.origin}${location.pathname}#sms=`;
  const page = pushPage({
    title: 'iPhone Automation',
    render: content => {
      content.innerHTML = `
        <div class="section">
          <div class="section-header">Send each bank message to Expenses</div>
          <div class="card steps">
            <ol>
              <li>Open the <b>Shortcuts</b> app → <b>Automation</b> → <b>+</b> → <b>Message</b>.</li>
              <li>Set <b>Message Contains</b> to <b>debited</b>, choose <b>Run Immediately</b>, then <b>Next</b> → <b>New Blank Automation</b>.</li>
              <li>Add the action <b>URL Encode</b>, and set what it encodes to the message’s <b>Content</b>.</li>
              <li>Add the action <b>Open URLs</b>. Paste the link below, then right after it insert <b>URL Encoded Text</b>.</li>
              <li>Make a second automation the same way for <b>credited</b>, so money coming in is caught too.</li>
            </ol>
          </div>
        </div>
        <div class="section">
          <div class="list">
            <div class="row"><div class="row-main"><span class="row-title" style="flex:1;font-size:15px;overflow-wrap:anywhere;white-space:normal">${esc(link)}</span></div></div>
            <button class="row tap" data-copy><div class="row-main"><span class="row-title" style="flex:1;color:var(--blue)">Copy Link</span>${icon('copy')}</div></button>
          </div>
          <div class="section-footer">Each bank message then opens Expenses and is added (or listed for a quick check). Use Expenses in <b>Safari</b> for this — iPhone keeps a Home Screen app’s data separate from Safari’s. On Android, the Expenses app reads bank messages by itself.</div>
        </div>`;
    },
  });
  page.content.addEventListener('click', async e => {
    if (!e.target.closest('[data-copy]')) return;
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied', { iconName: 'check-circle' });
    } catch {
      alert({ title: 'Copy the link', message: link });
    }
  });
}
