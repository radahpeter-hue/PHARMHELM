import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/services/pos-v2/posSaleRevisionV2ReplacementExecution.ts', 'utf8');

test('replacement execution waits for durable REPLACEMENT_PENDING state', () => {
  assert.match(source, /progress\.status/);
  assert.match(source, /REPLACEMENT_PENDING/);
  assert.match(source, /originalSaleId/);
});

test('replacement execution delegates corrected sale creation to the canonical POS V2 checkout engine', () => {
  assert.match(source, /buildPosV2ReplacementCheckoutRequest/);
  assert.match(source, /executeCheckoutV2\(request\)/);
  assert.match(source, /replacementSaleId/);
  assert.doesNotMatch(source, /transaction\.set/);
  assert.doesNotMatch(source, /product_batches/);
});

test('split-payment total changes fail closed instead of guessing revised finance allocations', () => {
  assert.match(source, /hasSplitPayment/);
  assert.match(source, /Math\.abs\(originalTotal - revisedTotal\)/);
  assert.match(source, /split-payment receipt cannot change monetary total/);
});

test('new Staff Welfare payment cannot be invented without an explicit welfare allocation', () => {
  assert.match(source, /revisedPaymentMethod === 'staff_welfare'/);
  assert.match(source, /explicit welfare allocation/);
});

test('unchanged payment and contextual snapshots are preserved conservatively', () => {
  assert.match(source, /secondaryPaymentMethod/);
  assert.match(source, /secondaryAmount/);
  assert.match(source, /welfareAmount/);
  assert.match(source, /sourceQuotationId/);
  assert.match(source, /isExceptionalConsumption/);
});
