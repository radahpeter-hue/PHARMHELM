import test from 'node:test';
import assert from 'node:assert/strict';
import { eodVariance, requiresEodVarianceReason, formatEodAmount, eodRecordVariance, eodAmountNumber, sumEodAmounts } from '../src/utils/eodMoney';

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

test('exact-match scenario A does not require a reason, including empty channels', () => {
  const channels = [{ declared: 500000, expected: 500000 }, ...Array.from({ length: 6 }, () => ({ declared: 0, expected: 0 }))];
  assert.equal(eodVariance(500000, 500000), 0);
  assert.equal(requiresEodVarianceReason(channels), false);
  assert.equal(requiresEodVarianceReason([{ declared: 0.3, expected: 0.1 + 0.2 }]), false);
});

import fs from 'node:fs';
test('reason prompt, submit disable and persistence guard share the same normalised decision', () => {
  const eod = fs.readFileSync('src/pages/Finance.tsx', 'utf8').split('const EODReconciliationTab:')[1].split('const VarianceRow:')[0];
  assert.match(eod, /if \(needsVarianceReason && !varianceReason.trim\(\)\)/);
  assert.match(eod, /\{needsVarianceReason && \(/);
  assert.match(eod, /disabled=\{[^\n]*needsVarianceReason && !varianceReason.trim\(\)/);
});

test('negative zero and round-off display as zero, while a genuine fractional variance stays visible', () => {
  assert.equal(formatEodAmount(-0), '0');
  const normalised = eodVariance(0.3, 0.1 + 0.2);
  assert.equal(Object.is(normalised, -0), false);
  assert.equal(formatEodAmount(normalised), '0');
  assert.equal(formatEodAmount(-0.0001), '-0.0001');
  assert.equal(eodRecordVariance({ total_actual: 0.3, total_expected: 0.1 + 0.2, total_variance: -5.55e-17 }), 0);
  assert.equal(eodRecordVariance({ total_actual: 495000, total_expected: 500000, total_variance: -5000 }), -5000);
  assert.equal(formatEodAmount(eodRecordVariance({ total_variance: -0 })), '0');
});

test('EOD summation prevents accumulated representation errors while retaining genuine fractional UGX', () => {
  assert.equal(sumEodAmounts(Array.from({ length: 10000 }, () => 0.1)), 1000);
  assert.equal(eodVariance(1000, sumEodAmounts(Array.from({ length: 10000 }, () => 0.1))), 0);
  assert.equal(sumEodAmounts([1.25, 2.5, 0.25]), 4);
  assert.equal(eodVariance('500,000.00', 500000), 0);
  assert.equal(eodAmountNumber(' 500000.50 '), 500000.5);
  assert.notEqual(eodVariance(0.3, 0.3001), 0);
  const fractionalDisplay = formatEodAmount(eodVariance(0.3, 0.3001));
  assert.notEqual(fractionalDisplay, '-0');
  assert.ok(Math.abs(Number(fractionalDisplay) + 0.0001) < 1e-16);
  assert.throws(() => eodAmountNumber('500,00'));
  assert.throws(() => sumEodAmounts([Infinity]));
});
