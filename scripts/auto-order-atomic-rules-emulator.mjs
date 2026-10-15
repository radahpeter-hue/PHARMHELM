import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore';

const tenantId = 'tenant-a';
const branchId = 'branch-a';
const env = await initializeTestEnvironment({
  projectId: 'pharmhelm-operational-inventory-v2-rules',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});
const roleDb = uid => env.authenticatedContext(uid, { tenantId }).firestore();

try {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', 'manager'), { tenantId, role: 'Branch Manager', assigned_branches: [branchId], status: 'active', active: true });
    await setDoc(doc(db, 'staff', 'viewer'), { tenantId, role: 'HR Support Personnel', assigned_branches: [branchId], status: 'active', active: true });
    await setDoc(doc(db, 'products', 'product-a'), { tenantId, inventoryClass: 'SELLABLE', category: 'drug/medicine', productName: 'Medicine A', isOperational: false });
    await setDoc(doc(db, 'autoGenerateOrderRuns', 'run-good'), { tenantId, branchId, runId: 'run-good', status: 'READY' });
    await setDoc(doc(db, 'autoGenerateOrderRuns', 'run-denied'), { tenantId, branchId, runId: 'run-denied', status: 'READY' });
  });

  const submit = (db, runId) => runTransaction(db, async tx => {
    const runRef = doc(db, 'autoGenerateOrderRuns', runId);
    const orderRef = doc(db, 'stock_orders', 'auto_order_' + runId);
    const lineRef = doc(db, 'stock_order_lines', 'auto_line_' + runId);
    const transferRef = doc(db, 'transfer_invoices', 'auto_transfer_' + runId);
    const transferLineRef = doc(db, 'transfer_invoice_lines', 'auto_transfer_line_' + runId);
    const auditRef = doc(db, 'global_audit_logs', 'auto_order_submit_' + runId);
    const snap = await tx.get(runRef);
    if (snap.data()?.status !== 'READY') throw new Error('Run not ready');
    tx.set(orderRef, {
      tenantId, inventoryClass: 'SELLABLE', category: 'sellable_non_cosmetic',
      requesting_branch_id: branchId, order_number: 'ORD-' + runId,
      status: 'draft', generation_method: 'auto_generated', order_type: 'monthly'
    });
    tx.set(lineRef, {
      tenantId, inventoryClass: 'SELLABLE', order_id: orderRef.id,
      product_id: 'product-a', product_name: 'Medicine A',
      qty_ordered: 1, unit_cost_ugx: 1000, line_total_ugx: 1000
    });
    tx.set(transferRef, {
      tenantId, inventoryClass: 'SELLABLE', source_branch_id: branchId,
      destination_branch_id: 'HQ', status: 'pending_approval', created_by: 'manager'
    });
    tx.set(transferLineRef, {
      tenantId, inventoryClass: 'SELLABLE', transfer_id: transferRef.id,
      product_id: 'product-a', product_name: 'Medicine A', qty_requested: 1
    });
    tx.update(runRef, { status: 'SUBMITTED', submittedOrderIds: [orderRef.id],
      submittedTransferIds: [transferRef.id] });
    tx.set(auditRef, { tenantId, action: 'AUTO_GENERATE_ORDER_SUBMITTED', actor: 'manager' });
  });

  await assertSucceeds(submit(roleDb('manager'), 'run-good'));
  await assertFails(submit(roleDb('viewer'), 'run-denied'));
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    assert.equal((await getDoc(doc(db, 'stock_orders', 'auto_order_run-good'))).exists(), true);
    assert.equal((await getDoc(doc(db, 'transfer_invoice_lines', 'auto_transfer_line_run-good'))).exists(), true);
    assert.equal((await getDoc(doc(db, 'autoGenerateOrderRuns', 'run-good'))).data().status, 'SUBMITTED');
    for (const collectionName of ['stock_orders','stock_order_lines','transfer_invoices','transfer_invoice_lines','global_audit_logs']) {
      const id = ({
        stock_orders: 'auto_order_', stock_order_lines: 'auto_line_', transfer_invoices: 'auto_transfer_',
        transfer_invoice_lines: 'auto_transfer_line_', global_audit_logs: 'auto_order_submit_'
      })[collectionName] + 'run-denied';
      assert.equal((await getDoc(doc(db, collectionName, id))).exists(), false, collectionName + ' must not partially commit');
    }
    assert.equal((await getDoc(doc(db, 'autoGenerateOrderRuns', 'run-denied'))).data().status, 'READY');
  });
  console.log('Auto-generated order Firestore atomicity and role boundary smoke tests passed.');
} finally {
  await env.cleanup();
}
