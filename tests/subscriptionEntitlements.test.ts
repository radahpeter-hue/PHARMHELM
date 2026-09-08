import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultBranchLimit,
  resolveBranchLimit,
  isValidBranchLimit,
  isTrialExpired,
  isComplimentaryPeriodActive,
  SUBSCRIPTION_TIERS_GATE_FEATURES
} from '../src/utils/subscriptionEntitlements';

test('tier defaults only seed branch limits', () => {
  assert.equal(getDefaultBranchLimit('basic'), 1);
  assert.equal(getDefaultBranchLimit('standard'), 5);
  assert.equal(getDefaultBranchLimit('enterprise'), 15);
  assert.equal(SUBSCRIPTION_TIERS_GATE_FEATURES, false);
});

test('manual branch limit overrides tier default', () => {
  assert.equal(resolveBranchLimit(27, 'basic'), 27);
  assert.equal(resolveBranchLimit(undefined, 'standard'), 5);
  assert.equal(resolveBranchLimit(undefined, 'enterprise'), 15);
});

test('branch limit validation requires a non-negative whole number', () => {
  assert.equal(isValidBranchLimit(0), true);
  assert.equal(isValidBranchLimit(1), true);
  assert.equal(isValidBranchLimit(15), true);
  assert.equal(isValidBranchLimit(-1), false);
  assert.equal(isValidBranchLimit(1.5), false);
  assert.equal(isValidBranchLimit(Number.NaN), false);
});

test('trial expiry supports legacy strings and Firestore timestamp-like values', () => {
  const now = new Date('2026-09-08T12:00:00Z');
  assert.equal(isTrialExpired({ isTrial: true, trialEndDate: '2026-09-07T23:59:59Z' }, now), true);
  assert.equal(isTrialExpired({ isTrial: true, trialEndDate: '2026-09-09T23:59:59Z' }, now), false);
  assert.equal(isTrialExpired({ isTrial: false, trialEndDate: '2026-09-07T23:59:59Z' }, now), false);
  assert.equal(isTrialExpired({ isTrial: true, trialEndDate: { toDate: () => new Date('2026-09-07T23:59:59Z') } }, now), true);
});

test('complimentary period is active only inside its granted window', () => {
  const now = new Date('2026-09-08T12:00:00Z');
  assert.equal(isComplimentaryPeriodActive({
    isActive: true,
    startDate: { toDate: () => new Date('2026-09-01T00:00:00Z') },
    endDate: { toDate: () => new Date('2026-09-30T23:59:59Z') }
  }, now), true);
  assert.equal(isComplimentaryPeriodActive({
    isActive: false,
    startDate: '2026-09-01T00:00:00Z',
    endDate: '2026-09-30T23:59:59Z'
  }, now), false);
  assert.equal(isComplimentaryPeriodActive({
    isActive: true,
    startDate: '2026-10-01T00:00:00Z',
    endDate: '2026-10-31T23:59:59Z'
  }, now), false);
});
