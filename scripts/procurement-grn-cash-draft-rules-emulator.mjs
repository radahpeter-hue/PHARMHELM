import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const tenantId='masaka-grn-finance-tenant';
const grnId='grn_cash_test';
const invoiceId='procurement_invoice_cash_test';
const draftId='management_payment_draft_'+grnId;
const env=await initializeTestEnvironment({
  projectId:'pharmhelm-operational-inventory-v2-rules',
  firestore:{rules:readFileSync('firestore.rules','utf8')}
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
  console.log('Procurement GRN cash draft rules: canonical create allowed; update, unlinked, wrong role and cross-tenant denied.');
} finally {
  await env.cleanup();
}
