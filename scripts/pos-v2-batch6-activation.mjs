#!/usr/bin/env node
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { buildPosV2ActivationPlan, stableActivationAuditId } from './pos-v2-batch6-activation-core.mjs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const operation = String(process.env.POS_V2_OPERATION || 'inspect').trim();
const tenantId = String(process.env.POS_V2_TENANT_ID || '').trim();
const branchId = String(process.env.POS_V2_BRANCH_ID || '').trim();
const reason = String(process.env.POS_V2_REASON || '').trim();
const actor = String(process.env.GITHUB_ACTOR || process.env.POS_V2_ACTOR || 'unknown').trim();
const runId = process.env.GITHUB_RUN_ID
  ? `${String(process.env.GITHUB_RUN_ID).trim()}-${String(process.env.GITHUB_RUN_ATTEMPT || '1').trim()}`
  : `local-${Date.now()}`;
const applyRequested = process.env.POS_V2_APPLY === 'true' && process.argv.includes('--apply');

function initializeAdmin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  return initializeApp({
    credential: raw ? cert(JSON.parse(raw)) : applicationDefault(),
    projectId: PROJECT_ID
  });
}

async function readConfiguration(db) {
  const [tenantSnap, branchSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection('branches').doc(branchId).get()
  ]);
  return {
    tenant: tenantSnap.exists ? tenantSnap.data() : null,
    branch: branchSnap.exists ? branchSnap.data() : null
  };
}

async function main() {
  if (!tenantId || !branchId) throw new Error('POS_V2_TENANT_ID and POS_V2_BRANCH_ID are required.');
  if (applyRequested && operation === 'inspect') throw new Error('Inspect mode cannot be applied.');
  if (applyRequested && !reason) throw new Error('A non-empty POS_V2_REASON is required for an applied change.');

  const db = getFirestore(initializeAdmin(), DATABASE_ID);
  const initial = await readConfiguration(db);
  const plan = buildPosV2ActivationPlan({ operation, tenantId, branchId, ...initial });
  console.log(JSON.stringify({ mode: applyRequested ? 'apply' : 'dry-run', projectId: PROJECT_ID, databaseId: DATABASE_ID, plan }, null, 2));
  if (!applyRequested || operation === 'inspect') return;

  const tenantRef = db.collection('tenants').doc(tenantId);
  const branchRef = db.collection('branches').doc(branchId);
  const auditId = stableActivationAuditId({ runId, operation, tenantId, branchId });
  const auditRef = db.collection('global_audit_logs').doc(auditId);
  let appliedPlan = plan;

  await db.runTransaction(async tx => {
    const [tenantSnap, branchSnap] = await Promise.all([tx.get(tenantRef), tx.get(branchRef)]);
    const livePlan = buildPosV2ActivationPlan({
      operation,
      tenantId,
      branchId,
      tenant: tenantSnap.exists ? tenantSnap.data() : null,
      branch: branchSnap.exists ? branchSnap.data() : null
    });
    appliedPlan = livePlan;
    if (livePlan.tenantUpdate) tx.update(tenantRef, { ...livePlan.tenantUpdate, updatedAt: FieldValue.serverTimestamp() });
    if (livePlan.branchUpdate) tx.update(branchRef, { ...livePlan.branchUpdate, updatedAt: FieldValue.serverTimestamp() });
    tx.create(auditRef, {
      tenantId,
      branchId,
      timestamp: FieldValue.serverTimestamp(),
      userId: actor,
      userName: actor,
      userRole: 'GitHub Actions production operator',
      module: 'POS V2 Batch 6',
      actionType: operation,
      objectAffected: 'POS checkout engine configuration',
      objectId: `${tenantId}/${branchId}`,
      reason,
      before: livePlan.current,
      after: livePlan.desired,
      githubRunId: runId,
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID
    });
  });

  const readback = await readConfiguration(db);
  const verified = buildPosV2ActivationPlan({ operation: 'inspect', tenantId, branchId, ...readback });
  const expected = appliedPlan.desired;
  if (
    verified.current.tenantFeatureEnabled !== expected.tenantFeatureEnabled
    || verified.current.tenantEngine !== expected.tenantEngine
    || verified.current.branchEngine !== expected.branchEngine
  ) {
    throw new Error('Configuration readback does not match the approved activation plan.');
  }
  console.log(JSON.stringify({ applied: true, auditId, readback: verified.current }, null, 2));
}

main().catch(error => {
  console.error('[POS V2 Batch 6 activation]', error);
  process.exitCode = 1;
});
