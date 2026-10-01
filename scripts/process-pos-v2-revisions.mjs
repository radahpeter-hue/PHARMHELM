#!/usr/bin/env node
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  REVISION_REQUEST_TYPE,
  REVERSAL_CONSUMERS,
  deriveReversalState,
  initializeReversalConsumers,
  validateRevisionRequest
} from './pos-v2-revision-worker-core.mjs';
import {
  buildRevisionInventoryRestores,
  assertLiveBatchMatchesRestore,
  assertLiveProductCanRestore,
  INVENTORY_REVERSAL_EVENT_TYPE
} from './pos-v2-revision-inventory-core.mjs';
import {
  consumptionSummaryId,
  movementEventId,
  welfarePostingIds
} from './pos-v2-batch4-core.mjs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const WORKER_ID = process.env.POS_V2_REVISION_WORKER_ID || `github-actions-revision-${process.env.GITHUB_RUN_ID || Date.now()}`;
const LEASE_SECONDS = Math.max(60, Number(process.env.POS_V2_REVISION_LEASE_SECONDS || 300));
const MAX_REQUESTS = Math.max(1, Math.min(50, Number(process.env.POS_V2_REVISION_MAX_REQUESTS || 10)));
const MAX_ATTEMPTS = Math.max(1, Math.min(10, Number(process.env.POS_V2_REVISION_MAX_ATTEMPTS || 5)));
const EPSILON = 0.0001;

function initializeAdmin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    return initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
  }
  return initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}

const app = initializeAdmin();
const db = getFirestore(app, DATABASE_ID);

function isLeaseExpired(value) {
  if (!value) return true;
  const millis = typeof value?.toMillis === 'function' ? value.toMillis() : new Date(value).getTime();
  return !Number.isFinite(millis) || millis <= Date.now();
}

function clean(value) {
  return String(value ?? '').trim();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function paymentComponentAmount(payment, method) {
  return (Array.isArray(payment?.components) ? payment.components : [])
    .filter(component => clean(component?.method) === method)
    .reduce((sum, component) => sum + Math.max(0, numberValue(component?.amount)), 0);
}

function reversalApplicability({ sale, payment, outbox }) {
  const originalConsumers = outbox?.consumers || {};
  const completed = name => clean(originalConsumers?.[name]?.status).toUpperCase() === 'COMPLETED';
  const hasStockLines = (Array.isArray(sale?.items) ? sale.items : []).some(item => !item?.isService && clean(item?.productId));
  const welfareAmount = paymentComponentAmount(payment, 'staff_welfare');
  const institutionalCreditAmount = paymentComponentAmount(payment, 'institutional_credit');
  return {
    inventory: hasStockLines,
    consumption: completed('consumption') && hasStockLines,
    welfare: completed('welfare') || welfareAmount > 0,
    institutionalCredit: completed('institutionalCredit') || institutionalCreditAmount > 0,
    quotation: completed('quotation') || Boolean(clean(sale?.sourceQuotationId))
  };
}

async function loadCanonicalForRequest(request) {
  const saleRef = db.collection('sales').doc(request.originalSaleId);
  const saleSnap = await saleRef.get();
  if (!saleSnap.exists) throw new Error('The original POS V2 sale no longer exists.');
  const sale = { id: saleSnap.id, ...saleSnap.data() };
  const paymentId = clean(sale.canonicalPaymentId);
  const outboxId = clean(sale.transactionOutboxEventId);
  if (!paymentId || !outboxId) throw new Error('The original POS V2 sale is missing canonical transaction links.');
  const [paymentSnap, outboxSnap] = await Promise.all([
    db.collection('pos_payments').doc(paymentId).get(),
    db.collection('pos_transaction_outbox').doc(outboxId).get()
  ]);
  if (!paymentSnap.exists || !outboxSnap.exists) throw new Error('The original POS V2 canonical payment or outbox record is missing.');
  return {
    sale,
    payment: { id: paymentSnap.id, ...paymentSnap.data() },
    outbox: { id: outboxSnap.id, ...outboxSnap.data() }
  };
}

async function claimRevisionRequest(ref) {
  return db.runTransaction(async tx => {
    const requestSnap = await tx.get(ref);
    if (!requestSnap.exists) return null;
    const request = { id: requestSnap.id, ...requestSnap.data() };

    if (request.requestType !== REVISION_REQUEST_TYPE || Number(request.engineVersion || 0) !== 2) return null;
    if (request.status === 'COMPLETED' || request.status === 'REVERSAL_COMPLETE' || request.status === 'REPLACEMENT_PENDING') return null;
    if (request.status === 'PROCESSING' && !isLeaseExpired(request.leaseExpiresAt)) return null;
    if (request.requiresManualReview === true || Number(request.attemptCount || 0) >= MAX_ATTEMPTS) return null;

    const saleRef = db.collection('sales').doc(request.originalSaleId);
    const saleSnap = await tx.get(saleRef);
    if (!saleSnap.exists) throw new Error('The original POS V2 sale no longer exists.');
    const sale = { id: saleSnap.id, ...saleSnap.data() };

    const paymentId = clean(sale.canonicalPaymentId);
    const outboxId = clean(sale.transactionOutboxEventId);
    if (!paymentId || !outboxId) throw new Error('The original POS V2 sale is missing canonical transaction links.');

    const paymentRef = db.collection('pos_payments').doc(paymentId);
    const outboxRef = db.collection('pos_transaction_outbox').doc(outboxId);
    const paymentSnap = await tx.get(paymentRef);
    const outboxSnap = await tx.get(outboxRef);
    if (!paymentSnap.exists || !outboxSnap.exists) throw new Error('The original POS V2 canonical payment or outbox record is missing.');

    const payment = { id: paymentSnap.id, ...paymentSnap.data() };
    const outbox = { id: outboxSnap.id, ...outboxSnap.data() };
    const validationRequest = { ...request, status: 'PENDING' };
    const resumingOwnLock = sale.revisionLocked === true
      && clean(sale.revisionId) === clean(request.revisionId)
      && clean(sale.revisionLifecycle) === 'REVERSAL_PENDING'
      && !clean(sale.supersededBySaleId);
    validateRevisionRequest({ request: validationRequest, sale, payment, outbox, resume: resumingOwnLock });

    const applicability = reversalApplicability({ sale, payment, outbox });
    const consumers = initializeReversalConsumers(applicability, request.reversalConsumers || {});
    const reversalState = deriveReversalState(consumers);
    if (!resumingOwnLock && reversalState === 'REVERSAL_COMPLETE') {
      throw new Error('A new revision request cannot start with every reversal consumer already complete.');
    }

    const nextAttempt = Number(request.attemptCount || 0) + 1;
    const leaseExpiresAt = Timestamp.fromMillis(Date.now() + LEASE_SECONDS * 1000);
    const pendingReplacementSaleId = clean(request.pendingReplacementSaleId || request.replacementSaleId);

    tx.update(ref, {
      status: 'PROCESSING',
      attemptCount: nextAttempt,
      leaseOwner: WORKER_ID,
      leaseExpiresAt,
      reversalConsumers: consumers,
      reversalState,
      canonicalPaymentId: payment.paymentId,
      originalOutboxEventId: outbox.eventId,
      lastAttemptAt: FieldValue.serverTimestamp(),
      lastError: null,
      updatedAt: FieldValue.serverTimestamp()
    });

    if (!resumingOwnLock) {
      tx.update(saleRef, {
        revisionLocked: true,
        revisionId: request.revisionId,
        revisionLifecycle: 'REVERSAL_PENDING',
        pendingReplacementSaleId: pendingReplacementSaleId || null,
        revisionRequestedBy: request.requestedBy,
        revisionRequestedByName: request.requestedByName,
        revisionReason: clean(request.reason).replace(/\s+/g, ' '),
        revisionRequestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    return {
      requestId: request.requestId || requestSnap.id,
      revisionId: request.revisionId,
      originalSaleId: sale.id,
      reversalConsumers: consumers,
      attemptCount: nextAttempt
    };
  });
}

async function markClaimFailure(ref, error) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const request = snap.data();
    const attemptCount = Number(request.attemptCount || 0) + (request.status === 'PROCESSING' ? 0 : 1);
    const terminal = attemptCount >= MAX_ATTEMPTS;
    tx.update(ref, {
      status: 'FAILED',
      attemptCount,
      lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error || 'Unknown revision error').slice(0, 1000),
      requiresManualReview: terminal,
      manualReviewAt: terminal ? FieldValue.serverTimestamp() : null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function markConsumerProcessing(ref, name) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const request = snap.data();
    if (request.leaseOwner !== WORKER_ID || isLeaseExpired(request.leaseExpiresAt)) return false;
    const state = request.reversalConsumers?.[name];
    if (!state || state.status === 'COMPLETED' || state.status === 'NOT_APPLICABLE') return false;
    if (state.status === 'PROCESSING' && !isLeaseExpired(state.leaseExpiresAt)) return false;
    const attemptCount = Number(state.attemptCount || 0) + 1;
    tx.update(ref, {
      [`reversalConsumers.${name}.status`]: 'PROCESSING',
      [`reversalConsumers.${name}.attemptCount`]: attemptCount,
      [`reversalConsumers.${name}.leaseOwner`]: WORKER_ID,
      [`reversalConsumers.${name}.leaseExpiresAt`]: request.leaseExpiresAt,
      [`reversalConsumers.${name}.lastError`]: null,
      [`reversalConsumers.${name}.updatedAt`]: FieldValue.serverTimestamp(),
      reversalState: 'PROCESSING',
      status: 'PROCESSING',
      updatedAt: FieldValue.serverTimestamp()
    });
    return true;
  });
}

async function markConsumerResult(ref, name, error = null) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const request = snap.data();
    const previous = request.reversalConsumers?.[name] || {};
    const failed = Boolean(error);
    const terminal = failed && Number(previous.attemptCount || 0) >= MAX_ATTEMPTS;
    const nextState = {
      ...previous,
      status: failed ? 'FAILED' : 'COMPLETED',
      lastError: failed ? (error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000)) : null,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: failed ? null : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requiresManualReview: terminal
    };
    const consumers = { ...(request.reversalConsumers || {}), [name]: nextState };
    const reversalState = deriveReversalState(consumers);
    tx.update(ref, {
      [`reversalConsumers.${name}`]: nextState,
      reversalState,
      status: reversalState === 'FAILED' ? 'FAILED' : 'PROCESSING',
      requiresManualReview: Object.values(consumers).some(state => Boolean(state?.requiresManualReview)),
      lastError: failed ? nextState.lastError : null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function markConsumptionCompletedWithInventory(ref) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const request = snap.data();
    const state = request.reversalConsumers?.consumption;
    if (!state || state.status === 'NOT_APPLICABLE' || state.status === 'COMPLETED') return;
    const nextState = {
      ...state,
      status: 'COMPLETED',
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requiresManualReview: false
    };
    const consumers = { ...(request.reversalConsumers || {}), consumption: nextState };
    tx.update(ref, {
      'reversalConsumers.consumption': nextState,
      reversalState: deriveReversalState(consumers),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function reverseInventoryAndConsumption({ sale, revisionId }) {
  const plan = buildRevisionInventoryRestores({ sale, revisionId });
  if (plan.products.length === 0) return;

  await db.runTransaction(async tx => {
    const reversalEventRefs = plan.products.map(row => db.collection('inventoryMovementEvents').doc(row.eventId));
    const reversalEventSnaps = [];
    for (const ref of reversalEventRefs) reversalEventSnaps.push(await tx.get(ref));
    const existingCount = reversalEventSnaps.filter(snap => snap.exists).length;
    if (existingCount === reversalEventSnaps.length) {
      for (const snap of reversalEventSnaps) {
        const event = snap.data();
        if (event.eventType !== INVENTORY_REVERSAL_EVENT_TYPE || event.revisionId !== revisionId || event.sourceDocumentId !== sale.id) {
          throw new Error('Inventory reversal event identity conflict. Manual review required.');
        }
      }
      return;
    }
    if (existingCount > 0) throw new Error('Partial inventory reversal detected. Manual review required.');

    const originalEvents = new Map();
    const summaries = new Map();
    for (const product of plan.products) {
      const originalEventId = movementEventId({ saleId: sale.id, productId: product.productId });
      const originalEventRef = db.collection('inventoryMovementEvents').doc(originalEventId);
      const originalEventSnap = await tx.get(originalEventRef);
      if (!originalEventSnap.exists) throw new Error(`Original consumption event ${originalEventId} is missing.`);
      const originalEvent = originalEventSnap.data();
      if (originalEvent.eventType !== 'SALE' || originalEvent.sourceDocumentId !== sale.id || originalEvent.productId !== product.productId) {
        throw new Error(`Original consumption event ${originalEventId} does not match the canonical sale.`);
      }
      const consumed = numberValue(originalEvent.consumptionDeltaBaseUnits, NaN);
      if (!Number.isFinite(consumed) || Math.abs(consumed - product.baseQuantity) > EPSILON) {
        throw new Error(`Original consumption quantity does not reconcile for ${product.productId}.`);
      }
      originalEvents.set(product.productId, { ref: originalEventRef, id: originalEventId, data: originalEvent });

      const summaryId = consumptionSummaryId(sale.tenantId, sale.branchId, product.productId, originalEvent.dateKey);
      const summaryRef = db.collection('branchConsumptionDaily').doc(summaryId);
      const summarySnap = await tx.get(summaryRef);
      if (!summarySnap.exists) throw new Error(`Consumption summary ${summaryId} is missing.`);
      summaries.set(product.productId, { ref: summaryRef, data: summarySnap.data() });
    }

    const batchRows = [];
    for (const restore of plan.batches) {
      const ref = db.collection('product_batches').doc(restore.batchId);
      const snap = await tx.get(ref);
      const batch = snap.exists ? snap.data() : null;
      assertLiveBatchMatchesRestore({ batch, restore, tenantId: sale.tenantId, branchId: sale.branchId });
      batchRows.push({ ref, batch, restore });
    }

    const productRows = [];
    for (const restore of plan.products) {
      const ref = db.collection('products').doc(restore.productId);
      const snap = await tx.get(ref);
      const product = snap.exists ? snap.data() : null;
      assertLiveProductCanRestore({ product, restore, tenantId: sale.tenantId });
      productRows.push({ ref, product, restore });
    }

    for (const { ref, batch, restore } of batchRows) {
      tx.update(ref, {
        quantity: numberValue(batch.quantity) + restore.baseQuantity,
        lastUpdated: new Date().toISOString()
      });
    }

    for (const { ref, product, restore } of productRows) {
      const current = numberValue(product.stock ?? product.quantityInStock);
      const next = current + restore.baseQuantity;
      tx.update(ref, {
        stock: next,
        quantityInStock: next,
        stockAggregateSource: 'product_batches',
        updatedAt: FieldValue.serverTimestamp()
      });

      const original = originalEvents.get(restore.productId);
      const summaryEntry = summaries.get(restore.productId);
      const summary = { ...summaryEntry.data };
      const exceptional = Boolean(original.data.isExceptional);
      if (numberValue(summary.transactionCount) < 1) throw new Error(`Consumption summary transaction count is corrupt for ${restore.productId}.`);
      summary.transactionCount = numberValue(summary.transactionCount) - 1;
      summary.closingUsableStock = numberValue(summary.closingUsableStock) + restore.baseQuantity;
      if (exceptional) {
        if (numberValue(summary.exceptionalUnits) + EPSILON < restore.baseQuantity) throw new Error(`Exceptional consumption summary is insufficient for ${restore.productId}.`);
        summary.exceptionalUnits = numberValue(summary.exceptionalUnits) - restore.baseQuantity;
      } else {
        if (numberValue(summary.ordinaryUnitsSold) + EPSILON < restore.baseQuantity || numberValue(summary.validConsumptionUnits) + EPSILON < restore.baseQuantity) {
          throw new Error(`Consumption summary is insufficient for ${restore.productId}.`);
        }
        if (numberValue(summary.consumptionTransactionCount) < 1) throw new Error(`Consumption transaction count is corrupt for ${restore.productId}.`);
        summary.ordinaryUnitsSold = numberValue(summary.ordinaryUnitsSold) - restore.baseQuantity;
        summary.validConsumptionUnits = numberValue(summary.validConsumptionUnits) - restore.baseQuantity;
        summary.consumptionTransactionCount = numberValue(summary.consumptionTransactionCount) - 1;
      }
      summary.updatedAt = FieldValue.serverTimestamp();
      tx.set(summaryEntry.ref, summary);

      tx.create(db.collection('inventoryMovementEvents').doc(restore.eventId), {
        tenantId: sale.tenantId,
        branchId: sale.branchId,
        productId: restore.productId,
        eventId: restore.eventId,
        eventType: INVENTORY_REVERSAL_EVENT_TYPE,
        quantityDeltaBaseUnits: restore.baseQuantity,
        consumptionDeltaBaseUnits: -restore.baseQuantity,
        sourceCollection: 'sales',
        sourceDocumentId: sale.id,
        sourceLineId: restore.productId,
        reversalOfEventId: original.id,
        revisionId,
        receiptNumber: sale.receiptNumber || null,
        effectiveAt: FieldValue.serverTimestamp(),
        dateKey: original.data.dateKey,
        createdBy: WORKER_ID,
        createdAt: FieldValue.serverTimestamp()
      });
    }
  });
}

async function reverseWelfare({ sale, payment, revisionId }) {
  const amount = paymentComponentAmount(payment, 'staff_welfare');
  if (amount <= 0) return;
  const ids = welfarePostingIds(sale.tenantId, sale.id);
  const saleRef = db.collection('sales').doc(sale.id);
  const welfareRef = db.collection('welfare').doc(ids.welfareId);
  const expenseRef = db.collection('branch_expenses').doc(ids.expenseId);
  const transferRef = db.collection('cashTransfers').doc(ids.transferId);

  await db.runTransaction(async tx => {
    const welfareSnap = await tx.get(welfareRef);
    if (!welfareSnap.exists) throw new Error('Original welfare posting is missing.');
    const welfare = welfareSnap.data();
    if (welfare.reversalRevisionId === revisionId && welfare.status === 'reversed') return;
    if (welfare.tenantId !== sale.tenantId || welfare.saleId !== sale.id || Math.abs(numberValue(welfare.amount) - amount) > EPSILON) {
      throw new Error('Original welfare posting does not reconcile with the canonical payment.');
    }
    const beneficiaryId = clean(welfare.staffId || sale.patientId);
    const isStaff = Boolean(welfare.isStaff ?? sale.welfareBeneficiaryIsStaff);
    if (!beneficiaryId) throw new Error('Original welfare beneficiary is missing.');
    const beneficiaryRef = db.collection(isStaff ? 'staff' : 'clients').doc(beneficiaryId);
    const beneficiarySnap = await tx.get(beneficiaryRef);
    if (!beneficiarySnap.exists) throw new Error('Original welfare beneficiary no longer exists.');
    const beneficiary = beneficiarySnap.data();
    if (beneficiary.tenantId !== sale.tenantId) throw new Error('Welfare beneficiary tenant mismatch during reversal.');
    const nextSpent = numberValue(beneficiary.welfare_spent) - amount;
    const nextYtd = numberValue(beneficiary.welfare_used_ytd) - amount;
    if (nextSpent < -EPSILON || nextYtd < -EPSILON) throw new Error('Welfare reversal would create a negative welfare balance. Manual review required.');

    tx.update(beneficiaryRef, {
      welfare_spent: Math.max(0, nextSpent),
      welfare_used_ytd: Math.max(0, nextYtd),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.set(welfareRef, {
      status: 'reversed',
      reversalRevisionId: revisionId,
      reversedAt: FieldValue.serverTimestamp(),
      reversedBy: WORKER_ID,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(expenseRef, {
      status: 'reversed',
      reversalRevisionId: revisionId,
      reversedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(transferRef, {
      status: 'reversed',
      reversalRevisionId: revisionId,
      reversedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.update(saleRef, {
      welfarePostingStatus: 'reversed',
      welfarePostingUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function reverseInstitutionalCredit({ sale, payment, revisionId }) {
  const amount = paymentComponentAmount(payment, 'institutional_credit');
  if (amount <= 0) return;
  const ref = db.collection('credit_receivables').doc(sale.id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Original institutional credit receivable is missing.');
    const receivable = snap.data();
    if (receivable.reversalRevisionId === revisionId && receivable.status === 'reversed') return;
    if (receivable.tenantId !== sale.tenantId || clean(receivable.receipt_id) !== sale.id || Math.abs(numberValue(receivable.amount_ugx) - amount) > EPSILON) {
      throw new Error('Institutional credit receivable does not reconcile with the canonical sale.');
    }
    if (Math.abs(numberValue(receivable.outstanding_ugx) - amount) > EPSILON) {
      throw new Error('Institutional credit has already been settled or adjusted. Manual review required before revision.');
    }
    tx.update(ref, {
      outstanding_ugx: 0,
      status: 'reversed',
      reversalRevisionId: revisionId,
      reversedAt: FieldValue.serverTimestamp(),
      reversedBy: WORKER_ID,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function reverseQuotation({ sale, revisionId }) {
  const quotationId = clean(sale.sourceQuotationId);
  if (!quotationId) return;
  const quotationRef = db.collection('pos_quotations').doc(quotationId);
  const saleRef = db.collection('sales').doc(sale.id);
  await db.runTransaction(async tx => {
    const quotationSnap = await tx.get(quotationRef);
    if (!quotationSnap.exists) throw new Error('Original source quotation is missing.');
    const quotation = quotationSnap.data();
    if (quotation.reversalRevisionId === revisionId && quotation.status === 'Draft') return;
    if (quotation.tenantId !== sale.tenantId) throw new Error('Quotation tenant mismatch during reversal.');
    if (quotation.status !== 'Converted' || clean(quotation.convertedReceiptId) !== sale.id) {
      throw new Error('Quotation is no longer converted to the original sale. Manual review required.');
    }
    tx.update(quotationRef, {
      status: 'Draft',
      convertedReceiptId: null,
      convertedAt: null,
      convertedValue: null,
      reversalRevisionId: revisionId,
      reversedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.update(saleRef, {
      quotationConversionStatus: 'pending',
      quotationConvertedAt: null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

const processors = {
  inventory: async canonical => reverseInventoryAndConsumption(canonical),
  consumption: async () => undefined,
  welfare: canonical => reverseWelfare(canonical),
  institutionalCredit: canonical => reverseInstitutionalCredit(canonical),
  quotation: canonical => reverseQuotation(canonical)
};

async function finalizeReversal(ref, saleId) {
  await db.runTransaction(async tx => {
    const requestSnap = await tx.get(ref);
    if (!requestSnap.exists) return;
    const request = requestSnap.data();
    if (request.leaseOwner !== WORKER_ID) return;
    const reversalState = deriveReversalState(request.reversalConsumers || {});
    const saleRef = db.collection('sales').doc(saleId);
    if (reversalState === 'REVERSAL_COMPLETE') {
      tx.update(ref, {
        status: 'REVERSAL_COMPLETE',
        reversalState,
        reversalCompletedAt: FieldValue.serverTimestamp(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.update(saleRef, {
        revisionLifecycle: 'REVERSAL_COMPLETE',
        revisionReversalCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    } else {
      tx.update(ref, {
        status: reversalState === 'FAILED' ? 'FAILED' : 'PROCESSING',
        reversalState,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  });
}

async function processRevision(ref) {
  const claimed = await claimRevisionRequest(ref);
  if (!claimed) return { skipped: true };
  const requestSnap = await ref.get();
  const request = { id: requestSnap.id, ...requestSnap.data() };
  const canonical = await loadCanonicalForRequest(request);
  const context = { ...canonical, revisionId: claimed.revisionId };

  for (const name of REVERSAL_CONSUMERS) {
    if (name === 'consumption') continue;
    const canRun = await markConsumerProcessing(ref, name);
    if (!canRun) continue;
    try {
      await processors[name](context);
      await markConsumerResult(ref, name, null);
      if (name === 'inventory') await markConsumptionCompletedWithInventory(ref);
    } catch (error) {
      console.error(`[POS V2 revision] ${ref.id} consumer ${name} failed:`, error);
      await markConsumerResult(ref, name, error);
    }
  }

  await finalizeReversal(ref, claimed.originalSaleId);
  return { processed: true };
}

async function candidateRefs() {
  const snapshot = await db.collection('pos_sale_revision_requests')
    .where('status', 'in', ['PENDING', 'FAILED', 'PROCESSING'])
    .limit(MAX_REQUESTS * 3)
    .get();

  return snapshot.docs
    .filter(doc => {
      const data = doc.data();
      if (data.requestType !== REVISION_REQUEST_TYPE || Number(data.engineVersion || 0) !== 2) return false;
      if (data.requiresManualReview === true || Number(data.attemptCount || 0) >= MAX_ATTEMPTS) return false;
      if (data.status === 'PROCESSING' && !isLeaseExpired(data.leaseExpiresAt)) return false;
      return true;
    })
    .slice(0, MAX_REQUESTS)
    .map(doc => doc.ref);
}

async function main() {
  const refs = await candidateRefs();
  const summary = { candidates: refs.length, processed: 0, skipped: 0, failed: 0 };

  for (const ref of refs) {
    try {
      const result = await processRevision(ref);
      if (result.processed) summary.processed += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`[POS V2 revision] ${ref.id}:`, error);
      await markClaimFailure(ref, error);
    }
  }

  console.log(JSON.stringify({ mode: 'revision-reversal', workerId: WORKER_ID, ...summary }, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error('[POS V2 revision worker fatal]', error);
  process.exitCode = 1;
});
