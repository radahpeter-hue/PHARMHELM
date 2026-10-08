// Read-only diagnosis of the specific legacy receipt reported by the operator.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { reconcileLegacyReceipt } from './pos-v2-legacy-receipt-repair-core.mjs';
const app = initializeApp({ credential: applicationDefault(), projectId: 'gen-lang-client-0911422817' });
const db = getFirestore(app, 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75');
const originalId = 'v2sale_zehqTDcKyrDAOHKK3stJ__17c3f19b-a342-4707-8226-f0ea96215727_f1111731';
const revisionId = `pos_revision_zehqTDcKyrDAOHKK3stJ__${originalId}__rev1_7596f8a4`;
const requestId = `pos_revision_request_${revisionId}`;
async function read(collection, id) {
  if (!id) return null;
  const snap = await db.collection(collection).doc(id).get();
  return snap.exists ? { ...snap.data(), id: snap.id } : null;
}
const lines = items => (items || []).map(item => Object.fromEntries([
  'productId', 'quantity', 'commercialQuantity', 'unitPrice', 'actualUnitPrice',
  'baseQuantity', 'tierCode', 'tierMultiplier', 'total', 'lineTotal', 'batchId', 'batchAllocations', 'isService'
].filter(key => item[key] !== undefined).map(key => [key, item[key]])));
const saleView = sale => sale && ({ id: sale.id, tenantId: sale.tenantId, branchId: sale.branchId,
  receiptNumber: sale.receiptNumber, total: sale.total, totalAmount: sale.totalAmount,
  items: lines(sale.items), canonicalPaymentId: sale.canonicalPaymentId,
  transactionOutboxEventId: sale.transactionOutboxEventId, revisionLifecycle: sale.revisionLifecycle });
const request = await read('pos_sale_revision_requests', requestId);
const original = await read('sales', originalId);
if (!request || !original || original.receiptNumber !== 'BR-3QLNF-2026-420818'
  || request.originalSaleId !== originalId || request.tenantId !== original.tenantId
  || request.branchId !== original.branchId) throw new Error('Scoped legacy receipt identity mismatch.');
const replacement = await read('sales', request.replacementSaleId || request.pendingReplacementSaleId);
if (!replacement || replacement.receiptNumber !== 'BR-3QLNF-2026-340820'
  || replacement.tenantId !== original.tenantId || replacement.branchId !== original.branchId
  || replacement.revisionId !== revisionId) throw new Error('Scoped replacement identity mismatch.');
const payment = await read('pos_payments', replacement.canonicalPaymentId);
const outbox = await read('pos_transaction_outbox', replacement.transactionOutboxEventId);
const reversal = await read('pos_payment_reversals', request.paymentReversalId);
const movements = await db.collection('inventoryMovementEvents').where('tenantId', '==', original.tenantId)
  .where('sourceDocumentId', '==', replacement.id).get();
console.log(JSON.stringify({ mode: 'READ_ONLY_LEGACY_RECEIPT_AUDIT', requestId,
  request: { status: request.status, revisedTotal: request.revisedTotal, originalTotal: request.originalTotal,
    revisedItems: lines(request.revisedItems), seedItems: lines(request.envelope?.replacementSaleSeed?.items),
    reversalConsumers: request.reversalConsumers, paymentReversalId: request.paymentReversalId },
  original: saleView(original), replacement: saleView(replacement),
  payment: payment && { amount: payment.amount, saleId: payment.saleId, components: payment.components },
  reversal: reversal && { amountDelta: reversal.amountDelta, originalSaleId: reversal.originalSaleId },
  outbox: outbox && { status: outbox.status, consumers: outbox.consumers },
  movements: movements.docs.map(doc => { const row = doc.data(); return { id: doc.id,
    productId: row.productId, branchId: row.branchId, consumptionDeltaBaseUnits: row.consumptionDeltaBaseUnits,
    dateKey: row.dateKey, eventType: row.eventType }; })
}, null, 2));
console.log(JSON.stringify(await reconcileLegacyReceipt({ db, FieldValue, apply: false }), null, 2));
