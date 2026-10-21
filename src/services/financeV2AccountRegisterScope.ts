/**
 * Read-only Finance V2 account register query contract.
 *
 * This is not an authorization boundary. Firestore Security Rules must
 * independently enforce every predicate before delegated reads are enabled.
 * Deliberately fail closed until delegatedAccountReadsCertified is true.
 */
export type FinanceV2RegisterReader = {
  tenantId: string;
  role: 'Finance Head' | 'Finance Officer' | 'Accountant';
  assignedBranchIds: readonly string[];
};

export type FinanceV2RegisterScope = {
  tenantId: string;
  controlVersion: 2;
  branchId?: string;
};

const validId = (value: string): boolean => /^[A-Za-z0-9_-]{1,150}$/.test(value);

export function planFinanceV2AccountRegisterScope(
  reader: FinanceV2RegisterReader,
  requestedBranchId?: string,
  delegatedAccountReadsCertified = false
): FinanceV2RegisterScope {
  if (!validId(reader.tenantId)) throw new Error('Invalid tenant');
  if (reader.role === 'Finance Head') {
    if (requestedBranchId !== undefined && !validId(requestedBranchId)) throw new Error('Invalid branch');
    return {tenantId: reader.tenantId, controlVersion: 2, ...(requestedBranchId ? {branchId: requestedBranchId} : {})};
  }
  if (reader.role !== 'Finance Officer' && reader.role !== 'Accountant') throw new Error('Unsupported role');
  if (!delegatedAccountReadsCertified) throw new Error('Delegated V2 account reads are not certified in Firestore Security Rules');
  if (!requestedBranchId || !validId(requestedBranchId) || !reader.assignedBranchIds.includes(requestedBranchId)) {
    throw new Error('Requested branch not assigned');
  }
  return {tenantId: reader.tenantId, controlVersion: 2, branchId: requestedBranchId};
}
