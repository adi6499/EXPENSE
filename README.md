# Expenses — Android app

A simple, Apple-style expense tracker for Android. No account, no internet, no setup:
install it and start adding expenses. Everything is saved on the phone.

## Features

- **Bank SMS, read for you** (Android): turn on Settings → Bank Messages → Read Bank SMS. Every "Rs 500 debited…" /
  "credited…" message from your bank becomes a transaction — amount, payee, bank, card or account, a guessed category.
  New ones wait on Summary under **From Messages** (tap to check, ⊕ to add, swipe to ignore), or turn on
  **Add Without Asking**. A notification shows "₹500 spent — tap to add" when the app is closed. OTPs, bills due,
  payment requests, failed payments, offers and messages from people are skipped. You can also share any bank message
  to Expenses from the Messages app, or paste one (Settings → Paste a Bank Message).
- **Learns as you go**: what you pick for a payee (category, your own name for it) and which account each card or
  bank account belongs to. Add the same payee twice with the same category and it's added automatically from then on;
  ignore it twice and it's skipped. Settings → Bank Messages → **Learned** shows all of it, and you can change or forget any.
- **Add in seconds**: big number pad, category strip, notes that remember (typing "Swiggy" picks Food & UPI again)
- **Summary**: spent this month, budget ring, income and balance, today / this week / daily average, where the money went
- **Transactions**: search, filter by period / category / account, grouped by day, swipe left to delete (with Undo)
- **Insights**: week / month / year charts, spending by category, income vs spending, biggest expenses
- **Budgets**: one monthly budget plus optional per-category limits
- **Repeating**: rent, salary, subscriptions are added automatically every week / month / year
- **Accounts**: Cash, UPI, Bank, Card (add your own, with starting balances)
- **App Lock** with fingerprint / face / phone PIN
- **Daily reminder** notification
- **Export to Excel (CSV)**, **Back Up / Restore** (share to Google Drive or WhatsApp), **Import from CSV**
  (the old Google Sheet tracker's columns and most bank statements work)
- Light and dark mode, Android back button, "Add expense" shortcut on long-press of the app icon

## Installing on a phone

1. Copy `Expenses-v1.1.0.apk` to the phone (WhatsApp it to yourself, Google Drive, or USB).
2. Tap it. Android asks to allow installing from that app (Files / WhatsApp / Chrome) — allow it once.
3. Tap **Install**, then **Open**.

Because the app can read SMS, **Google Play Protect may block the install** when the file comes from WhatsApp, a
browser or a file manager (India's fraud-protection pilot blocks apps asking for SMS access from those sources).
If it does: in the Play Store app, tap your profile picture → **Play Protect** → ⚙ → turn off **Scan apps with
Play Protect**, install, then turn it back on. Or install from a computer over USB with `adb install -r Expenses-v1.1.0.apk`.
If Android later says SMS access is a "restricted setting", open the phone's Settings → Apps → Expenses → ⋮ →
**Allow restricted settings**, then turn on Read Bank SMS again.

To share with friends, send them the same `.apk` file. Each person's data stays on their own phone.

## Updating

Build a new version (bump `versionCode` and `versionName` in `app/build.gradle.kts`), then install the
new `.apk` over the old one. Data is kept.

**Keep the `signing/` folder and `keystore.properties` safe (back them up).** Updates must be signed
with the same key; without it, people would have to uninstall (and lose data unless they made a backup)
to install a new version. These files are not in git on purpose.

## Website version

The same screens also run as a website, so it works on any phone, tablet or computer, with no install needed.

- On a computer it shows a sidebar, panels open as centred dialogs, and you can type amounts on the keyboard
  (**N** = new transaction, **Enter** = save, **Esc** = close).
- It can be installed like an app (Settings → Install App, or "Add to Home Screen" on iPhone) and works offline.
- **Bank messages on the website**: a website can't read text messages, so paste one (Settings → Paste a Bank
  Message), or on iPhone set up a Shortcuts automation (Settings → iPhone Automation) that opens
  `<site>/#sms=<the message>` for every bank SMS. The part after `#` never leaves the device.
- Data is saved in that browser on that device only. Clearing the browser's data deletes it, so use Back Up now and then.
  To move to another device, back up there and restore here.

**Publishing (Vercel):** `vercel.json` tells Vercel to serve `app/src/main/assets/www` as it is (no build step) and
adds security headers. Import this GitHub repo once at vercel.com/new and every push updates the site.

If you edit the small inline script in `index.html`, run `npm test`: it prints the new security fingerprint to put in `vercel.json`.

## For developers

- Web UI: `app/src/main/assets/www` (plain HTML/CSS/JS modules, no build step)
- Native shell: `app/src/main/java/com/adi6499/expenses` (WebView, file save/share/open, app lock, reminders,
  `BankSms.kt` = SMS inbox reading, the new-SMS notification and the share target)
- Bank message reading and learning: `js/sms.js` (pure functions, tested in `tests/sms.test.js`); screens in `js/messages.js`
- Try it in a browser: `npm run serve` → http://localhost:5190 (add `?insets=28,16` to imitate phone bars).
  `?fakenative` pretends to be the Android app with sample bank SMS (`tools/fake-native.js`, test only, never shipped);
  in the console, `__fakeSms('Rs 99 debited from A/c XX1234 to CHAI POINT', 'AX-HDFCBK')` delivers a new one.
- Tests: `npm test`
- Build the APK: `build.cmd` (uses the JDK and Android SDK under `C:\Users\Analyst Profile\Android`),
  output in `app\build\outputs\apk\release\app-release.apk`, log in `build.log`
