import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { passwordProof, sha256 } from '../src/core/hash.ts';

describe('sha256', () => {
  it('matches the standard implementation', () => {
    for (const s of ['', 'abc', 'dory:v1:c1:201012345678:سر123', 'x'.repeat(1000)]) {
      assert.equal(sha256(s), createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });

  it('salts passwords per circle and number', () => {
    assert.notEqual(passwordProof('c1', '2010', 'pass12'), passwordProof('c2', '2010', 'pass12'));
    assert.equal(passwordProof('c1', '2010', 'pass12'), passwordProof('c1', '2010', 'pass12'));
  });
});
