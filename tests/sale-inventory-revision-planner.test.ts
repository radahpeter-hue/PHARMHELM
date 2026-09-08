import test from 'node:test';
import assert from 'node:assert/strict';
import type { Product, SaleItem } from '../src/types';
import { planSaleInventoryRevision, type RevisionBatchState } from '../src/services/saleInventoryRevisionPlanner';
import { assertExactStoredAllocations, saleItemFingerprint } from '../src/services/saleTierHistoryService';

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1', tenantId: 't1', productId: 'PRD-1', sku: 'SKU-1', name: 'Panadol', category: 'drug/medicine',
  costPricePerPack: 10000, sellingPricePerUnit: 300, taxExempt: true, taxRate: 0,
  unitsPerPack: 100, unitsPerStrip: 10, unit: 'tablet', baseUnit: 'tablet', dosageForm: 'Tablet', unitOfSell: 'unit',
  ...overrides
});

const batch = (overrides: Partial<RevisionBatchState> = {}): RevisionBatchState => ({
  id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2027-01-31',
  batchStatus: 'active', quantity: 20, costPerBaseUnit: 100, ...overrides
});

const stripLine = (overrides: Partial<SaleItem> = {}): SaleItem => ({
  lineId: 'line-strip', productId: 'p1', tenantId: 't1', branchId: 'br1', batchId: '', name: 'Panadol', productName: 'Panadol',
  quantity: 1, commercialQuantity: 1, unitPrice: 2500, actualUnitPrice: 2500, configuredPrice: 2500,
  total: 2500, subtotal: 2500, lineTotal: 2500, tierCode: 'strip', tierLabel: 'Strip', tierMultiplier: 10,
  baseQuantity: 10, priceSource: 'configured-tier', isService: false, batchNumber: 'FEFO-MULTI', expiryDate: 'Multiple',
  batchAllocations: [
    { batchId: 'b1', batchNumber: 'A', expiryDate: '2027-01-31', baseQuantity: 6, costPerBaseUnit: 100 },
    { batchId: 'b2', batchNumber: 'B', expiryDate: '2027-02-28', baseQuantity: 4, costPerBaseUnit: 120 }
  ],
  actualLineCost: 1080,
  ...overrides
});

const products = new Map([['p1', product()]]);
const batches = [batch(), batch({ id: 'b2', batchNumber: 'B', expiryDate: '2027-02-28', quantity: 30, costPerBaseUnit: 120 })];

const plan = (originalItems: SaleItem[], updatedItems: SaleItem[], customBatches = batches, discountPercentage = 0) => planSaleInventoryRevision({
  originalItems, updatedItems, products, batches: customBatches, tenantId: 't1', branchId: 'br1', discountPercentage,
  now: new Date('2026-09-08T12:00:00Z')
});

test('unchanged tier quantity preserves exact historical allocations and current batch balances', () => {
  const original = stripLine();
  const result = plan([original], [{ ...original }]);
  assert.deepEqual(result.finalItems[0].batchAllocations, original.batchAllocations);
  assert.equal(result.batchNextQuantities.get('b1'), 20);
  assert.equal(result.batchNextQuantities.get('b2'), 30);
  assert.equal(result.productBaseDeltas.get('p1'), 0);
});

test('decreasing a tier line restores the unused tail allocation to its exact source batch', () => {
  const original = stripLine();
  const updated = { ...original, quantity: 0, commercialQuantity: 0 } as SaleItem;
  assert.throws(() => plan([original], [updated]), /positive whole commercial quantity/);

  const twoStripOriginal = stripLine({
    quantity: 2, commercialQuantity: 2, baseQuantity: 20, total: 5000, subtotal: 5000, lineTotal: 5000,
    batchAllocations: [
      { batchId: 'b1', batchNumber: 'A', expiryDate: '2027-01-31', baseQuantity: 6, costPerBaseUnit: 100 },
      { batchId: 'b2', batchNumber: 'B', expiryDate: '2027-02-28', baseQuantity: 14, costPerBaseUnit: 120 }
    ]
  });
  const result = plan([twoStripOriginal], [{ ...twoStripOriginal, quantity: 1, commercialQuantity: 1 }]);
  assert.deepEqual(result.finalItems[0].batchAllocations?.map(a => [a.batchId, a.baseQuantity]), [['b1', 6], ['b2', 4]]);
  assert.equal(result.batchNextQuantities.get('b1'), 20);
  assert.equal(result.batchNextQuantities.get('b2'), 40);
  assert.equal(result.productBaseDeltas.get('p1'), -10);
});

test('increasing a tier line preserves original allocations then takes only the increment by live FEFO', () => {
  const original = stripLine();
  const result = plan([original], [{ ...original, quantity: 2, commercialQuantity: 2 }]);
  assert.deepEqual(result.finalItems[0].batchAllocations?.map(a => [a.batchId, a.baseQuantity]), [
    ['b1', 6], ['b2', 4], ['b1', 10]
  ]);
  assert.equal(result.batchNextQuantities.get('b1'), 10);
  assert.equal(result.batchNextQuantities.get('b2'), 30);
  assert.equal(result.productBaseDeltas.get('p1'), 10);
});

test('removing a product line restores every historical allocation without rerunning FEFO', () => {
  const original = stripLine();
  const result = plan([original], []);
  assert.equal(result.finalItems.length, 0);
  assert.equal(result.batchNextQuantities.get('b1'), 26);
  assert.equal(result.batchNextQuantities.get('b2'), 34);
  assert.equal(result.productBaseDeltas.get('p1'), -10);
});

test('additional quantity never uses an expired batch unless it is preserving the original historical allocation', () => {
  const original = stripLine({
    batchAllocations: [{ batchId: 'b1', batchNumber: 'A', expiryDate: '2026-08-31', baseQuantity: 10, costPerBaseUnit: 100 }]
  });
  const customBatches = [
    batch({ id: 'b1', batchNumber: 'A', expiryDate: '2026-08-31', quantity: 20, costPerBaseUnit: 100 }),
    batch({ id: 'b2', batchNumber: 'B', expiryDate: '2027-02-28', quantity: 30, costPerBaseUnit: 120 })
  ];
  const result = plan([original], [{ ...original, quantity: 2, commercialQuantity: 2 }], customBatches);
  assert.deepEqual(result.finalItems[0].batchAllocations?.map(a => [a.batchId, a.baseQuantity]), [['b1', 10], ['b2', 10]]);
  assert.equal(result.batchNextQuantities.get('b1'), 20);
  assert.equal(result.batchNextQuantities.get('b2'), 20);
});

test('new tier line uses current FEFO and gets an exact historical allocation snapshot', () => {
  const incoming = stripLine({ lineId: 'new-line', batchAllocations: [], batchId: '', batchNumber: 'FEFO-PENDING', actualLineCost: 0 });
  const result = plan([], [incoming]);
  assert.deepEqual(result.finalItems[0].batchAllocations?.map(a => [a.batchId, a.baseQuantity]), [['b1', 10]]);
  assert.equal(result.finalItems[0].batchNumber, 'A');
  assert.equal(result.finalItems[0].baseQuantity, 10);
});

test('receipt revision enforces actual allocation cost after sale-level discount', () => {
  const expensive = [batch({ quantity: 20, costPerBaseUnit: 240 })];
  const incoming = stripLine({ lineId: 'new-line', batchAllocations: [], batchId: '', batchNumber: 'FEFO-PENDING', unitPrice: 2500, actualUnitPrice: 2500 });
  assert.throws(() => plan([], [incoming], expensive, 10), /sell below the actual allocated batch cost/);
});

test('an existing line cannot silently change product identity', () => {
  const p2 = product({ id: 'p2', productId: 'PRD-2', sku: 'SKU-2', name: 'Ibuprofen' });
  const productMap = new Map([['p1', product()], ['p2', p2]]);
  assert.throws(() => planSaleInventoryRevision({
    originalItems: [stripLine()],
    updatedItems: [{ ...stripLine(), productId: 'p2', productName: 'Ibuprofen', name: 'Ibuprofen' }],
    products: productMap,
    batches: [...batches, batch({ id: 'p2b', productId: 'p2', batchNumber: 'P2', quantity: 20 })],
    tenantId: 't1', branchId: 'br1', now: new Date('2026-09-08T12:00:00Z')
  }), /Changing the product identity/);
});

test('exact allocation validation catches corrupt historical quantities', () => {
  assert.throws(() => assertExactStoredAllocations(stripLine({ baseQuantity: 11 }), product()), /do not match/);
});

test('sale fingerprints change when tier, base quantity, price or batch allocations change', () => {
  const original = stripLine();
  const baseline = saleItemFingerprint([original]);
  assert.notEqual(saleItemFingerprint([{ ...original, tierMultiplier: 12 }]), baseline);
  assert.notEqual(saleItemFingerprint([{ ...original, baseQuantity: 20 }]), baseline);
  assert.notEqual(saleItemFingerprint([{ ...original, unitPrice: 2400, actualUnitPrice: 2400 }]), baseline);
  assert.notEqual(saleItemFingerprint([{ ...original, batchAllocations: [{ batchId: 'b1', batchNumber: 'A', baseQuantity: 10, costPerBaseUnit: 100 }] }]), baseline);
});
