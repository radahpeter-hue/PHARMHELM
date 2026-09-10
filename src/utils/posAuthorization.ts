import type { Staff } from '../types';

/**
 * POS checkout authority is capability-based.
 *
 * AuthContext resolves the effective `sales:operate` permission from the
 * user's primary role, secondary roles and any tenant custom-role realm.
 * Anyone with effective functional POS access may sell, except the Cashier
 * role, which is intentionally excluded from completing sales by policy.
 */
export const canOperatePos = (
  profile: Pick<Staff, 'role' | 'secondaryRoles'> | null | undefined,
  hasSalesOperatePermission: boolean
) => {
  if (!profile || !hasSalesOperatePermission) return false;
  const primaryRole = String(profile.role || '').trim().toLowerCase();
  if (primaryRole === 'cashier') return false;
  return true;
};

export const formatPosCheckoutError = (error: unknown) => {
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  let message = rawMessage;

  try {
    const parsed = JSON.parse(rawMessage);
    message = typeof parsed?.error === 'string' ? parsed.error : rawMessage;
  } catch {
    // Non-JSON application errors are already safe to classify below.
  }

  if (/missing or insufficient permissions|permission-denied/i.test(message)) {
    return 'The sale was blocked by a transaction permission check. Your POS functional access may be valid, but one of the sale or stock writes was rejected. No stock was deducted.';
  }

  if (/^(Stock record is missing|Batch .* no longer exists|Product .* no longer exists|Insufficient stock)/i.test(message)) {
    return message;
  }

  return message;
};
