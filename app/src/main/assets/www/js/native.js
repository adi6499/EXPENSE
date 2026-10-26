// Talks to the Android app (window.Native, see NativeBridge.kt). In a normal browser the same
// calls fall back to web features, so the whole app can be tested on a computer.

const bridge = typeof window !== 'undefined' ? window.Native : undefined;
const STORAGE_KEY = 'expenses-app-data';
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
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
  },

  save(json) {
    if (bridge) return bridge.saveData(json);
    try { localStorage.setItem(STORAGE_KEY, json); return true; } catch { return false; }
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
};
