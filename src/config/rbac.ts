export type RbacAccess = 'none' | 'view' | 'operate' | 'all';

export type RbacModuleKey =
  | 'dashboard'
  | 'sales'
  | 'inventory'
  | 'clients'
  | 'stock'
  | 'procurement'
  | 'logistics'
  | 'finance'
  | 'qa'
  | 'hr'
  | 'welfare'
  | 'predictive'
  | 'analytics'
  | 'marketing'
  | 'settings';

export interface RbacPermission {
  access: RbacAccess;
}

export type RbacRolePermissions = Record<RbacModuleKey, RbacPermission>;

export interface SystemRoleDefinition {
  name: string;
  label: string;
  description: string;
  permissions: RbacRolePermissions;
}

export const RBAC_SCHEMA_VERSION = 2;
export const RBAC_SYSTEM_VERSION = '2026-09-10-v3';

export const RBAC_MODULES: Array<{ id: RbacModuleKey; name: string; description: string }> = [
  { id: 'dashboard', name: 'Opening Dashboard', description: 'Universal landing dashboard. Visibility remains scoped to the signed-in user.' },
  { id: 'sales', name: 'Sales / POS', description: 'Point of sale, receipts, quotations and sales ledgers.' },
  { id: 'inventory', name: 'Inventory', description: 'Inventory master, batches, stock levels and inventory reports.' },
  { id: 'clients', name: 'CRM', description: 'Clients, institutions, prescribers and supplier-facing CRM records.' },
  { id: 'stock', name: 'Stock In / Out', description: 'Stock reception, transfers, dispatch and stock movement history.' },
  { id: 'procurement', name: 'Procurement', description: 'Requisitions, sourcing, purchase orders, GRN workflow and procurement ledgers.' },
  { id: 'logistics', name: 'Fleet & Logistics', description: 'Vehicles, trips, dispatch, fuel and transport operations.' },
  { id: 'finance', name: 'Finance', description: 'Branch finance and management finance operations.' },
  { id: 'qa', name: 'Compliance / QA', description: 'Quality assurance, licences, CME, appraisals, recalls and compliance logs.' },
  { id: 'hr', name: 'HR Admin', description: 'Staff administration, recruitment, payroll, attendance, leave and performance.' },
  { id: 'welfare', name: 'Welfare Portal', description: 'Universal employee self-service welfare portal.' },
  { id: 'predictive', name: 'Predictive Engine', description: 'Predictive and decision-support functions.' },
  { id: 'analytics', name: 'Analytics', description: 'Role-scoped business intelligence and downloadable reports.' },
  { id: 'marketing', name: 'Marketing', description: 'Marketing operations, programmes, loyalty and campaign management.' },
  { id: 'settings', name: 'Settings & IT', description: 'Tenant configuration, accounts, branches, security and IT administration.' },
];

const none = (): RbacPermission => ({ access: 'none' });
const view = (): RbacPermission => ({ access: 'view' });
const operate = (): RbacPermission => ({ access: 'operate' });
const all = (): RbacPermission => ({ access: 'all' });

const makePermissions = (overrides: Partial<RbacRolePermissions> = {}): RbacRolePermissions => ({
  dashboard: view(),
  sales: none(),
  inventory: none(),
  clients: none(),
  stock: none(),
  procurement: none(),
  logistics: none(),
  finance: none(),
  qa: none(),
  hr: none(),
  welfare: all(),
  predictive: none(),
  analytics: none(),
  marketing: none(),
  settings: none(),
  ...overrides,
});

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    name: 'owner',
    label: 'Owner',
    description: 'Tenant owner. Full functional access across the ERP while normal tenant, branch, audit and transaction controls remain enforced.',
    permissions: makePermissions({
      sales: all(), inventory: all(), clients: all(), stock: all(), procurement: all(), logistics: all(),
      finance: all(), qa: all(), hr: all(), predictive: all(), analytics: all(), marketing: all(), settings: all(),
    }),
  },
  {
    name: 'CEO',
    label: 'CEO / MD',
    description: 'Chief executive operational authority with full tenant-wide ERP access. Tenant ownership transfer remains an Owner-level matter.',
    permissions: makePermissions({
      sales: all(), inventory: all(), clients: all(), stock: all(), procurement: all(), logistics: all(),
      finance: all(), qa: all(), hr: all(), predictive: all(), analytics: all(), marketing: all(), settings: all(),
    }),
  },
  {
    name: 'admin',
    label: 'Admin',
    description: 'General organisational administrator supporting the CEO. Broad administrative operation without inheriting specialist reserved approvals.',
    permissions: makePermissions({
      sales: view(), inventory: view(), clients: operate(), stock: view(), procurement: view(), logistics: operate(),
      finance: operate(), qa: operate(), hr: operate(), predictive: operate(), analytics: operate(), marketing: operate(),
    }),
  },
  {
    name: 'HR Head',
    label: 'HR Head',
    description: 'Leads HR operations, HR analytics and HR-related compliance functions such as licences, CME and appraisals.',
    permissions: makePermissions({ hr: all(), qa: operate(), analytics: view() }),
  },
  {
    name: 'HR Support Personnel',
    label: 'HR Support Personnel',
    description: 'Supports HR data entry, staff administration, payroll preparation and delegated leave processing without final executive approvals.',
    permissions: makePermissions({ hr: operate() }),
  },
  {
    name: 'QA Head',
    label: 'QA Head',
    description: 'Full QA and compliance authority with cross-module report visibility for traceability and compliance oversight.',
    permissions: makePermissions({
      sales: view(), inventory: view(), clients: view(), stock: view(), procurement: view(), qa: all(), hr: operate(),
      predictive: operate(), analytics: view(), marketing: view(),
    }),
  },
  {
    name: 'QA Officer',
    label: 'QA Officer',
    description: 'Own-branch QA operations with traceability views of stock, inventory, procurement and sales records.',
    permissions: makePermissions({ qa: operate(), analytics: view() }),
  },
  {
    name: 'Finance Head',
    label: 'Finance Head',
    description: 'Leads branch and management finance, financial approvals and cross-module financial oversight.',
    permissions: makePermissions({
      sales: view(), inventory: view(), clients: view(), stock: view(), procurement: operate(), logistics: view(), finance: all(),
      qa: operate(), hr: operate(), predictive: operate(), analytics: view(), marketing: view(),
    }),
  },
  {
    name: 'Finance Officer',
    label: 'Finance Officer',
    description: 'Operates management finance and supports branch reconciliation and investigation without inheriting Finance Head final approvals.',
    permissions: makePermissions({ finance: operate() }),
  },
  {
    name: 'Procurement Head',
    label: 'Procurement Head',
    description: 'Leads procurement, stock movement, inventory and supplier operations with logistics visibility and procurement analytics.',
    permissions: makePermissions({ inventory: operate(), clients: operate(), stock: operate(), procurement: all(), logistics: view(), qa: operate(), hr: operate(), predictive: operate(), analytics: view() }),
  },
  {
    name: 'Procurement Officer',
    label: 'Procurement Personnel',
    description: 'Executes procurement, stock movement, inventory and supplier operations under Procurement Head governance.',
    permissions: makePermissions({ inventory: operate(), clients: operate(), stock: operate(), procurement: operate(), logistics: view(), predictive: view(), analytics: view() }),
  },
  {
    name: 'Logistics Head',
    label: 'Logistics Head',
    description: 'Leads fleet and logistics operations with narrow CRM delivery-detail and procurement-dispatch visibility.',
    permissions: makePermissions({ clients: view(), procurement: view(), logistics: all(), qa: operate(), hr: operate(), analytics: view() }),
  },
  {
    name: 'Transport & Logistics Personnel',
    label: 'Transport & Logistics Personnel',
    description: 'Executes assigned trips and permitted trip or fuel records with only the delivery contact information needed for the assignment.',
    permissions: makePermissions({ clients: view(), logistics: operate() }),
  },
  {
    name: 'Marketing Head',
    label: 'Marketing Head',
    description: 'Leads marketing programmes, marketing-facing CRM functions and marketing analytics.',
    permissions: makePermissions({ clients: operate(), qa: operate(), hr: operate(), analytics: view(), marketing: all() }),
  },
  {
    name: 'Marketing Personnel',
    label: 'Marketing Personnel',
    description: 'Executes marketing activities and approved CRM engagement workflows without Marketing Head reserved approvals.',
    permissions: makePermissions({ clients: operate(), analytics: view(), marketing: operate() }),
  },
  {
    name: 'IT Head',
    label: 'IT Head',
    description: 'Full Settings and IT administration plus diagnostic visibility across business modules. No permanent business transaction authority is granted for testing.',
    permissions: makePermissions({
      sales: view(), inventory: view(), clients: view(), stock: view(), procurement: view(), logistics: view(), finance: view(),
      qa: operate(), hr: operate(), predictive: view(), analytics: view(), marketing: view(), settings: all(),
    }),
  },
  {
    name: 'IT Support Staff',
    label: 'IT Support Personnel',
    description: 'Delegated IT and support operations with diagnostic visibility. Routine business transactions remain outside this role.',
    permissions: makePermissions({
      sales: view(), inventory: view(), clients: view(), stock: view(), procurement: view(), logistics: view(), finance: view(),
      qa: view(), hr: view(), predictive: view(), analytics: view(), marketing: view(), settings: operate(),
    }),
  },
  {
    name: 'Branch Manager',
    label: 'Branch Manager',
    description: 'Own-branch operational manager covering POS, inventory, CRM, stock movement, branch finance, compliance and incident reporting.',
    permissions: makePermissions({
      sales: operate(), inventory: operate(), clients: operate(), stock: operate(), logistics: view(), finance: operate(),
      qa: operate(), hr: operate(), predictive: view(), analytics: view(),
    }),
  },
  {
    name: 'pharmacist',
    label: 'Pharmacist',
    description: 'Branch pharmacy professional operating POS, inventory, CRM, stock movement and compliance with role-scoped analytical visibility.',
    permissions: makePermissions({
      sales: operate(), inventory: operate(), clients: operate(), stock: operate(), procurement: view(), logistics: view(), qa: operate(),
      predictive: view(), analytics: view(),
    }),
  },
  {
    name: 'Dispenser',
    label: 'Dispenser',
    description: 'Branch dispensing role operating POS, CRM, authorised stock receipt or transfer and own-branch compliance, with inventory visibility.',
    permissions: makePermissions({ sales: operate(), inventory: view(), clients: operate(), stock: operate(), qa: operate(), analytics: view() }),
  },
  {
    name: 'cashier',
    label: 'Cashier',
    description: 'Branch cashier with POS visibility and branch finance operation. Cashiers do not complete sales transactions.',
    permissions: makePermissions({ sales: view(), inventory: view(), finance: operate(), analytics: view() }),
  },
  {
    name: 'cleaner',
    label: 'Cleaner',
    description: 'Universal employee access plus functional access limited to assigned cleaning logs and cleaning checklists inside Compliance.',
    permissions: makePermissions({ qa: operate() }),
  },
  {
    name: 'Trainee',
    label: 'Trainee',
    description: 'Supervised trainee baseline. No independent business-module operation is granted by default; additional duties require an explicitly assigned secondary or custom role.',
    permissions: makePermissions(),
  },
];

export const SYSTEM_ROLE_PERMISSIONS: Record<string, RbacRolePermissions> = Object.fromEntries(
  SYSTEM_ROLES.map(role => [role.name, role.permissions])
);

export const SYSTEM_ROLE_NAMES = SYSTEM_ROLES.map(role => role.name);

export const isSystemRoleName = (roleName?: string | null): boolean => {
  if (!roleName) return false;
  const normalized = roleName.trim().toLowerCase();
  return SYSTEM_ROLES.some(role => role.name.toLowerCase() === normalized || role.label.toLowerCase() === normalized);
};

export const isITRoleName = (roleName?: string | null): boolean => {
  if (!roleName) return false;
  const normalized = roleName.trim().toLowerCase();
  return ['it head', 'it support staff', 'it support personnel', 'it staff'].includes(normalized);
};


export const PEOPLE_SUPERVISOR_SYSTEM_ROLES = [
  'Branch Manager',
  'Finance Head',
  'Procurement Head',
  'Logistics Head',
  'Transport & Logistics Head',
  'Marketing Head',
  'QA Head',
  'HR Head',
  'IT Head',
] as const;

export const isPeopleSupervisorRoleName = (roleName?: string | null): boolean => {
  if (!roleName) return false;
  const normalized = roleName.trim().toLowerCase();
  return PEOPLE_SUPERVISOR_SYSTEM_ROLES.some(role => role.toLowerCase() === normalized);
};

export const roleRealmId = (tenantId: string, roleName: string): string =>
  `${tenantId}_${roleName.replace(/\s+/g, '_').toLowerCase()}`;

export type RealmAccessLevel = 'none' | 'view_only' | 'view_functional' | 'all';

export interface RealmPermissionRecord {
  accessLevel: RealmAccessLevel;
  scope: 'assigned_branches' | 'all_branches' | 'tenant';
  submodules: string;
}

export const accessToRealmLevel = (access: RbacAccess): RealmAccessLevel => {
  if (access === 'view') return 'view_only';
  if (access === 'operate') return 'view_functional';
  if (access === 'all') return 'all';
  return 'none';
};

export const systemRoleRealmPermissions = (role: SystemRoleDefinition): Record<RbacModuleKey, RealmPermissionRecord> =>
  Object.fromEntries(
    RBAC_MODULES.map(module => [
      module.id,
      {
        accessLevel: accessToRealmLevel(role.permissions[module.id].access),
        scope: role.name === 'owner' || role.name === 'CEO' || role.name === 'IT Head' || role.name === 'IT Support Staff'
          ? 'tenant'
          : 'assigned_branches',
        submodules: '',
      },
    ])
  ) as Record<RbacModuleKey, RealmPermissionRecord>;

export const customRoleBaselinePermissions = (): Record<RbacModuleKey, RealmPermissionRecord> =>
  Object.fromEntries(
    RBAC_MODULES.map(module => [
      module.id,
      {
        accessLevel: module.id === 'dashboard' ? 'view_only' : module.id === 'welfare' ? 'view_functional' : 'none',
        scope: 'assigned_branches',
        submodules: '',
      },
    ])
  ) as Record<RbacModuleKey, RealmPermissionRecord>;
