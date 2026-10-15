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

import { canEditPayoutRequest, validatePayoutRequest } from '../src/core/payments.ts';

describe('payout requests', () => {
  it('needs no account for cash', () => {
    assert.equal(validatePayoutRequest('cash', undefined), null);
  });

  it('validates Vodafone Cash numbers', () => {
    assert.equal(validatePayoutRequest('vodafone_cash', '010 1234 5678'), null);
    assert.equal(validatePayoutRequest('vodafone_cash', '٠١٠١٢٣٤٥٦٧٨'), null);
    assert.equal(validatePayoutRequest('vodafone_cash', ''), 'account-missing');
    assert.equal(validatePayoutRequest('vodafone_cash', '12345'), 'account-invalid');
  });

  it('accepts InstaPay addresses or mobiles', () => {
    assert.equal(validatePayoutRequest('instapay', 'shady@instapay'), null);
    assert.equal(validatePayoutRequest('instapay', '01012345678'), null);
    assert.equal(validatePayoutRequest('instapay', '@@'), 'account-invalid');
  });

  it('lets the recipient edit only before approval', () => {
    assert.equal(canEditPayoutRequest(undefined), true);
    assert.equal(canEditPayoutRequest({ status: 'requested' }), true);
    assert.equal(canEditPayoutRequest({ status: 'rejected' }), true);
    assert.equal(canEditPayoutRequest({ status: 'approved' }), false);
    assert.equal(canEditPayoutRequest({ status: 'paid' }), false);
  });
});

import { awaitingRecipientConfirmation, payoutHandedOver } from '../src/core/payments.ts';

describe('payout receipt confirmation', () => {
  it('waits for the recipient only after the admin paid', () => {
    assert.equal(awaitingRecipientConfirmation({ status: 'approved' }), false);
    assert.equal(awaitingRecipientConfirmation({ status: 'paid' }), true);
    assert.equal(awaitingRecipientConfirmation({ status: 'received' }), false);
  });

  it('counts paid, received and disputed as handed over', () => {
    assert.equal(payoutHandedOver({ status: 'paid' }), true);
    assert.equal(payoutHandedOver({ status: 'received' }), true);
    assert.equal(payoutHandedOver({ status: 'disputed' }), true);
    assert.equal(payoutHandedOver({ status: 'requested' }), false);
    assert.equal(payoutHandedOver(undefined), false);
  });
});
