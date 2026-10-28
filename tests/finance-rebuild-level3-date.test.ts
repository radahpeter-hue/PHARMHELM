import test from 'node:test';
import assert from 'node:assert/strict';
import { isBusinessDate, kampalaBusinessDate, timestampBusinessDate } from '../src/utils/eodBusinessDate';
import { canCorrectEod } from '../src/utils/eodEditPolicy';

test('023 canonical dates accept normal/previous days and reject invalid dates', () => {
  for (const date of ['2026-10-28', '2026-10-27', '2024-02-29']) assert.ok(isBusinessDate(date));
  for (const date of ['', '28/10/2026', '2026-02-29', '2026-13-01', '2026-04-31']) assert.equal(isBusinessDate(date), false);
});
test('023 Kampala midnight is independent of browser timezone and UTC day', () => {
  assert.equal(kampalaBusinessDate(new Date('2026-10-28T20:59:59Z')), '2026-10-28');
  assert.equal(kampalaBusinessDate(new Date('2026-10-28T21:00:00Z')), '2026-10-29');
  assert.equal(timestampBusinessDate('2026-10-29T00:00:00+03:00'), '2026-10-29');
  assert.equal(timestampBusinessDate('2026-10-29T00:00:00'), undefined);
});
test('023 existing historical date remains canonical without rewriting creation time', () => {
  const historic = { tenantId: 'mp', reconciliation_date: '2026-10-20', created_at: '2026-10-22T23:00:00Z' };
  const before = JSON.stringify(historic);
  assert.ok(isBusinessDate(historic.reconciliation_date));
  assert.ok(canCorrectEod({ tenantId: 'mp', role: 'IT Head' }, historic, Date.parse('2026-10-28T12:00:00Z')));
  assert.equal(JSON.stringify(historic), before);
});
