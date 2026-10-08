import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc } from 'firebase/firestore';

const scratch = mkdtempSync(join(tmpdir(), 'pharmhelm-quotation-'));
symlinkSync(resolve('node_modules'), join(scratch, 'node_modules'));
const stub = join(scratch, 'firebase-runtime.ts');
writeFileSync(stub, 'export const db = globalThis.__sparkRuntime.db; export const auth = globalThis.__sparkRuntime.auth;');
const bundle = join(scratch, 'quotation.mjs');
const entry = join(scratch, 'entry.ts');
writeFileSync(entry, `export { getNextQuotationId, createQuotationDraft } from ${JSON.stringify(resolve('src/services/quotationService.ts'))};\nexport { buildQuotationLineSnapshot } from ${JSON.stringify(resolve('src/services/quotationTierService.ts'))};`);
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle,
  plugins: [{ name: 'emulator-connection', setup(builder) {
    builder.onResolve({ filter: /(^|\/)firebase$/ }, args => args.path.startsWith('.') ? { path: stub } : undefined);
  }}] });

const env = await initializeTestEnvironment({ projectId: 'demo-pharmhelm-spark-production',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc('branches/branch-a').set({ tenantId: 'tenant-a', branch_code: 'MSK' });
    await db.doc('branches/branch-b').set({ tenantId: 'tenant-a', branch_code: 'KLA' });
    await db.doc('staff/operator').set({ tenantId: 'tenant-a', role: 'Pharmacist', active: true, status: 'active', assigned_branches: ['branch-a'] });
    await db.doc('products/product-a').set({ tenantId: 'tenant-a', name: 'Vitamin C', stock: 10 });
    await db.doc('product_batches/batch-a').set({ tenantId: 'tenant-a', branchId: 'branch-a', productId: 'product-a', quantity: 10, purchasePrice: 100, sellingPrice: 50, batch_status: 'active', expiryDate: '2028-12-31' });
  });
  const db = env.authenticatedContext('operator', { tenantId: 'tenant-a' }).firestore();
  globalThis.__sparkRuntime = { db, auth: { currentUser: { uid: 'operator' } } };
  const { getNextQuotationId, createQuotationDraft, buildQuotationLineSnapshot } = await import(pathToFileURL(bundle));

  const reserved = await Promise.all(Array.from({ length: 8 }, () => getNextQuotationId('tenant-a', 'branch-a', 'MSK', {})));
  assert.equal(new Set(reserved).size, 8, 'concurrent reservations must be unique');

  const line = buildQuotationLineSnapshot({
    productId: 'product-a', productName: 'Vitamin C', name: 'Vitamin C', quantity: 1, commercialQuantity: 1,
    unitPrice: 500, actualUnitPrice: 500, configuredPrice: 500, total: 500, subtotal: 500, lineTotal: 500,
    tierCode: 'strip', tierLabel: 'Strip', tierMultiplier: 10, baseQuantity: 10, isService: false
  });
  assert.equal(Object.values(line).some(value => value === undefined), false, 'line serialization must omit undefined fields');
  const quotationId = reserved[0];
  const draftData = {
    tenantId: 'tenant-a', branchId: 'branch-a', quotationId, createdBy: 'operator', saveRequestId: 'save-request-1', createdAt: Timestamp.now(),
    validityDate: Timestamp.now(), status: 'Draft', lineItems: [line], subtotal: 500, taxTotal: 0, grandTotal: 500
  };
  await createQuotationDraft({ tenantId: 'tenant-a', branchId: 'branch-a', quotationId, actorUid: 'operator', data: draftData });
  const saved = await getDoc(doc(db, 'pos_quotations', quotationId));
  assert.equal(saved.exists(), true);
  assert.equal(saved.data().lineItems[0].tierCode, 'strip');
  assert.equal(saved.data().lineItems[0].baseQuantity, 10);
  assert.equal((await getDoc(doc(db, 'product_batches', 'batch-a'))).data().quantity, 10, 'saving a quotation must not reserve stock');
  assert.equal((await getDoc(doc(db, 'sales', quotationId))).exists(), false, 'saving a quotation must not create revenue');
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('pos_quotations/branch-b-quotation').set({
      tenantId: 'tenant-a', branchId: 'branch-b', quotationId: 'branch-b-quotation', createdBy: 'other-operator', status: 'Draft'
    });
  });
  await assert.rejects(() => getDoc(doc(db, 'pos_quotations', 'branch-b-quotation')), /permission-denied/);
  await createQuotationDraft({ tenantId: 'tenant-a', branchId: 'branch-a', quotationId, actorUid: 'operator', data: draftData });
  await assert.rejects(() => createQuotationDraft({ tenantId: 'tenant-a', branchId: 'branch-a', quotationId, actorUid: 'operator', data: {
    ...draftData, saveRequestId: 'different-request'
  } }), /already in use/);
  await assert.rejects(() => createQuotationDraft({ tenantId: 'tenant-a', branchId: 'other-branch', quotationId: reserved[1], actorUid: 'operator', data: {
    tenantId: 'tenant-a', branchId: 'other-branch', quotationId: reserved[1], createdBy: 'operator', status: 'Draft'
  } }), /branch does not belong/);
  await assert.rejects(() => createQuotationDraft({ tenantId: 'tenant-a', branchId: 'branch-b', quotationId: reserved[2], actorUid: 'operator', data: {
    ...draftData, branchId: 'branch-b', quotationId: reserved[2], saveRequestId: 'other-branch-request'
  } }), /permission-denied/);
  console.log('PASS: quotation serialization, unique concurrent numbering, branch scope and create-only draft write');
} finally {
  await env.cleanup();
  rmSync(scratch, { recursive: true, force: true });
}
