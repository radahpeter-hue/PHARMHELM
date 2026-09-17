import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  executeSelectedCheckout,
  executionEngineForMode,
  pinCheckoutAttemptEngine
} from '../src/services/pos-v2/posCheckoutV2ActivationService';
import { resolvePosCheckoutV2Mode } from '../src/services/pos-v2/posCheckoutV2FeatureService';

const salesSource = readFileSync('src/pages/Sales.tsx', 'utf8');
const consumptionSource = readFileSync('src/services/consumptionService.ts', 'utf8');
const financialSource = readFileSync('src/services/posFinancialPostingService.ts', 'utf8');

test('tenant defaults, branch overrides, disabled flags and malformed modes resolve safely', () => {
  assert.equal(resolvePosCheckoutV2Mode({ tenant: {} }).effectiveMode, 'legacy');
  assert.equal(resolvePosCheckoutV2Mode({ tenant: { features: { posCheckoutV2Enabled: true }, posCheckoutEngine: 'v2' } }).effectiveMode, 'v2');
  assert.equal(resolvePosCheckoutV2Mode({
    tenant: { features: { posCheckoutV2Enabled: true }, posCheckoutEngine: 'v2' },
    branch: { posCheckoutEngine: 'legacy' }
  }).effectiveMode, 'legacy');
  assert.equal(resolvePosCheckoutV2Mode({
    tenant: { features: { posCheckoutV2Enabled: true }, posCheckoutEngine: 'broken' as any },
    branch: { posCheckoutEngine: 'broken' as any }
  }).effectiveMode, 'shadow');
  assert.equal(executionEngineForMode('shadow'), 'legacy');
});

test('legacy mode calls only legacy checkout', async () => {
  let legacyCalls = 0;
  let v2Calls = 0;
  const execution = await executeSelectedCheckout({
    engine: 'legacy',
    executeLegacy: async () => { legacyCalls += 1; return 'legacy-sale'; },
    executeV2: async () => { v2Calls += 1; return 'v2-sale'; }
  });
  assert.deepEqual({ legacyCalls, v2Calls }, { legacyCalls: 1, v2Calls: 0 });
  assert.deepEqual(execution, { engine: 'legacy', result: 'legacy-sale' });
});

test('V2 mode calls only V2 and accepts a replayed result', async () => {
  let legacyCalls = 0;
  let v2Calls = 0;
  const replay = { saleId: 'sale-1', receiptNumber: 'KLA-2026-100001', replayed: true };
  const execution = await executeSelectedCheckout({
    engine: 'v2',
    executeLegacy: async () => { legacyCalls += 1; return 'legacy-sale'; },
    executeV2: async () => { v2Calls += 1; return replay; }
  });
  assert.deepEqual({ legacyCalls, v2Calls }, { legacyCalls: 0, v2Calls: 1 });
  assert.deepEqual(execution, { engine: 'v2', result: replay });
});

test('V2 failure propagates and never invokes legacy fallback', async () => {
  let legacyCalls = 0;
  await assert.rejects(() => executeSelectedCheckout({
    engine: 'v2',
    executeLegacy: async () => { legacyCalls += 1; return 'legacy-sale'; },
    executeV2: async () => { throw new Error('response lost after commit'); }
  }), /response lost after commit/);
  assert.equal(legacyCalls, 0);
});

test('attempt ID and selected engine remain pinned across retries and configuration rollback', () => {
  const first = pinCheckoutAttemptEngine({ attemptId: 'attempt-1' }, 'v2');
  const retry = pinCheckoutAttemptEngine(first, 'legacy');
  assert.equal(retry.attemptId, 'attempt-1');
  assert.equal(retry.engine, 'v2');
});

test('Sales maps the complete context, uses authoritative V2 receipt data, and resets only on success or deliberate clear', () => {
  for (const field of [
    'attemptId:', 'branchId:', 'items: itemsWithVat', 'discountPercentage,', 'paymentMethod,',
    'secondaryPaymentMethod:', 'secondaryAmount:', 'welfareAmount:', 'welfareBeneficiaryIsStaff:',
    'context,', 'sourceQuotationId:', 'customerId:', 'patientId:', 'institutionId:', 'prescriberId:',
    'isExceptionalConsumption,', 'exceptionalConsumptionReason:'
  ]) assert.ok(salesSource.includes(field), `missing V2 request mapping for ${field}`);
  assert.match(salesSource, /receiptNumber = result\.receiptNumber/);
  assert.match(salesSource, /completedSale = result\.sale/);
  assert.match(salesSource, /checkoutSubmissionRef\.current/);
  assert.match(salesSource, /checkoutAttemptRef\.current = null/);
  assert.match(salesSource, /attempt\.tenantId !== profile\.tenantId \|\| attempt\.branchId !== activeBranchId/);
});

test('browser reconciliation excludes V2 sales because Batch 4 owns durable downstream posting', () => {
  assert.match(consumptionSource, /engineVersion \|\| 0\) !== 2/);
  assert.match(financialSource, /engineVersion \|\| 0\) !== 2/);
  assert.match(salesSource, /finalReceiptId && checkoutEngine === 'legacy'/);
  assert.match(salesSource, /resumedQuotationId && finalReceiptId && checkoutEngine === 'legacy'/);
});

test('legacy mutation paths cannot edit or void immutable V2 receipts', () => {
  assert.match(salesSource, /ledgerEditingSale\.engineVersion === 2/);
  assert.match(salesSource, /sale\.engineVersion === 2/);
  assert.match(salesSource, /durable V2 reversal workflow/);
});
