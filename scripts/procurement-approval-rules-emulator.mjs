import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

const tenantId = 'procurement-approval-tenant';
const branchId = 'branch-masaka';
const projectId = 'pharmhelm-operational-inventory-v2-rules';
const env = await initializeTestEnvironment({
  projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});
const connect = uid => env.authenticatedContext(uid, {
  tenantId: uid === 'other-tenant' ? 'another-tenant' : tenantId
}).firestore();
const buildOutput = '.procurement-approval-emulator.mjs';
const sourceOrder = (id, status = 'awaiting_finance_approval') => ({
  id, tenantId, inventoryClass: 'SELLABLE', order_number: id,
  requesting_branch_id: branchId, requesting_branch_name: 'Masaka',
  category: 'sellable_non_cosmetic', order_type: 'weekly',
  generation_method: 'manual', status, is_emergency: false,
  total_order_value_ugx: 3000, created_at: '2026-10-16T00:00:00.000Z',
  created_by: 'requisitioner', submitted_at: '2026-10-16T00:00:00.000Z'
});
const originalLine = (id, orderId, productId, quantity, cost) => ({
  tenantId, inventoryClass: 'SELLABLE', order_id: orderId,
  product_id: productId, product_name: productId, qty_ordered: quantity,
  qty_received: 0, unit_cost_ugx: cost, line_total_ugx: quantity * cost,
  line_status: 'awaiting_finance_approval', supplier_id: 'supplier-good',
  supplier_name: 'Registered Supplier', supplier_type: 'external'
});

try {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const [id, role, linkedTenant] of [
      ['buyer','Procurement Officer',tenantId],
      ['viewer','HR Support Personnel',tenantId],
      ['other-tenant','Procurement Officer','another-tenant']
    ]) await setDoc(doc(db,'staff',id),{
      tenantId: linkedTenant, role, secondaryRoles: [], assigned_branches: [branchId],
      status: 'active', active: true
    });
    await setDoc(doc(db, 'branches', branchId), { tenantId, name:'Masaka', status:'active' });
    for (const productId of ['X','Y','Z']) await setDoc(doc(db,'products',productId), {
      tenantId, inventoryClass:'SELLABLE', category:'drug/medicine',
      name:productId, sku:productId, productId,
      isOperational:false
    });
    await setDoc(doc(db,'supplier_registry','supplier-good'), {
      tenantId, supplier_name:'Registered Supplier', inventoryCapabilities:['DRUGS'],
      is_suspended:false
    });
    for (const id of ['order-good','order-view']) {
      await setDoc(doc(db,'stock_orders',id), sourceOrder(id));
      await setDoc(doc(db,'stock_order_lines',id+'-x'),originalLine(id+'-x',id,'X',20,100));
      await setDoc(doc(db,'stock_order_lines',id+'-z'),originalLine(id+'-z',id,'Z',10,100));
    }
  });

  await build({
    stdin: {
      contents: "export { confirmProcurementApproval } from './src/services/procurementApprovalService';",
      resolveDir: process.cwd()
    },
    bundle: true, platform: 'node', format: 'esm',
    packages: 'external', outfile: buildOutput
  });
  const { confirmProcurementApproval } = await import('../' + buildOutput);
  const db = connect('buyer');
  const input = {
    order: sourceOrder('order-good'), tenantId, actorId: 'buyer',
    edits: {
      'order-good-x': { qty:0, removed:true },
      'order-good-z': { qty:10, removed:false }
    },
    additions: [{
      productId:'Y', supplierId:'supplier-good', supplierName:'Registered Supplier',
      quantity:12, unitCostUGX:90,
      replacesLineId:'order-good-x', reason:'Product X unavailable; authorized alternative'
    }]
  };
  const result = await assertSucceeds(confirmProcurementApproval(input,db));
  assert.equal(result.approvedTotalUGX,2080);
  assert.equal(result.addedCount,1);
  assert.equal(result.unsuppliedCount,1);

  const approvedOrder = (await getDoc(doc(db,'stock_orders','order-good'))).data();
  assert.equal(approvedOrder.status,'approved');
  assert.equal(approvedOrder.total_order_value_ugx,2080);
  const original = (await getDoc(doc(db,'stock_order_lines','order-good-x'))).data();
  assert.equal(original.line_status,'unsupplied');
  assert.equal(original.qty_ordered,0);
  assert.equal(original.original_qty,20);
  const unsupplied = (await getDoc(doc(db,'unsupplied_lines','approval_order-good_order-good-x'))).data();
  assert.equal(unsupplied.qty_unsupplied,20);
  assert.equal(unsupplied.reason,'Substituted during financial approval');
  const lines = await getDocs(query(collection(db,'stock_order_lines'),where('tenantId','==',tenantId),where('order_id','==','order-good')));
  const approvedAdded = lines.docs.map(d=>d.data()).filter(l=>l.product_id==='Y');
  assert.equal(approvedAdded.length,1);
  assert.equal(approvedAdded[0].qty_ordered,12);
  assert.equal(approvedAdded[0].line_status,'approved');
  const audit = (await getDoc(doc(db,'procurement_approval_audit','approval_order-good'))).data();
  assert.equal(audit.actorId,'buyer');
  assert.equal(audit.additions.length,1);
  await assert.rejects(confirmProcurementApproval(input,db), /no longer awaiting financial approval|changed while/);

  await assertFails(confirmProcurementApproval({
    ...input, order: sourceOrder('order-view'), actorId: 'viewer',
    edits: {
      'order-view-x':{qty:0,removed:true},
      'order-view-z':{qty:10,removed:false}
    },
    additions:[{...input.additions[0],replacesLineId:'order-view-x'}]
  },connect('viewer')));

  await assertFails(confirmProcurementApproval({
    ...input, actorId:'other-tenant'
  },connect('other-tenant')));

  await assertFails(setDoc(doc(db,'procurement_approval_audit','approval_order-view'),{
    tenantId, orderId:'order-view', actorId:'buyer', approvedAt:new Date().toISOString()
  }));

  await env.withSecurityRulesDisabled(async ctx => {
    const adminDb = ctx.firestore();
    assert.equal((await getDoc(doc(adminDb,'stock_orders','order-view'))).data().status,'awaiting_finance_approval');
    assert.equal((await getDoc(doc(adminDb,'procurement_approval_audit','approval_order-view'))).exists(),false);
    const viewLines = await getDocs(query(collection(adminDb,'stock_order_lines'),where('order_id','==','order-view')));
    assert.equal(viewLines.docs.length,2,'Unauthorized attempts must not create partial line additions');
  });
  console.log('Production procurement approval, substitution, atomicity, role isolation, and audit rules passed.');
} finally {
  rmSync(buildOutput,{force:true});
  await env.cleanup();
}
