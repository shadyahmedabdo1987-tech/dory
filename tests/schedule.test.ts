import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { addMonths, stepDate } from '../src/core/dates.ts';
import {
  addExtraInstallment,
  addExtraTurn,
  currentIndex,
  drawTurns,
  generateInviteCode,
  initialPeriods,
  memberAccount,
  movePeriod,
  overview,
  paymentId,
  pendingApprovals,
  periodSummary,
  postpone,
  removePeriod,
  setPaidOut,
  syncPeriodsWithMembers,
  timeline,
  validateDraft,
} from '../src/core/schedule.ts';
import { normalizePhone } from '../src/core/format.ts';
import type { Circle, Payment } from '../src/core/types.ts';

const members = [
  { id: 'a', name: 'أحمد', phone: '01011111111' },
  { id: 'b', name: 'منى', phone: '01022222222' },
  { id: 'c', name: 'كريم' },
];

function makeCircle(overrides: Partial<Circle> = {}): Circle {
  return {
    id: 'c1',
    name: 'جمعية الشغل',
    installment: 1000,
    currency: 'EGP',
    frequency: 'monthly',
    startDate: '2026-01-31',
    adminUid: 'admin',
    inviteCode: 'ABC234',
    members,
    periods: [
      { id: 'p0', kind: 'payout', recipientId: 'a' },
      { id: 'p1', kind: 'payout', recipientId: 'b' },
      { id: 'p2', kind: 'payout', recipientId: 'c' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const pay = (periodId: string, memberId: string, status: Payment['status'] = 'confirmed'): Payment => ({
  id: paymentId(periodId, memberId),
  periodId,
  memberId,
  status,
});

describe('frequencies', () => {
  it('monthly clamps month end', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  });

  it('quarterly steps three months', () => {
    assert.deepEqual(
      [0, 1, 2, 3].map((i) => stepDate('2026-01-15', 'quarterly', i)),
      ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'],
    );
  });

  it('weekly steps seven days', () => {
    assert.equal(stepDate('2026-12-29', 'weekly', 1), '2027-01-05');
  });
});

describe('timeline editing', () => {
  it('builds one payout per member', () => {
    const periods = initialPeriods(members);
    assert.deepEqual(periods.map((p) => p.recipientId), ['a', 'b', 'c']);
    assert.equal(new Set(periods.map((p) => p.id)).size, 3);
  });

  it('postponing pushes later periods one step', () => {
    const circle = makeCircle({ periods: postpone(makeCircle().periods, 1, 'العيد') });
    const t = timeline(circle);
    assert.deepEqual(
      t.map((e) => [e.period.kind, e.recipient?.id ?? null, e.date, e.due]),
      [
        ['payout', 'a', '2026-01-31', 1000],
        ['skip', null, '2026-02-28', 0],
        ['payout', 'b', '2026-03-31', 1000],
        ['payout', 'c', '2026-04-30', 1000],
      ],
    );
    assert.equal(t[1].period.note, 'العيد');
  });

  it('adds an extra turn at the end', () => {
    const periods = addExtraTurn(makeCircle().periods, 'a');
    assert.equal(periods.length, 4);
    assert.deepEqual(periods.at(-1)?.recipientId, 'a');
  });

  it('adds an extra installment with its own amount', () => {
    const circle = makeCircle({ periods: addExtraInstallment(makeCircle().periods, 2, 500) });
    const t = timeline(circle);
    assert.equal(t[2].period.kind, 'extra');
    assert.equal(t[2].due, 500);
    assert.equal(t[3].recipient?.id, 'c');
  });

  it('removes and moves periods', () => {
    const base = makeCircle().periods;
    assert.deepEqual(removePeriod(base, 'p1').map((p) => p.id), ['p0', 'p2']);
    assert.deepEqual(movePeriod(base, 2, 0).map((p) => p.id), ['p2', 'p0', 'p1']);
    assert.deepEqual(movePeriod(base, 0, 9).map((p) => p.id), ['p0', 'p1', 'p2']);
  });

  it('syncs periods when members change', () => {
    const periods = postpone(makeCircle().periods, 1);
    const synced = syncPeriodsWithMembers(periods, [members[0], members[2], { id: 'd', name: 'سارة' }]);
    assert.deepEqual(
      synced.map((p) => p.kind === 'payout' ? p.recipientId : p.kind),
      ['a', 'skip', 'c', 'd'],
    );
  });

  it('draws turns but keeps skips in place', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const periods = drawTurns(postpone(makeCircle().periods, 1), random);
    assert.equal(periods[1].kind, 'skip');
    assert.deepEqual(
      periods.filter((p) => p.kind === 'payout').map((p) => p.recipientId).sort(),
      ['a', 'b', 'c'],
    );
  });
});

describe('payments & approvals', () => {
  it('summarizes confirmed, claimed and unpaid members', () => {
    const payments = [pay('p0', 'a'), pay('p0', 'b', 'claimed')];
    const s = periodSummary(makeCircle(), payments, 0);
    assert.deepEqual(s.confirmed.map((m) => m.id), ['a']);
    assert.deepEqual(s.claimed.map((m) => m.id), ['b']);
    assert.deepEqual(s.unpaid.map((m) => m.id), ['c']);
    assert.equal(s.collected, 1000);
    assert.equal(s.pot, 3000);
    assert.equal(s.isComplete, false);
  });

  it('treats skip periods as complete', () => {
    const circle = makeCircle({ periods: postpone(makeCircle().periods, 0) });
    assert.equal(periodSummary(circle, [], 0).isComplete, true);
  });

  it('lists pending approvals in timeline order', () => {
    const payments = [pay('p1', 'a', 'claimed'), pay('p0', 'c', 'claimed'), pay('p0', 'a')];
    assert.deepEqual(
      pendingApprovals(makeCircle(), payments).map((x) => x.payment.id),
      ['p0_c', 'p1_a'],
    );
  });

  it('ignores payments of removed periods or members', () => {
    const payments = [pay('gone', 'a', 'claimed'), pay('p0', 'zzz', 'claimed')];
    assert.equal(pendingApprovals(makeCircle(), payments).length, 0);
  });
});

describe('member account (bank view)', () => {
  it('computes commitment, paid, pending, overdue and next payout', () => {
    const circle = makeCircle({ periods: addExtraInstallment(makeCircle().periods, 3, 500) });
    const payments = [pay('p0', 'c'), pay('p1', 'c', 'claimed')];
    const acc = memberAccount(circle, payments, 'c', '2026-03-31');
    assert.equal(acc.totalCommitment, 3500);
    assert.equal(acc.totalPaid, 1000);
    assert.equal(acc.totalPending, 1000);
    assert.equal(acc.remaining, 2500);
    assert.deepEqual(acc.lines.map((l) => l.state), ['confirmed', 'claimed', 'due', 'upcoming']);
    assert.equal(acc.nextDue?.entry.index, 2);
    assert.equal(acc.nextPayout?.entry.date, '2026-03-31');
    assert.equal(acc.nextPayout?.inDays, 0);
    assert.equal(acc.nextPayout?.amount, 3000);
  });

  it('marks periods overdue after the 7-day grace', () => {
    const acc = memberAccount(makeCircle(), [], 'a', '2026-02-10');
    assert.deepEqual(acc.lines.map((l) => l.state), ['overdue', 'upcoming', 'upcoming']);
    assert.equal(acc.overdueAmount, 1000);
    const later = memberAccount(makeCircle(), [], 'a', '2026-03-10');
    assert.deepEqual(later.lines.map((l) => l.state), ['overdue', 'overdue', 'upcoming']);
  });

  it('reports received payouts', () => {
    const circle = makeCircle({ periods: setPaidOut(makeCircle().periods, 'p0', true) });
    const acc = memberAccount(circle, [], 'a', '2026-02-01');
    assert.equal(acc.myPayouts[0].received, true);
    assert.equal(acc.nextPayout, undefined);
  });
});

describe('overview', () => {
  it('summarizes the circle for the admin', () => {
    const payments = [pay('p0', 'a'), pay('p0', 'b', 'claimed')];
    const o = overview(makeCircle(), payments, '2026-02-15');
    assert.equal(o.current, 0);
    assert.equal(o.status, 'active');
    assert.equal(o.overdueCount, 1); // c in p0 (b claimed is pending, not overdue)
    assert.equal(o.pendingCount, 1);
    assert.equal(o.nextPayoutEntry?.recipient?.id, 'a');
  });

  it('is finished when every payout is handed over', () => {
    let periods = makeCircle().periods;
    for (const p of periods) periods = setPaidOut(periods, p.id, true);
    assert.equal(overview(makeCircle({ periods }), [], '2026-05-01').status, 'finished');
  });

  it('finds the current index', () => {
    const c = makeCircle();
    assert.equal(currentIndex(c, '2026-01-30'), -1);
    assert.equal(currentIndex(c, '2026-02-28'), 1);
  });
});

describe('validation', () => {
  it('reports every problem', () => {
    assert.deepEqual(
      validateDraft({ name: '', installment: -1, frequency: 'monthly', startDate: '2026-02-30', members: [] }, normalizePhone),
      ['name', 'installment', 'startDate', 'members'],
    );
  });

  it('rejects duplicate phones in different formats', () => {
    const draft = {
      name: 'x',
      installment: 100,
      frequency: 'quarterly' as const,
      startDate: '2026-10-01',
      members: [
        { id: '1', name: 'أ', phone: '01012345678' },
        { id: '2', name: 'ب', phone: '+20 101 234 5678' },
      ],
    };
    assert.deepEqual(validateDraft(draft, normalizePhone), ['duplicatePhone']);
  });

  it('generates readable invite codes', () => {
    const code = generateInviteCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  });
});

import { applyTurnOrder, sliceAtPointer, spinTarget } from '../src/core/schedule.ts';

describe('draw wheel', () => {
  it('applies a drawn order to payout periods only', () => {
    const periods = postpone(makeCircle().periods, 1);
    const next = applyTurnOrder(periods, ['c', 'a', 'b']);
    assert.deepEqual(next.map((p) => (p.kind === 'payout' ? p.recipientId : p.kind)), ['c', 'skip', 'a', 'b']);
  });

  it('rejects an order that does not match the recipients', () => {
    assert.throws(() => applyTurnOrder(makeCircle().periods, ['a', 'b']));
    assert.throws(() => applyTurnOrder(makeCircle().periods, ['a', 'b', 'x']));
  });

  it('lands every slice exactly under the pointer', () => {
    for (const count of [1, 2, 3, 7, 12, 30]) {
      for (let index = 0; index < count; index++) {
        const from = 1234.5;
        const target = spinTarget(count, index, from);
        assert.ok(target > from + 360 * 5, 'spins forward several turns');
        assert.equal(sliceAtPointer(count, target), index);
      }
    }
  });
});
