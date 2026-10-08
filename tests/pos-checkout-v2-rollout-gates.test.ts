import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPosV2ActivationPlan,
  buildPosV2Inventory,
  isTerminallySupersededOutbox
} from '../scripts/pos-v2-batch6-activation-core.mjs';

test('rollout inventory includes only active branches owned by an existing tenant', () => {
  const inventory = buildPosV2Inventory({
    tenants: [
      { id: 'tenant-a', name: 'Tenant A', features: { posCheckoutV2Enabled: true }, posCheckoutEngine: 'legacy' },
      { id: 'tenant-b', name: 'Tenant B' }
    ],
    branches: [
      { id: 'branch-a1', tenantId: 'tenant-a', name: 'Main', status: 'active', posCheckoutEngine: 'v2' },
      { id: 'branch-a2', tenantId: 'tenant-a', name: 'Closed', status: 'inactive' },
      { id: 'branch-b1', tenantId: 'tenant-b', name: 'Branch', status: 'active' },
      { id: 'orphan', tenantId: 'missing-tenant', name: 'Orphan', status: 'active' }
    ]
  });

  assert.deepEqual(inventory.eligiblePairs, [
    { tenantId: 'tenant-a', branchId: 'branch-a1' },
    { tenantId: 'tenant-b', branchId: 'branch-b1' }
  ]);
  assert.deepEqual(inventory.activeBranches.map(row => row.effectiveMode), ['v2', 'legacy']);
  assert.deepEqual(inventory.excludedBranches.map(row => [row.branchId, row.exclusion]), [
    ['branch-a2', 'branch-not-active'],
    ['orphan', 'missing-tenant-owner']
  ]);
  assert.equal(inventory.counts.tenants, 2);
  assert.equal(inventory.counts.eligiblePairs, 2);
});

test('activation plan preserves tenant-default legacy and overrides exactly the requested branch', () => {
  const tenant = { features: {}, posCheckoutEngine: 'legacy' };
  const branch = { tenantId: 'tenant-a', status: 'active', posCheckoutEngine: null };
  const plan = buildPosV2ActivationPlan({
    operation: 'activate',
    tenantId: 'tenant-a',
    branchId: 'branch-a1',
    tenant,
    branch
  });

  assert.deepEqual(plan.desired, {
    tenantFeatureEnabled: true,
    tenantEngine: 'legacy',
    branchEngine: 'v2'
  });
  assert.deepEqual(plan.branchUpdate, { posCheckoutEngine: 'v2' });
  assert.deepEqual(plan.tenantUpdate, {
    'features.posCheckoutV2Enabled': true,
    posCheckoutEngine: 'legacy'
  });

  assert.throws(() => buildPosV2ActivationPlan({
    operation: 'activate',
    tenantId: 'tenant-a',
    branchId: 'branch-b1',
    tenant,
    branch: { tenantId: 'tenant-b', status: 'active' }
  }), /does not belong/);
  assert.throws(() => buildPosV2ActivationPlan({
    operation: 'activate',
    tenantId: 'tenant-a',
    branchId: 'branch-inactive',
    tenant,
    branch: { tenantId: 'tenant-a', status: 'inactive' }
  }), /not active/);
});

test('rollback keeps the tenant default safe and returns the exact branch to legacy', () => {
  const plan = buildPosV2ActivationPlan({
    operation: 'rollback',
    tenantId: 'tenant-a',
    branchId: 'branch-a1',
    tenant: { features: { posCheckoutV2Enabled: true }, posCheckoutEngine: 'legacy' },
    branch: { tenantId: 'tenant-a', status: 'active', posCheckoutEngine: 'v2' }
  });

  assert.deepEqual(plan.desired, {
    tenantFeatureEnabled: true,
    tenantEngine: 'legacy',
    branchEngine: 'legacy'
  });
  assert.equal(plan.branchUpdate.posCheckoutEngine, 'legacy');
  assert.equal(plan.tenantUpdate, null);
});

test('superseded outbox events are recognized as terminal, not processable pending events', () => {
  assert.equal(isTerminallySupersededOutbox({ status: 'SUPERSEDED' }), true);
  assert.equal(isTerminallySupersededOutbox({ status: 'PROCESSED' }), false);
  assert.equal(isTerminallySupersededOutbox({ status: 'PENDING' }), false);
});
