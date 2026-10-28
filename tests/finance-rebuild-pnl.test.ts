import test from 'node:test';
import assert from 'node:assert/strict';
import { profitabilityPeriodRange } from '../src/utils/profitabilityPeriod';

test('P&L calendar presets map to explicit inclusive dates without changing accounting', () => {
  const anchor = '2026-10-28';
  assert.deepEqual(profitabilityPeriodRange('today', anchor), { start: anchor, end: anchor });
  assert.deepEqual(profitabilityPeriodRange('week', anchor), { start: '2026-10-26', end: '2026-11-01' });
  assert.deepEqual(profitabilityPeriodRange('month', anchor), { start: '2026-10-01', end: anchor });
  assert.deepEqual(profitabilityPeriodRange('monthly', anchor), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(profitabilityPeriodRange('biannual', anchor), { start: '2026-07-01', end: '2026-12-31' });
  assert.deepEqual(profitabilityPeriodRange('annual', anchor), { start: '2026-01-01', end: '2026-12-31' });
});

test('P&L periods handle leap years, half-year and week/year boundaries', () => {
  assert.deepEqual(profitabilityPeriodRange('monthly', '2024-02-12'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(profitabilityPeriodRange('biannual', '2026-06-30'), { start: '2026-01-01', end: '2026-06-30' });
  assert.deepEqual(profitabilityPeriodRange('week', '2026-01-01'), { start: '2025-12-29', end: '2026-01-04' });
});
