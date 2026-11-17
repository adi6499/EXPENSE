// Splitting a bill with friends, and asking for money with a UPI "scan to pay" picture that any
// UPI app (GPay, PhonePe, Paytm, BHIM) can read — sent on WhatsApp with the amount filled in.
import { store } from './store.js';
import { native } from './native.js';
import * as L from './logic.js';
import { $, esc, icon, openFormSheet, alert, toast, haptic, promptText } from './ui.js';
import { qrMatrix, upiLink, isUpiId } from './qr.js';

/** Your UPI ID, asked once. Resolves it, or '' when the person cancels. */
export async function ensureUpiId() {
  const s = store.state.settings;
  if (isUpiId(s.upiId)) return s.upiId;
  for (;;) {
    const id = await promptText({ title: 'Your UPI ID', placeholder: 'name@okicici, 98xxxxxx10@ybl…', value: s.upiId || '', doneText: 'Save', maxLength: 80 });
    if (!id) return '';
    if (isUpiId(id)) {
      store.setSetting('upiId', id.trim());
      return id.trim();
    }
    await alert({ title: 'That isn’t a UPI ID', message: 'It looks like name@bank — find it in GPay, PhonePe or Paytm under your profile.' });
  }
}

/** A "Pay ₹600 to Jinesh" picture with the QR code. Resolves a PNG data URL. */
export async function payPicture({ amount, note }) {
  const s = store.state.settings;
  const link = upiLink({ vpa: s.upiId, name: s.upiName || '', amount, note });
  const m = qrMatrix(link);
  const W = 720;
  const H = 960;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  try { await document.fonts.ready; } catch { /* draw anyway */ }
  const font = (w, size) => `${w} ${size}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8e8e93';
  ctx.font = font(600, 30);
  ctx.fillText('Scan with any UPI app to pay', W / 2, 92);
  ctx.fillStyle = '#000';
  ctx.font = font(700, 76);
  ctx.fillText(store.money(amount), W / 2, 182);
  const box = 480;
  const cell = Math.floor(box / (m.length + 8));
  const size = cell * (m.length + 8);
  const x0 = (W - size) / 2;
  const y0 = 230;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x0, y0, size, size);
  ctx.fillStyle = '#000';
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) ctx.fillRect(x0 + (x + 4) * cell, y0 + (y + 4) * cell, cell, cell); }));
  ctx.fillStyle = '#000';
  ctx.font = font(600, 32);
  ctx.fillText(note ? note.slice(0, 32) : 'Payment', W / 2, y0 + size + 64);
  ctx.fillStyle = '#8e8e93';
  ctx.font = font(500, 28);
  ctx.fillText(`To ${s.upiName ? `${s.upiName} · ` : ''}${s.upiId}`, W / 2, y0 + size + 108);
  return canvas.toDataURL('image/png');
}

/** Sends one person a WhatsApp-ready "please pay" picture and message. */
export async function askToPay({ name, amount, note }) {
  if (!(await ensureUpiId())) return;
  const picture = await payPicture({ amount, note: note ? `${note} — ${name}` : name });
  const upi = store.state.settings.upiId;
  const text = `Hi ${name}, your share${note ? ` of ${note}` : ''} is ${store.money(amount)}. Scan the code with any UPI app, or pay to ${upi}. Thanks!`;
  const result = await native.sendImageWithText(`pay-${L.personKey(name).replace(/\s+/g, '-')}.png`, picture, text);
  if (!result.ok && !result.cancelled) alert({ title: 'Couldn’t share', message: result.error || 'Please try again.' });
}

/**
 * The split sheet, opened from the editor with what was typed so far.
 * draft: { amount, note, categoryId, accountId, date, tag }. Resolves true when it was saved.
 */
export function openSplit(draft) {
  return new Promise(resolve => {
    const known = L.personBalances(store.state.transactions).map(p => p.name);
    const s = { includeMe: true, chosen: [] };
    let saved = false;
    const handle = openFormSheet({
      title: `Split ${store.money(draft.amount)}`,
      doneText: 'Split',
      onClose: () => resolve(saved),
      html: `
        <div class="section">
          <div class="section-header">With</div>
          <div class="split-people"></div>
          <div class="section-footer">Tap people to add them. Everyone pays the same share.</div>
        </div>
        <div class="section">
          <div class="list">
            <label class="row"><div class="row-main"><span class="row-title" style="flex:1">I’m paying a share too</span>
            <span class="switch"><input type="checkbox" data-me checked><span></span></span></div></label>
          </div>
        </div>
        <div class="section"><div class="list split-shares"></div>
          <div class="section-footer">Your share is added as spending; the others are added to Lent &amp; Borrowed until they pay you back. Next you can send each of them a UPI code to pay.</div>
        </div>`,
      onDone: () => {
        if (!s.chosen.length) {
          toast('Add at least one person', { iconName: 'warning-circle' });
          return false;
        }
        const count = s.chosen.length + (s.includeMe ? 1 : 0);
        const shares = L.splitAmount(draft.amount, count);
        const myShare = s.includeMe ? shares.shift() : 0;
        const people = s.chosen.map((name, i) => ({ name, share: shares[i] }));
        store.addSplit({ total: draft.amount, note: draft.note, categoryId: draft.categoryId, accountId: draft.accountId, date: draft.date, tag: draft.tag, people, myShare });
        saved = true;
        haptic('success');
        setTimeout(() => offerRequests(people, draft.note), 420);
        return true;
      },
    });
    const root = handle.el;
    function paint() {
      const names = [...new Set([...s.chosen, ...known])];
      $('.split-people', root).innerHTML = names.map(n => `<button class="chip ${s.chosen.includes(n) ? 'on' : ''}" data-person="${esc(n)}">${s.chosen.includes(n) ? icon('check') : ''}${esc(n)}</button>`).join('')
        + `<button class="chip" data-add>${icon('plus')}Add Person</button>`;
      const count = s.chosen.length + (s.includeMe ? 1 : 0);
      const shares = count ? L.splitAmount(draft.amount, count) : [];
      const rows = [];
      if (s.includeMe && count) rows.push(['You', shares[0]]);
      s.chosen.forEach((n, i) => rows.push([n, shares[i + (s.includeMe ? 1 : 0)]]));
      $('.split-shares', root).innerHTML = rows.length
        ? rows.map(([n, v]) => `<div class="row"><div class="row-main"><span class="row-title" style="flex:1">${esc(n)}</span><span class="row-value">${esc(store.money(v))}</span></div></div>`).join('')
        : `<div class="row"><div class="row-main"><span class="row-title" style="flex:1;color:var(--label-2)">Nobody chosen yet</span></div></div>`;
    }
    root.addEventListener('click', async e => {
      const chip = e.target.closest('[data-person]');
      if (chip) {
        const n = chip.dataset.person;
        s.chosen = s.chosen.includes(n) ? s.chosen.filter(x => x !== n) : [...s.chosen, n];
        haptic('selection');
        paint();
      } else if (e.target.closest('[data-add]')) {
        const name = await promptText({ title: 'Add Person', placeholder: 'Their name' });
        if (name && !s.chosen.some(x => L.personKey(x) === L.personKey(name))) { s.chosen.push(name); paint(); }
      }
    });
    root.addEventListener('change', e => {
      if (e.target.closest('[data-me]')) { s.includeMe = e.target.checked; paint(); }
    });
    paint();
  });
}

/** After a split: one row per person with a Send button for their UPI code. */
function offerRequests(people, note) {
  const handle = openFormSheet({
    title: 'Ask for Money',
    doneText: 'Done',
    size: 'auto',
    html: `
      <div class="section">
        <div class="list">${people.map((p, i) => `<div class="row"><div class="row-main">
          <span class="row-title" style="flex:1">${esc(p.name)} · ${esc(store.money(p.share))}</span>
          <button class="btn secondary" style="width:auto;min-height:34px;padding:0 14px" data-send="${i}">${icon('whatsapp-logo')} Send</button></div></div>`).join('')}</div>
        <div class="section-footer">Each gets a picture with a UPI code for their exact share (and your UPI ID in the message). You can do this later from Lent &amp; Borrowed too.</div>
      </div>`,
  });
  handle.el.addEventListener('click', e => {
    const btn = e.target.closest('[data-send]');
    if (!btn) return;
    const p = people[Number(btn.dataset.send)];
    askToPay({ name: p.name, amount: p.share, note });
    btn.innerHTML = `${icon('check')} Sent`;
  });
}
