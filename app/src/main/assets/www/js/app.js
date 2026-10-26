// Starts the app: loads data, wires the tabs, back button, dark mode, app lock and shortcuts.
// The same code runs inside the Android app and as a website; web-only parts check native.isApp.
import { store } from './store.js';
import { native, WEB_STORAGE_KEY } from './native.js';
import * as L from './logic.js';
import { $, $$, esc, icon, closeTopLayer, bindNavbar, haptic, toast, hasLayers, onLayersChange } from './ui.js';
import { openEditor } from './editor.js';
import { createHome } from './home.js';
import { createActivity } from './activity.js';
import { createInsights } from './insights.js';
import { createSettings } from './settings.js';
import { openBudgets } from './manage.js';
import { showOnboarding } from './onboarding.js';

const TAB_ICONS = { home: 'house', activity: 'list-bullets', insights: 'chart-pie-slice', settings: 'gear-six' };
const LOCK_AFTER_MS = 60_000;

let activeTab = 'home';
let screens = {};
const dirty = new Set();
let lastDay = L.todayISO();

function setInsets(top, bottom) {
  const root = document.documentElement.style;
  root.setProperty('--safe-top', `${Math.round(top)}px`);
  root.setProperty('--safe-bottom', `${Math.round(bottom)}px`);
}
window.__setInsets = setInsets;

function applyTheme() {
  const mode = store.state.settings.appearance;
  const dark = mode === 'dark' || (mode === 'auto' && native.isSystemDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  native.setAppearance(dark);
  const themeColor = $('#theme-color');
  if (themeColor) themeColor.content = dark ? '#000000' : '#f2f2f7';
}
window.__onSystemTheme = applyTheme;

function goTo(tab) {
  if (tab === activeTab) {
    // Tapping the current tab again scrolls back to the top, like iOS
    $(`.tab-page[data-tab="${tab}"] .scroller`).scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  activeTab = tab;
  $$('.tab-page').forEach(p => p.classList.toggle('active', p.dataset.tab === tab));
  $$('.tab').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    $('i', b).className = `${on ? 'ph-fill' : 'ph'} ph-${TAB_ICONS[b.dataset.tab]}`;
  });
  if (dirty.has(tab)) {
    dirty.delete(tab);
    screens[tab].render();
  }
  syncHistory();
}

function renderAll() {
  $('#home-date').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  screens[activeTab].render();
  for (const name of Object.keys(screens)) if (name !== activeTab) dirty.add(name);
}

let lastAddTap = 0;
function addNew(preset) {
  if (Date.now() - lastAddTap < 600) return; // ignore double taps
  lastAddTap = Date.now();
  haptic('light');
  openEditor(null, preset);
}

// ---------- App lock (Android only: the website has no fingerprint check)

let lockEl = null;
let hiddenAt = 0;

function lockEnabled() {
  return store.state.settings.lock && native.canLock();
}

function lock() {
  if (lockEl || !lockEnabled()) return;
  lockEl = document.createElement('div');
  lockEl.className = 'lock';
  lockEl.innerHTML = `
    ${icon('lock-simple', true).replace('<i ', '<i style="font-size:56px;color:var(--blue)" ')}
    <h2>Expenses is locked</h2>
    <p>Use your fingerprint, face or phone PIN.</p>
    <button class="btn">Unlock</button>`;
  document.body.appendChild(lockEl);
  $('.btn', lockEl).addEventListener('click', unlock);
  setTimeout(unlock, 250);
}

let unlocking = false;
async function unlock() {
  if (unlocking || !lockEl) return;
  unlocking = true;
  const result = await native.authenticate('Unlock Expenses');
  unlocking = false;
  if (result.ok && lockEl) {
    lockEl.remove();
    lockEl = null;
  }
}

window.__onPause = () => {
  hiddenAt = Date.now();
};

window.__onResume = () => {
  if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) lock();
  hiddenAt = 0;
  // A new day: add repeating transactions that came due and refresh "Today"
  const today = L.todayISO();
  if (today !== lastDay) {
    lastDay = today;
    if (!store.applyRecurring()) renderAll();
  }
};

window.__onBack = () => {
  if (lockEl) return false;
  if (closeTopLayer()) return true;
  if (activeTab !== 'home') {
    goTo('home');
    return true;
  }
  return false;
};

window.__onAction = action => {
  if (action === 'add' && store.state.settings.onboarded && !lockEl) addNew();
};

// ---------- Website: the browser's back button
// While a panel is open or another tab is showing, one extra history entry exists, so Back
// closes the panel (or returns to Summary) instead of leaving the site.

let historyArmed = false;
let ignoreNextPop = false;

function syncHistory() {
  if (native.isApp || ignoreNextPop) return;
  const wantEntry = hasLayers() || activeTab !== 'home';
  if (wantEntry && !historyArmed) {
    history.pushState({ expenses: true }, '');
    historyArmed = true;
  } else if (!wantEntry && historyArmed) {
    historyArmed = false;
    ignoreNextPop = true;
    history.back();
  }
}

function onPopState() {
  if (ignoreNextPop) {
    ignoreNextPop = false;
    syncHistory();
    return;
  }
  historyArmed = false;
  window.__onBack();
  syncHistory();
}

// ---------- Website: install button, offline, keyboard

let installEvent = null;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const webInstall = {
  canShow: () => !native.isApp && !isStandalone(),
  async prompt() {
    if (installEvent) {
      installEvent.prompt();
      const choice = await installEvent.userChoice.catch(() => null);
      installEvent = null;
      return choice && choice.outcome === 'accepted' ? 'installed' : 'dismissed';
    }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return ios ? 'ios' : 'manual';
  },
};

function setUpWebsite() {
  fixIphoneHeight();
  // A reload while a panel was open leaves us on our extra entry: treat it as the base again
  if (history.state && history.state.expenses) history.replaceState(null, '');
  window.addEventListener('popstate', onPopState);
  onLayersChange(syncHistory);

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvent = e;
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    toast('Installed — find Expenses with your other apps', { iconName: 'check-circle' });
    dirty.add('settings');
  });

  // Another tab of the site changed the data: show the same thing here
  window.addEventListener('storage', e => {
    if (e.key !== WEB_STORAGE_KEY) return;
    store.reload();
    applyTheme();
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Offline support unavailable:', err));
  }

  // The launcher shortcut opens ?action=add: tidy the address so a reload doesn't add again
  if (location.search.includes('action=')) history.replaceState(null, '', location.pathname);
}

/**
 * iPhone home-screen apps that draw under the status bar are sometimes laid out shorter than the
 * screen by the status bar's height, leaving a black strip under the tab bar. Measure the strip and
 * let the CSS stretch the full-screen layers over it (--ios-gap).
 */
function fixIphoneHeight() {
  if (!/iPhone|iPod/.test(navigator.userAgent) || !isStandalone()) return;
  const update = () => {
    const portrait = window.innerHeight >= window.innerWidth;
    const screenHeight = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const gap = screenHeight - document.documentElement.clientHeight;
    document.documentElement.style.setProperty('--ios-gap', gap > 0 && gap <= 100 ? `${gap}px` : '0px');
  };
  update();
  window.addEventListener('resize', update);
}

/** Asks the browser to keep the data even when the device is short of space (best effort). */
function askToKeepData() {
  if (!native.isApp && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!lockEl && closeTopLayer()) e.preventDefault();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]')) return;
  // "N" (or +) adds a transaction from anywhere, like a desktop app
  if ((e.key === 'n' || e.key === 'N' || e.key === '+') && !hasLayers() && !lockEl && store.state.settings.onboarded && !$('.onboard')) {
    e.preventDefault();
    addNew();
  }
});

// ---------- Start

function boot() {
  const testInsets = new URLSearchParams(location.search).get('insets'); // e.g. ?insets=28,20 to preview phone bars in a browser
  if (testInsets) {
    const [top, bottom] = testInsets.split(',').map(Number);
    setInsets(top || 0, bottom || 0);
  } else if (native.isApp) {
    const insets = native.insets();
    setInsets(insets.top, insets.bottom);
  }
  // Otherwise CSS uses the browser's own safe-area values (iPhone notch, home bar)

  store.load();
  applyTheme();
  if (!native.isApp && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  }

  const activity = createActivity($('#activity'), { openEditor, filterButton: $('#activity-filter') });
  screens = {
    home: createHome($('#home'), { openEditor: (tx, preset) => (tx ? openEditor(tx) : addNew(preset)), goTo, openBudgets }),
    activity,
    insights: createInsights($('#insights'), {
      openEditor,
      showActivity: options => {
        goTo('activity');
        activity.show(options);
      },
    }),
    settings: createSettings($('#settings'), { applyTheme, webInstall }),
  };

  store.subscribe(renderAll);
  $$('.tab').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.tab !== activeTab) haptic('selection');
    goTo(b.dataset.tab);
  }));
  $('#add-btn').addEventListener('click', () => addNew());
  $$('.tab-page').forEach(bindNavbar);
  renderAll();

  const launchAction = native.consumeLaunchAction();
  if (!native.isApp) setUpWebsite();
  native.ready();

  if (!store.state.settings.onboarded) {
    showOnboarding(() => {
      renderAll();
      askToKeepData();
    });
  } else {
    lock();
    if (launchAction === 'add' && !lockEl) setTimeout(() => addNew(), 300);
    if (store.state.transactions.length) askToKeepData();
  }

  if (store.saveFailed) toast(native.isApp ? 'Couldn’t save to this phone’s storage' : 'This browser isn’t letting the site save data', { iconName: 'warning-circle' });
}

try {
  boot();
} catch (err) {
  // Never leave a blank screen: show what went wrong so it can be reported
  console.error(err);
  document.body.innerHTML = `<div class="empty" style="padding-top:30vh">${icon('warning-circle')}<strong>Something went wrong</strong>${esc(err && err.message || err)}</div>`;
  native.ready();
}
