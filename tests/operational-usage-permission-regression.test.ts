import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/operationalInventoryUsageService.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/components/inventory/OperationalInventoryTab.tsx', import.meta.url), 'utf8');

test('usage idempotency point-get permits missing records but lists remain scoped', () => {
  const section = rules.split('match /operational_inventory_usage/{usageId} {')[1]?.split('match /operational_inventory_maintenance/')[0];
  assert.ok(section);
  assert.ok(section.includes('allow get: if isAuthenticated() && (resource == null'));
  assert.ok(section.includes('allow list: if isTenantMember(resource.data.tenantId)'));
  assert.ok(section.includes('isAssignedToBranch(resource.data.branchId)'));
  assert.ok(section.includes('allow update, delete: if false'));
});

test('usage service generates a reference and preserves its audit trail', () => {
  assert.ok(service.includes('input.reference?.trim() ||'));
  assert.ok(service.includes('OPU-${safeId(input.requestId)}'));
  assert.ok(service.includes('reference, remainingStock: after'));
  assert.ok(service.includes("movementType: 'USAGE'"));
});

test('usage selector handles legacy unit and modal scrolls', () => {
  assert.ok(ui.includes("operationalIssueUnit(i.unitOfIssue) || 'units'"));
  assert.ok(ui.includes('max-h-[calc(100dvh-1rem)]'));
  assert.ok(ui.includes('overflow-y-auto overscroll-contain'));
  assert.ok(!ui.includes('value={formData.reference}'));
});
