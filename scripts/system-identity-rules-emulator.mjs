import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, runTransaction, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'pharmhelm-operational-inventory-v2-rules';
const tenantId = 'identity-tenant';
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });

try {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db,'staff','identity-owner'), {
      tenantId, role:'CEO', assigned_branches:['identity-branch'], status:'active', active:true
    });
    await setDoc(doc(db,'staff','identity-cashier'), {
      tenantId, role:'cashier', assigned_branches:['identity-branch'], status:'active', active:true
    });
    await setDoc(doc(db,'tenants',tenantId), {name:'Identity Test Tenant', slug:'identity-tenant'});
    await setDoc(doc(db,'identity_sequence_counters','platform_tenants'), {scope:'platform',kind:'tenants',lastSequence:1,updatedAt:'2026-10-15'});
  });
  const owner = env.authenticatedContext('identity-owner',{tenantId,role:'CEO'}).firestore();
  const cashier = env.authenticatedContext('identity-cashier',{tenantId,role:'cashier'}).firestore();
  const counterRef = doc(owner,'identity_sequence_counters',`${tenantId}_branches`);
  await assertSucceeds(getDoc(counterRef));
  await assertFails(getDoc(doc(cashier,'identity_sequence_counters','platform_tenants')));
  const result = await assertSucceeds(runTransaction(owner, async tx => {
    const snapshot = await tx.get(counterRef);
    assert.equal(snapshot.exists(),false);
    tx.set(counterRef,{tenantId,kind:'branches',lastSequence:1,updatedAt:'2026-10-15'});
    tx.set(doc(owner,'branches','identity-branch'),{
      tenantId,name:'Branch A',branch_code:'BR-000001',type:'Branch',address:'Test',phone:'N/A',
      status:'Active',created_at:'2026-10-15',created_by:'identity-owner'
    });
    return true;
  }));
  assert.equal(result,true);
  await assertFails(updateDoc(doc(owner,'branches','identity-branch'),{branch_code:'BR-HIJACKED'}));
  await assertFails(updateDoc(doc(owner,'branches','identity-branch'),{tenantId:'foreign-tenant'}));
  await assertFails(updateDoc(doc(cashier,'identity_sequence_counters',`${tenantId}_branches`),{lastSequence:500}));
  await assertFails(updateDoc(counterRef,{lastSequence:500}));
  await assertFails(setDoc(doc(cashier,'branches','cashier-forged'),{
    tenantId,name:'Forged',branch_code:'BR-000002',type:'Branch',address:'Test',phone:'N/A',
    status:'Active',created_at:'2026-10-15',created_by:'identity-cashier'
  }));
  await assertSucceeds(runTransaction(owner,async tx=>{
    const snapshot=await tx.get(counterRef);
    assert.equal(snapshot.data().lastSequence,1);
    tx.update(counterRef,{lastSequence:2,updatedAt:'2026-10-15T12:00:00Z'});
    tx.set(doc(owner,'branches','identity-branch-two'),{
      tenantId,name:'Branch B',branch_code:'BR-000002',type:'Branch',address:'Test',phone:'N/A',
      status:'Active',created_at:'2026-10-15',created_by:'identity-owner'
    });
  }));
  const staffCounter = doc(owner,'identity_sequence_counters',`${tenantId}_staff`);
  await assertSucceeds(runTransaction(owner,async tx=>{
    await tx.get(staffCounter);
    tx.set(staffCounter,{tenantId,kind:'staff',lastSequence:1,updatedAt:'2026-10-15'});
    tx.set(doc(owner,'staff_identity_claims',`${tenantId}_STF-000001`),{tenantId,staffId:'new-employee',code:'STF-000001',createdAt:'2026-10-15'});
    tx.set(doc(owner,'staff','new-employee'),{tenantId,role:'Staff',staff_code:'STF-000001',employee_id:'LEGACY-09',status:'pending'});
  }));
  await assertFails(updateDoc(doc(owner,'staff','new-employee'),{employee_id:'STF-123456'}));
  await assertFails(updateDoc(doc(owner,'staff','new-employee'),{staff_code:'STF-123456'}));
  console.log('[system-identity-rules] PASS: permitted sequential creation and forbidden sequence/code hijacks');
} finally {
  await env.cleanup();
}
