import type { FinancialPortfolio } from './financialPortfolio';

const HQ_FINANCE_ROLES = ['Finance Head', 'Finance Officer'];
const BRANCH_ROLES = ['branch manager', 'cashier', 'dispenser', 'pharmacist', 'branch pharmacist'];

type SupplierPaymentStaff = {
  tenantId?: string;
  role?: string;
  secondaryRoles?: string[];
  active?: boolean;
  status?: string;
  is_duplicate?: boolean;
};

export function canSettleSupplierInvoices(staff: SupplierPaymentStaff | null | undefined, tenantId: string) {
  return !!staff && staff.tenantId === tenantId && !staff.is_duplicate && staff.active !== false &&
    (staff.status === 'active' || (staff.status == null && staff.active === true)) &&
    !BRANCH_ROLES.includes((staff.role || '').toLowerCase()) &&
    [staff.role, ...(staff.secondaryRoles || [])].some(role => !!role && HQ_FINANCE_ROLES.includes(role));
}

export type SupplierFundingAccount = {
  tenantId: string;
  accountId: string;
  name: string;
  kind: 'bank' | 'petty_cash';
  currency: string;
  initialized: boolean;
  status?: string;
  active?: boolean;
  balanceUGX: number;
  portfolioId?: string;
  portfolioClassification?: string;
  scope?: { kind: 'organisation' | 'branch'; branchId?: string };
};

export function isRegisteredSupplierPortfolio(accountId: string) {
  return /^(bank_[a-f0-9]{64}|custom_[A-Za-z0-9_-]+)$/.test(accountId);
}

export function eligibleSupplierFunding(
  account: SupplierFundingAccount, tenantId: string, portfolio?: Partial<FinancialPortfolio>,
) {
  if (account.tenantId !== tenantId || account.currency !== 'UGX' || account.initialized !== true ||
      (account.status != null && account.status !== 'active') || account.active === false ||
      !Number.isSafeInteger(account.balanceUGX) || account.balanceUGX < 0) return false;

  const { accountId, kind, scope } = account;
  const branchId = scope?.branchId || '';
  const organisation = !branchId && (!scope || scope.kind === 'organisation');
  if (accountId === 'management_bank' || accountId === 'management_petty_cash') {
    return organisation && kind === (accountId === 'management_bank' ? 'bank' : 'petty_cash');
  }
  if (account.portfolioId !== accountId) return false;
  if (['system_mtn_mobile_money', 'system_airtel_mobile_money'].includes(accountId)) {
    return organisation && kind === 'bank' && account.portfolioClassification === 'mobile_money';
  }
  if (scope?.kind === 'branch' && /^[A-Za-z0-9_-]{1,150}$/.test(branchId) && kind === 'petty_cash') {
    if (accountId === 'system_branch_cash_sales_' + branchId) return account.portfolioClassification === 'cash_equivalent';
    if (accountId === 'system_petty_cash_' + branchId) return account.portfolioClassification === 'petty_cash';
  }
  if (!isRegisteredSupplierPortfolio(accountId) || !portfolio || portfolio.tenantId !== tenantId ||
      portfolio.id !== accountId || portfolio.origin !== 'custom' || portfolio.status !== 'active' ||
      portfolio.currency !== 'UGX' || portfolio.classification !== account.portfolioClassification ||
      portfolio.scope?.kind !== scope?.kind || (portfolio.scope?.branchId || '') !== branchId) return false;

  if (accountId.startsWith('bank_')) {
    return organisation && kind === 'bank' && portfolio.classification === 'bank' && portfolio.bankParentId === 'system_bank';
  }
  return portfolio.allowsTransfersOut === true &&
    (['bank', 'mobile_money'].includes(portfolio.classification || '') ? kind === 'bank'
      : ['cash_equivalent', 'petty_cash'].includes(portfolio.classification || '') && kind === 'petty_cash');
}

export function supplierAccountDebit(amountUGX: number, chargeUGX: number) {
  const debit = amountUGX + chargeUGX;
  if (!Number.isSafeInteger(amountUGX) || amountUGX <= 0 ||
      !Number.isSafeInteger(chargeUGX) || chargeUGX < 0 || !Number.isSafeInteger(debit)) {
    throw new Error('Enter a positive supplier amount and a non-negative charge in whole UGX.');
  }
  return debit;
}
