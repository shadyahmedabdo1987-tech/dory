/**
 * Pure helpers for server-side notifications (no Firebase imports, unit-tested
 * from the repo's tests/ folder).
 */

export interface PaymentDoc {
  periodId: string;
  memberId: string;
  status: 'claimed' | 'confirmed';
  method?: 'cash' | 'instapay' | 'vodafone_cash';
  hasReceipt?: boolean;
  note?: string;
}

const METHOD_LABEL = { cash: 'كاش', instapay: 'إنستاباي', vodafone_cash: 'فودافون كاش' } as const;

export interface PeriodDoc {
  id: string;
  kind: 'payout' | 'extra' | 'skip';
  recipientId?: string;
  paidOut?: boolean;
}

export type PaymentEvent = 'claimed' | 'confirmed' | null;

/** What happened to a payment document between two snapshots. */
export function paymentEvent(before: PaymentDoc | undefined, after: PaymentDoc | undefined): PaymentEvent {
  if (!after) return null;
  if (after.status === 'claimed' && before?.status !== 'claimed') return 'claimed';
  if (after.status === 'confirmed' && before?.status !== 'confirmed') return 'confirmed';
  return null;
}

/** Payout periods that flipped to paid-out in this update. */
export function newlyPaidOut(before: PeriodDoc[] = [], after: PeriodDoc[] = []): PeriodDoc[] {
  const was = new Set(before.filter((p) => p.paidOut).map((p) => p.id));
  return after.filter((p) => p.kind === 'payout' && p.paidOut && !was.has(p.id));
}

export function formatEGP(amount: number): string {
  try {
    return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ج.م`;
  }
}

export function claimedMessage(
  circleName: string,
  memberName: string,
  amount: number,
  method: PaymentDoc['method'] = 'cash',
  hasReceipt = false,
) {
  return {
    title: `💵 ${memberName} دفع ${METHOD_LABEL[method]}`,
    body: `${formatEGP(amount)} في ${circleName}.${hasReceipt ? ' مرفق صورة التحويل.' : ''} ادخل أكّد الاستلام.`,
  };
}

export function confirmedMessage(circleName: string, amount: number) {
  return {
    title: `✅ اتأكد استلام قسطك`,
    body: `صاحب جمعية ${circleName} أكّد إنه استلم ${formatEGP(amount)}.`,
  };
}

export function payoutMessage(circleName: string, amount: number) {
  return {
    title: `🎉 مبروك! قبضت جمعيتك`,
    body: `اتسجّل إنك استلمت قبض ${circleName}: ${formatEGP(amount)}.`,
  };
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: 'default';
  channelId: string;
  priority: 'high';
}

export function buildMessages(
  tokens: string[],
  content: { title: string; body: string },
  data: Record<string, string>,
): ExpoMessage[] {
  return [...new Set(tokens)]
    .filter((t) => /^Expo(nent)?PushToken\[.+\]$/.test(t))
    .map((to) => ({ to, ...content, data, sound: 'default', channelId: 'payments', priority: 'high' }));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Payout requests
// ---------------------------------------------------------------------------

export interface PayoutDoc {
  periodId: string;
  recipientId: string;
  status: 'requested' | 'approved' | 'rejected' | 'paid' | 'received' | 'disputed';
  method: 'cash' | 'instapay' | 'vodafone_cash';
  account?: string;
  adminNote?: string;
  hasReceipt?: boolean;
  disputeNote?: string;
}

export type PayoutEvent = PayoutDoc['status'] | null;

/** Who should hear about a payout event. */
export function payoutAudience(event: Exclude<PayoutEvent, null>): 'admin' | 'recipient' {
  return event === 'requested' || event === 'received' || event === 'disputed' ? 'admin' : 'recipient';
}

/** Notify on each status change, and when the recipient edits a pending request. */
export function payoutEvent(before: PayoutDoc | undefined, after: PayoutDoc | undefined): PayoutEvent {
  if (!after) return null;
  if (after.status !== before?.status) return after.status;
  if (after.status === 'requested' && (after.method !== before?.method || after.account !== before?.account)) {
    return 'requested';
  }
  return null;
}

function describe(p: PayoutDoc) {
  return p.method === 'cash' ? 'كاش' : `${METHOD_LABEL[p.method]}${p.account ? ` على ${p.account}` : ''}`;
}

export function payoutMessageFor(event: Exclude<PayoutEvent, null>, circleName: string, memberName: string, p: PayoutDoc, amount: number) {
  switch (event) {
    case 'requested':
      return { title: `💼 ${memberName} طلب طريقة القبض`, body: `${circleName}: ${describe(p)}. ادخل وافق أو عدّل.` };
    case 'approved':
      return { title: '👍 اتوافق على طلب القبض', body: `${circleName}: هتقبض ${describe(p)}.${p.adminNote ? ` "${p.adminNote}"` : ''}` };
    case 'rejected':
      return { title: '⚠️ طلب القبض اترفض', body: `${circleName}${p.adminNote ? `: "${p.adminNote}"` : ''}. تقدر تبعت طلب جديد.` };
    case 'paid':
      return {
        title: '🎉 مبروك! قبضت جمعيتك',
        body: `${formatEGP(amount)} من ${circleName} — ${describe(p)}.${p.hasReceipt ? ' إيصال التحويل في حسابك.' : ''} أكّد الاستلام من التطبيق.`,
      };
    case 'received':
      return { title: `✅ ${memberName} أكّد استلام القبض`, body: `${circleName}: ${formatEGP(amount)} — ${describe(p)}.` };
    case 'disputed':
      return {
        title: `⚠️ ${memberName} بيقول القبض ما وصلوش`,
        body: `${circleName}${p.disputeNote ? `: "${p.disputeNote}"` : ''}. راجع التحويل.`,
      };
  }
}

export function announcementMessage(circleName: string, title: string, body: string) {
  const text = body.trim().replace(/\s+/g, ' ');
  return { title: `📢 ${circleName}: ${title}`.slice(0, 120), body: text.length > 180 ? `${text.slice(0, 177)}…` : text };
}
