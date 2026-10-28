/** Manual-entry policy only; never filters or rewrites historical records. */
export function canUseBranchExpenseCategory(category: string, originalCategory?: string): boolean {
  const normalized = category.trim().toLowerCase();
  if (!['salary', 'salaries'].includes(normalized)) return true;
  return !!originalCategory && normalized === originalCategory.trim().toLowerCase();
}

import type { Staff } from '../types';
export const expenseStaffName = (staff: Staff): string => staff.full_name || staff.fullName || staff.displayName || staff.username || staff.email || 'Unnamed staff';

export function eligibleExpenseStaff(staff: Staff[], tenantId: string): Staff[] {
  return staff.filter(s => s.tenantId === tenantId && !!s.id && s.active !== false
    && !['inactive', 'suspended', 'pending_it'].includes(String(s.status || '').toLowerCase())
    && (s.active === true || String(s.status || '').toLowerCase() === 'active'))
    .sort((a, b) => expenseStaffName(a).localeCompare(expenseStaffName(b)));
}

export function staffExpenseAttribution(staff: Staff) {
  return {
    recipient_type: 'staff' as const,
    recipient_staff_id: staff.id, // Authoritative immutable Firestore document identity.
    recipient_staff_code: staff.staff_code || '' // Human-readable snapshot, never the lookup key.
  };
}

export function isAllowanceCategory(category: string): boolean {
  return ['allowance', 'allowances', 'allowances issued'].includes(category.trim().toLowerCase().replace(/[_-]+/g, ' '));
}

export function expenseRecipientTypeAllowed(category: string, type: string): boolean {
  return !isAllowanceCategory(category) || type === 'staff';
}
