#!/usr/bin/env node
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { finalizeRevisionReplacementLinkage } from './pos-v2-revision-replacement-finalizer.mjs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const MAX_REQUESTS = Math.max(1, Math.min(50, Number(process.env.POS_V2_REVISION_REPLACEMENT_MAX_REQUESTS || 10)));

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
    .where('status', '==', 'REPLACEMENT_PENDING')
    .limit(MAX_REQUESTS * 3)
    .get();

  return snapshot.docs
    .filter(doc => {
      const data = doc.data();
      return Number(data.engineVersion || 0) === 2
        && clean(data.revisionId)
        && clean(data.originalSaleId)
        && clean(data.pendingReplacementSaleId || data.replacementSaleId);
    })
    .slice(0, MAX_REQUESTS)
    .map(doc => doc.ref);
}

async function replacementExists(ref) {
  const requestSnap = await ref.get();
  if (!requestSnap.exists) return { ready: false, reason: 'REQUEST_MISSING' };
  const request = requestSnap.data();
  if (clean(request.status) !== 'REPLACEMENT_PENDING') return { ready: false, reason: 'STATE_CHANGED' };

  const replacementSaleId = clean(request.pendingReplacementSaleId || request.replacementSaleId);
  if (!replacementSaleId) return { ready: false, reason: 'IDENTITY_MISSING' };

  const replacementSnap = await db.collection('sales').doc(replacementSaleId).get();
  if (!replacementSnap.exists) return { ready: false, reason: 'AWAITING_REPLACEMENT_CHECKOUT' };
  return { ready: true, replacementSaleId };
}

async function main() {
  const refs = await candidateRefs();
  const summary = {
    candidates: refs.length,
    awaitingCheckout: 0,
    finalized: 0,
    replayed: 0,
    skipped: 0,
    failed: 0
  };

  for (const ref of refs) {
    try {
      const readiness = await replacementExists(ref);
      if (!readiness.ready) {
        if (readiness.reason === 'AWAITING_REPLACEMENT_CHECKOUT') summary.awaitingCheckout += 1;
        else summary.skipped += 1;
        console.log(JSON.stringify({ mode: 'revision-replacement-linkage', requestId: ref.id, ...readiness }));
        continue;
      }

      const result = await finalizeRevisionReplacementLinkage({ db, requestRef: ref, FieldValue });
      if (result.replayed) summary.replayed += 1;
      else summary.finalized += 1;
      console.log(JSON.stringify({ mode: 'revision-replacement-linkage', requestId: ref.id, ...result }));
    } catch (error) {
      summary.failed += 1;
      console.error(`[POS V2 revision replacement worker] ${ref.id}:`, error);
    }
  }

  console.log(JSON.stringify({ mode: 'revision-replacement-linkage', ...summary }, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error('[POS V2 revision replacement worker fatal]', error);
  process.exitCode = 1;
});
