import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { omitUndefinedDeep } from '../src/utils/firestoreData';
import { formatDateValue, normalizeDateValue } from '../src/utils/dateValue';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

test('normalizes Firestore Timestamp-like values and rejects invalid dates', () => {
  const fromToDate = normalizeDateValue({ toDate: () => new Date('2027-01-31T00:00:00.000Z') });
  assert.equal(fromToDate?.toISOString(), '2027-01-31T00:00:00.000Z');
  assert.equal(normalizeDateValue({ seconds: 1_800_000_000 })?.getTime(), 1_800_000_000_000);
  assert.equal(normalizeDateValue('not-a-date'), null);
  assert.equal(formatDateValue('not-a-date', 'MMM dd, yyyy'), 'Invalid date');
});

test('removes undefined deeply while preserving null, Date and class instances', () => {
  class Sentinel { constructor(public value: number) {} }
  const date = new Date('2026-09-29T00:00:00.000Z');
  const sentinel = new Sentinel(7);
  const result = omitUndefinedDeep({ keep: null, remove: undefined, nested: { remove: undefined, keep: 1 }, array: [1, undefined, { remove: undefined, keep: 2 }], date, sentinel });
  assert.deepEqual(result, { keep: null, nested: { keep: 1 }, array: [1, { keep: 2 }], date, sentinel });
  assert.equal(result.date, date);
  assert.equal(result.sentinel, sentinel);
});

test('uses the authoritative active branch in the POS card', () => {
  const sales = read('src/pages/Sales.tsx');
  assert.ok(sales.includes("activeBranch?.name || 'No branch selected'"));
  assert.ok(!sales.includes("profile?.branch || 'Main Branch'"));
});

test('separates inventory view access from operational controls', () => {
  const inventory = read('src/pages/Inventory.tsx');
  const stockcard = read('src/components/inventory/ProductStockcard.tsx');
  assert.ok(inventory.includes("const canOperateInventory = hasPermission('inventory', 'operate')"));
  assert.ok(inventory.includes('{canOperateInventory && ('));
  assert.ok(stockcard.includes("const canOperateInventory = hasPermission('inventory', 'operate')"));
  assert.ok(stockcard.includes('canOperateInventory && adjustingBatch'));
  assert.ok(!stockcard.includes('format(new Date('));
});

test('sanitizes POS V2 writes and normalizes batch expiry values', () => {
  const repo = read('src/services/pos-v2/posCheckoutV2Repository.ts');
  assert.ok(repo.includes('omitUndefinedDeep({'));
  assert.ok(repo.includes('omitUndefinedDeep({ ...attempt, ...revisionLinkage })'));
  assert.ok(repo.includes('normalizeDateValue(batch.expiryDate)?.toISOString() ?? null'));
});
