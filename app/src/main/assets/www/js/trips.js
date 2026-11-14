// Trips and events: tag spending ("Goa trip", "Wedding") to see what it all cost. While a trip is
// on, everything you add — typed, spoken or from bank messages — gets its tag automatically.
import { store } from './store.js';
import * as L from './logic.js';
import { esc, icon, tile, pushPage, actionSheet, alert, toast, haptic, promptText } from './ui.js';
import { nav } from './nav.js';

function summaryFor(tag) {
  return L.tagSummaries(store.state.transactions).find(s => s.tag.toLowerCase() === String(tag).toLowerCase())
    || { tag, spent: 0, income: 0, count: 0 };
}

/** A banner on Summary while a trip or event is on. */
export function tripBannerHTML() {
  const tag = store.state.settings.activeTag;
  if (!tag) return '';
  const s = summaryFor(tag);
  return `<div class="card banner" style="margin-top:4px">
    ${tile('airplane-tilt', 'cyan', 'lg')}
    <div class="banner-text"><strong>${esc(tag)}</strong>${esc(store.money(s.spent))} so far · new spending is tagged</div>
    <button class="btn secondary" data-trip-end style="width:auto;padding:0 14px;min-height:34px">End</button>
  </div>`;
}

export function handleTripClick(e) {
  if (e.target.closest('[data-trip-end]')) { endTrip(); return true; }
  return false;
}

async function startTrip() {
  const name = await promptText({ title: 'Start a Trip or Event', placeholder: 'Goa trip, Diwali, Wedding…', doneText: 'Start' });
  if (!name) return;
  store.setActiveTag(name);
  haptic('success');
  toast(`Everything you add is tagged “${name}” until you end it`, { iconName: 'airplane-tilt', duration: 5000 });
}

async function endTrip() {
  const tag = store.state.settings.activeTag;
  if (!tag) return;
  const s = summaryFor(tag);
  const ok = await alert({
    title: `End ${tag}?`,
    message: `It cost ${store.money(s.spent)} across ${s.count} transaction${s.count === 1 ? '' : 's'}. New spending won’t be tagged any more.`,
    buttons: [{ text: 'Cancel', value: false, style: 'cancel' }, { text: 'End', value: true }],
  });
  if (ok) store.setActiveTag('');
}

export function openTrips() {
  let unsubscribe = () => {};
  const page = pushPage({
    title: 'Trips & Events',
    onClose: () => unsubscribe(),
    render: content => {
      const active = store.state.settings.activeTag;
      const tags = L.tagSummaries(store.state.transactions);
      content.innerHTML = `
        <div class="section" style="margin-top:12px">
          <div class="list">
            ${active
              ? `<button class="row tap" data-trip-end>${tile('stop', 'red')}<div class="row-main"><span class="row-title" style="flex:1">End “${esc(active)}”</span></div></button>`
              : `<button class="row tap" data-start>${tile('airplane-tilt', 'cyan')}<div class="row-main"><span class="row-title" style="flex:1;color:var(--blue)">Start a Trip or Event</span></div></button>`}
          </div>
          <div class="section-footer">While it’s on, everything you add is tagged with it — even bank messages. You can also tag any transaction from its Tag button.</div>
        </div>
        ${tags.length ? `
        <div class="section">
          <div class="list">
            ${tags.map(s => `<button class="row tap" data-tag="${esc(s.tag)}">
              ${tile('tag', s.tag === active ? 'cyan' : 'gray', 'lg')}
              <div class="row-main"><div class="row-text">
                <div class="row-title">${esc(s.tag)}${s.tag === active ? ' · on now' : ''}</div>
                <div class="row-sub">${esc(s.start === s.end ? L.shortDate(s.start) : `${L.shortDate(s.start)} – ${L.shortDate(s.end)}`)} · ${s.count} transaction${s.count === 1 ? '' : 's'}</div>
              </div><span class="tx-amount">${esc(store.money(s.spent))}</span></div>
            </button>`).join('')}
          </div>
        </div>` : ''}`;
    },
  });
  page.content.addEventListener('click', async e => {
    if (handleTripClick(e)) return;
    if (e.target.closest('[data-start]')) { startTrip(); return; }
    const row = e.target.closest('[data-tag]');
    if (!row) return;
    const tag = row.dataset.tag;
    const choice = await actionSheet({
      title: tag,
      actions: [
        { text: 'See Transactions', value: 'list', icon: 'list-bullets' },
        ...(store.state.settings.activeTag !== tag ? [{ text: 'Tag New Spending With It', value: 'activate', icon: 'airplane-tilt' }] : []),
        { text: 'Rename…', value: 'rename', icon: 'pencil-simple' },
      ],
    });
    if (choice === 'list') nav.showActivity({ tag });
    else if (choice === 'activate') store.setActiveTag(tag);
    else if (choice === 'rename') {
      const name = await promptText({ title: 'Rename', value: tag });
      if (name && name !== tag) store.renameTag(tag, name);
    }
  });
  unsubscribe = store.subscribe(() => page.refresh());
}
