import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore';

const projectId = 'pharmhelm-operational-inventory-v2-rules';
const tenantId = 'tenant-a';
const branchA = 'branch-a';
const branchB = 'branch-b';

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});

const branchManager = testEnv.authenticatedContext('manager-a', { tenantId, role: 'Branch Manager' }).firestore();
const procurement = testEnv.authenticatedContext('procurement-a', { tenantId, role: 'Procurement Head' }).firestore();

function stockOrder(id, category, inventoryClass, branchId = branchA) {
  return {
    tenantId,
    order_number: id,
    requesting_branch_id: branchId,
    category,
    inventoryClass,
    status: 'pending'
  };
}

function operationalLine(id, orderId, productId, masterItemId = 'op-master') {
  return {
    tenantId,
    order_id: orderId,
    inventoryClass: 'OPERATIONAL',
    masterItemId,
    product_id: productId, qty_ordered: 1, unit_cost_ugx: 0, line_total_ugx: 0
  };
}

try {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'operational_inventory_identity_state', tenantId), { tenantId, status: 'READY' }),
      setDoc(doc(db, 'system_settings', tenantId), {
        tenantId,
        featureToggles: { enableOperationalInventory: true }
      }),
      setDoc(doc(db, 'staff', 'manager-a'), {
        tenantId, role: 'Branch Manager', assigned_branches: [branchA], status: 'active', active: true
      }),
      setDoc(doc(db, 'staff', 'procurement-a'), {
        tenantId, role: 'Procurement Head', assigned_branches: [], status: 'active', active: true
      }),
      setDoc(doc(db, 'operational_inventory_masters', 'op-master'), {
        tenantId, inventoryClass: 'OPERATIONAL', operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', name: 'Paper', category: 'Stationery', unitPerPack: 1, unitOfIssue: 'ream', hqLocationItemId: 'op-item-hq'
      }),
      setDoc(doc(db, 'operational_inventory', 'op-item-hq'), {
        tenantId, branchId: 'HQ', masterItemId: 'op-master', inventoryClass: 'OPERATIONAL',
        operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', name: 'Paper', category: 'Stationery', unitPerPack: 1, unitOfIssue: 'ream', quantityInStock: 10
      }),
      setDoc(doc(db, 'operational_inventory', 'op-item-a'), {
        tenantId, branchId: branchA, masterItemId: 'op-master', inventoryClass: 'OPERATIONAL',
        operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', name: 'Paper', category: 'Stationery', unitPerPack: 1, unitOfIssue: 'ream', quantityInStock: 10
      }),
      setDoc(doc(db, 'operational_inventory', 'op-item-b'), {
        tenantId, branchId: branchB, masterItemId: 'op-master', inventoryClass: 'OPERATIONAL',
        operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', name: 'Paper', category: 'Stationery', unitPerPack: 1, unitOfIssue: 'ream', quantityInStock: 10
      }),
      setDoc(doc(db, 'operational_inventory', 'explicit-sellable-location'), { tenantId, branchId: branchA, inventoryClass: 'SELLABLE', type: 'non-fixed', operationalType: 'CONSUMABLE_OPERATIONAL', masterItemId: 'op-master', name: 'Paper', category: 'Stationery', unitPerPack: 1, unitOfIssue: 'ream', quantityInStock: 0 }),
      setDoc(doc(db, 'operational_inventory_masters', 'foreign-master'), { tenantId: 'tenant-b', inventoryClass: 'OPERATIONAL', type: 'non-fixed' }),
      setDoc(doc(db, 'products', 'sellable-item'), {
        tenantId, inventoryClass: 'SELLABLE', productName: 'Paracetamol'
      })
    ]);
  });

  await assertSucceeds(setDoc(doc(branchManager, 'operational_inventory', 'op-item-a2'), {
    tenantId, branchId: branchA, masterItemId: 'op-master', inventoryClass: 'OPERATIONAL',
    operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', name: 'Paper', category: 'Stationery', unitPerPack: 1, unitOfIssue: 'ream', quantityInStock: 0
  }));
  // The live master-registration service uses a Firestore transaction, which
  // point-reads deterministic item/master/movement IDs before creating them.
  // Missing point-reads must be allowed for authenticated users while the
  // subsequent creates remain fully tenant-, branch- and class-validated.
  // Operational dispatch preparation point-reads a deterministic missing transfer-line ID.
  // Procurement may check absence, but a branch manager without Procurement rights may not.
  // Dedicated Finance payment and balance-lock collections are not launched.
  // Generic tenant-write fallback must never permit premature payment creation.
  await assertFails(setDoc(doc(procurement, 'cash_grn_payments', 'unlaunched_test'), { tenantId, amountUGX: 1 }));
  await assertFails(setDoc(doc(procurement, 'petty_cash_posting_locks', tenantId), { tenantId, postingId: null }));
  await assertSucceeds(getDoc(doc(procurement, 'operational_transfer_lines', 'not-created-yet')));
  await assertFails(getDoc(doc(branchManager, 'operational_transfer_lines', 'not-created-yet')));
  await assertSucceeds(getDoc(doc(branchManager, 'operational_inventory', 'missing-item')));
  await assertSucceeds(getDoc(doc(branchManager, 'operational_inventory_masters', 'missing-master')));
  await assertSucceeds(getDoc(doc(branchManager, 'operational_inventory_identity_claims', 'missing-identity-claim')));
  await assertSucceeds(getDoc(doc(branchManager, 'operational_inventory_identity_events', 'opidentity_missing-item')));
  await assertFails(setDoc(doc(branchManager, 'operational_inventory_identity_state', tenantId), {tenantId, status: 'READY'}));
  await assertSucceeds(getDoc(doc(branchManager, 'operational_inventory_movements', 'missing-movement')));
  const unauthenticated = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(unauthenticated, 'operational_inventory', 'missing-item')));
  await assertFails(setDoc(doc(branchManager, 'operational_inventory', 'op-item-wrong-branch'), {
    tenantId, branchId: branchB, masterItemId: 'op-master', inventoryClass: 'OPERATIONAL',
    operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', name: 'Paper', category: 'Stationery', unitPerPack: 1, unitOfIssue: 'ream', quantityInStock: 0
  }));
  await assertFails(setDoc(doc(branchManager, 'products', 'operational-in-products'), {
    tenantId, inventoryClass: 'OPERATIONAL', productName: 'A4 paper'
  }));
  await assertFails(setDoc(doc(branchManager, 'operational_inventory_masters', 'sellable-in-operational'), {
    tenantId, inventoryClass: 'SELLABLE', operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed'
  }));

  await assertFails(setDoc(doc(branchManager, 'operational_inventory', 'explicit-sellable-location'), {inventoryClass:'OPERATIONAL'}, {merge:true}));

  // Every app registration for one normalized tenant identity uses the same
  // deterministic claim path. Concurrent claim creation must therefore have
  // a single winner, and claims stay immutable and tenant scoped.
  const identityClaimId = 'opidentity_' + Buffer.from(`${tenantId}|paper|stationery|non-fixed|1|ream`).toString('base64url');
  const claimDraft = actorId => ({
    tenantId, inventoryClass: 'OPERATIONAL', identityFingerprint: 'paper|stationery|non-fixed|1|ream',
    masterItemId: 'op-master', actorId, createdAt: new Date().toISOString()
  });
  const claimAttempts = await Promise.allSettled([
    setDoc(doc(branchManager, 'operational_inventory_identity_claims', identityClaimId), claimDraft('manager-a')),
    setDoc(doc(procurement, 'operational_inventory_identity_claims', identityClaimId), claimDraft('procurement-a'))
  ]);
  assert.equal(claimAttempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(claimAttempts.filter(result => result.status === 'rejected').length, 1);
  await assertFails(setDoc(doc(branchManager, 'operational_inventory_identity_claims', identityClaimId), claimDraft('manager-a')));
  await assertFails(setDoc(doc(branchManager, 'operational_inventory_identity_claims', 'arbitrary-bypass-key'), claimDraft('manager-a')));
  const tenantBInventory = testEnv.authenticatedContext('manager-b', { tenantId: 'tenant-b', role: 'Branch Manager' }).firestore();
  await assertFails(getDoc(doc(tenantBInventory, 'operational_inventory_identity_claims', identityClaimId)));
  await assertFails(setDoc(doc(branchManager, 'operational_inventory_identity_claims', 'sellable-identity-claim'), {
    ...claimDraft('manager-a'), inventoryClass: 'SELLABLE'
  }));


  // Exercise the actual registration service, including every preflight read and
  // master/location/claim/audit write in the live transaction shape.
  const { build } = await import('esbuild');
  await build({ stdin: { contents: "export { saveOperationalLocationItem } from './src/services/operationalInventoryMasterService'; export { submitOperationalHqBufferOrder } from './src/services/operationalHqBufferOrderService'; export { processOperationalGrn } from './src/services/operationalGrnService'; export { createHqOperationalDistribution, receiveOperationalTransferLine, createOperationalBranchReturn, receiveOperationalBranchReturn, dispatchOperationalOrderToBranch } from './src/services/operationalTransferService';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: '.operational-registration-emulator.mjs' });
  const { saveOperationalLocationItem, submitOperationalHqBufferOrder, processOperationalGrn, createHqOperationalDistribution, receiveOperationalTransferLine, createOperationalBranchReturn, receiveOperationalBranchReturn, dispatchOperationalOrderToBranch } = await import('../.operational-registration-emulator.mjs');
  const registration = { tenantId, branchId: 'HQ', actor: { uid: 'procurement-a', name: 'Buyer' }, data: {
    tenantId, branchId: 'HQ', name: 'Register test notebooks', category: 'Stationery', type: 'non-fixed',
    inventoryClass: 'OPERATIONAL', operationalType: 'CONSUMABLE_OPERATIONAL', unitPerPack: 1,
    unitOfIssue: 'book', quantityInStock: 0, costPerPack: 0, uniqueId: 'RULES-BOOK',
    description: '', supplier: '', condition: 'New', status: 'In Use'
  } };
  const registrationAttempts = await Promise.allSettled([
    saveOperationalLocationItem(registration, procurement), saveOperationalLocationItem(registration, procurement)
  ]);
  assert.equal(registrationAttempts.filter(result => result.status === 'fulfilled').length, 1, JSON.stringify(registrationAttempts.map(result => result.status === 'rejected' ? { message: result.reason.message, stack: result.reason.stack } : result)));
  const registered = registrationAttempts.find(result => result.status === 'fulfilled').value;
  // Fixed-item registration creates identity, not a phantom asset acquisition.
  const fixedRegistration = await saveOperationalLocationItem({ ...registration, data: {
    ...registration.data, name: 'Zero stock office desk', category: 'Furniture & Fittings',
    type: 'fixed', operationalType: 'FIXED_ASSET', unitOfIssue: 'piece', quantityInStock: 0
  } }, procurement);
  assert.equal((await getDoc(doc(procurement, 'operational_inventory', fixedRegistration.itemId))).data().quantityInStock, 0);
  await assert.rejects(saveOperationalLocationItem({ ...registration, data: { ...registration.data, name: 'Invalid issue unit', unitOfIssue: '01' } }, procurement), /named issue unit/);
  await assert.rejects(saveOperationalLocationItem({ ...registration, data: { ...registration.data, name: 'Invalid stock quantity', quantityInStock: -1 } }, procurement), /non-negative/);
  // A stale metadata form cannot overwrite a balance maintained by movements.
  await saveOperationalLocationItem({ ...registration, itemId: registered.itemId, masterItemId: registered.masterItemId,
    data: { ...registration.data, quantityInStock: 99 } }, procurement);
  assert.equal((await getDoc(doc(procurement, 'operational_inventory', registered.itemId))).data().quantityInStock, 0);
  const branchRegistration = await saveOperationalLocationItem({ ...registration, branchId: branchA, actor: { uid: 'manager-a' },
    masterItemId: registered.masterItemId, data: { ...registration.data, branchId: branchA } }, branchManager);
  await assertFails(saveOperationalLocationItem({ ...registration, branchId: branchB, actor: { uid: 'manager-a' },
    masterItemId: registered.masterItemId, data: { ...registration.data, branchId: branchB } }, branchManager));
  const bufferInput = { tenantId, itemId: registered.itemId, quantityPacks: 2, requestId: 'actual-buffer-12345678', actor: { uid: 'procurement-a' } };
  const submitted = await submitOperationalHqBufferOrder(bufferInput, procurement);
  assert.equal(submitted.alreadySubmitted, false);
  assert.equal((await submitOperationalHqBufferOrder(bufferInput, procurement)).alreadySubmitted, true);
  await assert.rejects(submitOperationalHqBufferOrder({ ...bufferInput, quantityPacks: 3 }, procurement), /different contents/);


  const bufferOrderSnapshot = await getDoc(doc(procurement, 'stock_orders', submitted.orderId));
  const bufferOrder = { ...bufferOrderSnapshot.data(), id: submitted.orderId, status: 'approved' };
  const actualBufferLineId = `op_hq_buffer_line_${bufferInput.requestId}`;
  const bufferLineSnapshot = await getDoc(doc(procurement, 'stock_order_lines', actualBufferLineId));
  const bufferLine = { ...bufferLineSnapshot.data(), id: actualBufferLineId, supplier_type: 'external', supplier_id: 'supplier-test', supplier_name: 'Stationery Supplier', line_status: 'approved' };
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'stock_orders', bufferOrder.id), bufferOrder);
    await setDoc(doc(context.firestore(), 'stock_order_lines', bufferLine.id), bufferLine);
  });
  const grnInput = { tenantId, order: bufferOrder, lines: [bufferLine], editedLines: { [actualBufferLineId]: { qty: 2, unitCostUGX: 1000 } },
    invoiceNumber: 'OP-TEST-001', invoiceDate: '2026-10-13', paymentType: 'credit', inputVat: 0, whtAmount: 0, notes: '', user: { uid: 'procurement-a', name: 'Buyer' } };
  const receipt = await processOperationalGrn(grnInput, procurement);
  assert.equal(receipt.alreadyProcessed, false);
  // Operational GRN must create one unpaid supplier invoice and one credit
  // payable, without creating a cash draft or debiting petty cash.
  const canonicalInvoiceId = `procurement_invoice_${receipt.grnId}`;
  const canonicalInvoice = (await getDoc(doc(procurement, 'invoices', canonicalInvoiceId))).data();
  const creditPayable = (await getDoc(doc(procurement, 'creditLedger', `supplier_credit_${receipt.grnId}`))).data();
  assert.equal(canonicalInvoice?.inventoryClass, 'OPERATIONAL');
  assert.equal(canonicalInvoice?.invoiceValue, 2000);
  assert.equal(canonicalInvoice?.paymentType, 'credit');
  assert.equal(canonicalInvoice?.paymentStatus, 'Outstanding');
  assert.equal(canonicalInvoice?.paidAmountUGX, 0);
  assert.equal(creditPayable?.remainingCreditBalance, 2000);
  assert.equal((await getDoc(doc(procurement, 'management_expenses',
    `management_payment_draft_${receipt.grnId}`))).exists(), false);
  assert.equal((await getDoc(doc(procurement, 'procurement_invoices',
    `procurement_register_${receipt.grnId}`))).exists(), true);
  assert.equal((await getDoc(doc(procurement, 'operational_inventory', registered.itemId))).data().quantityInStock, 2);
  const receivedItem = (await getDoc(doc(procurement, 'operational_inventory', registered.itemId))).data();
  const receiptMovement = (await getDoc(doc(procurement, 'operational_inventory_movements', receivedItem.lastMovementId))).data();
  assert.equal(receiptMovement.movementType, 'RECEIPT');
  assert.equal(receiptMovement.sourceTransactionId, receipt.grnId);
  assert.equal(receiptMovement.quantityDelta, 2);
  assert.equal(receivedItem.costPerPack, 1000);
  assert.equal(receiptMovement.unitCostUGX, 1000);
  assert.equal((await submitOperationalHqBufferOrder(bufferInput, procurement)).alreadySubmitted, true);
  assert.equal((await processOperationalGrn(grnInput, procurement)).alreadyProcessed, true);
  assert.equal((await getDoc(doc(procurement, 'operational_inventory', registered.itemId))).data().quantityInStock, 2);


  const distributionInput = { tenantId, destinationBranchId: branchA, destinationBranchName: 'Branch A', itemId: registered.itemId, quantity: 1, requestId: 'actual-dispatch-12345', actor: { uid: 'procurement-a', name: 'Buyer' } };
  const distribution = await createHqOperationalDistribution(distributionInput, procurement);
  assert.equal((await getDoc(doc(procurement, 'operational_inventory', registered.itemId))).data().quantityInStock, 1);
  assert.equal((await getDoc(doc(branchManager, 'operational_inventory', branchRegistration.itemId))).data().quantityInStock, 0);
  assert.equal((await createHqOperationalDistribution(distributionInput, procurement)).transferId, distribution.transferId);
  assert.equal((await getDoc(doc(procurement, 'operational_inventory', registered.itemId))).data().quantityInStock, 1);
  const dispatchLines = await getDocs(query(collection(procurement, 'operational_transfer_lines'), where('tenantId', '==', tenantId), where('transferId', '==', distribution.transferId)));
  assert.equal(dispatchLines.size, 1);
  const dispatchLine = { ...dispatchLines.docs[0].data(), id: dispatchLines.docs[0].id };
  const receiveInput = { tenantId, transferId: distribution.transferId, line: dispatchLine, accepted: 1, queried: 0, actor: {uid:'manager-a',name:'Manager'}, activeBranchId:branchA };
  assert.equal((await receiveOperationalTransferLine(receiveInput, branchManager)).alreadyReceived, false);
  assert.equal((await receiveOperationalTransferLine(receiveInput, branchManager)).alreadyReceived, true);
  assert.equal((await getDoc(doc(branchManager, 'operational_inventory', branchRegistration.itemId))).data().quantityInStock, 1);
  assert.equal((await getDoc(doc(branchManager, 'operational_inventory', branchRegistration.itemId))).data().costPerPack, 1000);


  const returnInput = {tenantId, branchId:branchA, itemId:branchRegistration.itemId, quantity:1, reason:'Test return', requestId:'actual-return-12345', actor:{uid:'manager-a',name:'Manager'}};
  const returned = await createOperationalBranchReturn(returnInput, branchManager);
  assert.equal((await getDoc(doc(branchManager, 'operational_inventory', branchRegistration.itemId))).data().quantityInStock, 0);
  assert.equal((await getDoc(doc(procurement, 'operational_inventory', registered.itemId))).data().quantityInStock, 1);
  assert.equal((await createOperationalBranchReturn(returnInput, branchManager)).transferId, returned.transferId);
  const returnRows = await getDocs(query(collection(procurement, 'operational_transfer_lines'), where('tenantId','==',tenantId), where('transferId','==',returned.transferId)));
  const returnLine = {...returnRows.docs[0].data(),id:returnRows.docs[0].id};
  const returnReceiptInput = {tenantId, transferId:returned.transferId, line:returnLine, actor:{uid:'procurement-a',name:'Buyer'}};
  assert.equal((await receiveOperationalBranchReturn(returnReceiptInput, procurement)).alreadyReceived, false);
  assert.equal((await receiveOperationalBranchReturn(returnReceiptInput, procurement)).alreadyReceived, true);
  assert.equal((await getDoc(doc(procurement, 'operational_inventory', registered.itemId))).data().quantityInStock, 2);


  // Custom Inventory permission uses the same derived realm ID as the UI when
  // a legacy staff profile does not contain a roleRealmId.
  const customInventory = testEnv.authenticatedContext('custom-inventory-a', {tenantId}).firestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(),'staff','custom-inventory-a'),{tenantId,role:'Store Officer',assigned_branches:['HQ']});
    await setDoc(doc(context.firestore(),'role_realms_of_operation',`${tenantId}_store_officer`),{tenantId,roleType:'custom',roleName:'Store Officer',permissions:{inventory:{accessLevel:'view_functional'}}});
  });
  await saveOperationalLocationItem({...registration,actor:{uid:'custom-inventory-a',name:'Store Officer'},data:{...registration.data,name:'Custom Inventory Item'}},customInventory);
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(),'role_realms_of_operation',`${tenantId}_store_officer`),{tenantId,roleType:'custom',roleName:'Store Officer',permissions:{inventory:{accessLevel:'view_only'}}});
  });
  await assertFails(saveOperationalLocationItem({...registration,actor:{uid:'custom-inventory-a',name:'Store Officer'},data:{...registration.data,name:'Read Only Item'}},customInventory));

  const staleOwner = testEnv.authenticatedContext('stale-owner-a',{tenantId,role:'Owner'}).firestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(),'staff','stale-owner-a'),{tenantId,role:'Branch Manager',assigned_branches:[branchA]});
  });
  await assertFails(saveOperationalLocationItem({...registration,actor:{uid:'stale-owner-a',name:'Manager'},data:{...registration.data,name:'Unauthorized HQ Item'}},staleOwner));
  const staleTenant = testEnv.authenticatedContext('procurement-a',{tenantId:'tenant-b',role:'Procurement Head'}).firestore();
  await assertFails(getDoc(doc(staleTenant,'operational_inventory_masters','foreign-master')));
  await assertSucceeds(getDoc(doc(staleTenant,'operational_inventory_masters','op-master')));

  // The HQ buffer-order transaction first reads both deterministic target IDs.
  // Only Procurement may preflight these missing Operational IDs, and the feature
  // toggle must remain enabled. The subsequent atomic order+line create is class-
  // and master-validated by getAfter and the Operational HQ item/master records.
  const bufferOrderId = 'op_hq_buffer_retry_01';
  const bufferLineId = 'op_hq_buffer_line_retry_01';
  await assertSucceeds(getDoc(doc(procurement, 'stock_orders', bufferOrderId)));
  await assertSucceeds(getDoc(doc(procurement, 'stock_order_lines', bufferLineId)));
  await assertFails(getDoc(doc(branchManager, 'stock_orders', 'op_hq_buffer_branch_manager')));
  const bufferBatch = writeBatch(procurement);
  bufferBatch.set(doc(procurement, 'stock_orders', bufferOrderId), {
    ...stockOrder(bufferOrderId, 'non_sellable', 'OPERATIONAL', 'HQ'),
    requesting_branch_name: 'HQ Operational Store', status: 'submitted'
  });
  bufferBatch.set(doc(procurement, 'stock_order_lines', bufferLineId), {
    ...operationalLine(bufferLineId, bufferOrderId, 'op-item-hq'),
    isOperational: true, qty_ordered: 2, qty_received: 0, unit_cost_ugx: 1000, line_total_ugx: 2000
  });
  await assertSucceeds(bufferBatch.commit());
  const tenantBProcurement = testEnv.authenticatedContext('procurement-b', { tenantId: 'tenant-b', role: 'Procurement Head' }).firestore();
  await assertFails(getDoc(doc(tenantBProcurement, 'stock_orders', bufferOrderId)));

  await assertSucceeds(setDoc(doc(branchManager, 'stock_orders', 'op-order'),
    stockOrder('op-order', 'non_sellable', 'OPERATIONAL')));
  await assertSucceeds(setDoc(doc(branchManager, 'stock_orders', 'sellable-order'),
    stockOrder('sellable-order', 'sellable_non_cosmetic', 'SELLABLE')));
  await assertFails(setDoc(doc(branchManager, 'stock_orders', 'mixed-order'),
    stockOrder('mixed-order', 'non_sellable', 'SELLABLE')));
  await assertSucceeds(setDoc(doc(branchManager, 'stock_order_lines', 'op-line'),
    operationalLine('op-line', 'op-order', 'op-item-a')));
  await assertFails(setDoc(doc(branchManager,'stock_orders','cross-branch-op-order'),stockOrder('cross-branch-op-order','non_sellable','OPERATIONAL',branchB)));
  await assertFails(setDoc(doc(branchManager,'stock_order_lines','cross-branch-op-line'),operationalLine('cross-branch-op-line','op-order','op-item-b')));
  await assertFails(setDoc(doc(procurement,'stock_order_lines','negative-op-quantity'),{...operationalLine('negative-op-quantity','op-order','op-item-a'),qty_ordered:-1}));
  await assertFails(setDoc(doc(procurement,'stock_order_lines','negative-op-cost'),{...operationalLine('negative-op-cost','op-order','op-item-a'),unit_cost_ugx:-1,line_total_ugx:-1}));
  await assertFails(setDoc(doc(procurement,'stock_order_lines','infinite-op-quantity'),{...operationalLine('infinite-op-quantity','op-order','op-item-a'),qty_ordered:Infinity,line_total_ugx:Infinity}));
  await assertSucceeds(setDoc(doc(procurement,'stock_orders','other-op-order'),stockOrder('other-op-order','non_sellable','OPERATIONAL')));
  await assertFails(setDoc(doc(procurement,'stock_order_lines','op-line'),{order_id:'other-op-order'},{merge:true}));
  await assertFails(setDoc(doc(procurement,'stock_order_lines','sellable-as-operational'),operationalLine('sellable-as-operational','op-order','explicit-sellable-location')));

  await assertFails(setDoc(doc(branchManager, 'stock_order_lines', 'sellable-on-op-order'), {
    tenantId, order_id: 'op-order', inventoryClass: 'SELLABLE', product_id: 'sellable-item'
  }));
  await assertFails(setDoc(doc(branchManager, 'stock_order_lines', 'op-on-sellable-order'),
    operationalLine('op-on-sellable-order', 'sellable-order', 'op-item-a')));

  await assertSucceeds(setDoc(doc(branchManager, 'transfer_invoices', 'op-transfer'), {
    tenantId, inventoryClass: 'OPERATIONAL', order_id: 'op-order'
  }));
  await assertFails(setDoc(doc(branchManager, 'transfer_invoice_lines', 'op-transfer-sellable-line'), {
    tenantId, inventoryClass: 'OPERATIONAL', transfer_id: 'op-transfer', product_id: 'sellable-item'
  }));
  await assertSucceeds(setDoc(doc(branchManager, 'transfer_invoices', 'sellable-transfer'), {
    tenantId, inventoryClass: 'SELLABLE', order_id: 'sellable-order'
  }));
  await assertFails(setDoc(doc(branchManager, 'transfer_invoice_lines', 'sellable-transfer-op-line'), {
    tenantId, inventoryClass: 'SELLABLE', transfer_id: 'sellable-transfer', product_id: 'op-item-a'
  }));

  const operationalGrn = {
    tenantId, inventoryClass: 'OPERATIONAL', order_id: 'op-order',
    destination_store_id: 'HQ_OPERATIONAL', status: 'completed', grn_status: 'completed',
    receivedBy: 'procurement-a', itemCount: 1, total_value_ugx: 1000
  };
  await assertSucceeds(setDoc(doc(procurement, 'grn_records', 'op-grn'), operationalGrn));
  await assertFails(setDoc(doc(procurement, 'grn_records', 'mixed-op-grn'), {
    ...operationalGrn,
    items: [
      { inventoryClass: 'OPERATIONAL', product_id: 'op-item-a' },
      { inventoryClass: 'SELLABLE', product_id: 'sellable-item' }
    ]
  }));

  await testEnv.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'system_settings', tenantId), {
    tenantId, featureToggles: { enableOperationalInventory: false }
  }));
  await assertFails(setDoc(doc(branchManager, 'stock_orders', 'op-order-disabled'),
    stockOrder('op-order-disabled', 'non_sellable', 'OPERATIONAL')));
  await assertFails(getDoc(doc(procurement, 'stock_orders', 'op_hq_buffer_toggle_off')));
  await assertFails(getDoc(doc(procurement, 'stock_order_lines', 'op_hq_buffer_line_toggle_off')));
  await assertFails(setDoc(doc(branchManager, 'operational_inventory_identity_claims', 'opidentity_claim_toggle_off'), claimDraft('manager-a')));
  await testEnv.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'system_settings', tenantId), {
    tenantId, featureToggles: { enableOperationalInventory: true }
  }));

  // First usage transaction must read a missing deterministic usage record,
  // then commit one branch-scoped stock deduction, movement, and immutable usage.
  await assertSucceeds(getDoc(doc(branchManager, 'operational_inventory_usage', 'opusage_validusage')));
  await assertFails(getDoc(doc(unauthenticated, 'operational_inventory_usage', 'opusage_validusage')));
  const validUsageBatch = writeBatch(branchManager);
  validUsageBatch.update(doc(branchManager, 'operational_inventory', 'op-item-a'), {
    quantityInStock: 7, lastMovementId: 'opm_usage_validusage', updatedAt: new Date().toISOString()
  });
  validUsageBatch.set(doc(branchManager, 'operational_inventory_movements', 'opm_usage_validusage'), {
    tenantId, inventoryClass: 'OPERATIONAL', itemId: 'op-item-a', masterItemId: 'op-master',
    itemName: 'Paper', locationId: `BRANCH_${branchA}`, branchId: branchA, movementType: 'USAGE',
    quantityDelta: -3, balanceBefore: 10, balanceAfter: 7, unitCostUGX: 0, totalValueUGX: 0,
    reference: 'OPU-validusage', reason: 'Dispensing', idempotencyKey: 'usage_validusage',
    actorId: 'manager-a', actorName: 'Branch Manager',
    sourceTransactionId: 'opusage_validusage', sourceLineId: 'opusage_validusage',
    createdAt: new Date().toISOString()
  });
  validUsageBatch.set(doc(branchManager, 'operational_inventory_usage', 'opusage_validusage'), {
    tenantId, inventoryClass: 'OPERATIONAL', operationalType: 'CONSUMABLE_OPERATIONAL',
    idempotencyKey: 'validusage', branchId: branchA, inventoryId: 'op-item-a',
    itemName: 'Paper', issuedAmount: 3, unitOfIssue: 'ream',
    unitCostUGX: 0, cost: 0, timestamp: new Date().toISOString(), period: 'daily',
    department: 'Dispensing', recipient: '', purpose: 'Dispensing', reference: 'OPU-validusage',
    remainingStock: 7, movementId: 'opm_usage_validusage',
    staffId: 'manager-a', staffName: 'Branch Manager'
  });
  await assertSucceeds(validUsageBatch.commit());
  assert.equal((await getDoc(doc(branchManager, 'operational_inventory', 'op-item-a'))).data().quantityInStock, 7);
  await assertFails(setDoc(doc(branchManager, 'operational_inventory_usage', 'opusage_validusage'), { purpose: 'Overwrite' }, { merge: true }));

  const usageBatch = writeBatch(branchManager);
  const usageId = 'opusage_branch-scope';
  const movementId = 'opm_branch-scope';
  usageBatch.update(doc(branchManager, 'operational_inventory', 'op-item-b'), {
    quantityInStock: 9, lastMovementId: movementId
  });
  usageBatch.set(doc(branchManager, 'operational_inventory_movements', movementId), {
    tenantId, inventoryClass: 'OPERATIONAL', itemId: 'op-item-b', masterItemId: 'op-master',
    itemName: 'Paper', locationId: `BRANCH_${branchB}`, branchId: branchB, movementType: 'USAGE',
    quantityDelta: -1, balanceBefore: 10, balanceAfter: 9, unitCostUGX: 100, totalValueUGX: 100,
    reference: 'BRANCH-SCOPE', idempotencyKey: 'branch-scope', actorId: 'manager-a',
    sourceTransactionId: usageId, sourceLineId: usageId
  });
  usageBatch.set(doc(branchManager, 'operational_inventory_usage', usageId), {
    tenantId, inventoryClass: 'OPERATIONAL', operationalType: 'CONSUMABLE_OPERATIONAL',
    idempotencyKey: 'branch-scope', branchId: branchB, inventoryId: 'op-item-b',
    issuedAmount: 1, cost: 100, department: 'Office', purpose: 'Testing', reference: 'BRANCH-SCOPE',
    movementId, staffId: 'manager-a'
  });
  await assertFails(usageBatch.commit());


  // Stage 2 Masaka regression: a previous failed external-supplier dispatch
  // left a transfer header status=dispatching but ZERO transfer lines/movements.
  // An authorized Procurement Head must safely resume that exact header.
  const stageOrderId = 'stage2-external-resume-test';
  const stageLineId = 'stage2-external-resume-line';
  const stageHash = value => {
    let code = 2166136261;
    for (let i = 0; i < value.length; i++) {
      code ^= value.charCodeAt(i);
      code = Math.imul(code, 16777619);
    }
    return (code >>> 0).toString(36).toUpperCase();
  };
  const stagedTransferId = `optr_${stageOrderId}_${stageHash(stageOrderId)}`;
  await testEnv.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, 'stock_orders', stageOrderId), {
      tenantId, order_number: 'ORD-STAGE2-RESUME-TEST', inventoryClass: 'OPERATIONAL',
      category: 'non_sellable', requesting_branch_id: branchA,
      requesting_branch_name: 'Emulator Branch', status: 'fully_received'
    });
    await setDoc(doc(adminDb, 'stock_order_lines', stageLineId), {
      tenantId, order_id: stageOrderId, inventoryClass: 'OPERATIONAL',
      supplier_type: 'external', line_status: 'received', qty_received: 1,
      qty_ordered: 1, unit_cost_ugx: 1000, product_name: 'Test notebooks',
      masterItemId: registered.masterItemId, product_id: branchRegistration.itemId
    });
    await setDoc(doc(adminDb, 'operational_transfers', stagedTransferId), {
      id: stagedTransferId, tenantId, inventoryClass: 'OPERATIONAL',
      fulfillmentSource: 'EXTERNAL_SUPPLIER', transferNumber: 'OT-STAGE2-RESUME-TEST',
      sourceLocationId: 'HQ_OPERATIONAL', sourceBranchId: 'HQ',
      destinationBranchId: branchA, destinationBranchName: 'Emulator Branch',
      sourceOrderId: stageOrderId, sourceOrderNumber: 'ORD-STAGE2-RESUME-TEST',
      status: 'dispatching', expectedLineCount: 1, remainingExternalPacks: 0,
      totalValueUGX: 1000, dispatchedBy: 'procurement-a', dispatchedByName: 'Buyer'
    });
    await setDoc(doc(adminDb, 'operational_inventory', registered.itemId), {
      ...(await getDoc(doc(adminDb, 'operational_inventory', registered.itemId))).data(),
      quantityInStock: 3
    });
  });
  const resumedStageOrder = {
    id: stageOrderId, tenantId, order_number: 'ORD-STAGE2-RESUME-TEST',
    category: 'non_sellable', inventoryClass: 'OPERATIONAL',
    requesting_branch_id: branchA, requesting_branch_name: 'Emulator Branch',
    status: 'fully_received'
  };
  const stageInput = {
    tenantId, order: resumedStageOrder, destinationBranchName: 'Emulator Branch',
    actor: { uid: 'procurement-a', name: 'Buyer' }
  };
  const resumed = await dispatchOperationalOrderToBranch(stageInput, procurement);
  assert.equal(resumed.alreadyDispatched, false);
  const staged = await getDoc(doc(procurement, 'operational_transfers', stagedTransferId));
  assert.equal(staged.data().status, 'dispatched');
  const stageLines = await getDocs(query(collection(procurement, 'operational_transfer_lines'),
    where('tenantId','==', tenantId), where('transferId', '==', stagedTransferId)));
  assert.equal(stageLines.size, 1);
  assert.equal(stageLines.docs[0].data().status, 'dispatched');
  const stageMovement = await getDoc(doc(procurement, 'operational_inventory_movements',
    stageLines.docs[0].data().dispatchMovementId));
  assert.equal(stageMovement.exists(), true);
  assert.equal(stageMovement.data().quantityDelta, -1);
  const resumedAgain = await dispatchOperationalOrderToBranch(stageInput, procurement);
  assert.equal(resumedAgain.alreadyDispatched, true);
  const stageLinesAfter = await getDocs(query(collection(procurement, 'operational_transfer_lines'),
    where('tenantId','==', tenantId), where('transferId', '==', stagedTransferId)));
  assert.equal(stageLinesAfter.size, 1);

  console.log('[operational-inventory-rules] PASS: buffer-order preflight/create, order, GRN, transfer, master, store and usage writes stay class-, tenant- and branch-scoped.');
} finally {
  rmSync('.operational-registration-emulator.mjs', { force: true });
  rmSync('.operational-buffer-emulator.mjs', { force: true });
  await testEnv.cleanup();
}
