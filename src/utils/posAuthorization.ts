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
  let operationPath = '';

  try {
    const parsed = JSON.parse(rawMessage);
    message = typeof parsed?.error === 'string' ? parsed.error : rawMessage;
    operationPath = typeof parsed?.path === 'string' ? parsed.path : '';
  } catch {
    // Non-JSON application errors are already safe to classify below.
  }

  if (/missing or insufficient permissions|permission-denied/i.test(message)) {
    if (operationPath === 'sales/product_batches/products') {
      return 'Atomic checkout reached Firestore but the live rules rejected one of the sale, batch-stock, or product-stock writes. No stock was deducted. The app-side POS permission check already passed, so verify the active ruleset on the named production database and the authoritative staff UID record.';
    }
    return `The sale was blocked by a Firestore permission check${operationPath ? ` during ${operationPath}` : ''}. No stock was deducted.`;
  }

  if (/^(Stock record is missing|Batch .* no longer exists|Product .* no longer exists|Insufficient stock)/i.test(message)) {
    return message;
  }

  return message;
};
