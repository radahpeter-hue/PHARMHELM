import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatSystemIdentity } from '../src/services/systemIdentityService';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const platform = readFileSync(new URL('../src/pages/PlatformAdmin.tsx', import.meta.url), 'utf8');
const branches = readFileSync(new URL('../src/modules/hr/BranchManager.tsx', import.meta.url), 'utf8');

test('business IDs are formatted and cannot have invalid sequence or prefix', () => {
  assert.equal(formatSystemIdentity('TEN', 1), 'TEN-000001');
  assert.equal(formatSystemIdentity('BR', 1000000), 'BR-1000000');
  assert.throws(() => formatSystemIdentity('br', 1));
  assert.throws(() => formatSystemIdentity('TEN', 0));
  assert.throws(() => formatSystemIdentity('TEN', 1.5));
});

test('tenant and branch creation use transactional identity allocator', () => {
  assert.match(platform, /await createTenantIdentity\(/);
  assert.match(platform, /await createBranchIdentity\(tenantId/);
  assert.match(branches, /await createBranchIdentity\(profile.tenantId/);
  assert.doesNotMatch(branches, /BR-\$\{Math.random\(/);
});

test('identity counters are monotonic and protected from deletion', () => {
  const section = rules.split('match /identity_sequence_counters/{counterId} {')[1]?.split('match /tenants/{tenantId} {')[0];
  assert.ok(section);
  assert.ok(section.includes('lastSequence == resource.data.lastSequence + 1'));
  assert.ok(section.includes('allow delete: if false'));
  assert.ok(section.includes("counterId == requestedMap.tenantId + '_branches'"));
});

test('tenant and branch codes cannot be changed after creation', () => {
  assert.ok(rules.includes('request.resource.data.tenant_code == resource.data.tenant_code'));
  assert.ok(rules.includes('request.resource.data.branch_code == resource.data.branch_code'));
});
