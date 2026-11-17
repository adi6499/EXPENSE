// Reads the text messages banks send ("Rs 500 debited from A/c XX1234 to ZOMATO …") and picks
// out the amount, whether money went out or came in, the bank, the account's last digits and who
// it was paid to. Also guesses a category and account for it.
// Pure functions only: no DOM, no storage. Unit-tested in tests/sms.test.js.
import { toISO, addDays, daysBetween, parseFlexibleDate, isFeeText } from './logic.js';

// ---------- Senders

const BANKS = [
  [/^(SBICRD|SBICARD|SBIC)/, 'SBI Card'],
  [/^(SBI|ATMSBI|CBSSBI|SBMSMS|SBIPSG|SBYONO)/, 'SBI'],
  [/^HDFC/, 'HDFC Bank'],
  [/^ICICI/, 'ICICI Bank'],
  [/^AXIS/, 'Axis Bank'],
  [/^(KOTAK|KMBL)/, 'Kotak'],
  [/^PNB/, 'PNB'],
  [/^(BOBCRD|BOBCARD)/, 'BoB Card'],
  [/^(BOB|BARODA)/, 'Bank of Baroda'],
  [/^BOI/, 'Bank of India'],
  [/^(CANBNK|CANARA)/, 'Canara Bank'],
  [/^(UNION|UBOI|UBI)/, 'Union Bank'],
  [/^IDFC/, 'IDFC First'],
  [/^INDUS/, 'IndusInd'],
  [/^YES/, 'Yes Bank'],
  [/^(PAYTM|PYTM)/, 'Paytm'],
  [/^(AIRBNK|AIRPBK)/, 'Airtel Payments Bank'],
  [/^FED/, 'Federal Bank'],
  [/^CENT/, 'Central Bank'],
  [/^IOB/, 'IOB'],
  [/^(INDBNK|INDIAN)/, 'Indian Bank'],
  [/^(AUBANK|AUSFB)/, 'AU Bank'],
  [/^RBL/, 'RBL Bank'],
  [/^AMEX/, 'Amex'],
  [/^HSBC/, 'HSBC'],
  [/^CITI/, 'Citi'],
  [/^(SCBANK|STANC|SCB)/, 'Standard Chartered'],
  [/^DBS/, 'DBS'],
  [/^KVB/, 'KVB'],
  [/^IDBI/, 'IDBI Bank'],
  [/^(MAHB|MAHABK)/, 'Bank of Maharashtra'],
  [/^UCO/, 'UCO Bank'],
  [/^(JKB|JKBANK)/, 'J&K Bank'],
  [/^SIB/, 'South Indian Bank'],
  [/^(KBL|KARBNK)/, 'Karnataka Bank'],
  [/^(EQUITAS|EQTS)/, 'Equitas'],
  [/^UJJIVN/, 'Ujjivan'],
  [/^DCB/, 'DCB Bank'],
  [/^(BANDHN|BDNSMS|BANDHAN)/, 'Bandhan Bank'],
  [/^PSB/, 'Punjab & Sind Bank'],
  [/^TMB/, 'TMB'],
  [/^CSB/, 'CSB Bank'],
  [/^(ONECRD|ONECARD)/, 'OneCard'],
  [/^JUPITER/, 'Jupiter'],
  [/^SLICE/, 'Slice'],
  [/^FINO/, 'Fino'],
  [/^JIO(PB|PAY)/, 'Jio Payments Bank'],
  [/^(NSDLPB|NSDL)/, 'NSDL Bank'],
  [/^(CRED|CREDIN)/, 'CRED'],
];

/** True for a mobile number: messages from people, not from banks. */
export function isPersonalNumber(address) {
  const digits = String(address || '').replace(/[\s()-]/g, '');
  return /^\+?\d{10,}$/.test(digits);
}

/** 'AX-HDFCBK' / 'VM-HDFCBK-S' / 'HDFCBK' → 'HDFCBK'. Null for a mobile number. */
export function senderHeader(address) {
  const text = String(address || '').toUpperCase().trim();
  if (!text || isPersonalNumber(text)) return null;
  const parts = text.split('-').filter(Boolean);
  const header = parts.length >= 2 && parts[0].length === 2 ? parts[1] : parts[0];
  return (header || '').replace(/[^A-Z0-9]/g, '');
}

/** The bank's name from the sender, or '' when the sender is not a bank we know. */
export function bankName(address) {
  const header = senderHeader(address);
  if (!header) return '';
  for (const [re, name] of BANKS) if (re.test(header)) return name;
  return '';
}

// ---------- Reading one message

const CURRENCY_AMOUNT = /(?:₹|\b(?:rs|inr)(?![a-z])\.?)\s*:?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
const BARE_AMOUNT = /\b(?:debited|credited|debit|credit)\s+(?:by|for|with|of)\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i;
// Words just before an amount that make it a balance or limit, not the money that moved
const NOT_THE_AMOUNT = /(?:\bbal(?:ance)?|\bavl|\bavail(?:able)?|\blimit|\blmt|\boutstanding|\bdue)\b[^0-9]{0,14}$/i;

// Each word adds to the "money went out" or "money came in" score
const DEBIT_WORDS = [
  [/\bdebited\b/i, 3], [/\bspent\b/i, 3], [/\bwithdrawn\b|\bwithdrawal\b/i, 3], [/\bdeducted\b/i, 3],
  [/\bdebit\b/i, 2], [/\bpaid\b/i, 2], [/\bsent\b/i, 2], [/\bpurchased?\b/i, 2],
  [/\b(?:was|has been) used\b|\bused (?:at|for)\b|\busing your\b/i, 2], [/\btransferred to\b|\btrf to\b/i, 2],
  [/\bpayment (?:of|to)\b/i, 1], [/\b(?:txn|transaction)\b/i, 1], [/\bdr\b/i, 1],
];
const CREDIT_WORDS = [
  [/\bcredited\b/i, 3], [/\bdeposited\b/i, 3], [/\breceived\b/i, 2], [/\bcredit\b/i, 2],
  [/\brefund(?:ed)?\b/i, 2], [/\brevers(?:ed|al)\b/i, 2], [/\bcr\b/i, 1], [/\badded to\b/i, 1],
];

// Messages that mention money but are not a finished transaction
const NOT_A_TRANSACTION = [
  /\b(?:otp|one[\s-]?time[\s-]?password|verification code|passcode|cvv)\b/i,
  /\bwill be (?:debited|credited|charged|deducted|processed|reflected|refunded|auto-?debited)\b|\bwill reflect\b/i,
  /\bis due\b|\bdue (?:on|by|date)\b|\b(?:minimum|min|total|amount|amt) (?:amount |amt )?due\b|\bdue amount\b/i,
  /\b(?:has|have) requested\b|\brequested (?:money|rs|inr|₹|payment)|\bcollect request\b|\bpayment request\b|\brequest(?:ed)? (?:of|for) (?:rs|inr|₹)/i,
  /\bmandate\b.{0,60}\b(?:created|registered|set ?up|revoked|paused|cancell?ed|modified|approved)\b|\b(?:create|register|set ?up)\b.{0,40}\bmandate\b/i,
  /\b(?:failed|declined|unsuccessful|rejected|could not be|not been (?:processed|completed)|insufficient)\b/i,
  /\bpre-?approved\b|\beligible for\b|\bapply now\b|\bup to (?:rs|inr|₹)/i,
  /\bupcoming\b|\bscheduled (?:for|on)\b|\breminder\b/i,
  // Paying a card bill: the bank already sent "debited" for the same money
  /\bpayment\b.{0,60}\b(?:received|credited|successful|processed)\b.{0,80}\bcard\b|\bcard\b.{0,80}\bpayment\b.{0,60}\b(?:received|credited)\b|\breceived (?:your |a |the )?payment\b/i,
];

// 'A/c XX1234', 'A/cX1234', 'Acct XX123', 'card ending 1234', 'a/c no. XXXXXXXX1234', 'card ** 12345'
const ACCOUNT_DIGITS = /\b(?:a\/?c|acct|account|card|ac)(?![a-wyz])\.?\s*(?:no\.?|number|num)?\s*(?:ending(?: with| in)?)?\s*[:-]?\s*[x*•.\s]*?(\d{3,6})\b/i;
const REFERENCE = /\b(?:upi(?:\s*ref(?:erence)?)?(?:\s*no)?|ref(?:erence)?\.?\s*(?:no|number|#)?|refno|utr|rrn|imps ref(?:\s*no)?|txn\s*(?:id|no))\b[\s:.#-]*(?:is\s*)?([0-9]{6,})/i;
const UPI_INFO = /\bUPI[/-](?:P2[AM]|DR|CR)?[/-]?(\d{6,})[/-]([A-Za-z][^/|]{1,40})/i;

// Who the money went to or came from
const STOP = String.raw`(?=\s*(?:\b(?:on|ref|refno|reference|upi|via|using|avl|avail|available|from|to|dated?|thru|through|having|txn|transaction|is|has|with|at|not|if|for|in|by|and|imps|neft|rtgs|info|bal|value)\b|[(,;!|]|[.:](?:\s|$)|$))`;
const NAME = String.raw`([A-Za-z][A-Za-z0-9&'_*@./ -]{1,44}?)`;
const PAID_TO = new RegExp(String.raw`\b(trf to|transfer(?:red)? to|paid to|sent to|payment to|to vpa|at|to|towards|on)\s+${NAME}${STOP}`, 'gi');
const RECEIVED_FROM = new RegExp(String.raw`\b(from vpa|received from|from|by|towards)\s+${NAME}${STOP}`, 'gi');
const ICICI_STYLE = new RegExp(String.raw`;\s*${NAME}\s+credited\b`, 'i');
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const NOT_A_NAME = new RegExp(String.raw`^(?:your|ur|you|a\/?c|ac|acct|account|card|the|upi|rs|inr|mobile|date|beneficiary|self|net ?banking|imps|neft|rtgs|ref|xx|atm|vpa)(?![a-z])|\b(?:a\/?c|acct|account|card|ending|linked|wallet balance)\b|\d{1,2}[-/ ]?(?:${MONTHS})|^(?:${MONTHS})[a-z]*\.?\s+\d{1,2}\b|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|^[x*]+\d`, 'i');
// Card alerts by email: "… at 10:20:30. Info: AMAZON."
const INFO_NAME = /\binfo\s*[:.-]\s*([A-Za-z][A-Za-z0-9&'_*@./ -]{1,40}?)(?=\s*(?:[.,;|]\s|[.,;|]?$|\bon\b|\bat\b))/i;

function cleanText(body) {
  return String(body || '')
    .replace(/\r/g, '')
    .replace(/\s*\n\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:credit|debit)\s*card/gi, 'card')
    .replace(/\bcredit\s*(?:limit|lmt|score|line)/gi, 'limit')
    .trim();
}

function toMinor(text) {
  const value = parseFloat(String(text).replace(/,/g, ''));
  if (!isFinite(value)) return 0;
  return Math.round(value * 100);
}

/** The money that moved: the first amount that isn't a balance or a limit. */
export function findAmount(text) {
  CURRENCY_AMOUNT.lastIndex = 0;
  let m;
  while ((m = CURRENCY_AMOUNT.exec(text))) {
    if (NOT_THE_AMOUNT.test(text.slice(Math.max(0, m.index - 30), m.index))) continue;
    const minor = toMinor(m[1]);
    if (minor > 0) return minor;
  }
  const bare = text.match(BARE_AMOUNT);
  return bare ? toMinor(bare[1]) : 0;
}

/** 'expense' (money out), 'income' (money in) or null. */
export function findDirection(text) {
  const score = words => {
    let total = 0;
    let first = Infinity;
    for (const [re, weight] of words) {
      const m = text.match(re);
      if (!m) continue;
      total += weight;
      if (weight >= 2) first = Math.min(first, m.index);
    }
    return { total, first };
  };
  const out = score(DEBIT_WORDS);
  const inn = score(CREDIT_WORDS);
  if (!out.total && !inn.total) return null;
  if (out.total !== inn.total) return out.total > inn.total ? 'expense' : 'income';
  return out.first <= inn.first ? 'expense' : 'income';
}

const LOWER_WORDS = new Set(['of', 'and', 'the', 'for', 'to', 'in', 'on', 'at', 'by']);

/** 'ZOMATO LTD' → 'Zomato', 'swiggy.stores@axisbank' → 'Swiggy Stores'. '' when it is just a code. */
export function prettyName(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, ' ');
  s = s.replace(/^(?:vpa|mr\.?|mrs\.?|ms\.?|m\/s\.?|shri|smt)\s+/i, '');
  if (s.includes('@')) {
    const local = s.split('@')[0];
    if (/\d{6,}/.test(local) || /^(?:paytmqr|bharatpe|q\d|gpay-|yespay|rzp|razorpay|mab\.|ombk|bhim|upi)/i.test(local)) return '';
    s = local.replace(/[._-]+/g, ' ').replace(/\d+$/, '').trim();
  }
  s = s.replace(/[\s.,;:*/-]+$/, '')
    .replace(/\s+(?:india\s+)?(?:pvt\.?|private)?\s*(?:ltd\.?|limited|llp|inc\.?)$/i, '')
    .replace(/\s+(?:pvt|private)$/i, '')
    .trim();
  if (!/[a-z]/i.test(s) || s.replace(/[^a-z]/gi, '').length < 2) return '';
  const shouting = s === s.toUpperCase() || s === s.toLowerCase();
  if (shouting) {
    s = s.toLowerCase().split(' ').map((w, i) => (i > 0 && LOWER_WORDS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return s.slice(0, 40).trim();
}

function firstName(re, text, accept) {
  re.lastIndex = 0;
  const strong = [];
  const weak = [];
  let m;
  while ((m = re.exec(text))) {
    const word = m[1].toLowerCase();
    const candidate = m[2].trim();
    if (!accept(word) || NOT_A_NAME.test(candidate)) continue;
    const name = prettyName(candidate);
    if (!name) continue;
    (word === 'on' || word === 'by' ? weak : strong).push(name);
  }
  return strong[0] || weak[0] || '';
}

/** Who was paid (expense) or who paid (income), or '' when the message doesn't say. */
export function findCounterparty(text, type) {
  const upi = text.match(UPI_INFO);
  if (upi) {
    // 'UPI/DR/431234567890/BIGBASKET. Total Avail.bal …' → 'BIGBASKET'
    const name = prettyName(upi[2].split(/[.,;:](?:\s|$)|\s+\||\s+(?:on|ref|avl|not you)\b/i)[0]);
    if (name && !NOT_A_NAME.test(upi[2])) return name;
  }
  if (type === 'expense') {
    const info = text.match(INFO_NAME);
    if (info && !NOT_A_NAME.test(info[1])) {
      const name = prettyName(info[1]);
      if (name) return name;
    }
    const icici = text.match(ICICI_STYLE);
    if (icici && !NOT_A_NAME.test(icici[1])) {
      const name = prettyName(icici[1]);
      if (name) return name;
    }
    return firstName(PAID_TO, text, () => true);
  }
  return firstName(RECEIVED_FROM, text, () => true);
}

function kindOf(text, address) {
  if (/\batm\b/i.test(text) && /\bwithdraw/i.test(text)) return 'atm';
  const header = senderHeader(address) || '';
  if (/(CRD|CARD|AMEX|ONECRD)/.test(header) || /\bcard\b/i.test(text)) return 'card';
  if (/\bupi\b|\bvpa\b|@[a-z]{2,}\b/i.test(text)) return 'upi';
  return 'bank';
}

/**
 * Reads one text message. Returns what was found, or null when it isn't a finished bank
 * transaction (OTPs, bills due, payment requests, failed payments, offers, messages from people).
 * options.trusted: the person shared this message themselves, so any sender is fine.
 */
export function parseBankSms(message, options = {}) {
  const { address = '', body = '', date = Date.now(), id = '' } = message || {};
  if (!body || typeof body !== 'string') return null;
  if (!options.trusted) {
    if (isPersonalNumber(address)) return null;
    if (/-P$/i.test(String(address).trim())) return null; // promotional sender
  }
  const text = cleanText(body);
  if (NOT_A_TRANSACTION.some(re => re.test(text))) return null;
  const type = findDirection(text);
  if (!type) return null;
  const amount = findAmount(text);
  if (!amount || amount > 1e11) return null;

  const bank = options.bank || bankName(address);
  const digits = text.match(ACCOUNT_DIGITS);
  const ref = (text.match(REFERENCE) || text.match(UPI_INFO) || [])[1] || '';
  const mentionsAccount = !!digits || !!ref || /\bupi\b|\bvpa\b|\bwallet\b|\ba\/c\b|\bacct\b/i.test(text);
  // A shop's "payment received for your order" isn't from your bank: skip unless it names an account
  if (!options.trusted && !bank && !mentionsAccount) return null;
  // An email that isn't from a bank (a shop's order mail) only counts if it names your account or card
  if (options.via === 'email' && !bank && !digits) return null;

  const kind = kindOf(text, address);
  let merchant = findCounterparty(text, type);
  if (kind === 'atm') merchant = 'Cash withdrawal';
  const when = Number(date) || Date.now();
  const finding = {
    id: String(id || `${address}|${when}`),
    type,
    amount,
    date: toISO(new Date(when)),
    time: when,
    merchant,
    bank: bank || (options.trusted ? '' : (senderHeader(address) || '')),
    last4: digits ? digits[1] : '',
    kind,
    ref,
    address: String(address || ''),
    body: String(body).trim().slice(0, 500),
  };
  if (options.via) finding.via = options.via;
  finding.transfer = transferKind(finding);
  if (finding.transfer === 'card' && !finding.merchant) finding.merchant = 'Card bill payment';
  // A bank charge (annual fee, SMS charges, late fee…) or cashback coming in
  if (type === 'expense' && !finding.transfer && isFeeText(text)) {
    finding.fee = true;
    if (!finding.merchant) finding.merchant = 'Bank charges';
  }
  if (type === 'income' && /\bcash ?back\b/i.test(text)) {
    finding.cashback = true;
    if (!finding.merchant) finding.merchant = 'Cashback';
  }
  return finding;
}

/** Reward points in a bank or card message: { key, bank, last4, points, earned, time } or null. */
export function parsePoints(message, options = {}) {
  const { address = '', body = '', date = Date.now() } = message || {};
  if (!body || isPersonalNumber(address)) return null;
  const text = cleanText(body);
  if (/\botp\b/i.test(text)) return null;
  const num = v => Number(String(v).replace(/,/g, ''));
  const total = text.match(/(?:total|available|accumulated|closing|current)\s+(?:reward\s+)?points?(?:\s+balance)?\s*(?:is|are|of|:|-)?\s*([\d,]+)/i)
    || text.match(/(?:reward\s+)?points?\s+balance\s*(?:is|of|:|-)?\s*([\d,]+)/i);
  const earned = text.match(/(?:earned|credited with|added|got|won)\s+([\d,]+)\s+(?:reward\s+|bonus\s+)?points?/i)
    || text.match(/([\d,]+)\s+(?:reward\s+|bonus\s+)?points?\s+(?:have been |has been )?(?:earned|credited|added)/i);
  if (!total && !earned) return null;
  const bank = options.bank || bankName(address);
  if (!bank) return null;
  const digits = text.match(ACCOUNT_DIGITS);
  const last4 = digits ? digits[1] : '';
  return { key: `${bank}|${last4}`, bank, last4, points: total ? num(total[1]) : null, earned: earned ? num(earned[1]) : 0, time: Number(date) || Date.now() };
}

// ---------- Category and account guesses

// Merchant words → the app's built-in category ids (only used when that category still exists)
const CATEGORY_WORDS = [
  ['salary', /\bsalary\b|\bsal\b.*\b(?:for|month)\b|\bpayroll\b/i, 'income'],
  ['refunds', /\brefund|\brevers(?:al|ed)\b|\bcash ?back\b/i, 'income'],
  ['investments', /\binterest\b|\bint\.? ?(?:pd|paid|cr)\b|\bdividend\b|\bmutual fund\b|\bredemption\b/i, 'income'],
  ['subscriptions', /netflix|spotify|hotstar|prime video|youtube|apple\.com|google play|zee5|sonyliv|jiocinema|audible|disney/i, 'expense'],
  ['food', /swiggy|zomato|restaurant|\bcafe\b|caf[eé]|coffee|starbucks|domino|pizza|mcdonald|\bkfc\b|burger|\bchai|bakery|biryani|eatfit|\beats?\b|\bfoods?\b|dhaba|haldiram|barbeque/i, 'expense'],
  ['groceries', /bigbasket|blinkit|zepto|\bdmart\b|d-mart|grofers|jiomart|instamart|grocer|supermarket|kirana|reliance fresh|nature'?s basket|more retail|spencer|\bmart\b/i, 'expense'],
  ['fuel', /petrol|\bfuel\b|\bhpcl\b|\bbpcl\b|\biocl?\b|indian oil|bharat petroleum|hindustan petroleum|\bshell\b|nayara|filling station/i, 'expense'],
  ['travel', /irctc|makemytrip|goibibo|cleartrip|indigo|air ?india|vistara|akasa|spicejet|\boyo\b|airbnb|booking\.com|redbus|yatra|ixigo|agoda/i, 'expense'],
  ['transport', /\buber\b|\bola\b|rapido|\bmetro\b|fastag|parking|namma yatri|blusmart|\btoll\b/i, 'expense'],
  ['bills', /electric|bescom|msedcl|mahadiscom|tata power|adani elec|torrent power|\bairtel\b|\bjio\b|vodafone|\bvi\b|bsnl|broadband|recharge|\bgas\b|indane|\bwater\b|\bbill\b|\bdth\b|tata play|act fibernet|hathway|insurance|\blic\b/i, 'expense'],
  ['rent', /\brent\b|nobroker|maintenance|society/i, 'expense'],
  ['health', /pharma|apollo|medplus|netmeds|1mg|hospital|clinic|diagnostic|\blabs?\b|practo|medical|chemist|dental/i, 'expense'],
  ['entertainment', /bookmyshow|\bpvr\b|inox|cinema|steam|playstation|district/i, 'expense'],
  ['education', /school|college|universit|\bfees?\b|udemy|coursera|byju|unacademy|academy/i, 'expense'],
  ['shopping', /amazon|flipkart|myntra|ajio|meesho|nykaa|tata cliq|croma|reliance digital|decathlon|ikea|lifestyle|westside|\bzara\b|h&m|uniqlo|pantaloons|max fashion/i, 'expense'],
];


// ---------- Learning from what you do
// state.sms.payees[key] = { name, type, categoryId, note, seen, ignored, mode }
//   seen:    times added in a row with the same category  → at 2, added automatically
//   ignored: times ignored in a row                         → at 2, skipped automatically
//   mode:    'auto' | 'ask' | 'ignore' when set by hand in Settings → Learned (wins over counts)
// state.sms.accounts['HDFC Bank|1234'] = account id picked for that bank + card/account

export const TRUST_AFTER = 2;
export const IGNORE_AFTER = 2;

export const payeeKey = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
const accountKey = finding => `${finding.bank}|${finding.last4}`;

function payees(state) {
  state.sms = state.sms || {};
  state.sms.payees = state.sms.payees || {};
  return state.sms.payees;
}

/** What has been learned about this finding's payee, or null. */
export function payeeOf(finding, state) {
  const key = payeeKey(finding.merchant);
  const p = key && state.sms && state.sms.payees ? state.sms.payees[key] : null;
  return p && (!p.type || p.type === finding.type) ? p : null;
}

/** How a payee is handled now: 'auto' (added for you), 'ignore' (skipped) or 'ask'. */
export function payeeMode(p) {
  if (!p) return 'ask';
  if (p.mode) return p.mode;
  if ((p.ignored || 0) >= IGNORE_AFTER) return 'ignore';
  if ((p.seen || 0) >= TRUST_AFTER && p.categoryId) return 'auto';
  return 'ask';
}

/** Best category id: what you chose for this payee, then a past transaction with the same name, then shop names. */
export function guessCategory(finding, state) {
  const type = finding.type;
  const exists = id => state.categories.some(c => c.id === id && c.type === type);
  const p = payeeOf(finding, state);
  if (p && p.categoryId && exists(p.categoryId)) return p.categoryId;
  if (finding.merchant) {
    const key = payeeKey(finding.merchant);
    let latest = null;
    for (const t of state.transactions) {
      if (t.type === type && payeeKey(t.note) === key && (!latest || t.date > latest.date || (t.date === latest.date && t.createdAt > latest.createdAt))) latest = t;
    }
    if (latest && exists(latest.categoryId)) return latest.categoryId;
  }
  const haystack = `${finding.merchant} ${finding.body}`;
  for (const [id, re, forType] of CATEGORY_WORDS) {
    if (forType === type && exists(id) && re.test(id === 'salary' || id === 'refunds' || id === 'investments' ? haystack : finding.merchant || '')) return id;
  }
  const fallback = type === 'income' ? 'other_in' : 'other';
  return exists(fallback) ? fallback : (state.categories.find(c => c.type === type) || {}).id || null;
}

/** Best account id: the one you picked before for this bank and card/account, else by kind. */
export function guessAccount(finding, state) {
  const accounts = state.accounts || [];
  const has = id => accounts.some(a => a.id === id);
  const learned = state.sms && state.sms.accounts && state.sms.accounts[accountKey(finding)];
  if (learned && has(learned)) return learned;
  const find = (id, re) => (accounts.find(a => a.id === id) || accounts.find(a => re.test(a.name)) || {}).id;
  let id = null;
  if (finding.kind === 'card') id = find('card', /credit|card/i);
  else if (finding.kind === 'upi') id = find('upi', /upi/i);
  if (!id) id = find('bank', /bank/i);
  if (!id && state.settings && has(state.settings.lastAccountId)) id = state.settings.lastAccountId;
  return id || null;
}

/**
 * Learns from a finding that was added. explicit: picked in the editor (also learns the name you
 * typed and the account); otherwise it was added as guessed (one tap, Add All, or automatically).
 */
export function learnAdded(state, finding, tx, { explicit = false } = {}) {
  const key = payeeKey(finding.merchant);
  if (key) {
    const list = payees(state);
    const p = list[key] || (list[key] = { name: finding.merchant, type: finding.type, seen: 0, ignored: 0 });
    p.type = finding.type;
    if (p.categoryId === tx.categoryId) p.seen = (p.seen || 0) + 1;
    else { p.categoryId = tx.categoryId; p.seen = 1; }
    p.ignored = 0;
    if (explicit) {
      const typed = String(tx.note || '').trim();
      if (typed && payeeKey(typed) !== key) p.note = typed;
      else delete p.note;
    }
    if (p.mode === 'ignore') delete p.mode;
  }
  // The account a bank/card belongs to: what you pick wins; otherwise the first one used is kept
  if ((finding.bank || finding.last4) && tx.accountId && tx.type !== 'transfer') {
    state.sms.accounts = state.sms.accounts || {};
    if (explicit || !state.sms.accounts[accountKey(finding)]) state.sms.accounts[accountKey(finding)] = tx.accountId;
  }
}

export function learnIgnored(state, finding) {
  const key = payeeKey(finding.merchant);
  if (!key) return;
  const list = payees(state);
  const p = list[key] || (list[key] = { name: finding.merchant, type: finding.type, seen: 0, ignored: 0 });
  p.ignored = (p.ignored || 0) + 1;
  p.seen = 0;
  if (p.mode === 'auto') delete p.mode;
}

/** An automatic add was undone: stop adding this payee by itself until it is confirmed again. */
export function learnUndone(state, finding) {
  const p = payeeOf(finding, state);
  if (!p) return;
  p.seen = 0;
  if (p.mode === 'auto') delete p.mode;
}

/** A transaction from a message was edited later: learn its new category and name. */
export function learnEdited(state, tx) {
  const key = tx.sms && tx.sms.payee;
  if (!key || !state.sms || !state.sms.payees) return;
  const p = state.sms.payees[key];
  if (!p) return;
  if (p.categoryId !== tx.categoryId) { p.categoryId = tx.categoryId; p.seen = 1; }
  const typed = String(tx.note || '').trim();
  if (typed && payeeKey(typed) !== key) p.note = typed;
  else delete p.note;
}

/** What to do with a new finding: 'add' it, 'ignore' it, or 'ask' (list it to check). */
export function decide(finding, state) {
  const p = payeeOf(finding, state);
  const mode = payeeMode(p);
  if (mode === 'ignore') return 'ignore';
  if (looksTypedIn(finding, state)) return 'ask';
  if (mode === 'auto') return 'add';
  if (p && p.mode === 'ask') return 'ask';
  return state.sms && state.sms.autoAdd ? 'add' : 'ask';
}

/** The transaction a finding becomes. */
export function toTransaction(finding, state) {
  const p = payeeOf(finding, state);
  const key = payeeKey(finding.merchant);
  const sms = {
    id: finding.id,
    ...(finding.ref ? { ref: finding.ref } : {}),
    ...(key ? { payee: key } : {}),
    ...(finding.last4 ? { last4: finding.last4 } : {}),
    ...(finding.via ? { via: finding.via } : {}),
  };
  if (finding.transfer) {
    // ATM cash or a card bill: money moves from the bank to cash / the card, nothing is spent
    const from = (state.sms && state.sms.accounts && state.sms.accounts[`${finding.bank}|${finding.last4}`]) || findAccountFor(state, 'bank', /bank/i);
    const to = finding.transfer === 'cash' ? findAccountFor(state, 'cash', /cash/i)
      : finding.transfer === 'invest' ? (findAccountFor(state, 'invest', /invest/i) || 'invest')
      : findAccountFor(state, 'card', /credit|card/i);
    if (from && to && from !== to) {
      return {
        type: 'transfer', amount: finding.amount, categoryId: null, accountId: from, toAccountId: to,
        date: finding.date, note: (p && p.note) || finding.merchant || '', sms,
      };
    }
  }
  const tag = state.settings && state.settings.activeTag;
  return {
    type: finding.type,
    amount: finding.amount,
    categoryId: guessCategory(finding, state),
    accountId: guessAccount(finding, state),
    date: finding.date,
    note: (p && p.note) || finding.merchant || '',
    sms,
    ...(tag && finding.type === 'expense' ? { tag } : {}),
    ...(finding.fee ? { fee: true } : {}),
    ...(finding.cashback ? { cashback: true } : {}),
  };
}

/** Already in the app: the same message, or the same bank reference number. */
export function alreadyHave(finding, state) {
  const pending = (state.sms && state.sms.pending) || [];
  if (pending.some(p => p.id === finding.id)) return true;
  if (finding.ref && pending.some(p => p.ref === finding.ref && p.amount === finding.amount && p.type === finding.type)) return true;
  if (pending.some(p => sameFromOtherSource(finding, p, p))) return true;
  return state.transactions.some(t => t.sms && (t.sms.id === finding.id ||
    (finding.ref && t.sms.ref === finding.ref && t.amount === finding.amount && t.type === finding.type) ||
    sameFromOtherSource(finding, t, t.sms)));
}

/** The bank sent both an SMS and an email about one payment: same amount and kind, within a day, same card. */
function sameFromOtherSource(finding, other, meta) {
  if ((finding.via || 'sms') === (meta.via || 'sms')) return false;
  if (other.amount !== finding.amount) return false;
  const otherType = other.type === 'transfer' ? 'expense' : other.type;
  if (otherType !== finding.type) return false;
  if (Math.abs(daysBetween(other.date, finding.date)) > 1) return false;
  return !(finding.last4 && meta.last4 && finding.last4 !== meta.last4);
}

/** Looks like something typed in by hand already: same amount and type within a day. */
export function looksTypedIn(finding, state) {
  const from = addDays(finding.date, -1);
  const to = addDays(finding.date, 1);
  return state.transactions.some(t => !t.sms && t.type === finding.type && t.amount === finding.amount && t.date >= from && t.date <= to);
}

/** A short, stable id for a message's text (so the same pasted message is not added twice). */
export function textId(text) {
  let h = 5381;
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `text-${h.toString(36)}-${s.length}`;
}

// ---------- Transfers: money that only moves between your own accounts

// Paying a credit card bill from the bank: not spending, the card's spends were already counted
const CARD_BILL_PAYMENT = /\b(?:credit\s*card|card)\b.{0,40}\b(?:bill|payment|dues?)\b|\b(?:bill|payment)\b.{0,30}\bcredit\s*card\b|\bcred\s*club\b|\bbilldesk\b.{0,30}\bcard\b/i;

/** 'cash' (ATM withdrawal: bank → cash), 'card' (card bill paid: bank → card) or ''. */
export function transferKind(finding) {
  if (!finding || finding.type !== 'expense') return '';
  if (finding.kind === 'atm') return 'cash';
  if (CARD_BILL_PAYMENT.test(finding.body || '') && !/\bspent\b|\bwas used\b|\busing your\b/i.test(finding.body || '')) return 'card';
  // Saving or investing (SIP, mutual funds, PPF, RD, FD, NPS, stocks) moves money; it isn't spending
  if (INVESTING.test(`${finding.merchant || ''} ${finding.body || ''}`)) return 'invest';
  return '';
}

const INVESTING = /\b(?:sip|mutual funds?|systematic investment|ppf|public provident|recurring deposit|rd instal\w*|fixed deposit|fd (?:booked|created|opened)|nps|national pension|zerodha|groww|upstox|kuvera|paytm money|angel one|demat|elss|sukanya|indian clearing corp|bse star|camsonline|kfintech)\b/i;

function findAccountFor(state, id, re) {
  const accounts = state.accounts || [];
  return (accounts.find(a => a.id === id) || accounts.find(a => re.test(a.name)) || {}).id || null;
}

// ---------- Balances: "Avl Bal Rs 12,450" at the end of most bank messages

const BALANCE_WORD = /\b(bal(?:ance)?|limit|lmt)\b/gi;
// After the word: an amount with Rs/INR/₹ within a few words, or a bare number right after ':' / 'is'
const AFTER_WITH_CURRENCY = /^[^₹|]{0,35}?(?:₹|\b(?:rs|inr)(?![a-z]))\.?\s*:?\s*(-?[0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
const AFTER_BARE = /^\s*(?::|-|is)?\s*(-?[0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i;

function findBalance(text) {
  BALANCE_WORD.lastIndex = 0;
  let m;
  while ((m = BALANCE_WORD.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const found = after.match(AFTER_WITH_CURRENCY) || after.match(AFTER_BARE);
    if (found) return { word: m[1], value: found[1] };
  }
  return null;
}

/** The balance (or a card's available limit) a message reports: { key, bank, last4, amount, kind, time } or null. */
export function parseBalance(message, options = {}) {
  const { address = '', body = '', date = Date.now() } = message || {};
  if (!body || isPersonalNumber(address) || /-P$/i.test(String(address).trim())) return null;
  const text = cleanText(body);
  if (/\b(?:otp|pre-?approved|eligible|apply now|min(?:imum)?\s+(?:amount\s+|amt\s+)?due)\b/i.test(text)) return null;
  const m = findBalance(text);
  if (!m) return null;
  const amount = Math.round(parseFloat(m.value.replace(/,/g, '')) * 100);
  if (!isFinite(amount)) return null;
  const bank = options.bank || bankName(address);
  const digits = text.match(ACCOUNT_DIGITS);
  if (!bank && !digits) return null;
  const header = senderHeader(address) || '';
  const isLimit = /limit|lmt/i.test(m.word) || (/(CRD|CARD|AMEX)/.test(header) && /^bal/i.test(m.word));
  const last4 = digits ? digits[1] : '';
  return { key: `${bank || header}|${last4}`, bank: bank || header, last4, amount, kind: isLimit ? 'limit' : 'balance', time: Number(date) || Date.now() };
}

// ---------- Bills: "Total due Rs 8,200, min due Rs 410, due date 20-Nov-26"

const MONTH_NAMES = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const DATE_TOKEN = new RegExp(String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?[\s-]*(?:${MONTH_NAMES})[a-z]*[\s,-]*(?:\d{2,4})?|(?:${MONTH_NAMES})[a-z]*[\s-]*\d{1,2}(?:st|nd|rd|th)?(?:[\s,-]+\d{4})?)`, 'i');
const DUE_DATE = new RegExp(String.raw`\b(?:due\s*(?:date|on|by)?|pay(?:ment)?\s+by|on\s+or\s+before|will\s+be\s+(?:auto-?)?debited\b[^.|]{0,40}?\bon|scheduled\s+(?:for|on))\s*(?:is|:|-)?\s*(?:on\s+)?${DATE_TOKEN.source}`, 'i');
const TOTAL_DUE = /\b(?:total\s+(?:amount\s+|amt\.?\s+)?due|total\s+outstanding|amount\s+due|amt\.?\s+due|bill\s+(?:amount\s+)?(?:of|for|is)|outstanding(?:\s+amount)?|statement\s+(?:amount|balance))\b[^0-9₹]{0,12}(?:₹|\b(?:rs|inr)(?![a-z]))?\.?\s*:?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
const MIN_DUE = /\bmin(?:imum)?\.?\s+(?:amount\s+|amt\.?\s+)?due\b[^0-9₹]{0,8}(?:₹|\b(?:rs|inr)(?![a-z]))?\.?\s*:?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

/** A date written in a message → 'YYYY-MM-DD'. Without a year, the next one after about two months ago. */
export function messageDate(token, sentAt = Date.now()) {
  const text = String(token || '').trim().replace(/(\d)(st|nd|rd|th)\b/i, '$1').replace(/,/g, ' ');
  const withYear = parseFlexibleDate(text, 'dmy');
  if (withYear) return withYear;
  const sent = new Date(sentAt);
  let m = text.match(new RegExp(String.raw`^(\d{1,2})[\s-]*(${MONTH_NAMES})`, 'i'));
  let day;
  let month;
  if (m) { day = +m[1]; month = MONTH_NAMES.split('|').indexOf(m[2].slice(0, 3).toLowerCase()); }
  m = m ? null : text.match(new RegExp(String.raw`^(${MONTH_NAMES})[a-z]*[\s-]*(\d{1,2})`, 'i'));
  if (m) { month = MONTH_NAMES.split('|').indexOf(m[1].slice(0, 3).toLowerCase()); day = +m[2]; }
  if (month === undefined || month < 0 || !day) return null;
  let year = sent.getFullYear();
  let candidate = new Date(year, month, day);
  if (candidate < new Date(sent.getTime() - 60 * 86400000)) candidate = new Date(++year, month, day);
  return toISO(candidate);
}

/**
 * A bill or an automatic payment coming up: { key, name, amount, minDue, dueDate, autopay } or null.
 * Card statements, phone/electricity bills, and "Rs 199 will be debited on 15-Nov for NETFLIX".
 */
export function parseBill(message, options = {}) {
  const { address = '', body = '', date = Date.now() } = message || {};
  if (!body || isPersonalNumber(address)) return null;
  const text = cleanText(body);
  if (/\b(?:otp|verification code|pre-?approved|apply now|eligible for|has been paid|received (?:your |the )?payment|payment (?:of .{0,25})?(?:received|successful))\b/i.test(text)) return null;
  const due = text.match(DUE_DATE);
  if (!due) return null;
  const dueDate = messageDate(due[1], date);
  if (!dueDate) return null;
  const autopay = /\bwill\s+be\s+(?:auto-?)?debited\b|\bauto-?debit\b|\bauto-?pay\b|\bmandate\b|\bsi\b|\bstanding instruction\b/i.test(text);
  const total = text.match(TOTAL_DUE);
  const min = text.match(MIN_DUE);
  let amount = total ? Math.round(parseFloat(total[1].replace(/,/g, '')) * 100) : 0;
  if (!amount) amount = findAmount(text);
  if (!amount) return null;
  const minDue = min ? Math.round(parseFloat(min[1].replace(/,/g, '')) * 100) : 0;
  if (minDue && amount === minDue && total === null) return null; // only a minimum: not enough to go on
  const bank = options.bank || bankName(address);
  const digits = text.match(ACCOUNT_DIGITS);
  const last4 = digits ? digits[1] : '';
  let name = '';
  const forWhat = text.match(/\bfor\s+([A-Za-z][A-Za-z0-9&' .-]{1,30}?)(?=\s*(?:\b(?:mandate|subscription|from|on|via|using|ref|a\/c|ac|account)\b|[.,;|]|$))/i);
  const yourBill = text.match(/\byour\s+([A-Za-z][A-Za-z0-9&' -]{1,30}?)\s+(?:bill|postpaid|statement|dues|emi|premium)\b/i);
  if (/\bcard\b/i.test(text) && (bank || last4)) name = `${(bank || 'Card').replace(/ Bank$/, '')}${/card$/i.test(bank) ? '' : ' card'}${last4 ? ` ••${last4}` : ''}`;
  else if (autopay && forWhat) name = prettyName(forWhat[1]);
  else if (yourBill) name = prettyName(yourBill[1].replace(/^(?:a\/c|account)\s+/i, ''));
  if (!name) name = bank ? `${bank} bill` : prettyName(senderHeader(address) || '') || 'Bill';
  const key = autopay ? `${name.toLowerCase()}|auto` : `${(bank || name).toLowerCase()}|${last4}`;
  return { key, name, amount, minDue, dueDate, autopay, bank, last4, time: Number(date) || Date.now() };
}

/** "Payment of Rs 8,200 received towards your SBI Card ending 1234": { key, amount } or null. */
export function parseBillPaid(message, options = {}) {
  const { address = '', body = '' } = message || {};
  if (!body || isPersonalNumber(address)) return null;
  const text = cleanText(body);
  if (!/\bpayment\b.{0,60}\b(?:received|credited|successful|processed)\b|\breceived (?:your |a |the )?payment\b|\bbill\b.{0,40}\b(?:has been )?paid\b/i.test(text)) return null;
  const amount = findAmount(text);
  if (!amount) return null;
  const bank = options.bank || bankName(address);
  const digits = text.match(ACCOUNT_DIGITS);
  const last4 = digits ? digits[1] : '';
  if (!bank && !last4) return null;
  return { key: `${(bank || '').toLowerCase()}|${last4}`, bank, last4, amount };
}

// ---------- Bank emails (read by a script in your own Google account; see email.js)

const EMAIL_BANKS = [
  [/sbicard/, 'SBI Card'], [/hdfcbank/, 'HDFC Bank'], [/icicibank/, 'ICICI Bank'], [/axisbank/, 'Axis Bank'],
  [/(?:^|\.)sbi\.co\.in$|onlinesbi|\.sbi$/, 'SBI'], [/kotak/, 'Kotak'], [/yesbank/, 'Yes Bank'],
  [/idfcfirstbank|idfcbank/, 'IDFC First'], [/indusind/, 'IndusInd'], [/rblbank/, 'RBL Bank'], [/federalbank/, 'Federal Bank'],
  [/bobcard/, 'BoB Card'], [/bankofbaroda/, 'Bank of Baroda'], [/pnb/, 'PNB'], [/canarabank/, 'Canara Bank'],
  [/unionbank/, 'Union Bank'], [/americanexpress|aexp/, 'Amex'], [/aubank/, 'AU Bank'], [/hsbc/, 'HSBC'],
  [/standardchartered|(?:^|\.)sc\.com$/, 'Standard Chartered'], [/citi/, 'Citi'], [/dbs/, 'DBS'], [/paytm/, 'Paytm'],
  [/onecard|fplabs/, 'OneCard'], [/jupiter/, 'Jupiter'], [/sliceit|slicepay/, 'Slice'], [/bankofindia|bankofindia/, 'Bank of India'],
  [/idbi/, 'IDBI Bank'], [/ucobank/, 'UCO Bank'], [/indianbank/, 'Indian Bank'], [/centralbank/, 'Central Bank'],
  [/iob\.in|iobnet/, 'IOB'], [/kvb/, 'KVB'], [/southindianbank|sib\.co\.in/, 'South Indian Bank'], [/equitas/, 'Equitas'],
  [/bandhan/, 'Bandhan Bank'], [/federal/, 'Federal Bank'], [/aupay/, 'AU Bank'],
];

/** "HDFC Bank InstaAlerts <alerts@hdfcbank.net>" → 'HDFC Bank' ('' when it isn't a bank we know). */
export function bankFromEmail(from) {
  const m = String(from || '').toLowerCase().match(/@([a-z0-9.-]+)/);
  if (!m) return '';
  for (const [re, name] of EMAIL_BANKS) if (re.test(m[1])) return name;
  return '';
}

// Where a bank email's useful part ends: the safety notes and sign-off underneath
const EMAIL_FOOTER = /\b(?:never share|do not share|don't share|this is (?:a|an) (?:system|computer|auto(?:matically)?)[- ]generated|disclaimer|for any (?:queries|query|assistance|clarification)|please do not reply|warm regards|regards,|thank you for banking|to unsubscribe|if (?:you have )?not (?:done|initiated|made|authori[sz]ed) (?:this|by you))/i;

/** The part of a bank email worth reading: the subject and the message before the footer. */
export function emailText(subject, body) {
  let text = String(body || '').replace(/\r/g, '');
  const cut = text.search(EMAIL_FOOTER);
  if (cut > 40) text = text.slice(0, cut);
  return `${String(subject || '').trim()}\n${text.trim()}`.slice(0, 700);
}
