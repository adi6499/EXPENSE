# Expenses — Android app

A simple, Apple-style expense tracker for Android. No account, no internet, no setup:
install it and start adding expenses. Everything is saved on the phone.

## Features

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

1. Copy `Expenses-v1.0.0.apk` to the phone (WhatsApp it to yourself, Google Drive, or USB).
2. Tap it. Android asks to allow installing from that app (Files / WhatsApp / Chrome) — allow it once.
3. Tap **Install**, then **Open**.

To share with friends, send them the same `.apk` file. Each person's data stays on their own phone.

## Updating

Build a new version (bump `versionCode` and `versionName` in `app/build.gradle.kts`), then install the
new `.apk` over the old one. Data is kept.

**Keep the `signing/` folder and `keystore.properties` safe (back them up).** Updates must be signed
with the same key; without it, people would have to uninstall (and lose data unless they made a backup)
to install a new version. These files are not in git on purpose.

## For developers

- Web UI: `app/src/main/assets/www` (plain HTML/CSS/JS modules, no build step)
- Native shell: `app/src/main/java/com/adi6499/expenses` (WebView, file save/share/open, app lock, reminders)
- Try it in a browser: `npm run serve` → http://localhost:5190 (add `?insets=28,16` to imitate phone bars)
- Tests: `npm test`
- Build the APK: `build.cmd` (uses the JDK and Android SDK under `C:\Users\Analyst Profile\Android`),
  output in `app\build\outputs\apk\release\app-release.apk`, log in `build.log`
