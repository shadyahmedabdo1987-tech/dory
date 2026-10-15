import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_REMINDERS_PER_CIRCLE, planReminders } from '../src/core/reminders.ts';
import type { Circle, Payment } from '../src/core/types.ts';

function makeCircle(): Circle {
  return {
    id: 'c1',
    name: 'جمعية الشغل',
    installment: 1000,
    currency: 'EGP',
    frequency: 'monthly',
    startDate: '2026-11-10',
    adminUid: 'admin',
    inviteCode: 'ABC234',
    members: [
      { id: 'a', name: 'أحمد' },
      { id: 'b', name: 'منى' },
    ],
    periods: [
      { id: 'p0', kind: 'payout', recipientId: 'a' },
      { id: 'p1', kind: 'skip' },
      { id: 'p2', kind: 'payout', recipientId: 'b' },
    ],
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

const pay = (periodId: string, memberId: string, status: Payment['status'] = 'confirmed'): Payment => ({
  id: `${periodId}_${memberId}`,
  periodId,
  memberId,
  status,
});

describe('member reminders', () => {
  it('reminds the day before and on the day, skipping postponed periods', () => {
    const r = planReminders(makeCircle(), [], { role: 'member', memberId: 'b' }, '2026-10-15');
    assert.deepEqual(
      r.map((x) => [x.date, x.id.split(':').slice(2).join(':')]),
      [
        ['2026-11-09', 'p0:before'],
        ['2026-11-10', 'p0:due'],
        ['2027-01-09', 'p2:before'],
        ['2027-01-10', 'p2:due'],
        ['2027-01-10', 'p2:payout'],
      ],
    );
  });

  it('drops reminders for installments already paid or claimed', () => {
    const r = planReminders(makeCircle(), [pay('p0', 'b', 'claimed')], { role: 'member', memberId: 'b' }, '2026-10-15');
    assert.ok(!r.some((x) => x.id.includes(':p0:')));
  });

  it('never schedules in the past or beyond the horizon', () => {
    const r = planReminders(makeCircle(), [], { role: 'member', memberId: 'a' }, '2026-11-10');
    assert.ok(r.every((x) => x.date > '2026-11-10'));
    const far = planReminders(makeCircle(), [], { role: 'member', memberId: 'a' }, '2025-01-01');
    assert.equal(far.length, 0);
  });
});

describe('admin reminders', () => {
  it('plans collection day and a follow-up while members are missing', () => {
    const r = planReminders(makeCircle(), [pay('p0', 'a')], { role: 'admin' }, '2026-10-15');
    assert.deepEqual(
      r.map((x) => x.id.split(':').slice(2).join(':')),
      ['p0:collect', 'p0:followup', 'p2:collect', 'p2:followup'],
    );
  });

  it('stops reminding when everyone is confirmed', () => {
    const r = planReminders(makeCircle(), [pay('p0', 'a'), pay('p0', 'b')], { role: 'admin' }, '2026-10-15');
    assert.ok(!r.some((x) => x.id.includes(':p0:')));
  });

  it('caps reminders per circle', () => {
    const circle = makeCircle();
    circle.frequency = 'weekly';
    circle.periods = Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, kind: 'payout' as const, recipientId: 'a' }));
    assert.equal(planReminders(circle, [], { role: 'admin' }, '2026-10-15').length, MAX_REMINDERS_PER_CIRCLE);
  });
});
