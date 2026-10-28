/** Exact attribution only: never allocate untagged/HQ expenditure to a branch. */
export function matchesProfitabilityBranch(record: { tenantId?: string; branchId?: string; branch_id?: string }, tenantId: string, branchId: string): boolean {
  return !!tenantId && !!branchId && record.tenantId === tenantId && (record.branchId || record.branch_id) === branchId;
}
