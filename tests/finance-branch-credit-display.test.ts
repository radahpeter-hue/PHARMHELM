import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/pages/Finance.tsx', 'utf8');

test('Credit Raised summary counts POS V2 credit values', () => {
  assert.match(source, /s\.paymentMethod === 'institutional_credit' \|\| s\.paymentMethod === 'credit'/);
  assert.match(source, /s\.secondaryPaymentMethod === 'institutional_credit' \|\| s\.secondaryPaymentMethod === 'credit'/);
  assert.match(source, /creditRaisedToday = creditSalesToday\.reduce\(\(sum, s\) => sum \+ creditAmountForSale\(s\), 0\)/);
});
