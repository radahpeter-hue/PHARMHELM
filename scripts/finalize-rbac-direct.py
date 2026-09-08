from pathlib import Path
import re


def replace_exact(text: str, old: str, new: str, label: str, expected: int = 1) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} match(es), found {count}")
    return text.replace(old, new)


# -----------------------------------------------------------------------------
# AuthContext: canonical role resolution and legacy display-name aliases
# -----------------------------------------------------------------------------
path = Path('src/contexts/AuthContext.tsx')
text = path.read_text()

old_registry = """// System-generated roles are authoritative and immutable. Legacy keys are retained
// only for backwards compatibility with historical staff records.
export const ROLE_REGISTRY: Record<string, RolePermissions> = {
  ...LEGACY_ROLE_REGISTRY,
  ...(SYSTEM_ROLE_PERMISSIONS as Record<string, RolePermissions>)
};"""
new_registry = """// System-generated roles are authoritative and immutable. Registry keys are normalized
// so historical casing cannot override the current role definition.
const ROLE_ALIASES: Record<string, string> = {
  'ceo / md': 'ceo',
  'it support personnel': 'it support staff',
  'procurement personnel': 'procurement officer'
};

export const ROLE_REGISTRY: Record<string, RolePermissions> = {
  ...Object.fromEntries(
    Object.entries(LEGACY_ROLE_REGISTRY).map(([role, permissions]) => [role.toLowerCase(), permissions])
  ),
  ...Object.fromEntries(
    Object.entries(SYSTEM_ROLE_PERMISSIONS as Record<string, RolePermissions>)
      .map(([role, permissions]) => [role.toLowerCase(), permissions])
  )
};"""
text = replace_exact(text, old_registry, new_registry, 'AuthContext registry')

old_lookup = "const registryKey = Object.keys(ROLE_REGISTRY).find(k => k.toLowerCase() === role.toLowerCase()) || role;"
new_lookup = "const normalizedRole = role.trim().toLowerCase();\n                const registryKey = ROLE_ALIASES[normalizedRole] || normalizedRole;"
text = replace_exact(text, old_lookup, new_lookup, 'AuthContext role lookup', expected=2)

text = replace_exact(
    text,
    "['owner', 'ceo', 'ceo / md', 'it head', 'it support staff'].includes(role.toLowerCase())",
    "['owner', 'ceo', 'ceo / md', 'it head', 'it support staff', 'it support personnel'].includes(role.toLowerCase())",
    'AuthContext all-branch IT alias'
)
path.write_text(text)


# -----------------------------------------------------------------------------
# StaffDirectory: HR remains the role assigner, using the authoritative registry
# -----------------------------------------------------------------------------
path = Path('src/modules/hr/StaffDirectory.tsx')
text = path.read_text()
text = replace_exact(
    text,
    "import { roleRealmId } from '../../config/rbac';",
    "import { roleRealmId, SYSTEM_ROLES } from '../../config/rbac';",
    'StaffDirectory RBAC import'
)

role_block_pattern = re.compile(
    r"  const systemDefaultRoleNames = \[.*?\.filter\(\(v, i, self\) => self\.findIndex\(x => x\.toLowerCase\(\) === v\.toLowerCase\(\)\) === i\); // Case-insensitive deduplication",
    re.S,
)
role_block_replacement = """  const systemDefaultRoleNames = SYSTEM_ROLES
    .flatMap(role => [role.name, role.label])
    .map(role => role.toLowerCase());

  const systemRoleDisplayName = (roleName: string) =>
    SYSTEM_ROLES.find(role =>
      role.name.toLowerCase() === roleName.toLowerCase() || role.label.toLowerCase() === roleName.toLowerCase()
    )?.label || roleName;

  const allAvailableRoles = [
    ...SYSTEM_ROLES.map(role => role.name),
    ...(customRoles || [])
      .map((r: any) => r.name?.trim())
      .filter(roleName => roleName && !systemDefaultRoleNames.includes(roleName.toLowerCase()))
  ].map(r => r.trim())
   .filter((v, i, self) => self.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i); // Case-insensitive deduplication"""
text, count = role_block_pattern.subn(role_block_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'StaffDirectory role-list block: expected 1 match, found {count}')

system_optgroup_pattern = re.compile(r'<optgroup label="System Defaults">.*?</optgroup>', re.S)
system_optgroup_replacement = """<optgroup label=\"System Generated Roles\">
                      {SYSTEM_ROLES.map(role => (
                        <option key={role.name} value={role.name}>{role.label}</option>
                      ))}
                    </optgroup>"""
text, count = system_optgroup_pattern.subn(system_optgroup_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'StaffDirectory primary role optgroup: expected 1 match, found {count}')

text = replace_exact(
    text,
    '<span className="text-xs font-semibold text-slate-700 capitalize">{roleName}</span>',
    '<span className="text-xs font-semibold text-slate-700">{systemRoleDisplayName(roleName)}</span>',
    'StaffDirectory secondary role label'
)
path.write_text(text)


# -----------------------------------------------------------------------------
# Firestore rules: align write authority with the accepted RBAC matrix
# -----------------------------------------------------------------------------
path = Path('firestore.rules')
text = path.read_text()

old_inventory = """    function isInventoryOperator() {
      return isAuthenticated() && (
        hasRole('Branch Manager') || hasRole('branch manager') ||
        hasRole('Pharmacist') || hasRole('pharmacist') || hasRole('Dispenser') ||
        hasRole('Procurement Head') || hasRole('Procurement Officer') ||
        hasRole('QA Head') || hasRole('QA Officer') ||
        hasRole('Logistics Head') || hasRole('Logistics Manager') ||
        hasCustomModuleFunctional('inventory') ||
        isAdmin()
      );
    }"""
new_inventory = """    function isInventoryOperator() {
      return isAuthenticated() && (
        hasRole('Branch Manager') || hasRole('branch manager') ||
        hasRole('Pharmacist') || hasRole('pharmacist') ||
        hasRole('Procurement Head') || hasRole('Procurement Officer') ||
        hasCustomModuleFunctional('inventory') ||
        isAdmin()
      );
    }"""
text = replace_exact(text, old_inventory, new_inventory, 'Firestore inventory operator')

old_stock = """    function isStockOperator() {
      return isAuthenticated() && (
        hasRole('Branch Manager') || hasRole('branch manager') ||
        hasRole('Pharmacist') || hasRole('pharmacist') ||
        hasRole('Procurement Head') || hasRole('Procurement Officer') || hasRole('Procurement Manager') ||
        hasRole('QA Head') ||
        hasRole('Logistics Head') || hasRole('Logistics Manager') ||
        hasCustomModuleFunctional('stock') ||
        isAdmin()
      );
    }"""
new_stock = """    function isStockOperator() {
      return isAuthenticated() && (
        hasRole('Branch Manager') || hasRole('branch manager') ||
        hasRole('Pharmacist') || hasRole('pharmacist') ||
        hasRole('Dispenser') || hasRole('dispenser') ||
        hasRole('Procurement Head') || hasRole('Procurement Officer') || hasRole('Procurement Manager') ||
        hasCustomModuleFunctional('stock') ||
        isAdmin()
      );
    }"""
text = replace_exact(text, old_stock, new_stock, 'Firestore stock operator')

old_marketing = """    function isMarketing() {
      return isAuthenticated() && (
        hasRole('Marketing Head') || hasRole('Marketing Personnel') || hasRole('Marketing Manager') ||
        hasCustomModuleFunctional('marketing') || isAdmin()
      );
    }"""
new_marketing = """    function isMarketing() {
      return isAuthenticated() && (
        hasRole('Marketing Head') || hasRole('Marketing Personnel') || hasRole('Marketing Manager') ||
        hasRole('admin') || hasRole('Admin') || hasCustomModuleFunctional('marketing') || isAdmin()
      );
    }"""
text = replace_exact(text, old_marketing, new_marketing, 'Firestore marketing operator')

view_helpers = """

    function hasCustomModuleView(moduleKey) {
      return isAuthenticated()
        && ('roleRealmId' in getUserData())
        && getUserData().roleRealmId is string
        && getUserData().roleRealmId.size() > 0
        && exists(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId))
        && get(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId)).data.tenantId == getUserData().tenantId
        && get(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId)).data.roleType == 'custom'
        && get(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId)).data.roleName == getUserData().role
        && moduleKey in get(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId)).data.permissions
        && get(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId)).data.permissions[moduleKey].accessLevel in ['view_only', 'view_functional', 'all'];
    }

    function canViewFinance() {
      return isFinance() || isITPersonnel() || hasCustomModuleView('finance');
    }

    function canViewProcurement() {
      return isProcurement()
        || isFinance()
        || hasRole('QA Head') || hasRole('QA Officer')
        || hasRole('Logistics Head')
        || hasRole('Pharmacist') || hasRole('pharmacist')
        || isITPersonnel()
        || hasCustomModuleView('procurement');
    }

    function canViewMarketing() {
      return isMarketing()
        || hasRole('QA Head')
        || hasRole('Finance Head')
        || isITPersonnel()
        || hasCustomModuleView('marketing');
    }
"""
marketing_marker = new_marketing
if marketing_marker not in text:
    raise SystemExit('Firestore view helper insertion marker not found')
text = text.replace(marketing_marker, marketing_marker + view_helpers, 1)

old_staff_update = """      allow update: if isAuthenticated() && (
        isAdmin() || isIT() || isHR() ||
        (request.auth.uid == staffId &&
          !request.resource.data.diff(resource.data).affectedKeys().hasAny([
            'tenantId', 'role', 'secondaryRoles', 'assigned_branches',
            'branch_id', 'default_branch_id', 'status', 'active',
            'authEmail', 'loginHandle', 'username', 'uid', 'password_set',
            'legacyStaffId', 'roleRealmId'
          ]))
      );"""
new_staff_update = """      // HR assigns organisational roles and branch placement. IT may perform account
      // activation/support updates but cannot silently change the HR-assigned role realm.
      allow update: if isAuthenticated() && (
        isAdmin() || isHR() ||
        (isITPersonnel() &&
          !request.resource.data.diff(resource.data).affectedKeys().hasAny([
            'tenantId', 'role', 'secondaryRoles', 'roleRealmId',
            'assigned_branches', 'branch_id', 'default_branch_id'
          ])) ||
        (request.auth.uid == staffId &&
          !request.resource.data.diff(resource.data).affectedKeys().hasAny([
            'tenantId', 'role', 'secondaryRoles', 'assigned_branches',
            'branch_id', 'default_branch_id', 'status', 'active',
            'authEmail', 'loginHandle', 'username', 'uid', 'password_set',
            'legacyStaffId', 'roleRealmId'
          ]))
      );"""
text = replace_exact(text, old_staff_update, new_staff_update, 'Firestore HR role-assignment boundary')

# Strict finance reads: Functional and View-only custom roles may read, but only
# Finance operators retain writes.
finance_read = "allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && isFinance();"
if finance_read not in text:
    raise SystemExit('Firestore strict finance read target not found')
text = text.replace(finance_read, "allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && canViewFinance();")
text = text.replace(
    "allow list: if isAuthenticated() && isTenantMember(resource.data.tenantId) && isFinance();",
    "allow list: if isAuthenticated() && isTenantMember(resource.data.tenantId) && canViewFinance();"
)

# Procurement read visibility is broader than procurement write authority.
text = text.replace(
    "allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && (isProcurement() || isBranchManager());",
    "allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && (canViewProcurement() || isBranchManager());"
)
text = text.replace(
    "allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && isProcurement();",
    "allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && canViewProcurement();"
)

# Marketing read/report access is separate from operational write authority.
text = text.replace(
    "allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && isMarketing();",
    "allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && canViewMarketing();"
)
text = text.replace(
    "allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && (isMarketing() || isFinance());",
    "allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && canViewMarketing();"
)

path.write_text(text)
print('RBAC finalization transformations applied successfully.')
