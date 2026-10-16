import { INSTAPAY_ADDRESS, normalizePhone } from './format.ts';
import type { PayInfo, PaymentMethod, PayoutRequest, PayoutStatus } from './types';

export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'instapay', 'vodafone_cash'];

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'كاش',
  instapay: 'إنستاباي',
  vodafone_cash: 'فودافون كاش',
};

/** Transfers must come with a screenshot; cash is handed over in person. */
export function requiresReceipt(method: PaymentMethod): boolean {
  return method !== 'cash';
}

export function methodOf(payment: { method?: PaymentMethod } | undefined): PaymentMethod {
  return payment?.method ?? 'cash';
}

/** Where to send money for a method, if the admin configured it. */
export function payTarget(method: PaymentMethod, info: PayInfo | undefined): string | undefined {
  if (method === 'instapay') return info?.instapay?.trim() || info?.instapayAddress?.trim() || undefined;
  if (method === 'vodafone_cash') return info?.vodafoneCash?.trim() || undefined;
  return undefined;
}

/** Every account a transfer for this method may show on the receipt (InstaPay: number and address). */
export function payAccounts(method: PaymentMethod, info: PayInfo | undefined): string[] {
  const list =
    method === 'instapay' ? [info?.instapay, info?.instapayAddress] : method === 'vodafone_cash' ? [info?.vodafoneCash] : [];
  return [...new Set(list.map((x) => x?.trim()).filter((x): x is string => !!x))];
}

/** Base64 receipts are stored in Firestore documents (1 MiB max); stay well below. */
export const MAX_RECEIPT_BASE64 = 900_000;

export function receiptFits(base64: string): boolean {
  return base64.length > 0 && base64.length <= MAX_RECEIPT_BASE64;
}

export interface ClaimInput {
  method: PaymentMethod;
  receiptBase64?: string;
}

export type ClaimError = 'receipt-missing' | 'receipt-too-large';

export function validateClaim(input: ClaimInput): ClaimError | null {
  if (!requiresReceipt(input.method)) return null;
  if (!input.receiptBase64) return 'receipt-missing';
  if (!receiptFits(input.receiptBase64)) return 'receipt-too-large';
  return null;
}

// ---------------------------------------------------------------------------
// Payouts (the turn's recipient receiving the pot)
// ---------------------------------------------------------------------------

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  requested: 'مستني موافقة صاحب الجمعية',
  approved: 'اتوافق على الطلب',
  rejected: 'الطلب اترفض',
  paid: 'مستني تأكيد الاستلام',
  received: 'استلم ✓',
  disputed: 'بيقول ما وصلوش',
};

/** The pot was handed over (whether or not the recipient confirmed yet). */
export function payoutHandedOver(r: Pick<PayoutRequest, 'status'> | undefined): boolean {
  return !!r && (r.status === 'paid' || r.status === 'received' || r.status === 'disputed');
}

/** Waiting on the recipient to confirm the money arrived. */
export function awaitingRecipientConfirmation(r: Pick<PayoutRequest, 'status'> | undefined): boolean {
  return r?.status === 'paid';
}

export type PayoutRequestError = 'account-missing' | 'account-invalid';

/** Vodafone Cash needs a valid Egyptian mobile; InstaPay an address or a mobile. */
export function validatePayoutRequest(method: PaymentMethod, account: string | undefined): PayoutRequestError | null {
  if (method === 'cash') return null;
  const value = account?.trim() ?? '';
  if (!value) return 'account-missing';
  if (method === 'vodafone_cash') {
    const phone = normalizePhone(value);
    return phone && /^201[0125]\d{8}$/.test(phone) ? null : 'account-invalid';
  }
  // InstaPay: name@instapay style address, or a mobile number.
  if (INSTAPAY_ADDRESS.test(value)) return null;
  return normalizePhone(value) ? null : 'account-invalid';
}

/** The recipient may (re)submit until the admin approves or pays. */
export function canEditPayoutRequest(request: Pick<PayoutRequest, 'status'> | undefined): boolean {
  return !request || request.status === 'requested' || request.status === 'rejected';
}

/** Paying out a transfer needs the admin's transfer screenshot. */
export function payoutNeedsReceipt(method: PaymentMethod): boolean {
  return requiresReceipt(method);
}

// ---------------------------------------------------------------------------
// Receipt check: does the transfer screenshot go to the admin's account, for
// exactly one installment? Works on the text read from the image (OCR) or on
// what the member typed when the image can't be read.
// ---------------------------------------------------------------------------

export interface ReceiptCheck {
  amount: boolean;
  account: boolean;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
function asciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => String(ARABIC_DIGITS.indexOf(d) >= 0 ? ARABIC_DIGITS.indexOf(d) : PERSIAN_DIGITS.indexOf(d)));
}

/** Every number written in the text (handles 1,000 / 1.000,00 / 1000.00 / Arabic digits). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of asciiDigits(text).matchAll(/\d[\d,.\s٬٫]*\d|\d/g)) {
    const raw = m[0].replace(/\s/g, '').replace(/٬/g, ',').replace(/٫/g, '.');
    // Decimal part: a final separator followed by 1-2 digits.
    const dec = raw.match(/^(.*?)[.,](\d{1,2})$/);
    const intPart = (dec ? dec[1] : raw).replace(/[.,]/g, '');
    const value = Number(dec ? `${intPart}.${dec[2]}` : intPart);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** Digits-only forms of an Egyptian mobile number that may appear on a receipt. */
function phoneForms(account: string): string[] {
  const d = asciiDigits(account).replace(/\D/g, '');
  if (d.length < 8) return [];
  const local = d.startsWith('20') ? `0${d.slice(2)}` : d;
  return [d, local, local.slice(1)];
}

/**
 * Matches the receipt text against the expected installment and the admin's
 * accounts (InstaPay number/address, Vodafone Cash number).
 */
/**
 * A masked number on a receipt (e.g. "010*****678" or "01xxxxxx5678") matches
 * the account when every visible digit lines up and at least 4 are visible.
 */
function maskedMatches(text: string, forms: string[]): boolean {
  const tokens = asciiDigits(text).match(/[0-9][0-9*xX•·.\s-]{5,}[0-9]/g) ?? [];
  for (const raw of tokens) {
    const t = raw.replace(/[\s-]/g, '').replace(/[xX•·.]/g, '*');
    if (!t.includes('*')) continue;
    const visible = t.replace(/\*/g, '').length;
    if (visible < 4) continue;
    for (const f of forms) {
      if (f.length !== t.length) continue;
      if ([...t].every((c, i) => c === '*' || c === f[i])) return true;
    }
  }
  return false;
}

export function checkReceiptText(text: string, expected: { amount: number; accounts: (string | undefined)[] }): ReceiptCheck {
  const amount = numbersIn(text).some((n) => Math.abs(n - expected.amount) < 0.01);
  const flatDigits = asciiDigits(text).replace(/\D/g, '');
  const lower = text.toLowerCase().replace(/\s/g, '');
  const account = expected.accounts.some((acc) => {
    if (!acc) return false;
    const a = acc.trim().toLowerCase();
    // InstaPay address (name@instapay / email): the whole address, or at least "name@".
    if (a.includes('@')) {
      const flat = a.replace(/\s/g, '');
      return lower.includes(flat) || lower.includes(`${flat.split('@')[0]}@`);
    }
    // Mobile number linked to InstaPay / wallet: any common form, or masked.
    const forms = phoneForms(a);
    return forms.some((f) => flatDigits.includes(f)) || maskedMatches(text, forms);
  });
  return { amount, account };
}

// ---------------------------------------------------------------------------
// Receipt fingerprint (the same receipt can't be used twice) and date
// ---------------------------------------------------------------------------

const REF_LABEL =
  /(reference|ref\.?|transaction|trx|txn|operation|رقم\s*المرجع|المرجع|الرقم\s*المرجعي|رقم\s*العملي[ةه]|رقم\s*المعامل[ةه])\s*(no\.?|number|id|#|رقم)?[^A-Za-z0-9٠-٩]{0,12}([A-Za-z0-9٠-٩]{6,40})/i;

/**
 * The transaction reference printed on an InstaPay / wallet receipt, or the
 * longest run of digits that isn't the amount or an account number.
 */
export function receiptReference(text: string, exclude: { accounts?: (string | undefined)[] } = {}): string | null {
  const ascii = asciiDigits(text);
  const labeled = ascii.match(REF_LABEL);
  if (labeled && /\d/.test(labeled[3])) return labeled[3].toUpperCase();
  const skip = new Set(exclude.accounts?.flatMap((a) => (a ? phoneForms(a) : [])) ?? []);
  const runs = (ascii.match(/\d{10,30}/g) ?? []).filter((r) => ![...skip].some((f) => r.includes(f) || f.includes(r)));
  runs.sort((a, b) => b.length - a.length);
  return runs[0] ?? null;
}

const MONTH_WORDS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, مايو: 5, يونيو: 6, يوليو: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Dates written on a receipt (dd/mm/yyyy, yyyy-mm-dd, "16 Oct 2026", "16 أكتوبر 2026"). */
export function receiptDates(text: string): string[] {
  const t = asciiDigits(text);
  const out = new Set<string>();
  for (const m of t.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const v = iso(+m[1], +m[2], +m[3]);
    if (v) out.add(v);
  }
  for (const m of t.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g)) {
    const v = iso(+m[3], +m[2], +m[1]);
    if (v) out.add(v);
  }
  for (const m of t.matchAll(/(\d{1,2})\s*([A-Za-z؀-ۿ]{3,9})[,\s]+(\d{4})/g)) {
    const month = MONTH_WORDS[m[2].toLowerCase().slice(0, m[2].match(/[A-Za-z]/) ? 3 : undefined)];
    if (month) {
      const v = iso(+m[3], month, +m[1]);
      if (v) out.add(v);
    }
  }
  return [...out];
}

/**
 * Is the receipt recent enough for this installment? null when no date could
 * be read (then it isn't held against the receipt).
 */
export function receiptDateOk(text: string, dueISO: string, todayISO: string, graceDays = 45): boolean | null {
  const dates = receiptDates(text);
  if (dates.length === 0) return null;
  const from = new Date(`${dueISO}T00:00:00Z`).getTime() - graceDays * 86_400_000;
  const to = new Date(`${todayISO}T00:00:00Z`).getTime() + 2 * 86_400_000;
  return dates.some((d) => {
    const t = new Date(`${d}T00:00:00Z`).getTime();
    return t >= from && t <= to;
  });
}
