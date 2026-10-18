import { addDays, daysBetween, todayISO } from './dates.ts';
import { formatDate, formatMoney, periodTitle } from './format.ts';
import { findPayment, isOwnPayout, payoutNet, timeline, deferralOf } from './schedule.ts';
import type { Circle, Payment } from './types';

/** A local notification to schedule on this device. */
export interface PlannedReminder {
  /** Stable id: `dory:{circleId}:{periodId}:{kind}` — re-planning replaces, never duplicates. */
  id: string;
  /** ISO date; delivered at REMINDER_HOUR local time. */
  date: string;
  title: string;
  body: string;
  circleId: string;
}

export const REMINDER_HOUR = 10;
/** How far ahead to schedule (iOS keeps at most 64 pending notifications per app). */
export const REMINDER_HORIZON_DAYS = 120;
export const MAX_REMINDERS_PER_CIRCLE = 8;

export function reminderPrefix(circleId: string): string {
  return `dory:${circleId}:`;
}

/**
 * Plans the local reminders for one circle from this device's point of view.
 *  - member: the day before and the day of each installment they haven't paid,
 *            and the day of their own payout
 *  - admin:  collection day of every period, and a nudge 3 days later if
 *            members are still missing
 */
export function planReminders(
  circle: Circle,
  payments: Payment[],
  viewer: { role: 'admin' } | { role: 'member'; memberId: string },
  today: string = todayISO(),
): PlannedReminder[] {
  const horizon = addDays(today, REMINDER_HORIZON_DAYS);
  const out: PlannedReminder[] = [];
  const push = (periodId: string, kind: string, date: string, title: string, body: string) => {
    if (date > today && date <= horizon) {
      out.push({ id: `${reminderPrefix(circle.id)}${periodId}:${kind}`, date, title, body, circleId: circle.id });
    }
  };

  for (const entry of timeline(circle)) {
    // A member with a later date (set by the organizer) is reminded on that date instead.
    const myDue = viewer.role === 'member' ? (deferralOf(entry.period, viewer.memberId) ?? entry.date) : entry.date;
    if (myDue < today) continue;
    const pid = entry.period.id;

    if (viewer.role === 'member') {
      const paid = findPayment(payments, pid, viewer.memberId);
      const ownTurn = isOwnPayout(entry.period, viewer.memberId);
      if (entry.due > 0 && !paid && !ownTurn) {
        const amount = formatMoney(entry.due, circle.currency);
        push(pid, 'before', addDays(myDue, -1), `قسط ${circle.name} بكرة`, `${amount} — ${formatDate(myDue)}`);
        push(pid, 'due', myDue, `النهارده ميعاد قسط ${circle.name}`, `${amount}. ادخل دوري ودوس "دفعت" بعد ما تدفع.`);
      }
      if (ownTurn && !entry.period.paidOut) {
        push(pid, 'payout', entry.date, `النهارده دورك تقبض 🎉`, `قبض ${circle.name}: ${formatMoney(payoutNet(circle), circle.currency)} (من غير ما تدفع قسط الدور ده)`);
      }
    } else if (entry.due > 0) {
      const missing = circle.members.filter(
        (m) => !isOwnPayout(entry.period, m.id) && findPayment(payments, pid, m.id)?.status !== 'confirmed',
      ).length;
      if (missing > 0) {
        push(pid, 'collect', entry.date, `ميعاد تحصيل ${circle.name}`, `${periodTitle(entry)} — ${formatDate(entry.date)}`);
        push(pid, 'followup', addDays(entry.date, 3), `متابعة تحصيل ${circle.name}`, 'شوف مين لسه ما دفعش وابعتله تذكير.');
      }
    }
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, MAX_REMINDERS_PER_CIRCLE);
}

/** Days until a reminder fires (for UI/debugging). */
export function reminderInDays(r: PlannedReminder, today: string = todayISO()): number {
  return daysBetween(today, r.date);
}
