import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planOperationalInventoryMigration } from '../scripts/operational-inventory-migration-core.mjs';

const base = {
  tenantId: 'tenant-1', items: [], masters: [], movements: [], orders: [], orderLines: [], grns: [],
  usageEntries: [], financeEntries: [], sellableItemIds: [], existingAuditIds: [], actorId: 'admin-1', now: '2026-10-12T00:00:00.000Z'
};

test('legacy Operational location is backfilled with a stable identity and opening stock movement', () => {
  const run = () => planOperationalInventoryMigration({
    ...base,
    items: [{ id: 'paper-masaka', tenantId: 'tenant-1', branchId: 'Masaka', type: 'non-fixed', name: 'A4 Paper', uniqueId: 'OPS-1', unitPerPack: 500, unitOfIssue: 'sheet', quantityInStock: 20, costPerPack: 15000 }]
  });
  const first = run();
  const second = run();
  assert.equal(first.masterCreates.length, 1);
  assert.equal(first.itemBackfills[0].patch.inventoryClass, 'OPERATIONAL');
  assert.equal(first.itemBackfills[0].patch.operationalType, 'CONSUMABLE_OPERATIONAL');
  assert.equal(first.openingMovements[0].balanceBefore, 0);
  assert.equal(first.openingMovements[0].balanceAfter, 20);
  assert.equal(first.openingMovements[0].actorId, 'admin-1');
  assert.equal(second.openingMovements[0].id, first.openingMovements[0].id);
  assert.ok(first.auditCreates.length > 0);
});

test('legacy duplicate candidates with separately generated unique IDs are flagged and never auto-merged', () => {
  const report = planOperationalInventoryMigration({
    ...base,
    items: [
      { id: 'paper-branch-a', tenantId: 'tenant-1', branchId: 'Branch-A', type: 'non-fixed', name: 'A4 Paper', category: 'Stationery', uniqueId: 'OPS-100001', unitPerPack: 5, unitOfIssue: 'ream', quantityInStock: 8 },
      { id: 'paper-branch-b', tenantId: 'tenant-1', branchId: 'Branch-B', type: 'non-fixed', name: ' a4   paper ', category: 'stationery', uniqueId: 'OPS-900001', unitPerPack: 5, unitOfIssue: 'REAM', quantityInStock: 4 }
    ]
  });
  assert.equal(report.masterCreates.length, 0);
  assert.equal(report.itemBackfills.length, 0);
  assert.ok(report.ambiguous.some(row => /Potential duplicate across tenant-wide item identities/.test(row.reason)));
});

test('migration never reclassifies explicit Sellable or mixed historical orders and GRNs', () => {
  const report = planOperationalInventoryMigration({
    ...base,
    items: [{ id: 'paper', tenantId: 'tenant-1', branchId: 'Masaka', type: 'non-fixed', name: 'Paper', inventoryClass: 'SELLABLE', quantityInStock: 5 }],
    orders: [{ id: 'mixed', tenantId: 'tenant-1', category: 'non_sellable' }],
    orderLines: [
      { id: 'op-line', tenantId: 'tenant-1', order_id: 'mixed', product_id: 'ops-item', category: 'non_sellable' },
      { id: 'sell-line', tenantId: 'tenant-1', order_id: 'mixed', product_id: 'sell-item' }
    ],
    sellableItemIds: ['sell-item']
  });
  assert.equal(report.itemBackfills.length, 0);
  assert.equal(report.orderBackfills.length, 0);
  assert.ok(report.ambiguous.some(row => row.entityId === 'paper'));
  assert.ok(report.ambiguous.some(row => row.entityId === 'mixed'));
});

test('migration stops when movement history disagrees with current Operational stock', () => {
  const report = planOperationalInventoryMigration({
    ...base,
    items: [{ id: 'paper', tenantId: 'tenant-1', branchId: 'HQ', type: 'non-fixed', name: 'Paper', uniqueId: 'PAPER', quantityInStock: 15, lastMovementId: 'move-1' }],
    movements: [{ id: 'move-1', tenantId: 'tenant-1', itemId: 'paper', balanceAfter: 10 }]
  });
  assert.equal(report.openingMovements.length, 0);
  assert.ok(report.ambiguous.some(row => /does not reconcile/.test(row.reason)));
});

test('historical usage-linked expenses are flagged and no historical GRN Finance events are generated', () => {
  const report = planOperationalInventoryMigration({
    ...base,
    orders: [{ id: 'old-order', tenantId: 'tenant-1', category: 'non_sellable' }],
    grns: [{ id: 'old-grn', tenantId: 'tenant-1', order_id: 'old-order', status: 'completed', items: [] }],
    usageEntries: [{ id: 'old-usage', tenantId: 'tenant-1' }],
    financeEntries: [{ id: 'expense-1', tenantId: 'tenant-1', reference_type: 'operational_inventory_usage', reference_id: 'old-usage' }]
  });
  assert.equal(report.grnBackfills[0].historicalFinanceReviewRequired, true);
  assert.equal(report.openingMovements.length, 0);
  assert.ok(report.historicalFinanceReview.some(row => row.grnId === 'old-grn'));
  assert.ok(report.historicalFinanceReview.some(row => row.financeEntryId === 'expense-1'));
  assert.equal('financeEvents' in report, false);
});

test('migration runner is tenant-scoped, preview-only by default and stops apply on ambiguity', () => {
  const script = readFileSync(new URL('../scripts/migrate-operational-inventory-v2.mjs', import.meta.url), 'utf8');
  assert.match(script, /--tenant=/);
  assert.match(script, /mode = APPLY \? 'apply' : 'dry-run'/);
  assert.match(script, /if \(APPLY && report\.ambiguous\.length\)/);
  assert.match(script, /currentDocument: \{ updateTime: snapshot\.updateTime \}/);
  assert.match(script, /featureToggles\?\.enableOperationalInventory === true/);
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const itemRule = rules.slice(rules.indexOf('match /operational_inventory/{itemId}'), rules.indexOf('match /operational_inventory_movements/'));
  const movementRule = rules.slice(rules.indexOf('match /operational_inventory_movements/'), rules.indexOf('match /operational_grn_lines/'));
  assert.match(itemRule, /hasOpeningOperationalMovement/);
  assert.match(movementRule, /let data = request\.resource\.data/);
  assert.match(movementRule, /allow create: if validMovementCreate\(\)/);
  assert.match(movementRule, /data\.movementType == 'ADJUSTMENT'/);
  assert.match(movementRule, /data\.balanceBefore == 0/);
  const auditRule = rules.slice(rules.indexOf('match /operational_inventory_migration_audit/'), rules.indexOf('match /grn_records/'));
  assert.match(auditRule, /allow create, update, delete: if false/);
  assert.match(rules, /'operational_inventory_migration_audit','operational_inventory_identity_events','procurement_approval_audit'/);
  assert.match(rules, /'procurement_approval_audit','sellable_receipt_movement_outbox'/);
  assert.ok(rules.includes('match /procurement_approval_audit/{approvalId}'));
  assert.match(rules, /allow update, delete: if false/);
  const masterService = readFileSync(new URL('../src/services/operationalInventoryMasterService.ts', import.meta.url), 'utf8');
  assert.match(masterService, /openingMovementRef/);
  assert.match(masterService, /movementType: 'ADJUSTMENT'/);
  assert.match(masterService, /balanceBefore: 0/);
  assert.match(masterService, /actorId: input\.actor\.uid/);
});
