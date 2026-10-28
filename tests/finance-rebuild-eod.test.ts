import test from 'node:test';
import assert from 'node:assert/strict';
import { eodVariance, requiresEodVarianceReason } from '../src/utils/eodMoney';

test('genuine shortage and over require a reason and preserve their exact financial difference', () => {
  assert.equal(eodVariance(495000, 500000), -5000);
  assert.equal(eodVariance(505000, 500000), 5000);
  for (const declared of [495000, 505000]) {
    assert.equal(requiresEodVarianceReason([{ declared, expected: 500000 }]), true);
  }
});

test('offsetting channel discrepancies still require explanation even when the grand total balances', () => {
  assert.equal(requiresEodVarianceReason([{ declared: 495000, expected: 500000 }, { declared: 5000, expected: 0 }]), true);
});

test('normalisation removes representation round-off without hiding a real cent or shilling', () => {
  assert.equal(eodVariance(0.3, 0.1 + 0.2), 0);
  assert.notEqual(eodVariance(500000.01, 500000), 0);
  assert.equal(eodVariance(500001, 500000), 1);
  assert.notEqual(eodVariance(500000.000001, 500000), 0);
  assert.throws(() => eodVariance(NaN, 0));
});
