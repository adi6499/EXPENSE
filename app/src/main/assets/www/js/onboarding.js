// First launch: a welcome screen, then currency + optional budget.
import { store } from './store.js';
import * as L from './logic.js';
import { $, esc, icon, tile, actionSheet, pickAmount, haptic } from './ui.js';
import { appGlyph, restore } from './settings.js';

export function showOnboarding(onDone) {
  const el = document.createElement('div');
  el.className = 'onboard';
  document.body.appendChild(el);

  const finish = () => {
    store.setSetting('onboarded', true);
    haptic('success');
    el.classList.add('leave');
    setTimeout(() => el.remove(), 380);
    onDone();
  };

  function welcome() {
    el.innerHTML = `
      <div class="onboard-body fade-in">
        <div class="app-icon">${appGlyph()}</div>
        <h1>Know where your<br><span>money goes.</span></h1>
        <div class="feature" style="--c:var(--orange)">${icon('lightning', true)}<div><strong>Add in two seconds</strong><p>A big number pad, smart categories and notes that remember.</p></div></div>
        <div class="feature" style="--c:var(--blue)">${icon('chart-pie-slice', true)}<div><strong>See it clearly</strong><p>Budgets, monthly trends and where every rupee went.</p></div></div>
        <div class="feature" style="--c:var(--green)">${icon('lock-simple', true)}<div><strong>Private by design</strong><p>Everything stays on your device. No account, no sign-up, works offline.</p></div></div>
      </div>
      <div class="onboard-actions">
        <button class="btn" data-next>Continue</button>
        <button class="btn plain" data-restore>Restore from a backup</button>
      </div>`;
  }

  function setup() {
    const s = store.state.settings;
    const currency = L.currencyInfo(s.currency);
    const budget = store.state.budgets.monthly;
    el.innerHTML = `
      <div class="onboard-body fade-in">
        <div class="onboard-step-title">Quick setup</div>
        <div class="onboard-step-sub">You can change these any time in Settings.</div>
        <div class="section" style="margin:0 0 28px">
          <div class="list">
            <button class="row tap" data-currency>${tile('coins', 'yellow')}<div class="row-main"><span class="row-title" style="flex:1">Currency</span><span class="row-value">${esc(currency.code)} ${esc(currency.symbol)}</span><i class="ph ph-caret-right row-chevron"></i></div></button>
            <button class="row tap" data-budget>${tile('target', 'red')}<div class="row-main"><span class="row-title" style="flex:1">Monthly budget</span><span class="row-value">${budget ? esc(store.money(budget)) : 'Optional'}</span><i class="ph ph-caret-right row-chevron"></i></div></button>
          </div>
          <div class="section-footer">A budget is the most you want to spend in a month. The app shows how much is left.</div>
        </div>
      </div>
      <div class="onboard-actions">
        <button class="btn" data-finish>Get Started</button>
      </div>`;
  }

  el.addEventListener('click', async e => {
    if (e.target.closest('[data-next]')) { haptic('light'); setup(); return; }
    if (e.target.closest('[data-finish]')) { finish(); return; }
    if (e.target.closest('[data-restore]')) {
      if (await restore()) finish();
      return;
    }
    if (e.target.closest('[data-currency]')) {
      const choice = await actionSheet({
        title: 'Currency',
        actions: L.CURRENCIES.map(c => ({ text: `${c.symbol}  ${c.name}`, value: c.code, checked: c.code === store.state.settings.currency })),
      });
      if (choice) { store.setSetting('currency', choice); setup(); }
      return;
    }
    if (e.target.closest('[data-budget]')) {
      const value = await pickAmount({ title: 'Monthly Budget', subtitle: 'The most you want to spend in a month', initial: store.state.budgets.monthly, currency: store.currency });
      if (value !== null) { store.setMonthlyBudget(value); setup(); }
    }
  });

  welcome();
  return el;
}
