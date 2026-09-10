from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {count}")
    return text.replace(old, new, 1)

# 1. Bring the system-role matrix back to the approved boundaries.
rbac_path = Path('src/config/rbac.ts')
rbac = rbac_path.read_text()
rbac = replace_once(rbac, "export const RBAC_SYSTEM_VERSION = '2026-09-10-v2';", "export const RBAC_SYSTEM_VERSION = '2026-09-10-v3';", 'RBAC version')
rbac = replace_once(
    rbac,
    "permissions: makePermissions({ sales: view(), inventory: view(), stock: view(), procurement: view(), qa: operate(), analytics: view() }),",
    "permissions: makePermissions({ qa: operate(), analytics: view() }),",
    'QA Officer boundary'
)
rbac = replace_once(
    rbac,
    "permissions: makePermissions({ sales: view(), inventory: view(), stock: view(), procurement: view(), finance: operate(), analytics: view() }),",
    "permissions: makePermissions({ finance: operate() }),",
    'Finance Officer boundary'
)
rbac = replace_once(
    rbac,
    "description: 'Operates POS and branch finance functions with stock-availability and own-branch analytical visibility.',\n    permissions: makePermissions({ sales: operate(), inventory: view(), finance: operate(), analytics: view() }),",
    "description: 'Branch cashier with POS visibility and branch finance operation. Cashiers do not complete sales transactions.',\n    permissions: makePermissions({ sales: view(), inventory: view(), finance: operate(), analytics: view() }),",
    'Cashier latest policy'
)
rbac_path.write_text(rbac)

# 2. Enforce Finance submodule boundaries in the UI.
finance_path = Path('src/pages/Finance.tsx')
finance = finance_path.read_text()
finance = replace_once(
    finance,
    "const Finance: React.FC = () => {\n  const { profile } = useAuth();\n  const [activeTab, setActiveTab] = useState<'branch' | 'management'>('branch');\n  const [settings, setSettings] = useState<SystemSettings | null>(null);",
    "const Finance: React.FC = () => {\n  const { profile, hasPermission } = useAuth();\n\n  const namedManagementFinance = hasAnyRole(profile, ['owner', 'CEO', 'CEO / MD', 'Finance Head', 'Finance Officer', 'Accountant']);\n  const namedBranchFinance = hasAnyRole(profile, ['owner', 'CEO', 'CEO / MD', 'admin', 'Finance Head', 'Branch Manager', 'cashier', 'Cashier', 'Accountant']);\n  const hasNamedFinanceAssignment = namedManagementFinance || namedBranchFinance;\n  const fallbackConfiguredFinance = !hasNamedFinanceAssignment && hasPermission('finance', 'view');\n  const canUseManagementFinance = namedManagementFinance || fallbackConfiguredFinance;\n  const canUseBranchFinance = namedBranchFinance || fallbackConfiguredFinance;\n\n  const [activeTab, setActiveTab] = useState<'branch' | 'management'>(() => canUseBranchFinance ? 'branch' : 'management');\n  const [settings, setSettings] = useState<SystemSettings | null>(null);",
    'Finance access flags'
)
finance = replace_once(
    finance,
    "  const isManagement = hasAnyRole(profile, ['owner', 'CEO', 'CEO / MD', 'Finance Head', 'Finance Officer']);\n\n  return (",
    "  useEffect(() => {\n    if (activeTab === 'branch' && !canUseBranchFinance && canUseManagementFinance) {\n      setActiveTab('management');\n    } else if (activeTab === 'management' && !canUseManagementFinance && canUseBranchFinance) {\n      setActiveTab('branch');\n    }\n  }, [activeTab, canUseBranchFinance, canUseManagementFinance]);\n\n  return (",
    'Finance active tab guard'
)
finance = replace_once(finance, "        {isManagement && (", "        {canUseBranchFinance && canUseManagementFinance && (", 'Finance tab selector')
finance = replace_once(
    finance,
    "        {activeTab === 'branch' ? <BranchFinance /> : <ManagementFinance settings={settings} />}",
    "        {activeTab === 'branch' && canUseBranchFinance\n          ? <BranchFinance />\n          : canUseManagementFinance\n            ? <ManagementFinance settings={settings} />\n            : null}",
    'Finance content guard'
)
finance_path.write_text(finance)

# 3. Close Firestore finance-read fallbacks. Explicit module rules must win over generic tenant access.
rules_path = Path('firestore.rules')
rules = rules_path.read_text()
finance_helper = """    function canViewFinance() {
      return isFinance() || isITPersonnel() || hasCustomModuleView('finance');
    }
"""
finance_helper_new = """    function canViewFinance() {
      return isFinance() || isITPersonnel() || hasCustomModuleView('finance');
    }

    function hasBranchFinanceRole() {
      return isAuthenticated() && (
        hasRole('Branch Manager') || hasRole('branch manager') ||
        hasRole('Cashier') || hasRole('cashier')
      );
    }

    function canViewBranchFinance() {
      return isAuthenticated() && (
        hasBranchFinanceRole() ||
        hasRole('Finance Head') || hasRole('Accountant') ||
        hasRole('admin') || hasRole('Admin') ||
        isITPersonnel() || hasCustomModuleView('finance') || isAdmin()
      );
    }

    function canOperateBranchFinance() {
      return isAuthenticated() && (
        hasBranchFinanceRole() ||
        hasRole('Finance Head') || hasRole('Accountant') ||
        hasRole('admin') || hasRole('Admin') ||
        hasCustomModuleFunctional('finance') || isAdmin()
      );
    }

    function isProtectedFinanceCollection(collectionName) {
      return collectionName in [
        'finance_ledger', 'eod_reconciliations', 'branch_expenses', 'cash_requisitions',
        'credit_receivables', 'supplier_payables', 'banking_records',
        'client_credit_ledger', 'institution_credit_ledger', 'supplier_credit_ledger',
        'creditPayments', 'financial_posting_audit', 'financial_metrics', 'management_expenses'
      ];
    }
"""
rules = replace_once(rules, finance_helper, finance_helper_new, 'Finance helpers')

rules = replace_once(
    rules,
    "    match /eod_reconciliations/{reconciliationId} {\n      allow read: if isAuthenticated() && (isFinance() || isBranchManager() || isTenantMember(resource.data.tenantId));\n      allow create: if isAuthenticated() && (isBranchManager() || isFinance());\n      allow update: if isAuthenticated() && (isBranchManager() || isFinance());\n      allow delete: if isAdmin();\n    }",
    "    match /eod_reconciliations/{reconciliationId} {\n      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && canViewBranchFinance();\n      allow create: if isAuthenticated() && isTenantMember(request.resource.data.tenantId) && canOperateBranchFinance();\n      allow update: if isAuthenticated() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId) && canOperateBranchFinance();\n      allow delete: if isAdmin() && isTenantMember(resource.data.tenantId);\n    }",
    'EOD rules'
)
rules = replace_once(
    rules,
    "    match /branch_expenses/{expenseId} {\n      allow read: if isAuthenticated() && (isFinance() || isBranchManager() || isTenantMember(resource.data.tenantId));\n      allow write: if isBranchManager() || isFinance();\n    }",
    "    match /branch_expenses/{expenseId} {\n      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && canViewBranchFinance();\n      allow create: if isAuthenticated() && isTenantMember(request.resource.data.tenantId) && canOperateBranchFinance();\n      allow update: if isAuthenticated() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId) && canOperateBranchFinance();\n      allow delete: if isAdmin() && isTenantMember(resource.data.tenantId);\n    }",
    'Branch expense rules'
)
rules = replace_once(
    rules,
    "    match /cash_requisitions/{requisitionId} {\n      allow read: if isAuthenticated() && (isFinance() || isBranchManager() || isTenantMember(resource.data.tenantId));\n      allow create: if isAuthenticated() && (isBranchManager() || isFinance());\n      allow update: if isAuthenticated() && (isBranchManager() || isFinance() || isAdmin());\n      allow delete: if isAdmin();\n    }",
    "    match /cash_requisitions/{requisitionId} {\n      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && canViewBranchFinance();\n      allow create: if isAuthenticated() && isTenantMember(request.resource.data.tenantId) && canOperateBranchFinance();\n      allow update: if isAuthenticated() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId) && canOperateBranchFinance();\n      allow delete: if isAdmin() && isTenantMember(resource.data.tenantId);\n    }",
    'Cash requisition rules'
)
rules = replace_once(
    rules,
    "    match /banking_records/{recordId} {\n      allow read: if isAuthenticated() && (isFinance() || isBranchManager() || isTenantMember(resource.data.tenantId));\n      allow write: if isBranchManager() || isFinance();\n    }",
    "    match /banking_records/{recordId} {\n      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && canViewFinance();\n      allow create: if isAuthenticated() && isTenantMember(request.resource.data.tenantId) && isFinance();\n      allow update: if isAuthenticated() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId) && isFinance();\n      allow delete: if isAdmin() && isTenantMember(resource.data.tenantId);\n    }",
    'Banking rules'
)

management_rule_anchor = """    match /financial_metrics/{metricId} {
      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && (isFinance() || isAdmin());
      allow write: if isFinance() || isAdmin();
    }
"""
management_rule_new = management_rule_anchor + """
    match /management_expenses/{expenseId} {
      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && (canViewFinance() || isHR());
      allow create: if isAuthenticated() && isTenantMember(request.resource.data.tenantId) && (isFinance() || isHR());
      allow update: if isAuthenticated() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId) && isFinance();
      allow delete: if isAdmin() && isTenantMember(resource.data.tenantId);
    }
"""
rules = replace_once(rules, management_rule_anchor, management_rule_new, 'Management expenses explicit rule')

# Prevent overlapping wildcard rules from turning protected finance collections back into tenant-wide access.
rules = rules.replace(
    "collectionName != 'appraisals' && isAuthenticated()",
    "collectionName != 'appraisals' && !isProtectedFinanceCollection(collectionName) && isAuthenticated()"
)
if rules.count("!isProtectedFinanceCollection(collectionName)") != 4:
    raise SystemExit(f"Generic finance exclusion: expected 4 occurrences, found {rules.count('!isProtectedFinanceCollection(collectionName)')}")

rules_path.write_text(rules)
print('RBAC role boundaries, Finance submodules and Firestore finance protections applied.')
