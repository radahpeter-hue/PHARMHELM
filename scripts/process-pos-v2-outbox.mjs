#!/usr/bin/env node
import { createPosV2ConsumerPosters } from './pos-v2-consumer-posting.mjs';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  BATCH4_CONSUMERS,
  DEFAULT_LEASE_SECONDS,
  MAX_CONSUMER_ATTEMPTS,
  consumptionSummaryId,
  dateKeyForTimezone,
  deriveGlobalStatus,
  groupedSaleProducts,
  initializeConsumers,
  isTerminallySupersededOutbox,
  movementEventId,
  numberValue,
  paymentComponentAmount,
  snapshotBaseQuantityForItem,
  structuredError,
  validateEnvelope,
  welfarePostingIds
} from './pos-v2-batch4-core.mjs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const WORKER_ID = process.env.POS_V2_WORKER_ID || `github-actions-${process.env.GITHUB_RUN_ID || Date.now()}`;
const LEASE_SECONDS = Math.max(60, Number(process.env.POS_V2_LEASE_SECONDS || DEFAULT_LEASE_SECONDS));
const MAX_EVENTS = Math.max(1, Math.min(100, Number(process.env.POS_V2_MAX_EVENTS || 25)));
const MODE = process.argv.includes('--reconcile') ? 'reconcile' : 'process';

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
const nowIso = () => new Date().toISOString();

function isLeaseExpired(value) {
  if (!value) return true;
  const millis = typeof value?.toMillis === 'function' ? value.toMillis() : new Date(value).getTime();
  return !Number.isFinite(millis) || millis <= Date.now();
}

function consumerCanRun(state) {
  if (!state) return true;
  if (state.status === 'COMPLETED' || state.status === 'NOT_APPLICABLE') return false;
  if (state.status === 'PROCESSING' && !isLeaseExpired(state.leaseExpiresAt)) return false;
  return Number(state.attemptCount || 0) < MAX_CONSUMER_ATTEMPTS;
}

async function loadCanonical(event) {
  const [saleSnap, paymentSnap] = await Promise.all([
    db.collection('sales').doc(event.saleId).get(),
    db.collection('pos_payments').doc(event.paymentId).get()
  ]);
  const sale = saleSnap.exists ? { id: saleSnap.id, ...saleSnap.data() } : null;
  const payment = paymentSnap.exists ? { id: paymentSnap.id, ...paymentSnap.data() } : null;
  validateEnvelope({ event, sale, payment });
  return { sale, payment };
}

async function claimEvent(ref) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const event = { id: snap.id, ...snap.data() };
    if (event.eventType !== 'POS_SALE_COMMITTED' || event.engineVersion !== 2) return null;
    if (event.status === 'PROCESSED' || event.status === 'SUPERSEDED') return null;
    if (event.status === 'PROCESSING' && !isLeaseExpired(event.leaseExpiresAt)) return null;

    const leaseExpiresAt = Timestamp.fromMillis(Date.now() + LEASE_SECONDS * 1000);
    tx.update(ref, {
      status: 'PROCESSING',
      leaseOwner: WORKER_ID,
      leaseExpiresAt,
      lastAttemptAt: FieldValue.serverTimestamp(),
      attemptCount: Number(event.attemptCount || 0) + 1,
      updatedAt: FieldValue.serverTimestamp()
    });
    return { ...event, attemptCount: Number(event.attemptCount || 0) + 1 };
  });
}

async function ensureConsumers(ref, sale, payment) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Outbox event disappeared while initializing consumers.');
    const event = snap.data();
    if (event.leaseOwner !== WORKER_ID) throw new Error('Outbox lease was lost before consumer initialization.');
    const consumers = initializeConsumers({
      sale,
      payment,
      existingConsumers: event.consumers || {},
      nowIso: nowIso()
    });
    const status = deriveGlobalStatus(consumers);
    tx.update(ref, { consumers, status, updatedAt: FieldValue.serverTimestamp() });
    return consumers;
  });
}

async function markConsumerProcessing(ref, name) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const event = snap.data();
    if (event.leaseOwner !== WORKER_ID || isLeaseExpired(event.leaseExpiresAt)) return false;
    const state = event.consumers?.[name];
    if (!consumerCanRun(state)) return false;
    const attemptCount = Number(state?.attemptCount || 0) + 1;
    tx.update(ref, {
      [`consumers.${name}.status`]: 'PROCESSING',
      [`consumers.${name}.attemptCount`]: attemptCount,
      [`consumers.${name}.leaseOwner`]: WORKER_ID,
      [`consumers.${name}.leaseExpiresAt`]: event.leaseExpiresAt,
      [`consumers.${name}.lastAttemptAt`]: FieldValue.serverTimestamp(),
      [`consumers.${name}.updatedAt`]: FieldValue.serverTimestamp(),
      [`consumers.${name}.lastError`]: null,
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
    const event = snap.data();
    if (event.status === 'SUPERSEDED' || event.leaseOwner !== WORKER_ID) return;
    const previous = event.consumers?.[name] || {};
    const failed = Boolean(error);
    const terminal = failed && Number(previous.attemptCount || 0) >= MAX_CONSUMER_ATTEMPTS;
    const nextState = {
      ...previous,
      status: failed ? 'FAILED' : 'COMPLETED',
      lastError: failed ? structuredError(error) : null,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: failed ? null : nowIso(),
      updatedAt: nowIso(),
      requiresManualReview: terminal
    };
    const consumers = { ...(event.consumers || {}), [name]: nextState };
    const status = deriveGlobalStatus(consumers);
    const requiresManualReview = Object.values(consumers).some(state => Boolean(state?.requiresManualReview));
    tx.update(ref, {
      [`consumers.${name}`]: nextState,
      status,
      requiresManualReview,
      manualReviewAt: requiresManualReview ? (event.manualReviewAt || FieldValue.serverTimestamp()) : null,
      lastError: failed ? structuredError(error).message : null,
      processedAt: status === 'PROCESSED' ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function releaseEvent(ref) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const event = snap.data();
    if (event.leaseOwner !== WORKER_ID) return;
    const status = deriveGlobalStatus(event.consumers || {});
    tx.update(ref, {
      status,
      leaseOwner: null,
      leaseExpiresAt: null,
      processedAt: status === 'PROCESSED' ? FieldValue.serverTimestamp() : event.processedAt || null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

const { postConsumption, postWelfare, postInstitutionalCredit, postQuotation } = createPosV2ConsumerPosters({ db, FieldValue, workerId: WORKER_ID, requireLease: true });

const processors = {
  consumption: ({ sale }) => postConsumption(sale),
  welfare: ({ sale, payment }) => postWelfare(sale, payment),
  institutionalCredit: ({ sale, payment }) => postInstitutionalCredit(sale, payment),
  quotation: ({ sale }) => postQuotation(sale)
};

async function processEvent(ref) {
  const claimed = await claimEvent(ref);
  if (!claimed) return { skipped: true };
  let canonical;
  try {
    canonical = await loadCanonical(claimed);
    await ensureConsumers(ref, canonical.sale, canonical.payment);
  } catch (error) {
    const terminal = Number(claimed.attemptCount || 0) >= MAX_CONSUMER_ATTEMPTS;
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.data().status === 'SUPERSEDED' || snapshot.data().leaseOwner !== WORKER_ID) return;
      tx.set(ref, {
      status: 'FAILED',
      lastError: structuredError(error).message,
      requiresManualReview: terminal,
      manualReviewAt: terminal ? FieldValue.serverTimestamp() : null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    });
    return { failed: true, error };
  }

  for (const name of BATCH4_CONSUMERS) {
    const canRun = await markConsumerProcessing(ref, name);
    if (!canRun) continue;
    try {
      await processors[name](canonical);
      await markConsumerResult(ref, name, null);
    } catch (error) {
      console.error(`[Batch4] ${ref.id} consumer ${name} failed:`, error);
      await markConsumerResult(ref, name, error);
    }
  }
  await releaseEvent(ref);
  return { processed: true };
}

async function candidateRefs() {
  const snapshot = await db.collection('pos_transaction_outbox')
    .where('status', 'in', ['PENDING', 'FAILED', 'PROCESSING'])
    .limit(MAX_EVENTS * 3)
    .get();
  return snapshot.docs
    .filter(doc => {
      const data = doc.data();
      if (data.eventType !== 'POS_SALE_COMMITTED' || data.engineVersion !== 2) return false;
      if (data.requiresManualReview === true) return false;
      if (data.status === 'PROCESSING' && !isLeaseExpired(data.leaseExpiresAt)) return false;
      return true;
    })
    .slice(0, MAX_EVENTS)
    .map(doc => doc.ref);
}

async function reconciliationReport() {
  const snapshot = await db.collection('pos_transaction_outbox')
    .where('eventType', '==', 'POS_SALE_COMMITTED')
    .get();
  const report = {
    checked: 0,
    healthy: 0,
    requiresProcessing: 0,
    inconsistent: 0,
    pending: 0,
    processing: 0,
    failed: 0,
    manualReview: 0,
    expiredLeases: 0,
    superseded: 0,
    consumers: Object.fromEntries(BATCH4_CONSUMERS.map(name => [name, {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      notApplicable: 0,
      manualReview: 0
    }])),
    problemEvents: []
  };
  for (const snap of snapshot.docs) {
    const event = { id: snap.id, ...snap.data() };
    if (event.engineVersion !== 2) continue;
    report.checked += 1;
    const globalStatus = String(event.status || 'PENDING').toUpperCase();
    if (isTerminallySupersededOutbox(event)) {
      report.superseded += 1;
      try {
        await loadCanonical(event);
        report.healthy += 1;
      } catch (error) {
        report.inconsistent += 1;
        if (report.problemEvents.length < 25) {
          report.problemEvents.push({
            eventId: event.id,
            status: globalStatus,
            requiresManualReview: event.requiresManualReview === true,
            error: structuredError(error).message
          });
        }
        console.error(`[Batch4 reconcile] ${event.id}:`, error);
      }
      continue;
    }
    if (globalStatus === 'PENDING') report.pending += 1;
    else if (globalStatus === 'PROCESSING') report.processing += 1;
    else if (globalStatus === 'FAILED') report.failed += 1;
    if (event.requiresManualReview === true) report.manualReview += 1;
    if (globalStatus === 'PROCESSING' && isLeaseExpired(event.leaseExpiresAt)) report.expiredLeases += 1;
    for (const name of BATCH4_CONSUMERS) {
      const state = event.consumers?.[name];
      const status = String(state?.status || 'PENDING').toUpperCase();
      const bucket = status === 'NOT_APPLICABLE' ? 'notApplicable' : status.toLowerCase();
      if (bucket in report.consumers[name]) report.consumers[name][bucket] += 1;
      if (state?.requiresManualReview === true) report.consumers[name].manualReview += 1;
    }
    try {
      const { sale, payment } = await loadCanonical(event);
      const expected = initializeConsumers({ sale, payment, existingConsumers: event.consumers || {}, nowIso: nowIso() });
      const status = deriveGlobalStatus(expected);
      if (status === 'PROCESSED') report.healthy += 1;
      else report.requiresProcessing += 1;
      if (
        (status !== 'PROCESSED' || event.requiresManualReview === true)
        && report.problemEvents.length < 25
      ) {
        report.problemEvents.push({
          eventId: event.id,
          status: globalStatus,
          derivedStatus: status,
          requiresManualReview: event.requiresManualReview === true,
          error: event.lastError || null
        });
      }
    } catch (error) {
      report.inconsistent += 1;
      if (report.problemEvents.length < 25) {
        report.problemEvents.push({
          eventId: event.id,
          status: globalStatus,
          requiresManualReview: event.requiresManualReview === true,
          error: structuredError(error).message
        });
      }
      console.error(`[Batch4 reconcile] ${event.id}:`, error);
    }
  }
  console.log(JSON.stringify({ mode: 'reconcile', ...report }, null, 2));
  if (
    report.inconsistent > 0
    || report.requiresProcessing > 0
    || report.manualReview > 0
    || report.expiredLeases > 0
  ) process.exitCode = 2;
}

async function main() {
  if (MODE === 'reconcile') return reconciliationReport();
  const refs = await candidateRefs();
  const summary = { candidates: refs.length, processed: 0, skipped: 0, failed: 0 };
  for (const ref of refs) {
    const result = await processEvent(ref);
    if (result.processed) summary.processed += 1;
    else if (result.failed) summary.failed += 1;
    else summary.skipped += 1;
  }
  console.log(JSON.stringify({ mode: 'process', workerId: WORKER_ID, ...summary }, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error('[Batch4 fatal]', error);
  process.exitCode = 1;
});
