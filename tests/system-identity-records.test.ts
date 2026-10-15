import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCOPED_IDENTITY_KINDS, formatSystemIdentity } from '../src/services/systemIdentityService';

const root = new URL('../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('the primary identity prefixes are unique and represent tenant-wide entities', () => {
  const values = Object.values(SCOPED_IDENTITY_KINDS);
  assert.equal(new Set(values.map(v => v.prefix)).size, 5);
  for (const item of values) assert.equal(formatSystemIdentity(item.prefix, 1), `${item.prefix}-000001`);
});

test('CRM, product, HR and alternate registration workflows use the common allocator', () => {
  for (const [path,pattern] of [
    ['src/pages/Clients.tsx', /createScopedIdentity\(collection/],
    ['src/components/inventory/ProductModal.tsx', /createScopedIdentity\('products'/],
    ['src/modules/hr/StaffDirectory.tsx', /createScopedIdentity\('staff'/],
    ['src/modules/hr/RecruitmentManager.tsx', /createScopedIdentity\('staff'/],
    ['src/modules/hr/TraineesManager.tsx', /createScopedIdentity\('staff'/],
    ['src/components/marketing/PrescribersPillar.tsx', /createScopedIdentity\('prescribers'/],
    ['src/components/marketing/ConsentNudgesPillar.tsx', /createScopedIdentity\('clients'/],
    ['src/pages/PlatformAdmin.tsx', /createScopedIdentity\('staff', tenantId/]
  ] as const) assert.match(source(path), pattern, path);
});

test('protected business IDs cannot be overwritten in normal Firestore updates', () => {
  const rules = source('firestore.rules');
  for (const field of ['staff_code', 'employee_id', 'patient_code', 'prescriber_code', 'institution_code', 'productId', 'sku']) {
    assert.ok(rules.includes(`request.resource.data.${field} == resource.data.${field}`), field);
  }
  assert.ok(rules.includes("kind in ['patients', 'prescribers', 'institutions', 'products', 'staff', 'operational_assets', 'operational_consumables']"));
  assert.ok(rules.includes('&& (platformCounter() || branchCounter() || scopedCounter());'), 'Scoped counters must also be incrementable');
});

test('employee number is not manually editable and product codes are not random', () => {
  const hr = source('src/modules/hr/StaffDirectory.tsx');
  const product = source('src/components/inventory/ProductModal.tsx');
  assert.match(hr, /readOnly className=.*Generated automatically on registration/);
  assert.doesNotMatch(product, /productId: mirroredDraft.productId \|\|/);
});
