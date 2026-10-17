import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  inventoryClassForOrderCategory,
  itemMatchesInventoryClass,
  operationalInventoryEnabledFromSettings,
  operationalTypeForLegacyType,
  orderLinesMatchInventoryClass,
  planOperationalOrderFulfillment
} from '../src/services/inventoryClassification';

test('sellable order categories and operational order categories map to one class', () => {
  assert.equal(inventoryClassForOrderCategory('sellable_non_cosmetic'), 'SELLABLE');
  assert.equal(inventoryClassForOrderCategory('sellable_cosmetic'), 'SELLABLE');
  assert.equal(inventoryClassForOrderCategory('non_sellable'), 'OPERATIONAL');
});

test('operational subtype preserves the legacy fixed/non-fixed distinction', () => {
  assert.equal(operationalTypeForLegacyType('non-fixed'), 'CONSUMABLE_OPERATIONAL');
  assert.equal(operationalTypeForLegacyType('fixed'), 'FIXED_ASSET');
});

test('item and order-line validators reject missing or mixed classifications', () => {
  assert.equal(itemMatchesInventoryClass({ inventoryClass: 'OPERATIONAL', operationalType: 'FIXED_ASSET' }, 'OPERATIONAL'), true);
  assert.equal(itemMatchesInventoryClass({ inventoryClass: 'OPERATIONAL' }, 'OPERATIONAL'), false);
  assert.equal(itemMatchesInventoryClass({ inventoryClass: 'OPERATIONAL', operationalType: 'CONSUMABLE_OPERATIONAL' }, 'SELLABLE'), false);
  assert.equal(orderLinesMatchInventoryClass('OPERATIONAL', [{ inventoryClass: 'OPERATIONAL' }, { inventoryClass: 'OPERATIONAL' }]), true);
  assert.equal(orderLinesMatchInventoryClass('OPERATIONAL', [{ inventoryClass: 'OPERATIONAL' }, { inventoryClass: 'SELLABLE' }]), false);
});

test('Operational HQ fulfilment splits only the remaining packs to external sourcing', () => {
  assert.deepEqual(planOperationalOrderFulfillment({ orderedPacks: 100, internalPacks: 60, hqIssueUnits: 600, unitsPerPack: 10 }), {
    requestedPacks: 100, internalPacks: 60, externalPacks: 40, internalIssueUnits: 600
  });
  assert.deepEqual(planOperationalOrderFulfillment({ orderedPacks: 100, internalPacks: 100, hqIssueUnits: 1000, unitsPerPack: 10 }), {
    requestedPacks: 100, internalPacks: 100, externalPacks: 0, internalIssueUnits: 1000
  });
  assert.throws(() => planOperationalOrderFulfillment({ orderedPacks: 100, internalPacks: 61, hqIssueUnits: 600, unitsPerPack: 10 }), /insufficient/i);
  assert.throws(() => planOperationalOrderFulfillment({ orderedPacks: 100, internalPacks: 101, hqIssueUnits: 2000, unitsPerPack: 10 }), /exceed/i);
});

test('Operational Inventory fails closed unless the canonical tenant setting is on', () => {
  assert.equal(operationalInventoryEnabledFromSettings('tenant-a', { tenantId: 'tenant-a', featureToggles: { enableOperationalInventory: true } }), true);
  assert.equal(operationalInventoryEnabledFromSettings('tenant-a', { tenantId: 'tenant-b', featureToggles: { enableOperationalInventory: true } }), false);
  assert.equal(operationalInventoryEnabledFromSettings('tenant-a', { tenantId: 'tenant-a', featureToggles: { enableOperationalInventory: false } }), false);
  assert.equal(operationalInventoryEnabledFromSettings('tenant-a', null), false);
});

test('Inventory has no feature control and reads its tab gate from the canonical setting hook', () => {
  const inventory = readFileSync(new URL('../src/pages/Inventory.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.doesNotMatch(inventory, /toggleOperational|onClick=\{toggleOperational\}/);
  assert.match(inventory, /operationalInventoryEnabled && canOperateInventory/);
  assert.match(settings, /Operational Inventory/);
  assert.match(settings, /enableOperationalInventory/);
  assert.match(rules, /system_settings\/\$\(tenantId\)/);
  assert.match(rules, /function isOperationalInventoryEnabled\(tenantId\)/);
  assert.match(rules, /function hasValidLineClass\(requireExplicitClass\)/);
});

test('Stock In/Out selects one order stream, filters Operational items, and rejects cross-stream lines', () => {
  const stockInOut = readFileSync(new URL('../src/pages/StockInOut.tsx', import.meta.url), 'utf8');
  const submission = readFileSync(new URL('../src/services/orderSubmissionService.ts', import.meta.url), 'utf8');
  assert.match(stockInOut, /value="non_sellable">Operational Inventory/);
  assert.match(stockInOut, /const filteredOps = operationalInventory\.filter/);
  assert.match(stockInOut, /This order contains an item from another inventory stream/);
  assert.match(stockInOut, /An existing order cannot change inventory class/);
  assert.match(stockInOut, /inventoryClass: inventoryClassForOrderCategory\(category\)/);
  assert.match(submission, /function isOperationalAutoLine/);
  assert.match(submission, /const inventoryClass = isOperationalAutoLine\(items\[0\]\)/);
});

test('Procurement labels Operational orders and never offers Sellable HQ stock as their source', () => {
  const procurement = readFileSync(new URL('../src/pages/Procurement.tsx', import.meta.url), 'utf8');
  assert.match(procurement, /Operational HQ Store Assessment/);
  assert.match(procurement, /Fulfill from Operational Store/);
  assert.match(procurement, /getOperationalHqItem/);
  assert.match(procurement, /suppliers\.filter\(supplier => supplierEligibleForStream\(supplier, isOperationalOrder \? 'OPERATIONAL' : 'SELLABLE'\)\)/);
  assert.match(procurement, /setIsDetailModalOpen\(false\)/);
  assert.match(procurement, /setIsSourcingModalOpen\(false\)/);
});

test('Operational HQ Store is a separate, settings-gated Procurement tab with its own movement ledger', () => {
  const procurement = readFileSync(new URL('../src/pages/Procurement.tsx', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../src/components/procurement/OperationalHQStoreTab.tsx', import.meta.url), 'utf8');
  const movementService = readFileSync(new URL('../src/services/operationalInventoryMovementService.ts', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(procurement, /operationalInventoryEnabled \? \[\{ id: 'operational_hq_inventory', label: 'Operational HQ Store'/);
  assert.match(procurement, /activeTab === 'operational_hq_inventory' && operationalInventoryEnabled/);
  assert.match(store, /operational_inventory_movements/);
  assert.match(store, /locationId === 'HQ_OPERATIONAL'/);
  assert.match(store, /postOperationalStoreMovement/);
  assert.match(movementService, /runTransaction\(connection/);
  assert.match(movementService, /alreadyProcessed: true/);
  assert.match(movementService, /existing\.quantityDelta !== input\.quantityDelta/);
  assert.match(rules, /match \/operational_inventory_movements\/\{movementId\}/);
  assert.match(rules, /allow update, delete: if false/);
  assert.match(rules, /movementId == 'opm_' \+ request\.resource\.data\.idempotencyKey/);
  assert.match(rules, /request\.resource\.data\.actorId == request\.auth\.uid/);
  assert.match(rules, /hasMatchingOperationalMovement\(\)/);
});

test('Operational location records link to a tenant master and order lines carry that identity', () => {
  const masterService = readFileSync(new URL('../src/services/operationalInventoryMasterService.ts', import.meta.url), 'utf8');
  const inventory = readFileSync(new URL('../src/components/inventory/OperationalInventoryTab.tsx', import.meta.url), 'utf8');
  const stockInOut = readFileSync(new URL('../src/pages/StockInOut.tsx', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(masterService, /runTransaction\(connection/);
  assert.match(masterService, /Operational Inventory is disabled in System Settings/);
  assert.match(masterService, /masterItemId/);
  assert.match(inventory, /operational_inventory_masters/);
  assert.match(inventory, /Link this location to an existing item/);
  assert.match(stockInOut, /op\.branchId === activeBranchId/);
  assert.match(stockInOut, /masterItemId: op\.masterItemId \|\| op\.id/);
  assert.match(rules, /match \/operational_inventory_masters\/\{masterItemId\}/);
  assert.match(rules, /hasOperationalMaster\(\)/);
  assert.match(rules, /operationalMasterPath/);
});

test('Operational GRNs receive only into the Operational HQ ledger and cannot use sellable dispatch', () => {
  const grnService = readFileSync(new URL('../src/services/operationalGrnService.ts', import.meta.url), 'utf8');
  const procurement = readFileSync(new URL('../src/pages/Procurement.tsx', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const sellableGrn = readFileSync(new URL('../src/services/procurementFinanceService.ts', import.meta.url), 'utf8');
  assert.match(grnService, /inventoryClass: 'OPERATIONAL'/);
  assert.match(grnService, /destination_store_id: 'HQ_OPERATIONAL'/);
  assert.match(grnService, /transaction\.set\(movementRefs/);
  assert.match(grnService, /alreadyProcessed: true/);
  assert.match(grnService, /qty_received_units: receivedUnits/);
  assert.match(procurement, /processOperationalGrn\(/);
  assert.match(procurement, /!isOperationalInventoryRecord\(o\)/);
  assert.match(procurement, /HQ Dispatch Register/);
  assert.match(procurement, /Dispatch Operational/);
  assert.match(procurement, /dispatchOperationalOrderToBranch\(/);
  assert.match(rules, /match \/operational_transfers\/\{transferId\}/);
  assert.match(rules, /match \/operational_transfer_lines\/\{transferLineId\}/);
  assert.match(rules, /validTransferMovement\(get\(itemPath\(\)\)\.data\)/);
  assert.match(rules, /match \/operational_grn_lines\/\{grnLineId\}/);
  assert.match(rules, /getAfter\(movementPath\(\)\)\.data\.sourceTransactionId == request\.resource\.data\.grnId/);
  assert.match(rules, /resource\.data\.inventoryClass != 'OPERATIONAL'/);
  assert.match(sellableGrn, /Operational orders must use the Operational GRN workflow; the sellable procurement processor is blocked/);
});

test('Operational triage uses a distinct HQ transfer and preserves the external remainder under the same order', () => {
  const procurement = readFileSync(new URL('../src/pages/Procurement.tsx', import.meta.url), 'utf8');
  const transfers = readFileSync(new URL('../src/services/operationalTransferService.ts', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(procurement, /Fulfill from Operational Store/);
  assert.match(procurement, /getOperationalPacksAvailable/);
  assert.match(transfers, /fulfillOperationalOrderFromHqStore/);
  assert.match(transfers, /splitFromLineId: line\.id/);
  assert.match(transfers, /supplier_type: 'internal_hq'/);
  assert.match(transfers, /fulfillmentSource: 'HQ_OPERATIONAL'/);
  assert.match(transfers, /operational_external_transfer_id === transferId/);
  assert.match(transfers, /dispatchPreparedOperationalHqTransfer/);
  assert.match(rules, /fulfillmentSource == 'HQ_OPERATIONAL'/);
  assert.match(rules, /quantityDispatched <= get\(sourceOrderLinePath\(\)\)\.data\.qty_ordered/);
});


test('Operational transfer line idempotency lookups allow missing documents only for authorized Procurement users', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const section = rules.slice(rules.indexOf('match /operational_transfer_lines/{transferLineId}'), rules.indexOf('match /operational_inventory_usage/{usageId}'));
  assert.match(section, /resource == null && isProcurement\(\)/);
  assert.match(section, /resource != null && isTenantMember\(resource\.data\.tenantId\)/);
});


test('Dispatch register distinguishes externally received staged transfers from HQ Operational Store transfers', () => {
  const procurement = readFileSync(new URL('../src/pages/Procurement.tsx', import.meta.url), 'utf8');
  assert.match(procurement, /'EXTERNAL_SUPPLIER', 'HQ_DIRECT'/);
  assert.match(procurement, /transfer\.fulfillmentSource === 'EXTERNAL_SUPPLIER'/);
  assert.match(procurement, /handleOperationalDispatch\(order\)/);
  assert.match(procurement, /handleResumeOperationalTransfer\(transfer\)/);
});
