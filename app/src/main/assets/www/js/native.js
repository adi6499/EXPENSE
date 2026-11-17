// Talks to the Android app (window.Native, see NativeBridge.kt). In a normal browser the same
// calls fall back to web features, so the whole app can be tested on a computer.

const bridge = typeof window !== 'undefined' ? window.Native : undefined;
export const WEB_STORAGE_KEY = 'expenses-app-data';
const pending = new Map();
let nextId = 0;

window.__native = {
  resolve(id, payload) {
    const done = pending.get(id);
    if (!done) return;
    pending.delete(id);
    done(payload || {});
  },
};

function request(method, ...args) {
  return new Promise(resolve => {
    const id = `r${++nextId}`;
    pending.set(id, resolve);
    try {
      bridge[method](id, ...args);
    } catch (err) {
      pending.delete(id);
      resolve({ ok: false, error: String(err && err.message || err) });
    }
  });
}

function download(fileName, mimeType, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const native = {
  isApp: !!bridge,

  ready() {
    if (bridge) bridge.ready();
  },

  consumeLaunchAction() {
    if (bridge) return bridge.consumeLaunchAction();
    const params = new URLSearchParams(location.search);
    return params.get('action') || '';
  },

  insets() {
    if (!bridge) return { top: 0, bottom: 0 };
    try { return JSON.parse(bridge.getInsets()); } catch { return { top: 0, bottom: 0 }; }
  },

  appVersion() {
    return bridge ? bridge.appVersion() : 'web';
  },

  load() {
    if (bridge) return bridge.loadData();
    try { return localStorage.getItem(WEB_STORAGE_KEY) || ''; } catch { return ''; }
  },

  save(json) {
    if (bridge) return bridge.saveData(json);
    try { localStorage.setItem(WEB_STORAGE_KEY, json); return true; } catch { return false; }
  },

  /** Asks where to save the file. Resolves { ok, cancelled?, error? }. */
  saveFile(fileName, mimeType, text) {
    if (bridge) return request('saveFile', fileName, mimeType, text);
    download(fileName, mimeType, text);
    return Promise.resolve({ ok: true });
  },

  /** Opens the share sheet with the file attached. */
  async shareFile(fileName, mimeType, text) {
    if (bridge) return request('shareFile', fileName, mimeType, text);
    try {
      const file = new File([text], fileName, { type: mimeType });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName });
        return { ok: true };
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return { ok: false, cancelled: true };
    }
    download(fileName, mimeType, text);
    return { ok: true };
  },

  /** Lets the person pick a file. Resolves { ok, text, name }. */
  openFile() {
    if (bridge) return request('openFile');
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,.json,.txt,text/csv,application/json';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve({ ok: false, cancelled: true });
        resolve({ ok: true, text: await file.text(), name: file.name });
      };
      input.click();
    });
  },

  canLock() {
    return bridge ? bridge.canLock() : false;
  },

  authenticate(title) {
    if (bridge) return request('authenticate', title);
    return Promise.resolve({ ok: true });
  },

  haptic(kind = 'light') {
    if (bridge) {
      try { bridge.haptic(kind); } catch { /* haptics are a nicety */ }
    }
  },

  isSystemDark() {
    if (bridge) return bridge.isSystemDark();
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  },

  setAppearance(dark) {
    if (bridge) bridge.setAppearance(dark);
  },

  setReminder(enabled, hour, minute) {
    if (bridge) return request('setReminder', enabled, hour, minute);
    return Promise.resolve({ ok: true });
  },

  // ---- Bank text messages (Android only)

  /** True when this phone can read text messages (the website and older app versions can't). */
  canReadSms() {
    return !!(bridge && bridge.smsStatus && bridge.smsStatus() !== 'unavailable');
  },

  /** 'granted' | 'denied' | 'unavailable' */
  smsStatus() {
    if (!bridge || !bridge.smsStatus) return 'unavailable';
    return bridge.smsStatus();
  },

  /** Shows Android's "Allow Expenses to read SMS?" Resolves { ok, blocked }. */
  requestSms() {
    if (bridge && bridge.requestSms) return request('requestSms');
    return Promise.resolve({ ok: false });
  },

  /** Text messages newer than since (ms). Resolves { ok, messages: [{ id, address, body, date }] }. */
  readSms(since) {
    if (bridge && bridge.readSms) return request('readSms', String(Math.max(0, Math.floor(since || 0))));
    return Promise.resolve({ ok: false, messages: [] });
  },

  /** Tells the phone whether to show a notification when a bank message arrives. */
  setSmsOptions(enabled, notify) {
    if (bridge && bridge.setSmsOptions) {
      try { bridge.setSmsOptions(!!enabled, !!notify); } catch { /* older app */ }
    }
  },

  /** Android 13+: asks to allow notifications. Resolves { ok }. */
  requestNotifications() {
    if (bridge && bridge.requestNotifications) return request('requestNotifications');
    return Promise.resolve({ ok: true });
  },

  /** Opens this app's page in the phone's Settings (to turn a permission back on). */
  openAppSettings() {
    if (bridge && bridge.openAppSettings) bridge.openAppSettings();
  },

  /** Text shared to the app from another app (e.g. a bank message from Messages), once. */
  consumeSharedText() {
    if (bridge && bridge.consumeSharedText) return bridge.consumeSharedText();
    return '';
  },

  // ---- Speaking a transaction

  canListen() {
    if (bridge) return !!(bridge.canListen && bridge.canListen());
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },

  /** Listens once. Resolves { ok, text } or { ok: false, error }. */
  listen() {
    if (bridge && bridge.listen) return request('listen');
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return Promise.resolve({ ok: false, error: 'This browser can’t listen' });
    return new Promise(resolve => {
      const r = new Recognition();
      r.lang = 'en-IN';
      r.interimResults = false;
      r.maxAlternatives = 1;
      let settled = false;
      const finish = result => { if (!settled) { settled = true; resolve(result); } };
      r.onresult = e => finish({ ok: true, text: e.results[0][0].transcript });
      r.onerror = e => finish({ ok: false, error: e.error === 'not-allowed' ? 'Allow the microphone to speak a transaction' : '' });
      r.onend = () => finish({ ok: false, error: '' });
      r.start();
    });
  },

  // ---- Bill photos: a JPEG per transaction (Android: app storage; website: IndexedDB)

  /** Lets the person take or pick a photo. Resolves { ok, dataUrl } (a smaller JPEG). */
  pickPhoto() {
    if (bridge && bridge.pickPhoto) return request('pickPhoto');
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve({ ok: false });
        try {
          resolve({ ok: true, dataUrl: await shrinkImage(file) });
        } catch {
          resolve({ ok: false, error: 'Couldn’t open that picture' });
        }
      };
      input.click();
    });
  },

  async savePhoto(id, dataUrl) {
    if (bridge && bridge.savePhoto) {
      try { return bridge.savePhoto(id, dataUrl.split(',')[1]); } catch { return false; }
    }
    try {
      const blob = dataUrlToBlob(dataUrl);
      await photoStore('readwrite', s => s.put(blob, id));
      return true;
    } catch {
      return false;
    }
  },

  /** A URL an <img> can show, or '' when there is no photo. */
  async photoUrl(id) {
    if (bridge && bridge.savePhoto) return `https://appassets.androidplatform.net/photos/${encodeURIComponent(id)}.jpg?t=${Date.now()}`;
    try {
      const blob = await photoStore('readonly', s => s.get(id));
      return blob ? URL.createObjectURL(blob) : '';
    } catch {
      return '';
    }
  },

  deletePhoto(id) {
    if (bridge && bridge.deletePhoto) { try { bridge.deletePhoto(id); } catch { /* nothing to delete */ } return; }
    photoStore('readwrite', s => s.delete(id)).catch(() => {});
  },

  /** Removes photos whose transaction is gone (deleted, or replaced by a restore). */
  cleanPhotos(keepIds) {
    if (bridge && bridge.cleanPhotos) { try { bridge.cleanPhotos(JSON.stringify(keepIds)); } catch { /* best effort */ } }
  },

  // ---- Pictures and reminders

  /** Shares or saves a PNG made in the app (the monthly summary). how: 'share' | 'save'. */
  async sendImage(how, fileName, dataUrl) {
    const base64 = dataUrl.split(',')[1];
    if (bridge && bridge.shareBase64) {
      return request(how === 'share' ? 'shareBase64' : 'saveBase64', fileName, 'image/png', base64);
    }
    const blob = dataUrlToBlob(dataUrl);
    const file = new File([blob], fileName, { type: 'image/png' });
    if (how === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: fileName }); return { ok: true }; } catch (err) {
        if (err && err.name === 'AbortError') return { ok: false, cancelled: true };
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true };
  },

  /** Bill reminders as notifications: [{ id, title, text, at (ms) }]. Android only. */
  setBillReminders(list) {
    if (bridge && bridge.setBillReminders) { try { bridge.setBillReminders(JSON.stringify(list)); } catch { /* older app */ } }
  },

  /** The home-screen widget's numbers. Android only. */
  updateWidget(today, month, line, zero) {
    if (bridge && bridge.updateWidget) { try { bridge.updateWidget(today, month, line, zero); } catch { /* older app */ } }
  },

  // ---- Scanning a bill (Android: the phone reads the text on the photo)

  canScan() {
    return !!(bridge && bridge.scanBill);
  },

  /** Takes or picks a photo of a bill. Resolves { ok, text, dataUrl }. */
  scanBill() {
    if (bridge && bridge.scanBill) return request('scanBill');
    return Promise.resolve({ ok: false, error: 'Scanning bills works in the Android app' });
  },

  /** A photo as a data URL (for reports), or ''. */
  async photoDataUrl(id) {
    try {
      let blob;
      if (bridge && bridge.savePhoto) blob = await (await fetch(await this.photoUrl(id))).blob();
      else blob = await photoStore('readonly', s => s.get(id));
      if (!blob) return '';
      return await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  },

  /** Shares a picture with a message (WhatsApp shows both). Resolves { ok, cancelled? }. */
  async sendImageWithText(fileName, dataUrl, text) {
    if (bridge && bridge.shareImageText) return request('shareImageText', fileName, dataUrl.split(',')[1], text);
    const file = new File([dataUrlToBlob(dataUrl)], fileName, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text }); return { ok: true }; } catch (err) {
        if (err && err.name === 'AbortError') return { ok: false, cancelled: true };
      }
    }
    // A computer: save the picture and open WhatsApp with the message
    await this.sendImage('save', fileName, dataUrl);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    return { ok: true };
  },

  /** Prints a page, which can be saved as a PDF. Resolves { ok }. */
  printHtml(html, title) {
    if (bridge && bridge.printHtml) return request('printHtml', html, title);
    return new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0';
      frame.srcdoc = html;
      frame.onload = () => {
        setTimeout(() => {
          try { frame.contentWindow.print(); resolve({ ok: true }); } catch { resolve({ ok: false, error: 'This browser can’t print' }); }
          setTimeout(() => frame.remove(), 60000);
        }, 300);
      };
      document.body.appendChild(frame);
    });
  },

  // ---- Daily backup to a folder (Android)

  canBackupToFolder() {
    return !!(bridge && bridge.pickBackupFolder);
  },

  /** Lets the person choose a folder for daily backups. Resolves { ok, name }. */
  pickBackupFolder() {
    if (bridge && bridge.pickBackupFolder) return request('pickBackupFolder');
    return Promise.resolve({ ok: false });
  },

  /** Writes today's backup file there (keeps the last 7). Resolves { ok, error? }. */
  writeBackup(fileName, text) {
    if (bridge && bridge.writeBackup) return request('writeBackup', fileName, text);
    return Promise.resolve({ ok: false });
  },
};

/** Makes a photo small enough to keep: longest side 1600 px, JPEG. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

let photoDb = null;
function photoStore(mode, run) {
  if (!photoDb) {
    photoDb = new Promise((resolve, reject) => {
      const open = indexedDB.open('expenses-photos', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('photos');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  return photoDb.then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode);
    const req = run(tx.objectStore('photos'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  }));
}

/** data:image/…;base64,… → Blob (fetch() can't read data: URLs under the site's security policy). */
function dataUrlToBlob(dataUrl) {
  const [head, data] = dataUrl.split(',');
  const type = (head.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bytes = atob(data);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type });
}
