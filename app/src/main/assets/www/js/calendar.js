// A month calendar: what you spent each day (darker = more), bills due marked with a dot.
import { store } from './store.js';
import * as L from './logic.js';
import { $, esc, icon, pushPage, haptic } from './ui.js';
import { nav } from './nav.js';

export function openCalendar() {
  let month = L.startOfMonth(L.todayISO());
  let unsubscribe = () => {};
  const page = pushPage({
    title: 'Calendar',
    onClose: () => unsubscribe(),
    render: content => {
      const today = L.todayISO();
      const weeks = L.monthCalendar(month, store.state.transactions);
      const max = Math.max(1, ...weeks.flat().filter(d => d.inMonth).map(d => d.spent));
      const due = new Set(store.state.bills.filter(b => !b.paid).map(b => b.dueDate));
      const total = weeks.flat().filter(d => d.inMonth).reduce((s, d) => s + d.spent, 0);
      content.innerHTML = `
        <div class="period-nav" style="margin-top:8px">
          <button class="icon-btn" data-step="-1" aria-label="Previous month">${icon('caret-left')}</button>
          <strong>${esc(L.parseISO(month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }))}</strong>
          <button class="icon-btn" data-step="1" aria-label="Next month" ${month >= L.startOfMonth(today) ? 'disabled style="opacity:.3"' : ''}>${icon('caret-right')}</button>
        </div>
        <div class="card cal">
          <div class="cal-row cal-head">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span>${d}</span>`).join('')}</div>
          ${weeks.map(week => `<div class="cal-row">${week.map(d => {
            const level = d.spent ? Math.max(0.12, d.spent / max) : 0;
            return `<button class="cal-day ${d.inMonth ? '' : 'out'} ${d.date === today ? 'today' : ''}" ${d.inMonth ? `data-day="${d.date}"` : 'disabled'}
              style="--heat:${level.toFixed(2)}">
              <span class="cal-num">${Number(d.date.slice(8))}</span>
              ${d.inMonth && d.spent ? `<span class="cal-amt">${esc(store.money(d.spent, { compact: true }))}</span>` : ''}
              ${d.inMonth && due.has(d.date) ? '<span class="cal-bill"></span>' : ''}
            </button>`;
          }).join('')}</div>`).join('')}
        </div>
        <div class="section-footer" style="padding:0 32px">Spent ${esc(store.money(total))} this month. Darker days cost more; an orange dot is a bill due. Tap a day to see it.</div>`;
    },
  });
  page.content.addEventListener('click', e => {
    const step = e.target.closest('[data-step]');
    if (step && !step.disabled) {
      month = L.addMonths(month, Number(step.dataset.step));
      haptic('selection');
      page.refresh();
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day) {
      const d = day.dataset.day;
      nav.showActivity({ period: { key: 'custom', label: L.dayLabel(d), start: d, end: d } });
      page.close();
    }
  });
  unsubscribe = store.subscribe(() => page.refresh());
  void $;
}
