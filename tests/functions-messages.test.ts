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
