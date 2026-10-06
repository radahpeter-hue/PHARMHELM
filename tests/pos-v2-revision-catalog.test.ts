import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPosV2RevisionCatalogLine,
  getPosV2RevisionCatalogOptions
} from '../src/services/pos-v2/posSaleRevisionV2Catalog';

const settings = {
  features: { multiTierSellingEnabled: true }
} as any;

const product = {
  id: 'prod-a',
  name: 'Medicine A',
  genericName: 'Generic A',
  dosageForm: 'tablet',
  unit: 'unit',
  unitOfSell: 'unit',
  unitsPerStrip: 10,
  unitsPerPack: 100,
  sellingTiers: {
    unit: { enabled: true, price: 1000 },
    strip: { enabled: true, price: 9000 },
    pack: { enabled: true, price: 80000 }
  },
  defaultSellingTierCode: 'strip',
  vatClassification: 'exempt'
} as any;

const batches = [
  {
    id: 'batch-1',
    tenantId: 'tenant-a',
    branchId: 'branch-a',
    productId: 'prod-a',
    batchNumber: 'A-1',
    batch_status: 'active',
    expiryDate: '2027-12-31',
    quantity: 120,
    purchasePrice: 400,
    sellingPrice: 1000
  },
  {
    id: 'batch-other-branch',
    tenantId: 'tenant-a',
    branchId: 'branch-b',
    productId: 'prod-a',
    batchNumber: 'A-OTHER',
    batch_status: 'active',
    expiryDate: '2027-12-31',
    quantity: 1000,
    purchasePrice: 400,
    sellingPrice: 1000
  }
] as any[];

test('revision catalog exposes the same configured selling tiers and default as POS', () => {
  const options = getPosV2RevisionCatalogOptions(product, settings);
  assert.deepEqual(options.map(option => option.code), ['unit', 'strip', 'pack']);
  assert.equal(options.find(option => option.code === 'strip')?.isDefault, true);
  assert.equal(options.find(option => option.code === 'strip')?.multiplier, 10);
  assert.equal(options.find(option => option.code === 'strip')?.configuredPrice, 9000);
});

test('revision catalog builds a multi-tier line through the canonical POS tier snapshot helper', () => {
  const line = buildPosV2RevisionCatalogLine({
    product,
    batches: batches as any,
    systemSettings: settings,
    tenantId: 'tenant-a',
    branchId: 'branch-a',
    existingItems: [],
    requestedTierCode: 'strip'
  });

  assert.equal(line.productId, 'prod-a');
  assert.equal(line.tenantId, 'tenant-a');
  assert.equal(line.branchId, 'branch-a');
  assert.equal(line.tierCode, 'strip');
  assert.equal(line.tierMultiplier, 10);
  assert.equal(line.commercialQuantity, 1);
  assert.equal(line.baseQuantity, 10);
  assert.equal(line.unitPrice, 9000);
  assert.equal(line.batchNumber, 'FEFO-PENDING');
});

test('revision catalog scopes live stock to the current tenant and branch and respects already reserved draft stock', () => {
  const reserved = [{
    productId: 'prod-a',
    tierCode: 'pack',
    tierMultiplier: 100,
    commercialQuantity: 1,
    quantity: 1,
    baseQuantity: 100,
    isService: false
  }] as any[];

  assert.throws(() => buildPosV2RevisionCatalogLine({
    product,
    batches: batches as any,
    systemSettings: settings,
    tenantId: 'tenant-a',
    branchId: 'branch-a',
    existingItems: reserved,
    requestedTierCode: 'pack'
  }), /Insufficient stock/);
});

test('legacy product addition preserves the established branch batch and legacy price semantics', () => {
  const legacyProduct = {
    id: 'legacy-a',
    name: 'Legacy Medicine',
    genericName: 'Legacy Generic',
    dosageForm: 'syrup',
    unit: 'bottle',
    unitOfSell: 'unit',
    sellingPricePerUnit: 5000
  } as any;
  const legacyBatches = [{
    id: 'legacy-batch',
    tenantId: 'tenant-a',
    branchId: 'branch-a',
    productId: 'legacy-a',
    batchNumber: 'L-1',
    batch_status: 'active',
    expiryDate: '2027-12-31',
    quantity: 5,
    purchasePrice: 3000,
    sellingPrice: 5000
  }] as any[];

  const line = buildPosV2RevisionCatalogLine({
    product: legacyProduct,
    batches: legacyBatches as any,
    systemSettings: settings,
    tenantId: 'tenant-a',
    branchId: 'branch-a',
    existingItems: []
  });

  assert.equal(line.batchId, 'legacy-batch');
  assert.equal(line.batchNumber, 'L-1');
  assert.equal(line.unitPrice, 5000);
  assert.equal(line.quantity, 1);
});

test('revision catalog adapter remains pure and cannot write Firestore or execute checkout', () => {
  const source = readFileSync('src/services/pos-v2/posSaleRevisionV2Catalog.ts', 'utf8');
  assert.match(source, /resolveSellingTiers/);
  assert.match(source, /buildTierCartItem/);
  assert.match(source, /getProductEligibleBatches/);
  assert.doesNotMatch(source, /firestoreService|setDoc|updateDoc|deleteDoc|addDoc/);
  assert.doesNotMatch(source, /executeCheckoutV2|reviseSaleInventoryAtomically|voidSaleInventoryAtomically/);
});
