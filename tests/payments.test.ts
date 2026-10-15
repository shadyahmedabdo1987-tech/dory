import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RECEIPT_BASE64,
  METHOD_LABEL,
  methodOf,
  payTarget,
  requiresReceipt,
  validateClaim,
} from '../src/core/payments.ts';

describe('payment methods', () => {
  it('requires a receipt only for transfers', () => {
    assert.equal(requiresReceipt('cash'), false);
    assert.equal(requiresReceipt('instapay'), true);
    assert.equal(requiresReceipt('vodafone_cash'), true);
  });

  it('labels methods in Arabic', () => {
    assert.equal(METHOD_LABEL.vodafone_cash, 'فودافون كاش');
  });

  it('treats legacy payments without a method as cash', () => {
    assert.equal(methodOf({}), 'cash');
    assert.equal(methodOf(undefined), 'cash');
    assert.equal(methodOf({ method: 'instapay' }), 'instapay');
  });

  it('returns the configured transfer target', () => {
    const info = { instapay: ' shady@instapay ', vodafoneCash: '01012345678' };
    assert.equal(payTarget('instapay', info), 'shady@instapay');
    assert.equal(payTarget('vodafone_cash', info), '01012345678');
    assert.equal(payTarget('cash', info), undefined);
    assert.equal(payTarget('instapay', {}), undefined);
  });

  it('validates claims', () => {
    assert.equal(validateClaim({ method: 'cash' }), null);
    assert.equal(validateClaim({ method: 'instapay' }), 'receipt-missing');
    assert.equal(validateClaim({ method: 'vodafone_cash', receiptBase64: 'abc' }), null);
    assert.equal(
      validateClaim({ method: 'instapay', receiptBase64: 'x'.repeat(MAX_RECEIPT_BASE64 + 1) }),
      'receipt-too-large',
    );
  });
});
