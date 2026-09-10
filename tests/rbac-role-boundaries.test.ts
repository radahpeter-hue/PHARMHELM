import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SYSTEM_ROLES, type RbacAccess, type RbacModuleKey } from '../src/config/rbac.ts';

type Expected = Partial<Record<RbacModuleKey, RbacAccess>>;

const role = (name: string) => {
  const match = SYSTEM_ROLES.find(r => r.name.toLowerCase() === name.toLowerCase() || r.label.toLowerCase() === name.toLowerCase());
  assert.ok(match, `Missing system role: ${name}`);
  return match;
};

const access = (roleName: string, module: RbacModuleKey) => role(roleName).permissions[module].access;

const expectedFinance: Record<string, RbacAccess> = {
  owner: 'all',
  CEO: 'all',
  admin: 'operate',
  'HR Head': 'none',
  'HR Support Personnel': 'none',
  'QA Head': 'none',
  'QA Officer': 'none',
  'Finance Head': 'all',
  'Finance Officer': 'operate',
  'Procurement Head': 'none',
  'Procurement Officer': 'none',
  'Logistics Head': 'none',
  'Transport & Logistics Personnel': 'none',
  'Marketing Head': 'none',
  'Marketing Personnel': 'none',
  'IT Head': 'view',
  'IT Support Staff': 'view',
  'Branch Manager': 'operate',
  pharmacist: 'none',
  Dispenser: 'none',
  cashier: 'operate',
  cleaner: 'none',
  Trainee: 'none',
};

test('every system role has the agreed Finance boundary', () => {
  assert.equal(SYSTEM_ROLES.length, Object.keys(expectedFinance).length, 'Finance boundary table must cover every system role');
  for (const [roleName, expected] of Object.entries(expectedFinance)) {
    assert.equal(access(roleName, 'finance'), expected, `${roleName} Finance access`);
  }
});

test('Dispenser has no restricted management modules as a primary role', () => {
  const expected: Expected = {
    dashboard: 'view',
    sales: 'operate',
    inventory: 'view',
    clients: 'operate',
    stock: 'operate',
    procurement: 'none',
    logistics: 'none',
    finance: 'none',
    qa: 'operate',
    hr: 'none',
    welfare: 'all',
    predictive: 'none',
    analytics: 'view',
    marketing: 'none',
    settings: 'none',
  };
  for (const [module, expectedAccess] of Object.entries(expected) as [RbacModuleKey, RbacAccess][]) {
    assert.equal(access('Dispenser', module), expectedAccess, `Dispenser ${module}`);
  }
});

test('Finance Officer is Finance-only apart from universal Dashboard and Welfare', () => {
  const financeOfficer = role('Finance Officer');
  for (const [module, permission] of Object.entries(financeOfficer.permissions) as [RbacModuleKey, { access: RbacAccess }][]) {
    const expected = module === 'dashboard' ? 'view' : module === 'welfare' ? 'all' : module === 'finance' ? 'operate' : 'none';
    assert.equal(permission.access, expected, `Finance Officer ${module}`);
  }
});

test('QA Officer is limited to QA and own-branch analytics at module level', () => {
  const qaOfficer = role('QA Officer');
  const expected: Expected = { dashboard: 'view', qa: 'operate', analytics: 'view', welfare: 'all' };
  for (const [module, permission] of Object.entries(qaOfficer.permissions) as [RbacModuleKey, { access: RbacAccess }][]) {
    assert.equal(permission.access, expected[module] ?? 'none', `QA Officer ${module}`);
  }
});

const priority: Record<RbacAccess, number> = { none: 0, view: 1, operate: 2, all: 3 };
const mergeRoleAccess = (roles: string[], module: RbacModuleKey): RbacAccess => {
  let result: RbacAccess = module === 'dashboard' ? 'view' : module === 'welfare' ? 'all' : 'none';
  for (const roleName of roles) {
    const candidate = access(roleName, module);
    if (priority[candidate] > priority[result]) result = candidate;
  }
  return result;
};

test('secondary roles extend permissions but primary Dispenser alone cannot see Finance', () => {
  assert.equal(mergeRoleAccess(['Dispenser'], 'finance'), 'none');
  assert.equal(mergeRoleAccess(['Dispenser', 'Marketing Personnel'], 'finance'), 'none');
  assert.equal(mergeRoleAccess(['Dispenser', 'Finance Officer'], 'finance'), 'operate');
  assert.equal(mergeRoleAccess(['Dispenser', 'Finance Head'], 'finance'), 'all');
  assert.equal(mergeRoleAccess(['Dispenser', 'IT Support Staff'], 'finance'), 'view');
});

test('client navigation and routes enforce effective module permission', () => {
  const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const auth = readFileSync('src/contexts/AuthContext.tsx', 'utf8');
  assert.match(sidebar, /hasPermission\(moduleKey as any, 'view'\)/);
  assert.match(app, /PermissionProtectedRoute module="finance" requiredLevel="view"/);
  assert.match(auth, /const secondaryRolesList = currentProfile\.secondaryRoles \|\| \[\]/);
  assert.match(auth, /const allUserRoles = \[primaryRole, \.\.\.secondaryRolesList\]/);
  assert.match(auth, /mergePermissions\(mergedPerms, rolePerms\)/);
});

test('Finance page keeps Finance Officer out of Branch Operations unless another assigned role grants branch finance', () => {
  const finance = readFileSync('src/pages/Finance.tsx', 'utf8');
  assert.match(finance, /canUseBranchFinance/);
  assert.match(finance, /canUseManagementFinance/);
  assert.match(finance, /Finance Officer/);
  assert.match(finance, /Branch Manager/);
  assert.match(finance, /cashier/i);
});

test('Firestore rules cannot fall back to generic tenant read for protected Finance collections', () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /function isProtectedFinanceCollection\(collectionName\)/);
  assert.match(rules, /!isProtectedFinanceCollection\(collectionName\)/);
  assert.match(rules, /function canViewBranchFinance\(\)/);
  assert.doesNotMatch(rules, /match \/eod_reconciliations[\s\S]{0,250}allow read:[^;]*\|\| isTenantMember/);
  assert.doesNotMatch(rules, /match \/branch_expenses[\s\S]{0,250}allow read:[^;]*\|\| isTenantMember/);
  assert.doesNotMatch(rules, /match \/cash_requisitions[\s\S]{0,250}allow read:[^;]*\|\| isTenantMember/);
  assert.doesNotMatch(rules, /match \/banking_records[\s\S]{0,250}allow read:[^;]*\|\| isTenantMember/);
});
