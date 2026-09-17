import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { PosCheckoutV2Error } from './posCheckoutV2Errors';
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

/**
 * Reads the activation documents at the start of a new checkout attempt.
 * The selected engine is then pinned by the caller for the lifetime of that
 * attempt, so a retry can never switch engines after an uncertain commit.
 */
export async function loadPosCheckoutV2Mode(params: {
  tenantId: string;
  branchId: string;
}): Promise<PosCheckoutV2FeatureResolution> {
  const tenantId = String(params.tenantId || '').trim();
  const branchId = String(params.branchId || '').trim();
  if (!tenantId || !branchId) {
    throw new PosCheckoutV2Error('CONFIGURATION_ERROR', 'A tenant and active branch are required to select the checkout engine.');
  }

  try {
    const [tenantSnapshot, branchSnapshot] = await Promise.all([
      getDoc(doc(db, 'tenants', tenantId)),
      getDoc(doc(db, 'branches', branchId))
    ]);
    if (!tenantSnapshot.exists()) {
      throw new PosCheckoutV2Error('CONFIGURATION_ERROR', 'The active tenant configuration is unavailable. Checkout has not started.');
    }
    if (!branchSnapshot.exists()) {
      throw new PosCheckoutV2Error('CONFIGURATION_ERROR', 'The active branch configuration is unavailable. Checkout has not started.');
    }

    const branch = branchSnapshot.data() as PosCheckoutV2BranchConfig & { tenantId?: string };
    if (branch.tenantId !== tenantId) {
      throw new PosCheckoutV2Error('CONFIGURATION_ERROR', 'The active branch does not belong to the current tenant. Checkout has not started.');
    }

    return resolvePosCheckoutV2Mode({
      tenant: tenantSnapshot.data() as PosCheckoutV2FeatureConfig,
      branch
    });
  } catch (error) {
    if (error instanceof PosCheckoutV2Error) throw error;
    throw new PosCheckoutV2Error(
      'CONFIGURATION_ERROR',
      'Checkout configuration could not be verified. No sale was created; retry when connectivity is restored.'
    );
  }
}
