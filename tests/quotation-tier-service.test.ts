import test from 'node:test';
import assert from 'node:assert/strict';
import type { Product, ProductBatch, SaleItem } from '../src/types';
import {
  buildQuotationLineSnapshot,
  buildResumedQuotationProductLine,
  buildResumedServiceLine,
  getCombinedQuotationStockWarnings,
  quotationQuantityText
} from '../src/services/quotationTierService';
import { resizeCommercialCartLine, repriceQuotationCartLine } from '../src/services/posTierCartService';

const settings = { features: { multiTierSellingEnabled: true } };
const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1', tenantId: 't1', productId: 'PRD-1', sku: 'SKU-1', name: 'Panadol', category: 'drug/medicine',
  costPricePerPack: 10000, sellingPricePerUnit: 300, taxExempt: true, taxRate: 0,
  unitsPerPack: 100, unitsPerStrip: 10, unit: 'tablet', baseUnit: 'tablet', dosageForm: 'Tablet', unitOfSell: 'unit',
  sellingTiers: {
    unit: { enabled: true, price: 300 },
    strip: { enabled: true, price: 2500 },
    pack: { enabled: true, price: 22000 }
  },
  defaultSellingTierCode: 'strip',
  ...overrides
});
const batch = (overrides: Partial<ProductBatch> = {}): ProductBatch => ({
  id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', quantity: 100,
  expiryDate: '2027-01-31', batchNumber: 'A', purchasePrice: 100, sellingPrice: 300, batch_status: 'active', ...overrides
});

const tierItem = (overrides: Partial<SaleItem> = {}): SaleItem => ({
  lineId: 'line-1', productId: 'p1', tenantId: 't1', branchId: 'br1', batchId: '', name: 'Panadol', productName: 'Panadol',
  quantity: 2, commercialQuantity: 2, unitPrice: 2500, actualUnitPrice: 2500, configuredPrice: 2500,
  total: 5000, subtotal: 5000, lineTotal: 5000, isService: false,
  tierCode: 'strip', tierLabel: 'Strip', tierMultiplier: 10, baseQuantity: 20,
  dosageFormSnapshot: 'Tablet', priceSource: 'configured-tier', discountStatus: 'none', taxStatus: 'Zero Rated',
  batchNumber: 'FEFO-PENDING', ...overrides
});

test('quotation snapshot preserves full commercial tier meaning', () => {
  const snapshot = buildQuotationLineSnapshot(tierItem());
  assert.equal(snapshot.lineId, 'line-1');
  assert.equal(snapshot.tierCode, 'strip');
  assert.equal(snapshot.tierMultiplier, 10);
  assert.equal(snapshot.commercialQuantity, 2);
  assert.equal(snapshot.baseQuantity, 20);
  assert.equal(snapshot.configuredPrice, 2500);
  assert.equal(snapshot.actualUnitPrice, 2500);
  assert.equal(snapshot.lineTotal, 5000);
  assert.equal(quotationQuantityText(snapshot), '2 Strips (20 base units)');
  assert.equal(Object.values(snapshot).some(value => value === undefined), false, 'Firestore quotation snapshots must not contain undefined fields');
});

test('resuming unchanged tier quotation preserves quoted tier and quantity', () => {
  const line = buildQuotationLineSnapshot(tierItem());
  const result = buildResumedQuotationProductLine({
    line, product: product(), batches: [batch()], settings, tenantId: 't1', branchId: 'br1'
  });
  assert.equal(result.blocking, false);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.item?.tierCode, 'strip');
  assert.equal(result.item?.tierMultiplier, 10);
  assert.equal(result.item?.commercialQuantity, 2);
  assert.equal(result.item?.baseQuantity, 20);
  assert.equal(result.item?.unitPrice, 2500);
});

test('price change warns but retains quotation price as explicit override after resume', () => {
  const line = buildQuotationLineSnapshot(tierItem());
  const live = product({ sellingTiers: { ...product().sellingTiers, strip: { enabled: true, price: 2700 } } });
  const result = buildResumedQuotationProductLine({ line, product: live, batches: [batch()], settings, tenantId: 't1', branchId: 'br1' });
  assert.equal(result.blocking, false);
  assert.ok(result.warnings.some(warning => warning.includes('changed from UGX 2,500 to UGX 2,700')));
  assert.equal(result.item?.configuredPrice, 2700);
  assert.equal(result.item?.actualUnitPrice, 2500);
  assert.equal(result.item?.priceSource, 'manual-override');
});

test('changed strip multiplier blocks quotation resume rather than changing commercial meaning', () => {
  const line = buildQuotationLineSnapshot(tierItem());
  const result = buildResumedQuotationProductLine({
    line, product: product({ unitsPerStrip: 12 }), batches: [batch()], settings, tenantId: 't1', branchId: 'br1'
  });
  assert.equal(result.blocking, true);
  assert.equal(result.item, null);
  assert.ok(result.warnings.some(warning => warning.includes('packaging changed')));
});

test('insufficient aggregate base stock blocks resumed tier line', () => {
  const line = buildQuotationLineSnapshot(tierItem());
  const result = buildResumedQuotationProductLine({
    line, product: product(), batches: [batch({ quantity: 19 })], settings, tenantId: 't1', branchId: 'br1'
  });
  assert.equal(result.blocking, true);
  assert.equal(result.item, null);
});

test('service quotation lines resume without inventory lookup', () => {
  const service = buildQuotationLineSnapshot({
    productId: 'svc1', batchId: '', name: 'Consultation', productName: 'Consultation', quantity: 1, unitPrice: 5000,
    total: 5000, subtotal: 5000, isService: true
  } as SaleItem);
  const resumed = buildResumedServiceLine(service);
  assert.equal(resumed.isService, true);
  assert.equal(resumed.productId, 'svc1');
  assert.equal(resumed.total, 5000);
});

test('combined demand across two quotation lines blocks resume when total exceeds branch stock', () => {
  const stock = [batch({ quantity: 109 })];
  const strip = buildResumedQuotationProductLine({ line: buildQuotationLineSnapshot(tierItem({ quantity: 1, commercialQuantity: 1, baseQuantity: 10, total: 2500, subtotal: 2500, lineTotal: 2500 })), product: product(), batches: stock, settings, tenantId: 't1', branchId: 'br1' });
  const pack = buildResumedQuotationProductLine({ line: buildQuotationLineSnapshot(tierItem({ lineId: 'line-2', tierCode: 'pack', tierLabel: 'Pack', tierMultiplier: 100, quantity: 1, commercialQuantity: 1, baseQuantity: 100, unitPrice: 22000, actualUnitPrice: 22000, configuredPrice: 22000, total: 22000, subtotal: 22000, lineTotal: 22000 })), product: product(), batches: stock, settings, tenantId: 't1', branchId: 'br1' });
  assert.equal(strip.blocking, false);
  assert.equal(pack.blocking, false);
  assert.match(getCombinedQuotationStockWarnings([strip.item!, pack.item!], stock)[0], /Combined quotation demand.*110 base units.*109/);
});

test('resumed quotation quantity and price edits keep commercial snapshot totals aligned', () => {
  const line = buildResumedQuotationProductLine({ line: buildQuotationLineSnapshot(tierItem()), product: product(), batches: [batch()], settings, tenantId: 't1', branchId: 'br1' }).item!;
  const resized = resizeCommercialCartLine(line, 3);
  assert.equal(resized.commercialQuantity, 3);
  assert.equal(resized.baseQuantity, 30);
  assert.equal(resized.lineTotal, 7500);
  const repriced = repriceQuotationCartLine(resized, 2400);
  assert.equal(repriced.actualUnitPrice, 2400);
  assert.equal(repriced.priceSource, 'manual-override');
  assert.equal(repriced.lineTotal, 7200);
  const saved = buildQuotationLineSnapshot(repriced);
  assert.equal(saved.commercialQuantity, 3);
  assert.equal(saved.baseQuantity, 30);
  assert.equal(saved.actualUnitPrice, 2400);
  assert.equal(saved.lineTotal, 7200);
});

test('legacy quotation resume checks base-unit stock using the live legacy multiplier', () => {
  const legacyProduct = product({ sellingTiers: undefined, defaultSellingTierCode: undefined, unitOfSell: 'strip' });
  const line = buildQuotationLineSnapshot({ ...tierItem(), tierCode: undefined, tierLabel: undefined, tierMultiplier: undefined, baseQuantity: undefined } as SaleItem);
  const result = buildResumedQuotationProductLine({
    line, product: legacyProduct, batches: [batch({ quantity: 19 })], settings: { features: { multiTierSellingEnabled: false } }, tenantId: 't1', branchId: 'br1'
  });
  assert.equal(result.blocking, true);
  assert.ok(result.warnings.some(warning => warning.includes('Requested: 20')));
});
