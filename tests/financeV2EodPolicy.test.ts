import test from 'node:test';
import assert from 'node:assert/strict';
import { assignSaleToEodShift, eodBusinessDateNow, eodCanonicalId, eodVariance, validateEodAmounts } from '../src/services/financeV2EodPolicy';

const shifts = [
  { id: 'dayShift', enabled: true, startTime: '07:30', endTime: '17:00' },
  { id: 'eveningShift', enabled: true, startTime: '17:00', endTime: '22:00' },
  { id: 'nightShift', enabled: true, startTime: '22:00', endTime: '07:30' }
];

test('exact EOD match is true zero and needs no explanation', () => {
  assert.equal(Object.is(eodVariance(38000, 38000), -0), false);
  assert.deepEqual(validateEodAmounts({ cash: 38000 }, { cash: 38000 }, ''), { variances: { cash: 0 }, totalVariance: 0 });
});

test('genuine shortage or surplus requires an explanation', () => {
  assert.throws(() => validateEodAmounts({ cash: 100 }, { cash: 99 }, ''), /reason/);
  assert.throws(() => validateEodAmounts({ cash: 100 }, { cash: 101 }, '  '), /reason/);
  assert.equal(validateEodAmounts({ cash: 100 }, { cash: 99 }, 'cash shortage').totalVariance, -1);
  assert.equal(validateEodAmounts({ cash: 100 }, { cash: 101 }, 'cash surplus').totalVariance, 1);
});

test('offsetting variances still demand reason', () => {
  assert.throws(() => validateEodAmounts({ cash: 100, card: 100 }, { cash: 90, card: 110 }, ''), /reason/);
});

test('invalid or fractional UGX is rejected', () => {
  assert.throws(() => eodVariance(1.5, 1), /integer/);
  assert.throws(() => eodVariance(-1, 1), /integer/);
});

test('EOD rejects malformed expected or declared method values instead of defaulting to zero', () => {
  assert.throws(() => validateEodAmounts({ cash: Number.NaN }, { cash: 0 }, 'invalid source'), /safe integer/);
  assert.throws(() => validateEodAmounts({ cash: 0 }, { cash: Number.POSITIVE_INFINITY }, 'invalid declaration'), /safe integer/);
  assert.throws(() => validateEodAmounts({ cash: 0 }, { cash: 1.5 }, 'fractional declaration'), /safe integer/);
  assert.throws(() => validateEodAmounts({ cash: 0 }, { cash: -1 }, 'negative declaration'), /safe integer/);
  assert.deepEqual(validateEodAmounts({ cash: 0 }, { cash: 0 }, ''), { variances: { cash: 0 }, totalVariance: 0 });
});

test('overnight shift is attributed to start date using branch timezone', () => {
  assert.deepEqual(assignSaleToEodShift('2026-10-20T02:00:00Z', shifts), { businessDate: '2026-10-19', shiftId: 'nightShift' });
  assert.deepEqual(assignSaleToEodShift('2026-10-19T19:00:00Z', shifts), { businessDate: '2026-10-19', shiftId: 'nightShift' });
  assert.deepEqual(assignSaleToEodShift('2026-10-20T04:30:00Z', shifts), { businessDate: '2026-10-20', shiftId: 'dayShift' });
});

test('configured gaps and overlaps are not guessed', () => {
  assert.equal(assignSaleToEodShift('2026-10-20T08:00:00Z', [{ id: 'night', enabled: true, startTime: '22:00', endTime: '07:00' }]), null);
  assert.throws(() => assignSaleToEodShift('2026-10-20T08:00:00Z', [
    { id: 'a', enabled: true, startTime: '09:00', endTime: '12:00' },
    { id: 'b', enabled: true, startTime: '10:00', endTime: '13:00' }
  ]), /Overlapping/);
});

test('canonical identities are stable and unambiguous', () => {
  const id = eodCanonicalId('tenant', 'branch', '2026-10-20', 'nightShift');
  assert.equal(id, eodCanonicalId('tenant', 'branch', '2026-10-20', 'nightShift'));
  assert.notEqual(id, eodCanonicalId('tenant', 'branch', '2026-10-21', 'nightShift'));
  assert.notEqual(eodCanonicalId('a_b', 'c', '2026-10-20', 'day'), eodCanonicalId('a', 'b_c', '2026-10-20', 'day'));
});

test('EOD default business date follows Uganda local date rather than UTC', () => {
  assert.equal(eodBusinessDateNow('Africa/Kampala', new Date('2026-10-20T22:30:00Z')), '2026-10-21');
  assert.equal(eodBusinessDateNow('Africa/Kampala', new Date('2026-10-21T20:30:00Z')), '2026-10-21');
  assert.throws(() => eodBusinessDateNow('Africa/Kampala', new Date(Number.NaN)), /Invalid current timestamp/);
});
