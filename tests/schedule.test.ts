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
  memberReport,
  circleReport,
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

  it('every-4-months steps four months', () => {
    assert.deepEqual(
      [0, 1, 2, 3].map((i) => stepDate('2026-01-31', 'every4months', i)),
      ['2026-01-31', '2026-05-31', '2026-09-30', '2027-01-31'],
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
  it('summarizes confirmed, claimed and unpaid members; the recipient is covered', () => {
    // p0 goes to 'a': a doesn't pay that period (a stray claim from 'a' is ignored).
    const payments = [pay('p0', 'b'), pay('p0', 'a', 'claimed')];
    const s = periodSummary(makeCircle(), payments, 0);
    assert.deepEqual(s.covered.map((m) => m.id), ['a']);
    assert.deepEqual(s.payers.map((m) => m.id), ['b', 'c']);
    assert.deepEqual(s.confirmed.map((m) => m.id), ['b']);
    assert.deepEqual(s.claimed.map((m) => m.id), []);
    assert.deepEqual(s.unpaid.map((m) => m.id), ['c']);
    assert.equal(s.collected, 1000);
    assert.equal(s.pot, 2000);
    assert.equal(s.isComplete, false);
    assert.equal(periodSummary(makeCircle(), [pay('p0', 'b'), pay('p0', 'c')], 0).isComplete, true);
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

  it('ignores claims for the member\'s own payout period', () => {
    assert.equal(pendingApprovals(makeCircle(), [pay('p0', 'a', 'claimed')]).length, 0);
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
    // p2 is c's own turn: not paid in cash, counted as paid.
    assert.equal(acc.totalPaid, 2000);
    assert.equal(acc.totalPending, 1000);
    assert.equal(acc.remaining, 1500);
    assert.deepEqual(acc.lines.map((l) => l.state), ['confirmed', 'claimed', 'covered', 'upcoming']);
    assert.equal(acc.nextDue?.entry.index, 3);
    assert.equal(acc.nextPayout?.entry.date, '2026-03-31');
    assert.equal(acc.nextPayout?.inDays, 0);
    assert.equal(acc.nextPayout?.amount, 2000);
  });

  it('marks periods overdue after the 7-day grace', () => {
    const acc = memberAccount(makeCircle(), [], 'c', '2026-02-10');
    assert.deepEqual(acc.lines.map((l) => l.state), ['overdue', 'upcoming', 'covered']);
    assert.equal(acc.overdueAmount, 1000);
    const later = memberAccount(makeCircle(), [], 'c', '2026-03-10');
    assert.deepEqual(later.lines.map((l) => l.state), ['overdue', 'overdue', 'covered']);
  });

  it('reports received payouts', () => {
    const circle = makeCircle({ periods: setPaidOut(makeCircle().periods, 'p0', true) });
    const acc = memberAccount(circle, [], 'a', '2026-02-01');
    assert.equal(acc.myPayouts[0].received, true);
    assert.equal(acc.nextPayout, undefined);
  });
});

describe('reports', () => {
  it("summarizes a member's turn, paid and remaining installments", () => {
    const payments = [pay('p0', 'c'), pay('p1', 'c', 'claimed')];
    const r = memberReport(makeCircle(), payments, 'c', '2026-03-31');
    assert.equal(r.turns.length, 1);
    assert.equal(r.turns[0].number, 3);
    assert.equal(r.turns[0].amount, 2000);
    assert.equal(r.installmentsTotal, 3);
    assert.equal(r.installmentsPaid, 2); // p0 paid + p2 is c's own turn
    assert.equal(r.installmentsPending, 1);
    assert.equal(r.installmentsLeft, 1);
    assert.equal(r.amountPaid, 2000);
    assert.equal(r.amountLeft, 1000);
    assert.deepEqual(r.paid.map((p) => p.how), ['confirmed', 'covered']);
  });

  it('builds the admin report in turn order with totals', () => {
    const rep = circleReport(makeCircle(), [pay('p0', 'b'), pay('p0', 'c')], '2026-02-10');
    assert.deepEqual(rep.rows.map((r) => r.member.id), ['a', 'b', 'c']);
    assert.equal(rep.collected, 2000); // b and c paid p0 (own turns are netted out, not collected)
    assert.equal(rep.rows[0].installmentsPaid, 1);
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

import { drawablePayouts, ownerFirstOrder } from '../src/core/schedule.ts';

describe('owner keeps the first turn', () => {
  it('excludes the owner from the draw and puts them first', () => {
    const circle = { ...makeCircle(), ownerMemberId: 'a' };
    const { fixed, open } = drawablePayouts(circle);
    assert.deepEqual(fixed.map((p) => p.recipientId), ['a']);
    assert.deepEqual(open.map((p) => p.recipientId), ['b', 'c']);
    assert.deepEqual(ownerFirstOrder(circle, ['c', 'b']), ['a', 'c', 'b']);
    assert.deepEqual(applyTurnOrder(circle.periods, ownerFirstOrder(circle, ['c', 'b'])).map((p) => p.recipientId), ['a', 'c', 'b']);
  });

  it('draws everyone when there is no fixed owner turn', () => {
    assert.equal(drawablePayouts(makeCircle()).fixed.length, 0);
    const moved = { ...makeCircle(), ownerMemberId: 'a', periods: movePeriod(makeCircle().periods, 0, 2) };
    assert.equal(drawablePayouts(moved).fixed.length, 0);
  });
});

it('redraw only touches turns that have not come yet', async () => {
  const { openPayouts, assignRecipients } = await import('../src/core/schedule.ts');
  const periods = [
    { id: 'p1', kind: 'payout', recipientId: 'owner', paidOut: true },
    { id: 'p2', kind: 'payout', recipientId: 'a' },
    { id: 'p3', kind: 'payout', recipientId: 'b' },
    { id: 'p4', kind: 'payout', recipientId: 'c' },
  ] as any;
  const open = openPayouts({ periods, ownerMemberId: 'owner' }, 1);
  assert.deepEqual(open.map((p: any) => p.id), ['p3', 'p4']);
  const next = assignRecipients(periods, ['p3', 'p4'], ['c', 'b']);
  assert.deepEqual(next.map((p: any) => p.recipientId), ['owner', 'a', 'c', 'b']);
  assert.throws(() => assignRecipients(periods, ['p3', 'p4'], ['a', 'b']));
});

it('a deferred member is not late until their new date', async () => {
  const { paymentState, setDeferral, periodSummary } = await import('../src/core/schedule.ts');
  const period = { id: 'p1', kind: 'payout', recipientId: 'a' } as any;
  const [withLater] = setDeferral([period], 'p1', 'b', '2026-11-20');
  const entry = { index: 0, period: withLater, date: '2026-10-01', due: 100 } as any;
  assert.equal(paymentState(entry, undefined, 0, '2026-10-20', 'b'), 'deferred');
  assert.equal(paymentState(entry, undefined, 0, '2026-11-22', 'b'), 'due');
  assert.equal(paymentState(entry, undefined, 0, '2026-12-05', 'b'), 'overdue');
  assert.equal(paymentState(entry, undefined, 0, '2026-10-20', 'c'), 'overdue');
  const [cleared] = setDeferral([withLater], 'p1', 'b', null);
  assert.equal(cleared.deferrals, undefined);
});

it('speeding up changes only the turns that have not come yet', async () => {
  const { periodDates, speedUp } = await import('../src/core/schedule.ts');
  const base = { startDate: '2026-10-18', frequency: 'monthly' as const };
  const periods = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, kind: 'payout' as const, recipientId: id }));
  assert.deepEqual(periodDates({ ...base, periods }), ['2026-10-18', '2026-11-18', '2026-12-18', '2027-01-18', '2027-02-18']);
  const doubled = speedUp(periods, 1, 'double');
  assert.deepEqual(periodDates({ ...base, periods: doubled }), ['2026-10-18', '2026-11-18', '2026-11-18', '2026-12-18', '2026-12-18']);
  const biweekly = speedUp(periods, 1, '2weeks');
  assert.deepEqual(periodDates({ ...base, periods: biweekly }), ['2026-10-18', '2026-11-18', '2026-12-02', '2026-12-16', '2026-12-30']);
  assert.deepEqual(periodDates({ ...base, periods: speedUp(doubled, 1, 'normal') }), periodDates({ ...base, periods }));
});

it('an extra amount on a turn raises that installment and the payout', async () => {
  const { addBonus, periodDue, payoutNet } = await import('../src/core/schedule.ts');
  const circle = { installment: 500, members: [{}, {}, {}, {}] } as any;
  const periods = [{ id: 'a', kind: 'payout', recipientId: 'x' }, { id: 'b', kind: 'payout', recipientId: 'y' }] as any;
  const next = addBonus(periods, ['b'], 200);
  assert.equal(periodDue(circle, next[0]), 500);
  assert.equal(periodDue(circle, next[1]), 700);
  assert.equal(payoutNet(circle, next[1]), 2100);
});
