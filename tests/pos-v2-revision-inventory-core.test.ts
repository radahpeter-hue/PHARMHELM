import test from 'node:test';
import assert from 'node:assert/strict';

const core = await import('../scripts/pos-v2-revision-inventory-core.mjs');

const sale = {
  id: 'sale_1',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  receiptNumber: 'R-1001',
  engineVersion: 2,
  status: 'completed',
  items: [
    {
      productId: 'p1',
      productName: 'Amoxicillin',
      quantity: 2,
      commercialQuantity: 2,
      tierCode: 'strip',
      tierMultiplier: 10,
      baseQuantity: 20,
      batchAllocations: [
        { batchId: 'b1', batchNumber: 'B001', baseQuantity: 12 },
        { batchId: 'b2', batchNumber: 'B002', baseQuantity: 8 }
      ]
    },
    {
      productId: 'p2',
      productName: 'Vitamin C',
      quantity: 5,
      tierCode: 'unit',
      tierMultiplier: 1,
      baseQuantity: 5,
      batchAllocations: [
        { batchId: 'b3', batchNumber: 'C001', baseQuantity: 5 }
      ]
    },
    { productId: 'svc', name: 'Consultation', quantity: 1, isService: true }
  ]
};

test('inventory reversal restores exact historical batches and product aggregates', () => {
  const plan = core.buildRevisionInventoryRestores({ sale, revisionId: 'revision_1' });
  assert.equal(plan.totalBaseUnits, 25);
  assert.deepEqual(plan.batches, [
    { batchId: 'b1', batchNumber: 'B001', productId: 'p1', baseQuantity: 12 },
    { batchId: 'b2', batchNumber: 'B002', productId: 'p1', baseQuantity: 8 },
    { batchId: 'b3', batchNumber: 'C001', productId: 'p2', baseQuantity: 5 }
  ]);
  assert.equal(plan.products.find((row: any) => row.productId === 'p1')?.baseQuantity, 20);
  assert.equal(plan.products.find((row: any) => row.productId === 'p2')?.baseQuantity, 5);
});

test('service lines do not create inventory reversal work', () => {
  const plan = core.buildRevisionInventoryRestores({
    sale: { ...sale, items: [{ productId: 'svc', isService: true, quantity: 1 }] },
    revisionId: 'revision_1'
  });
  assert.equal(plan.totalBaseUnits, 0);
  assert.deepEqual(plan.batches, []);
  assert.deepEqual(plan.products, []);
});

test('inventory reversal fails closed when immutable batch history is absent or inconsistent', () => {
  assert.throws(
    () => core.buildRevisionInventoryRestores({
      sale: { ...sale, items: [{ productId: 'p1', productName: 'Amoxicillin', quantity: 2, baseQuantity: 20 }] },
      revisionId: 'revision_1'
    }),
    /Exact historical batch allocations are missing/
  );

  assert.throws(
    () => core.buildRevisionInventoryRestores({
      sale: {
        ...sale,
        items: [{
          productId: 'p1',
          productName: 'Amoxicillin',
          quantity: 2,
          baseQuantity: 20,
          batchAllocations: [{ batchId: 'b1', batchNumber: 'B001', baseQuantity: 19 }]
        }]
      },
      revisionId: 'revision_1'
    }),
    /does not reconcile/
  );
});

test('inventory reversal event IDs are deterministic and revision scoped', () => {
  const first = core.revisionInventoryEventId({ originalSaleId: 'sale_1', productId: 'p1', revisionId: 'revision_1' });
  const replay = core.revisionInventoryEventId({ originalSaleId: 'sale_1', productId: 'p1', revisionId: 'revision_1' });
  const second = core.revisionInventoryEventId({ originalSaleId: 'sale_1', productId: 'p1', revisionId: 'revision_2' });
  assert.equal(first, replay);
  assert.notEqual(first, second);
  assert.match(first, /revision_revision_1$/);
});

test('live batch validation enforces tenant branch product and batch identity', () => {
  const restore = { batchId: 'b1', batchNumber: 'B001', productId: 'p1', baseQuantity: 12 };
  assert.equal(core.assertLiveBatchMatchesRestore({
    batch: { tenantId: 'tenant_1', branchId: 'branch_1', productId: 'p1', batchNumber: 'B001', quantity: 3 },
    restore,
    tenantId: 'tenant_1',
    branchId: 'branch_1'
  }), true);
  assert.throws(() => core.assertLiveBatchMatchesRestore({
    batch: { tenantId: 'tenant_1', branchId: 'branch_2', productId: 'p1', batchNumber: 'B001', quantity: 3 },
    restore,
    tenantId: 'tenant_1',
    branchId: 'branch_1'
  }), /branch mismatch/);
});

test('live product validation rejects cross-tenant and corrupt stock', () => {
  const restore = { productId: 'p1', baseQuantity: 20 };
  assert.equal(core.assertLiveProductCanRestore({
    product: { tenantId: 'tenant_1', stock: 10, quantityInStock: 10 },
    restore,
    tenantId: 'tenant_1'
  }), true);
  assert.throws(() => core.assertLiveProductCanRestore({
    product: { tenantId: 'tenant_2', stock: 10 },
    restore,
    tenantId: 'tenant_1'
  }), /tenant mismatch/);
  assert.throws(() => core.assertLiveProductCanRestore({
    product: { tenantId: 'tenant_1', stock: -1 },
    restore,
    tenantId: 'tenant_1'
  }), /invalid live stock/);
});
