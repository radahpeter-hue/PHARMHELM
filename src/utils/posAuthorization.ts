import type { Staff } from '../types';

const DEFAULT_POS_OPERATOR_ROLES = new Set([
  'owner',
  'ceo',
  'ceo / md',
  'admin',
  'cashier',
  'pharmacist',
  'dispenser',
  'trainee',
  'it head',
  'branch manager'
]);

const normalizeRole = (role?: string) => (role || '').trim().toLowerCase();

/**
 * Firestore currently authorizes POS stock mutations by operational role.
 * Keep the client gate equally strict so view-only and unsupported custom roles
 * cannot reach a checkout that the database will reject.
 */
export const hasTrustedPosOperatorRole = (
  profile?: Pick<Staff, 'role' | 'secondaryRoles'> | null
) => {
  if (!profile) return false;
  return [profile.role, ...(profile.secondaryRoles || [])]
    .some(role => DEFAULT_POS_OPERATOR_ROLES.has(normalizeRole(role)));
};

export const canOperatePos = (
  profile: Pick<Staff, 'role' | 'secondaryRoles'> | null | undefined,
  hasSalesOperatePermission: boolean
) => hasSalesOperatePermission && hasTrustedPosOperatorRole(profile);

export const formatPosCheckoutError = (error: unknown) => {
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  let message = rawMessage;

  try {
    const parsed = JSON.parse(rawMessage);
    message = typeof parsed?.error === 'string' ? parsed.error : rawMessage;
  } catch {
    // Non-JSON application errors are already safe to display below.
  }

  if (/missing or insufficient permissions|permission-denied/i.test(message)) {
    return 'Your account is not authorised to create this sale or update stock. Confirm your POS role and active branch, then sign in again.';
  }

  if (/^(Stock record is missing|Batch .* no longer exists|Product .* no longer exists|Insufficient stock)/i.test(message)) {
    return message;
  }

  return 'The sale could not be completed. No stock was deducted. Refresh the page and try again.';
};
