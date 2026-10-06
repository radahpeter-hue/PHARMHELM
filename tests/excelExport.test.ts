import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExcelSheetData, sanitizeExcelSheetName } from '../src/utils/excelExport';

test('buildExcelSheetData preserves the union and order of report columns', () => {
  const rows = buildExcelSheetData([
    { Branch: 'Masaka', Amount: 1200 },
    { Branch: 'Main', Status: 'Paid' }
  ]);

  assert.deepEqual(rows[0].map(cell => cell.value), ['Branch', 'Amount', 'Status']);
  assert.deepEqual(rows[1], ['Masaka', 1200, null]);
  assert.deepEqual(rows[2], ['Main', null, 'Paid']);
});

test('buildExcelSheetData serializes complex values and leaves text as text', () => {
  const rows = buildExcelSheetData([{
    FormulaLikeText: '=SUM(A1:A2)',
    Context: { source: 'revision-ledger' },
    Active: true
  }]);

  assert.deepEqual(rows[1], [
    '=SUM(A1:A2)',
    '{"source":"revision-ledger"}',
    true
  ]);
});

test('sanitizeExcelSheetName enforces Excel naming constraints', () => {
  assert.equal(sanitizeExcelSheetName('VAT/[Ledger]*2026'), 'VAT  Ledger  2026');
  assert.equal(sanitizeExcelSheetName(''), 'Report');
  assert.equal(sanitizeExcelSheetName('A'.repeat(40)), 'A'.repeat(31));
});
