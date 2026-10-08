export const POS_V2_ACTIVATION_OPERATIONS = ['inspect', 'activate', 'rollback'];

function requiredId(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function checkoutMode(value) {
  return ['legacy', 'shadow', 'v2'].includes(value) ? value : null;
}

export function buildPosV2ActivationPlan(params) {
  const operation = String(params.operation || '').trim();
  if (!POS_V2_ACTIVATION_OPERATIONS.includes(operation)) {
    throw new Error(`Operation must be one of: ${POS_V2_ACTIVATION_OPERATIONS.join(', ')}.`);
  }
  const tenantId = requiredId(params.tenantId, 'Tenant ID');
  const branchId = requiredId(params.branchId, 'Branch ID');
  if (!params.tenant || typeof params.tenant !== 'object') throw new Error(`Tenant ${tenantId} does not exist.`);
  if (!params.branch || typeof params.branch !== 'object') throw new Error(`Branch ${branchId} does not exist.`);
  if (String(params.branch.tenantId || '') !== tenantId) throw new Error(`Branch ${branchId} does not belong to tenant ${tenantId}.`);
  if (String(params.branch.status || '').trim().toLowerCase() !== 'active') throw new Error(`Branch ${branchId} is not active.`);

  const current = {
    tenantFeatureEnabled: params.tenant?.features?.posCheckoutV2Enabled === true,
    tenantEngine: checkoutMode(params.tenant?.posCheckoutEngine) || null,
    branchEngine: checkoutMode(params.branch?.posCheckoutEngine) || null
  };
  const desired = operation === 'activate'
    ? { tenantFeatureEnabled: true, tenantEngine: 'legacy', branchEngine: 'v2' }
    : operation === 'rollback'
      ? { ...current, branchEngine: 'legacy' }
      : { ...current };

  return {
    operation,
    tenantId,
    branchId,
    current,
    desired,
    changes: {
      tenantFeatureEnabled: current.tenantFeatureEnabled !== desired.tenantFeatureEnabled,
      tenantEngine: current.tenantEngine !== desired.tenantEngine,
      branchEngine: current.branchEngine !== desired.branchEngine
    },
    tenantUpdate: operation === 'activate'
      ? { 'features.posCheckoutV2Enabled': true, posCheckoutEngine: 'legacy' }
      : null,
    branchUpdate: operation === 'activate'
      ? { posCheckoutEngine: 'v2' }
      : operation === 'rollback'
        ? { posCheckoutEngine: 'legacy' }
        : null
  };
}

export function stableActivationAuditId({ runId, operation, tenantId, branchId }) {
  const raw = `pos_v2_batch6_${runId}_${operation}_${tenantId}_${branchId}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 240);
}

export function isTerminallySupersededOutbox(event) {
  return String(event?.status || '').trim().toUpperCase() === 'SUPERSEDED';
}

export function buildPosV2Inventory({ tenants = [], branches = [] }) {
  const tenantById = new Map(tenants.map(row => [String(row.id), row]));
  const tenantRows = tenants.map(row => {
    const tenantId = String(row.id);
    const tenantEnabled = row.features?.posCheckoutV2Enabled === true;
    const tenantEngine = checkoutMode(row.posCheckoutEngine);
    return {
      tenantId,
      name: String(row.name || row.tenantName || row.displayName || row.legalName || ''),
      tenantFeatureEnabled: tenantEnabled,
      tenantEngine,
      currentDefaultMode: !tenantEnabled ? 'legacy' : (tenantEngine || 'shadow')
    };
  });
  const eligiblePairs = [];
  const excludedBranches = [];
  const activeBranches = [];
  for (const row of branches) {
    const branchId = String(row.id);
    const tenantId = String(row.tenantId || '');
    const tenant = tenantById.get(tenantId);
    const active = String(row.status || '').trim().toLowerCase() === 'active';
    const branchEngine = checkoutMode(row.posCheckoutEngine);
    const tenantEnabled = tenant?.features?.posCheckoutV2Enabled === true;
    const tenantEngine = checkoutMode(tenant?.posCheckoutEngine);
    const effectiveMode = !tenantEnabled ? 'legacy' : (branchEngine || tenantEngine || 'shadow');
    const branchRecord = {
      tenantId,
      branchId,
      name: String(row.name || row.branchName || row.branch_name || row.branch_code || ''),
      status: String(row.status || ''),
      active,
      ownerTenantExists: Boolean(tenant),
      tenantFeatureEnabled: tenantEnabled,
      tenantEngine,
      branchEngine,
      effectiveMode
    };
    if (!tenant || !tenantId) {
      excludedBranches.push({ ...branchRecord, exclusion: 'missing-tenant-owner' });
    } else if (active) {
      activeBranches.push(branchRecord);
      eligiblePairs.push({ tenantId, branchId });
    } else {
      excludedBranches.push({ ...branchRecord, exclusion: 'branch-not-active' });
    }
  }
  return {
    tenants: tenantRows,
    activeBranches,
    eligiblePairs,
    excludedBranches,
    counts: {
      tenants: tenantRows.length,
      activeBranches: activeBranches.length,
      eligiblePairs: eligiblePairs.length,
      excludedBranches: excludedBranches.length
    }
  };
}
