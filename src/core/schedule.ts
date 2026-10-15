import { daysBetween, parseISODate, stepDate, todayISO } from './dates.ts';
import type {
  Circle,
  Frequency,
  Member,
  MemberPaymentState,
  Payment,
  Period,
  TimelineEntry,
} from './types';

export function newId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function paymentId(periodId: string, memberId: string): string {
  return `${periodId}_${memberId}`;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export function periodDue(circle: Pick<Circle, 'installment'>, period: Period): number {
  if (period.kind === 'skip') return 0;
  if (period.kind === 'extra') return period.amount ?? circle.installment;
  return circle.installment;
}

export function timeline(circle: Circle): TimelineEntry[] {
  const byId = new Map(circle.members.map((m) => [m.id, m]));
  return circle.periods.map((period, index) => ({
    index,
    period,
    date: stepDate(circle.startDate, circle.frequency, index),
    due: periodDue(circle, period),
    recipient: period.recipientId ? byId.get(period.recipientId) : undefined,
  }));
}

/** Pot collected in a period when everyone pays. */
export function potFor(circle: Circle, period: Period): number {
  return periodDue(circle, period) * circle.members.length;
}

export function payoutPot(circle: Circle): number {
  return circle.installment * circle.members.length;
}

/**
 * Index of the latest period whose date has arrived; -1 before the start.
 */
export function currentIndex(circle: Circle, today: string = todayISO()): number {
  let current = -1;
  circle.periods.forEach((_, i) => {
    if (stepDate(circle.startDate, circle.frequency, i) <= today) current = i;
  });
  return current;
}

export function endDate(circle: Circle): string | undefined {
  const n = circle.periods.length;
  return n ? stepDate(circle.startDate, circle.frequency, n - 1) : undefined;
}

// ---------------------------------------------------------------------------
// Timeline editing (pure; returns new period arrays)
// ---------------------------------------------------------------------------

export function initialPeriods(members: Member[]): Period[] {
  return members.map((m) => ({ id: newId('p'), kind: 'payout', recipientId: m.id }));
}

/** Postpone: insert a skip before `index`, pushing that period and all later ones one step. */
export function postpone(periods: Period[], index: number, note?: string): Period[] {
  const at = Math.max(0, Math.min(index, periods.length));
  const skip: Period = { id: newId('p'), kind: 'skip', ...(note ? { note } : {}) };
  return [...periods.slice(0, at), skip, ...periods.slice(at)];
}

/** Extra turn at the end for a member (a second share, a new member, or the organizer's fee). */
export function addExtraTurn(periods: Period[], recipientId: string): Period[] {
  return [...periods, { id: newId('p'), kind: 'payout', recipientId }];
}

/** Extra installment everyone pays at `index` without anyone receiving it. */
export function addExtraInstallment(periods: Period[], index: number, amount: number, note?: string): Period[] {
  const at = Math.max(0, Math.min(index, periods.length));
  const extra: Period = { id: newId('p'), kind: 'extra', amount, ...(note ? { note } : {}) };
  return [...periods.slice(0, at), extra, ...periods.slice(at)];
}

export function removePeriod(periods: Period[], periodId: string): Period[] {
  return periods.filter((p) => p.id !== periodId);
}

export function movePeriod(periods: Period[], from: number, to: number): Period[] {
  if (to < 0 || to >= periods.length || from === to) return [...periods];
  const result = [...periods];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

export function setPaidOut(periods: Period[], periodId: string, paidOut: boolean): Period[] {
  return periods.map((p) => (p.id === periodId ? { ...p, paidOut } : p));
}

/**
 * Keeps the timeline consistent after the member list changes: drops payout
 * periods of removed members and appends one payout for each new member.
 */
export function syncPeriodsWithMembers(periods: Period[], members: Member[]): Period[] {
  const ids = new Set(members.map((m) => m.id));
  const kept = periods.filter((p) => p.kind !== 'payout' || (p.recipientId && ids.has(p.recipientId)));
  const withTurn = new Set(kept.filter((p) => p.kind === 'payout').map((p) => p.recipientId));
  const added = members.filter((m) => !withTurn.has(m.id));
  return [...kept, ...initialPeriods(added)];
}

/** Fisher–Yates draw over the payout recipients; skips/extras keep their slots. */
export function drawTurns(periods: Period[], random: () => number = Math.random): Period[] {
  const recipients = periods.filter((p) => p.kind === 'payout').map((p) => p.recipientId);
  for (let i = recipients.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [recipients[i], recipients[j]] = [recipients[j], recipients[i]];
  }
  let k = 0;
  return periods.map((p) => (p.kind === 'payout' ? { ...p, recipientId: recipients[k++], paidOut: false } : p));
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return [...items];
  const result = [...items];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export function findPayment(payments: Payment[], periodId: string, memberId: string): Payment | undefined {
  return payments.find((p) => p.periodId === periodId && p.memberId === memberId);
}

export function paymentState(
  entry: TimelineEntry,
  payment: Payment | undefined,
  current: number,
  today: string = todayISO(),
): MemberPaymentState {
  if (entry.due === 0) return 'none';
  if (payment?.status === 'confirmed') return 'confirmed';
  if (payment?.status === 'claimed') return 'claimed';
  if (entry.index > current) return 'upcoming';
  // Grace: the current period is "due" for its first 7 days, then "overdue".
  if (entry.index === current && daysBetween(entry.date, today) < 7) return 'due';
  return 'overdue';
}

export interface PeriodSummary {
  entry: TimelineEntry;
  pot: number;
  confirmed: Member[];
  claimed: Member[];
  unpaid: Member[];
  collected: number;
  isComplete: boolean;
}

export function periodSummary(circle: Circle, payments: Payment[], index: number): PeriodSummary {
  const entry = timeline(circle)[index];
  if (!entry) throw new RangeError(`Period ${index} out of range`);
  const confirmed: Member[] = [];
  const claimed: Member[] = [];
  const unpaid: Member[] = [];
  if (entry.due > 0) {
    for (const m of circle.members) {
      const p = findPayment(payments, entry.period.id, m.id);
      (p?.status === 'confirmed' ? confirmed : p?.status === 'claimed' ? claimed : unpaid).push(m);
    }
  }
  return {
    entry,
    pot: entry.due * circle.members.length,
    confirmed,
    claimed,
    unpaid,
    collected: confirmed.length * entry.due,
    isComplete: entry.due === 0 || unpaid.length + claimed.length === 0,
  };
}

/** Payments members marked as paid that wait for the admin. */
export function pendingApprovals(circle: Circle, payments: Payment[]) {
  const entries = new Map(timeline(circle).map((e) => [e.period.id, e]));
  const members = new Map(circle.members.map((m) => [m.id, m]));
  return payments
    .filter((p) => p.status === 'claimed' && entries.has(p.periodId) && members.has(p.memberId))
    .map((p) => ({ payment: p, entry: entries.get(p.periodId)!, member: members.get(p.memberId)! }))
    .sort((a, b) => a.entry.index - b.entry.index);
}

// ---------------------------------------------------------------------------
// Bank-style account for one member
// ---------------------------------------------------------------------------

export interface AccountLine {
  entry: TimelineEntry;
  state: MemberPaymentState;
  payment?: Payment;
  isMyPayout: boolean;
}

export interface MemberAccount {
  member: Member;
  lines: AccountLine[];
  /** Everything the member will pay over the whole circle. */
  totalCommitment: number;
  totalPaid: number;
  totalPending: number;
  remaining: number;
  overdueAmount: number;
  overdue: AccountLine[];
  nextDue?: AccountLine;
  myPayouts: { entry: TimelineEntry; amount: number; received: boolean }[];
  nextPayout?: { entry: TimelineEntry; amount: number; inDays: number };
}

export function memberAccount(
  circle: Circle,
  payments: Payment[],
  memberId: string,
  today: string = todayISO(),
): MemberAccount {
  const member = circle.members.find((m) => m.id === memberId);
  if (!member) throw new Error(`Unknown member ${memberId}`);
  const current = currentIndex(circle, today);
  const lines: AccountLine[] = timeline(circle).map((entry) => {
    const payment = findPayment(payments, entry.period.id, memberId);
    return {
      entry,
      payment,
      state: paymentState(entry, payment, current, today),
      isMyPayout: entry.period.kind === 'payout' && entry.period.recipientId === memberId,
    };
  });

  const sum = (ls: AccountLine[]) => ls.reduce((s, l) => s + l.entry.due, 0);
  const paid = lines.filter((l) => l.state === 'confirmed');
  const pending = lines.filter((l) => l.state === 'claimed');
  const overdue = lines.filter((l) => l.state === 'overdue');
  const totalCommitment = sum(lines);

  const pot = payoutPot(circle);
  const myPayouts = lines
    .filter((l) => l.isMyPayout)
    .map((l) => ({ entry: l.entry, amount: pot, received: !!l.entry.period.paidOut }));
  const upcomingPayout = myPayouts.find((p) => !p.received);

  return {
    member,
    lines,
    totalCommitment,
    totalPaid: sum(paid),
    totalPending: sum(pending),
    remaining: totalCommitment - sum(paid),
    overdueAmount: sum(overdue),
    overdue,
    nextDue: lines.find((l) => l.state === 'overdue' || l.state === 'due' || l.state === 'upcoming'),
    myPayouts,
    nextPayout: upcomingPayout && {
      ...upcomingPayout,
      inDays: daysBetween(today, upcomingPayout.entry.date),
    },
  };
}

// ---------------------------------------------------------------------------
// Admin overview
// ---------------------------------------------------------------------------

export interface CircleOverview {
  current: number;
  status: 'upcoming' | 'active' | 'finished';
  payoutsDone: number;
  payoutsTotal: number;
  ratio: number;
  overdueCount: number;
  overdueAmount: number;
  pendingCount: number;
  currentEntry?: TimelineEntry;
  nextPayoutEntry?: TimelineEntry;
}

export function overview(circle: Circle, payments: Payment[], today: string = todayISO()): CircleOverview {
  const entries = timeline(circle);
  const current = currentIndex(circle, today);
  const payouts = entries.filter((e) => e.period.kind === 'payout');
  const payoutsDone = payouts.filter((e) => e.period.paidOut).length;

  let overdueCount = 0;
  let overdueAmount = 0;
  for (const entry of entries) {
    if (entry.index > current || entry.due === 0) continue;
    for (const m of circle.members) {
      const state = paymentState(entry, findPayment(payments, entry.period.id, m.id), current, today);
      if (state === 'overdue') {
        overdueCount++;
        overdueAmount += entry.due;
      }
    }
  }

  const finished = payouts.length > 0 && payoutsDone === payouts.length;
  return {
    current,
    status: finished ? 'finished' : current < 0 ? 'upcoming' : 'active',
    payoutsDone,
    payoutsTotal: payouts.length,
    ratio: payouts.length ? payoutsDone / payouts.length : 0,
    overdueCount,
    overdueAmount,
    pendingCount: pendingApprovals(circle, payments).length,
    currentEntry: current >= 0 ? entries[current] : undefined,
    nextPayoutEntry: payouts.find((e) => !e.period.paidOut),
  };
}

// ---------------------------------------------------------------------------
// Drafts & validation
// ---------------------------------------------------------------------------

export interface CircleDraft {
  name: string;
  installment: number;
  frequency: Frequency;
  startDate: string;
  members: Member[];
}

export type DraftError = 'name' | 'installment' | 'startDate' | 'members' | 'memberName' | 'duplicatePhone';

export function validateDraft(draft: CircleDraft, normalize: (p: string) => string | null): DraftError[] {
  const errors: DraftError[] = [];
  if (!draft.name.trim()) errors.push('name');
  if (!Number.isFinite(draft.installment) || draft.installment <= 0) errors.push('installment');
  try {
    parseISODate(draft.startDate);
  } catch {
    errors.push('startDate');
  }
  if (draft.members.length < 2) errors.push('members');
  if (draft.members.some((m) => !m.name.trim())) errors.push('memberName');
  const phones = draft.members.map((m) => (m.phone ? normalize(m.phone) : null)).filter(Boolean);
  if (new Set(phones).size !== phones.length) errors.push('duplicatePhone');
  return errors;
}

export function generateInviteCode(random: () => number = Math.random): string {
  // No 0/O/1/I to avoid confusion when typed by hand.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(random() * alphabet.length)];
  return code;
}
