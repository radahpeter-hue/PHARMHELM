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
import { executeInventoryAndConsumptionReversal } from './pos-v2-revision-inventory-executor.mjs';
import { executePaymentReversal } from './pos-v2-revision-payment-executor.mjs';
import { executeWelfareReversal } from './pos-v2-revision-welfare-executor.mjs';
import { executeInstitutionalCreditReversal } from './pos-v2-revision-credit-executor.mjs';
import { executeQuotationReversal } from './pos-v2-revision-quotation-executor.mjs';
import { closeoutRevisionReversal } from './pos-v2-revision-lifecycle-executor.mjs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const WORKER_ID = process.env.POS_V2_REVISION_WORKER_ID || `github-actions-revision-${process.env.GITHUB_RUN_ID || Date.now()}`;
const LEASE_SECONDS = Math.max(60, Number(process.env.POS_V2_REVISION_LEASE_SECONDS || 300));
const MAX_REQUESTS = Math.max(1, Math.min(50, Number(process.env.POS_V2_REVISION_MAX_REQUESTS || 10)));
const MAX_ATTEMPTS = Math.max(1, Math.min(10, Number(process.env.POS_V2_REVISION_MAX_ATTEMPTS || 5)));

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
    payment: true,
    welfare: completed('welfare') || welfareAmount > 0,
    institutionalCredit: completed('institutionalCredit') || institutionalCreditAmount > 0,
    quotation: completed('quotation') || Boolean(clean(sale?.sourceQuotationId))
  };
}

async function claimRevisionRequest(ref) {
  return db.runTransaction(async tx => {
    const requestSnap = await tx.get(ref);
    if (!requestSnap.exists) return null;
    const request = { id: requestSnap.id, ...requestSnap.data() };

    if (request.requestType !== REVISION_REQUEST_TYPE || Number(request.engineVersion || 0) !== 2) return null;
    if (request.status === 'COMPLETED' || request.status === 'REPLACEMENT_PENDING') return null;
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
    const preservingReversalComplete = request.status === 'REVERSAL_COMPLETE';

    tx.update(ref, {
      status: preservingReversalComplete ? 'REVERSAL_COMPLETE' : 'PROCESSING',
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
      canonicalPaymentId: payment.paymentId,
      requestedBy: request.requestedBy,
      requestedByName: request.requestedByName,
      reason: clean(request.reason).replace(/\s+/g, ' '),
      reversalConsumers: consumers,
      attemptCount: nextAttempt,
      resumed: resumingOwnLock,
      preservingReversalComplete
    };
  });
}

async function loadOriginalSale(originalSaleId) {
  const snap = await db.collection('sales').doc(originalSaleId).get();
  if (!snap.exists) throw new Error('The original POS V2 sale disappeared after revision intake.');
  return { id: snap.id, ...snap.data() };
}

async function loadCanonicalPayment(paymentId) {
  const snap = await db.collection('pos_payments').doc(paymentId).get();
  if (!snap.exists) throw new Error('The canonical POS V2 payment disappeared after revision intake.');
  return { id: snap.id, ...snap.data() };
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

    tx.update(ref, {
      [`reversalConsumers.${name}.status`]: 'PROCESSING',
      [`reversalConsumers.${name}.attemptCount`]: Number(state.attemptCount || 0) + 1,
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

async function markInventoryAndConsumptionCompleted(ref, result) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const request = snap.data();
    const consumers = { ...(request.reversalConsumers || {}) };
    const nowIso = new Date().toISOString();

    for (const name of ['inventory', 'consumption']) {
      const previous = consumers[name];
      if (!previous || previous.status === 'NOT_APPLICABLE') continue;
      consumers[name] = {
        ...previous,
        status: 'COMPLETED',
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: previous.completedAt || nowIso,
        updatedAt: nowIso,
        requiresManualReview: false
      };
    }

    const reversalState = deriveReversalState(consumers);
    tx.update(ref, {
      reversalConsumers: consumers,
      reversalState,
      status: reversalState === 'REVERSAL_COMPLETE' ? 'REVERSAL_COMPLETE' : 'PROCESSING',
      inventoryReversalReplay: Boolean(result?.replayed),
      inventoryReversalProductCount: Number(result?.productCount || 0),
      inventoryReversalBatchCount: Number(result?.batchCount || 0),
      inventoryReversalBaseUnits: Number(result?.totalBaseUnits || 0),
      inventoryReversalCompletedAt: FieldValue.serverTimestamp(),
      lastError: null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function markPaymentCompleted(ref, result) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const request = snap.data();
    const consumers = { ...(request.reversalConsumers || {}) };
    const previous = consumers.payment;
    if (!previous || previous.status === 'NOT_APPLICABLE') return;
    const nowIso = new Date().toISOString();
    consumers.payment = {
      ...previous,
      status: 'COMPLETED',
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: previous.completedAt || nowIso,
      updatedAt: nowIso,
      requiresManualReview: false
    };
    const reversalState = deriveReversalState(consumers);
    tx.update(ref, {
      reversalConsumers: consumers,
      reversalState,
      status: reversalState === 'REVERSAL_COMPLETE' ? 'REVERSAL_COMPLETE' : 'PROCESSING',
      paymentReversalId: result.reversalId,
      paymentReversalReplay: Boolean(result.replayed),
      paymentAmountDelta: Number(result.amountDelta || 0),
      paymentSettledDelta: Number(result.settledDelta || 0),
      paymentOutstandingDelta: Number(result.outstandingDelta || 0),
      paymentReversalCompletedAt: FieldValue.serverTimestamp(),
      lastError: null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function markWelfareCompleted(ref, result) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const request = snap.data();
    const consumers = { ...(request.reversalConsumers || {}) };
    const previous = consumers.welfare;
    if (!previous || previous.status === 'NOT_APPLICABLE') return;
    const nowIso = new Date().toISOString();
    consumers.welfare = {
      ...previous,
      status: 'COMPLETED',
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: previous.completedAt || nowIso,
      updatedAt: nowIso,
      requiresManualReview: false
    };
    const reversalState = deriveReversalState(consumers);
    tx.update(ref, {
      reversalConsumers: consumers,
      reversalState,
      status: reversalState === 'REVERSAL_COMPLETE' ? 'REVERSAL_COMPLETE' : 'PROCESSING',
      welfareReversalId: result.reversalId,
      welfareReversalReplay: Boolean(result.replayed),
      welfareAmountDelta: Number(result.amountDelta || 0),
      welfareReversalCompletedAt: FieldValue.serverTimestamp(),
      lastError: null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function markInstitutionalCreditCompleted(ref, result) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const request = snap.data();
    const consumers = { ...(request.reversalConsumers || {}) };
    const previous = consumers.institutionalCredit;
    if (!previous || previous.status === 'NOT_APPLICABLE') return;
    const nowIso = new Date().toISOString();
    consumers.institutionalCredit = {
      ...previous,
      status: 'COMPLETED',
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: previous.completedAt || nowIso,
      updatedAt: nowIso,
      requiresManualReview: false
    };
    const reversalState = deriveReversalState(consumers);
    tx.update(ref, {
      reversalConsumers: consumers,
      reversalState,
      status: reversalState === 'REVERSAL_COMPLETE' ? 'REVERSAL_COMPLETE' : 'PROCESSING',
      institutionalCreditReversalId: result.reversalId,
      institutionalCreditReversalReplay: Boolean(result.replayed),
      institutionalCreditReceivableId: result.receivableId,
      institutionalCreditAmountDelta: Number(result.amountDelta || 0),
      institutionalCreditOutstandingDelta: Number(result.outstandingDelta || 0),
      institutionalCreditReversalCompletedAt: FieldValue.serverTimestamp(),
      lastError: null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function markQuotationCompleted(ref, result) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const request = snap.data();
    const consumers = { ...(request.reversalConsumers || {}) };
    const previous = consumers.quotation;
    if (!previous || previous.status === 'NOT_APPLICABLE') return;
    const nowIso = new Date().toISOString();
    consumers.quotation = {
      ...previous,
      status: 'COMPLETED',
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: previous.completedAt || nowIso,
      updatedAt: nowIso,
      requiresManualReview: false
    };
    const reversalState = deriveReversalState(consumers);
    tx.update(ref, {
      reversalConsumers: consumers,
      reversalState,
      status: reversalState === 'REVERSAL_COMPLETE' ? 'REVERSAL_COMPLETE' : 'PROCESSING',
      quotationReversalId: result.reversalId,
      quotationReversalReplay: Boolean(result.replayed),
      quotationId: result.quotationId || null,
      quotationRestoredStatus: result.restoredStatus || null,
      quotationReversalCompletedAt: FieldValue.serverTimestamp(),
      lastError: null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function markConsumerFailure(ref, name, error, fallbackMessage) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const request = snap.data();
    const previous = request.reversalConsumers?.[name] || {};
    const attemptCount = Number(previous.attemptCount || 0);
    const terminal = attemptCount >= MAX_ATTEMPTS;
    const message = error instanceof Error ? error.message.slice(0, 1000) : String(error || fallbackMessage).slice(0, 1000);
    const next = {
      ...previous,
      status: 'FAILED',
      lastError: message,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date().toISOString(),
      requiresManualReview: terminal
    };
    const consumers = { ...(request.reversalConsumers || {}), [name]: next };
    tx.update(ref, {
      [`reversalConsumers.${name}`]: next,
      reversalState: 'FAILED',
      status: 'FAILED',
      lastError: message,
      requiresManualReview: terminal || Object.values(consumers).some(state => Boolean(state?.requiresManualReview)),
      manualReviewAt: terminal ? (request.manualReviewAt || FieldValue.serverTimestamp()) : request.manualReviewAt || null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function markInventoryFailure(ref, error) {
  return markConsumerFailure(ref, 'inventory', error, 'Unknown inventory reversal error');
}

async function markPaymentFailure(ref, error) {
  return markConsumerFailure(ref, 'payment', error, 'Unknown payment reversal error');
}

async function markWelfareFailure(ref, error) {
  return markConsumerFailure(ref, 'welfare', error, 'Unknown welfare reversal error');
}

async function markInstitutionalCreditFailure(ref, error) {
  return markConsumerFailure(ref, 'institutionalCredit', error, 'Unknown institutional credit reversal error');
}

async function markQuotationFailure(ref, error) {
  return markConsumerFailure(ref, 'quotation', error, 'Unknown quotation reversal error');
}

async function releaseRequestLease(ref) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const request = snap.data();
    if (request.leaseOwner !== WORKER_ID) return;
    const reversalState = deriveReversalState(request.reversalConsumers || {});
    tx.update(ref, {
      reversalState,
      status: reversalState === 'REVERSAL_COMPLETE' ? 'REVERSAL_COMPLETE' : request.status === 'FAILED' ? 'FAILED' : 'PROCESSING',
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: FieldValue.serverTimestamp()
    });
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

async function processInventoryStage(ref, claimed) {
  const inventoryState = claimed.reversalConsumers?.inventory?.status;
  const consumptionState = claimed.reversalConsumers?.consumption?.status;
  if (inventoryState === 'NOT_APPLICABLE') return { skipped: true, reason: 'NOT_APPLICABLE' };
  if (inventoryState === 'COMPLETED' && (consumptionState === 'COMPLETED' || consumptionState === 'NOT_APPLICABLE')) {
    return { skipped: true, reason: 'ALREADY_COMPLETED' };
  }

  const marked = inventoryState === 'COMPLETED' ? true : await markConsumerProcessing(ref, 'inventory');
  if (!marked) return { skipped: true, reason: 'LEASE_OR_STATE_NOT_RUNNABLE' };

  const sale = await loadOriginalSale(claimed.originalSaleId);
  try {
    const result = await executeInventoryAndConsumptionReversal({
      db,
      sale,
      revisionId: claimed.revisionId,
      workerId: WORKER_ID,
      FieldValue
    });
    await markInventoryAndConsumptionCompleted(ref, result);
    return { skipped: false, ...result };
  } catch (error) {
    await markInventoryFailure(ref, error);
    throw error;
  }
}

async function processPaymentStage(ref, claimed) {
  const paymentState = claimed.reversalConsumers?.payment?.status;
  if (paymentState === 'NOT_APPLICABLE') return { skipped: true, reason: 'NOT_APPLICABLE' };
  if (paymentState === 'COMPLETED') return { skipped: true, reason: 'ALREADY_COMPLETED' };

  const marked = await markConsumerProcessing(ref, 'payment');
  if (!marked) return { skipped: true, reason: 'LEASE_OR_STATE_NOT_RUNNABLE' };

  const sale = await loadOriginalSale(claimed.originalSaleId);
  const payment = await loadCanonicalPayment(claimed.canonicalPaymentId);
  try {
    const result = await executePaymentReversal({
      db,
      sale,
      payment,
      revisionId: claimed.revisionId,
      requestedBy: claimed.requestedBy,
      requestedByName: claimed.requestedByName,
      reason: claimed.reason,
      FieldValue
    });
    await markPaymentCompleted(ref, result);
    return { skipped: false, ...result };
  } catch (error) {
    await markPaymentFailure(ref, error);
    throw error;
  }
}

async function processWelfareStage(ref, claimed) {
  const welfareState = claimed.reversalConsumers?.welfare?.status;
  if (welfareState === 'NOT_APPLICABLE') return { skipped: true, reason: 'NOT_APPLICABLE' };
  if (welfareState === 'COMPLETED') return { skipped: true, reason: 'ALREADY_COMPLETED' };

  const marked = await markConsumerProcessing(ref, 'welfare');
  if (!marked) return { skipped: true, reason: 'LEASE_OR_STATE_NOT_RUNNABLE' };

  const sale = await loadOriginalSale(claimed.originalSaleId);
  const payment = await loadCanonicalPayment(claimed.canonicalPaymentId);
  try {
    const result = await executeWelfareReversal({
      db,
      sale,
      payment,
      revisionId: claimed.revisionId,
      requestedBy: claimed.requestedBy,
      requestedByName: claimed.requestedByName,
      reason: claimed.reason,
      FieldValue
    });
    await markWelfareCompleted(ref, result);
    return { skipped: false, ...result };
  } catch (error) {
    await markWelfareFailure(ref, error);
    throw error;
  }
}

async function processInstitutionalCreditStage(ref, claimed) {
  const state = claimed.reversalConsumers?.institutionalCredit?.status;
  if (state === 'NOT_APPLICABLE') return { skipped: true, reason: 'NOT_APPLICABLE' };
  if (state === 'COMPLETED') return { skipped: true, reason: 'ALREADY_COMPLETED' };

  const marked = await markConsumerProcessing(ref, 'institutionalCredit');
  if (!marked) return { skipped: true, reason: 'LEASE_OR_STATE_NOT_RUNNABLE' };

  const sale = await loadOriginalSale(claimed.originalSaleId);
  const payment = await loadCanonicalPayment(claimed.canonicalPaymentId);
  try {
    const result = await executeInstitutionalCreditReversal({
      db,
      sale,
      payment,
      revisionId: claimed.revisionId,
      requestedBy: claimed.requestedBy,
      requestedByName: claimed.requestedByName,
      reason: claimed.reason,
      FieldValue
    });
    await markInstitutionalCreditCompleted(ref, result);
    return { skipped: false, ...result };
  } catch (error) {
    await markInstitutionalCreditFailure(ref, error);
    throw error;
  }
}

async function processQuotationStage(ref, claimed) {
  const state = claimed.reversalConsumers?.quotation?.status;
  if (state === 'NOT_APPLICABLE') return { skipped: true, reason: 'NOT_APPLICABLE' };
  if (state === 'COMPLETED') return { skipped: true, reason: 'ALREADY_COMPLETED' };

  const marked = await markConsumerProcessing(ref, 'quotation');
  if (!marked) return { skipped: true, reason: 'LEASE_OR_STATE_NOT_RUNNABLE' };

  const sale = await loadOriginalSale(claimed.originalSaleId);
  try {
    const result = await executeQuotationReversal({
      db,
      sale,
      revisionId: claimed.revisionId,
      requestedBy: claimed.requestedBy,
      requestedByName: claimed.requestedByName,
      reason: claimed.reason,
      FieldValue
    });
    await markQuotationCompleted(ref, result);
    return { skipped: false, ...result };
  } catch (error) {
    await markQuotationFailure(ref, error);
    throw error;
  }
}

async function processLifecycleCloseout(ref) {
  return closeoutRevisionReversal({ db, requestRef: ref, FieldValue });
}

async function candidateRefs() {
  const snapshot = await db.collection('pos_sale_revision_requests')
    .where('status', 'in', ['PENDING', 'FAILED', 'PROCESSING', 'REVERSAL_COMPLETE'])
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
  const summary = {
    candidates: refs.length,
    claimed: 0,
    inventoryProcessed: 0,
    paymentProcessed: 0,
    welfareProcessed: 0,
    institutionalCreditProcessed: 0,
    quotationProcessed: 0,
    lifecycleClosed: 0,
    skipped: 0,
    failed: 0
  };

  for (const ref of refs) {
    try {
      const claimed = await claimRevisionRequest(ref);
      if (!claimed) {
        summary.skipped += 1;
        continue;
      }

      summary.claimed += 1;
      const inventory = await processInventoryStage(ref, claimed);
      if (!inventory.skipped) summary.inventoryProcessed += 1;
      const payment = await processPaymentStage(ref, claimed);
      if (!payment.skipped) summary.paymentProcessed += 1;
      const welfare = await processWelfareStage(ref, claimed);
      if (!welfare.skipped) summary.welfareProcessed += 1;
      const institutionalCredit = await processInstitutionalCreditStage(ref, claimed);
      if (!institutionalCredit.skipped) summary.institutionalCreditProcessed += 1;
      const quotation = await processQuotationStage(ref, claimed);
      if (!quotation.skipped) summary.quotationProcessed += 1;
      const closeout = await processLifecycleCloseout(ref);
      if (!closeout.replayed) summary.lifecycleClosed += 1;
      await releaseRequestLease(ref);
      console.log(JSON.stringify({ mode: 'revision-credit', workerId: WORKER_ID, ...claimed, inventory, payment, welfare, institutionalCredit, quotation, closeout }));
    } catch (error) {
      summary.failed += 1;
      console.error(`[POS V2 revision worker] ${ref.id}:`, error);
      const snap = await ref.get();
      if (snap.exists && snap.data()?.status !== 'FAILED') await markClaimFailure(ref, error);
    }
  }

  console.log(JSON.stringify({ mode: 'revision-credit', workerId: WORKER_ID, ...summary }, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error('[POS V2 revision worker fatal]', error);
  process.exitCode = 1;
});