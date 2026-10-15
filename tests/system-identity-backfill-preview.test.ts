import test from 'node:test';
import assert from 'node:assert/strict';
import { planIdentityBackfill } from '../scripts/identity-backfill-preview.mjs';

test('historical IDs and references stay unchanged; reserve above existing and active counter', () => {
  const records = {
    tenants: [{ id: 't-old', tenant_code:'TEN-000012' }, { id: 't-new' }],
    staff: [
      { id:'z-existing', tenantId:'t-old', staff_code:'STF-000025', employee_id:'LEGACY-09' },
      { id:'a-missing', tenantId:'t-old', employee_id:'LEGACY-09' },
      { id:'b-different-tenant', tenantId:'t-new' }
    ],
    branches: [{ id:'branch-hq', tenantId:'t-old', branch_code:'HQ-001' }]
  };
  const plan = planIdentityBackfill(records, [{ id:'t-old_staff', lastSequence:24 }]);
  assert.equal(plan.find(p => p.id === 't-old').status, 'PRESERVE');
  assert.equal(plan.find(p => p.id === 't-new').proposedCode, 'TEN-000013');
  assert.equal(plan.find(p => p.id === 'a-missing').proposedCode, 'STF-000026');
  assert.equal(records.staff[1].employee_id, 'LEGACY-09'); // no legacy rewrites
  assert.equal(plan.find(p => p.id === 'b-different-tenant').proposedCode, 'STF-000001');
  assert.equal(plan.find(p => p.id === 'branch-hq').existingCode, 'HQ-001');
});

test('planner does not collide with later-sorted codes and flags pre-existing duplicates', () => {
  const records = { clients: [
    { id:'first', tenantId:'tenant-a' },
    { id:'old-1', tenantId:'tenant-a', patient_code:'PAT-000003' },
    { id:'old-2', tenantId:'tenant-a', patient_code:'PAT-000003' }
  ] };
  const result = planIdentityBackfill(records);
  assert.equal(result.find(x=>x.id==='first').proposedCode, 'PAT-000004');
  assert.equal(result.some(x=>x.status==='DUPLICATE_EXISTING'), true);
});

test('operational master receives a proposed code but keeps the same document identity', () => {
  const result = planIdentityBackfill({ operational_inventory_masters: [
    { id:'immutable-master', tenantId:'tenant-a', type:'fixed', operationalType:'FIXED_ASSET' }
  ] });
  const planned = result.find(x => x.status === 'PROPOSE');
  assert.equal(planned.id, 'immutable-master');
  assert.equal(planned.proposedCode, 'AST-000001');
});
