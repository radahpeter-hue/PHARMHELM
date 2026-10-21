/**
 * Finance V2 pure transfer policy. No Firestore side effects.
 * The posting service must commit all account changes, movements and charge
 * recognition in ONE database transaction, with tenant-scoped idempotency.
 */
export type FinanceV2AccountKind = 'BRANCH_CASH_SALES' | 'BANK' | 'MTN_MOBILE_MONEY' | 'AIRTEL_MONEY' | 'PETTY_CASH';

export interface FinanceV2AccountSnapshot {
  tenantId: string;
  accountId: string;
  kind: FinanceV2AccountKind;
  balanceUGX: number;
  branchId?: string;
  active: boolean;
}

export interface FinanceV2TransferInput {
  tenantId: string;
  requestId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  chargePayerAccountId: string;
  principalUGX: number;
  chargeUGX: number;
  actorUid: string;
  description?: string;
}

export interface FinanceV2TransferPlan {
  idempotencyKey: string;
  movements: ReadonlyArray<{ accountId: string; deltaUGX: number; purpose: 'PRINCIPAL' | 'CHARGE' }>;
  accountDeltas: ReadonlyArray<{ accountId: string; deltaUGX: number }>;
  externalChargeExpenseUGX: number;
}

const validId = (value: string) => /^[a-zA-Z0-9_-]{1,150}$/.test(value);
const validMoney = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function planFinanceV2Transfer(input: FinanceV2TransferInput, accounts: readonly FinanceV2AccountSnapshot[]): FinanceV2TransferPlan {
  for (const [name, value] of Object.entries({
    tenantId: input.tenantId, requestId: input.requestId,
    sourceAccountId: input.sourceAccountId, destinationAccountId: input.destinationAccountId,
    chargePayerAccountId: input.chargePayerAccountId, actorUid: input.actorUid
  })) if (!validId(value)) throw new Error(`Invalid ${name}`);

  if (input.sourceAccountId === input.destinationAccountId) throw new Error('Source and destination must differ');
  if (!validMoney(input.principalUGX) || input.principalUGX === 0) throw new Error('Principal must be positive whole UGX');
  if (!validMoney(input.chargeUGX)) throw new Error('Charge must be non-negative whole UGX');

  if(input.description!==undefined && (typeof input.description!=='string'||input.description.trim().length<3||input.description.length>500))throw new Error('Description must contain 3 to 500 characters');
  const byId = new Map<string, FinanceV2AccountSnapshot>();
  for (const account of accounts) {
    if (byId.has(account.accountId)) throw new Error('Duplicate account identity');
    byId.set(account.accountId, account);
  }
  for (const id of [input.sourceAccountId, input.destinationAccountId, input.chargePayerAccountId]) {
    const account = byId.get(id);
    if (!account || account.tenantId !== input.tenantId || !account.active) throw new Error('Account missing, inactive or outside tenant');
    if (!['BRANCH_CASH_SALES','BANK','MTN_MOBILE_MONEY','AIRTEL_MONEY','PETTY_CASH'].includes(account.kind)) throw new Error('Unsupported account kind');
    if (!validMoney(account.balanceUGX)) throw new Error('Invalid account balance');
  }

  const movements: FinanceV2TransferPlan['movements'] = [
    { accountId: input.sourceAccountId, deltaUGX: -input.principalUGX, purpose: 'PRINCIPAL' },
    { accountId: input.destinationAccountId, deltaUGX: input.principalUGX, purpose: 'PRINCIPAL' },
    ...(input.chargeUGX > 0 ? [{ accountId: input.chargePayerAccountId, deltaUGX: -input.chargeUGX, purpose: 'CHARGE' as const }] : [])
  ];
  const deltas = new Map<string, number>();
  for (const movement of movements) deltas.set(movement.accountId, (deltas.get(movement.accountId) ?? 0) + movement.deltaUGX);
  for (const [accountId, delta] of deltas) {
    const available = byId.get(accountId)!.balanceUGX;
    if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(available + delta)) throw new Error('UGX arithmetic overflow');
    if (available + delta < 0) throw new Error('Insufficient funds');
  }
  return {
    idempotencyKey: `finance_v2_transfer_${input.tenantId}_${input.requestId}`,
    movements,
    accountDeltas: [...deltas].map(([accountId, deltaUGX]) => ({ accountId, deltaUGX })),
    externalChargeExpenseUGX: input.chargeUGX
  };
}
