/** Martin Pharma / Masaka pre-merge staging simulation.
 * Live tenant was audited read-only; this emulator uses representative synthetic records.
 * It NEVER connects to the named production database.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, runTransaction, setDoc, updateDoc } from 'firebase/firestore';

const tenantId='martin-pharma-staging';
const env=await initializeTestEnvironment({projectId:'pharmhelm-operational-inventory-v2-rules',
  firestore:{rules:readFileSync('firestore.rules','utf8')}});
try {
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'tenants',tenantId),{name:'Martin Pharma (synthetic)',tenant_code:'',slug:'martin-test'});
    await setDoc(doc(db,'branches','masaka-staging'),{tenantId,name:'Masaka',type:'Branch',branch_code:'BR-LEGACY',
      address:'Test',phone:'N/A',status:'Active',created_at:'2026-10-15',created_by:'seed'});
    await setDoc(doc(db,'staff','martin-stage-ceo'),{tenantId,role:'CEO',branch_id:'masaka-staging',
      assigned_branches:['masaka-staging'],active:true,status:'active'});
    for(const i of ['legacy-a','legacy-b'])await setDoc(doc(db,'staff',i),{tenantId,role:'Staff',
      employee_id:'LEGACY-DUPLICATE',branch_id:'masaka-staging',status:'active'});
    await setDoc(doc(db,'identity_sequence_counters',`${tenantId}_operational_consumables`),{
      tenantId,kind:'operational_consumables',lastSequence:739660,updatedAt:'2026-10-15'});
  });
  const owner=env.authenticatedContext('martin-stage-ceo',{role:'CEO',tenantId}).firestore();
  const foreign=env.authenticatedContext('foreign-person',{role:'Cashier',tenantId:'different-tenant'}).firestore();
  await assertFails(getDoc(doc(foreign,'branches','masaka-staging')));
  await assertSucceeds(runTransaction(owner,async tx=>{
    const counter=doc(owner,'identity_sequence_counters',`${tenantId}_operational_consumables`);
    const original=await tx.get(counter);
    assert.equal(original.data().lastSequence,739660);
    tx.update(counter,{lastSequence:739661,updatedAt:'2026-10-15T12:00:00Z'});
  }));
  await assertFails(updateDoc(doc(owner,'identity_sequence_counters',`${tenantId}_operational_consumables`),{lastSequence:1}));

  const cases=[
    ['clients','patients','patient_code','PAT'],
    ['prescribers','prescribers','prescriber_code','PRE'],
    ['institutions','institutions','institution_code','INS'],
    ['staff','staff','staff_code','STF'],
    ['products','products','productId','PRD']
  ];
  for(const [coll,kind,field,prefix] of cases){
    const counter=doc(owner,'identity_sequence_counters',`${tenantId}_${kind}`);
    const id=`staging-${coll}`;
    const code=`${prefix}-000001`;
    await assertSucceeds(runTransaction(owner,async tx=>{
      const snap=await tx.get(counter);
      assert.equal(snap.exists(),false);
      tx.set(counter,{tenantId,kind,lastSequence:1,updatedAt:'2026-10-15'});
      if(coll==='staff')tx.set(doc(owner,'staff_identity_claims',`${tenantId}_${code}`),{tenantId,staffId:id,code,createdAt:'2026-10-15'});
      tx.set(doc(owner,coll,id),{
        tenantId,[field]:code,
        ...(coll==='products'?{inventoryClass:'SELLABLE',sku:'SKU-000001'}:{}),
        ...(coll==='staff'?{role:'Staff',employee_id:code}:{}),
        name:'Synthetic record'
      });
    }));
    const record=await assertSucceeds(getDoc(doc(owner,coll,id)));
    assert.equal(record.data()[field],code);
    await assertFails(updateDoc(doc(owner,coll,id),{[field]:`${prefix}-999999`}));
  }
  const legacyA=await assertSucceeds(getDoc(doc(owner,'staff','legacy-a')));
  const legacyB=await assertSucceeds(getDoc(doc(owner,'staff','legacy-b')));
  assert.equal(legacyA.data().employee_id,'LEGACY-DUPLICATE');
  assert.equal(legacyB.data().employee_id,'LEGACY-DUPLICATE');
  assert.equal(legacyA.data().staff_code,undefined);
  const branch=await assertSucceeds(getDoc(doc(owner,'branches','masaka-staging')));
  assert.equal(branch.data().branch_code,'BR-LEGACY');
  console.log('[martin-identity-staging] PASS: Masaka legacy identities preserved, PAT/PRE/INS/STF/PRD assigned, OPS 739661 advanced');
}finally{
  await env.cleanup();
}
