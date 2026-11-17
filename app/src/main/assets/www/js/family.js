// Family sharing: everyone in the family uses the same shared data through the owner's Google
// helper (the same sync as phone ↔ computer). The owner sends an invite code on WhatsApp; the family
// member pastes it here. Each transaction remembers who added it.
import { store } from './store.js';
import * as L from './logic.js';
import { esc, icon, tile, pushPage, alert, toast, haptic, promptText } from './ui.js';
import { emailConnected, openEmailSetup } from './email.js';
import { syncNow } from './sync.js';
import { native } from './native.js';

const settings = () => store.state.settings;

async function askName() {
  const name = await promptText({ title: 'Your name', placeholder: 'Shown next to what you add', value: settings().memberName || '' });
  if (name) store.setSetting('memberName', name);
  return name || settings().memberName;
}

async function invite() {
  if (!emailConnected()) {
    const go = await alert({
      title: 'Connect Google first',
      message: 'Family sharing keeps one copy of your data in your own Google Drive. Connect your Google account once (about 5 minutes), then invite family.',
      buttons: [{ text: 'Not Now', value: false, style: 'cancel' }, { text: 'Connect', value: true }],
    });
    if (go) openEmailSetup();
    return;
  }
  const me = settings().memberName || (await askName());
  if (!me) return;
  if (!settings().sync.enabled) {
    settings().sync.enabled = true;
    store.commit();
    syncNow({ force: true });
  }
  const code = L.makeInvite({ url: settings().email.url, key: settings().email.key, from: me });
  const text = `${me} invited you to share expenses.\n\n1. Install Expenses (ask ${me} for the app, or open ${location.origin.startsWith('http') && !location.hostname.endsWith('androidplatform.net') ? location.origin : 'the website'})\n2. Copy this whole message\n3. Open Expenses → Settings → Family → Join\n\n${code}`;
  if (!native.isApp && !(navigator.canShare && navigator.share)) {
    // A computer: copy the invite and open WhatsApp with it
    try { await navigator.clipboard.writeText(text); } catch { /* still opens WhatsApp */ }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    toast('Invite copied — send it on WhatsApp', { iconName: 'paper-plane-tilt' });
    return;
  }
  const result = await native.sendImageWithText('expenses-invite.png', invitePicture(me), text);
  if (result && result.ok === false && !result.cancelled) window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

/** A small friendly card that goes with the invite message. */
function invitePicture(from) {
  const c = document.createElement('canvas');
  c.width = 720;
  c.height = 400;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 720, 400);
  g.fillStyle = '#0a84ff';
  g.beginPath();
  g.arc(360, 120, 56, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = '600 56px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('₹', 360, 122);
  g.fillStyle = '#1c1c1e';
  g.font = '700 40px system-ui, sans-serif';
  g.fillText(`${from} invited you`, 360, 230, 660);
  g.fillStyle = '#6e6e73';
  g.font = '400 30px system-ui, sans-serif';
  g.fillText('to share expenses as a family', 360, 285, 660);
  g.fillText('Copy the message and open Expenses', 360, 335, 660);
  return c.toDataURL('image/png');
}

async function join() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { text = ''; }
  if (!L.readInvite(text)) text = await promptText({ title: 'Paste the invite', placeholder: 'EXPENSES-FAMILY-…', maxLength: 3000 }) || '';
  const found = L.readInvite(text);
  if (!found) {
    if (text) alert({ title: 'That isn’t an invite code', message: 'Ask the person who invited you to send the invite again, and paste the whole message.' });
    return;
  }
  const ok = await alert({
    title: `Join ${found.from || 'the family'}?`,
    message: 'You’ll share one set of expenses. What’s on this device now is combined with theirs.',
    buttons: [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'Join', value: true }],
  });
  if (!ok) return;
  if (!settings().memberName) await askName();
  Object.assign(settings().email, { url: found.url, key: found.key, enabled: false });
  settings().sync.enabled = true;
  store.commit();
  const done = await syncNow({ quiet: false, force: true });
  if (done) {
    haptic('success');
    toast(`You’re in — sharing with ${found.from || 'your family'}`, { iconName: 'users' });
  }
}

/** Everyone who has added something, with how much this month. */
function members() {
  const month = L.inRange(store.state.transactions, L.startOfMonth(L.todayISO()), L.endOfMonth(L.todayISO()));
  const map = new Map();
  for (const t of month) {
    if (t.type !== 'expense') continue;
    const who = t.by || 'Not marked';
    map.set(who, (map.get(who) || 0) + t.amount);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export const familyOn = () => settings().sync.enabled && !!settings().memberName;

export function openFamily() {
  let unsubscribe = () => {};
  const page = pushPage({
    title: 'Family',
    onClose: () => unsubscribe(),
    render: content => {
      const on = familyOn();
      const list = members();
      content.innerHTML = `
        ${on ? `
        <div class="card banner" style="margin-top:12px">${tile('users', 'blue', 'lg')}
          <div class="banner-text"><strong>Sharing as ${esc(settings().memberName)}</strong>Everyone with the invite sees the same expenses.</div></div>
        ${list.length ? `<div class="section"><div class="section-header">Spent this month</div><div class="list">${list.map(([who, total]) => `
          <div class="row"><div class="row-main"><span class="row-title" style="flex:1">${esc(who)}</span><span class="row-value">${esc(store.money(total))}</span></div></div>`).join('')}</div></div>` : ''}` : `
        <div class="empty" style="padding:8vh 24px 12px">${icon('users', true)}<strong>One budget for the whole family</strong>Your husband, wife or parents add from their own phone, and everyone sees the same expenses, bills and budget.</div>`}
        <div class="section" style="margin-top:12px">
          <div class="list">
            <button class="row tap" data-f="invite">${tile('paper-plane-tilt', 'green')}<div class="row-main"><span class="row-title" style="flex:1">Invite Family on WhatsApp</span><i class="ph ph-caret-right row-chevron"></i></div></button>
            <button class="row tap" data-f="join">${tile('sign-in', 'blue')}<div class="row-main"><span class="row-title" style="flex:1">Join with an Invite</span><i class="ph ph-caret-right row-chevron"></i></div></button>
            <button class="row tap" data-f="name">${tile('user', 'gray')}<div class="row-main"><span class="row-title" style="flex:1">Your Name</span><span class="row-value">${esc(settings().memberName || 'Add')}</span><i class="ph ph-caret-right row-chevron"></i></div></button>
          </div>
          <div class="section-footer">The invite carries the key to your shared data in your own Google Drive — send it only to family. Bill photos stay on the phone they were taken on.</div>
        </div>`;
    },
  });
  page.content.addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    ({ invite, join, name: askName })[b.dataset.f]();
  });
  unsubscribe = store.subscribe(() => page.refresh());
}
