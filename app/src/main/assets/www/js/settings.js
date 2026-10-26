// The Settings tab, plus export, backup, restore and import.
import { store, parseBackup } from './store.js';
import { native } from './native.js';
import * as L from './logic.js';
import { $, $$, esc, icon, tile, alert, actionSheet, openFormSheet, segmented, bindSegmented, haptic, toast } from './ui.js';
import { openCategories, openAccounts, openBudgets, openRepeating, openCurrency, openAppearance } from './manage.js';

const APPEARANCE_LABELS = { auto: 'Automatic', light: 'Light', dark: 'Dark' };

function timeLabel(hour, minute) {
  const d = new Date(2000, 0, 1, hour, minute);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function row({ id, iconName, color, title, value = '', chevron = true, control = '' }) {
  return `<button class="row tap" data-go="${id}">${tile(iconName, color)}
    <div class="row-main"><span class="row-title" style="flex:1">${esc(title)}</span>
    ${value ? `<span class="row-value">${esc(value)}</span>` : ''}${control}${chevron ? `<i class="ph ph-caret-right row-chevron"></i>` : ''}</div></button>`;
}

function switchRow({ id, iconName, color, title, checked, disabled = false }) {
  return `<label class="row">${tile(iconName, color)}
    <div class="row-main"><span class="row-title" style="flex:1">${esc(title)}</span>
    <span class="switch"><input type="checkbox" data-switch="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span></span></span></div></label>`;
}

export function createSettings(root, { applyTheme }) {
  function render() {
    const st = store.state;
    const s = st.settings;
    const currency = L.currencyInfo(s.currency);
    const canLock = native.canLock();
    root.innerHTML = `
      <div class="card banner" style="margin-top:4px">
        <span class="app-icon" style="width:60px;height:60px;border-radius:14px;margin:0;box-shadow:none">${appGlyph()}</span>
        <div class="banner-text"><strong>Expenses</strong>${st.transactions.length} transaction${st.transactions.length === 1 ? '' : 's'} · saved only on this phone</div>
      </div>

      <div class="section">
        <div class="section-header">Plan</div>
        <div class="list">
          ${row({ id: 'budgets', iconName: 'target', color: 'red', title: 'Budgets', value: st.budgets.monthly ? store.money(st.budgets.monthly) : 'Off' })}
          ${row({ id: 'repeating', iconName: 'repeat', color: 'indigo', title: 'Repeating', value: st.recurring.length ? String(st.recurring.length) : '' })}
        </div>
      </div>

      <div class="section">
        <div class="section-header">Organise</div>
        <div class="list">
          ${row({ id: 'categories', iconName: 'squares-four', color: 'orange', title: 'Categories', value: String(st.categories.length) })}
          ${row({ id: 'accounts', iconName: 'wallet', color: 'green', title: 'Accounts', value: String(st.accounts.length) })}
        </div>
      </div>

      <div class="section">
        <div class="section-header">Preferences</div>
        <div class="list">
          ${row({ id: 'currency', iconName: 'coins', color: 'yellow', title: 'Currency', value: `${currency.code} ${currency.symbol}` })}
          ${row({ id: 'appearance', iconName: 'circle-half', color: 'blue', title: 'Appearance', value: APPEARANCE_LABELS[s.appearance] })}
          ${switchRow({ id: 'lock', iconName: 'fingerprint', color: 'gray', title: 'App Lock', checked: s.lock && canLock, disabled: !canLock && !s.lock })}
          ${switchRow({ id: 'reminder', iconName: 'bell', color: 'red', title: 'Daily Reminder', checked: s.reminder.enabled })}
          ${s.reminder.enabled ? row({ id: 'reminder-time', iconName: 'clock-counter-clockwise', color: 'pink', title: 'Remind me at', value: timeLabel(s.reminder.hour, s.reminder.minute) }) : ''}
        </div>
        <div class="section-footer">${canLock ? 'App Lock asks for your fingerprint, face or phone PIN when you open the app.' : 'To use App Lock, first set a screen lock (PIN or fingerprint) in your phone’s settings.'}</div>
      </div>

      <div class="section">
        <div class="section-header">Your data</div>
        <div class="list">
          ${row({ id: 'export', iconName: 'file-csv', color: 'green', title: 'Export to Excel (CSV)' })}
          ${row({ id: 'backup', iconName: 'upload-simple', color: 'blue', title: 'Back Up' })}
          ${row({ id: 'restore', iconName: 'download-simple', color: 'teal', title: 'Restore from Backup' })}
          ${row({ id: 'import', iconName: 'tray', color: 'purple', title: 'Import from CSV' })}
        </div>
        <div class="section-footer">Everything stays on this phone — no account, no internet needed. Save a backup now and then (to Google Drive or WhatsApp) so you never lose it. Import works with the CSV from the old Google Sheet tracker and most bank statements.</div>
      </div>

      <div class="section">
        <div class="list">
          <button class="row tap destructive center" data-go="erase"><div class="row-main"><span class="row-title">Erase All Data</span></div></button>
        </div>
        <div class="section-footer" style="text-align:center">Expenses ${esc(native.appVersion())}</div>
      </div>`;
  }

  root.addEventListener('click', e => {
    const target = e.target.closest('[data-go]');
    if (!target) return;
    const go = target.dataset.go;
    const actions = {
      budgets: openBudgets,
      repeating: openRepeating,
      categories: openCategories,
      accounts: openAccounts,
      currency: openCurrency,
      appearance: () => openAppearance(applyTheme),
      'reminder-time': pickReminderTime,
      export: exportCSV,
      backup: backUp,
      restore: restore,
      import: importCSV,
      erase: eraseAll,
    };
    if (actions[go]) actions[go]();
  });

  root.addEventListener('change', async e => {
    const input = e.target.closest('[data-switch]');
    if (!input) return;
    haptic('selection');
    if (input.dataset.switch === 'lock') {
      if (input.checked) {
        // Prove it works before turning it on, so nobody locks themselves out
        const result = await native.authenticate('Turn on App Lock');
        if (!result.ok) {
          input.checked = false;
          if (result.error) toast(result.error, { iconName: 'warning-circle' });
          return;
        }
      }
      store.setSetting('lock', input.checked);
    } else if (input.dataset.switch === 'reminder') {
      const reminder = { ...store.state.settings.reminder, enabled: input.checked };
      const result = await native.setReminder(reminder.enabled, reminder.hour, reminder.minute);
      if (reminder.enabled && !result.ok) {
        input.checked = false;
        reminder.enabled = false;
        await native.setReminder(false, reminder.hour, reminder.minute);
        alert({ title: 'Notifications are off', message: 'Allow notifications for Expenses in your phone’s settings to get the daily reminder.' });
      } else if (reminder.enabled) {
        toast(`Reminder set for ${timeLabel(reminder.hour, reminder.minute)} every day`, { iconName: 'bell' });
      }
      store.setSetting('reminder', reminder);
    }
  });

  async function pickReminderTime() {
    const times = [[8, 0], [12, 0], [14, 0], [18, 0], [20, 0], [21, 0], [22, 0], [23, 0]];
    const current = store.state.settings.reminder;
    const choice = await actionSheet({
      title: 'Remind me at',
      actions: times.map(([h, m]) => ({ text: timeLabel(h, m), value: `${h}:${m}`, checked: h === current.hour && m === current.minute })),
    });
    if (!choice) return;
    const [hour, minute] = choice.split(':').map(Number);
    const reminder = { ...current, hour, minute };
    await native.setReminder(reminder.enabled, hour, minute);
    store.setSetting('reminder', reminder);
  }

  return { render };
}

export function appGlyph() {
  return `<svg viewBox="0 0 108 108" aria-hidden="true">
    <path fill="#fff" fill-opacity=".6" d="M40,31h28a5,5 0 0 1 5,5v8h-38v-8a5,5 0 0 1 5,-5z"/>
    <path fill="#fff" d="M37,40h34a9,9 0 0 1 9,9v18a9,9 0 0 1 -9,9h-34a9,9 0 0 1 -9,-9v-18a9,9 0 0 1 9,-9z"/>
    <path fill="#3E7CF0" d="M65,51h15v14h-15a7,7 0 0 1 -7,-7a7,7 0 0 1 7,-7z"/>
    <circle fill="#fff" cx="66" cy="58" r="3"/>
  </svg>`;
}

// ---------- Export / backup / restore / import

const stamp = () => L.todayISO();

async function deliver(fileName, mimeType, text, what) {
  const choice = await actionSheet({
    title: what,
    actions: [
      { text: 'Share…', value: 'share', icon: 'export' },
      { text: 'Save to Phone…', value: 'save', icon: 'download-simple' },
    ],
  });
  if (!choice) return;
  const result = choice === 'share'
    ? await native.shareFile(fileName, mimeType, text)
    : await native.saveFile(fileName, mimeType, text);
  if (result.ok && choice === 'save') toast('Saved', { iconName: 'check-circle' });
  else if (!result.ok && !result.cancelled) alert({ title: 'Couldn’t save the file', message: result.error || 'Please try again.' });
}

function exportCSV() {
  if (!store.state.transactions.length) {
    alert({ title: 'Nothing to export yet', message: 'Add some transactions first.' });
    return;
  }
  deliver(`expenses-${stamp()}.csv`, 'text/csv', L.exportCSV(store.state), `Export ${store.state.transactions.length} transactions`);
}

function backUp() {
  deliver(`expenses-backup-${stamp()}.json`, 'application/json', store.backupJSON(), 'Back up all your data');
}

export async function restore() {
  const file = await native.openFile();
  if (!file.ok) {
    if (!file.cancelled) alert({ title: 'Couldn’t open the file', message: file.error || '' });
    return false;
  }
  return restoreFromText(file.text);
}

async function restoreFromText(text) {
  const data = parseBackup(text);
  if (!data) {
    alert({ title: 'Not a backup file', message: 'Choose a file made with "Back Up" (it ends in .json). To bring in a spreadsheet, use "Import from CSV".' });
    return false;
  }
  const ok = await alert({
    title: 'Restore this backup?',
    message: `It has ${data.transactions.length} transactions. Everything currently in the app will be replaced.`,
    buttons: [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'Restore', value: true, style: 'destructive' }],
  });
  if (!ok) return false;
  store.replaceAll(data);
  haptic('success');
  toast('Backup restored', { iconName: 'check-circle' });
  return true;
}

async function importCSV() {
  const file = await native.openFile();
  if (!file.ok) {
    if (!file.cancelled) alert({ title: 'Couldn’t open the file', message: file.error || '' });
    return;
  }
  if (/\.json$/i.test(file.name || '') || file.text.trim().startsWith('{')) {
    restoreFromText(file.text);
    return;
  }
  const rows = L.parseCSV(file.text);
  showImportPreview(rows, null);
}

function showImportPreview(rows, forcedOrder) {
  const result = L.readImportRows(rows, forcedOrder);
  if (result.error) {
    alert({ title: 'Couldn’t read this file', message: result.error });
    return;
  }
  if (!result.items.length) {
    alert({ title: 'No transactions found', message: 'The file has the right headings but no rows with a date and an amount.' });
    return;
  }
  const items = result.items;
  const t = L.totals(items);
  const dates = items.map(i => i.date).sort();
  const existing = new Set(store.state.transactions.map(L.duplicateKey));
  const duplicates = items.filter(i => existing.has(L.duplicateKey(i))).length;
  if (duplicates === items.length) {
    alert({ title: 'Already imported', message: `All ${items.length} transactions in this file are already in the app.` });
    return;
  }
  const knownCats = new Set(store.state.categories.map(c => `${c.type}|${c.name.toLowerCase()}`));
  const newCats = new Set(items.filter(i => i.categoryName && !knownCats.has(`${i.type}|${i.categoryName.toLowerCase()}`)).map(i => i.categoryName.toLowerCase()));
  const sample = items.slice(0, 4);

  const handle = openFormSheet({
    title: 'Import',
    doneText: 'Import',
    html: `
      <div class="empty" style="padding:4px 32px 18px">
        ${icon('tray', true)}
        <strong>${items.length - duplicates} transaction${items.length - duplicates === 1 ? '' : 's'} to add</strong>
        ${esc(L.shortDate(dates[0]))} – ${esc(L.shortDate(dates[dates.length - 1]))}
      </div>
      <div class="section">
        <div class="list">
          <div class="row"><div class="row-main"><span class="row-title" style="flex:1">Spending</span><span class="row-value">${esc(store.money(t.expense))}</span></div></div>
          <div class="row"><div class="row-main"><span class="row-title" style="flex:1">Income</span><span class="row-value">${esc(store.money(t.income))}</span></div></div>
          ${duplicates ? `<div class="row"><div class="row-main"><span class="row-title" style="flex:1">Already in the app (skipped)</span><span class="row-value">${duplicates}</span></div></div>` : ''}
          ${result.skipped ? `<div class="row"><div class="row-main"><span class="row-title" style="flex:1">Rows without date or amount</span><span class="row-value">${result.skipped}</span></div></div>` : ''}
          ${newCats.size ? `<div class="row"><div class="row-main"><span class="row-title" style="flex:1">New categories</span><span class="row-value">${newCats.size}</span></div></div>` : ''}
        </div>
      </div>
      ${result.orderGuessed || forcedOrder ? `
      <div class="section">
        <div class="section-header">Dates in this file are written</div>
        ${segmented([{ value: 'dmy', label: 'Day / Month' }, { value: 'mdy', label: 'Month / Day' }], result.order, 'order')}
        <div class="section-footer">Check the first rows below look right — 04/05 could be 4 May or 5 April.</div>
      </div>` : ''}
      <div class="section">
        <div class="section-header">First rows</div>
        <div class="list">
          ${sample.map(i => `<div class="row"><div class="row-main"><div class="row-text">
            <div class="row-title">${esc(i.note || i.categoryName || (i.type === 'income' ? 'Income' : 'Expense'))}</div>
            <div class="row-sub">${esc(L.dayLabel(i.date))}${i.categoryName ? ' · ' + esc(i.categoryName) : ''}${i.accountName ? ' · ' + esc(i.accountName) : ''}</div></div>
            <span class="tx-amount ${i.type}">${esc(i.type === 'income' ? store.money(i.amount, { sign: true }) : store.money(i.amount))}</span></div></div>`).join('')}
        </div>
      </div>`,
    onDone: () => {
      const { added, duplicates: skipped } = store.importItems(items);
      haptic('success');
      toast(`Imported ${added}${skipped ? ` · ${skipped} already there` : ''}`, { iconName: 'check-circle', duration: 5000 });
      return true;
    },
  });
  bindSegmented(handle.el, (name, value) => {
    if (name !== 'order') return;
    handle.close('reload');
    setTimeout(() => showImportPreview(rows, value), 380);
  });
}

async function eraseAll() {
  const ok = await alert({
    title: 'Erase all data?',
    message: 'Every transaction, category, account and budget will be deleted from this phone. Make a backup first if you might need it.',
    buttons: [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'Erase', value: true, style: 'destructive' }],
  });
  if (!ok) return;
  store.eraseAll();
  haptic('warning');
  toast('All data erased');
}
