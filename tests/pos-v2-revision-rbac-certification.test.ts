import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canViewGlobalPosV2RevisionAnalytics } from '../src/services/pos-v2/posSaleRevisionV2AnalyticsAccess';

const rules = readFileSync('firestore.rules', 'utf8');
const repository = readFileSync('src/services/pos-v2/posSaleRevisionV2LedgerRepository.ts', 'utf8');
const sales = readFileSync('src/pages/Sales.tsx', 'utf8');
const analytics = readFileSync('src/pages/Analytics.tsx', 'utf8');

function block(startMarker: string, endMarker: string): string {
  const start = rules.indexOf(startMarker);
  const end = rules.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing rules marker: ${startMarker}`);
  assert.ok(end > start, `missing rules boundary after: ${startMarker}`);
  return rules.slice(start, end);
}

const globalHelper = block('function canViewGlobalRevisionLedger()', 'function canViewBranchRevisionLedger(branchId)');
const branchHelper = block('function canViewBranchRevisionLedger(branchId)', 'function isOwner(userId)');
const revisionRules = block('match /pos_sale_revision_requests/{requestId}', 'match /welfare_records/{recordId}');

const profile = (role: string, secondaryRoles: string[] = [], roleRealmId?: string) => ({ role, secondaryRoles, roleRealmId });

test('8E tenant isolation remains mandatory for every revision ledger read', () => {
  assert.match(revisionRules, /allow get:[\s\S]*isTenantMember\(resource\.data\.tenantId\)/);
  assert.match(revisionRules, /allow list:[\s\S]*isTenantMember\(resource\.data\.tenantId\)/);
  assert.match(repository, /where\('tenantId', '==', clean\(scope\.tenantId\)\)/);
  assert.doesNotMatch(revisionRules, /allow (get|list): if true/);
});

test('8E assigned branch users cannot broaden a branch ledger query', () => {
  assert.match(branchHelper, /isAssignedToBranch\(branchId\)/);
  assert.match(repository, /scope\.kind === 'BRANCH'/);
  assert.match(repository, /where\('branchId', '==', clean\(scope\.branchId\)\)/);
  assert.match(revisionRules, /canViewBranchRevisionLedger\(resource\.data\.branchId\)/);
});

test('8E Branch Manager and POS operators retain functional own-branch evidence access', () => {
  assert.match(branchHelper, /isPOSOperator\(\)/);
  assert.match(branchHelper, /isBranchManager\(\)/);
  assert.match(sales, /<PosV2RevisionLedger/);
  assert.match(sales, /setView\('revisions'\)/);
});

test('8E Dispenser and QA Officer remain branch-only, never tenant-global by primary role', () => {
  assert.match(branchHelper, /'QA Officer'/);
  assert.doesNotMatch(globalHelper, /QA Officer|Dispenser|Branch Manager|cashier|pharmacist/);
  for (const role of ['Dispenser', 'QA Officer', 'Branch Manager', 'cashier', 'pharmacist']) {
    assert.equal(canViewGlobalPosV2RevisionAnalytics(profile(role), false), false, role);
  }
});

test('8E explicit management roles retain tenant-global revision authority', () => {
  assert.match(globalHelper, /isAdmin\(\)/);
  assert.match(globalHelper, /isFinance\(\)/);
  assert.match(globalHelper, /isIT\(\)/);
  assert.match(globalHelper, /hasAnyRole\(\['QA Head', 'QA Manager'\]\)/);
  for (const role of ['owner', 'CEO', 'admin', 'Finance Head', 'Finance Officer', 'Accountant', 'IT Head', 'IT Support Staff', 'QA Head', 'QA Manager']) {
    assert.equal(canViewGlobalPosV2RevisionAnalytics(profile(role), false), true, role);
  }
  assert.match(analytics, /canViewGlobalPosV2RevisionAnalytics/);
});

test('8E secondary-role elevation is explicit and view-only primary roles do not elevate themselves', () => {
  assert.equal(canViewGlobalPosV2RevisionAnalytics(profile('Dispenser', ['Finance Officer']), false), true);
  assert.equal(canViewGlobalPosV2RevisionAnalytics(profile('Dispenser'), true), false);
  assert.equal(canViewGlobalPosV2RevisionAnalytics(profile('Custom Finance Reviewer', [], 'realm-finance'), true), true);
  assert.equal(canViewGlobalPosV2RevisionAnalytics(profile('Custom Viewer', [], 'realm-view'), false), false);
});

test('8E ledger evidence remains read-only for every client role', () => {
  assert.match(revisionRules, /allow update, delete: if false/);
  assert.doesNotMatch(repository, /addDoc|setDoc|updateDoc|deleteDoc|runTransaction|writeBatch/);
});
