import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';
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
    await setDoc(doc(db, 'branches', branchId), { tenantId, name: 'Masaka', status: 'active' });
    await setDoc(doc(db, 'staff', 'manager'), { tenantId, role: 'Branch Manager', assigned_branches: [branchId], status: 'active', active: true });
    await setDoc(doc(db, 'staff', 'viewer'), { tenantId, role: 'HR Support Personnel', assigned_branches: [branchId], status: 'active', active: true });
    await setDoc(doc(db, 'products', 'product-a'), { tenantId, inventoryClass: 'SELLABLE', category: 'drug/medicine', productName: 'Medicine A', isOperational: false });
    await setDoc(doc(db, 'autoGenerateOrderRuns', 'run-good'), { tenantId, branchId, runId: 'run-good', status: 'READY' });
    await setDoc(doc(db, 'autoGenerateOrderRuns', 'run-denied'), { tenantId, branchId, runId: 'run-denied', status: 'READY' });
    await setDoc(doc(db, 'autoGenerateOrderRuns', 'run-service'), { tenantId, branchId, runId: 'run-service', status: 'READY', configuration: { demandScope: 'branch', temporaryDemandMultiplier: 1 } });
    await setDoc(doc(db, 'autoGenerateOrderLines', 'run-service-line'), { tenantId, runId: 'run-service', productId: 'product-a', productName: 'Medicine A', inventoryClass: 'SELLABLE', finalPurchasePacks: 2, finalInternalAllocation: 0, finalDonorAllocations: [], calculationInputs: { supplierId: 'supplier-a', costPricePerPack: 1000 } });
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
  // Exercise the production submission service rather than only an equivalent transaction.
  const outputFile = '.auto-order-production-emulator.mjs';
  try {
    await build({ stdin: {
      contents: "export { submitOrderRun } from './src/services/orderSubmissionService';",
      resolveDir: process.cwd()
    }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: outputFile });
    const { submitOrderRun } = await import('../' + outputFile);
    const managerDb = roleDb('manager');
    const first = await assertSucceeds(submitOrderRun('run-service', 'manager', 'manager@example.org', managerDb));
    assert.equal(first.orderIds.length, 1);
    assert.equal(first.transferIds.length, 0);
    assert.equal((await getDoc(doc(managerDb, 'autoGenerateOrderRuns', 'run-service'))).data().status, 'SUBMITTED');
    const retry = await assertSucceeds(submitOrderRun('run-service', 'manager', 'manager@example.org', managerDb));
    assert.deepEqual(retry, first);

    // Independent second tenant verifies system-wide behavior without access to tenant A.
    const tenantB = 'tenant-b';
    const branchB = 'branch-b';
    await env.withSecurityRulesDisabled(async ctx => {
      const adminDb = ctx.firestore();
      await setDoc(doc(adminDb, 'staff', 'manager-b'), {
        tenantId: tenantB, role: 'Branch Manager', assigned_branches: [branchB],
        status: 'active', active: true
      });
      await setDoc(doc(adminDb, 'branches', branchB), {
        tenantId: tenantB, name: 'Second Tenant Branch', status: 'active'
      });
      await setDoc(doc(adminDb, 'products', 'product-b'), {
        tenantId: tenantB, inventoryClass: 'SELLABLE', category: 'drug/medicine',
        productName: 'Medicine B', isOperational: false
      });
      await setDoc(doc(adminDb, 'autoGenerateOrderRuns', 'run-tenant-b'), {
        tenantId: tenantB, branchId: branchB, runId: 'run-tenant-b', status: 'READY',
        configuration: { demandScope: 'branch', temporaryDemandMultiplier: 1 }
      });
      await setDoc(doc(adminDb, 'autoGenerateOrderLines', 'line-tenant-b'), {
        tenantId: tenantB, runId: 'run-tenant-b', productId: 'product-b',
        productName: 'Medicine B', inventoryClass: 'SELLABLE',
        finalPurchasePacks: 3, finalInternalAllocation: 0, finalDonorAllocations: [],
        calculationInputs: { supplierId: 'supplier-b', costPricePerPack: 1200 }
      });
    });
    const tenantBDb = env.authenticatedContext('manager-b', { tenantId: tenantB }).firestore();
    const second = await assertSucceeds(submitOrderRun(
      'run-tenant-b', 'manager-b', 'manager-b@example.org', tenantBDb
    ));
    assert.equal(second.orderIds.length, 1);
    const secondOrder = (await getDoc(doc(tenantBDb, 'stock_orders', second.orderIds[0]))).data();
    assert.equal(secondOrder.tenantId, tenantB);
    assert.equal(secondOrder.requesting_branch_name, 'Second Tenant Branch');
    assert.equal(secondOrder.status, 'draft');
    // Tenant B must not be able to read tenant A's submitted order and vice versa.
    await assertFails(getDoc(doc(tenantBDb, 'stock_orders', first.orderIds[0])));
    await assertFails(getDoc(doc(managerDb, 'stock_orders', second.orderIds[0])));
    assert.deepEqual(await assertSucceeds(submitOrderRun(
      'run-tenant-b', 'manager-b', 'manager-b@example.org', tenantBDb
    )), second);
    console.log('Independent second tenant order creation and cross-tenant isolation passed.');
  } finally {
    rmSync(outputFile, { force: true });
  }
  console.log('Auto-generated production service, atomicity, idempotency and role boundary tests passed.');
} finally {
  await env.cleanup();
}
