import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMessages,
  chunk,
  claimedMessage,
  newlyPaidOut,
  paymentEvent,
} from '../functions/src/messages.ts';

describe('server notifications', () => {
  it('detects claim and confirm transitions only once', () => {
    const claimed = { periodId: 'p', memberId: 'm', status: 'claimed' as const };
    const confirmed = { ...claimed, status: 'confirmed' as const };
    assert.equal(paymentEvent(undefined, claimed), 'claimed');
    assert.equal(paymentEvent(claimed, confirmed), 'confirmed');
    assert.equal(paymentEvent(undefined, confirmed), 'confirmed'); // cash recorded by admin
    assert.equal(paymentEvent(claimed, { ...claimed, note: 'x' }), null);
    assert.equal(paymentEvent(confirmed, undefined), null);
  });

  it('finds payouts that were just handed over', () => {
    const before = [{ id: 'a', kind: 'payout' as const }, { id: 'b', kind: 'payout' as const, paidOut: true }];
    const after = [{ id: 'a', kind: 'payout' as const, paidOut: true }, { id: 'b', kind: 'payout' as const, paidOut: true }];
    assert.deepEqual(newlyPaidOut(before, after).map((p) => p.id), ['a']);
  });

  it('keeps only valid, unique Expo tokens', () => {
    const msgs = buildMessages(
      ['ExponentPushToken[abc]', 'ExponentPushToken[abc]', 'garbage', 'ExpoPushToken[x]'],
      claimedMessage('جمعية', 'منى', 1000),
      { circleId: 'c' },
    );
    assert.deepEqual(msgs.map((m) => m.to), ['ExponentPushToken[abc]', 'ExpoPushToken[x]']);
    assert.match(msgs[0].body, /منى|جمعية/);
  });

  it('mentions the method and the screenshot in the admin push', () => {
    const msg = claimedMessage('جمعية الشغل', 'منى', 1000, 'vodafone_cash', true);
    assert.match(msg.title, /فودافون كاش/);
    assert.match(msg.body, /صورة التحويل/);
  });

  it('chunks requests to Expo’s 100-message limit', () => {
    assert.deepEqual(chunk([...Array(205).keys()], 100).map((c) => c.length), [100, 100, 5]);
  });
});

import { payoutEvent, payoutMessageFor } from '../functions/src/messages.ts';

describe('payout notifications', () => {
  const base = { periodId: 'p', recipientId: 'm', method: 'vodafone_cash' as const, account: '01011111111' };

  it('fires on every status change and on edits of a pending request', () => {
    assert.equal(payoutEvent(undefined, { ...base, status: 'requested' }), 'requested');
    assert.equal(payoutEvent({ ...base, status: 'requested' }, { ...base, status: 'requested', account: '01022222222' }), 'requested');
    assert.equal(payoutEvent({ ...base, status: 'requested' }, { ...base, status: 'requested' }), null);
    assert.equal(payoutEvent({ ...base, status: 'requested' }, { ...base, status: 'approved' }), 'approved');
    assert.equal(payoutEvent({ ...base, status: 'approved' }, { ...base, status: 'paid', hasReceipt: true }), 'paid');
    assert.equal(payoutEvent({ ...base, status: 'paid' }, undefined), null);
  });

  it('writes clear Arabic messages', () => {
    const paid = payoutMessageFor('paid', 'جمعية الشغل', 'منى', { ...base, status: 'paid', hasReceipt: true }, 10000);
    assert.match(paid.body, /فودافون كاش/);
    assert.match(paid.body, /إيصال/);
    const rejected = payoutMessageFor('rejected', 'جمعية الشغل', 'منى', { ...base, status: 'rejected', adminNote: 'الرقم غلط' }, 0);
    assert.match(rejected.body, /الرقم غلط/);
  });
});

import { payoutAudience } from '../functions/src/messages.ts';

describe('payout confirmation notifications', () => {
  it('tells the admin when the recipient confirms or disputes', () => {
    assert.equal(payoutAudience('received'), 'admin');
    assert.equal(payoutAudience('disputed'), 'admin');
    assert.equal(payoutAudience('requested'), 'admin');
    assert.equal(payoutAudience('paid'), 'recipient');
    const msg = payoutMessageFor('disputed', 'جمعية', 'منى', { periodId: 'p', recipientId: 'm', status: 'disputed', method: 'instapay', disputeNote: 'ما وصلش' }, 0);
    assert.match(msg.body, /ما وصلش/);
  });
});
