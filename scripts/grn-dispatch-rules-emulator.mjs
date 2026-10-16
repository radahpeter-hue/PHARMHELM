import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { build } from 'esbuild';

const tenant='dispatch-acceptance-tenant', orderId='order-masaka', grnId='grn-masaka', transferId='transfer-masaka';
const env=await initializeTestEnvironment({
  projectId:'pharmhelm-operational-inventory-v2-rules',
  firestore:{rules:readFileSync('firestore.rules','utf8')}
});
try{
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    for(const [id,role] of [['buyer','Procurement Head'],['other','Dispenser']]){
      await setDoc(doc(db,'staff',id),{tenantId:tenant,role,
        secondaryRoles:[],assigned_branches:['Masaka'],active:true,status:'active'});
    }
    await setDoc(doc(db,'stock_orders',orderId),{
      tenantId:tenant,inventoryClass:'SELLABLE',category:'sellable_non_cosmetic',
      status:'ready_for_dispatch',requesting_branch_id:'Masaka'
    });
    await setDoc(doc(db,'grn_records',grnId),{
      tenantId:tenant,order_id:orderId,
      transfer_id:transferId,destination_branch_id:'Masaka',
      grn_status:'completed',financial_posting_status:'posted',
      dispatch_status:'ready_for_dispatch',reception_status:'not_dispatched'
    });
    await setDoc(doc(db,'transfer_invoices',transferId),{
      tenantId:tenant,inventoryClass:'SELLABLE',order_id:orderId,
      grn_id:grnId,destination_branch_id:'Masaka',source_branch_id:'HQ',
      transfer_number:'TR-MASAKA-1',transfer_type:'central_to_branch',
      status:'ready_for_dispatch'
    });
  });
  await build({stdin:{contents:"export { dispatchPreparedSellableGrn } from './src/services/grnDispatchService';",
    resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
    packages:'external',outfile:'.grn-dispatch-acceptance-emulator.mjs'});
  const { dispatchPreparedSellableGrn }=await import('../.grn-dispatch-acceptance-emulator.mjs');
  const buyerDb=env.authenticatedContext('buyer',{tenantId:tenant}).firestore();
  const request={tenantId:tenant,grnId,transferId,orderId,actor:{uid:'buyer',name:'Buyer'}};
  const first=await dispatchPreparedSellableGrn(request,buyerDb);
  assert.equal(first.alreadyDispatched,false);
  const again=await dispatchPreparedSellableGrn(request,buyerDb);
  assert.equal(again.alreadyDispatched,true);
  const t=(await getDoc(doc(buyerDb,'transfer_invoices',transferId))).data();
  const g=(await getDoc(doc(buyerDb,'grn_records',grnId))).data();
  const o=(await getDoc(doc(buyerDb,'stock_orders',orderId))).data();
  assert.equal(t.status,'dispatched');
  assert.equal(g.dispatch_status,'dispatched');
  assert.equal(o.status,'dispatched');
  assert.equal(g.reception_status,'awaiting_receipt');

  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    for(const [id,suffix] of [['transfer-other','other'],['grn-other','other'],['order-other','other']]){
      const orig=id.startsWith('transfer')?t:id.startsWith('grn')?g:o;
      await setDoc(doc(db,id.startsWith('transfer')?'transfer_invoices':id.startsWith('grn')?'grn_records':'stock_orders',id),
        {...orig,
          status:'ready_for_dispatch',
          ...(id.startsWith('transfer')?{order_id:'order-other',grn_id:'grn-other',destination_branch_id:'Masaka'}:{}),
          ...(id.startsWith('grn')?{order_id:'order-other',transfer_id:'transfer-other',dispatch_status:'ready_for_dispatch',destination_branch_id:'Masaka'}:{})
        });
    }
  });
  const unprivileged=env.authenticatedContext('other',{tenantId:tenant}).firestore();
  await assertFails(dispatchPreparedSellableGrn({
    tenantId:tenant,grnId:'grn-other',transferId:'transfer-other',orderId:'order-other',
    actor:{uid:'other',name:'Other'}
  },unprivileged));
  console.log('PASS: canonical prepared dispatch commits linked triple, retry no-op, unauthorized dispatcher denied.');
}finally{await env.cleanup();}
