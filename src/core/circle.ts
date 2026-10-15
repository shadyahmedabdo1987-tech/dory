import type {
  Circle,
  CycleSummary,
  Frequency,
  Member,
  Payment,
  ScheduleEntry,
} from './types';

// ---------------------------------------------------------------------------
// Dates (pure, timezone-safe: we only ever work with calendar dates)
// ---------------------------------------------------------------------------

interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

export function parseISODate(iso: string): YMD {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Invalid date: ${iso}`);
  const [, y, m, d] = match;
  return { y: Number(y), m: Number(m), d: Number(d) };
}

export function toISODate({ y, m, d }: YMD): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds months, clamping to the last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parseISODate(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISODate({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseISODate(iso);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return toISODate({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() });
}

export function cycleDate(startDate: string, frequency: Frequency, cycle: number): string {
  return frequency === 'monthly' ? addMonths(startDate, cycle) : addDays(startDate, cycle * 7);
}

// ---------------------------------------------------------------------------
// Circle math
// ---------------------------------------------------------------------------

export function cycleCount(circle: Circle): number {
  return circle.members.length;
}

export function potSize(circle: Circle): number {
  return circle.installment * circle.members.length;
}

export function buildSchedule(circle: Circle): ScheduleEntry[] {
  return circle.members.map((recipient, cycle) => ({
    cycle,
    date: cycleDate(circle.startDate, circle.frequency, cycle),
    recipient,
  }));
}

export function endDate(circle: Circle): string | undefined {
  const schedule = buildSchedule(circle);
  return schedule[schedule.length - 1]?.date;
}

/**
 * The cycle that is "active" on `today`: the latest cycle whose date has
 * arrived. Returns -1 before the circle starts and the last index after it ends.
 */
export function currentCycle(circle: Circle, today: string = todayISO()): number {
  let current = -1;
  for (const entry of buildSchedule(circle)) {
    if (entry.date <= today) current = entry.cycle;
    else break;
  }
  return current;
}

export function isPaid(circle: Circle, memberId: string, cycle: number): boolean {
  return circle.payments.some((p) => p.memberId === memberId && p.cycle === cycle);
}

export function summarizeCycle(circle: Circle, cycle: number): CycleSummary {
  const recipient = circle.members[cycle];
  if (!recipient) throw new RangeError(`Cycle ${cycle} out of range`);
  const paidMembers: Member[] = [];
  const unpaidMembers: Member[] = [];
  for (const member of circle.members) {
    (isPaid(circle, member.id, cycle) ? paidMembers : unpaidMembers).push(member);
  }
  return {
    cycle,
    date: cycleDate(circle.startDate, circle.frequency, cycle),
    recipient,
    pot: potSize(circle),
    collected: paidMembers.length * circle.installment,
    paidMembers,
    unpaidMembers,
    isComplete: unpaidMembers.length === 0,
    isPaidOut: circle.paidOutCycles.includes(cycle),
  };
}

export interface CircleProgress {
  totalCycles: number;
  currentCycle: number;
  /** Cycles whose pot was handed over. */
  paidOut: number;
  /** Late payments: unpaid installments in cycles that already started. */
  overdueCount: number;
  overdueAmount: number;
  status: 'upcoming' | 'active' | 'finished';
  ratio: number;
}

export function progress(circle: Circle, today: string = todayISO()): CircleProgress {
  const totalCycles = cycleCount(circle);
  const current = currentCycle(circle, today);
  let overdueCount = 0;
  for (let c = 0; c <= current; c++) {
    overdueCount += summarizeCycle(circle, c).unpaidMembers.length;
  }
  const paidOut = circle.paidOutCycles.length;
  const finished = totalCycles > 0 && paidOut >= totalCycles;
  return {
    totalCycles,
    currentCycle: current,
    paidOut,
    overdueCount,
    overdueAmount: overdueCount * circle.installment,
    status: finished ? 'finished' : current < 0 ? 'upcoming' : 'active',
    ratio: totalCycles === 0 ? 0 : paidOut / totalCycles,
  };
}

export interface MemberStatement {
  member: Member;
  turn: number;
  payoutDate: string;
  paidCount: number;
  totalPaid: number;
  /** Installments due up to and including the current cycle but not paid. */
  overdue: number[];
  receives: number;
}

export function memberStatement(
  circle: Circle,
  memberId: string,
  today: string = todayISO(),
): MemberStatement {
  const turn = circle.members.findIndex((m) => m.id === memberId);
  if (turn < 0) throw new Error(`Unknown member ${memberId}`);
  const paid = circle.payments.filter((p) => p.memberId === memberId);
  const current = currentCycle(circle, today);
  const overdue: number[] = [];
  for (let c = 0; c <= current; c++) if (!isPaid(circle, memberId, c)) overdue.push(c);
  return {
    member: circle.members[turn],
    turn,
    payoutDate: cycleDate(circle.startDate, circle.frequency, turn),
    paidCount: paid.length,
    totalPaid: paid.length * circle.installment,
    overdue,
    receives: potSize(circle),
  };
}

// ---------------------------------------------------------------------------
// Immutable updates
// ---------------------------------------------------------------------------

export function togglePayment(
  circle: Circle,
  memberId: string,
  cycle: number,
  now: Date = new Date(),
): Circle {
  if (isPaid(circle, memberId, cycle)) {
    return {
      ...circle,
      payments: circle.payments.filter((p) => !(p.memberId === memberId && p.cycle === cycle)),
    };
  }
  const payment: Payment = { memberId, cycle, paidAt: now.toISOString() };
  return { ...circle, payments: [...circle.payments, payment] };
}

export function markAllPaid(circle: Circle, cycle: number, now: Date = new Date()): Circle {
  const missing = circle.members
    .filter((m) => !isPaid(circle, m.id, cycle))
    .map<Payment>((m) => ({ memberId: m.id, cycle, paidAt: now.toISOString() }));
  return { ...circle, payments: [...circle.payments, ...missing] };
}

export function togglePaidOut(circle: Circle, cycle: number): Circle {
  const paidOutCycles = circle.paidOutCycles.includes(cycle)
    ? circle.paidOutCycles.filter((c) => c !== cycle)
    : [...circle.paidOutCycles, cycle].sort((a, b) => a - b);
  return { ...circle, paidOutCycles };
}

/** Fisher–Yates shuffle for the turn draw (القرعة). `random` is injectable for tests. */
export function drawTurns<T>(items: readonly T[], random: () => number = Math.random): T[] {
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
// Validation
// ---------------------------------------------------------------------------

export interface CircleDraft {
  name: string;
  installment: number;
  frequency: Frequency;
  startDate: string;
  members: Member[];
}

export type DraftError = 'name' | 'installment' | 'startDate' | 'members' | 'memberName';

export function validateDraft(draft: CircleDraft): DraftError[] {
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
  return errors;
}
