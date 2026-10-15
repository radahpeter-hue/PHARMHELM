import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultUsageDateRange, filterOperationalUsageByDate, operationalUsageCSV, operationalUsageReportRows, validUsageDateRange } from '../src/utils/operationalUsageReport';

test('default usage period includes today plus six prior calendar days', () => {
  assert.deepEqual(defaultUsageDateRange(new Date(2026, 9, 15, 11, 10)), { start: '2026-10-09', end: '2026-10-15' });
  assert.deepEqual(defaultUsageDateRange(new Date(2026, 0, 2)), { start: '2025-12-27', end: '2026-01-02' });
});

test('selected usage period includes both boundary dates and excludes invalid timestamps', () => {
  const logs = [
    { timestamp: '2026-10-08T23:59:59' },
    { timestamp: '2026-10-09T00:00:00' },
    { timestamp: '2026-10-12T11:00:00' },
    { timestamp: '2026-10-15T23:59:59' },
    { timestamp: '2026-10-16T00:00:00' },
    { timestamp: 'invalid' }
  ] as any;
  const result = filterOperationalUsageByDate(logs, { start: '2026-10-09', end: '2026-10-15' });
  assert.equal(result.length, 3);
  assert.equal(result[0].timestamp, '2026-10-15T23:59:59');
  assert.equal(validUsageDateRange({ start: '2026-10-16', end: '2026-10-15' }), false);
});

test('CSV contains headers, escaped item fields, and neutralizes formula injection', () => {
  const logs = [{ timestamp:'2026-10-15T09:00:00', inventoryId:'item1', itemName:'Pens, blue', department:'Office', recipient:'', purpose:'=HYPERLINK("bad")', reference:'OPU-1', issuedAmount:3, unitOfIssue:'pcs', cost:600, staffName:'A' }] as any;
  const rows = operationalUsageReportRows(logs, {});
  const csv = operationalUsageCSV(rows);
  assert.match(csv, /"Pens, blue"/);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"Quantity Issued"/);
  assert.match(csv, /"600"/);
});
