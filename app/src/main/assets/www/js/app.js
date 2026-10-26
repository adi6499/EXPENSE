// Starts the app: loads data, wires the tabs, back button, dark mode, app lock and shortcuts.
import { store } from './store.js';
import { native } from './native.js';
import * as L from './logic.js';
import { $, $$, esc, icon, closeTopLayer, bindNavbar, haptic, toast } from './ui.js';
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

// ---------- App lock

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

// ---------- Start

function boot() {
  const insets = native.insets();
  const testInsets = new URLSearchParams(location.search).get('insets'); // e.g. ?insets=28,20 to preview phone bars in a browser
  if (testInsets) {
    const [top, bottom] = testInsets.split(',').map(Number);
    setInsets(top || 0, bottom || 0);
  } else {
    setInsets(insets.top, insets.bottom);
  }

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
    settings: createSettings($('#settings'), { applyTheme }),
  };

  store.subscribe(renderAll);
  $$('.tab').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.tab !== activeTab) haptic('selection');
    goTo(b.dataset.tab);
  }));
  $('#add-btn').addEventListener('click', () => addNew());
  $$('.tab-page').forEach(bindNavbar);
  renderAll();

  native.ready();

  if (!store.state.settings.onboarded) {
    showOnboarding(() => renderAll());
  } else {
    lock();
    const action = native.consumeLaunchAction();
    if (action === 'add' && !lockEl) setTimeout(() => addNew(), 300);
  }

  if (store.saveFailed) toast('Couldn’t save to this phone’s storage', { iconName: 'warning-circle' });
}

try {
  boot();
} catch (err) {
  // Never leave a blank screen: show what went wrong so it can be reported
  console.error(err);
  document.body.innerHTML = `<div class="empty" style="padding-top:30vh">${icon('warning-circle')}<strong>Something went wrong</strong>${esc(err && err.message || err)}</div>`;
  native.ready();
}
