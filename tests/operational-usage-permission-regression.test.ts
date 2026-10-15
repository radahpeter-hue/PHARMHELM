import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/operationalInventoryUsageService.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/components/inventory/OperationalInventoryTab.tsx', import.meta.url), 'utf8');

test('usage idempotency point-get permits missing record while list remains branch scoped', () => {
  const section = rules.split('match /operational_inventory_usage/{usageId} {')[1]?.split('match /operational_inventory_maintenance/')[0];
  assert.ok(section, 'Operational usage rule exists');
  assert.match(section, /allow get: if isAuthenticated\\(\\) && \\(resource == null/);
  assert.match(section, /allow list: if isAuthenticated\\(\\) && isTenantMember\\(resource.data.tenantId\\)/);
  assert.match(section, /allow create:[\\s\\S]*isInventoryOperator\\(\\)/);
  assert.match(section, /allow update, delete: if false/);
});

test('usage service generates audited reference rather than requiring manual entry', () => {
  assert.match(service, /input.reference\\?\\.trim\\(\\) \\|\\| \\x60OPU-\\$\\{safeId\\(input.requestId\\)\\}\\x60/);
  assert.match(service, /reference, remainingStock: after/);
  assert.match(service, /movementType: 'USAGE'/);
});

test('usage select displays a semantic unit and modal supports scrolling', () => {
  assert.match(ui, /operationalIssueUnit\\(i.unitOfIssue\\) \\|\\| 'units'/);
  assert.match(ui, /max-h-\\[calc\\(100dvh-1rem\\)\\]/);
  assert.match(ui, /overflow-y-auto overscroll-contain/);
  assert.doesNotMatch(ui, /value=\\{formData.reference\\}/);
});
