// Reusable iOS-style building blocks: sheets, alerts, action sheets, pushed pages, toasts,
// swipe-to-delete rows, the number pad and the calendar.
import { native } from './native.js';
import * as L from './logic.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export const icon = (name, fill = false) => `<i class="${fill ? 'ph-fill' : 'ph'} ph-${name}" aria-hidden="true"></i>`;

/** A coloured rounded square with a white icon, like iOS Settings. */
export const tile = (iconName, color, size = '') =>
  `<span class="tile ${size}" style="--c:var(--${esc(color)})">${icon(iconName, true)}</span>`;

export const haptic = kind => native.haptic(kind);

const overlayRoot = () => $('#overlays');

// ---------- Back button: every open layer registers here, newest on top

const layers = [];
let layersListener = null;

/** fn() runs whenever a layer opens or closes (the website ties this to the browser's back button). */
export function onLayersChange(fn) {
  layersListener = fn;
}

function notifyLayers() {
  if (layersListener) setTimeout(layersListener, 0);
}

export function closeTopLayer() {
  const top = layers[layers.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

function addLayer(layer) {
  layers.push(layer);
  notifyLayers();
  return () => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
    notifyLayers();
  };
}

export const hasLayers = () => layers.length > 0;

// ---------- Sheets

let largeSheetCount = 0;

/**
 * Opens a sheet that slides up from the bottom. size: 'large' (nearly full screen, pushes the
 * page behind back like iOS) or 'auto' (as tall as its content).
 * Returns { el, body, close }. Drag the grabber/header down to dismiss.
 * onDismissRequest(reason): when given, Back / Esc / backdrop / drag ask it instead of closing
 * straight away (the transaction editor uses this to confirm discarding typed changes).
 */
export function openSheet({ html = '', size = 'large', className = '', onClose, onDismissRequest, dismissible = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `sheet-wrap ${size === 'large' ? 'sheet-large' : 'sheet-auto'} ${className}`;
  wrap.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grabber" data-drag></div><div class="sheet-body">${html}</div></div>`;
  overlayRoot().appendChild(wrap);
  const sheet = $('.sheet', wrap);
  const body = $('.sheet-body', wrap);
  let closed = false;

  if (size === 'large' && ++largeSheetCount === 1) document.body.classList.add('behind-sheet');
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));

  const close = (reason) => {
    if (closed) return;
    closed = true;
    removeLayer();
    if (document.activeElement && wrap.contains(document.activeElement)) document.activeElement.blur();
    wrap.classList.remove('open');
    wrap.classList.add('closing');
    sheet.style.transform = '';
    if (size === 'large' && --largeSheetCount === 0) document.body.classList.remove('behind-sheet');
    setTimeout(() => wrap.remove(), 380);
    if (onClose) onClose(reason);
  };
  const requestClose = reason => {
    if (!dismissible || closed) return;
    if (onDismissRequest) onDismissRequest(reason);
    else close(reason);
  };
  const removeLayer = addLayer({ close: () => requestClose('back') });

  $('.sheet-backdrop', wrap).addEventListener('click', () => requestClose('backdrop'));

  // Drag down to dismiss
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let dragging = false;
  sheet.addEventListener('pointerdown', e => {
    if (!dismissible || !e.target.closest('[data-drag]') || e.target.closest('button, input, textarea')) return;
    if (window.matchMedia('(min-width: 900px)').matches) return; // centred dialog on desktop: nothing to drag
    dragging = true;
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    sheet.classList.add('dragging');
    sheet.setPointerCapture(e.pointerId);
  });
  sheet.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
    lastT = e.timeStamp;
    lastY = e.clientY;
  });
  const endDrag = e => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    const dy = e.clientY - startY;
    const velocity = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastT);
    sheet.style.transform = '';
    if (dy > 140 || (dy > 40 && velocity > 0.4)) requestClose('drag');
  };
  sheet.addEventListener('pointerup', endDrag);
  sheet.addEventListener('pointercancel', endDrag);

  return { el: wrap, sheet, body, close };
}

/** Sheet with the standard iOS header: [Cancel]  Title  [Done]. */
export function openFormSheet({ title, html, cancelText = 'Cancel', doneText = 'Done', onDone, onMount, size = 'large', doneDisabled = false }) {
  const handle = openSheet({
    size,
    html: `
      <header class="sheet-header" data-drag>
        <button class="nav-btn sheet-cancel">${esc(cancelText)}</button>
        <h2 class="sheet-title">${esc(title)}</h2>
        <button class="nav-btn strong sheet-done" ${doneDisabled ? 'disabled' : ''}>${esc(doneText)}</button>
      </header>
      <div class="sheet-scroll">${html}</div>`,
  });
  $('.sheet-cancel', handle.el).addEventListener('click', () => handle.close('cancel'));
  $('.sheet-done', handle.el).addEventListener('click', async () => {
    if (!onDone) return handle.close('done');
    const result = await onDone(handle);
    if (result !== false) handle.close('done');
  });
  if (onMount) onMount(handle);
  return handle;
}

// ---------- Alerts and action sheets

/** iOS alert. buttons: [{ text, value, style: 'cancel' | 'destructive' | 'default' }]. */
export function alert({ title, message = '', buttons = [{ text: 'OK', value: true, style: 'cancel' }] }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'alert-wrap';
    const stacked = buttons.length > 2;
    wrap.innerHTML = `
      <div class="alert" role="alertdialog" aria-modal="true">
        <div class="alert-text">
          <h3>${esc(title)}</h3>
          ${message ? `<p>${esc(message)}</p>` : ''}
        </div>
        <div class="alert-buttons ${stacked ? 'stacked' : ''}">
          ${buttons.map((b, i) => `<button class="${b.style || ''}" data-i="${i}">${esc(b.text)}</button>`).join('')}
        </div>
      </div>`;
    overlayRoot().appendChild(wrap);
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
    const cancelIndex = Math.max(0, buttons.findIndex(b => b.style === 'cancel'));
    const finish = i => {
      removeLayer();
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 250);
      resolve(buttons[i] ? buttons[i].value : undefined);
    };
    const removeLayer = addLayer({ close: () => finish(cancelIndex) });
    wrap.addEventListener('click', e => {
      const btn = e.target.closest('button[data-i]');
      if (btn) finish(Number(btn.dataset.i));
    });
  });
}

/** iOS action sheet. actions: [{ text, value, style, icon }]. Resolves the value, or null on cancel. */
export function actionSheet({ title = '', message = '', actions, cancelText = 'Cancel' }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'action-wrap';
    wrap.innerHTML = `
      <div class="sheet-backdrop"></div>
      <div class="action-sheet" role="dialog" aria-modal="true">
        <div class="action-group">
          ${title || message ? `<div class="action-head">${title ? `<strong>${esc(title)}</strong>` : ''}${message ? `<span>${esc(message)}</span>` : ''}</div>` : ''}
          ${actions.map((a, i) => `<button class="action-btn ${a.style || ''}" data-i="${i}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.text)}</span>${a.checked ? icon('check') : ''}</button>`).join('')}
        </div>
        <button class="action-btn action-cancel" data-cancel>${esc(cancelText)}</button>
      </div>`;
    overlayRoot().appendChild(wrap);
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
    const finish = value => {
      removeLayer();
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 320);
      resolve(value);
    };
    const removeLayer = addLayer({ close: () => finish(null) });
    wrap.addEventListener('click', e => {
      if (e.target.closest('[data-cancel]') || e.target.classList.contains('sheet-backdrop')) return finish(null);
      const btn = e.target.closest('button[data-i]');
      if (btn) {
        haptic('selection');
        finish(actions[Number(btn.dataset.i)].value);
      }
    });
  });
}

// ---------- Toast (used for "Deleted · Undo")

let toastTimer = null;
export function toast(text, { actionText, onAction, duration = 4000, iconName } = {}) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `${iconName ? icon(iconName, true) : ''}<span>${esc(text)}</span>${actionText ? `<button>${esc(actionText)}</button>` : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  const hide = () => el.classList.remove('show');
  toastTimer = setTimeout(hide, duration);
  const btn = $('button', el);
  if (btn) {
    btn.onclick = () => {
      clearTimeout(toastTimer);
      hide();
      if (onAction) onAction();
    };
  }
}

// ---------- Pushed pages (navigation stack, slides in from the right)

/**
 * Pushes a page over the current screen. render(content, page) fills it and is called again by
 * page.refresh(). Returns { el, content, close, refresh }.
 */
export function pushPage({ title, backText = 'Back', render, rightHTML = '', onRight, onClose }) {
  const stack = $('#stack');
  const below = stack.lastElementChild || $('#tabs');
  const el = document.createElement('section');
  el.className = 'page pushed';
  el.innerHTML = `
    <header class="navbar solid-title">
      <button class="nav-btn back">${icon('caret-left')}<span>${esc(backText)}</span></button>
      <div class="nav-title">${esc(title)}</div>
      <div class="nav-right">${rightHTML}</div>
    </header>
    <div class="scroller"><div class="content"></div><div class="bottom-space"></div></div>`;
  stack.appendChild(el);
  const content = $('.content', el);
  const page = {
    el,
    content,
    refresh: () => render(content, page),
    close: () => {
      removeLayer();
      el.classList.remove('in');
      below.classList.remove('covered');
      setTimeout(() => el.remove(), 380);
      if (onClose) onClose();
    },
    setTitle: text => { $('.nav-title', el).textContent = text; },
  };
  const removeLayer = addLayer({ close: page.close });
  bindNavbar(el);
  $('.back', el).addEventListener('click', page.close);
  if (onRight) $('.nav-right', el).addEventListener('click', e => { if (e.target.closest('button')) onRight(e, page); });
  render(content, page);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.add('in');
    below.classList.add('covered');
  }));
  return page;
}

/** Large title collapses into the nav bar on scroll; the bar turns frosted once content goes under it. */
export function bindNavbar(page) {
  const scroller = $('.scroller', page);
  const nav = $('.navbar', page);
  if (!scroller || !nav) return;
  const onScroll = () => {
    const y = scroller.scrollTop;
    nav.classList.toggle('solid', y > 2);
    nav.classList.toggle('show-title', y > 40);
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ---------- Segmented control

export function segmented(options, value, name = '') {
  const index = Math.max(0, options.findIndex(o => o.value === value));
  return `<div class="segmented" data-name="${esc(name)}" style="--n:${options.length};--i:${index}">
    <span class="seg-thumb"></span>
    ${options.map(o => `<button type="button" data-value="${esc(o.value)}" class="${o.value === value ? 'on' : ''}">${esc(o.label)}</button>`).join('')}
  </div>`;
}

/** Wires every segmented control inside root; onChange(name, value). */
export function bindSegmented(root, onChange) {
  root.addEventListener('click', e => {
    const btn = e.target.closest('.segmented button');
    if (!btn) return;
    const seg = btn.parentElement;
    const buttons = $$('button', seg);
    const index = buttons.indexOf(btn);
    if (btn.classList.contains('on')) return;
    buttons.forEach(b => b.classList.toggle('on', b === btn));
    seg.style.setProperty('--i', index);
    haptic('selection');
    onChange(seg.dataset.name, btn.dataset.value);
  });
}

// ---------- Swipe-to-delete rows

let openSwipe = null;

function closeOpenSwipe(except) {
  if (openSwipe && openSwipe !== except) {
    openSwipe.style.transform = '';
    openSwipe.closest('.swipe-row').classList.remove('swiped');
    openSwipe = null;
  }
}

document.addEventListener('pointerdown', e => {
  if (openSwipe && !e.target.closest('.swipe-row.swiped')) closeOpenSwipe();
}, true);

/**
 * Makes every .swipe-row in root swipeable: left swipe shows Delete, a long swipe deletes.
 * onTap(id) for a normal tap, onDelete(id) to delete.
 */
export function bindSwipeRows(root, { onTap, onDelete }) {
  let row = null;
  let content = null;
  let startX = 0;
  let startY = 0;
  let base = 0;
  let dx = 0;
  let mode = null; // null | 'swipe' | 'scroll'
  let justSwiped = false; // the click that some browsers fire at the end of a drag is not a tap
  const ACTION = 88;

  root.addEventListener('pointerdown', e => {
    const r = e.target.closest('.swipe-row');
    if (!r || e.button > 0) return;
    row = r;
    content = $('.swipe-content', r);
    startX = e.clientX;
    startY = e.clientY;
    base = r.classList.contains('swiped') ? -ACTION : 0;
    dx = 0;
    mode = null;
  });

  root.addEventListener('pointermove', e => {
    if (!row) return;
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (!mode) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.2) {
        mode = 'swipe';
        closeOpenSwipe(content);
        row.classList.add('swiping');
        try { row.setPointerCapture(e.pointerId); } catch { /* not all pointers can be captured */ }
      } else if (Math.abs(my) > 10) {
        mode = 'scroll';
      }
    }
    if (mode !== 'swipe') return;
    dx = Math.min(0, base + mx);
    const width = row.offsetWidth;
    // Rubber band past the full-swipe point
    const shown = dx < -width ? -width - (Math.abs(dx) - width) * 0.2 : dx;
    content.style.transform = `translateX(${shown}px)`;
    row.classList.toggle('full', dx < -width * 0.55);
  });

  const end = () => {
    if (!row) return;
    const r = row;
    const c = content;
    r.classList.remove('swiping');
    if (mode === 'swipe') {
      justSwiped = true;
      setTimeout(() => { justSwiped = false; }, 50);
      const width = r.offsetWidth;
      if (dx < -width * 0.55) {
        haptic('warning');
        c.style.transform = `translateX(${-width}px)`;
        r.classList.add('removing');
        setTimeout(() => onDelete(r.dataset.id), 220);
      } else if (dx < -ACTION / 2) {
        c.style.transform = `translateX(${-ACTION}px)`;
        r.classList.add('swiped');
        openSwipe = c;
      } else {
        c.style.transform = '';
        r.classList.remove('swiped');
        if (openSwipe === c) openSwipe = null;
      }
      r.classList.remove('full');
    }
    row = null;
    mode = null;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', () => {
    if (row && mode === 'swipe') end();
    row = null;
    mode = null;
  });

  root.addEventListener('click', e => {
    if (justSwiped) {
      justSwiped = false;
      return;
    }
    const del = e.target.closest('.swipe-delete');
    if (del) {
      const r = del.closest('.swipe-row');
      haptic('warning');
      r.classList.add('removing');
      openSwipe = null;
      setTimeout(() => onDelete(r.dataset.id), 200);
      return;
    }
    const r = e.target.closest('.swipe-row');
    if (!r) return;
    if (r.classList.contains('swiped')) {
      closeOpenSwipe();
      return;
    }
    onTap(r.dataset.id);
  });
}

// ---------- Number pad

export function keypadHTML() {
  const keys = ['1', '2', '3', 'back', '4', '5', '6', 'done', '7', '8', '9', '.', '0', '00'];
  return `<div class="keypad">${keys.map(k => {
    if (k === 'back') return `<button type="button" class="kp-key kp-back" data-k="back" aria-label="Delete">${icon('backspace')}</button>`;
    if (k === 'done') return `<button type="button" class="kp-key kp-done" data-k="done" aria-label="Done">${icon('check')}</button>`;
    return `<button type="button" class="kp-key" data-k="${k}">${k}</button>`;
  }).join('')}</div>`;
}

const KEYBOARD_KEYS = { '.': '.', ',': '.', Backspace: 'back', Delete: 'clear', Enter: 'done' };

/**
 * Calls onKey('1' | '.' | 'back' | 'done' …). Holding backspace clears everything.
 * On a computer the keyboard works too (digits, '.', Backspace, Enter) while this sheet is on top.
 */
export function bindKeypad(root, onKey) {
  const pad = $('.keypad', root);
  const onKeyDown = e => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKeyDown);
      return;
    }
    // Only the top-most sheet listens, and not while it is closing (typing works during the open animation)
    if (overlayRoot().lastElementChild !== root || root.classList.contains('closing')) return;
    const typingInField = e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]');
    if (e.ctrlKey || e.metaKey || e.altKey || typingInField) return;
    const key = /^[0-9]$/.test(e.key) ? e.key
      : KEYBOARD_KEYS[e.key] || (e.code === 'Period' || e.code === 'NumpadDecimal' ? '.' : null);
    if (!key) return;
    e.preventDefault();
    const button = $(`.kp-key[data-k="${key}"]`, pad);
    if (button) {
      button.classList.add('down');
      setTimeout(() => button.classList.remove('down'), 120);
    }
    onKey(key);
  };
  document.addEventListener('keydown', onKeyDown);
  let holdTimer = null;
  pad.addEventListener('pointerdown', e => {
    const key = e.target.closest('.kp-key');
    if (!key) return;
    key.classList.add('down');
    if (key.dataset.k === 'back') {
      holdTimer = setTimeout(() => { holdTimer = null; haptic('medium'); onKey('clear'); }, 550);
    }
  });
  const release = e => {
    const key = e.target.closest('.kp-key');
    $$('.kp-key.down', pad).forEach(k => k.classList.remove('down'));
    if (!key) return;
    if (key.dataset.k === 'back') {
      if (!holdTimer) return; // the long press already cleared
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    haptic(key.dataset.k === 'done' ? 'medium' : 'light');
    onKey(key.dataset.k);
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointerleave', () => {
    clearTimeout(holdTimer);
    holdTimer = null;
    $$('.kp-key.down', pad).forEach(k => k.classList.remove('down'));
  });
  pad.addEventListener('contextmenu', e => e.preventDefault());
}

export function amountSizeClass(text) {
  const len = text.replace(/[^0-9]/g, '').length;
  return len > 9 ? 'size-s' : len > 6 ? 'size-m' : '';
}

/** A sheet with a big amount and the number pad. Resolves the amount in minor units, or null. */
export function pickAmount({ title, initial = 0, currency, subtitle = '', allowZero = true, doneText = 'Done' }) {
  return new Promise(resolve => {
    let typed = L.minorToTyped(initial);
    let result = null;
    const symbol = L.currencyInfo(currency).symbol;
    const handle = openSheet({
      size: 'auto',
      className: 'amount-sheet',
      onClose: () => resolve(result),
      html: `
        <header class="sheet-header" data-drag>
          <button class="nav-btn sheet-cancel">Cancel</button>
          <h2 class="sheet-title">${esc(title)}</h2>
          <button class="nav-btn strong sheet-done">${esc(doneText)}</button>
        </header>
        ${subtitle ? `<p class="sheet-sub">${esc(subtitle)}</p>` : ''}
        <div class="amount-display"><span class="amount-symbol">${esc(symbol)}</span><span class="amount-value"></span></div>
        ${keypadHTML()}`,
    });
    const valueEl = $('.amount-value', handle.el);
    const paint = () => {
      const text = typed ? L.formatTyped(typed, currency) : '0';
      valueEl.textContent = text;
      valueEl.parentElement.className = `amount-display ${typed ? '' : 'empty'} ${amountSizeClass(text)}`;
    };
    const finish = () => {
      const minor = L.typedToMinor(typed);
      if (!allowZero && !minor) { haptic('error'); return; }
      result = minor;
      handle.close('done');
    };
    $('.sheet-cancel', handle.el).addEventListener('click', () => handle.close('cancel'));
    $('.sheet-done', handle.el).addEventListener('click', finish);
    bindKeypad(handle.el, key => {
      if (key === 'done') return finish();
      typed = key === 'clear' ? '' : L.typeKey(typed, key);
      paint();
    });
    paint();
  });
}

// ---------- Calendar

/** Month calendar sheet. Resolves the picked 'YYYY-MM-DD', or null. */
export function pickDate(currentIso, { title = 'Date' } = {}) {
  return new Promise(resolve => {
    const today = L.todayISO();
    let selected = currentIso || today;
    let month = L.startOfMonth(selected);
    let result = null;
    const handle = openSheet({
      size: 'auto',
      className: 'calendar-sheet',
      onClose: () => resolve(result),
      html: `
        <header class="sheet-header" data-drag>
          <button class="nav-btn sheet-cancel">Cancel</button>
          <h2 class="sheet-title">${esc(title)}</h2>
          <button class="nav-btn strong sheet-done">Done</button>
        </header>
        <div class="calendar">
          <div class="cal-head">
            <strong class="cal-month"></strong>
            <div class="cal-nav">
              <button class="icon-btn" data-step="-1" aria-label="Previous month">${icon('caret-left')}</button>
              <button class="icon-btn" data-step="1" aria-label="Next month">${icon('caret-right')}</button>
            </div>
          </div>
          <div class="cal-week">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span>${d}</span>`).join('')}</div>
          <div class="cal-grid"></div>
          <div class="cal-quick">
            <button class="chip" data-quick="${today}">Today</button>
            <button class="chip" data-quick="${L.addDays(today, -1)}">Yesterday</button>
          </div>
        </div>`,
    });
    const grid = $('.cal-grid', handle.el);
    const paint = () => {
      const first = L.parseISO(month);
      $('.cal-month', handle.el).textContent = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const lead = (first.getDay() + 6) % 7;
      const count = L.daysInMonth(first.getFullYear(), first.getMonth());
      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<span></span>';
      for (let d = 1; d <= count; d++) {
        const iso = `${month.slice(0, 8)}${String(d).padStart(2, '0')}`;
        cells += `<button class="cal-day ${iso === selected ? 'sel' : ''} ${iso === today ? 'today' : ''}" data-day="${iso}">${d}</button>`;
      }
      grid.innerHTML = cells;
    };
    const done = () => { result = selected; handle.close('done'); };
    handle.el.addEventListener('click', e => {
      const step = e.target.closest('[data-step]');
      if (step) { month = L.addMonths(month, Number(step.dataset.step)); haptic('selection'); paint(); return; }
      const day = e.target.closest('[data-day]');
      if (day) { selected = day.dataset.day; haptic('selection'); paint(); setTimeout(done, 160); return; }
      const quick = e.target.closest('[data-quick]');
      if (quick) { selected = quick.dataset.quick; done(); }
    });
    $('.sheet-cancel', handle.el).addEventListener('click', () => handle.close('cancel'));
    $('.sheet-done', handle.el).addEventListener('click', done);
    paint();
  });
}
