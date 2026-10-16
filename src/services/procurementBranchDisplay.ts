import type { StockOrder } from '../types';

/**
 * Use the tenant branch registry as the canonical display name.
 * Never infer the requisition origin from the logged-in user's active branch.
 */
export function procurementRequestingBranchLabel(
  order: Pick<StockOrder, 'requesting_branch_id' | 'requesting_branch_name'>,
  registeredNames: Readonly<Record<string, string>>
): string {
  const id = (order.requesting_branch_id || '').trim();
  const registeredName = id ? registeredNames[id]?.trim() : '';
  if (registeredName) return registeredName;

  const embeddedName = (order.requesting_branch_name || '').trim();
  if (embeddedName && embeddedName !== id) return embeddedName;

  if (id === 'HQ') return 'HQ Central Store';
  if (id) return `Branch name unavailable (ID: ${id})`;
  return 'Requesting branch not recorded';
}
