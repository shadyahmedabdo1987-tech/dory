import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { timeline } from '../src/core/schedule.ts';
import type { Circle } from '../src/core/types.ts';
import { cleanGroupLink, groupTemplates, isGroupLink, memberNumbersText } from '../src/core/whatsapp.ts';

const circle: Circle = {
  id: 'c1',
  name: 'جمعية الشغل',
  installment: 1000,
  currency: 'EGP',
  frequency: 'monthly',
  startDate: '2026-11-01',
  adminUid: 'admin',
  inviteCode: 'ABC234',
  payInfo: { instapay: 'shady@instapay' },
  members: [
    { id: 'a', name: 'أحمد', phone: '01011111111' },
    { id: 'b', name: 'منى', phone: '+20 102 222 2222' },
    { id: 'c', name: 'كريم' },
    { id: 'd', name: 'أحمد ٢', phone: '01011111111' },
  ],
  periods: [{ id: 'p0', kind: 'payout', recipientId: 'b' }],
  createdAt: '2026-10-01T00:00:00.000Z',
};

describe('whatsapp group', () => {
  it('cleans pasted invite links', () => {
    assert.equal(cleanGroupLink('انضم: chat.whatsapp.com/AbCdEf1234567890xyz '), 'https://chat.whatsapp.com/AbCdEf1234567890xyz');
    assert.equal(cleanGroupLink('https://chat.whatsapp.com/invite/AbCdEf1234567890'), 'https://chat.whatsapp.com/AbCdEf1234567890');
    assert.equal(cleanGroupLink('https://wa.me/201011111111'), null);
    assert.equal(isGroupLink('https://chat.whatsapp.com/AbCdEf1234567890'), true);
    assert.equal(isGroupLink('https://evil.com/chat.whatsapp.com/x'), false);
  });

  it('lists unique member numbers and who is missing one', () => {
    const r = memberNumbersText(circle.members);
    assert.equal(r.text, '+201011111111\n+201022222222');
    assert.equal(r.count, 2);
    assert.deepEqual(r.missing, ['كريم']);
  });

  it('builds group templates with transfer details and unpaid names', () => {
    const [entry] = timeline(circle);
    const t = groupTemplates(circle, entry, [circle.members[2]]);
    assert.deepEqual(t.map((x) => x.key), ['reminder', 'collect', 'payout', 'custom']);
    assert.match(t[0].text, /shady@instapay/);
    assert.match(t[1].text, /كريم/);
    assert.match(t[2].text, /منى/);
  });
});
