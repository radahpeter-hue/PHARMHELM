import type { Staff } from '../../types';
import { isSystemRoleName } from '../../config/rbac';

const GLOBAL_REVISION_ROLES = new Set([
  'owner',
  'ceo',
  'ceo / md',
  'admin',
  'finance head',
  'finance officer',
  'accountant',
  'it head',
  'it support staff',
  'it support personnel',
  'it staff',
  'qa head',
  'qa manager'
]);

const normalizeRole = (value: unknown): string => String(value ?? '').trim().toLowerCase();

/**
 * Mirrors the named-role and custom-Finance boundaries in
 * canViewGlobalRevisionLedger. Firestore remains the final authority.
 */
export function canViewGlobalPosV2RevisionAnalytics(
  profile: Pick<Staff, 'role' | 'secondaryRoles'> & { roleRealmId?: string | null },
  hasFunctionalFinanceAccess: boolean
): boolean {
  const roles = [profile.role, ...(profile.secondaryRoles || [])].map(normalizeRole);
  if (roles.some(role => GLOBAL_REVISION_ROLES.has(role))) return true;

  const primaryRole = String(profile.role || '').trim();
  const hasCustomRealm = Boolean(String(profile.roleRealmId || '').trim()) && !isSystemRoleName(primaryRole);
  return hasCustomRealm && hasFunctionalFinanceAccess;
}
