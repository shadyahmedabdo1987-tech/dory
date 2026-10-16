import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDate,
  groupSummaryMessage,
  inviteMessage,
  extractInviteCode,
  circleInviteMessage,
  smsUrl,
  normalizePayAccount,
  normalizePhone,
  parseAmount,
  relativeDays,
  reminderMessage,
  whatsappUrl,
} from '../src/core/format.ts';
import { timeline } from '../src/core/schedule.ts';
import type { Circle } from '../src/core/types.ts';

const circle: Circle = {
  id: 'c1',
  name: 'جمعية العيلة',
  installment: 2000,
  currency: 'EGP',
  frequency: 'monthly',
  startDate: '2026-10-01',
  adminUid: 'admin',
  inviteCode: 'K7QX2M',
  members: [
    { id: 'a', name: 'سارة', phone: '01012345678' },
    { id: 'b', name: 'محمود' },
  ],
  periods: [
    { id: 'p0', kind: 'payout', recipientId: 'a' },
    { id: 'p1', kind: 'extra', amount: 300 },
  ],
  createdAt: '2026-10-01T00:00:00.000Z',
};

describe('phones', () => {
  it('normalizes Egyptian, international and Arabic-digit numbers', () => {
    assert.equal(normalizePhone('010 1234 5678'), '201012345678');
    assert.equal(normalizePhone('+966 50 123 4567'), '966501234567');
    assert.equal(normalizePhone('00971501234567'), '971501234567');
    assert.equal(normalizePhone('٠١٠١٢٣٤٥٦٧٨'), '201012345678');
    assert.equal(normalizePhone('abc'), null);
    assert.equal(normalizePhone('123'), null);
  });

  it('builds WhatsApp links', () => {
    assert.equal(whatsappUrl('01012345678', 'hi there'), 'https://wa.me/201012345678?text=hi%20there');
    assert.equal(whatsappUrl(undefined, 'x'), 'https://wa.me/?text=x');
  });
});

describe('amounts & dates', () => {
  it('parses amounts with Arabic digits and separators', () => {
    assert.equal(parseAmount('١٬٥٠٠'), 1500);
    assert.equal(parseAmount('2,000'), 2000);
    assert.ok(Number.isNaN(parseAmount('')));
  });

  it('formats dates and relative days', () => {
    assert.match(formatDate('2026-10-15'), /أكتوبر/);
    assert.equal(relativeDays(0), 'النهارده');
    assert.match(relativeDays(5), /بعد/);
  });
});

describe('messages', () => {
  const [payout, extra] = timeline(circle);

  it('writes reminders including extra installments', () => {
    assert.match(reminderMessage(circle, circle.members[1], payout), /محمود/);
    assert.match(reminderMessage(circle, circle.members[1], extra), /قسط إضافي/);
  });

  it('writes the invite with the code on its own monospace line', () => {
    const text = inviteMessage({ ...circle, inviteCode: 'K7QX2M' }, circle.members[0]);
    assert.ok(text.split('\n').includes('```K7QX2M```'));
    assert.doesNotMatch(text, /dory:\/\//);
  });

  it('accepts a wallet number or an InstaPay address as a payout account', () => {
    assert.equal(normalizePayAccount('010 1234 5678'), '201012345678');
    assert.equal(normalizePayAccount('Mona.Ali@InstaPay'), 'mona.ali@instapay');
    assert.equal(normalizePayAccount('mona@'), null);
    assert.equal(normalizePayAccount('abc'), null);
  });

  it('writes the invitation with the circle name, a welcome and the code', () => {
    const text = circleInviteMessage({ name: 'جمعية الشغل', inviteCode: 'NAFUAR' });
    assert.match(text, /أهلًا بيك/);
    assert.match(text, /جمعية الشغل/);
    assert.match(text, /NAFUAR/);
    assert.equal(extractInviteCode(text), 'NAFUAR');
  });

  it('builds SMS links for one or many numbers', () => {
    assert.equal(smsUrl(['201012345678'], 'hi', 'android'), 'sms:+201012345678?body=hi');
    assert.equal(smsUrl(['201012345678', '201112345678'], 'hi', 'android'), 'sms:+201012345678;+201112345678?body=hi');
    assert.equal(smsUrl(['201012345678'], 'hi', 'ios'), 'sms:+201012345678&body=hi');
  });

  it('extracts the invite code from whatever was pasted', () => {
    const invite = inviteMessage({ ...circle, inviteCode: 'NAFUAR' }, circle.members[0]);
    assert.equal(extractInviteCode(invite), 'NAFUAR');
    assert.equal(extractInviteCode('nafuar'), 'NAFUAR');
    assert.equal(extractInviteCode(' NAF UAR '), 'NAFUAR');
    assert.equal(extractInviteCode('كود الجمعية: K7QX2M\nادخل برقمك'), 'K7QX2M');
    assert.equal(extractInviteCode('dory:///join?code=K7QX2M'), 'K7QX2M');
    assert.equal(extractInviteCode('مرحبا'), null);
    assert.equal(extractInviteCode('ABC'), null);
  });

  it('lists unpaid members in the group summary', () => {
    assert.match(groupSummaryMessage(circle, payout, [circle.members[1]]), /محمود/);
    assert.match(groupSummaryMessage(circle, payout, []), /الكل دفع/);
  });
});
