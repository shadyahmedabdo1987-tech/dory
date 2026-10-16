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
  if (method === 'instapay') return info?.instapay?.trim() || undefined;
  if (method === 'vodafone_cash') return info?.vodafoneCash?.trim() || undefined;
  return undefined;
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
export function checkReceiptText(text: string, expected: { amount: number; accounts: (string | undefined)[] }): ReceiptCheck {
  const amount = numbersIn(text).some((n) => Math.abs(n - expected.amount) < 0.01);
  const flatDigits = asciiDigits(text).replace(/\D/g, '');
  const lower = text.toLowerCase().replace(/\s/g, '');
  const account = expected.accounts.some((acc) => {
    if (!acc) return false;
    const a = acc.trim().toLowerCase();
    if (a.includes('@')) return lower.includes(a.replace(/\s/g, '')) || lower.includes(a.split('@')[0]);
    return phoneForms(a).some((f) => flatDigits.includes(f));
  });
  return { amount, account };
}
