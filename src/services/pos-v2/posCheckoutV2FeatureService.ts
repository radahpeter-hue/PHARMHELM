import type {
  PosCheckoutEngineMode,
  PosCheckoutV2BranchConfig,
  PosCheckoutV2FeatureConfig,
  PosCheckoutV2FeatureResolution
} from './posCheckoutV2Types';

const validModes: PosCheckoutEngineMode[] = ['legacy', 'shadow', 'v2'];

function isCheckoutMode(value: unknown): value is PosCheckoutEngineMode {
  return typeof value === 'string' && validModes.includes(value as PosCheckoutEngineMode);
}

export function resolvePosCheckoutV2Mode(params: {
  tenant?: PosCheckoutV2FeatureConfig | null;
  branch?: PosCheckoutV2BranchConfig | null;
}): PosCheckoutV2FeatureResolution {
  const configuredTenantMode = params.tenant?.posCheckoutEngine;
  const configuredBranchMode = params.branch?.posCheckoutEngine;
  const tenantEnabled = params.tenant?.features?.posCheckoutV2Enabled === true;

  if (!tenantEnabled) {
    return {
      tenantEnabled: false,
      tenantMode: 'legacy',
      effectiveMode: 'legacy',
      reason: 'tenant-disabled'
    };
  }

  const tenantMode: PosCheckoutEngineMode = isCheckoutMode(configuredTenantMode)
    ? configuredTenantMode
    : 'shadow';

  if (isCheckoutMode(configuredBranchMode)) {
    return {
      tenantEnabled: true,
      tenantMode,
      branchOverride: configuredBranchMode,
      effectiveMode: configuredBranchMode,
      reason: 'branch-override'
    };
  }

  return {
    tenantEnabled: true,
    tenantMode,
    effectiveMode: tenantMode,
    reason: isCheckoutMode(configuredTenantMode) ? 'tenant-mode' : 'tenant-default'
  };
}
