export type SubscriptionTier = 'basic' | 'standard' | 'enterprise';

export const SUBSCRIPTION_TIER_DEFAULT_BRANCH_LIMITS: Record<SubscriptionTier, number> = {
  basic: 1,
  standard: 5,
  enterprise: 15
};

export const SUBSCRIPTION_TIER_LABELS: Record<SubscriptionTier, string> = {
  basic: 'Basic',
  standard: 'Standard',
  enterprise: 'Enterprise'
};

export type BranchLimitSource = 'tier_default' | 'manual' | 'trial';
export type DateLike = string | Date | { toDate: () => Date };

export interface TrialStatusData {
  isTrial: boolean;
  trialBranchLimit: number;
  trialStartDate: DateLike;
  trialEndDate: DateLike;
  grantedBy: string;
  grantedAt: DateLike;
  notes?: string;
  previousBranchLimit?: number | null;
  previousBranchLimitSource?: BranchLimitSource | null;
  previousBranchLimitManuallyOverridden?: boolean;
  previousSubscriptionStatus?: string;
}

export interface ComplimentaryPeriodData {
  isActive: boolean;
  startDate: DateLike;
  endDate: DateLike;
  reason: string;
  grantedBy: string;
  grantedAt: DateLike;
}

export const getDefaultBranchLimit = (tier?: string | null): number => {
  if (tier === 'basic') return SUBSCRIPTION_TIER_DEFAULT_BRANCH_LIMITS.basic;
  if (tier === 'standard') return SUBSCRIPTION_TIER_DEFAULT_BRANCH_LIMITS.standard;
  return SUBSCRIPTION_TIER_DEFAULT_BRANCH_LIMITS.enterprise;
};

export const resolveBranchLimit = (
  branchLimit: unknown,
  tier?: string | null
): number => {
  if (typeof branchLimit === 'number' && Number.isFinite(branchLimit) && branchLimit >= 0) {
    return Math.floor(branchLimit);
  }
  return getDefaultBranchLimit(tier);
};

export const isValidBranchLimit = (value: unknown): value is number => (
  typeof value === 'number' && Number.isInteger(value) && value >= 0
);

const toDate = (value?: DateLike | null): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  return null;
};

export const isTrialExpired = (
  trialStatus?: Pick<TrialStatusData, 'isTrial' | 'trialEndDate'> | null,
  now = new Date()
): boolean => {
  if (!trialStatus?.isTrial || !trialStatus.trialEndDate) return false;
  const end = toDate(trialStatus.trialEndDate);
  if (!end) return false;
  return end.getTime() < now.getTime();
};

export const isComplimentaryPeriodActive = (
  complimentaryPeriod?: Pick<ComplimentaryPeriodData, 'isActive' | 'startDate' | 'endDate'> | null,
  now = new Date()
): boolean => {
  if (!complimentaryPeriod?.isActive) return false;
  const start = toDate(complimentaryPeriod.startDate);
  const end = toDate(complimentaryPeriod.endDate);
  if (!start || !end) return false;
  return start.getTime() <= now.getTime() && now.getTime() <= end.getTime();
};

/**
 * Subscription tiers are commercial labels and default branch-limit seeds only.
 * They must never be used by tenant application modules to authorize feature access.
 * Functional access remains governed by authentication, tenant isolation and RBAC.
 */
export const SUBSCRIPTION_TIERS_GATE_FEATURES = false as const;
