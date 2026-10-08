import { movementEventId, consumptionSummaryId } from './pos-v2-batch4-core.mjs';
import { revisionInventoryEventId } from './pos-v2-revision-inventory-core.mjs';
import { assertRevisionCommercialEvidence } from './pos-v2-revision-commercial-evidence.mjs';

// This is a one-record migration, not a general receipt-edit bypass.
export const LEGACY_RECEIPT_REPAIR = Object.freeze({
  tenantId: 'zehqTDcKyrDAOHKK3stJ', branchId: '1agW2eYBOGGqKR9w2V31',
  originalId: 'v2sale_zehqTDcKyrDAOHKK3stJ__17c3f19b-a342-4707-8226-f0ea96215727_f1111731',
  revisionId: 'pos_revision_zehqTDcKyrDAOHKK3stJ__v2sale_zehqTDcKyrDAOHKK3stJ__17c3f19b-a342-4707-8226-f0ea96215727_f1111731__rev1_7596f8a4',
  replacementId: 'v2sale_zehqTDcKyrDAOHKK3stJ__pos_revision_attempt_zehqTDcKyrDAOHKK3stJ__v2sale_zehqTDcKyrDAOHKK3stJ__17c3f19b-a342-4707-8226-f0_bc2b7c39',
  productId: 'qzc15jCf1RuoUUK03nhR', batchId: '9MmKfhmAT0BBzSb53RB2',
  repairId: 'legacy_receipt_340820_quantity_reconciliation_v1'
});
const assert = (condition, message) => { if (!condition) throw new Error(`Legacy receipt repair refused: ${message}`); };
const number = value => Number(value);
const belongs = row => row?.tenantId === LEGACY_RECEIPT_REPAIR.tenantId && row?.branchId === LEGACY_RECEIPT_REPAIR.branchId;
const unexpired = value => {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now();
};

/** Preserve full before-images, then repair only the confirmed missing 20 commercial / 200 base units.
 * Every record and exact reversal is reread inside one transaction. Any drift aborts all writes. */
export async function reconcileLegacyReceipt({ db, FieldValue, apply = false, actor = 'legacy-receipt-reconciliation' }) {
  const scope = LEGACY_RECEIPT_REPAIR;
  const ref = (collection, id) => db.collection(collection).doc(id);
  const requestRef = ref('pos_sale_revision_requests', `pos_revision_request_${scope.revisionId}`);
  const saleRef = ref('sales', scope.replacementId);
  const auditRef = ref('sale_revisions', scope.repairId);
  return db.runTransaction(async tx => {
    const load = async target => { const snap = await tx.get(target); assert(snap.exists, `missing ${target.path}`); return snap.data(); };
    const original = await load(ref('sales', scope.originalId));
    const request = await load(requestRef);
    const sale = await load(saleRef);
    assert(belongs(original) && belongs(sale) && belongs(request), 'tenant or branch mismatch');
    assert(original.receiptNumber === 'BR-3QLNF-2026-420818' && sale.receiptNumber === 'BR-3QLNF-2026-340820', 'receipt identity drift');
    assert(number(original.totalAmount) === 5000 && original.items?.length === 1
      && original.items[0].productId === scope.productId && number(original.items[0].baseQuantity) === 100,
    'original receipt evidence changed');
    assert(request.originalSaleId === scope.originalId && request.replacementSaleId === scope.replacementId
      && request.revisionId === scope.revisionId && request.status === 'COMPLETED', 'revision identity or lifecycle drift');
    assert(sale.revisionId === scope.revisionId && sale.revisionOfSaleId === scope.originalId
      && original.supersededBySaleId === scope.replacementId, 'replacement linkage drift');
    const paymentRef = ref('pos_payments', sale.canonicalPaymentId);
    const outboxRef = ref('pos_transaction_outbox', sale.transactionOutboxEventId);
    const payment = await load(paymentRef);
    const outbox = await load(outboxRef);
    assert(belongs(payment) && belongs(outbox) && payment.saleId === scope.replacementId
      && outbox.saleId === scope.replacementId && outbox.paymentId === sale.canonicalPaymentId
      && outbox.status === 'PROCESSED', 'canonical posting chain drift');
    const existing = await tx.get(auditRef);
    if (existing.exists) {
      assert(belongs(existing.data()) && existing.data().replacementSaleId === scope.replacementId && sale.legacyReconciliationId === scope.repairId
        && request.legacyReconciliationId === scope.repairId, 'partial or conflicting repair marker');
      assertRevisionCommercialEvidence({ request, replacementSale: sale, payment });
      assert(sale.items?.length === 1 && number(sale.items[0].baseQuantity) === 300, 'replayed base quantity drift');
      return { replayed: true, receiptNumber: sale.receiptNumber, quantity: 30, total: 15000 };
    }
    const expected = request.revisedItems;
    assert(expected?.length === 1 && expected[0].productId === scope.productId && number(expected[0].quantity) === 30
      && number(expected[0].unitPrice) === 500 && number(request.revisedTotal) === 15000, 'reviewed intent drift');
    assert(sale.items?.length === 1 && number(sale.total) === 5000 && number(sale.totalAmount) === 5000
      && sale.paymentMethod === 'cash' && !sale.secondaryPaymentMethod && !sale.sourceQuotationId
      && !sale.isExceptionalConsumption && number(sale.discountPercentage || 0) === 0
      && number(sale.taxAmount || 0) === 0, 'unsupported sale or changed total');
    const item = sale.items[0];
    assert(item.productId === scope.productId && !item.isService && number(item.quantity) === 10
      && number(item.commercialQuantity) === 10 && number(item.unitPrice) === 500
      && number(item.actualUnitPrice ?? item.unitPrice) === 500 && number(item.baseQuantity) === 100
      && number(item.tierMultiplier) === 10 && item.batchAllocations?.length === 1
      && item.batchAllocations[0].batchId === scope.batchId && number(item.batchAllocations[0].baseQuantity) === 100, 'unexpected original allocation');
    assert(number(payment.amount) === 5000 && number(payment.settledAmount) === 5000
      && number(payment.outstandingAmount) === 0 && payment.components?.length === 1
      && payment.components[0].method === 'cash' && number(payment.components[0].amount) === 5000
      && number(payment.components[0].settledAmount) === 5000 && number(payment.components[0].outstandingAmount) === 0,
    'cash payment changed or was split');
    for (const key of ['welfare', 'institutionalCredit', 'quotation']) assert(outbox.consumers?.[key]?.status === 'NOT_APPLICABLE', `${key} unexpectedly applicable`);
    assert(outbox.consumers?.consumption?.status === 'COMPLETED', 'consumption not complete');
    const reversal = await load(ref('pos_payment_reversals', request.paymentReversalId));
    assert(belongs(reversal) && reversal.originalSaleId === scope.originalId
      && reversal.revisionId === scope.revisionId && number(reversal.amountDelta) === -5000, 'original payment reversal does not reconcile');
    const inventoryReversal = await load(ref('inventoryMovementEvents', revisionInventoryEventId({ originalSaleId: scope.originalId,
      productId: scope.productId, revisionId: scope.revisionId })));
    assert(belongs(inventoryReversal) && number(inventoryReversal.quantityDeltaBaseUnits) === 100
      && number(inventoryReversal.consumptionDeltaBaseUnits) === -100, 'original inventory reversal does not reconcile');
    const eventRef = ref('inventoryMovementEvents', movementEventId({ saleId: scope.replacementId, productId: scope.productId }));
    const event = await load(eventRef);
    assert(belongs(event) && event.sourceDocumentId === scope.replacementId && event.eventType === 'SALE'
      && number(event.consumptionDeltaBaseUnits) === 100 && number(event.quantityDeltaBaseUnits) === -100
      && !event.isExceptional, 'consumption event drift');
    const summaryRef = ref('branchConsumptionDaily', consumptionSummaryId(scope.tenantId, scope.branchId, scope.productId, event.dateKey));
    const summary = await load(summaryRef);
    assert(belongs(summary) && summary.productId === scope.productId && summary.dateKey === event.dateKey
      && number(summary.ordinaryUnitsSold) >= 100 && number(summary.validConsumptionUnits) >= 100, 'consumption summary drift');
    const productRef = ref('products', scope.productId);
    const product = await load(productRef);
    assert(product.tenantId === scope.tenantId, 'product tenant mismatch');
    const batches = await tx.get(db.collection('product_batches').where('productId', '==', scope.productId));
    const rows = batches.docs.filter(doc => doc.data().tenantId === scope.tenantId).map(doc => ({ ref: doc.ref, ...doc.data(), id: doc.id }));
    assert(rows.every(row => Number.isFinite(number(row.quantity)) && number(row.quantity) >= 0), 'invalid stock quantity');
    const batch = rows.find(row => row.id === scope.batchId);
    assert(belongs(batch) && batch.batch_status === 'active' && unexpired(batch.expiryDate)
      && number(batch.quantity) >= 200 && number(batch.purchasePrice) === number(item.batchAllocations[0].costPerBaseUnit)
      && number(batch.purchasePrice) <= 50, 'batch unavailable, changed cost, or insufficient stock');
    // Refuse if current FEFO could select a different batch. This repair is deliberately narrow.
    assert(!rows.some(row => belongs(row) && row.id !== batch.id && row.batch_status === 'active'
      && unexpired(row.expiryDate) && number(row.quantity) > 0), 'multiple usable batches require canonical reallocation');
    const aggregate = rows.reduce((sum, row) => sum + number(row.quantity), 0);
    assert(number(product.stock) === aggregate && number(product.quantityInStock) === aggregate, 'product aggregate already inconsistent');
    const cost = number(item.actualLineCost ?? number(item.batchAllocations[0].costPerBaseUnit) * 100) + number(batch.purchasePrice) * 200;
    const correctedItem = { ...item, quantity: 30, commercialQuantity: 30, baseQuantity: 300,
      subtotal: 15000, total: 15000, lineTotal: 15000, actualLineCost: cost, costPrice: cost / 30,
      batchAllocations: [{ ...item.batchAllocations[0], baseQuantity: 300 }] };
    const correctedSale = { ...sale, items: [correctedItem], subtotal: 15000, total: 15000, totalAmount: 15000, actualSaleCost: cost };
    const correctedPayment = { ...payment, amount: 15000, settledAmount: 15000,
      components: [{ ...payment.components[0], amount: 15000, settledAmount: 15000 }] };
    assertRevisionCommercialEvidence({ request, replacementSale: correctedSale, payment: correctedPayment });
    const plan = { receiptNumber: sale.receiptNumber, quantityBefore: 10, quantityAfter: 30,
      totalBefore: 5000, totalAfter: 15000, additionalBaseUnits: 200, batchBefore: number(batch.quantity),
      batchAfter: number(batch.quantity) - 200, aggregateBefore: aggregate, aggregateAfter: aggregate - 200 };
    if (!apply) return { dryRun: true, ...plan };
    const timestamp = FieldValue.serverTimestamp();
    const marker = { legacyReconciliationId: scope.repairId, legacyReconciledAt: timestamp, updatedAt: timestamp };
    tx.create(auditRef, { tenantId: scope.tenantId, branchId: scope.branchId, repairId: scope.repairId,
      kind: 'LEGACY_REPLACEMENT_RECONCILIATION', status: 'COMPLETED', originalSaleId: scope.originalId,
      replacementSaleId: scope.replacementId, revisionId: scope.revisionId, actor,
      reason: 'Reconcile the reviewed 30-unit revision after stale hidden checkout fields created only 10 units.',
      plan, before: { sale, payment, outbox, event, summary, product, batch: { id: batch.id, quantity: batch.quantity } }, createdAt: timestamp });
    tx.update(saleRef, { items: correctedSale.items, subtotal: 15000, total: 15000, totalAmount: 15000, actualSaleCost: cost, ...marker });
    tx.update(paymentRef, { amount: 15000, settledAmount: 15000, components: correctedPayment.components, ...marker });
    tx.update(batch.ref, { quantity: number(batch.quantity) - 200, lastUpdated: new Date().toISOString(), ...marker });
    tx.update(productRef, { stock: aggregate - 200, quantityInStock: aggregate - 200, ...marker });
    tx.update(eventRef, { quantityDeltaBaseUnits: -300, consumptionDeltaBaseUnits: 300, ...marker });
    tx.update(summaryRef, { ordinaryUnitsSold: number(summary.ordinaryUnitsSold) + 200,
      validConsumptionUnits: number(summary.validConsumptionUnits) + 200,
      closingUsableStock: number(batch.quantity) - 200, aggregationVersion: number(summary.aggregationVersion || 0) + 1, ...marker });
    tx.update(outboxRef, marker);
    tx.update(requestRef, { ...marker, requiresManualReview: false, lastError: null });
    tx.create(ref('audit_logs', scope.repairId), { tenantId: scope.tenantId, branchId: scope.branchId,
      action: 'LEGACY_RECEIPT_RECONCILED', actor, targetId: scope.replacementId, details: plan,
      timestamp: new Date().toISOString(), createdAt: timestamp });
    return { repaired: true, ...plan };
  });
}
