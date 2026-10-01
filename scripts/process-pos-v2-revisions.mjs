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
      attemptCount: nextAttempt,
      resumed: resumingOwnLock
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
  const summary = { candidates: refs.length, claimed: 0, skipped: 0, failed: 0 };

  for (const ref of refs) {
    try {
      const claimed = await claimRevisionRequest(ref);
      if (claimed) {
        summary.claimed += 1;
        console.log(JSON.stringify({ mode: 'revision-intake', workerId: WORKER_ID, ...claimed }));
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`[POS V2 revision intake] ${ref.id}:`, error);
      await markClaimFailure(ref, error);
    }
  }

  console.log(JSON.stringify({ mode: 'revision-intake', workerId: WORKER_ID, ...summary }, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error('[POS V2 revision worker fatal]', error);
  process.exitCode = 1;
});