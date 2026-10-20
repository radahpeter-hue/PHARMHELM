import test from 'node:test';
import assert from 'node:assert/strict';
import { filterStockInRows, type StockInRegisterRow } from '../src/components/stock/StockInRegister';

const base: StockInRegisterRow = { id: 'a', number: 'OT-TEST', source: 'HQ Operational Store', destination: 'Masaka', sender: 'Dispatch staff', receiver: 'Receipt staff', sentAt: '2026-10-18T12:00:00', receivedAt: '2026-10-20T23:59:59', value: 100, status: 'received', onOpen() {} };
test('history uses receipt date and includes the entire end date', () => {
  assert.equal(filterStockInRows([base], true, '', '2026-10-20', '2026-10-20').length, 1);
  assert.equal(filterStockInRows([base], true, '', '', '2026-10-19').length, 0);
  assert.equal(filterStockInRows([base], false, '', '2026-10-20', '').length, 0);
});
test('search combines with dates, clearing filters restores undated history', () => {
  const rows = [base, { ...base, id: 'b', receivedAt: undefined }];
  assert.equal(filterStockInRows(rows, true, ' MASAKA ', '2026-10-20', '').length, 1);
  assert.equal(filterStockInRows(rows, true, 'unknown', '', '').length, 0);
  assert.equal(filterStockInRows(rows, true, '', '', '').length, 2);
  assert.equal(filterStockInRows([{...base, receivedAt: 'invalid'}], true, '', '2026-10-20', '').length, 0);
});
test('invalid reversed range produces no misleading rows', () => {
  assert.equal(filterStockInRows([base], true, '', '2026-10-21', '2026-10-19').length, 0);
});
