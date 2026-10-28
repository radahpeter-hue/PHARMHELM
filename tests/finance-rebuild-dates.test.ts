import test from 'node:test';
import assert from 'node:assert/strict';
import { financeDateKey, inFinanceDateRange, lastSevenFinanceDays } from '../src/utils/financeDateFilters';

test('date ranges include both boundaries and exclude records outside the selected dates', () => {
  const range = { start: '2026-09-01', end: '2026-09-30' };
  const history = ['2026-08-31', '2026-09-01', '2026-09-30T23:59:59Z', '2026-10-01'];
  assert.deepEqual(history.filter(d => inFinanceDateRange(d, range)), history.slice(1, 3));
  assert.equal(history.length, 4);
  assert.equal(inFinanceDateRange('2026-10-01', { start: '', end: '' }), true);
  assert.equal(inFinanceDateRange('2026-09-10', { start: '2026-10-01', end: '2026-09-01' }), false);
});

test('single-ended filters and Timestamp/Date records work without losing all-history fallback', () => {
  const value = new Date('2026-09-30T22:00:00Z');
  assert.equal(financeDateKey({ toDate: () => value }), '2026-10-01');
  assert.equal(inFinanceDateRange(value, { start: '2026-10-01', end: '' }), true);
  assert.equal(inFinanceDateRange('2026-09-01', { start: '', end: '2026-09-30' }), true);
  assert.equal(inFinanceDateRange(null, { start: '', end: '' }), true);
  assert.equal(inFinanceDateRange(null, { start: '2026-09-01', end: '' }), false);
});

test('changing requisition dates retrieves older history without truncating the source', () => {
  const history = [{ requisition_date: '2026-09-10' }, { requisition_date: '2026-10-28' }];
  assert.equal(history.filter(r => inFinanceDateRange(r.requisition_date, { start: '2026-10-01', end: '2026-10-31' })).length, 1);
  assert.equal(history.filter(r => inFinanceDateRange(r.requisition_date, { start: '2026-09-01', end: '2026-09-30' }))[0], history[0]);
  assert.equal(history.length, 2);
});

test('last seven days includes today and six prior calendar dates, across year and Kampala midnight', () => {
  assert.deepEqual(lastSevenFinanceDays(new Date('2026-10-28T10:00:00Z')), { start: '2026-10-22', end: '2026-10-28' });
  assert.deepEqual(lastSevenFinanceDays(new Date('2025-12-31T22:00:00Z')), { start: '2025-12-26', end: '2026-01-01' });
  const range = lastSevenFinanceDays(new Date('2026-10-28T10:00:00Z'));
  assert.equal(inFinanceDateRange('2026-10-21', range), false);
  assert.equal(inFinanceDateRange('2026-10-22', range), true);
  assert.equal(inFinanceDateRange('2026-10-28', range), true);
});
