// TEST ONLY — never shipped in the app or the website. tools/serve.mjs adds this to the page
// when the address has ?fakenative, so the Android-only parts (bank SMS, notifications) can be
// tried in a computer browser. It pretends to be window.Native (NativeBridge.kt) with sample
// bank messages. In the console: __fakeSms('Rs 99 debited from A/c XX1234 to CHAI POINT', 'AX-HDFCBK')
(function () {
  const KEY = 'expenses-fake-native-data';
  const now = Date.now();
  const hour = 3600_000;
  let nextId = 100;
  const inbox = [
    ['AX-HDFCBK', 'Sent Rs.450.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 12/11/26\nRef 431234567801\nNot You?\nCall 18002586161', 30],
    ['JM-ICICIT', 'ICICI Bank Acct XX123 debited for Rs 1,299.00 on 12-Nov-26; AMAZON PAY credited. UPI:431234567802. Call 18002662 for dispute.', 26],
    ['AX-HDFCBK', '482913 is the OTP for txn of INR 999.00 at FLIPKART on HDFC Bank card ending 1234. Do not share.', 20],
    ['AD-SBIINB', 'Dear Customer, Your A/c XX5678 has been credited with INR 85,000.00 on 01-Nov-2026 towards SALARY NOV 2026. Avl Bal: INR 1,20,000.00', 300],
    ['VM-KOTAKB', 'Received Rs.2,000.00 in your Kotak Bank AC X9012 from rahul.sharma@okaxis on 12-11-26.UPI Ref:431234567803.', 5],
    ['+919876543210', 'Paid Rs 500 for dinner, send me your share', 4],
    ['AX-SBICRD', 'Rs.3,240.00 spent on your SBI Credit Card ending 4321 at INDIAN OIL on 12/11/26. Trxn. Ref No. 123456789.', 3],
    ['AX-HDFCBK-P', 'Get a pre-approved personal loan of Rs 5,00,000 credited instantly! Apply now', 2],
    ['AD-ATMSBI', 'Dear Customer, Rs.2000 withdrawn at SBI ATM S1ANxxx from A/cX5678 on 12Nov26 Transaction Number 1234. Available Balance Rs.10000.', 1],
    ['AX-HDFCBK', 'Your HDFC Bank Credit Card XX4321 statement: Total due Rs 12,345, Min due Rs 620, due date ' + new Date(now + 2 * 86400000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-'), 6],
    ['VM-AIRTEL', 'Your Airtel postpaid bill of Rs 499 is due on ' + new Date(now + 9 * 86400000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-') + '. Pay now.', 7],
    ['AX-HDFCBK', 'Rs 5000.00 debited from a/c XX1234 on 12-11-26 towards HDFC Credit Card bill payment. Avl Bal Rs 42,180.50', 8],
  ].map(([address, body, hoursAgo]) => ({ id: String(nextId++), address, body, date: now - hoursAgo * hour }));

  const reply = (id, payload) => setTimeout(() => window.__native && window.__native.resolve(id, payload), 120);
  let granted = false;
  let shared = new URLSearchParams(location.search).get('share') || '';

  window.Native = {
    ready() {},
    consumeLaunchAction() { return new URLSearchParams(location.search).get('action') || ''; },
    getInsets() { return JSON.stringify({ top: 28, bottom: 16 }); },
    appVersion() { return '1.1.0 (test)'; },
    loadData() { return localStorage.getItem(KEY) || ''; },
    saveData(json) { localStorage.setItem(KEY, json); return true; },
    saveFile(id) { reply(id, { ok: true }); },
    shareFile(id) { reply(id, { ok: true }); },
    openFile(id) { reply(id, { ok: false, cancelled: true }); },
    canLock() { return false; },
    authenticate(id) { reply(id, { ok: true }); },
    haptic() {},
    isSystemDark() { return matchMedia('(prefers-color-scheme: dark)').matches; },
    setAppearance() {},
    setReminder(id) { reply(id, { ok: true }); },
    smsStatus() { return granted ? 'granted' : 'denied'; },
    requestSms(id) { granted = true; reply(id, { ok: true }); },
    readSms(id, since) {
      const from = Number(since) || 0;
      reply(id, { ok: true, messages: inbox.filter(m => m.date > from) });
    },
    setSmsOptions(enabled, notify) { console.log('[fake] setSmsOptions', enabled, notify); },
    requestNotifications(id) { reply(id, { ok: true }); },
    openAppSettings() { console.log('[fake] openAppSettings'); },
    consumeSharedText() { const text = shared; shared = ''; return text; },
    canListen() { return true; },
    listen(id) { reply(id, { ok: true, text: window.__fakeSpeech || 'spent 450 on petrol yesterday' }); },
    shareBase64(id) { reply(id, { ok: true }); },
    saveBase64(id) { reply(id, { ok: true }); },
    setBillReminders(json) { window.__lastReminders = JSON.parse(json); },
    updateWidget(today, month, line) { window.__widget = { today, month, line }; },
    cleanPhotos() {},
    scanBill(id) {
      const c = document.createElement('canvas'); c.width = 60; c.height = 80; c.getContext('2d').fillRect(10, 10, 40, 60);
      const text = ['SHREE SAGAR RESTAURANT', 'MG Road, Pune', 'TAX INVOICE', 'Date: ' + new Date().toLocaleDateString('en-GB'),
        'Paneer Tikka 280.00', 'Sub Total 480.00', 'CGST 12.00', 'Grand Total  Rs 504.00'].join(String.fromCharCode(10));
      reply(id, { ok: true, dataUrl: c.toDataURL('image/jpeg'), text });
    },
    shareImageText(id, fileName, base64, text) { window.__shared = { fileName, size: base64.length, text }; reply(id, { ok: true }); },
    printHtml(id, html) { window.__printed = html.length; reply(id, { ok: true }); },
    pickBackupFolder(id) { reply(id, { ok: true, uri: 'content://fake/tree', name: 'Documents' }); },
    writeBackup(id, fileName, text) { window.__backups = (window.__backups || []).concat(fileName + ':' + text.length); reply(id, { ok: true }); },
  };

  // A new message arriving while the app is open
  window.__fakeSms = (body, address = 'AX-HDFCBK') => {
    inbox.push({ id: String(nextId++), address, body, date: Date.now() });
    if (window.__onSms) window.__onSms();
  };
  // Pretend SMS access was already allowed (as after a previous run)
  if (localStorage.getItem(KEY) && /"enabled":true/.test(localStorage.getItem(KEY))) granted = true;
})();
