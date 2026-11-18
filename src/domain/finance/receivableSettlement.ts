import { builtInPortfolioId } from './builtInPortfolios';
import type { FinancialPortfolio } from './financialPortfolio';
import type { ManagementPaymentAccount } from '../../services/managementCashPosting';

export const RECEIVABLE_SETTLEMENTS = 'finance_receivable_settlements_v1';
export const RECEIVABLE_COLLECTION_SOURCE = 'Credit receivable payment';

export interface ReceivableSettlementIntent {
  tenantId: string;
  receivableId: string;
  destinationAccountId: string;
  amountUGX: number;
  reference: string;
  requestId: string;
  actorId: string;
}

export function normalizeReceivableSettlement(input: ReceivableSettlementIntent): ReceivableSettlementIntent {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(input.tenantId) ||
    !/^[A-Za-z0-9_-]{1,150}$/.test(input.destinationAccountId) ||
    !/^[A-Za-z0-9_-]{20,100}$/.test(input.requestId) ||
    !input.actorId || !input.receivableId || input.receivableId.includes('/')) {
    throw new Error('Invalid receivable payment identity.');
  }
  if (!Number.isSafeInteger(input.amountUGX) || input.amountUGX <= 0) {
    throw new Error('Enter a positive whole UGX amount.');
  }
  const reference = input.reference.trim().replace(/\s+/g, ' ');
  if (reference.length < 3 || reference.length > 120) throw new Error('Enter a payment reference of 3 to 120 characters.');
  return { ...input, reference };
}

export function replayReceivableSettlement(input: ReceivableSettlementIntent, payment: Record<string, unknown>) {
  const keys = ['tenantId', 'receivableId', 'destinationAccountId', 'amountUGX', 'reference', 'requestId', 'actorId'] as const;
  if (keys.some(key => payment[key] !== input[key]) || typeof payment.outstandingAfterUGX !== 'number') {
    throw new Error('This payment request already belongs to a different transaction.');
  }
  return { settlementId: input.requestId, remainingUGX: payment.outstandingAfterUGX, replayed: true };
}

export function calculateReceivableSettlement(row: Record<string, unknown>, amount: number) {
  const before = row.outstanding_ugx;
  if (['reversed','voided','paid'].includes(String(row.status).toLowerCase()) ||
    typeof before !== 'number' || !Number.isFinite(before) || before > Number.MAX_SAFE_INTEGER ||
    typeof row.amount_ugx !== 'number' || before > row.amount_ugx || before < amount) {
    throw new Error('Payment exceeds the collectible outstanding balance.');
  }
  const after = before - amount;
  return { before, after, status: after === 0 ? 'paid' : 'partial' };
}

export function isReceivableDestination(
  account: ManagementPaymentAccount & {status?: string; active?: boolean},
  tenantId: string,
  branchId: string,
  portfolio?: FinancialPortfolio,
): boolean {
  const key = account.accountId;
  if (!branchId || account.tenantId !== tenantId || account.portfolioId !== key || !account.initialized ||
    account.currency !== 'UGX' || account.active === false || (account.status ?? 'active') !== 'active' ||
    !Number.isSafeInteger(account.balanceUGX) || account.balanceUGX < 0) return false;
  if (account.scope?.kind === 'branch' && account.scope.branchId !== branchId) return false;
  if (key === builtInPortfolioId('branch_cash_sales', branchId)) {
    return account.scope?.kind === 'branch' && account.kind === 'petty_cash' && account.portfolioClassification === 'cash_equivalent';
  }
  if (key === builtInPortfolioId('mtn_mobile_money') || key === builtInPortfolioId('airtel_mobile_money')) {
    return account.scope?.kind === 'organisation' && account.kind === 'bank' && account.portfolioClassification === 'mobile_money';
  }
  return !!portfolio && portfolio.id === key && /^(bank_[a-f0-9]{64}|custom_[A-Za-z0-9_-]+)$/.test(key)
    && portfolio.tenantId === tenantId && portfolio.origin === 'custom' && portfolio.status === 'active'
    && portfolio.currency === 'UGX' && !!account.scope && portfolio.scope.kind === account.scope.kind
    && (portfolio.scope.kind !== 'branch' || portfolio.scope.branchId === branchId)
    && portfolio.classification === account.portfolioClassification
    && (portfolio.bankParentId === 'system_bank' || portfolio.allowsTransfersIn)
    && ['bank', 'mobile_money', 'cash_equivalent', 'petty_cash'].includes(portfolio.classification)
    && account.kind === (['bank', 'mobile_money'].includes(portfolio.classification) ? 'bank' : 'petty_cash');
}
