import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isActiveSale } from '../src/utils/activeSales';

test('corrected receipt replaces original revenue, units and order count in reporting', () => {
 const original = { id: 'original', total: 1500, quantity: 30, revisionLifecycle: 'COMPLETED', supersededBySaleId: 'corrected' };
 const corrected = { id: 'corrected', total: 2250, quantity: 45, revisionLifecycle: 'COMPLETED',
 isRevisionReplacement: true, revisionOfSaleId: 'original' };
 const reversed = { id: 'returned', total: 100, quantity: 2, status: 'returned' };
 const active = [original, corrected, reversed].filter(isActiveSale);
 assert.equal(active.reduce((sum, row) => sum + row.total, 0), 2250);
 assert.equal(active.reduce((sum, row) => sum + row.quantity, 0), 45);
 assert.equal(active.length, 1);
});

test('every sales-fed analytics screen excludes superseded receipts before aggregation', () => {
 for (const name of ['POSAnalytics', 'FinanceAnalytics', 'InventoryAnalytics', 'CRMAnalytics',
 'HRAnalytics', 'LogisticsAnalytics', 'PredictivePanel', 'ReportHub']) {
   const source = readFileSync(new URL('../src/components/analytics/' + name + '.tsx', import.meta.url), 'utf8');
   assert.match(source, /data\.filter\(isActiveSale\)/, name);
   assert.doesNotMatch(source, /setSales\(data\);/, name);
 }
});
