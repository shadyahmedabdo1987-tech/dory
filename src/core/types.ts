/**
 * Domain model for a rotating savings circle (جمعية / ROSCA).
 *
 * Every member pays `installment` each cycle; in cycle N the whole pot
 * goes to the member whose turn is N (members are stored in payout order).
 */

export type Frequency = 'monthly' | 'weekly';

export interface Member {
  id: string;
  name: string;
  /** Local or international phone number, used for WhatsApp reminders. */
  phone?: string;
}

export interface Payment {
  memberId: string;
  /** Zero-based cycle index. */
  cycle: number;
  /** ISO timestamp of when the payment was recorded. */
  paidAt: string;
}

export interface Circle {
  id: string;
  name: string;
  /** Amount each member pays per cycle. */
  installment: number;
  currency: string;
  frequency: Frequency;
  /** ISO date (YYYY-MM-DD) of the first collection. */
  startDate: string;
  /** Members in payout order: members[0] receives the pot in cycle 0. */
  members: Member[];
  payments: Payment[];
  /** Cycles whose pot has been handed to the recipient. */
  paidOutCycles: number[];
  createdAt: string;
}

export interface ScheduleEntry {
  cycle: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  recipient: Member;
}

export interface CycleSummary {
  cycle: number;
  date: string;
  recipient: Member;
  pot: number;
  collected: number;
  paidMembers: Member[];
  unpaidMembers: Member[];
  isComplete: boolean;
  isPaidOut: boolean;
}
