import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deterministicOperationalIdentityClaimId, deterministicOperationalLocationId, deterministicOperationalMasterId, operationalIdentityFingerprint } from '../src/services/operationalIdentity';
import { buildOperationalHqBufferOrder, operationalHqBufferOrderIds } from '../src/services/operationalHqBufferOrderPolicy';

test('Operational identity keys are stable, tenant-scoped and distinguish materially different item units', () => {
  const first = { name: 'A4 Paper', category: 'Stationery', type: 'non-fixed' as const, unitPerPack: 5, unitOfIssue: 'ream' };
  const equivalent = { ...first, name: '  a4   paper ', category: 'stationery', unitOfIssue: 'REAM' };
  const fingerprint = operationalIdentityFingerprint(first);
  assert.equal(operationalIdentityFingerprint(equivalent), fingerprint);
  assert.equal(deterministicOperationalMasterId('tenant-a', fingerprint), deterministicOperationalMasterId('tenant-a', operationalIdentityFingerprint(equivalent)));
  assert.equal(deterministicOperationalIdentityClaimId('tenant-a', fingerprint), deterministicOperationalIdentityClaimId('tenant-a', operationalIdentityFingerprint(equivalent)));
  assert.notEqual(deterministicOperationalIdentityClaimId('tenant-a', fingerprint), deterministicOperationalIdentityClaimId('tenant-b', fingerprint));
  assert.notEqual(deterministicOperationalMasterId('tenant-a', fingerprint), deterministicOperationalMasterId('tenant-b', fingerprint));
  assert.notEqual(fingerprint, operationalIdentityFingerprint({ ...first, unitOfIssue: 'box' }));
  assert.notEqual(deterministicOperationalLocationId('tenant-a', 'master-a', 'HQ'), deterministicOperationalLocationId('tenant-a', 'master-a', 'branch-1'));
});

test('HQ buffer order uses standard requisition class fields, pack and cost conventions, and deterministic retry IDs', () => {
  const item = { id: 'hq-paper', name: 'A4 Paper', masterItemId: 'paper-master', costPerPack: 12500 } as any;
  const input = { tenantId: 'tenant-a', itemId: item.id, quantityPacks: 4, requestId: 'request-12345678', actor: { uid: 'buyer' } };
  const built = buildOperationalHqBufferOrder(input, item, '2026-10-13T00:00:00Z');
  assert.deepEqual(operationalHqBufferOrderIds(input.requestId), { orderId: built.orderId, lineId: built.lineId });
  assert.equal(built.order.inventoryClass, 'OPERATIONAL');
  assert.equal(built.order.category, 'non_sellable');
  assert.equal(built.order.requesting_branch_id, 'HQ');
  assert.equal(built.order.status, 'submitted');
  assert.equal(built.line.inventoryClass, 'OPERATIONAL');
  assert.equal(built.line.masterItemId, item.masterItemId);
  assert.equal(built.line.product_id, item.id);
  assert.equal(built.line.qty_ordered, 4);
  assert.equal(built.line.unit_cost_ugx, 12500);
  assert.equal(built.line.line_total_ugx, 50000);
});

test('buffer transaction rechecks the toggle and HQ item/master, while Firestore validates HQ line identity', () => {
  const service = readFileSync(new URL('../src/services/operationalHqBufferOrderService.ts', import.meta.url), 'utf8');
  const procurement = readFileSync(new URL('../src/pages/Procurement.tsx', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const lineRules = rules.slice(rules.indexOf('match /stock_order_lines/'), rules.indexOf('match /transfer_invoices/'));
  assert.match(service, /enableOperationalInventory !== true/);
  assert.match(service, /item\.branchId !== 'HQ'/);
  assert.match(service, /master\.hqLocationItemId !== item\.id/);
  assert.match(service, /orderSnapshot\.exists\(\) && lineSnapshot\.exists\(\)/);
  assert.match(service, /orderSnapshot\.exists\(\) \|\| lineSnapshot\.exists\(\)/);
  assert.match(lineRules, /item\.branchId == 'HQ'/);
  assert.match(lineRules, /master\.hqLocationItemId == requestedMap\.product_id/);
  assert.match(lineRules, /requestedMap\.masterItemId == item\.get\('masterItemId', ''\)/);
  assert.match(lineRules, /existsAfter\(orderPath\)/);
  assert.match(lineRules, /isOperationalOrderData\(getAfter\(orderPath\)\.data\)/);
  assert.match(procurement, /const canUseHqOperationalStock = order\.requesting_branch_id !== 'HQ'/);
});

test('registration uses a stable master and per-location identity transaction and requires explicit legacy linking', () => {
  const service = readFileSync(new URL('../src/services/operationalInventoryMasterService.ts', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../src/components/inventory/OperationalInventoryTab.tsx', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(service, /deterministicOperationalMasterId\(tenantId, fingerprint\)/);
  assert.match(service, /deterministicOperationalLocationId\(tenantId, requestedMasterId, branchId\)/);
  assert.match(service, /matchingLegacyMasters/);
  assert.match(service, /transaction\.get\(identityStateRef\)/);
  assert.match(service, /identityStateSnapshot\.data\(\)\.status !== 'READY'/);
  assert.match(service, /transaction\.get\(identityClaimRef\)/);
  assert.match(service, /transaction\.set\(identityClaimRef/);
  assert.match(service, /claim\.masterItemId !== masterItemId/);
  assert.match(service, /identityClaimId = deterministicOperationalIdentityClaimId\(tenantId, fingerprint\)/);
  assert.match(service, /Link this location to that item instead/);
  assert.match(service, /runTransaction\(connection/);
  assert.match(service, /inventoryClass !== 'OPERATIONAL'/);
  assert.match(service, /operational_inventory_identity_events/);
  assert.match(service, /eventType: !itemSnapshot\.exists\(\)/);
  assert.match(ui, /Link this location to an existing item/);
  assert.match(rules, /match \/operational_inventory_identity_events\/\{eventId\}/);
  assert.match(rules, /match \/operational_inventory_identity_claims\/\{claimId\}/);
  assert.match(rules, /request\.resource\.data\.actorId == request\.auth\.uid/);
  assert.match(rules, /allow update, delete: if false/);
  assert.match(rules, /eventId == 'opidentity_' \+ request\.resource\.data\.itemId/);
  assert.match(rules, /allow update, delete: if false/);
});

test('Operational GRN finalization posts one HQ receipt movement and updates HQ Operational SOH atomically', () => {
  const service = readFileSync(new URL('../src/services/operationalGrnService.ts', import.meta.url), 'utf8');
  assert.match(service, /locationId: 'HQ_OPERATIONAL'/);
  assert.match(service, /movementType: 'RECEIPT'/);
  assert.match(service, /transaction\.update\(hqItemRefs\[sourceSnapshotIndex\]/);
  assert.match(service, /transaction\.set\(movementRefs\[sourceSnapshotIndex\]/);
  assert.match(service, /transaction\.set\(grnLineRefs\[sourceSnapshotIndex\]/);
  assert.match(service, /alreadyProcessed: true/);
  assert.match(service, /unitCostIssueUGX = inputRow\.cost \/ unitsPerPack/);
});
