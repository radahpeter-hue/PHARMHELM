#!/usr/bin/env node
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { completeRevisionLifecycle } from './pos-v2-revision-completion-executor.mjs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const MAX_REQUESTS = Math.max(1, Math.min(50, Number(process.env.POS_V2_REVISION_COMPLETION_MAX_REQUESTS || 10)));

function initializeAdmin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    return initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
  }
  return initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}

function clean(value) {
  return String(value ?? '').trim();
}

const app = initializeAdmin();
const db = getFirestore(app, DATABASE_ID);

async function candidateRefs() {
  const snapshot = await db.collection('pos_sale_revision_requests')
    .where('status', '==', 'REPLACEMENT_CREATED')
    .limit(MAX_REQUESTS * 3)
    .get();

  return snapshot.docs
    .filter(doc => {
      const data = doc.data();
      return Number(data.engineVersion || 0) === 2
        && clean(data.revisionId)
        && clean(data.originalSaleId)
        && clean(data.replacementSaleId || data.pendingReplacementSaleId)
        && clean(data.replacementPaymentId)
        && clean(data.replacementOutboxEventId);
    })
    .slice(0, MAX_REQUESTS)
    .map(doc => doc.ref);
}

async function completionReadiness(ref) {
  const requestSnap = await ref.get();
  if (!requestSnap.exists) return { ready: false, reason: 'REQUEST_MISSING' };
  const request = requestSnap.data();
  if (clean(request.status) !== 'REPLACEMENT_CREATED') return { ready: false, reason: 'STATE_CHANGED' };

  const outboxId = clean(request.replacementOutboxEventId);
  if (!outboxId) return { ready: false, reason: 'OUTBOX_IDENTITY_MISSING' };

  const outboxSnap = await db.collection('pos_transaction_outbox').doc(outboxId).get();
  if (!outboxSnap.exists) return { ready: false, reason: 'AWAITING_REPLACEMENT_OUTBOX' };
  const outbox = outboxSnap.data();
  if (clean(outbox.status) !== 'PROCESSED') {
    return { ready: false, reason: 'AWAITING_DOWNSTREAM_POSTING', outboxStatus: clean(outbox.status) || 'UNKNOWN' };
  }

  return { ready: true, outboxId };
}

async function main() {
  const refs = await candidateRefs();
  const summary = {
    candidates: refs.length,
    awaitingOutbox: 0,
    awaitingDownstream: 0,
    completed: 0,
    replayed: 0,
    skipped: 0,
    failed: 0
  };

  for (const ref of refs) {
    try {
      const readiness = await completionReadiness(ref);
      if (!readiness.ready) {
        if (readiness.reason === 'AWAITING_REPLACEMENT_OUTBOX') summary.awaitingOutbox += 1;
        else if (readiness.reason === 'AWAITING_DOWNSTREAM_POSTING') summary.awaitingDownstream += 1;
        else summary.skipped += 1;
        console.log(JSON.stringify({ mode: 'revision-completion', requestId: ref.id, ...readiness }));
        continue;
      }

      const result = await completeRevisionLifecycle({ db, requestRef: ref, FieldValue });
      if (result.replayed) summary.replayed += 1;
      else summary.completed += 1;
      console.log(JSON.stringify({ mode: 'revision-completion', requestId: ref.id, ...result }));
    } catch (error) {
      summary.failed += 1;
      console.error(`[POS V2 revision completion worker] ${ref.id}:`, error);
    }
  }

  console.log(JSON.stringify({ mode: 'revision-completion', ...summary }, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error('[POS V2 revision completion worker fatal]', error);
  process.exitCode = 1;
});
