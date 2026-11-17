// Backup and sync. (1) Android: a backup file in a folder of your choice once a day (last 7 kept).
// (2) Phone ↔ computer: your Google helper script keeps the data in your own Google Drive; each
// device pulls, merges record by record (logic.mergeStates) and pushes. Drive also keeps a dated
// backup a day (last 14), which can be restored from here.
import { store, normalizeState, parseBackup } from './store.js';
import { native } from './native.js';
import * as L from './logic.js';
import { esc, icon, tile, pushPage, actionSheet, alert, toast, haptic } from './ui.js';
import { emailConnected, openEmailSetup } from './email.js';
import { SCRIPT_VERSION } from './email-script.js';

const DAY = 86400000;
const settings = () => store.state.settings;

// ---------- Daily backup to a folder (Android)

export async function backupToFolderIfDue({ force = false } = {}) {
  const b = settings().backup;
  if (!b.folder || !native.canBackupToFolder()) return;
  if (!force && Date.now() - (b.last || 0) < 20 * 3600000) return;
  const result = await native.writeBackup(`expenses-backup-${L.todayISO()}.json`, store.backupJSON());
  if (result.ok) {
    b.last = Date.now();
    store.saveKeepingTime();
    if (force) toast('Backed up', { iconName: 'check-circle' });
  } else if (force || result.error) {
    toast(result.error || 'Couldn’t write the backup — choose the folder again', { iconName: 'warning-circle', duration: 5000 });
  }
}

export async function chooseBackupFolder() {
  const picked = await native.pickBackupFolder();
  if (!picked.ok) return false;
  Object.assign(settings().backup, { folder: picked.uri || 'chosen', folderName: picked.name || 'Folder', last: 0 });
  store.commit();
  await backupToFolderIfDue({ force: true });
  return true;
}

// ---------- Sync through the Google helper

async function getJson(params) {
  const e = settings().email;
  const query = Object.entries({ key: e.key, ...params }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  try {
    const res = await fetch(`${e.url}?${query}`, { credentials: 'omit', cache: 'no-store', redirect: 'follow' });
    return JSON.parse(await res.text());
  } catch {
    return { ok: false, error: 'network' };
  }
}

async function postJson(body) {
  const e = settings().email;
  try {
    const res = await fetch(e.url, {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // a "simple" request: no extra permission check
      body: JSON.stringify({ key: e.key, ...body }),
    });
    return JSON.parse(await res.text());
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** What has to match for two copies to be "the same" (device-only switches left out). */
function signature(state) {
  const pick = list => (list || []).map(r => `${r.id}:${r.updatedAt || r.createdAt || 0}`).sort().join(',');
  const s = { ...(state.settings || {}) };
  for (const key of ['lock', 'reminder', 'glass', 'appearance', 'backup', 'sync', 'lastAccountId', 'email']) delete s[key];
  return JSON.stringify([pick(state.transactions), pick(state.bills), pick(state.goals), pick(state.emis), pick(state.recurring),
    JSON.stringify(state.categories), JSON.stringify(state.accounts), Object.keys(state.deleted || {}).sort().join(','),
    JSON.stringify(state.budgets), JSON.stringify(s), (state.sms && state.sms.pending || []).map(p => p.id).sort().join(',')]);
}

let syncing = null;
let lastRun = 0;

/** Pulls the Drive copy, merges, and pushes if this device had anything new. */
export function syncNow({ quiet = true, force = false } = {}) {
  const s = settings().sync;
  if (!s.enabled || !emailConnected()) return Promise.resolve(null);
  if (!force && Date.now() - lastRun < 60000) return Promise.resolve(null);
  if (syncing) return syncing;
  lastRun = Date.now();
  syncing = (async () => {
    const pulled = await getJson({ action: 'pull' });
    if (!pulled.ok || pulled.version === undefined) {
      if (!quiet) problem(pulled);
      return null;
    }
    let remote = null;
    if (pulled.data) {
      try { remote = normalizeState(JSON.parse(pulled.data)); } catch { remote = null; }
    }
    let state = store.state;
    if (remote) {
      const merged = L.mergeStates(state, { ...remote, savedAt: pulled.savedAt || remote.savedAt || 0 });
      if (signature(merged) !== signature(state)) {
        store.replaceMerged(merged);
        state = store.state;
        if (!quiet) toast('Updated from your other device', { iconName: 'arrows-clockwise' });
      }
    }
    if (!remote || signature(state) !== signature(remote)) {
      state.savedAt = Date.now();
      const pushed = await postJson({ action: 'push', data: JSON.stringify(state), savedAt: state.savedAt });
      if (!pushed.ok) {
        if (!quiet) problem(pushed);
        return null;
      }
      s.lastPush = Date.now();
    }
    s.lastPull = Date.now();
    store.saveKeepingTime();
    if (!quiet) toast('In sync', { iconName: 'check-circle' });
    return true;
  })().finally(() => { syncing = null; });
  return syncing;
}

let pushTimer = null;
/** After a change here: sync a little later (several quick changes go together). */
export function scheduleSync() {
  if (!settings().sync.enabled) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow({ force: true }), 15000);
}

function problem(reply) {
  if (reply && (reply.version === undefined) && reply.ok) {
    alert({ title: 'Update your Google helper', message: 'Sync needs the newer script. Open Settings → Bank Messages → Bank Emails, copy the Settings and the Script again, paste them over the old ones, then Deploy → Manage deployments → ✏️ → Version: New version → Deploy, and allow the new permission.' });
  } else if (reply && reply.error === 'wrong-key') {
    alert({ title: 'Couldn’t sync', message: 'The script has a different key. Copy the script again and redeploy it.' });
  } else if (reply && reply.error === 'script') {
    alert({ title: 'Couldn’t sync', message: `Your Google script said: ${reply.message || 'something went wrong'}. If it mentions permission, open the script, choose “test”, press Run once and allow it.` });
  } else {
    alert({ title: 'Couldn’t sync', message: 'Couldn’t reach your Google script. Check the internet and try again.' });
  }
}

async function restoreFromDrive() {
  const listed = await getJson({ action: 'list' });
  if (!listed.ok || !listed.backups) { problem(listed); return; }
  if (!listed.backups.length) {
    alert({ title: 'No backups yet', message: 'Google Drive gets one backup a day once sync is on.' });
    return;
  }
  const choice = await actionSheet({
    title: 'Restore a Backup',
    message: 'Everything on this device is replaced with that day’s copy.',
    actions: listed.backups.slice(0, 14).map(f => ({ text: f.name.replace(/^Expenses backup |\.json$/g, ''), value: f.id, icon: 'clock-counter-clockwise' })),
  });
  if (!choice) return;
  const got = await getJson({ action: 'get', id: choice });
  const data = got.ok && got.data ? parseBackup(got.data) : null;
  if (!data) { alert({ title: 'Couldn’t read that backup' }); return; }
  const ok = await alert({
    title: 'Restore this backup?',
    message: `It has ${data.transactions.length} transactions. Everything here will be replaced.`,
    buttons: [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'Restore', value: true, style: 'destructive' }],
  });
  if (!ok) return;
  store.replaceAll(data);
  haptic('success');
  toast('Backup restored', { iconName: 'check-circle' });
}

export function backupStatusText() {
  const parts = [];
  if (settings().sync.enabled) parts.push('Sync on');
  if (settings().backup.folder) parts.push('Daily');
  return parts.join(' · ') || 'Off';
}

export function openBackupSync() {
  let unsubscribe = () => {};
  const page = pushPage({
    title: 'Backup & Sync',
    onClose: () => unsubscribe(),
    render: content => {
      const st = settings();
      const connected = emailConnected();
      const when = ms => (ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'not yet');
      content.innerHTML = `
        <div class="section" style="margin-top:12px">
          <div class="section-header">Phone and computer</div>
          <div class="list">
            ${connected
              ? `<label class="row">${tile('arrows-clockwise', 'blue')}<div class="row-main"><span class="row-title" style="flex:1">Sync with Google Drive</span>
                  <span class="switch"><input type="checkbox" data-sync ${st.sync.enabled ? 'checked' : ''}><span></span></span></div></label>
                 ${st.sync.enabled ? `<button class="row tap" data-sync-now>${tile('cloud-arrow-up', 'teal')}<div class="row-main"><span class="row-title" style="flex:1">Sync Now</span><span class="row-value">${esc(when(st.sync.lastPull))}</span></div></button>` : ''}
                 <button class="row tap" data-restore>${tile('clock-counter-clockwise', 'indigo')}<div class="row-main"><span class="row-title" style="flex:1">Restore a Google Drive Backup</span><i class="ph ph-caret-right row-chevron"></i></div></button>`
              : `<button class="row tap" data-connect>${tile('google-logo', 'blue')}<div class="row-main"><span class="row-title" style="flex:1;color:var(--blue)">Connect Your Google Account</span><i class="ph ph-caret-right row-chevron"></i></div></button>`}
          </div>
          <div class="section-footer">${connected
            ? 'Turn this on here and on your other device (the website on a computer, or another phone) with the same Google helper link: both then have the same transactions. Google Drive also keeps a dated backup a day for two weeks. Bill photos stay on the device they were taken on.'
            : 'Uses the same small script in your own Google account as Bank Emails (one-time setup, about 5 minutes). Your data goes only to your own Google Drive.'}</div>
        </div>
        ${native.canBackupToFolder() ? `
        <div class="section">
          <div class="section-header">On this phone</div>
          <div class="list">
            <button class="row tap" data-folder>${tile('folder-simple', 'orange')}<div class="row-main"><span class="row-title" style="flex:1">Daily Backup to a Folder</span><span class="row-value">${esc(st.backup.folder ? st.backup.folderName : 'Off')}</span><i class="ph ph-caret-right row-chevron"></i></div></button>
            ${st.backup.folder ? `<button class="row tap" data-backup-now>${tile('download-simple', 'green')}<div class="row-main"><span class="row-title" style="flex:1">Back Up Now</span><span class="row-value">${esc(when(st.backup.last))}</span></div></button>` : ''}
          </div>
          <div class="section-footer">A backup file goes into the folder once a day when you open Expenses; the last 7 are kept. Pick a folder that a backup app or your computer copies, so it survives losing the phone.</div>
        </div>` : ''}`;
    },
  });
  page.content.addEventListener('click', async e => {
    if (e.target.closest('[data-connect]')) openEmailSetup();
    else if (e.target.closest('[data-sync-now]')) syncNow({ quiet: false, force: true });
    else if (e.target.closest('[data-restore]')) restoreFromDrive();
    else if (e.target.closest('[data-backup-now]')) backupToFolderIfDue({ force: true });
    else if (e.target.closest('[data-folder]')) {
      const b = settings().backup;
      if (!b.folder) { chooseBackupFolder(); return; }
      const choice = await actionSheet({ title: b.folderName, actions: [{ text: 'Choose Another Folder', value: 'change', icon: 'folder-simple' }, { text: 'Turn Off', value: 'off', style: 'destructive' }] });
      if (choice === 'change') chooseBackupFolder();
      if (choice === 'off') { Object.assign(b, { folder: '', folderName: '', last: 0 }); store.commit(); }
    }
  });
  page.content.addEventListener('change', async e => {
    if (!e.target.closest('[data-sync]')) return;
    const on = e.target.checked;
    if (on) {
      const hello = await getJson({ action: 'hello' });
      if (!hello.ok || hello.version === undefined || hello.version < SCRIPT_VERSION) {
        e.target.checked = false;
        problem(hello.ok ? { ok: true } : hello);
        return;
      }
    }
    settings().sync.enabled = on;
    store.commit();
    if (on) syncNow({ quiet: false, force: true });
  });
  unsubscribe = store.subscribe(() => page.refresh());
  void DAY;
}
