// The monthly plan: one fixed income, split into an amount for rent, EMIs, bills, food, travel and the
// rest — and every day you see what is left of each, and what is left to save.
// "Set Up My Month" walks through it in five short steps; the plan card on Summary shows how it's going.
import { store } from './store.js';
import * as L from './logic.js';
import { $, esc, icon, tile, openSheet, keypadHTML, bindKeypad, amountSizeClass, pickAmount, haptic, toast } from './ui.js';

const money = v => store.money(v);
const STEPS = 5;
const PAYDAYS = [[1, '1st'], [5, '5th'], [7, '7th'], [10, '10th'], [15, '15th'], [31, 'Last day'], [0, 'It changes']];

const catInfo = id => {
  const c = store.state.categories.find(x => x.id === id) || L.PLAN_NEW_CATEGORIES[id];
  return c || { id, name: id, icon: 'dots-three', color: 'gray' };
};

/** Categories of a group, plus (for day to day) any of your own categories that already have an amount. */
function groupIds(key, amounts) {
  const group = L.PLAN_GROUPS.find(g => g.key === key);
  const ids = group.ids.filter(id => store.state.categories.some(c => c.id === id) || L.PLAN_NEW_CATEGORIES[id]);
  if (key === 'daily') {
    const known = new Set(L.PLAN_GROUPS.flatMap(g => g.ids));
    for (const id of Object.keys(amounts)) if (!known.has(id) && store.state.categories.some(c => c.id === id)) ids.push(id);
  }
  return ids;
}

const sumOf = (ids, amounts) => ids.reduce((sum, id) => sum + (amounts[id] || 0), 0);

// ---------- Set Up My Month

export function openPlan() {
  const b = store.state.budgets;
  const s = {
    step: 0,
    typed: b.income ? L.minorToTyped(b.income) : '',
    payday: store.state.settings.payday || 0,
    amounts: { ...(b.categories || {}) },
    suggested: false,
  };
  const handle = openSheet({
    size: 'large',
    className: 'plan-sheet',
    html: `
      <header class="sheet-header" data-drag>
        <button class="nav-btn pl-cancel">Cancel</button>
        <h2 class="sheet-title">Plan My Month</h2>
        <span class="pl-count ju-muted ju-small"></span>
      </header>
      <div class="pl-dots" aria-hidden="true">${Array.from({ length: STEPS }, () => '<i></i>').join('')}</div>
      <div class="pl-body"></div>
      <div class="pl-pad">${keypadHTML()}</div>
      <footer class="pl-foot"><button class="ju-btn ghost pl-back">Back</button><button class="ju-btn primary pl-next">Next</button></footer>`,
  });
  const root = handle.el;
  const body = $('.pl-body', root);
  const income = () => L.typedToMinor(s.typed);

  const rowsHTML = ids => `<div class="list pl-rows">${ids.map(id => {
    const c = catInfo(id);
    const v = s.amounts[id] || 0;
    return `<button class="row tap" data-amt="${esc(id)}">${tile(c.icon, c.color, 'lg')}<div class="row-main">
      <span class="row-title" style="flex:1">${esc(c.name)}</span>
      <span class="pl-amt ${v ? '' : 'none'}">${v ? esc(money(v)) : 'Add'}</span></div></button>`;
  }).join('')}</div>`;

  function paint() {
    const fixedIds = groupIds('fixed', s.amounts);
    const dailyIds = groupIds('daily', s.amounts);
    const fixed = sumOf(fixedIds, s.amounts);
    const daily = sumOf(dailyIds, s.amounts);
    const inc = income();
    const saving = inc - fixed - daily;
    $('.pl-count', root).textContent = `${s.step + 1} of ${STEPS}`;
    $('.pl-pad', root).hidden = s.step !== 0;
    root.querySelectorAll('.pl-dots i').forEach((d, i) => d.classList.toggle('on', i <= s.step));
    $('.pl-back', root).style.visibility = s.step ? 'visible' : 'hidden';
    const next = $('.pl-next', root);
    next.textContent = s.step === STEPS - 1 ? 'Start' : 'Next';
    next.classList.toggle('accent', s.step === STEPS - 1);
    next.classList.toggle('primary', s.step !== STEPS - 1);
    next.disabled = s.step === 0 && !inc;

    if (s.step === 0) {
      const text = s.typed ? L.formatTyped(s.typed, store.currency) : '0';
      body.innerHTML = `
        <div class="pl-q"><h1>How much comes in every month?</h1><p>Your salary or fixed income, after tax. You can change it any time.</p></div>
        <div class="amount-display ${s.typed ? '' : 'empty'} ${amountSizeClass(text)}"><span class="amount-symbol">${esc(L.currencyInfo(store.currency).symbol)}</span><span class="amount-value">${esc(text)}</span></div>`;
    } else if (s.step === 1) {
      body.innerHTML = `
        <div class="pl-q"><h1>When does it come?</h1><p>“Safe to spend” then counts down to that day.</p></div>
        <div class="pl-chips">${PAYDAYS.map(([d, label]) => `<button class="ju-chip ${s.payday === d || (d === 31 && s.payday >= 31) ? 'on' : ''}" data-payday="${d}">${esc(label)}</button>`).join('')}</div>`;
    } else if (s.step === 2) {
      body.innerHTML = `
        <div class="pl-q"><h1>Fixed costs</h1><p>What goes out every month no matter what. Tap one to set it; leave the rest.</p></div>
        ${rowsHTML(fixedIds)}
        <div class="pl-left">Left after fixed costs <strong class="num ${inc - fixed < 0 ? 'bad' : ''}">${esc(money(inc - fixed))}</strong></div>`;
    } else if (s.step === 3) {
      body.innerHTML = `
        <div class="pl-q"><h1>Day-to-day spending</h1><p>${s.suggested ? 'Filled in from your spending (or a usual share of income) — tap any to change.' : 'Tap one to set how much it gets a month.'}</p></div>
        ${rowsHTML(dailyIds)}
        <div class="pl-left">Left to save <strong class="num ${saving < 0 ? 'bad' : 'ok'}">${esc(money(saving))}</strong></div>`;
    } else {
      body.innerHTML = `
        <div class="pl-q"><h1>${saving >= 0 ? `You’ll save ${esc(money(saving))} a month` : `That’s ${esc(money(-saving))} more than comes in`}</h1>
          <p>${saving >= 0 ? `${inc ? Math.round((saving / inc) * 100) : 0}% of your income. Summary shows what’s left of each, every day.` : 'Go back and trim something, or start anyway and adjust later.'}</p></div>
        <div class="list pl-rows">
          <div class="row"><div class="row-main"><span class="row-title" style="flex:1">Comes in</span><span class="row-value num">${esc(money(inc))}</span></div></div>
          <div class="row"><div class="row-main"><span class="row-title" style="flex:1">Fixed costs</span><span class="row-value num">− ${esc(money(fixed))}</span></div></div>
          <div class="row"><div class="row-main"><span class="row-title" style="flex:1">Day to day</span><span class="row-value num">− ${esc(money(daily))}</span></div></div>
          <div class="row"><div class="row-main"><span class="row-title" style="flex:1;font-weight:750">To save</span><span class="row-value num ${saving < 0 ? 'bad' : 'ok'}" style="font-weight:750">${esc(money(saving))}</span></div></div>
        </div>`;
    }
  }

  function go(step) {
    if (step === 3 && !s.suggested && !Object.keys(store.state.budgets.categories || {}).length) {
      // First time: fill day-to-day spending from real spending, or a usual share of income
      const ideas = L.suggestPlan(store.state.transactions, income());
      for (const id of groupIds('daily', s.amounts)) if (!s.amounts[id] && ideas[id]) s.amounts[id] = ideas[id];
      s.suggested = true;
    }
    s.step = Math.max(0, Math.min(STEPS - 1, step));
    haptic('selection');
    paint();
  }

  function finish() {
    store.savePlan({ income: income(), amounts: s.amounts, payday: s.payday });
    haptic('success');
    handle.close('done');
    toast('Your month is planned — see it on Summary', { iconName: 'check-circle' });
  }

  // One number pad for the income step, bound once (it only answers on that step)
  bindKeypad(root, key => {
    if (s.step !== 0) return;
    if (key === 'done') { if (income()) go(1); else haptic('error'); return; }
    s.typed = key === 'clear' ? '' : L.typeKey(s.typed, key);
    const t = s.typed ? L.formatTyped(s.typed, store.currency) : '0';
    $('.amount-value', body).textContent = t;
    $('.amount-display', body).className = `amount-display ${s.typed ? '' : 'empty'} ${amountSizeClass(t)}`;
    $('.pl-next', root).disabled = !income();
  });

  root.addEventListener('click', async e => {
    if (e.target.closest('.pl-cancel')) { handle.close('cancel'); return; }
    if (e.target.closest('.pl-back')) { go(s.step - 1); return; }
    if (e.target.closest('.pl-next')) { if (s.step === STEPS - 1) finish(); else if (s.step > 0 || income()) go(s.step + 1); return; }
    const chip = e.target.closest('[data-payday]');
    if (chip) { s.payday = Number(chip.dataset.payday); go(2); return; }
    const row = e.target.closest('[data-amt]');
    if (row) {
      const c = catInfo(row.dataset.amt);
      const value = await pickAmount({ title: c.name, subtitle: 'A month. 0 leaves it out.', initial: s.amounts[c.id] || 0, currency: store.currency, allowZero: true });
      if (value !== null) { s.amounts[c.id] = value; paint(); }
    }
  });
  paint();
}

// ---------- On Summary

/** Before there is a plan: one clear first step. */
export function setupCardHTML() {
  return `<div class="ju-card home-card setup-card">
    <div class="setup-ic">${icon('calendar-check', true)}</div>
    <h2>Set up your month</h2>
    <p class="ju-muted">Tell us what comes in each month, then split it — rent, EMIs, food, travel. Every day you’ll see what’s left of each. Takes a minute.</p>
    <button class="ju-btn primary" data-plan>${icon('arrow-right')} Set Up My Month</button>
  </div>`;
}

/** The plan: income, what each kind of spending has left, and what's left this month. */
export function planCardHTML() {
  const p = L.planStatus(store.state);
  if (!p) return '';
  const row = r => {
    const c = catInfo(r.categoryId);
    const over = r.left < 0;
    const pct = r.planned ? Math.min(100, (r.spent / r.planned) * 100) : 0;
    return `<div class="plan-row">${tile(c.icon, c.color)}
      <div class="plan-main">
        <div class="plan-line"><span class="plan-name">${esc(c.name)}</span>
          <span class="plan-left ${over ? 'bad' : r.left < r.planned * 0.2 ? 'warn' : 'ok'} num">${over ? `${esc(money(-r.left))} over` : `${esc(money(r.left))} left`}</span></div>
        <div class="ju-bar"><i style="width:${pct}%;background:var(--${over ? 'bad' : pct >= 80 ? 'warn' : 'ok'})"></i></div>
        <div class="plan-sub ju-muted num">${esc(money(r.spent))} of ${esc(money(r.planned))}</div>
      </div></div>`;
  };
  return `<div class="ju-card home-card plan-card">
    <div class="head"><h2>This month’s plan</h2><button class="ju-btn ghost sm" data-plan>Edit</button></div>
    <div class="plan-top">
      <div><small>Comes in</small><b class="num">${esc(money(p.income))}</b></div>
      <div><small>Planned</small><b class="num">${esc(money(p.planned))}</b></div>
      <div><small>To save</small><b class="num ${p.saving < 0 ? 'bad' : 'ok'}">${esc(money(p.saving))}</b></div>
    </div>
    ${p.groups.map(g => `<div class="ju-group"><span>${esc(g.label)}</span></div>${g.rows.map(row).join('')}`).join('')}
    ${p.unplanned ? `<div class="plan-unplanned ju-muted ju-small">${icon('info')} ${esc(money(p.unplanned))} spent on things not in the plan</div>` : ''}
    <div class="plan-foot"><span>Left this month</span><strong class="num ${p.left < 0 ? 'bad' : ''}">${esc(money(p.left))}</strong></div>
  </div>`;
}
