import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  addMonths,
  buildSchedule,
  currentCycle,
  drawTurns,
  markAllPaid,
  memberStatement,
  moveItem,
  potSize,
  progress,
  summarizeCycle,
  togglePaidOut,
  togglePayment,
  validateDraft,
} from '../src/core/circle.ts';
import type { Circle } from '../src/core/types.ts';

function makeCircle(overrides: Partial<Circle> = {}): Circle {
  return {
    id: 'c1',
    name: 'جمعية الشغل',
    installment: 1000,
    currency: 'EGP',
    frequency: 'monthly',
    startDate: '2026-01-31',
    members: [
      { id: 'a', name: 'أحمد' },
      { id: 'b', name: 'منى' },
      { id: 'c', name: 'كريم' },
    ],
    payments: [],
    paidOutCycles: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('dates', () => {
  it('clamps month-end when adding months', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  });

  it('adds days across month and year boundaries', () => {
    assert.equal(addDays('2026-12-29', 7), '2027-01-05');
  });
});

describe('schedule', () => {
  it('builds one payout per member in turn order', () => {
    const schedule = buildSchedule(makeCircle());
    assert.deepEqual(
      schedule.map((s) => [s.date, s.recipient.id]),
      [
        ['2026-01-31', 'a'],
        ['2026-02-28', 'b'],
        ['2026-03-31', 'c'],
      ],
    );
  });

  it('supports weekly circles', () => {
    const schedule = buildSchedule(makeCircle({ frequency: 'weekly', startDate: '2026-10-01' }));
    assert.deepEqual(
      schedule.map((s) => s.date),
      ['2026-10-01', '2026-10-08', '2026-10-15'],
    );
  });

  it('computes the pot', () => {
    assert.equal(potSize(makeCircle()), 3000);
  });

  it('finds the current cycle', () => {
    const circle = makeCircle();
    assert.equal(currentCycle(circle, '2026-01-01'), -1);
    assert.equal(currentCycle(circle, '2026-01-31'), 0);
    assert.equal(currentCycle(circle, '2026-03-01'), 1);
    assert.equal(currentCycle(circle, '2030-01-01'), 2);
  });
});

describe('payments', () => {
  it('toggles a payment on and off', () => {
    const now = new Date('2026-02-01T10:00:00Z');
    let circle = togglePayment(makeCircle(), 'a', 0, now);
    assert.equal(circle.payments.length, 1);
    assert.equal(circle.payments[0].paidAt, now.toISOString());
    circle = togglePayment(circle, 'a', 0, now);
    assert.equal(circle.payments.length, 0);
  });

  it('summarizes a cycle', () => {
    const circle = togglePayment(togglePayment(makeCircle(), 'a', 0), 'c', 0);
    const summary = summarizeCycle(circle, 0);
    assert.equal(summary.collected, 2000);
    assert.equal(summary.pot, 3000);
    assert.deepEqual(summary.unpaidMembers.map((m) => m.id), ['b']);
    assert.equal(summary.isComplete, false);
  });

  it('marks everyone paid without duplicating payments', () => {
    const circle = markAllPaid(togglePayment(makeCircle(), 'a', 0), 0);
    assert.equal(circle.payments.length, 3);
    assert.equal(summarizeCycle(circle, 0).isComplete, true);
  });

  it('does not mutate the original circle', () => {
    const original = makeCircle();
    togglePayment(original, 'a', 0);
    assert.equal(original.payments.length, 0);
  });
});

describe('progress & statements', () => {
  it('counts overdue installments up to the current cycle', () => {
    const circle = togglePayment(makeCircle(), 'a', 0);
    const p = progress(circle, '2026-03-01');
    assert.equal(p.currentCycle, 1);
    assert.equal(p.overdueCount, 5); // 2 missing in cycle 0 + 3 in cycle 1
    assert.equal(p.overdueAmount, 5000);
    assert.equal(p.status, 'active');
  });

  it('is finished once every pot is paid out', () => {
    let circle = makeCircle();
    for (const c of [0, 1, 2]) circle = togglePaidOut(markAllPaid(circle, c), c);
    const p = progress(circle, '2026-04-01');
    assert.equal(p.status, 'finished');
    assert.equal(p.ratio, 1);
  });

  it('reports upcoming before the start date', () => {
    assert.equal(progress(makeCircle(), '2025-12-01').status, 'upcoming');
  });

  it('builds a member statement', () => {
    const circle = togglePayment(makeCircle(), 'b', 0);
    const s = memberStatement(circle, 'b', '2026-03-01');
    assert.equal(s.turn, 1);
    assert.equal(s.payoutDate, '2026-02-28');
    assert.equal(s.totalPaid, 1000);
    assert.deepEqual(s.overdue, [1]);
    assert.equal(s.receives, 3000);
  });
});

describe('helpers', () => {
  it('draws a permutation of the members', () => {
    let seed = 42;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const result = drawTurns([1, 2, 3, 4, 5], random);
    assert.deepEqual([...result].sort(), [1, 2, 3, 4, 5]);
  });

  it('moves items and ignores out-of-range moves', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
  });

  it('validates drafts', () => {
    assert.deepEqual(
      validateDraft({ name: ' ', installment: 0, frequency: 'monthly', startDate: 'x', members: [] }),
      ['name', 'installment', 'startDate', 'members'],
    );
    assert.deepEqual(
      validateDraft({
        name: 'ok',
        installment: 500,
        frequency: 'monthly',
        startDate: '2026-10-01',
        members: [
          { id: '1', name: 'أ' },
          { id: '2', name: 'ب' },
        ],
      }),
      [],
    );
  });
});
