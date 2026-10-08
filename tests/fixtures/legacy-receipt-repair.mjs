import { LEGACY_RECEIPT_REPAIR as s } from '../../scripts/pos-v2-legacy-receipt-repair-core.mjs';
import { movementEventId, consumptionSummaryId } from '../../scripts/pos-v2-batch4-core.mjs';
import { revisionInventoryEventId } from '../../scripts/pos-v2-revision-inventory-core.mjs';
export function legacyRepairFixture() {
  const scope = { tenantId: s.tenantId, branchId: s.branchId };
  const item = { productId: s.productId, quantity: 10, commercialQuantity: 10, unitPrice: 500,
    baseQuantity: 100, tierMultiplier: 10, total: 5000, lineTotal: 5000,
    batchAllocations: [{ batchId: s.batchId, baseQuantity: 100, costPerBaseUnit: 30 }] };
  const reviewed = { ...item, quantity: 30 };
  const requestId = `pos_revision_request_${s.revisionId}`;
  const eventId = movementEventId({ saleId: s.replacementId, productId: s.productId });
  const summaryId = consumptionSummaryId(s.tenantId, s.branchId, s.productId, '2026-10-07');
  return new Map([
    [`sales/${s.originalId}`, { ...scope, receiptNumber: 'BR-3QLNF-2026-420818', total: 5000, totalAmount: 5000,
      items: [item], supersededBySaleId: s.replacementId }],
    [`sales/${s.replacementId}`, { ...scope, receiptNumber: 'BR-3QLNF-2026-340820', items: [item], total: 5000, totalAmount: 5000,
      paymentMethod: 'cash', canonicalPaymentId: 'repair-payment', transactionOutboxEventId: 'repair-outbox',
      revisionId: s.revisionId, revisionOfSaleId: s.originalId, actualSaleCost: 3000 }],
    [`pos_sale_revision_requests/${requestId}`, { ...scope, status: 'COMPLETED', originalSaleId: s.originalId,
      replacementSaleId: s.replacementId, revisionId: s.revisionId, revisedItems: [reviewed], revisedTotal: 15000,
      paymentReversalId: 'repair-payment-reversal' }],
    ['pos_payments/repair-payment', { ...scope, saleId: s.replacementId, amount: 5000, settledAmount: 5000, outstandingAmount: 0,
      components: [{ method: 'cash', amount: 5000, settledAmount: 5000, outstandingAmount: 0, status: 'settled' }] }],
    ['pos_transaction_outbox/repair-outbox', { ...scope, saleId: s.replacementId, paymentId: 'repair-payment', status: 'PROCESSED',
      consumers: { consumption: { status: 'COMPLETED' }, welfare: { status: 'NOT_APPLICABLE' }, institutionalCredit: { status: 'NOT_APPLICABLE' }, quotation: { status: 'NOT_APPLICABLE' } } }],
    ['pos_payment_reversals/repair-payment-reversal', { ...scope, originalSaleId: s.originalId, revisionId: s.revisionId, amountDelta: -5000 }],
    [`inventoryMovementEvents/${revisionInventoryEventId({ originalSaleId: s.originalId, productId: s.productId, revisionId: s.revisionId })}`,
      { ...scope, quantityDeltaBaseUnits: 100, consumptionDeltaBaseUnits: -100 }],
    [`inventoryMovementEvents/${eventId}`, { ...scope, sourceDocumentId: s.replacementId, eventType: 'SALE',
      consumptionDeltaBaseUnits: 100, quantityDeltaBaseUnits: -100, dateKey: '2026-10-07' }],
    [`branchConsumptionDaily/${summaryId}`, { ...scope, productId: s.productId, dateKey: '2026-10-07',
      ordinaryUnitsSold: 270, validConsumptionUnits: 270, closingUsableStock: 730, transactionCount: 3, consumptionTransactionCount: 3 }],
    [`products/${s.productId}`, { tenantId: s.tenantId, stock: 730, quantityInStock: 730 }],
    [`product_batches/${s.batchId}`, { ...scope, productId: s.productId, batch_status: 'active', expiryDate: '2030-12-31', purchasePrice: 30, quantity: 730 }]
  ]);
}
