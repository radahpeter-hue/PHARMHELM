import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('receipt reprint preview and plain-text sharing use canonical seller resolver', () => {
  const source = readFileSync('src/pages/Sales.tsx', 'utf8');
  const directUidFallback = "staff.find(s => s.uid === selectedSale.servedBy)?.displayName || staff.find(s => s.id === selectedSale.servedBy)?.displayName || selectedSale.servedBy || 'Operator'";
  assert.equal(source.includes(directUidFallback), false);
  const occurrences = source.match(/resolveSaleOperatorName\(selectedSale, staff\)/g) || [];
  assert.ok(occurrences.length >= 3, 'expected canonical resolver in preview, thermal print, and sharing path');
});
