import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing ${label}`);
  return source.replace(from, to);
}

let sales = readFileSync('src/pages/Sales.tsx', 'utf8');
sales = replaceOnce(
  sales,
  "{ id: 'institutional_credit', label: 'Inst. Credit', icon: Building2 },",
  "{ id: 'institutional_credit', label: 'Credit', icon: CreditCard },",
  'checkout credit option'
);
sales = replaceOnce(
  sales,
  "{ id: 'institutional_credit', label: 'Inst. Credit' }",
  "{ id: 'institutional_credit', label: 'Credit' }",
  'ledger edit credit option'
);
writeFileSync('src/pages/Sales.tsx', sales);

const validatorPath = 'src/utils/saleContextValidation.ts';
let validator = readFileSync(validatorPath, 'utf8');
validator = validator.replace("        | 'institutional_credit_institution_required'\n", '');
validator = validator.replace(
`  if (paymentMethod === 'institutional_credit' && !input.hasInstitution) {\n    return {\n      valid: false,\n      code: 'institutional_credit_institution_required',\n      message: 'An institution is required for institutional credit.'\n    };\n  }\n\n`,
''
);
validator = validator.replace(
"  if (paymentMethod === 'credit' && !input.hasPatient && !input.hasInstitution) {",
"  if ((paymentMethod === 'credit' || paymentMethod === 'institutional_credit') && !input.hasPatient && !input.hasInstitution) {"
);
writeFileSync(validatorPath, validator);

const testPath = 'tests/pos-phase2-context-validation.test.ts';
let tests = readFileSync(testPath, 'utf8');
tests = tests.replace(
`test('institutional credit without an institution is rejected', () => {\n  assert.deepEqual(validate({ context: 'institutional', paymentMethod: 'institutional_credit' }), {\n    valid: false,\n    code: 'institutional_credit_institution_required',\n    message: 'An institution is required for institutional credit.'\n  });\n});\n\ntest('institutional credit with an institution passes context validation', () => {\n  assert.deepEqual(validate({ context: 'institutional', paymentMethod: 'institutional_credit', hasInstitution: true }), { valid: true });\n});\n`,
`test('credit without either a patient or institution is rejected, including the legacy internal token', () => {\n  const expected = {\n    valid: false,\n    code: 'credit_identity_required',\n    message: 'An identifiable client or institution is required for a credit sale.'\n  };\n  assert.deepEqual(validate({ paymentMethod: 'credit' }), expected);\n  assert.deepEqual(validate({ paymentMethod: 'institutional_credit' }), expected);\n});\n\ntest('credit passes with either a patient/client or institution account', () => {\n  assert.deepEqual(validate({ paymentMethod: 'credit', hasPatient: true }), { valid: true });\n  assert.deepEqual(validate({ paymentMethod: 'credit', hasInstitution: true }), { valid: true });\n  assert.deepEqual(validate({ paymentMethod: 'institutional_credit', hasPatient: true }), { valid: true });\n  assert.deepEqual(validate({ paymentMethod: 'institutional_credit', hasInstitution: true }), { valid: true });\n});\n`
);
tests = tests.replace(
`test('anonymous walk-in generic credit is rejected', () => {\n  assert.deepEqual(validate({ paymentMethod: 'credit' }), {\n    valid: false,\n    code: 'credit_identity_required',\n    message: 'An identifiable client or institution is required for a credit sale.'\n  });\n});\n\ntest('identified generic credit remains eligible for existing downstream credit rules', () => {\n  assert.deepEqual(validate({ paymentMethod: 'credit', hasPatient: true }), { valid: true });\n  assert.deepEqual(validate({ paymentMethod: 'credit', hasInstitution: true }), { valid: true });\n});\n\n`,
''
);
tests += `\n\ntest('POS presents a single Credit option while retaining the legacy internal token for downstream compatibility', () => {\n  const source = readFileSync('src/pages/Sales.tsx', 'utf8');\n  assert.ok(source.includes("{ id: 'institutional_credit', label: 'Credit', icon: CreditCard }"));\n  assert.equal(source.includes("label: 'Inst. Credit'"), false);\n});\n`;
writeFileSync(testPath, tests);

const reportPath = 'docs/POS_V2_PHASE2_CONTEXT_VALIDATION_REPORT.md';
let report = readFileSync(reportPath, 'utf8');
report = report.replace(
'Institutional credit is not a sale context. It is a `PaymentMethodType` value, `institutional_credit`. The generic `credit` payment method also exists.',
'The user-facing POS now exposes one payment choice named `Credit`. For production compatibility, the current V2 checkout continues to persist the established internal token `institutional_credit`, because the protected durable outbox receivables consumer keys off that token. The business meaning is no longer institution-only: either a patient/client account or an institution account may support the credit sale.'
);
report = report.replace(
'- Institutional credit: institution required.\n- Generic credit: at least one identifiable client or institution required.',
'- Credit: at least one identifiable patient/client or institution account is required.\n- The legacy internal `institutional_credit` token is validated by the same rule and is not presented to the user as an institution-only option.'
);
report = report.replace(
'7. Institutional credit + no institution: BLOCK.\n8. Institutional credit + institution: PASS subject to existing downstream credit rules.\n9. Anonymous generic credit: BLOCK.',
'7. Credit + no patient/client and no institution: BLOCK.\n8. Credit + patient/client: PASS subject to existing downstream credit rules.\n9. Credit + institution: PASS subject to existing downstream credit rules.'
);
report = report.replace(
'Primary regression risk is blocking a previously tolerated anonymous `credit` payment. This is intentional under the Phase 2 no-anonymous-credit rule. Existing identified credit and institutional credit remain eligible for downstream credit checks.',
'Primary regression risk is blocking a previously tolerated anonymous credit payment. This is intentional. The visible POS label is now `Credit`, while the legacy internal `institutional_credit` token is retained only for compatibility with the already-protected V2 receivables posting path. Both patient/client-backed and institution-backed credit remain eligible.'
);
report = report.replace(
'- Institutional credit without institution: block; add institution; retry subject to existing credit eligibility.',
'- Credit without an attached patient/client or institution: block; attach either account type; retry subject to existing credit eligibility.'
);
report += '\n\n## Credit naming compatibility note\nThe business concept is now simply **Credit**. No institution-only restriction is intended. The current storage/payment token `institutional_credit` remains temporarily as an internal compatibility value because the protected V2 durable outbox worker posts `credit_receivables` from that token and already resolves either `institutionId`/`institutionName` or `patientId`/`patientName`. Renaming that internal token to `credit` would require a separately controlled downstream migration and is intentionally not part of Phase 2.\n';
writeFileSync(reportPath, report);
