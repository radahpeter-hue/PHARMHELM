import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POS_V2_REVISION_WINDOW_HOURS,
  assertRevisionReason,
  evaluatePosV2RevisionEligibility,
  getPosV2RevisionDeadline,
  isPosV2Sale,
  revisionMonetaryDelta
} from '../src/services/pos-v2/posSaleRevisionV2Policy';

const baseSale = {
  engineVersion: 2,
  status: 'completed' as const,
  timestamp: '2026-09-30T10:00:00.000Z'
};

test('revision window is exactly 72 hours', () => {
  assert.equal(POS_V2_REVISION_WINDOW_HOURS, 72);
  assert.equal(getPosV2RevisionDeadline(baseSale.timestamp)?.toISOString(), '2026-10-03T10:00:00.000Z');
});

test('completed V2 sale is eligible at the exact 72-hour boundary', () => {
  const result = evaluatePosV2RevisionEligibility(baseSale, new Date('2026-10-03T10:00:00.000Z'));
  assert.equal(result.allowed, true);
  assert.equal(result.code, 'ELIGIBLE');
  assert.equal(result.remainingMs, 0);
});

test('completed V2 sale is locked after 72 hours', () => {
  const result = evaluatePosV2RevisionEligibility(baseSale, new Date('2026-10-03T10:00:00.001Z'));
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'REVISION_WINDOW_EXPIRED');
});

test('legacy, voided and already revised sales fail closed', () => {
  assert.equal(evaluatePosV2RevisionEligibility({ ...baseSale, engineVersion: 1 }).code, 'NOT_POS_V2');
  assert.equal(evaluatePosV2RevisionEligibility({ ...baseSale, status: 'voided' as const }).code, 'ALREADY_VOIDED');
  assert.equal(evaluatePosV2RevisionEligibility({ ...baseSale, supersededBySaleId: 'replacement-1' }).code, 'ALREADY_REVISED');
  assert.equal(evaluatePosV2RevisionEligibility({ ...baseSale, revisionId: 'revision-1' }).code, 'ALREADY_REVISED');
});

test('invalid timestamps fail closed', () => {
  const result = evaluatePosV2RevisionEligibility({ ...baseSale, timestamp: 'not-a-date' });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'INVALID_TIMESTAMP');
});

test('canonical V2 detector recognizes only engineVersion 2', () => {
  assert.equal(isPosV2Sale({ engineVersion: 2 }), true);
  assert.equal(isPosV2Sale({ engineVersion: 1 }), false);
  assert.equal(isPosV2Sale({}), false);
});

test('revision reason is mandatory, normalized and bounded', () => {
  assert.equal(assertRevisionReason('  Wrong   quantity entered  '), 'Wrong quantity entered');
  assert.throws(() => assertRevisionReason('short'), /at least 8 characters/);
  assert.throws(() => assertRevisionReason('x'.repeat(501)), /must not exceed 500/);
});

test('monetary delta reports increase, decrease and no-value-change', () => {
  assert.deepEqual(revisionMonetaryDelta(51000, 43000), { delta: -8000, direction: 'DECREASE' });
  assert.deepEqual(revisionMonetaryDelta(51000, 67000), { delta: 16000, direction: 'INCREASE' });
  assert.deepEqual(revisionMonetaryDelta(51000, 51000), { delta: 0, direction: 'NO_VALUE_CHANGE' });
});
