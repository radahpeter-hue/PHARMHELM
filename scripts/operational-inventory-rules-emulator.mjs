import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';

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
    product_id: productId
  };
}

try {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
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
        tenantId, inventoryClass: 'OPERATIONAL', operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', hqLocationItemId: 'op-item-hq'
      }),
      setDoc(doc(db, 'operational_inventory', 'op-item-hq'), {
        tenantId, branchId: 'HQ', masterItemId: 'op-master', inventoryClass: 'OPERATIONAL',
        operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', name: 'Paper', quantityInStock: 10
      }),
      setDoc(doc(db, 'operational_inventory', 'op-item-a'), {
        tenantId, branchId: branchA, masterItemId: 'op-master', inventoryClass: 'OPERATIONAL',
        operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', name: 'Paper', quantityInStock: 10
      }),
      setDoc(doc(db, 'operational_inventory', 'op-item-b'), {
        tenantId, branchId: branchB, masterItemId: 'op-master', inventoryClass: 'OPERATIONAL',
        operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', name: 'Paper', quantityInStock: 10
      }),
      setDoc(doc(db, 'products', 'sellable-item'), {
        tenantId, inventoryClass: 'SELLABLE', productName: 'Paracetamol'
      })
    ]);
  });

  await assertSucceeds(setDoc(doc(branchManager, 'operational_inventory', 'op-item-a2'), {
    tenantId, branchId: branchA, masterItemId: 'op-master', inventoryClass: 'OPERATIONAL',
    operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', name: 'Notebooks', quantityInStock: 0
  }));
  // The live master-registration service uses a Firestore transaction, which
  // point-reads deterministic item/master/movement IDs before creating them.
  // Missing point-reads must be allowed for authenticated users while the
  // subsequent creates remain fully tenant-, branch- and class-validated.
  await assertSucceeds(getDoc(doc(branchManager, 'operational_inventory', 'missing-item')));
  await assertSucceeds(getDoc(doc(branchManager, 'operational_inventory_masters', 'missing-master')));
  await assertSucceeds(getDoc(doc(branchManager, 'operational_inventory_movements', 'missing-movement')));
  const unauthenticated = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(unauthenticated, 'operational_inventory', 'missing-item')));
  await assertFails(setDoc(doc(branchManager, 'operational_inventory', 'op-item-wrong-branch'), {
    tenantId, branchId: branchB, masterItemId: 'op-master', inventoryClass: 'OPERATIONAL',
    operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed', name: 'Notebooks', quantityInStock: 0
  }));
  await assertFails(setDoc(doc(branchManager, 'products', 'operational-in-products'), {
    tenantId, inventoryClass: 'OPERATIONAL', productName: 'A4 paper'
  }));
  await assertFails(setDoc(doc(branchManager, 'operational_inventory_masters', 'sellable-in-operational'), {
    tenantId, inventoryClass: 'SELLABLE', operationalType: 'CONSUMABLE_OPERATIONAL', type: 'non-fixed'
  }));

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
  await testEnv.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'system_settings', tenantId), {
    tenantId, featureToggles: { enableOperationalInventory: true }
  }));

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

  console.log('[operational-inventory-rules] PASS: buffer-order preflight/create, order, GRN, transfer, master, store and usage writes stay class-, tenant- and branch-scoped.');
} finally {
  await testEnv.cleanup();
}
