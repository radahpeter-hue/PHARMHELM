/** Finance V2 registry contract. Pure validation only: never writes balances. */
import type { FinanceV2AccountKind } from './financeV2TransferPolicy';

export interface FinanceV2AccountRegistration {
  tenantId: string;
  accountId: string;
  name: string;
  kind: FinanceV2AccountKind;
  branchId?: string;
  openingBalanceUGX: number;
  reconciliationReference: string;
  actorUid: string;
}

export interface FinanceV2AccountRecord {
  tenantId: string;
  accountId: string;
  name: string;
  kind: FinanceV2AccountKind;
  branchId?: string;
  currency: 'UGX';
  balanceUGX: number;
  openingBalanceUGX: number;
  reconciliationReference: string;
  initialized: true;
  controlVersion: 2;
  active: true;
  registeredBy: string;
  lastPostingId: null;
}

const validId = (s: string) => /^[A-Za-z0-9_-]{1,150}$/.test(s);
const validKinds: ReadonlySet<string> = new Set(['BRANCH_CASH_SALES','BANK','MTN_MOBILE_MONEY','AIRTEL_MONEY','PETTY_CASH']);
const reservedIds = new Set(['management_petty_cash','management_bank']);

export function financeV2AccountDocumentId(tenantId: string, accountId: string): string {
  if (!validId(tenantId) || !validId(accountId)) throw new Error('Invalid account identity');
  return `${tenantId}_${accountId}`;
}

export function planFinanceV2AccountRegistration(input: FinanceV2AccountRegistration): FinanceV2AccountRecord {
  financeV2AccountDocumentId(input.tenantId, input.accountId);
  if (reservedIds.has(input.accountId)) throw new Error('Existing Management account IDs are reserved for compatibility');
  if (!validId(input.actorUid)) throw new Error('Authenticated actor UID required');
  if (!validKinds.has(input.kind)) throw new Error('Unsupported account kind');
  const name = input.name?.trim();
  if (!name || name.length > 150) throw new Error('Valid account name required');
  const reference = input.reconciliationReference?.trim();
  if (!reference || reference.length < 5 || reference.length > 150) throw new Error('Opening balance reconciliation reference required');
  if (!Number.isSafeInteger(input.openingBalanceUGX) || input.openingBalanceUGX < 0) throw new Error('Opening balance must be nonnegative whole UGX');
  if (input.branchId !== undefined && !validId(input.branchId)) throw new Error('Invalid branch identity');
  if (input.kind === 'BRANCH_CASH_SALES' && !input.branchId) throw new Error('Branch Cash Sales requires a branch identity');
  return {
    tenantId: input.tenantId, accountId: input.accountId, name, kind: input.kind,
    ...(input.branchId ? {branchId:input.branchId} : {}),
    currency:'UGX',balanceUGX:input.openingBalanceUGX,openingBalanceUGX:input.openingBalanceUGX,
    reconciliationReference:reference, initialized:true,controlVersion:2,active:true,
    registeredBy:input.actorUid,lastPostingId:null
  };
}

/** Legacy accounts must be read, not re-created or migrated by registration. */
export function isLegacyManagementAccount(accountId: string): boolean {
  return reservedIds.has(accountId);
}
