import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateSaleCheckoutContext } from '../src/utils/saleContextValidation';

const validate = (overrides: Partial<Parameters<typeof validateSaleCheckoutContext>[0]> = {}) =>
  validateSaleCheckoutContext({
    context: 'walk-in',
    paymentMethod: 'cash',
    hasPatient: false,
    hasInstitution: false,
    ...overrides
  });

test('anonymous walk-in passes context validation', () => {
  assert.deepEqual(validate(), { valid: true });
});

test('named walk-in passes context validation', () => {
  assert.deepEqual(validate({ hasPatient: true }), { valid: true });
});

test('telepharmacy without a client/patient is rejected with an actionable message', () => {
  assert.deepEqual(validate({ context: 'telepharmacy' }), {
    valid: false,
    code: 'telepharmacy_patient_required',
    message: 'Client/patient name is required for a telepharmacy sale.'
  });
});

test('telepharmacy with a named client/patient passes', () => {
  assert.deepEqual(validate({ context: 'telepharmacy', hasPatient: true }), { valid: true });
});

test('institutional sale without an institution is rejected', () => {
  assert.deepEqual(validate({ context: 'institutional' }), {
    valid: false,
    code: 'institution_required',
    message: 'Select an institution before completing an institutional sale.'
  });
});

test('institutional sale with an institution passes', () => {
  assert.deepEqual(validate({ context: 'institutional', hasInstitution: true }), { valid: true });
});

test('institutional credit without an institution is rejected', () => {
  assert.deepEqual(validate({ context: 'institutional', paymentMethod: 'institutional_credit' }), {
    valid: false,
    code: 'institutional_credit_institution_required',
    message: 'An institution is required for institutional credit.'
  });
});

test('institutional credit with an institution passes context validation', () => {
  assert.deepEqual(validate({ context: 'institutional', paymentMethod: 'institutional_credit', hasInstitution: true }), { valid: true });
});

test('anonymous walk-in generic credit is rejected', () => {
  assert.deepEqual(validate({ paymentMethod: 'credit' }), {
    valid: false,
    code: 'credit_identity_required',
    message: 'An identifiable client or institution is required for a credit sale.'
  });
});

test('identified generic credit remains eligible for existing downstream credit rules', () => {
  assert.deepEqual(validate({ paymentMethod: 'credit', hasPatient: true }), { valid: true });
  assert.deepEqual(validate({ paymentMethod: 'credit', hasInstitution: true }), { valid: true });
});

test('Phase 2 validation is wired before checkout attempt locking and POS V2 invocation', () => {
  const source = readFileSync('src/pages/Sales.tsx', 'utf8');
  const completeSaleIndex = source.indexOf('const completeSale = async');
  const completeValidationIndex = source.indexOf('const contextValidation = validateSaleCheckoutContext({', completeSaleIndex);
  const submissionLockIndex = source.indexOf('checkoutSubmissionRef.current = true', completeSaleIndex);
  const v2InvocationIndex = source.indexOf('await executeCheckoutV2({', completeSaleIndex);

  assert.notEqual(completeSaleIndex, -1);
  assert.notEqual(completeValidationIndex, -1);
  assert.notEqual(submissionLockIndex, -1);
  assert.notEqual(v2InvocationIndex, -1);
  assert.ok(completeValidationIndex < submissionLockIndex, 'context validation must precede checkout submission lock');
  assert.ok(completeValidationIndex < v2InvocationIndex, 'context validation must precede POS V2 invocation');
});

test('validation helper has no inventory, transaction or outbox side effects', () => {
  const helperSource = readFileSync('src/utils/saleContextValidation.ts', 'utf8');
  assert.equal(helperSource.includes('executeCheckoutV2'), false);
  assert.equal(helperSource.includes('product_batches'), false);
  assert.equal(helperSource.includes('runTransaction'), false);
  assert.equal(helperSource.includes('outbox'), false);
});
