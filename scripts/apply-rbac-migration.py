from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"Could not find patch target: {label}")
    return text.replace(old, new, 1)


def patch_auth_context() -> None:
    path = Path('src/contexts/AuthContext.tsx')
    text = path.read_text()

    text = replace_once(
        text,
        "import { sanitizeInput } from '../utils/sanitize';\n",
        "import { sanitizeInput } from '../utils/sanitize';\nimport { SYSTEM_ROLE_PERMISSIONS } from '../config/rbac';\n",
        'AuthContext RBAC import',
    )

    text = replace_once(
        text,
        'export const ROLE_REGISTRY: Record<string, RolePermissions> = {',
        'const LEGACY_ROLE_REGISTRY: Record<string, RolePermissions> = {',
        'AuthContext legacy registry rename',
    )

    marker = '\ninterface AuthContextType {'
    if 'export const ROLE_REGISTRY: Record<string, RolePermissions> = {' not in text:
        idx = text.find(marker)
        if idx == -1:
            raise RuntimeError('Could not find AuthContextType marker')
        before = text[:idx]
        close_idx = before.rfind('\n};')
        if close_idx == -1:
            raise RuntimeError('Could not find role registry closing brace')
        insert_at = close_idx + len('\n};')
        export_block = "\n\n// System-generated roles are authoritative and immutable. Legacy keys are retained\n// only for backwards compatibility with historical staff records.\nexport const ROLE_REGISTRY: Record<string, RolePermissions> = {\n  ...LEGACY_ROLE_REGISTRY,\n  ...(SYSTEM_ROLE_PERMISSIONS as Record<string, RolePermissions>)\n};"
        text = text[:insert_at] + export_block + text[insert_at:]

    old_realm = """                const role = allUserRoles[index];
                const registryKey = Object.keys(ROLE_REGISTRY).find(k => k.toLowerCase() === role.toLowerCase()) || role;
                let rolePerms = ROLE_REGISTRY[registryKey];
                if (realmDoc.exists()) {
                  const configured = realmDoc.data().permissions || {};
                  const configuredPerms: RolePermissions = {};
                  Object.entries(configured).forEach(([rawModule, value]: [string, any]) => {
                    const module = normalizeRealmModule(rawModule);
                    if (module) configuredPerms[module] = { access: normalizeRealmAccess(value?.accessLevel) };
                  });
                  rolePerms = configuredPerms;
                }
                mergePermissions(mergedPerms, rolePerms);"""
    new_realm = """                const role = allUserRoles[index];
                const registryKey = Object.keys(ROLE_REGISTRY).find(k => k.toLowerCase() === role.toLowerCase()) || role;
                const isSystemRole = Boolean(ROLE_REGISTRY[registryKey]);
                let rolePerms = ROLE_REGISTRY[registryKey];

                // Tenant role-realm documents configure custom roles only. System roles are
                // code-defined and cannot be weakened, expanded or silently changed in Firestore.
                if (!isSystemRole && realmDoc.exists()) {
                  const configured = realmDoc.data().permissions || {};
                  const configuredPerms: RolePermissions = {};
                  Object.entries(configured).forEach(([rawModule, value]: [string, any]) => {
                    const module = normalizeRealmModule(rawModule);
                    if (module) configuredPerms[module] = { access: normalizeRealmAccess(value?.accessLevel) };
                  });
                  rolePerms = configuredPerms;
                }
                mergePermissions(mergedPerms, rolePerms);"""
    text = replace_once(text, old_realm, new_realm, 'AuthContext custom realm resolution')

    path.write_text(text)


def patch_settings() -> None:
    path = Path('src/pages/Settings.tsx')
    text = path.read_text()

    text = replace_once(
        text,
        "import { BranchManager } from '../modules/hr/BranchManager';\n",
        "import { BranchManager } from '../modules/hr/BranchManager';\nimport { RolesManager } from '../modules/hr/RolesManager';\n",
        'Settings RolesManager import',
    )

    text = replace_once(
        text,
        "  { id: 'users', label: 'User Accounts', icon: Users },\n",
        "  { id: 'users', label: 'User Accounts', icon: Users },\n  { id: 'roles-access', label: 'Roles & Access', icon: Key },\n",
        'Settings Roles & Access tab',
    )

    marker = "\n      {activeTab === 'master-registry' && ("
    insert = "\n      {activeTab === 'roles-access' && (\n        <RolesManager />\n      )}\n"
    if insert.strip() not in text:
        if marker not in text:
            raise RuntimeError('Could not find Settings master registry marker')
        text = text.replace(marker, insert + marker, 1)

    path.write_text(text)


def patch_staff_directory() -> None:
    path = Path('src/modules/hr/StaffDirectory.tsx')
    text = path.read_text()

    text = replace_once(
        text,
        "import { deduplicateStaff } from '../../utils/deduplicateStaff';\n",
        "import { deduplicateStaff } from '../../utils/deduplicateStaff';\nimport { roleRealmId } from '../../config/rbac';\n",
        'StaffDirectory realm helper import',
    )

    old_update = """      if (staff?.id) {
        await firestoreService.updateDocument('staff', staff.id, formData);
        toast.success('Staff member updated');
      } else {
        // Save staff record to Firestore as pending activation
        const staffId = await firestoreService.addDocument('staff', {
          ...formData,"""
    new_update = """      const selectedCustomRole = (customRoles || []).find((role: any) =>
        role.name?.trim().toLowerCase() === String(formData.role || '').trim().toLowerCase()
      );
      const primaryRoleRealmId = selectedCustomRole
        ? roleRealmId(profile.tenantId, selectedCustomRole.name)
        : null;

      if (staff?.id) {
        await firestoreService.updateDocument('staff', staff.id, {
          ...formData,
          roleRealmId: primaryRoleRealmId,
        });
        toast.success('Staff member updated');
      } else {
        // Save staff record to Firestore as pending activation
        const staffId = await firestoreService.addDocument('staff', {
          ...formData,
          roleRealmId: primaryRoleRealmId,"""
    text = replace_once(text, old_update, new_update, 'StaffDirectory custom role realm linkage')

    path.write_text(text)


def patch_firestore_rules() -> None:
    path = Path('firestore.rules')
    text = path.read_text()

    old_it = """    function isIT() {
      return isAuthenticated() && (hasRole('IT Head') || hasRole('IT Support Staff') || hasRole('IT Staff') || isAdmin());
    }

    function isSettingsAdmin() {
      return isAuthenticated() && (isAdmin() || isIT());
    }
"""
    new_it = """    function isITPersonnel() {
      return isAuthenticated() && (
        hasRole('IT Head') || hasRole('IT Support Staff') || hasRole('IT Support Personnel') || hasRole('IT Staff')
      );
    }

    function isIT() {
      return isAuthenticated() && (isITPersonnel() || isAdmin());
    }

    function hasCustomModuleFunctional(moduleKey) {
      return isAuthenticated()
        && ('roleRealmId' in getUserData())
        && getUserData().roleRealmId is string
        && getUserData().roleRealmId.size() > 0
        && exists(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId))
        && get(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId)).data.tenantId == getUserData().tenantId
        && get(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId)).data.roleType == 'custom'
        && get(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId)).data.roleName == getUserData().role
        && moduleKey in get(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId)).data.permissions
        && get(/databases/$(database)/documents/role_realms_of_operation/$(getUserData().roleRealmId)).data.permissions[moduleKey].accessLevel in ['view_functional', 'all'];
    }

    function isSettingsAdmin() {
      return isAuthenticated() && (isAdmin() || isIT() || hasCustomModuleFunctional('settings'));
    }
"""
    text = replace_once(text, old_it, new_it, 'Firestore IT/custom realm helpers')

    # Bring system helper functions in line with the accepted role model and allow
    # a primary custom role to operate its configured module.
    text = text.replace(
        "return isAuthenticated() && (hasRole('HR Head') || hasRole('HR Support Personnel') || hasRole('HR Manager') || isAdmin());",
        "return isAuthenticated() && (hasRole('HR Head') || hasRole('HR Support Personnel') || hasRole('HR Manager') || hasRole('admin') || hasRole('Admin') || hasCustomModuleFunctional('hr') || isAdmin());"
    )
    text = text.replace(
        "return isAuthenticated() && (hasRole('Finance Head') || hasRole('Finance Officer') || hasRole('Accountant') || isAdmin());",
        "return isAuthenticated() && (hasRole('Finance Head') || hasRole('Finance Officer') || hasRole('Accountant') || hasRole('admin') || hasRole('Admin') || hasCustomModuleFunctional('finance') || isAdmin());"
    )
    text = text.replace(
        "return isAuthenticated() && (hasRole('Logistics Head') || hasRole('Transport & Logistics Personnel') || hasRole('Logistics Manager') || isAdmin());",
        "return isAuthenticated() && (hasRole('Logistics Head') || hasRole('Transport & Logistics Personnel') || hasRole('Logistics Manager') || hasRole('admin') || hasRole('Admin') || hasCustomModuleFunctional('logistics') || isAdmin());"
    )
    text = text.replace(
        "return isAuthenticated() && (hasRole('QA Head') || hasRole('QA Officer') || hasRole('QA Manager') || isAdmin());",
        "return isAuthenticated() && (hasRole('QA Head') || hasRole('QA Officer') || hasRole('QA Manager') || hasRole('admin') || hasRole('Admin') || hasCustomModuleFunctional('qa') || isAdmin());"
    )

    old_proc_end = """        hasRole('Procurement Manager') ||
        isAdmin()
      );
    }
"""
    new_proc_end = """        hasRole('Procurement Manager') ||
        hasCustomModuleFunctional('procurement') ||
        isAdmin()
      );
    }
"""
    text = replace_once(text, old_proc_end, new_proc_end, 'Firestore procurement custom role')

    # Inventory, stock and POS: remove permanent IT Head/Admin transaction authority
    # that contradicts the new diagnostic-only IT role and Admin view-only access there.
    text = text.replace("        hasRole('Branch Manager') || hasRole('branch manager') || hasRole('admin') ||\n", "        hasRole('Branch Manager') || hasRole('branch manager') ||\n", 2)
    text = text.replace("        hasRole('Logistics Head') || hasRole('Logistics Manager') ||\n        hasRole('IT Head') ||\n        isAdmin()", "        hasRole('Logistics Head') || hasRole('Logistics Manager') ||\n        hasCustomModuleFunctional('inventory') ||\n        isAdmin()", 1)
    text = text.replace("        hasRole('QA Head') ||\n        hasRole('Logistics Head') || hasRole('Logistics Manager') ||\n        hasRole('IT Head') ||\n        isAdmin()", "        hasRole('QA Head') ||\n        hasRole('Logistics Head') || hasRole('Logistics Manager') ||\n        hasCustomModuleFunctional('stock') ||\n        isAdmin()", 1)

    old_pos_tail = """        hasRole('Trainee') || hasRole('trainee') ||
        hasRole('IT Head') || hasRole('it head') ||
        hasRole('Branch Manager') || hasRole('branch manager') ||
        hasRole('admin') || hasRole('Admin') ||
        isAdmin()
"""
    new_pos_tail = """        hasRole('Branch Manager') || hasRole('branch manager') ||
        hasCustomModuleFunctional('sales') ||
        isAdmin()
"""
    text = replace_once(text, old_pos_tail, new_pos_tail, 'Firestore POS diagnostic role removal')

    old_marketing = """        hasRole('Marketing Head') || hasRole('Marketing Personnel') || hasRole('Marketing Manager') ||
        hasRole('QA Head') || hasRole('QA Officer') || isAdmin()
"""
    new_marketing = """        hasRole('Marketing Head') || hasRole('Marketing Personnel') || hasRole('Marketing Manager') ||
        hasCustomModuleFunctional('marketing') || isAdmin()
"""
    text = replace_once(text, old_marketing, new_marketing, 'Firestore Marketing role alignment')

    old_realms = """    match /role_realms_of_operation/{realmId} {
      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId);
      allow create: if isAuthenticated() && (isSettingsAdmin() || isHR()) && isTenantMember(request.resource.data.tenantId);
      allow update: if isAuthenticated() && (isSettingsAdmin() || isHR()) && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId);
      allow delete: if isSettingsAdmin() && isTenantMember(resource.data.tenantId);
    }
"""
    new_realms = """    match /role_realms_of_operation/{realmId} {
      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId);
      allow create: if isITPersonnel() && isTenantMember(request.resource.data.tenantId);
      allow update: if isITPersonnel() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId);
      allow delete: if isITPersonnel() && isTenantMember(resource.data.tenantId);
    }

    match /hr_roles/{roleId} {
      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId);
      allow create: if isITPersonnel() && isTenantMember(request.resource.data.tenantId);
      allow update: if isITPersonnel() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId);
      allow delete: if isITPersonnel() && isTenantMember(resource.data.tenantId);
    }
"""
    text = replace_once(text, old_realms, new_realms, 'Firestore IT-only role definitions')

    generic_old = """    match /{collectionName}/{docId} {
      allow read: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && isAuthenticated() && isTenantMember(resource.data.tenantId);
      allow create: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && collectionName != 'product_batches' && collectionName != 'products' && collectionName != 'sales' && isAuthenticated() && isTenantMember(request.resource.data.tenantId);
      allow update: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && collectionName != 'product_batches' && collectionName != 'products' && collectionName != 'sales' && isAuthenticated() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId);
      allow delete: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && collectionName != 'product_batches' && collectionName != 'products' && collectionName != 'sales' && isAdmin() && isTenantMember(resource.data.tenantId);
    }
"""
    generic_new = """    match /{collectionName}/{docId} {
      allow read: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && isAuthenticated() && isTenantMember(resource.data.tenantId);
      allow create: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && collectionName != 'product_batches' && collectionName != 'products' && collectionName != 'sales' && collectionName != 'role_realms_of_operation' && collectionName != 'hr_roles' && isAuthenticated() && isTenantMember(request.resource.data.tenantId);
      allow update: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && collectionName != 'product_batches' && collectionName != 'products' && collectionName != 'sales' && collectionName != 'role_realms_of_operation' && collectionName != 'hr_roles' && isAuthenticated() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId);
      allow delete: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && collectionName != 'product_batches' && collectionName != 'products' && collectionName != 'sales' && collectionName != 'role_realms_of_operation' && collectionName != 'hr_roles' && isAdmin() && isTenantMember(resource.data.tenantId);
    }
"""
    text = replace_once(text, generic_old, generic_new, 'Firestore generic role-collection exclusion')

    # Protect security-derived role realm linkage from ordinary self-updates.
    text = text.replace(
        "            'legacyStaffId'\n",
        "            'legacyStaffId', 'roleRealmId'\n",
        1,
    )

    path.write_text(text)


def main() -> None:
    patch_auth_context()
    patch_settings()
    patch_staff_directory()
    patch_firestore_rules()
    print('RBAC migration patches applied successfully.')


if __name__ == '__main__':
    main()
