import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, increment, runTransaction, writeBatch, setDoc, updateDoc } from 'firebase/firestore';

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
  firestore:{rules:readFileSync(process.env.OPERATIONAL_RULES_PATH || 'firestore.rules','utf8')}
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
    for(const id of ['transfer-one','transfer-two','transfer-three','transfer-four']){
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
  await assertFails(claim(user('unauthorized'),'transfer-four'));
  assert.equal((await getDoc(doc(first,'products',productId))).data().quantityInStock,18);
  // Durable movement intent is accepted after physical stock receipt, and its
  // status can only advance from pending to processed under a branch role.
  const intentId='sellable_stockin_transfer-one_test-line-1';
  const intentRef=doc(first,'sellable_receipt_movement_outbox',intentId);
  const intent={
    tenantId:tenant, branchId:branch, productId, transferId:'transfer-one',
    lineId:'test-line-1', quantityBaseUnits:3, actorId:'receiver-one',
    effectiveAt:'2026-10-16T12:00:00.000Z',status:'pending',
    createdAt:'2026-10-16T12:00:00.000Z'
  };
  await setDoc(intentRef,intent);
  await updateDoc(intentRef,{status:'processed',processedAt:'2026-10-16T12:01:00.000Z'});
  assert.equal((await getDoc(intentRef)).data().status,'processed');
  await assertFails(updateDoc(intentRef,{status:'pending'}));
  await assertFails(setDoc(doc(user('unauthorized'),'sellable_receipt_movement_outbox',
    'sellable_stockin_transfer-four_test-line-2'),{
    ...intent,transferId:'transfer-four',lineId:'test-line-2',actorId:'unauthorized'
  }));
  const large='transfer-large';
  const largeRows=Array.from({length:210},(_,i)=>'large-line-'+i);
  await env.withSecurityRulesDisabled(async ctx=>{
    const seed=ctx.firestore();
    const batch=writeBatch(seed);
    batch.set(doc(seed,'transfer_invoices',large),{tenantId:tenant,inventoryClass:'SELLABLE',
      status:'receiving',destination_branch_id:branch,source_branch_id:'HQ',
      receiptSelections:Object.fromEntries(largeRows.map(id=>[id,{accepted:2,queried:1,reason:'Short shipment'}]))});
    for(const id of largeRows) batch.set(doc(seed,'transfer_invoice_lines',id),{
      tenantId:tenant,inventoryClass:'SELLABLE',transfer_id:large,product_id:productId,qty_dispatched:3,line_status:'ready_for_dispatch'
    });
    await batch.commit();
  });
  const applyLine=async(db,uid,id)=>{
    await runTransaction(db,async tx=>{
    const transferRef=doc(db,'transfer_invoices',large);
    const lineRef=doc(db,'transfer_invoice_lines',id);
    const [header,line]=await Promise.all([tx.get(transferRef),tx.get(lineRef)]);
    assert.equal(header.data().status,'receiving');
    if(line.data().line_status==='queried')return;
    tx.update(lineRef,{line_status:'queried',qty_received:2,qty_accepted:2,qty_queried:1,qty_accepted_base_units:2});
    tx.update(doc(db,'product_batches',batchId),{quantity:increment(2),lastUpdated:'2026-11-17'});
    tx.update(doc(db,'products',productId),{quantityInStock:increment(2),updatedAt:'2026-11-17'});
    });
    const queryRef=doc(db,'stock_queries',id);
    await runTransaction(db,async tx=>{
      if (!(await tx.get(queryRef)).exists()) tx.set(queryRef,{tenantId:tenant,qtyQueried:1,invoiceId:large});
    });
    const outboxRef=doc(db,'sellable_receipt_movement_outbox',`sellable_stockin_${large}_${id}`);
    await runTransaction(db,async tx=>{
      if (!(await tx.get(outboxRef)).exists()) tx.set(outboxRef,{
        ...intent,transferId:large,lineId:id,quantityBaseUnits:2,actorId:uid
      });
    });
  };
  await Promise.all([applyLine(first,'receiver-one',largeRows[0]),applyLine(second,'receiver-two',largeRows[0])]);
  for(const id of largeRows)await applyLine(second,'receiver-two',id);
  assert.equal((await getDoc(doc(first,'products',productId))).data().quantityInStock,438);
  assert.equal((await getDoc(doc(first,'product_batches',batchId))).data().quantity,428);
  await updateDoc(doc(first,'transfer_invoices',large),{status:'queried'});
  assert.equal((await getDoc(doc(first,'transfer_invoices',large))).data().status,'queried');
  console.log('210-line stock receipt, including concurrent replay, applied accepted units exactly once.');
  console.log('PASS: distinct concurrent receipts add 3+5 exactly; canonical batch, duplicate claim blocked, movement intent guardrails.');
} finally {
  await env.cleanup();
}
