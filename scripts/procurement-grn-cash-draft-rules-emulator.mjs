import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';

const tenantId='masaka-grn-finance-tenant';
const grnId='grn_cash_test';
const invoiceId='procurement_invoice_cash_test';
const draftId='management_payment_draft_'+grnId;
const env=await initializeTestEnvironment({
  projectId:'pharmhelm-operational-inventory-v2-rules',
  firestore:{rules:readFileSync(process.env.OPERATIONAL_RULES_PATH || 'firestore.rules','utf8')}
});
const actor=(uid, tenant=tenantId)=>env.authenticatedContext(uid,{tenantId:tenant}).firestore();

try {
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for(const [id,role,tenant] of [
      ['procurement-finance-test','Procurement Head',tenantId],
      ['viewer-finance-test','Dispenser',tenantId],
      ['other-tenant-finance-test','Procurement Head','other-tenant']
    ]) await setDoc(doc(db,'staff',id),{
      tenantId:tenant,role,secondaryRoles:[],assigned_branches:[],active:true,status:'active'
    });
    await setDoc(doc(db,'grn_records',grnId),{
      tenantId,order_id:'approved-order',invoice_id:invoiceId,
      payment_type:'cash',payment_status:'pending_payment',
      status:'completed',grn_status:'completed'
    });
    await setDoc(doc(db,'invoices',invoiceId),{
      tenantId,grnId,invoiceValue:42000,paymentStatus:'Pending Payment'
    });
  });

  const valid={
    tenantId,source:'procurement_cash_grn',sourceType:'procurement',sourceRef:grnId,
    grnId,invoiceId,invoiceRef:'SUPPLIER-INV-1',
    supplierId:'supplier-one',supplierName:'Supplier One',
    amount:42000,amount_ugx:42000,status:'draft',paymentStatus:'pending_payment',
    excludeFromOpexRollup:true,createdBy:'procurement-finance-test'
  };
  const procurement=actor('procurement-finance-test');
  await assertSucceeds(setDoc(doc(procurement,'management_expenses',draftId),valid));
  const copy=(await getDoc(doc(procurement,'management_expenses',draftId))).data();
  assert.equal(copy.status,'draft');
  assert.equal(copy.amount,42000);
  await assertFails(setDoc(doc(procurement,'management_expenses',draftId),{...valid,status:'approved'}));
  await assertFails(setDoc(doc(procurement,'management_expenses','manual-expense'),valid));
  await assertFails(setDoc(doc(procurement,'management_expenses','management_payment_draft_grn_unlinked'),{
    ...valid,grnId:'grn_unlinked'
  }));
  await assertFails(setDoc(doc(actor('viewer-finance-test'),'management_expenses','management_payment_draft_grn_badviewer'),{
    ...valid,grnId:'grn_badviewer',createdBy:'viewer-finance-test'
  }));
  await assertFails(setDoc(doc(actor('other-tenant-finance-test','other-tenant'),'management_expenses','management_payment_draft_grn_cross'),{
    ...valid,grnId:'grn_cross',tenantId:'other-tenant',createdBy:'other-tenant-finance-test'
  }));
  await build({ stdin: {
    contents: "export {processProcurementGrn, resumeSellableCentralGrn, procurementPostingIds} from './src/services/procurementFinanceService';",
    resolveDir: process.cwd()
  }, bundle:true, platform:'node', format:'esm', packages:'external', outfile:'.large-grn-emulator.mjs' });
  const {processProcurementGrn, resumeSellableCentralGrn, procurementPostingIds} = await import('../.large-grn-emulator.mjs');
  const order = { id:'large-sellable-grn', tenantId, status:'approved', inventoryClass:'SELLABLE', category:'sellable_non_cosmetic',
    requesting_branch_id:'branch-masaka', requesting_branch_name:'Masaka', order_number:'ORD-LARGE' };
  const lines = Array.from({length:210},(_,index)=>({
    id:'receipt-line-'+index, tenantId, order_id:order.id, inventoryClass:'SELLABLE', line_status:'approved',
    product_id:'receipt-item-'+index, product_name:'Item '+index, qty_ordered:2, unit_cost_ugx:1000,
    supplier_type:'external', supplier_id:'supplier-one', supplier_name:'Supplier One'
  }));
  const editedLines = Object.fromEntries(lines.map((line,index)=>[line.id,{ qty:index===0?1:2, removed:false, batch:'B-'+index, expiry:'2099-12-31' }]));
  const input = { tenantId, order, lines, editedLines, paymentType:'cash',
    invoiceNumber:'INV-LARGE', invoiceDate:new Date().toISOString().slice(0,10), inputVat:0, whtAmount:0, notes:'',
    user:{uid:'procurement-finance-test',name:'Procurement Head'} };
  await env.withSecurityRulesDisabled(async context=>{
    const seed=context.firestore();
    const batch=writeBatch(seed);
    batch.set(doc(seed,'stock_orders',order.id),order);
    for(const line of lines){
      batch.set(doc(seed,'stock_order_lines',line.id),line);
      if (line !== lines.at(-1)) batch.set(doc(seed,'products',line.product_id),{tenantId,name:line.product_name,inventoryClass:'SELLABLE'});
    }
    await batch.commit();
  });
  const ids=procurementPostingIds(tenantId,order.id);
  try {
    await assertFails(processProcurementGrn(input,procurement));
    const midway=(await getDoc(doc(procurement,'stock_orders',order.id))).data();
    assert.equal(midway.sellableGrnSave.next,209);
    assert.equal((await getDoc(doc(procurement,'transfer_invoices',ids.transferId))).data().status,'posting');
    assert.equal((await getDoc(doc(procurement,'invoices',ids.invoiceId))).exists(),false);
    await env.withSecurityRulesDisabled(async context=>{
      await setDoc(doc(context.firestore(),'products',lines.at(-1).product_id),{tenantId,inventoryClass:'SELLABLE'});
    });
    await assertSucceeds(resumeSellableCentralGrn(order,tenantId,input.user,procurement));
    const transfer=(await getDoc(doc(procurement,'transfer_invoices',ids.transferId))).data();
    assert.equal(transfer.status,'ready_for_dispatch');
    const rows=await getDocs(query(collection(procurement,'transfer_invoice_lines'),where('tenantId','==',tenantId),where('transfer_id','==',ids.transferId)));
    assert.equal(rows.size,210);
    assert.equal((await getDoc(doc(procurement,'invoices',ids.invoiceId))).data().invoiceValue,419000);
    assert.equal((await getDoc(doc(procurement,'management_expenses',ids.cashDraftId))).data().amount,419000);
    assert.equal((await processProcurementGrn(input,procurement)).alreadyProcessed,true);
    console.log('210-line Central GRN interrupted, resumed, and created one cash draft and dispatch.');
  } catch(error) {
    const current = (await getDoc(doc(procurement,'stock_orders',order.id))).data();
    console.error('GRN fixture progress',current.status,current.sellableGrnSave?.next);
    throw error;
  }
  console.log('Procurement GRN cash draft rules: canonical create allowed; update, unlinked, wrong role and cross-tenant denied.');
} finally {
  rmSync('.large-grn-emulator.mjs',{force:true});
  await env.cleanup();
}
