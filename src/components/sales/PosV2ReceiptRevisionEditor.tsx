import React, { useMemo, useState } from 'react';
import { Minus, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { BillableService, Product, ProductBatch, Sale, SaleItem, SystemSettings } from '../../types';
import { updatePosV2RevisionDraftLine } from '../../services/pos-v2/posSaleRevisionV2DraftLines';
import { addPosV2RevisionService } from '../../services/pos-v2/posSaleRevisionV2Services';
import { assertRevisionReason } from '../../services/pos-v2/posSaleRevisionV2Policy';
import { PosV2ReceiptRevisionCatalogPicker } from './PosV2ReceiptRevisionCatalogPicker';
import { PosV2RevisionReferenceSelector } from './PosV2RevisionReferenceSelector';
import {
  revisionInstitutionSelection,
  revisionPatientSelection,
  revisionPrescriberSelection,
  type PosV2RevisionReferenceOption
} from '../../services/pos-v2/posSaleRevisionV2ReferenceData';
import { validateSaleCheckoutContext } from '../../utils/saleContextValidation';
import {
  normalizePosPaymentMethod,
  POS_CANONICAL_PAYMENT_METHODS
} from '../../utils/posPaymentMethods';

export interface PosV2ReceiptRevisionDraft {
  items: SaleItem[];
  paymentMethod: string;
  context: string | null;
  patientId: string | null;
  patientName: string | null;
  patientIsStaff: boolean;
  institutionId: string | null;
  institutionName: string | null;
  institutionBillingEligible: boolean;
  prescriberId: string | null;
  prescriberName: string | null;
  discountPercentage: number;
  reason: string;
  revisedTotal: number;
}

interface PosV2ReceiptRevisionEditorProps {
  sale: Sale;
  onCancel: () => void;
  onContinue: (draft: PosV2ReceiptRevisionDraft) => void;
  catalogProducts?: Product[];
  catalogServices?: BillableService[];
  servicesReady?: boolean;
  catalogBatches?: ProductBatch[];
  catalogSystemSettings?: SystemSettings | null;
  catalogReady?: boolean;
  referenceClients?: PosV2RevisionReferenceOption[];
  referenceInstitutions?: PosV2RevisionReferenceOption[];
  referencePrescribers?: PosV2RevisionReferenceOption[];
  referencesReady?: boolean;
}

const numberValue = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cleanId = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text || null;
};

const lineKey = (item: SaleItem, index: number): string => {
  const explicit = String((item as any).lineId || '').trim();
  if (explicit) return explicit;
  return `${item.productId || 'item'}::${String((item as any).tierCode || 'BASE')}::${index}`;
};

const itemName = (item: SaleItem): string => String((item as any).productName || (item as any).name || item.productId || 'Item');
const itemQty = (item: SaleItem): number => Math.max(0, numberValue((item as any).quantity, 0));
const itemPrice = (item: SaleItem): number => Math.max(0, numberValue((item as any).actualUnitPrice ?? (item as any).unitPrice, 0));

export function calculatePosV2RevisionDraftTotal(items: SaleItem[], discountPercentage: number): number {
  const subtotal = items.reduce((sum, item) => sum + itemQty(item) * i…9297 tokens truncated… be the authenticated operator.');
  const submission = buildPosV2RevisionSubmissionRequest(input);
  const replacement = buildPosV2ReplacementCheckoutRequest({
    revisionRequestId: submission.requestId,
    envelope: submission.envelope,
    snapshots: buildPosV2ReplacementSnapshots(input.originalSale, submission.envelope)
  });
  const prepared = await prepareCheckoutV2Repository(uid, replacement);
  if (prepared.authority.tenantId !== submission.tenantId) throw new Error('Receipt tenant authority mismatch.');
  // Include products removed by the correction so their exact historical stock
  // can be restored and their all-branch aggregates recalculated correctly.
  const historicalPreparation = await prepareCheckoutV2Repository(uid, { ...replacement, items: input.originalSale.items });
  for (const [id, ref] of historicalPreparation.productRefs) prepared.productRefs.set(id, ref);
  for (const [id, refs] of historicalPreparation.batchRefsByProduct) {
    const merged = new Map([...(prepared.batchRefsByProduct.get(id) || []), ...refs].map(row => [row.id, row]));
    prepared.batchRefsByProduct.set(id, [...merged.values()]);
  }
  const fingerprint = JSON.stringify({ checkout: prepared.fingerprint, reason: submission.reason, actor: uid });
  const requestRef = doc(db, 'pos_sale_revision_requests', submission.requestId);

  const recover = async (): Promise<PosV2AtomicRevisionResult | null> => {
    const saved = await getDoc(requestRef);
    if (!saved.exists()) return null;
    const request = { id: saved.id, ...saved.data() } as PosV2RevisionRequestProgress;
    if (request.executionMode !== 'SPARK_ATOMIC' || request.status !== 'COMPLETED') {
      throw new Error('An existing revision is being processed. Its state must be reconciled before this receipt can be corrected.');
    }
    if (request.intentFingerprint !== fingerprint || request.requestedBy !== uid) throw new Error('A different correction already exists for this receipt.');
    const [saleSnap, paymentSnap, outboxSnap, attemptSnap] = await Promise.all([
      getDoc(prepared.saleRef), getDoc(prepared.paymentRef), getDoc(prepared.outboxRef), getDoc(prepared.attemptRef)
    ]);
    if (!saleSnap.exists() || !paymentSnap.exists() || !outboxSnap.exists() || !attemptSnap.exists()
      || saleSnap.data().revisionRequestId !== submission.requestId
      || paymentSnap.data().saleId !== prepared.saleId || outboxSnap.data().status !== 'PROCESSED'
      || attemptSnap.data().fingerprint !== prepared.fingerprint) throw new Error('The committed correction record chain is incomplete.');
    const sale = { id: saleSnap.id, ...saleSnap.data() } as Sale;
    return { request, replayed: true, checkout: { saleId: sale.id, receiptNumber: sale.receiptNumber,
      paymentId: prepared.paymentId, outboxEventId: prepared.outboxEventId,
      attemptId: replacement.attemptId, sale, payment: paymentSnap.data() as any, replayed: true } };
  };
  const existing = await recover();
  if (existing) return existing;

  try {
    return await runTransaction(db, async transaction => {
      const stage = new PosRevisionStagedTransaction(db, transaction);
      const executorDb = stage.asExecutorDatabase();
      const requestSnap = await stage.get(requestRef);
      if (requestSnap.exists()) throw new Error('CORRECTION_ALREADY_COMMITTED');
      const originalRef = doc(db, 'sales', submission.originalSaleId);
      const originalSnap = await stage.get(originalRef);
      if (!originalSnap.exists()) throw new Error('The original receipt no longer exists.');
      const original = { ...originalSnap.data(), id: originalSnap.id } as Sale;
      const eligibility = evaluatePosV2RevisionEligibility(original);
      if (!eligibility.allowed || original.revisionLocked) throw new Error(`This receipt cannot be revised (${eligibility.code}).`);
      if (original.tenantId !== submission.tenantId || original.branchId !== submission.branchId
        || original.receiptNumber !== submission.originalReceiptNumber
        || !receiptItemsMatch(original.items, input.originalSale.items)
        || Number(original.totalAmount ?? original.total) !== submission.originalTotal) throw new Error('The original receipt changed. Reload it before revising.');
      const originalPaymentRef = doc(db, 'pos_payments', original.canonicalPaymentId!);
      const originalOutboxRef = doc(db, 'pos_transaction_outbox', original.transactionOutboxEventId!);
      const [paymentSnap, outboxSnap] = await Promise.all([stage.get(originalPaymentRef), stage.get(originalOutboxRef)]);
      if (!paymentSnap.exists() || !outboxSnap.exists()) throw new Error('The original canonical payment or posting event is missing.');
      const payment = paymentSnap.data();
      const outbox = outboxSnap.data();
      if (outbox.saleId !== original.id || outbox.paymentId !== original.canonicalPaymentId || outbox.status === 'SUPERSEDED') throw new Error('Original posting identity conflict.');
      for (const [collection, id, project] of [
        ['institutions', replacement.institutionId, institutionRevisionOption],
        ['prescribers', replacement.prescriberId, prescriberRevisionOption]
      ] as const) {
        if (!id) continue;
        const snapshot = await stage.get(doc(db, collection, id));
        if (!snapshot.exists() || snapshot.data().tenantId !== original.tenantId) throw new Error(`The selected ${collection} record is unavailable.`);
        const option = project({ ...snapshot.data(), id });
        if (!option.selectable || (collection === 'institutions' && replacement.paymentMethod === 'institutional_credit' && !option.billingEligible)) throw new Error('The selected account is no longer eligible. Reload the editor.');
      }
      if (replacement.patientId) {
        let snapshot = await stage.get(doc(db, 'clients', replacement.patientId));
        if (!snapshot.exists()) snapshot = await stage.get(doc(db, 'staff', replacement.patientId));
        if (!snapshot.exists() || snapshot.data().tenantId !== original.tenantId || !clientRevisionOption({ ...snapshot.data(), id: snapshot.id }).selectable) throw new Error('The selected client is no longer eligible.');
      }
      const common = { db: executorDb, sale: original, payment, revisionId: submission.revisionId,
        requestedBy: uid, requestedByName: input.actor.name, reason: submission.reason, FieldValue: { serverTimestamp } };
      const plan = buildRevisionInventoryRestores({ sale: original, revisionId: submission.revisionId });
      for (const restore of plan.batches) {
        const ref = doc(db, 'product_batches', restore.batchId);
        const snapshot = await stage.get(ref);
        const batch = snapshot.exists() ? snapshot.data() : null;
        assertLiveBatchMatchesRestore({ batch, restore, tenantId: original.tenantId, branchId: original.branchId });
        stage.update(ref, { quantity: Number(batch.quantity) + restore.baseQuantity, lastUpdated: new Date().toISOString() });
      }
      for (const restore of plan.products) {
        const ref = doc(db, 'products', restore.productId);
        const product = await stage.get(ref);
        if (!product.exists() || product.data().tenantId !== original.tenantId) throw new Error('Historical product authority mismatch.');
        let aggregate = 0;
        for (const row of prepared.batchRefsByProduct.get(restore.productId) || []) {
          const batch = await stage.get(row.ref);
          if (batch.exists()) aggregate += Number(batch.data().quantity || 0);
        }
        stage.update(ref, { stock: aggregate, quantityInStock: aggregate, stockAggregateSource: 'product_batches', updatedAt: serverTimestamp() });
        const eventRef = doc(db, 'inventoryMovementEvents', movementEventId({ saleId: original.id, productId: restore.productId }));
        const eventSnap = await stage.get(eventRef);
        if (!eventSnap.exists()) continue; // An unposted original has no consumption to compensate.
        const event = eventSnap.data();
        if (event.tenantId !== original.tenantId || event.branchId !== original.branchId || event.eventType !== 'SALE' || event.sourceDocumentId !== original.id || Number(event.consumptionDeltaBaseUnits) !== restore.baseQuantity) throw new Error('Original consumption history does not reconcile.');
        const summaryRef = doc(db, 'branchConsumptionDaily', consumptionSummaryId(original.tenantId, original.branchId, restore.productId, event.dateKey));
        const summary = await stage.get(summaryRef);
        if (!summary.exists()) throw new Error('Original consumption summary is missing.');
        stage.set(summaryRef, { ...reverseConsumptionSummary({ summary: summary.data(), baseQuantity: restore.baseQuantity, exceptional: Boolean(event.isExceptional), productId: restore.productId }), updatedAt: serverTimestamp() });
        const reversalRef = doc(db, 'inventoryMovementEvents', restore.eventId);
        if ((await stage.get(reversalRef)).exists()) throw new Error('Original inventory was already reversed.');
        stage.set(reversalRef, buildInventoryReversalEvent({ sale: original, restore, originalEvent: { ...event, eventId: eventSnap.id }, revisionId: submission.revisionId, workerId: uid, serverTimestamp: serverTimestamp() }));
      }
      const paymentReversal = await executePaymentReversal(common);
      const oldWelfareIds = welfarePostingIds(original.tenantId, original.id);
      let welfareReversal: any = null;
      let creditReversal: any = null;
      let quotationReversal: any = null;
      let oldWelfarePosted = false;
      if (paymentComponentAmount(payment, 'staff_welfare') > 0) {
        const oldWelfare = await stage.get(doc(db, 'welfare', oldWelfareIds.welfareId));
        const oldExpense = await stage.get(doc(db, 'branch_expenses', oldWelfareIds.expenseId));
        const oldTransfer = await stage.get(doc(db, 'cashTransfers', oldWelfareIds.transferId));
        oldWelfarePosted = oldWelfare.exists();
        if ([oldWelfare, oldExpense, oldTransfer].some(snap => snap.exists())) {
          if (![oldWelfare, oldExpense, oldTransfer].every(snap => snap.exists())) throw new Error('Original welfare postings are partial. Manual reconciliation is required.');
          welfareReversal = await executeWelfareReversal(common);
        }
      }
      let originalCreditPosted = false;
      if (paymentComponentAmount(payment, 'institutional_credit') > 0) {
        const originalCredit = await stage.get(doc(db, 'credit_receivables', original.id));
        originalCreditPosted = originalCredit.exists();
        if (originalCreditPosted) creditReversal = await executeInstitutionalCreditReversal(common);
      }
      if (original.sourceQuotationId) {
        const quotation = await stage.get(doc(db, 'pos_quotations', original.sourceQuotationId));
        if (!quotation.exists()) throw new Error('The source quotation is missing.');
        if (quotation.data().status === 'Converted') quotationReversal = await executeQuotationReversal(common);
        else if (quotation.data().status !== 'Draft') throw new Error('The source quotation cannot be relinked.');
      }
      stage.update(originalRef, { revisionLocked: true, revisionId: submission.revisionId,
        revisionLifecycle: 'REPLACEMENT_PENDING', pendingReplacementSaleId: prepared.saleId });
      for (const item of replacement.items.filter(row => row.isService)) {
        const service = await stage.get(doc(db, 'billable_services', item.productId));
        if (!service.exists() || service.data().tenantId !== original.tenantId) throw new Error('A selected service no longer exists in the POS catalogue.');
      }
      const checkout = await writeCheckoutV2Transaction(replacement, prepared, stage as unknown as Transaction);
      // Corrections retain the business period of the original receipt; creation
      // and revision timestamps separately describe when the edit occurred.
      stage.update(prepared.saleRef, { timestamp: original.timestamp, revisionRecordedAt: new Date().toISOString(),
        revisionReason: submission.reason, revisionRequestedBy: uid, revisionRequestedByName: input.actor.name,
        revisionCompletedAt: serverTimestamp(), revisionRequestId: submission.requestId,
        originalSellerId: original.servedBy || original.cashierId, revisionLifecycle: 'COMPLETED' });
      const corrected = { ...(await stage.get(prepared.saleRef)).data(), id: prepared.saleId } as Sale;
      const posters = createPosV2ConsumerPosters({ db: executorDb, FieldValue: { serverTimestamp }, workerId: uid,
        batchRefsByProduct: new Map([...prepared.batchRefsByProduct].map(([id, rows]) => [id, rows.map(row => row.ref)])) });
      await posters.postConsumption(corrected);
      const welfareAmount = paymentComponentAmount(checkout.payment, 'staff_welfare');
      if (welfareAmount > 0) {
        const beneficiary = await stage.get(doc(db, corrected.welfareBeneficiaryIsStaff ? 'staff' : 'clients', corrected.patientId!));
        if (!beneficiary.exists() || beneficiary.data().tenantId !== original.tenantId) throw new Error('Welfare beneficiary authority mismatch.');
        const allowance = Number(beneficiary.data().welfare_limit || beneficiary.data().welfare_allocation_ugx || prepared.settings?.operationalConfig?.pos?.welfareAllocationDefault || 50000);
        if (Number(beneficiary.data().welfare_spent || 0) + welfareAmount > allowance) throw new Error('The corrected receipt exceeds the remaining welfare allocation.');
      }
      await posters.postWelfare(corrected, checkout.payment);
      await posters.postInstitutionalCredit(corrected, checkout.payment);
      await posters.postQuotation(corrected);
      // Refresh closing usable stock even for a product removed completely, or
      // restored into an expired/quarantined historical batch.
      for (const restore of plan.products) {
        const event = await stage.get(doc(db, 'inventoryMovementEvents', movementEventId({ saleId: original.id, productId: restore.productId })));
        if (!event.exists()) continue;
        let closingUsableStock = 0;
        for (const row of prepared.batchRefsByProduct.get(restore.productId) || []) {
          const snapshot = await stage.get(row.ref);
          if (!snapshot.exists()) continue;
          const batch = snapshot.data();
          const candidate = { ...batch, id: row.id, expiryDate: normalizeDateValue(batch.expiryDate)?.toISOString(), batchStatus: batch.batch_status, costPerBaseUnit: Number(batch.purchasePrice) };
          if (isV2SellableBatch({ batch: candidate as any, tenantId: original.tenantId, branchId: original.branchId, productId: restore.productId, now: new Date() })) closingUsableStock += Number(batch.quantity);
        }
        const summaryRef = doc(db, 'branchConsumptionDaily', consumptionSummaryId(original.tenantId, original.branchId, restore.productId, event.data().dateKey));
        stage.update(summaryRef, { closingUsableStock, updatedAt: serverTimestamp() });
      }
      const consumers = initializeConsumers({ sale: corrected, payment: checkout.payment, existingConsumers: {}, nowIso: new Date().toISOString() });
      for (const state of Object.values(consumers) as any[]) if (state.status !== 'NOT_APPLICABLE') state.status = 'COMPLETED';
      stage.update(prepared.outboxRef, { status: 'PROCESSED', consumers, processedAt: serverTimestamp(), postingMode: 'SPARK_ATOMIC' });
      stage.update(originalOutboxRef, { status: 'SUPERSEDED', supersededByEventId: prepared.outboxEventId,
        revisionRequestId: submission.requestId, leaseOwner: null, leaseExpiresAt: null, updatedAt: serverTimestamp() });
      stage.update(originalRef, { revisionLifecycle: 'COMPLETED', revisionLocked: true, revisionRequestId: submission.requestId,
        revisionReason: submission.reason, revisionRequestedBy: uid, revisionRequestedByName: input.actor.name,
        revisionRequestedAt: serverTimestamp(), revisionCompletedAt: serverTimestamp(), supersededBySaleId: prepared.saleId,
        supersededByReceiptNumber: checkout.receiptNumber, updatedAt: serverTimestamp() });
      const newWelfareIds = welfarePostingIds(corrected.tenantId, corrected.id);
      const completed = { ...submission, status: 'COMPLETED', executionMode: 'SPARK_ATOMIC', intentFingerprint: fingerprint,
        replacementReceiptNumber: checkout.receiptNumber, paymentReversalId: paymentReversal.reversalId,
        originalPaymentId: payment.paymentId, originalOutboxEventId: original.transactionOutboxEventId,
        originalWelfareId: oldWelfareIds.welfareId, originalWelfarePosted: oldWelfarePosted,
        originalCreditPosted, welfareAmount, welfareBeneficiaryId: corrected.patientId || null,
        welfareReversal, creditReversal, quotationReversal,
        replacementWelfareId: newWelfareIds.welfareId, replacementWelfareExpenseId: newWelfareIds.expenseId, replacementWelfareTransferId: newWelfareIds.transferId,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), completedAt: serverTimestamp(), requiresManualReview: false };
      stage.set(requestRef, completed);
      stage.set(doc(db, 'sale_revisions', submission.revisionId), { ...submission.envelope.revision,
        status: 'COMPLETED', replacementSaleId: prepared.saleId, revisionRequestId: submission.requestId, completedAt: serverTimestamp() });
      stage.set(doc(db, 'audit_logs', submission.auditId), { ...submission.envelope.audit, timestamp: new Date().toISOString(),
        revisionRequestId: submission.requestId, createdAt: serverTimestamp() });
      stage.annotateFinancialWrites(submission.requestId, original.timestamp);
      stage.flush();
      return { request: { id: submission.requestId, ...completed } as PosV2RevisionRequestProgress,
        checkout: { ...checkout, sale: { ...(await stage.get(prepared.saleRef)).data(), id: prepared.saleId } as Sale }, replayed: false };
    });
  } catch (error) {
    // Includes a lost acknowledgement or a concurrent loser rejected by rules.
    // Recover only this exact actor and reviewed commercial intent.
    const committed = await recover();
    if (committed) return committed;
    throw error;
  }
}
