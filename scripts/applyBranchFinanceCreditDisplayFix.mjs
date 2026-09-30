import fs from 'node:fs';

const financePath = 'src/pages/Finance.tsx';
let source = fs.readFileSync(financePath, 'utf8');

function replaceOnce(oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  }
  source = source.replace(oldText, newText);
}

replaceOnce(
`  // 3. Credit Raised Today
  const creditSalesToday = todaySales.filter(s => s.paymentMethod === 'Credit' || s.paymentMethod === 'Insurance');
  const creditRaisedToday = creditSalesToday.reduce((sum, s) => sum + (s.total || s.totalAmount || 0), 0);`,
`  // 3. Credit Raised Today
  // POS V2 retains the internal \`institutional_credit\` token for durable
  // receivables compatibility even though the UI presents it simply as Credit.
  // Include legacy \`credit\` and split-payment credit components as well.
  const creditAmountForSale = (s: any) => {
    const primaryIsCredit = s.paymentMethod === 'institutional_credit' || s.paymentMethod === 'credit';
    if (primaryIsCredit) return s.totalAmount ?? s.total ?? 0;

    const secondaryIsCredit = s.secondaryPaymentMethod === 'institutional_credit' || s.secondaryPaymentMethod === 'credit';
    if (secondaryIsCredit) return s.secondaryAmount ?? 0;

    return 0;
  };
  const creditSalesToday = todaySales.filter(s => creditAmountForSale(s) > 0);
  const creditRaisedToday = creditSalesToday.reduce((sum, s) => sum + creditAmountForSale(s), 0);`,
'credit summary'
);

replaceOnce(
`        const filtered = data.filter(s => 
          s.branchId === activeBranchId && 
          (s.paymentMethod === 'insurance' || s.paymentMethod === 'institutional_credit')
        );`,
`        const filtered = data.filter(s => {
          const primaryMethod = s.paymentMethod;
          const secondaryMethod = s.secondaryPaymentMethod;
          const isCreditOrInsurance =
            primaryMethod === 'insurance' ||
            primaryMethod === 'institutional_credit' ||
            primaryMethod === 'credit' ||
            secondaryMethod === 'insurance' ||
            secondaryMethod === 'institutional_credit' ||
            secondaryMethod === 'credit';

          return s.branchId === activeBranchId && isCreditOrInsurance;
        });`,
'branch credit filter'
);

replaceOnce(
`              const invNum = credit.invoiceNumber || credit.invoice_number || \`INV-\${credit.id?.slice(-6)}\`;
              const cName = credit.patientName || credit.clientName || 'Walk-in Client';`,
`              // The POS receipt number is the canonical sale-facing invoice/receipt identifier.
              const invNum = credit.receiptNumber || credit.invoiceNumber || credit.invoice_number || \`INV-\${credit.id?.slice(-6)}\`;
              // Credit cannot be anonymous. Prefer the attached institution for institutional
              // accounts, otherwise show the attached patient/client identity.
              const cName = credit.institutionName || credit.patientName || credit.clientName || 'Unidentified credit account';`,
'branch credit identity and invoice'
);

fs.writeFileSync(financePath, source);

const testPath = 'tests/finance-branch-credit-display.test.ts';
const testSource = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/pages/Finance.tsx', 'utf8');

test('Branch Credit View prioritizes canonical POS receipt number', () => {
  assert.match(
    source,
    /const invNum = credit\\.receiptNumber \\|\\| credit\\.invoiceNumber \\|\\| credit\\.invoice_number/
  );
});

test('Branch Credit View shows institution or patient identity instead of walk-in fallback', () => {
  assert.match(
    source,
    /const cName = credit\\.institutionName \\|\\| credit\\.patientName \\|\\| credit\\.clientName \\|\\| 'Unidentified credit account'/
  );
  assert.doesNotMatch(source, /const cName = credit\\.patientName \\|\\| credit\\.clientName \\|\\| 'Walk-in Client'/);
});

test('Branch Credit View recognizes current and legacy credit tokens', () => {
  assert.match(source, /primaryMethod === 'institutional_credit'/);
  assert.match(source, /primaryMethod === 'credit'/);
  assert.match(source, /secondaryMethod === 'institutional_credit'/);
  assert.match(source, /secondaryMethod === 'credit'/);
});

test('Credit Raised summary counts POS V2 credit values', () => {
  assert.match(source, /s\\.paymentMethod === 'institutional_credit' \\|\\| s\\.paymentMethod === 'credit'/);
  assert.match(source, /s\\.secondaryPaymentMethod === 'institutional_credit' \\|\\| s\\.secondaryPaymentMethod === 'credit'/);
  assert.match(source, /creditRaisedToday = creditSalesToday\\.reduce\\(\\(sum, s\\) => sum \\+ creditAmountForSale\\(s\\), 0\\)/);
});
`;
fs.writeFileSync(testPath, testSource);

console.log('Applied Branch Finance credit display patch and regression test.');
