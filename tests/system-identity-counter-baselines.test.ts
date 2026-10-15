import test from 'node:test';
import assert from 'node:assert/strict';
import { safeIdentityCounterBaselines } from '../scripts/initialize-identity-counters.mjs';
import { analyseIdentitySnapshot } from '../scripts/audit-system-identities.mjs';

test('Martin Pharma operational consumable baseline preserves highest historical number', () => {
  const data = { tenants:[{id:'martin',name:'Martin Pharma',slug:'martin'}],
    operational_inventory_masters:[
      { tenantId:'martin',uniqueId:'OPS-739660',type:'non-fixed',operationalType:'CONSUMABLE_OPERATIONAL' },
      { tenantId:'martin',uniqueId:'OPS-739658',type:'non-fixed',operationalType:'CONSUMABLE_OPERATIONAL' }
    ],
    staff:[{tenantId:'martin',employee_id:'STAFF-1'},{tenantId:'martin',employee_id:'STAFF-1'}]
  };
  const baselines=safeIdentityCounterBaselines(data);
  assert.equal(baselines.get('martin_operational_consumables').lastSequence,739660);
  assert.equal(baselines.has('martin_staff'),false);
  const audit=analyseIdentitySnapshot(data);
  assert.equal(audit.martinPharmaFound,true);
  assert.equal(audit.tenants[0].legacyStaffDuplicates,1);
  assert.equal(audit.tenants[0].kinds.operational_consumables.nextCandidate,'OPS-739661');
});

test('canonical duplicate sequences are rejected before any counter update', () => {
  assert.throws(()=>safeIdentityCounterBaselines({clients:[
    {tenantId:'martin',patient_code:'PAT-000002'},
    {tenantId:'martin',patient_code:'PAT-000002'}
  ]}),/Duplicate established canonical ID/);
});

test('sequences are separate per tenant and preserve existing branch code formats',()=>{
  const data={branches:[
    {tenantId:'martin',branch_code:'HQ-001'},
    {tenantId:'martin',branch_code:'BR-000014'},
    {tenantId:'different',branch_code:'BR-000098'}
  ]};
  const baselines=safeIdentityCounterBaselines(data);
  assert.equal(baselines.get('martin_branches').lastSequence,14);
  assert.equal(baselines.get('different_branches').lastSequence,98);
});
