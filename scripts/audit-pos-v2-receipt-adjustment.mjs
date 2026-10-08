// Read-only audit of the operator-confirmed correction. No write APIs are used.
import assert from 'node:assert/strict';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { movementEventId, consumptionSummaryId } from './pos-v2-batch4-core.mjs';
import { revisionInventoryEventId } from './pos-v2-revision-inventory-core.mjs';
import { assertRevisionCommercialEvidence } from './pos-v2-revision-commercial-evidence.mjs';
const tenantId = 'zehqTDcKyrDAOHKK3stJ', branchId = '1agW2eYBOGGqKR9w2V31';
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'gen-lang-client-0911422817' }),
  'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75');
const scoped = row => row && row.tenantId === tenantId && row.branchId === branchId;
async function optional(collection, id) {
  const doc = await db.collection(collection).doc(id).get();
  return doc.exists ? { ...doc.data(), id: doc.id } : null;
}
async function read(collection, id) {
  assert.ok(id, collection + ' identity missing');
  const doc = await db.collection(collection).doc(id).get();
  assert.ok(doc.exists, collection + ' record missing');
  return { ...doc.data(), id: doc.id };
}
async function receipt(number) {
  const result = await db.collection('sales').where('receiptNumber', '==', number).get();
  const rows = result.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(scoped);
  assert.equal(rows.length, 1, 'Scoped receipt must be unique');
  return rows[0];
}
const original = await receipt('BR-3QLNF-2026-153469');
const corrected = await receipt('BR-3QLNF-2026-838292');
assert.equal(original.supersededBySaleId, corrected.id);
assert.equal(corrected.revisionOfSaleId, original.id);
assert.equal(original.revisionLifecycle, 'COMPLETED');
assert.equal(corrected.revisionLifecycle, 'COMPLETED');
const request = await read('pos_sale_revision_requests', corrected.revisionRequestId);
assert.ok(scoped(request)); assert.equal(request.status, 'COMPLETED');
assert.equal(request.originalSaleId, original.id); assert.equal(request.replacementSaleId, corrected.id);
assert.equal(request.executionMode, 'SPARK_ATOMIC');
const originalPayment = await read('pos_payments', original.canonicalPaymentId);
const payment = await read('pos_payments', corrected.canonicalPaymentId);
const reversal = await read('pos_payment_reversals', request.paymentReversalId);
assert.ok(scoped(originalPayment)); assert.ok(scoped(payment)); assert.ok(scoped(reversal));
assert.equal(payment.saleId, corrected.id); assert.equal(reversal.originalSaleId, original.id);
assert.equal(Number(reversal.amountDelta), -Number(originalPayment.amount));
assertRevisionCommercialEvidence({ request, replacementSale: corrected, payment });
assert.equal(Number(original.total), 1500); assert.equal(Number(corrected.total), 2250);
assert.equal(original.items.length, 1); assert.equal(corrected.items.length, 1);
assert.equal(Number(original.items[0].quantity), 30); assert.equal(Number(corrected.items[0].quantity), 45);
assert.equal(original.items[0].productId, corrected.items[0].productId);
const productId = corrected.items[0].productId;
const oldMovement = await optional('inventoryMovementEvents', movementEventId({ saleId: original.id, productId }));
const restoration = await optional('inventoryMovementEvents', revisionInventoryEventId({
 originalSaleId: original.id, revisionId: corrected.revisionId, productId }));
const newMovement = await read('inventoryMovementEvents', movementEventId({ saleId: corrected.id, productId }));
assert.ok(scoped(newMovement));
if (oldMovement) {
 assert.ok(scoped(oldMovement)); assert.ok(scoped(restoration));
 assert.equal(Number(restoration.quantityDeltaBaseUnits), -Number(oldMovement.quantityDeltaBaseUnits));
 assert.equal(Number(restoration.consumptionDeltaBaseUnits), -Number(oldMovement.consumptionDeltaBaseUnits));
} else {
 // Spark can correct an original whose background consumption was never posted.
 // Physical stock is restored from its immutable batch allocations; no phantom reversal is posted.
 assert.equal(restoration, null);
}
assert.equal(Number(newMovement.consumptionDeltaBaseUnits), Number(corrected.items[0].baseQuantity));
assert.equal(Number(newMovement.quantityDeltaBaseUnits), -Number(corrected.items[0].baseQuantity));
if (oldMovement) assert.equal(newMovement.dateKey, oldMovement.dateKey);
assert.equal(corrected.timestamp, original.timestamp);
const summary = await read('branchConsumptionDaily', consumptionSummaryId(tenantId, branchId, productId, newMovement.dateKey));
assert.ok(scoped(summary));
const dailyEvents = (await db.collection('inventoryMovementEvents').where('dateKey', '==', newMovement.dateKey).get())
 .docs.map(doc => doc.data()).filter(row => scoped(row) && row.productId === productId);
const ordinaryUnits = dailyEvents.filter(row => !row.isExceptional)
 .reduce((total, row) => total + Number(row.consumptionDeltaBaseUnits || 0), 0);
assert.equal(Number(summary.validConsumptionUnits), ordinaryUnits);
assert.equal(Number(summary.ordinaryUnitsSold), ordinaryUnits);
const product = await read('products', productId); assert.equal(product.tenantId, tenantId);
const batches = (await db.collection('product_batches').where('productId', '==', productId).get())
 .docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(row => row.tenantId === tenantId);
assert.ok(batches.length > 0);
const stock = batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
assert.equal(Number(product.stock), stock);
if (product.quantityInStock !== undefined) assert.equal(Number(product.quantityInStock), stock);
for (const allocation of corrected.items[0].batchAllocations || []) {
 const batch = batches.find(row => row.id === allocation.batchId);
 assert.ok(batch && batch.branchId === branchId); assert.ok(Number(batch.quantity) >= 0);
}
const originalOutbox = await read('pos_transaction_outbox', original.transactionOutboxEventId);
const outbox = await read('pos_transaction_outbox', corrected.transactionOutboxEventId);
assert.ok(scoped(originalOutbox)); assert.ok(scoped(outbox));
assert.equal(originalOutbox.status, 'SUPERSEDED'); assert.equal(outbox.status, 'PROCESSED');
for (const consumer of Object.values(outbox.consumers || {}))
 assert.ok(['COMPLETED', 'NOT_APPLICABLE'].includes(consumer.status));
const revision = await read('sale_revisions', corrected.revisionId); assert.ok(scoped(revision));
const total = row => Number(row.totalAmount ?? row.total ?? 0);
console.log(JSON.stringify({
 mode: 'READ_ONLY_RECEIPT_MODULE_AUDIT', originalReceipt: original.receiptNumber,
 correctedReceipt: corrected.receiptNumber, status: 'PASS',
 original: { quantity: original.items[0].quantity, total: total(original), baseQuantity: original.items[0].baseQuantity },
 corrected: { quantity: corrected.items[0].quantity, total: total(corrected), baseQuantity: corrected.items[0].baseQuantity },
 finance: { originalPayment: originalPayment.amount, reversal: reversal.amountDelta, replacementPayment: payment.amount,
 netReceiptRevenue: Number(originalPayment.amount) + Number(reversal.amountDelta) + Number(payment.amount),
 revenueChange: total(corrected) - total(original), actualCost: corrected.actualSaleCost, grossProfit: total(corrected) - Number(corrected.actualSaleCost) },
 inventory: { originalConsumption: oldMovement?.consumptionDeltaBaseUnits ?? null, restoredConsumption: restoration?.consumptionDeltaBaseUnits ?? null,
 originalConsumptionPreviouslyPosted: Boolean(oldMovement),
 replacementConsumption: newMovement.consumptionDeltaBaseUnits,
 additionalBaseUnitsConsumed: Number(corrected.items[0].baseQuantity) - Number(original.items[0].baseQuantity),
 globalStock: stock, branchStock: batches.filter(row => row.branchId === branchId).reduce((sum,row) => sum + Number(row.quantity),0),
 dailyConsumption: ordinaryUnits, dailySummary: summary.validConsumptionUnits },
 reporting: { activeReceiptValue: total(corrected), activeReceiptCount: 1, originalExcluded: true,
 businessTimestampPreserved: true },
 posting: { originalOutbox: originalOutbox.status, replacementOutbox: outbox.status, consumers: outbox.consumers,
 immutableRevisionRecorded: true },
 checks: ['receipt linkage', 'reviewed commercial intent', 'payment reversal', 'cash posting', 'inventory restoration',
 'replacement consumption', 'batch/global stock agreement', 'daily consumption summary', 'original business period',
 'completed applicable consumers', 'immutable revision audit']
}, null, 2));
