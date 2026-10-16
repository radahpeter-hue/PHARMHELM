import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, increment, runTransaction, writeBatch, setDoc } from 'firebase/firestore';

/**
 * Integration regression for the actual Sellable Stock In atomic primitives:
 * transactional invoice claim + batched increment of existing product and a
 * deterministic new batch ID. Runs against production Firestore rules.
 */
const tenant='stockin-concurrency-tenant', branch='branch-masaka';
const productId='test-product', batchNumber='TEST2026', expiry='2028-12-31';
const batchId=['stockin',tenant,branch,productId,batchNumber,expiry].map(encodeURIComponent).join('_');
const env=await initializeTestEnvironment({
  projectId:'pharmhelm-operational-inventory-v2-rules',
  firestore:{rules:readFileSync('firestore.rules','utf8')}
});
const user=(uid)=>env.authenticatedContext(uid,{tenantId:tenant}).firestore();
try {
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    for(const id of ['receiver-one','receiver-two','unauthorized']){
      await setDoc(doc(db,'staff',id),{
        tenantId:tenant,role:id==='unauthorized'?'HR Support Personnel':'Branch Manager',
        secondaryRoles:[],assigned_branches:[branch],branch_id:branch,
        active:true,status:'active'
      });
    }
    await setDoc(doc(db,'products',productId),{
      tenantId:tenant,inventoryClass:'SELLABLE',productName:'Test batch stock',
      quantityInStock:10
    });
    await setDoc(doc(db,'product_batches','historical-batch'),{
      tenantId:tenant,branchId:branch,productId,batchNumber:'HISTORY',
      expiryDate:expiry,quantity:10,batch_status:'active'
    });
    for(const id of ['transfer-one','transfer-two','transfer-three']){
      await setDoc(doc(db,'transfer_invoices',id),{
        tenantId:tenant,inventoryClass:'SELLABLE',status:'dispatched',
        destination_branch_id:branch,source_branch_id:'HQ',
        transfer_number:id,transfer_type:'central_to_branch'
      });
    }
  });

  const first=user('receiver-one'), second=user('receiver-two');
  const claim=async(db,id)=>{
    const ref=doc(db,'transfer_invoices',id);
    return runTransaction(db,async tx=>{
      const current=await tx.get(ref);
      if(current.data()?.status!=='dispatched')throw new Error('Already claimed');
      tx.update(ref,{status:'receiving',reception_claimed_by:id});
    });
  };
  await Promise.all([claim(first,'transfer-one'),claim(second,'transfer-two')]);
  // Distinct transfers reach the same product + new batch concurrently.
  const receive=async(db,id,accepted)=>{
    const batch=writeBatch(db);
    batch.set(doc(db,'product_batches',batchId),{
      tenantId:tenant,branchId:branch,productId,batchNumber,
      expiryDate:expiry,quantity:increment(accepted),batch_status:'active',
      lastUpdated:'2026-10-16'
    },{merge:true});
    batch.update(doc(db,'products',productId),{
      quantityInStock:increment(accepted),updatedAt:'2026-10-16'
    });
    batch.update(doc(db,'transfer_invoices',id),{status:'fully_accepted',received_by:id});
    await batch.commit();
  };
  await Promise.all([receive(first,'transfer-one',3),receive(second,'transfer-two',5)]);
  assert.equal((await getDoc(doc(first,'products',productId))).data().quantityInStock,18);
  assert.equal((await getDoc(doc(first,'product_batches',batchId))).data().quantity,8);
  assert.equal((await getDoc(doc(first,'transfer_invoices','transfer-one'))).data().status,'fully_accepted');
  assert.equal((await getDoc(doc(first,'transfer_invoices','transfer-two'))).data().status,'fully_accepted');

  // Double-click/different session: exactly one claim may succeed.
  const outcomes=await Promise.allSettled([
    claim(first,'transfer-three'),claim(second,'transfer-three')
  ]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  await assertFails(claim(user('unauthorized'),'transfer-one'));
  assert.equal((await getDoc(doc(first,'products',productId))).data().quantityInStock,18);
  console.log('PASS: distinct concurrent receipts add 3+5 exactly; one canonical new batch; only one concurrent claim.');
} finally {
  await env.cleanup();
}
