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

test('Branch Finance and CRM use the shared scoped register', () => {
  const crm = fs.readFileSync('src/pages/Clients.tsx', 'utf8');
  assert.match(source, /<CreditReceivablesRegister branchId=\{activeBranchId\}/);
  assert.match(crm, /<CreditReceivablesRegister branchId=\{activeBranchId\}/);
});
