import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { cleanRecoveryCode, isRecoveryCode, makeRecoveryCode, openPassword, recoveryLogin, sealPassword } from '../src/core/vault.ts';

test('recovery code shape', () => {
  const c = makeRecoveryCode((n) => new Uint8Array(randomBytes(n)));
  assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(isRecoveryCode(c.toLowerCase().replace(/-/g, ' ')));
  assert.equal(isRecoveryCode('ABCD-EFGH-IJK1'), false);
});

test('seal / open password', () => {
  const box = sealPassword('سر123abc!', 'ABCD-EFGH-JKMN', 'salt1');
  assert.equal(openPassword(box, 'abcd efgh jkmn', 'salt1'), 'سر123abc!');
  assert.equal(openPassword(box, 'ABCD-EFGH-JKMP', 'salt1'), null);
  assert.equal(openPassword(box, 'ABCD-EFGH-JKMN', 'salt2'), null);
});

test('hidden login depends on number and code', () => {
  const a = recoveryLogin('201099952333', 'ABCD-EFGH-JKMN');
  assert.deepEqual(a, recoveryLogin('201099952333', 'abcdefghjkmn'));
  assert.notEqual(a.email, recoveryLogin('201099952334', 'ABCD-EFGH-JKMN').email);
  assert.ok(a.email.endsWith('@phone.dory.app') && a.email.startsWith('r'));
  assert.equal(cleanRecoveryCode('ab-٣'), 'AB3');
});
