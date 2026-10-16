/**
 * Domain model for "دوري" — a rotating savings circle (جمعية / ROSCA).
 *
 * The circle runs on a timeline of *periods*, one per step of its frequency
 * (week, month or quarter). Each period is one of:
 *   - payout: every member pays the installment and one member receives the pot
 *   - extra:  every member pays an extra installment; nobody receives it
 *   - skip:   a postponed step (holiday, hardship) — nothing is due
 *
 * Inserting a `skip` pushes every later period one step forward, which is how
 * the admin "adds a month". Periods have stable ids, so payments keep pointing
 * at the right period no matter how the timeline is edited.
 */

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'every4months';

export type PeriodKind = 'payout' | 'extra' | 'skip';

export interface Period {
  id: string;
  kind: PeriodKind;
  /** Member receiving the pot (payout periods only). */
  recipientId?: string;
  /** Per-member amount for extra periods (defaults to the circle installment). */
  amount?: number;
  /** Payout handed to the recipient. */
  paidOut?: boolean;
  note?: string;
}

export interface Member {
  id: string;
  name: string;
  phone?: string;
  /** Firebase uid once the member joined from their own phone. */
  uid?: string | null;
}

export type PaymentStatus = 'claimed' | 'confirmed';

export type PaymentMethod = 'cash' | 'instapay' | 'vodafone_cash';

export interface Payment {
  /** `${periodId}_${memberId}` — one payment per member per period. */
  id: string;
  periodId: string;
  memberId: string;
  status: PaymentStatus;
  /** How the money was sent. Missing on payments recorded before v2.2 (treated as cash). */
  method?: PaymentMethod;
  /** A transfer screenshot is stored in circles/{cid}/receipts/{paymentId}. */
  hasReceipt?: boolean;
  /** Member said "I paid" (ISO timestamp). */
  claimedAt?: string;
  /** Admin confirmed receipt (ISO timestamp). */
  confirmedAt?: string;
  note?: string;
}

export interface Circle {
  id: string;
  name: string;
  /** Amount each member pays per payout period. */
  installment: number;
  currency: string;
  frequency: Frequency;
  /** ISO date (YYYY-MM-DD) of the first period. */
  startDate: string;
  adminUid: string;
  inviteCode: string;
  /** Where members send transfers (shown in the pay sheet). */
  payInfo?: PayInfo;
  /** WhatsApp group invite link (https://chat.whatsapp.com/…). */
  whatsappGroup?: string;
  /** The organizer's own member row; their turn is fixed first and skipped by the draw. */
  ownerMemberId?: string;
  /** How many members the organizer wants (members join until it's full). */
  slots?: number;
  members: Member[];
  periods: Period[];
  createdAt: string;
}

export interface PayInfo {
  /** InstaPay address (e.g. name@instapay) or mobile number. */
  instapay?: string;
  /** Vodafone Cash wallet number. */
  vodafoneCash?: string;
}

export interface TimelineEntry {
  index: number;
  period: Period;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** What each member owes in this period (0 for skips). */
  due: number;
  recipient?: Member;
}

/** `covered`: the member receives this period's payout, so their own installment is netted out (counts as paid). */
export type MemberPaymentState = 'covered' | 'confirmed' | 'claimed' | 'overdue' | 'due' | 'upcoming' | 'none';

/** requested → approved/rejected → paid → received (or disputed by the recipient). */
export type PayoutStatus = 'requested' | 'approved' | 'rejected' | 'paid' | 'received' | 'disputed';

/**
 * How the turn's recipient wants to receive the pot, and what the admin did
 * with it. Stored at circles/{cid}/payouts/{periodId}.
 */
export interface PayoutRequest {
  periodId: string;
  recipientId: string;
  status: PayoutStatus;
  /** What the recipient asked for. */
  method: PaymentMethod;
  /** Vodafone Cash number / InstaPay address (transfers only). */
  account?: string;
  note?: string;
  requestedAt?: string;
  /** Admin decision / edit. */
  adminNote?: string;
  decidedAt?: string;
  /** When the admin handed over / transferred the money. */
  paidAt?: string;
  /** Transfer screenshot at circles/{cid}/payoutReceipts/{periodId}. */
  hasReceipt?: boolean;
  /** Recipient confirmed the money arrived. */
  receivedAt?: string;
  /** Recipient says the money didn't arrive (with their explanation). */
  disputeNote?: string;
}

/** Admin message to every member (in-app feed + push). circles/{cid}/announcements/{id} */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  /** ISO timestamp. */
  createdAt: string;
}
