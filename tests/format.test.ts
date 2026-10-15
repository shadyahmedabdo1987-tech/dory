import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDate,
  groupSummaryMessage,
  normalizePhone,
  ordinalTurn,
  reminderMessage,
  whatsappUrl,
} from '../src/core/format.ts';
import type { Circle } from '../src/core/types.ts';

const circle: Circle = {
  id: 'c1',
  name: 'جمعية العيلة',
  installment: 2000,
  currency: 'EGP',
  frequency: 'monthly',
  startDate: '2026-10-01',
  members: [
    { id: 'a', name: 'سارة', phone: '01012345678' },
    { id: 'b', name: 'محمود' },
  ],
  payments: [],
  paidOutCycles: [],
  createdAt: '2026-10-01T00:00:00.000Z',
};

describe('phone numbers', () => {
  it('adds the Egyptian country code to local numbers', () => {
    assert.equal(normalizePhone('010 1234 5678'), '201012345678');
  });

  it('keeps international numbers', () => {
    assert.equal(normalizePhone('+966 50 123 4567'), '966501234567');
    assert.equal(normalizePhone('00971501234567'), '971501234567');
  });

  it('converts Arabic-Indic digits', () => {
    assert.equal(normalizePhone('٠١٠١٢٣٤٥٦٧٨'), '201012345678');
  });

  it('rejects junk', () => {
    assert.equal(normalizePhone('abc'), null);
    assert.equal(normalizePhone('123'), null);
  });
});

describe('messages', () => {
  it('builds a direct WhatsApp link when a phone exists', () => {
    const url = whatsappUrl('01012345678', 'hi there');
    assert.equal(url, 'https://wa.me/201012345678?text=hi%20there');
  });

  it('falls back to the share picker without a phone', () => {
    assert.equal(whatsappUrl(undefined, 'x'), 'https://wa.me/?text=x');
  });

  it('writes a reminder with name, amount and date', () => {
    const text = reminderMessage(circle, circle.members[0], 0, '2026-10-01');
    assert.match(text, /سارة/);
    assert.match(text, /جمعية العيلة/);
    assert.match(text, /الأول/);
    assert.match(text, /أكتوبر/);
  });

  it('lists unpaid members in the group summary', () => {
    const text = groupSummaryMessage(circle, 0, '2026-10-01', circle.members[0], [circle.members[1]]);
    assert.match(text, /محمود/);
    const done = groupSummaryMessage(circle, 0, '2026-10-01', circle.members[0], []);
    assert.match(done, /الكل دفع/);
  });

  it('formats dates and ordinals in Arabic', () => {
    assert.match(formatDate('2026-10-15'), /أكتوبر/);
    assert.equal(ordinalTurn(2), 'الثالث');
    assert.match(ordinalTurn(14), /رقم/);
  });
});
