import type { PayInfo, PaymentMethod } from './types';

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
