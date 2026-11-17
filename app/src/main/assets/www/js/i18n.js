// Hindi and Gujarati. The app is written in English; when another language is chosen, the words on
// screen are swapped as they appear (whole labels only — amounts, dates and your own notes stay as
// they are). A label without a translation simply stays in English.

const WORDS = {
  // English: [Hindi, Gujarati]
  'Summary': ['सारांश', 'સારાંશ'],
  'Transactions': ['लेन-देन', 'વ્યવહારો'],
  'Insights': ['विश्लेषण', 'વિશ્લેષણ'],
  'Settings': ['सेटिंग्स', 'સેટિંગ્સ'],
  'New Transaction': ['नया लेन-देन', 'નવો વ્યવહાર'],
  'Expense': ['खर्च', 'ખર્ચ'],
  'Income': ['आमदनी', 'આવક'],
  'Transfer': ['ट्रांसफ़र', 'ટ્રાન્સફર'],
  'Loan': ['उधार', 'ઉધાર'],
  'New Expense': ['नया खर्च', 'નવો ખર્ચ'],
  'New Income': ['नई आमदनी', 'નવી આવક'],
  'Edit Expense': ['खर्च बदलें', 'ખર્ચ બદલો'],
  'Cancel': ['रद्द करें', 'રદ કરો'],
  'Done': ['हो गया', 'થઈ ગયું'],
  'Add': ['जोड़ें', 'ઉમેરો'],
  'Save': ['सेव करें', 'સેવ કરો'],
  'Delete': ['हटाएँ', 'કાઢી નાખો'],
  'Edit': ['बदलें', 'બદલો'],
  'Back': ['पीछे', 'પાછા'],
  'More': ['और', 'વધુ'],
  'OK': ['ठीक है', 'બરાબર'],
  'Undo': ['वापस लें', 'પાછું લો'],
  'Continue': ['आगे बढ़ें', 'આગળ વધો'],
  'Not Now': ['अभी नहीं', 'હમણાં નહીં'],
  'Hide': ['छिपाएँ', 'છુપાવો'],
  'Today': ['आज', 'આજે'],
  'Yesterday': ['कल', 'ગઈકાલે'],
  'This week': ['इस हफ़्ते', 'આ અઠવાડિયે'],
  'Daily avg': ['रोज़ का औसत', 'દૈનિક સરેરાશ'],
  'Balance': ['बचत', 'બચત'],
  'Recent': ['हाल के', 'તાજેતરના'],
  'See All': ['सब देखें', 'બધું જુઓ'],
  'Budgets': ['बजट', 'બજેટ'],
  'Coming up': ['आने वाले', 'આવનારા'],
  'Heads Up': ['ध्यान दें', 'ધ્યાન આપો'],
  'Bank Balances': ['बैंक बैलेंस', 'બેંક બેલેન્સ'],
  'Where it went': ['पैसा कहाँ गया', 'પૈસા ક્યાં ગયા'],
  'Safe to spend today': ['आज इतना खर्च कर सकते हैं', 'આજે આટલું ખર્ચી શકો'],
  'Set a monthly budget': ['महीने का बजट तय करें', 'મહિનાનું બજેટ નક્કી કરો'],
  'Getting started': ['शुरुआत', 'શરૂઆત'],
  'Add your first expense': ['पहला खर्च जोड़ें', 'પહેલો ખર્ચ ઉમેરો'],
  'Let it read bank messages': ['बैंक मैसेज पढ़ने दें', 'બેંક મેસેજ વાંચવા દો'],
  'Connect bank emails': ['बैंक ईमेल जोड़ें', 'બેંક ઈમેલ જોડો'],
  'Make a quick button': ['एक झटपट बटन बनाएँ', 'એક ઝટપટ બટન બનાવો'],
  'Keep a backup': ['बैकअप रखें', 'બેકઅપ રાખો'],
  'Turn On': ['चालू करें', 'ચાલુ કરો'],
  'Connect': ['जोड़ें', 'જોડો'],
  'Set Up': ['सेट करें', 'સેટ કરો'],
  'Set': ['तय करें', 'નક્કી કરો'],
  'Make': ['बनाएँ', 'બનાવો'],
  'Scan Bill': ['बिल स्कैन करें', 'બિલ સ્કેન કરો'],
  'Speak': ['बोलें', 'બોલો'],
  'Add Photo': ['फ़ोटो जोड़ें', 'ફોટો ઉમેરો'],
  'Photo': ['फ़ोटो', 'ફોટો'],
  'Add a note': ['नोट लिखें', 'નોંધ લખો'],
  'Split the Bill': ['बिल बाँटें', 'બિલ વહેંચો'],
  'Trip or Event': ['यात्रा या कार्यक्रम', 'પ્રવાસ કે પ્રસંગ'],
  'Business Expense (GST)': ['बिज़नेस खर्च (GST)', 'બિઝનેસ ખર્ચ (GST)'],
  'Business': ['बिज़नेस', 'બિઝનેસ'],
  'Add GST': ['GST जोड़ें', 'GST ઉમેરો'],
  'Warranty': ['वारंटी', 'વોરંટી'],
  'Repeat': ['दोहराएँ', 'પુનરાવર્તન'],
  'Tax Saving': ['टैक्स बचत', 'ટેક્સ બચત'],
  'Not for Tax': ['टैक्स के लिए नहीं', 'ટેક્સ માટે નહીં'],
  'Plan': ['योजना', 'યોજના'],
  'Organise': ['व्यवस्थित करें', 'ગોઠવો'],
  'Preferences': ['पसंद', 'પસંદગી'],
  'Everyday': ['रोज़ के लिए', 'રોજ માટે'],
  'Your data': ['आपका डेटा', 'તમારો ડેટા'],
  'Payments': ['भुगतान', 'ચુકવણી'],
  'Bank Messages': ['बैंक मैसेज', 'બેંક મેસેજ'],
  'Categories': ['श्रेणियाँ', 'શ્રેણીઓ'],
  'Accounts': ['खाते', 'ખાતાં'],
  'Currency': ['मुद्रा', 'ચલણ'],
  'Appearance': ['दिखावट', 'દેખાવ'],
  'Language': ['भाषा', 'ભાષા'],
  'Repeating': ['दोहराए जाने वाले', 'પુનરાવર્તિત'],
  'App Lock': ['ऐप लॉक', 'એપ લૉક'],
  'Daily Reminder': ['रोज़ की याद', 'રોજનું રિમાઇન્ડર'],
  'Remind me at': ['याद दिलाएँ', 'યાદ અપાવો'],
  'Evening Note': ['शाम का हिसाब', 'સાંજનો હિસાબ'],
  'Hide Amounts': ['रकम छिपाएँ', 'રકમ છુપાવો'],
  'Quick Buttons': ['झटपट बटन', 'ઝટપટ બટન'],
  'Family': ['परिवार', 'પરિવાર'],
  'Family Sharing': ['परिवार के साथ', 'પરિવાર સાથે'],
  'Invite Family on WhatsApp': ['WhatsApp पर परिवार को बुलाएँ', 'WhatsApp પર પરિવારને બોલાવો'],
  'Join with an Invite': ['निमंत्रण से जुड़ें', 'આમંત્રણથી જોડાઓ'],
  'Your Name': ['आपका नाम', 'તમારું નામ'],
  'Spent this month': ['इस महीने खर्च', 'આ મહિને ખર્ચ'],
  'Net Worth': ['कुल संपत्ति', 'કુલ સંપત્તિ'],
  'You own': ['आपके पास', 'તમારી પાસે'],
  'You owe': ['आपको देना है', 'તમારે આપવાનું'],
  'Investments': ['निवेश', 'રોકાણ'],
  'Cash & bank': ['नकद और बैंक', 'રોકડ અને બેંક'],
  'Credit card dues': ['क्रेडिट कार्ड बकाया', 'ક્રેડિટ કાર્ડ બાકી'],
  'No-Spend Challenges': ['बिना खर्च चुनौती', 'ખર્ચ વગરનો પડકાર'],
  'Start a Challenge': ['चुनौती शुरू करें', 'પડકાર શરૂ કરો'],
  'Your buttons': ['आपके बटन', 'તમારા બટન'],
  'You often add': ['आप अक्सर जोड़ते हैं', 'તમે વારંવાર ઉમેરો છો'],
  'Make a Button': ['बटन बनाएँ', 'બટન બનાવો'],
  'Business Expenses': ['बिज़नेस खर्च', 'બિઝનેસ ખર્ચ'],
  'Bills': ['बिल', 'બિલ'],
  'Goals': ['लक्ष्य', 'લક્ષ્ય'],
  'Calendar': ['कैलेंडर', 'કેલેન્ડર'],
  'Warranties': ['वारंटी', 'વોરંટી'],
  'Trips & Events': ['यात्राएँ और कार्यक्रम', 'પ્રવાસ અને પ્રસંગો'],
  'Lent & Borrowed': ['दिया और लिया', 'આપ્યું અને લીધું'],
  'Loans & EMIs': ['लोन और EMI', 'લોન અને EMI'],
  'Regular payments': ['नियमित भुगतान', 'નિયમિત ચુકવણી'],
  'Backup & Sync': ['बैकअप और सिंक', 'બેકઅપ અને સિંક'],
  'Export to Excel (CSV)': ['Excel (CSV) में निकालें', 'Excel (CSV) માં કાઢો'],
  'Back Up': ['बैकअप लें', 'બેકઅપ લો'],
  'Restore from Backup': ['बैकअप से वापस लाएँ', 'બેકઅપમાંથી પાછું લાવો'],
  'Import from CSV': ['CSV से लाएँ', 'CSV માંથી લાવો'],
  'Erase All Data': ['सारा डेटा मिटाएँ', 'બધો ડેટા ભૂંસી નાખો'],
  'Your UPI ID': ['आपकी UPI ID', 'તમારી UPI ID'],
  'Read Bank SMS': ['बैंक SMS पढ़ें', 'બેંક SMS વાંચો'],
  'Add Without Asking': ['बिना पूछे जोड़ें', 'પૂછ્યા વગર ઉમેરો'],
  'Notify Me': ['मुझे बताएँ', 'મને જણાવો'],
  'Check Messages Now': ['अभी मैसेज देखें', 'હમણાં મેસેજ જુઓ'],
  'Bank Emails': ['बैंक ईमेल', 'બેંક ઈમેલ'],
  'Paste a Bank Message': ['बैंक मैसेज चिपकाएँ', 'બેંક મેસેજ પેસ્ટ કરો'],
  'Learned': ['सीखा हुआ', 'શીખેલું'],
  'Automatic': ['अपने आप', 'આપમેળે'],
  'Light': ['हल्का', 'આછું'],
  'Dark': ['गहरा', 'ઘેરું'],
  'Glass': ['ग्लास', 'ગ્લાસ'],
  'What’s New': ['नया क्या है', 'નવું શું છે'],
  'Week': ['हफ़्ता', 'અઠવાડિયું'],
  'Month': ['महीना', 'મહિનો'],
  'Year': ['साल', 'વર્ષ'],
  'Paid With': ['किससे दिया', 'શેનાથી ચૂકવ્યું'],
  'Received In': ['कहाँ आया', 'ક્યાં આવ્યું'],
  'Date': ['तारीख़', 'તારીખ'],
  'Food & Dining': ['खाना-पीना', 'ખાવા-પીવાનું'],
  'Groceries': ['किराना', 'કરિયાણું'],
  'Transport': ['आना-जाना', 'આવવા-જવાનું'],
  'Fuel': ['पेट्रोल', 'પેટ્રોલ'],
  'Shopping': ['ख़रीदारी', 'ખરીદી'],
  'Bills & Utilities': ['बिल और सुविधाएँ', 'બિલ અને સુવિધાઓ'],
  'Rent & Home': ['किराया और घर', 'ભાડું અને ઘર'],
  'Health': ['सेहत', 'આરોગ્ય'],
  'Entertainment': ['मनोरंजन', 'મનોરંજન'],
  'Education': ['पढ़ाई', 'ભણતર'],
  'Travel': ['यात्रा', 'પ્રવાસ'],
  'Subscriptions': ['सब्सक्रिप्शन', 'સબ્સ્ક્રિપ્શન'],
  'Gifts & Donations': ['उपहार और दान', 'ભેટ અને દાન'],
  'Other': ['अन्य', 'અન્ય'],
  'Salary': ['तनख़्वाह', 'પગાર'],
  'Freelance': ['फ़्रीलांस', 'ફ્રીલાન્સ'],
  'Gifts': ['उपहार', 'ભેટ'],
  'Refunds': ['रिफ़ंड', 'રિફંડ'],
  'Cash': ['नकद', 'રોકડ'],
  'Bank': ['बैंक', 'બેંક'],
  'Credit Card': ['क्रेडिट कार्ड', 'ક્રેડિટ કાર્ડ'],
  'Bank Charges': ['बैंक चार्ज', 'બેંક ચાર્જ'],
  'Refunds': ['रिफ़ंड', 'રિફંડ'],
  'Cashback & Points': ['कैशबैक और पॉइंट', 'કેશબેક અને પોઇન્ટ'],
  'Shopping List': ['ख़रीदारी की सूची', 'ખરીદીની યાદી'],
  'Documents & Renewals': ['दस्तावेज़ और नवीनीकरण', 'દસ્તાવેજો અને રિન્યુઅલ'],
  'Your Year': ['आपका साल', 'તમારું વર્ષ'],
  'Ways to save': ['बचत के तरीके', 'બચતના રસ્તા'],
  'Salary Day': ['तनख़्वाह का दिन', 'પગારનો દિવસ'],
  'Pay with UPI': ['UPI से भुगतान', 'UPI થી ચૂકવો'],
  'Expect a Refund': ['रिफ़ंड का इंतज़ार', 'રિફંડની રાહ'],
  'Add to the List': ['सूची में जोड़ें', 'યાદીમાં ઉમેરો'],
};

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिंदी (Hindi)' },
  { value: 'gu', label: 'ગુજરાતી (Gujarati)' },
];

let column = -1;          // 0 = Hindi, 1 = Gujarati, -1 = English
let observer = null;
const originals = new WeakMap(); // text node → its English, so switching back (or again) works
const written = new WeakMap();   // text node → what was last put in it here
const ATTRS = ['placeholder', 'aria-label', 'title'];

function swap(english) {
  const key = english.trim();
  const row = WORDS[key];
  if (!row || column < 0) return null;
  return english.replace(key, row[column]);
}

function doText(node, changed = false) {
  if (changed && written.get(node) !== node.nodeValue) originals.delete(node); // the app wrote new words
  const english = originals.has(node) ? originals.get(node) : node.nodeValue;
  if (!english || !english.trim()) return;
  const to = column < 0 ? english : swap(english);
  if (to === null) return;
  if (!originals.has(node)) originals.set(node, english);
  written.set(node, to);
  if (node.nodeValue !== to) node.nodeValue = to;
}

function doElement(el) {
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const keep = `data-en-${a}`;
    const english = el.getAttribute(keep) || el.getAttribute(a);
    const to = column < 0 ? english : swap(english);
    if (to === null) continue;
    if (!el.hasAttribute(keep)) el.setAttribute(keep, english);
    if (el.getAttribute(a) !== to) el.setAttribute(a, to);
  }
}

function walk(root) {
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1 || root.closest('input,textarea,[data-no-translate]')) return;
  doElement(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    if (n.nodeType === 3) doText(n);
    else doElement(n);
  }
}

/** Switches the words on screen: 'en', 'hi' or 'gu'. */
export function setLanguage(code) {
  column = code === 'hi' ? 0 : code === 'gu' ? 1 : -1;
  document.documentElement.lang = code === 'hi' ? 'hi' : code === 'gu' ? 'gu' : 'en';
  if (column >= 0 && !observer) {
    observer = new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target, true);
        else for (const n of m.addedNodes) walk(n);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  walk(document.body);
  if (column < 0 && observer) { observer.disconnect(); observer = null; }
}

export const hasWord = english => !!WORDS[english];
