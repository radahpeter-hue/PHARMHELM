import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clearPendingPosCheckoutV2Attempt,
  loadPendingPosCheckoutV2Attempt,
  savePendingPosCheckoutV2Attempt
} from '../src/services/pos-v2/posCheckoutV2ActivationService';
import { resolvePosCheckoutV2Mode } from '../src/services/pos-v2/posCheckoutV2FeatureService';
import { buildPosV2ActivationPlan, stableActivationAuditId } from '../scripts/pos-v2-batch6-activation-core.mjs';

class MemoryStorage {
  rows = new Map<string, string>();
  getItem(key: string) { return this.rows.get(key) ?? null; }
  setItem(key: string, value: string) { this.rows.set(key, value); }
  removeItem(key: string) { this.rows.delete(key); }
}

const activeTenant = { features: { posCheckoutV2Enabled: false }, posCheckoutEngine: 'shadow' };
const activeBranch = { tenantId: 'tenant-1', status: 'Active', posCheckoutEngine: 'legacy' };

test('pending V2 attempt marker survives reload without storing commercial or patient data', () => {
  const storage = new MemoryStorage();
  const attempt = {
    version: 1 as const,
    attemptId: 'attempt-1',
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    operatorUid: 'operator-1',
    engine: 'v2' as const,
    createdAt: '2026-09-17T12:00:00.000Z'
  };
  savePendingPosCheckoutV2Attempt(storage, attempt);
  assert.deepEqual(loadPendingPosCheckoutV2Attempt(storage, 'operator-1'), attempt);
  const serialized = Array.from(storage.rows.values()).join(' ');
  for (const forbidden of ['patient', 'institution', 'prescriber', 'items', 'basket', 'paymentMethod']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  clearPendingPosCheckoutV2Attempt(storage, 'operator-1');
  assert.equal(loadPendingPosCheckoutV2Attempt(storage, 'operator-1'), null);
});

test('old pending markers remain recoverable and malformed markers fail closed', () => {
  const storage = new MemoryStorage();
  savePendingPosCheckoutV2Attempt(storage, {
    version: 1,
    attemptId: 'attempt-1', tenantId: 'tenant-1', branchId: 'branch-1', operatorUid: 'operator-1', engine: 'v2',
    createdAt: '2026-09-10T00:00:00.000Z'
  });
  assert.equal(loadPendingPosCheckoutV2Attempt(storage, 'operator-1')?.attemptId, 'attempt-1');
  storage.setItem('pharmhelm:pos-v2:pending-attempt:operator-1', '{broken');
  assert.throws(() => loadPendingPosCheckoutV2Attempt(storage, 'operator-1'), /unreadable/);
  assert.equal(storage.getItem('pharmhelm:pos-v2:pending-attempt:operator-1'), '{broken');
});

test('activation dry run targets only the exact tenant and branch configuration fields', () => {
  const plan = buildPosV2ActivationPlan({
    operation: 'activate', tenantId: 'tenant-1', branchId: 'branch-1', tenant: activeTenant, branch: activeBranch
  });
  assert.deepEqual(plan.tenantUpdate, { 'features.posCheckoutV2Enabled': true, posCheckoutEngine: 'legacy' });
  assert.deepEqual(plan.branchUpdate, { posCheckoutEngine: 'v2' });
  assert.deepEqual(plan.desired, { tenantFeatureEnabled: true, tenantEngine: 'legacy', branchEngine: 'v2' });
  assert.equal('sales' in plan, false);
  assert.equal('inventory' in plan, false);
});

test('activation rejects missing records, cross-tenant branches and inactive branches', () => {
  assert.throws(() => buildPosV2ActivationPlan({ operation: 'activate', tenantId: 'tenant-1', branchId: 'branch-1', tenant: null, branch: activeBranch }), /does not exist/);
  assert.throws(() => buildPosV2ActivationPlan({ operation: 'activate', tenantId: 'tenant-1', branchId: 'branch-1', tenant: activeTenant, branch: null }), /does not exist/);
  assert.throws(() => buildPosV2ActivationPlan({ operation: 'activate', tenantId: 'tenant-1', branchId: 'branch-1', tenant: activeTenant, branch: { ...activeBranch, tenantId: 'tenant-2' } }), /does not belong/);
  assert.throws(() => buildPosV2ActivationPlan({ operation: 'activate', tenantId: 'tenant-1', branchId: 'branch-1', tenant: activeTenant, branch: { ...activeBranch, status: 'Inactive' } }), /not active/);
});

test('activation is idempotent and rollback changes only the selected branch engine', () => {
  const alreadyActive = buildPosV2ActivationPlan({
    operation: 'activate', tenantId: 'tenant-1', branchId: 'branch-1',
    tenant: { features: { posCheckoutV2Enabled: true }, posCheckoutEngine: 'legacy' },
    branch: { ...activeBranch, posCheckoutEngine: 'v2' }
  });
  assert.deepEqual(alreadyActive.changes, { tenantFeatureEnabled: false, tenantEngine: false, branchEngine: false });
  const rollback = buildPosV2ActivationPlan({
    operation: 'rollback', tenantId: 'tenant-1', branchId: 'branch-1',
    tenant: { features: { posCheckoutV2Enabled: true }, posCheckoutEngine: 'legacy' },
    branch: { ...activeBranch, posCheckoutEngine: 'v2' }
  });
  assert.equal(rollback.tenantUpdate, null);
  assert.deepEqual(rollback.branchUpdate, { posCheckoutEngine: 'legacy' });
  assert.deepEqual(rollback.desired, { tenantFeatureEnabled: true, tenantEngine: 'legacy', branchEngine: 'legacy' });
});

test('activation and rollback resolve new attempts while existing attempt pinning remains independent', () => {
  assert.equal(resolvePosCheckoutV2Mode({
    tenant: { features: { posCheckoutV2Enabled: true }, posCheckoutEngine: 'legacy' },
    branch: { posCheckoutEngine: 'v2' }
  }).effectiveMode, 'v2');
  assert.equal(resolvePosCheckoutV2Mode({
    tenant: { features: { posCheckoutV2Enabled: true }, posCheckoutEngine: 'legacy' },
    branch: { posCheckoutEngine: 'legacy' }
  }).effectiveMode, 'legacy');
});

test('activation audit identity is deterministic and scoped to the exact target', () => {
  const input = { runId: '100-1', operation: 'activate', tenantId: 'tenant-1', branchId: 'branch-1' };
  assert.equal(stableActivationAuditId(input), stableActivationAuditId(input));
  assert.notEqual(stableActivationAuditId(input), stableActivationAuditId({ ...input, branchId: 'branch-2' }));
});

test('V2 sales are immutable in client rules and Batch 4 exposes terminal state', () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  const worker = readFileSync('scripts/process-pos-v2-outbox.mjs', 'utf8');
  const sales = readFileSync('src/pages/Sales.tsx', 'utf8');
  const repository = readFileSync('src/services/pos-v2/posCheckoutV2Repository.ts', 'utf8');
  assert.match(rules, /allow update:[\s\S]{0,500}!\("engineVersion" in resource\.data\)[\s\S]{0,180}resource\.data\.engineVersion != 2/);
  assert.match(rules, /allow delete:[\s\S]{0,240}resource\.data\.engineVersion != 2/);
  assert.match(worker, /requiresManualReview/);
  assert.match(worker, /manualReviewAt/);
  assert.match(worker, /expiredLeases/);
  assert.match(worker, /report\.requiresProcessing > 0/);
  assert.match(worker, /report\.manualReview > 0/);
  assert.match(sales, /loadPendingPosCheckoutV2Attempt/);
  assert.match(sales, /recoverCheckoutV2Attempt/);
  assert.match(sales, /savePendingPosCheckoutV2Attempt/);
  assert.match(repository, /recoverCompletedCheckoutV2/);
});
