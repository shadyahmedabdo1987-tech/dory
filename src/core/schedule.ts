import { formatNumber } from './format.ts';
import { addDays, addMonths, daysBetween, parseISODate, stepDate, todayISO } from './dates.ts';
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
  return circle.installment + (period.bonus && period.bonus > 0 ? period.bonus : 0);
}

/**
 * Every period's date. Normally start + n steps; a sped-up period (`gap`) comes
 * that long after the previous one, and the usual steps continue from it.
 */
/** Months between installments when the circle uses its own step (every 2, 5, 6… months). */
export function stepMonthsOf(circle: Pick<Circle, 'periods'>): number | null {
  for (const p of circle.periods) {
    const m = /^m(\d{1,2})$/.exec(p.step ?? '');
    if (m && +m[1] >= 1 && +m[1] <= 12) return +m[1];
  }
  return null;
}

/** "كل شهر" / "كل شهرين" / "كل ٦ شهور" / "كل سنة"… */
export function cadenceLabel(circle: Pick<Circle, 'periods' | 'frequency'>): string {
  const n = stepMonthsOf(circle);
  if (!n) return { weekly: 'كل أسبوع', monthly: 'كل شهر', quarterly: 'كل ٣ شهور', every4months: 'كل ٤ شهور' }[circle.frequency];
  return monthsLabel(n);
}

export function monthsLabel(n: number): string {
  if (n === 1) return 'كل شهر';
  if (n === 2) return 'كل شهرين';
  if (n === 12) return 'كل سنة';
  return `كل ${formatNumber(n)} شهور`;
}

/** Stamp the circle's own step on every period (or clear it). */
export function withStep(periods: Period[], months: number | null): Period[] {
  return periods.map((p) => {
    const { step: _s, ...rest } = p;
    return months && ![1, 3, 4].includes(months) ? { ...rest, step: `m${months}` } : rest;
  });
}

/** How many installments fit between two months (inclusive) at this step. */
export function periodsBetween(startISO: string, endISO: string, stepMonths: number): number {
  const a = parseISODate(startISO);
  const b = parseISODate(endISO);
  const diff = (b.y - a.y) * 12 + (b.m - a.m);
  return diff < 0 ? 0 : Math.floor(diff / stepMonths) + 1;
}

export function periodDates(circle: Pick<Circle, 'periods' | 'startDate' | 'frequency'>): string[] {
  const own = stepMonthsOf(circle);
  const step = (from: string, n: number) => (own ? addMonths(from, own * n) : stepDate(from, circle.frequency, n));
  const dates: string[] = [];
  let anchor = circle.startDate;
  let anchorIndex = 0;
  circle.periods.forEach((p, i) => {
    let d: string;
    if (i > 0 && p.gap) {
      const prev = dates[i - 1];
      d = p.gap === 'same' ? prev : p.gap === 'week' ? addDays(prev, 7) : p.gap === '2weeks' ? addDays(prev, 14) : addMonths(prev, 1);
      anchor = d;
      anchorIndex = i;
    } else {
      d = step(anchor, i - anchorIndex);
    }
    dates.push(d);
  });
  return dates;
}

export type SpeedUp = 'double' | 'week' | '2weeks' | 'month';

/**
 * Speed up every period from `from` on: two turns per date ('double' — members
 * pay two installments each time), or a shorter time between dates.
 */
export function speedUp(periods: Period[], from: number, mode: SpeedUp | 'normal'): Period[] {
  return periods.map((p, i) => {
    if (i < from) return p;
    const { gap: _old, ...rest } = p;
    if (mode === 'normal' || i === 0) return rest;
    if (mode === 'double') return (i - from) % 2 === 1 ? { ...rest, gap: 'same' as const } : rest;
    return i === from ? rest : { ...rest, gap: mode };
  });
}

export function isSpedUp(periods: Period[]): boolean {
  return periods.some((p) => !!p.gap);
}

export function timeline(circle: Circle): TimelineEntry[] {
  const byId = new Map(circle.members.map((m) => [m.id, m]));
  const dates = periodDates(circle);
  return circle.periods.map((period, index) => ({
    index,
    period,
    date: dates[index],
    due: periodDue(circle, period),
    recipient: period.recipientId ? byId.get(period.recipientId) : undefined,
  }));
}

/** Pot collected in a period when everyone pays. */
export function potFor(circle: Circle, period: Period): number {
  return periodDue(circle, period) * circle.members.length;
}

/** Full value of a turn (every member's installment, including the recipient's own). */
export function payoutPot(circle: Pick<Circle, 'installment' | 'members'>, period?: Period): number {
  return (period ? periodDue(circle, period) : circle.installment) * circle.members.length;
}

/**
 * What the recipient is actually handed: the others' installments. The
 * recipient doesn't pay in their own payout period — their share is netted out.
 */
export function payoutNet(circle: Pick<Circle, 'installment' | 'members'>, period?: Period): number {
  const each = period ? periodDue(circle, period) : circle.installment;
  return each * Math.max(0, circle.members.length - 1);
}

/** True when `memberId` receives this period's payout (so they don't pay it). */
export function isOwnPayout(period: Period, memberId: string): boolean {
  return period.kind === 'payout' && period.recipientId === memberId;
}

/**
 * Index of the latest period whose date has arrived; -1 before the start.
 */
export function currentIndex(circle: Circle, today: string = todayISO()): number {
  let current = -1;
  periodDates(circle).forEach((d, i) => {
    if (d <= today) current = i;
  });
  return current;
}

export function endDate(circle: Circle): string | undefined {
  const n = circle.periods.length;
  return n ? periodDates(circle)[n - 1] : undefined;
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
export function addExtraTurn(periods: Period[], recipientId: string, at?: number): Period[] {
  const turn: Period = { id: newId('p'), kind: 'payout', recipientId };
  if (at === undefined || at >= periods.length) return [...periods, turn];
  return [...periods.slice(0, at), turn, ...periods.slice(at)];
}

/** Which round a payout is for its member: 1 = their first turn, 2 = their second… */
export function roundOf(periods: Period[], index: number): number {
  const p = periods[index];
  if (!p || p.kind !== 'payout') return 0;
  return periods.slice(0, index + 1).filter((q) => q.kind === 'payout' && q.recipientId === p.recipientId).length;
}

/**
 * Where a member's extra turn may go: never before today's turn, and a second
 * turn only after everyone's first (no two turns close together) — so it's
 * placed among the later rounds. Returns insert positions (index in periods).
 */
export function extraTurnSlots(periods: Period[], recipientId: string, current: number): number[] {
  const nextRound = periods.filter((p) => p.kind === 'payout' && p.recipientId === recipientId).length + 1;
  let from = Math.max(0, current + 1);
  periods.forEach((p, i) => {
    // Everyone's turns of an earlier round must come first.
    if (p.kind === 'payout' && roundOf(periods, i) < nextRound) from = Math.max(from, i + 1);
  });
  const slots: number[] = [];
  for (let i = from; i <= periods.length; i++) slots.push(i);
  return slots;
}

/**
 * A drawn order applied round by round: everyone's first turn comes before
 * anyone's second, whatever the wheel says.
 */
export function orderByRounds(periods: Period[], openIds: string[], drawn: string[]): string[] {
  const before = new Map<string, number>();
  periods.forEach((p) => {
    if (p.kind === 'payout' && p.recipientId && !openIds.includes(p.id)) before.set(p.recipientId, (before.get(p.recipientId) ?? 0) + 1);
  });
  const seen = new Map<string, number>();
  return drawn
    .map((id, k) => {
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      return { id, k, round: (before.get(id) ?? 0) + n };
    })
    .sort((a, b) => a.round - b.round || a.k - b.k)
    .map((x) => x.id);
}

/** Extra installment everyone pays at `index` without anyone receiving it. */
/** Every member adds `amount` to these turns' installments — the recipients collect it. */
/** Extra money each member still pays on top of the plain installments (raised turns + separate extras). */
export function upcomingExtrasPerMember(circle: Circle, current: number): number {
  return circle.periods.reduce((sum, p, i) => {
    if (current >= 0 && i < current) return sum;
    if (p.kind === 'payout' && p.bonus && !p.paidOut) return sum + p.bonus;
    if (p.kind === 'extra') return sum + (p.amount ?? circle.installment);
    return sum;
  }, 0);
}

export interface ExtraItem {
  entry: TimelineEntry;
  /** 'bonus' = added on top of a turn's installment; 'extra' = its own installment. */
  kind: 'bonus' | 'extra';
  perMember: number;
  /** Everyone together. */
  total: number;
}

/** Every extra amount still to come (raised turns + separate installments), oldest first. */
export function upcomingExtras(circle: Circle, current: number): ExtraItem[] {
  const n = circle.members.length;
  return timeline(circle)
    .filter((e) => current < 0 || e.index >= current)
    .flatMap((e): ExtraItem[] => {
      if (e.period.kind === 'payout' && e.period.bonus && !e.period.paidOut) {
        // The recipient doesn't pay their own turn, so n - 1 people pay the extra.
        return [{ entry: e, kind: 'bonus', perMember: e.period.bonus, total: e.period.bonus * Math.max(0, n - 1) }];
      }
      if (e.period.kind === 'extra') return [{ entry: e, kind: 'extra', perMember: e.due, total: e.due * n }];
      return [];
    });
}

export function addBonus(periods: Period[], periodIds: string[], amount: number, note?: string): Period[] {
  return periods.map((p) =>
    periodIds.includes(p.id) && p.kind === 'payout'
      ? { ...p, bonus: (p.bonus ?? 0) + amount, ...(note ? { note } : {}) }
      : p,
  );
}

export function clearBonus(periods: Period[], periodId: string): Period[] {
  return periods.map((p) => {
    if (p.id !== periodId) return p;
    const { bonus: _b, ...rest } = p;
    return rest;
  });
}

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

/** The later due date the organizer gave this member for this period, if any. */
export function deferralOf(period: Period, memberId: string): string | undefined {
  const d = period.deferrals?.[memberId];
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

/** Give one member a later due date for one period (null removes it). */
export function setDeferral(periods: Period[], periodId: string, memberId: string, date: string | null): Period[] {
  return periods.map((p) => {
    if (p.id !== periodId) return p;
    const deferrals = { ...(p.deferrals ?? {}) };
    if (date) deferrals[memberId] = date;
    else delete deferrals[memberId];
    const next: Period = { ...p, deferrals };
    if (!Object.keys(deferrals).length) delete next.deferrals;
    return next;
  });
}

export function findPayment(payments: Payment[], periodId: string, memberId: string): Payment | undefined {
  return payments.find((p) => p.periodId === periodId && p.memberId === memberId);
}

export function paymentState(
  entry: TimelineEntry,
  payment: Payment | undefined,
  current: number,
  today: string = todayISO(),
  memberId?: string,
): MemberPaymentState {
  if (entry.due === 0) return 'none';
  if (memberId && isOwnPayout(entry.period, memberId)) return 'covered';
  if (payment?.status === 'confirmed') return 'confirmed';
  if (payment?.status === 'claimed') return 'claimed';
  if (entry.index > current) return 'upcoming';
  // The organizer gave this member a later date for this installment.
  const deferredTo = memberId ? deferralOf(entry.period, memberId) : undefined;
  if (deferredTo) {
    if (today < deferredTo) return 'deferred';
    return daysBetween(deferredTo, today) < 7 ? 'due' : 'overdue';
  }
  // Grace: the current period is "due" for its first 7 days, then "overdue".
  // (By date, not position: two turns can share a date when the circle is sped up.)
  if (entry.index <= current && daysBetween(entry.date, today) < 7) return 'due';
  return 'overdue';
}

export interface PeriodSummary {
  entry: TimelineEntry;
  pot: number;
  confirmed: Member[];
  claimed: Member[];
  unpaid: Member[];
  /** Allowed to pay later (a date the organizer set) — not late yet. */
  deferred: Member[];
  /** The turn's recipient — doesn't pay this period. */
  covered: Member[];
  /** Members who owe this period (everyone except the recipient). */
  payers: Member[];
  collected: number;
  isComplete: boolean;
}

export function periodSummary(circle: Circle, payments: Payment[], index: number): PeriodSummary {
  const entry = timeline(circle)[index];
  if (!entry) throw new RangeError(`Period ${index} out of range`);
  const confirmed: Member[] = [];
  const claimed: Member[] = [];
  const unpaid: Member[] = [];
  const deferred: Member[] = [];
  const covered: Member[] = [];
  const today = todayISO();
  const payers: Member[] = [];
  if (entry.due > 0) {
    for (const m of circle.members) {
      if (isOwnPayout(entry.period, m.id)) {
        covered.push(m);
        continue;
      }
      payers.push(m);
      const p = findPayment(payments, entry.period.id, m.id);
      const later = deferralOf(entry.period, m.id);
      (p?.status === 'confirmed'
        ? confirmed
        : p?.status === 'claimed'
          ? claimed
          : later && today < later
            ? deferred
            : unpaid
      ).push(m);
    }
  }
  return {
    entry,
    pot: entry.due * payers.length,
    confirmed,
    claimed,
    unpaid,
    deferred,
    covered,
    payers,
    collected: confirmed.length * entry.due,
    isComplete: entry.due === 0 || unpaid.length + claimed.length + deferred.length === 0,
  };
}

export interface CircleCompletion {
  /** Every installment of every period is confirmed (early payments included). */
  allCollected: boolean;
  /** Every turn has been handed its payout. */
  allPaidOut: boolean;
  /** Both: the circle is over. */
  done: boolean;
  /** Everything collected over the whole circle. */
  totalCollected: number;
  /** Turns still to hand over. */
  payoutsLeft: TimelineEntry[];
}

/** Where the circle stands overall — used for the "circle finished" state. */
export function circleCompletion(circle: Circle, payments: Payment[]): CircleCompletion {
  const entries = timeline(circle);
  let allCollected = entries.length > 0;
  let totalCollected = 0;
  entries.forEach((e, i) => {
    if (e.period.kind === 'skip' || e.due === 0) return;
    const s = periodSummary(circle, payments, i);
    totalCollected += s.collected;
    if (!s.isComplete) allCollected = false;
  });
  const payouts = entries.filter((e) => e.period.kind === 'payout');
  const payoutsLeft = payouts.filter((e) => !e.period.paidOut);
  const allPaidOut = payouts.length > 0 && payoutsLeft.length === 0;
  return { allCollected, allPaidOut, done: allCollected && allPaidOut, totalCollected, payoutsLeft };
}

/** The member's coming installments that can still be paid ahead of time, in date order. */
export function earlyPayable(circle: Circle, payments: Payment[], memberId: string, today: string = todayISO()): TimelineEntry[] {
  return timeline(circle).filter(
    (e) =>
      e.period.kind !== 'skip' &&
      e.due > 0 &&
      e.date > today &&
      !isOwnPayout(e.period, memberId) &&
      !findPayment(payments, e.period.id, memberId),
  );
}

/** Payments members marked as paid that wait for the admin. */
export function pendingApprovals(circle: Circle, payments: Payment[]) {
  const entries = new Map(timeline(circle).map((e) => [e.period.id, e]));
  const members = new Map(circle.members.map((m) => [m.id, m]));
  return payments
    .filter(
      (p) =>
        p.status === 'claimed' &&
        entries.has(p.periodId) &&
        members.has(p.memberId) &&
        !isOwnPayout(entries.get(p.periodId)!.period, p.memberId),
    )
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
      state: paymentState(entry, payment, current, today, memberId),
      isMyPayout: isOwnPayout(entry.period, memberId),
    };
  });

  const sum = (ls: AccountLine[]) => ls.reduce((s, l) => s + l.entry.due, 0);
  // The member's own payout-period installment is netted out, so it counts as paid.
  const paid = lines.filter((l) => l.state === 'confirmed' || l.state === 'covered');
  const pending = lines.filter((l) => l.state === 'claimed');
  const overdue = lines.filter((l) => l.state === 'overdue');
  const totalCommitment = sum(lines);

  const potOf = (p: Period) => payoutNet(circle, p);
  const myPayouts = lines
    .filter((l) => l.isMyPayout)
    .map((l) => ({ entry: l.entry, amount: potOf(l.entry.period), received: !!l.entry.period.paidOut }));
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
    nextDue: lines.find((l) => l.state === 'overdue' || l.state === 'due' || l.state === 'deferred' || l.state === 'upcoming'),
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
      const state = paymentState(entry, findPayment(payments, entry.period.id, m.id), current, today, m.id);
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
  /** The organizer is members[0] and always takes the first turn. */
  ownerFirst?: boolean;
  /** Target number of members (including the organizer); others join from the app. */
  slots?: number;
  /** The organizer's InstaPay (number or address): saved as the circle's transfer details. */
  payInstapay?: string;
  /** The organizer's InstaPay address (name@instapay). */
  payInstapayAddress?: string;
  /** Every N months when N isn't 1, 3 or 4 (those use `frequency`). */
  stepMonths?: number;
}

export type DraftError = 'name' | 'installment' | 'startDate' | 'members' | 'memberName' | 'duplicatePhone' | 'slots';

export const MAX_SLOTS = 120;

export function validateDraft(draft: CircleDraft, normalize: (p: string) => string | null): DraftError[] {
  const errors: DraftError[] = [];
  if (!draft.name.trim()) errors.push('name');
  if (!Number.isFinite(draft.installment) || draft.installment <= 0) errors.push('installment');
  try {
    parseISODate(draft.startDate);
  } catch {
    errors.push('startDate');
  }
  if (draft.members.length < 1) errors.push('members');
  if (
    draft.slots !== undefined &&
    (!Number.isInteger(draft.slots) || draft.slots < 2 || draft.slots > MAX_SLOTS || draft.slots < draft.members.length)
  ) {
    errors.push('slots');
  }
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

/**
 * Applies a drawn order (e.g. from the wheel) to the payout periods, in
 * timeline order. Skips/extras keep their slots; payout flags reset.
 * `recipientIds` must contain exactly the current payout recipients.
 */
export function applyTurnOrder(periods: Period[], recipientIds: string[]): Period[] {
  const current = periods.filter((p) => p.kind === 'payout').map((p) => p.recipientId ?? '');
  const sorted = (xs: string[]) => [...xs].sort().join('|');
  if (current.length !== recipientIds.length || sorted(current) !== sorted(recipientIds)) {
    throw new Error('Turn order does not match the payout recipients');
  }
  let k = 0;
  return periods.map((p) => (p.kind === 'payout' ? { ...p, recipientId: recipientIds[k++], paidOut: false } : p));
}

/** Slice whose center sits under the pointer (top) after rotating `rotationDeg` clockwise. */
export function sliceAtPointer(count: number, rotationDeg: number): number {
  const slice = 360 / count;
  const pointer = (((-rotationDeg % 360) + 360) % 360); // wheel-space angle now at the top
  return Math.floor(pointer / slice) % count;
}

/** Clockwise rotation (from `fromDeg`) that lands slice `index` under the pointer after `turns` full spins. */
export function spinTarget(count: number, index: number, fromDeg: number, turns = 6): number {
  const slice = 360 / count;
  const center = (index + 0.5) * slice;
  const base = fromDeg - (((fromDeg % 360) + 360) % 360);
  return base + turns * 360 + (360 - center);
}

/**
 * Draw entries when the organizer keeps the first turn: returns the payout
 * periods open to the draw and the fixed owner prefix.
 */
export function drawablePayouts(circle: Pick<Circle, 'periods' | 'ownerMemberId'>) {
  const payouts = circle.periods.filter((p) => p.kind === 'payout');
  const fixed = circle.ownerMemberId && payouts[0]?.recipientId === circle.ownerMemberId ? [payouts[0]] : [];
  return { fixed, open: payouts.slice(fixed.length) };
}

/**
 * Turns still open to a (re)draw: payout periods that haven't started and
 * weren't paid out, except the organizer's fixed first turn. Lets the
 * organizer redraw the rest of the order at any time.
 */
export function openPayouts(circle: Pick<Circle, 'periods' | 'ownerMemberId'>, current: number): Period[] {
  const { fixed } = drawablePayouts(circle);
  const fixedIds = new Set(fixed.map((p) => p.id));
  return circle.periods.filter((p, i) => p.kind === 'payout' && !p.paidOut && i > current && !fixedIds.has(p.id));
}

/** Gives these periods (in schedule order) the drawn recipients, one each. */
export function assignRecipients(periods: Period[], periodIds: string[], recipientIds: string[]): Period[] {
  const targets = periods.filter((p) => periodIds.includes(p.id));
  const sorted = (xs: string[]) => [...xs].sort().join('|');
  if (targets.length !== recipientIds.length || sorted(targets.map((p) => p.recipientId ?? '')) !== sorted(recipientIds)) {
    throw new Error('Drawn order does not match the open turns');
  }
  let k = 0;
  return periods.map((p) => (periodIds.includes(p.id) ? { ...p, recipientId: recipientIds[k++], paidOut: false } : p));
}

/** Combines the fixed owner turn with the drawn order. */
export function ownerFirstOrder(circle: Pick<Circle, 'periods' | 'ownerMemberId'>, drawn: string[]): string[] {
  const { fixed } = drawablePayouts(circle);
  return [...fixed.map((p) => p.recipientId ?? ''), ...drawn];
}

/** A circle is open to join requests until it reaches its target size. */
export function isCircleOpen(circle: Pick<Circle, 'slots' | 'members'>): boolean {
  return !circle.slots || circle.members.length < circle.slots;
}

// ---------------------------------------------------------------------------
// Reports (member statement + whole-circle summary for the admin)
// ---------------------------------------------------------------------------

export interface MemberReport {
  member: Member;
  /** Payout turns of this member (usually one): turn number, date, amount, received? */
  turns: { number: number; date: string; amount: number; received: boolean }[];
  /** Installments with something to pay (the member's own turn counts as paid). */
  installmentsTotal: number;
  installmentsPaid: number;
  installmentsPending: number;
  installmentsLeft: number;
  installmentsOverdue: number;
  amountTotal: number;
  amountPaid: number;
  amountLeft: number;
  amountOverdue: number;
  /** Paid lines, oldest first, with how they were settled. */
  paid: { date: string; amount: number; how: 'confirmed' | 'covered'; method?: Payment['method'] }[];
}

export function memberReport(
  circle: Circle,
  payments: Payment[],
  memberId: string,
  today: string = todayISO(),
): MemberReport {
  const acc = memberAccount(circle, payments, memberId, today);
  const owed = acc.lines.filter((l) => l.entry.due > 0);
  const isPaid = (l: AccountLine) => l.state === 'confirmed' || l.state === 'covered';
  const paid = owed.filter(isPaid);
  const left = owed.filter((l) => !isPaid(l));
  const sum = (ls: AccountLine[]) => ls.reduce((s, l) => s + l.entry.due, 0);
  const payoutNumbers = new Map(
    timeline(circle)
      .filter((e) => e.period.kind === 'payout')
      .map((e, i) => [e.period.id, i + 1]),
  );
  return {
    member: acc.member,
    turns: acc.myPayouts.map((p) => ({
      number: payoutNumbers.get(p.entry.period.id) ?? p.entry.index + 1,
      date: p.entry.date,
      amount: p.amount,
      received: p.received,
    })),
    installmentsTotal: owed.length,
    installmentsPaid: paid.length,
    installmentsPending: left.filter((l) => l.state === 'claimed').length,
    installmentsLeft: left.length,
    installmentsOverdue: acc.overdue.length,
    amountTotal: sum(owed),
    amountPaid: sum(paid),
    amountLeft: sum(left),
    amountOverdue: acc.overdueAmount,
    paid: paid.map((l) => ({
      date: l.entry.date,
      amount: l.entry.due,
      how: l.state === 'covered' ? 'covered' : 'confirmed',
      method: l.payment?.method,
    })),
  };
}

export interface CircleReport {
  rows: MemberReport[];
  collected: number;
  outstanding: number;
  overdue: number;
  payoutsDone: number;
  payoutsTotal: number;
}

/** Admin: one report row per member, in turn order, plus totals. */
export function circleReport(circle: Circle, payments: Payment[], today: string = todayISO()): CircleReport {
  const rows = circle.members
    .map((m) => memberReport(circle, payments, m.id, today))
    .sort((a, b) => (a.turns[0]?.number ?? 999) - (b.turns[0]?.number ?? 999));
  const o = overview(circle, payments, today);
  return {
    rows,
    // Money actually paid in (own-turn installments are netted out, not collected).
    collected: rows.reduce((s, r) => s + r.paid.filter((p) => p.how === 'confirmed').reduce((a, p) => a + p.amount, 0), 0),
    outstanding: rows.reduce((s, r) => s + r.amountLeft, 0),
    overdue: rows.reduce((s, r) => s + r.amountOverdue, 0),
    payoutsDone: o.payoutsDone,
    payoutsTotal: o.payoutsTotal,
  };
}
