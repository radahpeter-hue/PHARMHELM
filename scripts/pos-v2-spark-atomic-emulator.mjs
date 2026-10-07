import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createPosV2ConsumerPosters } from './pos-v2-consumer-posting.mjs';
import { build } from 'esbuild';
import { consumptionSummaryId, dateKeyForTimezone, movementEventId } from './pos-v2-batch4-core.mjs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';

// Bundle the actual production repository, replacing ONLY the Firebase connection
// module. Auth, rules, canonical checkout, stock and financial code remain real.
const scratch = mkdtempSync(join(tmpdir(), 'pharmhelm-spark-'));
symlinkSync(resolve('node_modules'), join(scratch, 'node_modules'));
const stub = join(scratch, 'firebase-runtime.ts');
writeFileSync(stub, 'export const db = globalThis.__sparkRuntime.db; export const auth = globalThis.__sparkRuntime.auth;');
const bundle = join(scratch, 'atomic.mjs');
const entry = join(scratch, 'entry.ts');
writeFileSync(entry, `export { commitPosV2ReceiptCorrection } from ${JSON.stringify(resolve('src/services/pos-v2/posSaleRevisionV2AtomicRepository.ts'))};\nexport { PosRevisionStagedTransaction } from ${JSON.stringify(resolve('src/services/pos-v2/posRevisionStagedTransaction.ts'))};`);
await build({ entryPoints: [entry],
  bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle,
  plugins: [{ name: 'emulator-connection', setup(builder) {
    builder.onResolve({ filter: /(^|\/)firebase$/ }, args => args.path.startsWith('.') ? { path: stub } : undefined);
  }}] });
const plannerBundle = join(scratch, 'planner.mjs');
await build({ entryPoints: [resolve('src/services/pos-v2/posSaleRevisionV2Planner.ts')], bundle: true,
  platform: 'node', format: 'esm', packages: 'external', outfile: plannerBundle });
const { buildPosV2RevisionPlan } = await import(pathToFileURL(plannerBundle));
const env = await initializeTestEnvironment({ projectId: 'demo-pharmhelm-spark-production',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
let checks = 0;

async function seed({ method = 'cash', posted = false, role = 'Dispenser', quantity = 90, settledCredit = false, multipleBatches = false, productCount = 1 } = {}) {
  await env.clearFirestore();
  const timestamp = new Date(Date.now() - 3600000).toISOString();
  const sale = { id: 'original', tenantId: 'tenant-a', branchId: 'branch-a', receiptNumber: 'MSK-2026-420818',
    engineVersion: 2, status: 'completed', timestamp, cashierId: 'seller', servedBy: 'seller',
    canonicalPaymentId: 'old-payment', transactionOutboxEventId: 'old-outbox', paymentMethod: method,
    patientId: method === 'staff_welfare' ? 'beneficiary' : undefined,
    welfareBeneficiaryIsStaff: method === 'staff_welfare', welfareAmount: method === 'staff_welfare' ? 5000 : undefined,
    welfarePostingStatus: posted && method === 'staff_welfare' ? 'posted' : 'pending',
    welfarePostingId: posted && method === 'staff_welfare' ? 'pos_welfare_tenant-a_original' : undefined,
    context: method === 'institutional_credit' ? 'institutional' : 'walk-in',
    institutionId: method === 'institutional_credit' ? 'institution' : undefined,
    subtotal: 5000, total: 5000, totalAmount: 5000, discountPercentage: 0,
    createdAt: Timestamp.fromDate(new Date(timestamp)),
    items: [{ productId: 'vitc', productName: 'Vitamin C', name: 'Vitamin C', quantity: 10,
      commercialQuantity: 10, baseQuantity: 10, unitPrice: 500, actualUnitPrice: 500, costPrice: 100,
      subtotal: 5000, total: 5000, batchId: 'batch-a', batchNumber: 'VIT-A', expiryDate: '2028-12-31',
      batchAllocations: [{ batchId: 'batch-a', batchNumber: 'VIT-A', baseQuantity: 10, costPerBaseUnit: 100 }] }] };
  if (multipleBatches) sale.items[0].batchAllocations = [
    { batchId: 'batch-a', batchNumber: 'VIT-A', baseQuantity: 4, costPerBaseUnit: 100 },
    { batchId: 'batch-b', batchNumber: 'VIT-B', baseQuantity: 6, costPerBaseUnit: 100 }
  ];
  for (let index = 1; index < productCount; index++) sale.items.push({ ...sale.items[0],
    productId: `vitc-${index}`, batchId: `batch-${index}`, batchNumber: `VIT-${index}`,
    batchAllocations: [{ batchId: `batch-${index}`, batchNumber: `VIT-${index}`, baseQuantity: 10, costPerBaseUnit: 100 }] });
  sale.total = sale.totalAmount = sale.subtotal = productCount * 5000;
  const unpaid = method === 'institutional_credit';
  const payment = { paymentId: 'old-payment', saleId: sale.id, tenantId: sale.tenantId, branchId: sale.branchId,
    receiptNumber: sale.receiptNumber, checkoutAttemptId: 'old-attempt', paymentMethod: method, currency: 'UGX',
    engineVersion: 2, amount: 5000, settledAmount: unpaid ? 0 : 5000, outstandingAmount: unpaid ? 5000 : 0,
    status: unpaid ? 'unpaid' : 'completed', components: [{ method, amount: 5000,
      settledAmount: unpaid ? 0 : 5000, outstandingAmount: unpaid ? 5000 : 0, status: unpaid ? 'unpaid' : 'settled' }] };
  payment.amount *= productCount; payment.settledAmount *= productCount; payment.outstandingAmount *= productCount;
  for (const component of payment.components) { component.amount *= productCount; component.settledAmount *= productCount; component.outstandingAmount *= productCount; }
  const clean = value => JSON.parse(JSON.stringify(value));
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const records = [
      ['staff', 'operator', { tenantId: 'tenant-a', role, status: 'active', active: true, assigned_branches: ['branch-a'], secondaryRoles: [] }],
      ['staff', 'beneficiary', { tenantId: 'tenant-a', role: 'Dispenser', status: 'active', assigned_branches: ['branch-a'], welfare_spent: posted ? 5000 : 0, welfare_used_ytd: posted ? 5000 : 0, welfare_limit: 50000 }],
      ['branches', 'branch-a', { tenantId: 'tenant-a', status: 'active', branch_code: 'MSK' }],
      ['products', 'vitc', { tenantId: 'tenant-a', name: 'Vitamin C', stock: quantity, quantityInStock: quantity, unitOfSell: 'unit', sellingPrice: 500, purchasePrice: 100 }],
      ['product_batches', 'batch-a', { tenantId: 'tenant-a', branchId: 'branch-a', productId: 'vitc', batchNumber: 'VIT-A', quantity: multipleBatches ? 36 : quantity, purchasePrice: 100, sellingPrice: 500, expiryDate: '2028-12-31', batch_status: 'active' }],
      ['institutions', 'institution', { tenantId: 'tenant-a', name: 'Example Institution', status: 'active' }],
      ['billable_services', 'consultation', { tenantId: 'tenant-a', name: 'Consultation', defaultFee: 2000 }],
      ['sales', sale.id, { ...clean(sale), createdAt: sale.createdAt }],
      ['pos_payments', 'old-payment', payment],
      ['pos_transaction_outbox', 'old-outbox', { tenantId: 'tenant-a', branchId: 'branch-a', saleId: 'original', paymentId: 'old-payment', status: posted ? 'PROCESSED' : 'PENDING', engineVersion: 2, eventType: 'POS_SALE_COMMITTED' }]
    ];
    if (multipleBatches) records.push(['product_batches', 'batch-b', { tenantId: 'tenant-a', branchId: 'branch-a', productId: 'vitc', batchNumber: 'VIT-B', quantity: 54, purchasePrice: 100, sellingPrice: 500, expiryDate: '2029-12-31', batch_status: 'active' }]);
    for (let index = 1; index < productCount; index++) records.push(
      ['products', `vitc-${index}`, { tenantId: 'tenant-a', name: `Product ${index}`, stock: 90, quantityInStock: 90, unitOfSell: 'unit', sellingPrice: 500, purchasePrice: 100 }],
      ['product_batches', `batch-${index}`, { tenantId: 'tenant-a', branchId: 'branch-a', productId: `vitc-${index}`, batchNumber: `VIT-${index}`, quantity: 90, purchasePrice: 100, expiryDate: '2028-12-31', batch_status: 'active' }]);
    if (posted) {
      const dateKey = dateKeyForTimezone(new Date(timestamp));
      records.push(
        ['inventoryMovementEvents', movementEventId({ saleId: 'original', productId: 'vitc' }), { tenantId: 'tenant-a', branchId: 'branch-a', productId: 'vitc', eventType: 'SALE', sourceDocumentId: 'original', consumptionDeltaBaseUnits: 10, quantityDeltaBaseUnits: -10, dateKey, isExceptional: false }],
        ['branchConsumptionDaily', consumptionSummaryId('tenant-a', 'branch-a', 'vitc', dateKey), { tenantId: 'tenant-a', branchId: 'branch-a', productId: 'vitc', dateKey, ordinaryUnitsSold: 10, validConsumptionUnits: 10, exceptionalUnits: 0, transactionCount: 1, consumptionTransactionCount: 1, closingUsableStock: 90, openingUsableStock: 100, aggregationVersion: 1 }]);
    }
    if (posted && method === 'institutional_credit') records.push(['credit_receivables', 'original', { tenantId: 'tenant-a', receipt_id: 'original', branch_id: 'branch-a', amount_ugx: 5000, outstanding_ugx: settledCredit ? 3000 : 5000, status: 'outstanding', paymentId: 'old-payment' }]);
    if (posted && method === 'staff_welfare') records.push(
      ['welfare', 'pos_welfare_tenant-a_original', { tenantId: 'tenant-a', branchId: 'branch-a', saleId: 'original', staffId: 'beneficiary', isStaff: true, amount: 5000, status: 'approved' }],
      ['branch_expenses', 'pos_welfare_expense_tenant-a_original', { tenantId: 'tenant-a', branchId: 'branch-a', saleId: 'original', amount: 5000, status: 'approved' }],
      ['cashTransfers', 'pos_welfare_transfer_tenant-a_original', { tenantId: 'tenant-a', saleId: 'original', amount: 5000, status: 'posted' }]);
    for (const [collection, id, data] of records) await setDoc(doc(db, collection, id), data);
  });
  const db = env.authenticatedContext('operator', { tenantId: 'tenant-a', email: 'operator@example.test' }).firestore();
  globalThis.__sparkRuntime = { db, auth: { currentUser: { uid: 'operator' } } };
  const { commitPosV2ReceiptCorrection, PosRevisionStagedTransaction } = await import(pathToFileURL(bundle).href + `?case=${checks++}`);
  return { db, sale: clean(sale), commit: commitPosV2ReceiptCorrection, Stage: PosRevisionStagedTransaction };
}

function input(sale, quantity = 30, addService = false, paymentMethod = sale.paymentMethod) {
  const revisedItems = [{ ...sale.items[0], quantity, commercialQuantity: quantity, subtotal: quantity * 500, total: quantity * 500 }, ...sale.items.slice(1)];
  if (addService) revisedItems.push({ productId: 'consultation', name: 'Consultation', productName: 'Consultation', batchId: 'N/A', quantity: 1, unitPrice: 2000, subtotal: 2000, total: 2000, costPrice: 0, isService: true });
  const plan = buildPosV2RevisionPlan({ originalSale: sale, revisedItems, revisedTotal: quantity * 500 + (sale.items.length - 1) * 5000 + (addService ? 2000 : 0),
    reason: 'Correct the receipt quantity', paymentMethod, now: new Date() });
  return { originalSale: sale, plan, revisedItems, actor: { uid: 'operator', name: 'Revision Operator', role: 'Dispenser' } };
}

try {
  for (const scenario of [
    { label: 'cash 10 to 30', method: 'cash' },
    { label: 'cash quantity decrease', method: 'cash', revisedQuantity: 5 },
    { label: 'service from POS catalogue', method: 'cash', addService: true },
    { label: 'unposted institutional credit', method: 'institutional_credit' },
    { label: 'multiple historical batches', method: 'cash', multipleBatches: true },
    { label: 'six products in one receipt', method: 'cash', productCount: 6 },
    { label: 'posted institutional credit', method: 'institutional_credit', posted: true },
    { label: 'unposted welfare', method: 'staff_welfare' },
    { label: 'posted welfare', method: 'staff_welfare', posted: true }
  ]) {
    const { db, sale, commit } = await seed(scenario);
    const quantity = scenario.revisedQuantity ?? 30;
    const reviewed = input(sale, quantity, scenario.addService);
    const result = await commit(reviewed);
    assert.equal(result.request.status, 'COMPLETED');
    assert.equal(result.checkout.sale.totalAmount, quantity * 500 + (sale.items.length - 1) * 5000 + (scenario.addService ? 2000 : 0));
    assert.equal((await getDoc(doc(db, 'product_batches', 'batch-a'))).data().quantity, scenario.multipleBatches ? 40 - quantity : 100 - quantity);
    assert.equal((await getDoc(doc(db, 'sales', 'original'))).data().totalAmount, sale.totalAmount);
    assert.equal((await getDoc(doc(db, 'pos_transaction_outbox', 'old-outbox'))).data().status, 'SUPERSEDED');
    assert.equal((await commit(reviewed)).replayed, true);
    const summary = await getDoc(doc(db, 'branchConsumptionDaily', consumptionSummaryId('tenant-a', 'branch-a', 'vitc', dateKeyForTimezone(new Date(sale.timestamp)))));
    assert.equal(summary.data().ordinaryUnitsSold, quantity);
    if (scenario.method === 'staff_welfare') {
      assert.equal((await getDoc(doc(db, 'staff', 'beneficiary'))).data().welfare_spent, quantity * 500);
    }
    if (scenario.method === 'institutional_credit') {
      let credit;
      await env.withSecurityRulesDisabled(async context => { credit = (await getDoc(doc(context.firestore(), 'credit_receivables', result.checkout.saleId))).data(); });
      assert.equal(credit.outstanding_ugx, quantity * 500);
    }
    console.log(`PASS ${scenario.label}; canonical commit and exact replay`);
  }
  {
    const { db, sale, commit } = await seed();
    const reviewed = input(sale);
    const results = await Promise.all([commit(reviewed), commit(reviewed)]);
    assert.equal(new Set(results.map(result => result.checkout.saleId)).size, 1);
    assert.equal((await getDoc(doc(db, 'product_batches', 'batch-a'))).data().quantity, 70);
    await assert.rejects(commit(input(sale, 5)), /different correction/);
    console.log('PASS simultaneous double-save and conflicting intent');
  }
  for (const scenario of [{ role: 'Cashier' }, { quantity: 0 }, { method: 'institutional_credit', posted: true, settledCredit: true }]) {
    const { db, sale, commit } = await seed(scenario);
    await assert.rejects(commit(input(sale)));
    assert.equal((await getDoc(doc(db, 'product_batches', 'batch-a'))).data().quantity, scenario.quantity ?? 90);
    assert.equal((await getDoc(doc(db, 'sales', 'original'))).data().revisionId, undefined);
    console.log(`PASS rejection leaves stock and original unchanged: ${JSON.stringify(scenario)}`);
  }
  for (const fault of [
    { label: 'missing payment reversal', drop: 'pos_payment_reversals/' },
    { label: 'missing immutable audit', drop: 'audit_logs/' },
    { label: 'missing replacement payment', drop: 'pos_payments/' },
    { label: 'missing posted credit reversal', method: 'institutional_credit', posted: true, drop: 'pos_credit_reversals/' },
    { label: 'missing credit balance compensation', method: 'institutional_credit', posted: true, drop: 'credit_receivables/original' },
    { label: 'missing welfare balance compensation', method: 'staff_welfare', posted: true, drop: 'staff/beneficiary' },
    { label: 'missing welfare financial posting', method: 'staff_welfare', posted: true, drop: 'branch_expenses/' }
  ]) {
    const { db, sale, commit, Stage } = await seed(fault);
    const flush = Stage.prototype.flush;
    Stage.prototype.flush = function () {
      for (const path of this.pending.keys()) if (path.startsWith(fault.drop)) this.pending.delete(path);
      return flush.call(this);
    };
    try { await assert.rejects(commit(input(sale))); }
    finally { Stage.prototype.flush = flush; }
    assert.equal((await getDoc(doc(db, 'product_batches', 'batch-a'))).data().quantity, 90);
    assert.equal((await getDoc(doc(db, 'sales', 'original'))).data().revisionId, undefined);
    console.log(`PASS rules reject ${fault.label}; entire correction rolls back`);
  }
  {
    const { db, sale, commit, Stage } = await seed();
    await commit(input(sale));
    const stale = createPosV2ConsumerPosters({
      db: { collection: name => ({ doc: id => doc(db, name, id) }),
        runTransaction: operation => runTransaction(db, transaction => new Stage(db, transaction).asExecutorDatabase().runTransaction(operation)) },
      FieldValue: { serverTimestamp }, workerId: 'stale-worker', requireLease: true,
      batchRefsByProduct: new Map([['vitc', [doc(db, 'product_batches', 'batch-a')]]])
    });
    await assert.rejects(stale.postConsumption(sale), /superseded or locked/);
    const welfareSale = { ...sale, paymentMethod: 'staff_welfare', patientId: 'beneficiary', welfareBeneficiaryIsStaff: true, welfareAmount: 5000 };
    await assert.rejects(stale.postWelfare(welfareSale, { components: [{ method: 'staff_welfare', amount: 5000 }] }), /superseded or locked/);
    const creditSale = { ...sale, paymentMethod: 'institutional_credit', institutionId: 'institution' };
    await assert.rejects(stale.postInstitutionalCredit(creditSale, { components: [{ method: 'institutional_credit', amount: 5000 }] }), /superseded or locked/);
    assert.equal((await getDoc(doc(db, 'product_batches', 'batch-a'))).data().quantity, 70);
    console.log('PASS stale stock, welfare and credit workers cannot post a superseded sale');
  }
  for (const invalid of [
    { label: 'inactive operator', collection: 'staff', id: 'operator', patch: { status: 'inactive', active: false } },
    { label: 'branch assignment removed', collection: 'staff', id: 'operator', patch: { assigned_branches: ['branch-b'] } },
    { label: 'receipt older than 72 hours', collection: 'sales', id: 'original', patch: { createdAt: Timestamp.fromMillis(Date.now() - 73 * 3600000), timestamp: new Date(Date.now() - 73 * 3600000).toISOString() } },
    { label: 'service moved to another tenant', collection: 'billable_services', id: 'consultation', patch: { tenantId: 'tenant-b' }, addService: true }
  ]) {
    const { db, sale, commit } = await seed();
    await env.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), invalid.collection, invalid.id), invalid.patch, { merge: true }));
    await assert.rejects(commit(input(sale, 30, invalid.addService)));
    await env.withSecurityRulesDisabled(async context => {
      assert.equal((await getDoc(doc(context.firestore(), 'product_batches', 'batch-a'))).data().quantity, 90);
      assert.equal((await getDoc(doc(context.firestore(), 'sales', 'original'))).data().revisionId, undefined);
    });
    console.log(`PASS fresh authority and reference validation: ${invalid.label}`);
  }
  console.log('Spark production-schema emulator checks passed.');
} finally {
  await env.cleanup();
  rmSync(scratch, { recursive: true, force: true });
}
