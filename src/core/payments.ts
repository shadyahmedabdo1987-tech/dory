import { normalizePhone } from './format.ts';
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
  if (/^[A-Za-z0-9._-]{3,}@[A-Za-z0-9.-]+$/.test(value)) return null;
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
