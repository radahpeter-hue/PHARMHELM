import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePosV2RevisionDraftLine } from '../src/services/pos-v2/posSaleRevisionV2DraftLines';
import { addPosV2RevisionService } from '../src/services/pos-v2/posSaleRevisionV2Services';
import { isActiveSale } from '../src/utils/activeSales';

test('changing a tier quantity updates all canonical quantity and money fields', () => {
  const original: any = { productId: 'drug', quantity: 10, commercialQuantity: 10, tierCode: 'STRIP', tierMultiplier: 10,
    baseQuantity: 100, unitPrice: 500, actualUnitPrice: 500, subtotal: 5000, total: 5000, lineTotal: 5000 };
  const revised = updatePosV2RevisionDraftLine(original, 30);
  assert.equal(revised.quantity, 30); assert.equal(revised.commercialQuantity, 30); assert.equal(revised.baseQuantity, 300);
  assert.equal(revised.lineTotal, 15000); assert.equal(revised.subtotal, 15000); assert.equal(revised.total, 15000);
  assert.equal(original.baseQuantity, 100); assert.equal(original.lineTotal, 5000);
});

test('price correction updates the authoritative line total used by checkout', () => {
  const revised = updatePosV2RevisionDraftLine({ quantity: 3, unitPrice: 500, lineTotal: 1500 } as any, 3, 800);
  assert.equal(revised.actualUnitPrice, 800); assert.equal(revised.lineTotal, 2400);
});

test('service addition uses the POS service fee, merges quantity, and has no batch allocations', () => {
  const service: any = { id: 'consultation', tenantId: 'tenant-a', name: 'Consultation', defaultFee: 2000 };
  const first = addPosV2RevisionService([], service, 'tenant-a');
  const second = addPosV2RevisionService(first, service, 'tenant-a');
  assert.equal(second.length, 1); assert.equal(second[0].isService, true); assert.equal(second[0].quantity, 2);
  assert.equal(second[0].commercialQuantity, 2); assert.equal(second[0].lineTotal, 4000);
  assert.equal(second[0].batchAllocations, undefined); assert.equal(second[0].baseQuantity, undefined);
  assert.throws(() => addPosV2RevisionService([], service, 'tenant-b'), /tenant/);
});

test('financial totals include corrected receipts once and exclude superseded originals', () => {
  const sales = [{ status: 'completed', total: 5000, supersededBySaleId: 'corrected', revisionLifecycle: 'COMPLETED' },
    { status: 'completed', total: 15000, revisionLifecycle: 'COMPLETED', isRevisionReplacement: true, revisionOfSaleId: 'original' },
    { status: 'voided', total: 9000 }];
  assert.equal(sales.filter(isActiveSale).reduce((sum, sale) => sum + sale.total, 0), 15000);
});
