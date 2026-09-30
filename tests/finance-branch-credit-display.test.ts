import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/pages/Finance.tsx', 'utf8');

test('Branch Credit View prioritizes canonical POS receipt number', () => {
  assert.match(
    source,
    /const invNum = credit\.receiptNumber \|\| credit\.invoiceNumber \|\| credit\.invoice_number/
  );
});

test('Branch Credit View shows institution or patient identity instead of walk-in fallback', () => {
  assert.match(
    source,
    /const cName = credit\.institutionName \|\| credit\.patientName \|\| credit\.clientName \|\| 'Unidentified credit account'/
  );
  assert.doesNotMatch(source, /const cName = credit\.patientName \|\| credit\.clientName \|\| 'Walk-in Client'/);
});

test('Branch Credit View recognizes current and legacy credit tokens', () => {
  assert.match(source, /primaryMethod === 'institutional_credit'/);
  assert.match(source, /primaryMethod === 'credit'/);
  assert.match(source, /secondaryMethod === 'institutional_credit'/);
  assert.match(source, /secondaryMethod === 'credit'/);
});

test('Credit Raised summary counts POS V2 credit values', () => {
  assert.match(source, /s\.paymentMethod === 'institutional_credit' \|\| s\.paymentMethod === 'credit'/);
  assert.match(source, /s\.secondaryPaymentMethod === 'institutional_credit' \|\| s\.secondaryPaymentMethod === 'credit'/);
  assert.match(source, /creditRaisedToday = creditSalesToday\.reduce\(\(sum, s\) => sum \+ creditAmountForSale\(s\), 0\)/);
});
