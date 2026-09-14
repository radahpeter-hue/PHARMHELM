import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { calculateCheckoutV2, isV2SellableBatch } from '../src/services/pos-v2/posCheckoutV2Calculator';
import type { Product, SaleItem } from '../src/types';

const root = process.cwd();
const repositorySource = fs.readFileSync(path.join(root, 'src/services/pos-v2/posCheckoutV2Repository.ts'), 'utf8');
const serviceSource = fs.readFileSync(path.join(root, 'src/services/pos-v2/posCheckoutV2Service.ts'), 'utf8');
const salesSource = fs.readFileSync(path.join(root, 'src/pages/Sales.tsx'), 'utf8');

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1', tenantId: 't1', productId: 'p1', sku: 'P1', name: 'Panadol', category: 'Medicine',
  costPricePerPack: 0, sellingPricePerUnit: 1000, taxExempt: true, taxRate: 0,
  unitsPerPack: 100, unit: 'tablet', baseUnit: 'tablet', unitsPerStrip: 10, unitOfSell: 'unit',
  stock: 20, quantityInStock: 20,
  ...overrides
});

const item = (overrides: Partial<SaleItem> = {}): SaleItem => ({
  productId: 'p1', batchId: '', name: 'Panadol', productName: 'Panadol', quantity: 2,
  unitPrice: 1000, costPrice: 0, subtotal: 2000, total: 2000, lineTotal: 2000, isService: false,
  ...overrides
});

test('Batch 2 repository uses the shared named Firestore db rather than creating a default db', () => {
  assert.match(repositorySource, /import \{ db \} from '\.\.\/\.\.\/firebase'/);
  assert.doesNotMatch(repositorySource, /getFirestore\s*\(/);
});

test('Batch 2 service resolves Firebase authenticated identity and does not accept client tenant authority', () => {
  assert.match(serviceSource, /auth\.currentUser/);
  assert.doesNotMatch(serviceSource, /request\.tenantId/);
  assert.match(repositorySource, /doc\(db, 'staff', uid\)/);
});

test('Cashier exclusion and sales operate authority are explicit', () => {
  assert.match(repositorySource, /cashier/);
  assert.match(repositorySource, /sales:operate permission/);
  assert.match(repositorySource, /SYSTEM_ROLE_PERMISSIONS/);
});

test('branch authority and active branch state are revalidated', () => {
  assert.match(repositorySource, /assigned_branches/);
  assert.match(repositorySource, /branch\.status/);
  assert.match(repositorySource, /transaction\.get\(doc\(db, 'branches'/);
});

test('idempotency uses a dedicated attempt record and deterministic sale relationship', () => {
  assert.match(repositorySource, /pos_checkout_attempts/);
  assert.match(repositorySource, /IDEMPOTENCY_CONFLICT/);
  assert.match(repositorySource, /checkoutV2SaleDocumentId/);
  assert.match(repositorySource, /fingerprint/);
});

test('same transaction writes sale, attempt, batch deductions and product aggregates', () => {
  assert.match(repositorySource, /runTransaction\(db/);
  assert.match(repositorySource, /transaction\.update\(doc\(db, 'product_batches'/);
  assert.match(repositorySource, /transaction\.update\(doc\(db, 'products'/);
  assert.match(repositorySource, /transaction\.set\(prepared\.saleRef/);
  assert.match(repositorySource, /transaction\.set\(prepared\.attemptRef/);
});

test('product compatibility mirrors are updated together and aggregate mismatch is blocking', () => {
  assert.match(repositorySource, /quantityInStock: Math\.max\(0, nextStock\)/);
  assert.match(repositorySource, /stock: Math\.max\(0, nextStock\)/);
  assert.match(repositorySource, /STOCK_AGGREGATE_MISMATCH/);
});

test('V2 sale stays in sales and carries V2 integrity metadata', () => {
  assert.match(repositorySource, /doc\(db, 'sales'/);
  assert.doesNotMatch(repositorySource, /sales_v2/);
  assert.match(repositorySource, /engineVersion: 2/);
  assert.match(repositorySource, /checkoutAttemptId/);
  assert.match(repositorySource, /actualSaleCost/);
});

test('Batch 2 service contains no receipt printing or durable downstream execution', () => {
  for (const forbidden of ['window.print', 'openReceiptPrintWindow', 'printThermalReceipt', 'logSaleMovements', 'reconcilePosWelfarePosting', 'convertQuotationToSale']) {
    assert.equal(serviceSource.includes(forbidden), false, `${forbidden} must not be in V2 service`);
  }
});

test('V1 Sales checkout remains present and is not wired to executeCheckoutV2 in Batch 2', () => {
  assert.match(salesSource, /checkoutAttemptRef/);
  assert.match(salesSource, /firestoreService\.runTransaction/);
  assert.equal(salesSource.includes('executeCheckoutV2'), false);
});

test('sellable batch filter rejects other tenant, other branch, inactive, expired and invalid-cost batches', () => {
  const base = { id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2027-01-01', batchStatus: 'active', quantity: 10, costPerBaseUnit: 100 };
  const now = new Date('2026-09-14T10:00:00Z');
  assert.equal(isV2SellableBatch({ batch: base, tenantId: 't1', branchId: 'br1', productId: 'p1', now }), true);
  assert.equal(isV2SellableBatch({ batch: { ...base, tenantId: 't2' }, tenantId: 't1', branchId: 'br1', productId: 'p1', now }), false);
  assert.equal(isV2SellableBatch({ batch: { ...base, branchId: 'br2' }, tenantId: 't1', branchId: 'br1', productId: 'p1', now }), false);
  assert.equal(isV2SellableBatch({ batch: { ...base, batchStatus: 'quarantined' }, tenantId: 't1', branchId: 'br1', productId: 'p1', now }), false);
  assert.equal(isV2SellableBatch({ batch: { ...base, batchStatus: 'inactive' }, tenantId: 't1', branchId: 'br1', productId: 'p1', now }), false);
  assert.equal(isV2SellableBatch({ batch: { ...base, expiryDate: '2026-01-01' }, tenantId: 't1', branchId: 'br1', productId: 'p1', now }), false);
  assert.equal(isV2SellableBatch({ batch: { ...base, costPerBaseUnit: Number.NaN }, tenantId: 't1', branchId: 'br1', productId: 'p1', now }), false);
});

test('FEFO allocates earliest expiry first across multiple batches and preserves exact allocations', () => {
  const result = calculateCheckoutV2({
    tenantId: 't1', branchId: 'br1', items: [item({ quantity: 20, subtotal: 4000, lineTotal: 4000, unitPrice: 200 })],
    liveProducts: new Map([['p1', product({ unitOfSell: 'unit' })]]),
    batchesByProduct: new Map([['p1', [
      { id: 'b2', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'B', expiryDate: '2027-01-01', batchStatus: 'active', quantity: 20, costPerBaseUnit: 100 },
      { id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2026-10-01', batchStatus: 'active', quantity: 6, costPerBaseUnit: 100 }
    ]]]),
    now: new Date('2026-09-14T00:00:00Z')
  });
  assert.deepEqual(result.allocations[0].allocations.map(row => [row.batchId, row.baseQuantity]), [['b1', 6], ['b2', 14]]);
  assert.deepEqual(result.finalizedItems[0].batchAllocations?.map(row => [row.batchId, row.baseQuantity]), [['b1', 6], ['b2', 14]]);
});

test('service lines do not require FEFO stock', () => {
  const service = item({ productId: 'svc1', name: 'Consultation', isService: true, quantity: 1, unitPrice: 5000, subtotal: 5000, lineTotal: 5000 });
  const result = calculateCheckoutV2({ tenantId: 't1', branchId: 'br1', items: [service], liveProducts: new Map(), batchesByProduct: new Map() });
  assert.equal(result.demands.length, 0);
  assert.equal(result.productDeductions.size, 0);
  assert.equal(result.netTotal, 5000);
});

test('actual allocated cost floor blocks below-cost selling', () => {
  assert.throws(() => calculateCheckoutV2({
    tenantId: 't1', branchId: 'br1', items: [item({ quantity: 1, unitPrice: 90, subtotal: 90, lineTotal: 90 })],
    liveProducts: new Map([['p1', product()]]),
    batchesByProduct: new Map([['p1', [{ id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2027-01-01', batchStatus: 'active', quantity: 10, costPerBaseUnit: 100 }]]]),
    now: new Date('2026-09-14T00:00:00Z')
  }), (error: any) => error?.code === 'COST_FLOOR_VIOLATION');
});
