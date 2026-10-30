/**
 * Finance Rebuild Change 032: pure, tenant-scoped financial portfolio contract.
 *
 * This module deliberately contains no Firestore writes, ledger postings, money
 * movement, role policy or migration. Those are separate gated changes.
 */
export const FINANCIAL_PORTFOLIO_CLASSIFICATIONS = [
  'cash_equivalent',
  'bank',
  'mobile_money',
  'petty_cash',
  'restricted_internal_fund',
  'other_financial_asset'
] as const;
export type FinancialPortfolioClassification = typeof FINANCIAL_PORTFOLIO_CLASSIFICATIONS[number];
export type FinancialPortfolioScope =
  | { kind: 'organisation'; branchId?: never }
  | { kind: 'branch'; branchId: string };
export type FinancialPortfolioStatus = 'active' | 'inactive';
export type FinancialPortfolioOrigin = 'system' | 'custom';

export interface FinancialPortfolio {
  id: string;
  tenantId: string;
  name: string;
  classification: FinancialPortfolioClassification;
  description: string;
  scope: FinancialPortfolioScope;
  currency: 'UGX';
  origin: FinancialPortfolioOrigin;
  status: FinancialPortfolioStatus;
  supportsChildAccounts: boolean;
  allowsTransfersIn: boolean;
  allowsTransfersOut: boolean;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  deactivatedBy?: string;
  deactivatedAt?: string;
  deactivationReason?: string;
  bankInstitution?:string;
  bankAccountReference?:string;
  bankParentId?:string;
}

export type NewFinancialPortfolio = Omit<
  FinancialPortfolio,
  'status' | 'updatedBy' | 'updatedAt' | 'deactivatedBy' | 'deactivatedAt' | 'deactivationReason'
>;

const identifier = /^[A-Za-z0-9_-]{1,150}$/;
const isIdentifier = (value:unknown):value is string => typeof value === 'string' && identifier.test(value);
const allowedClassification: ReadonlySet<string> = new Set(FINANCIAL_PORTFOLIO_CLASSIFICATIONS);

function validIsoDate(value: string): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

/** Validate all identity and configuration fields before accepting a portfolio. */
export function validateFinancialPortfolio(portfolio: FinancialPortfolio): FinancialPortfolio {
  if (!portfolio || typeof portfolio !== 'object') throw new Error('A portfolio is required.');
  if (!isIdentifier(portfolio.id) || !isIdentifier(portfolio.tenantId) ||
      !isIdentifier(portfolio.createdBy) || !isIdentifier(portfolio.updatedBy)) {
    throw new Error('Portfolio, tenant and actor identifiers are required.');
  }
  if (typeof portfolio.name !== 'string' || !portfolio.name.trim() ||
      portfolio.name.trim().length > 120) throw new Error('Invalid portfolio name.');
  if (typeof portfolio.description !== 'string' || portfolio.description.length > 1000)
    throw new Error('Invalid portfolio description.');
  if (!allowedClassification.has(portfolio.classification)) throw new Error('Unknown portfolio classification.');
  if (portfolio.currency !== 'UGX') throw new Error('Unsupported portfolio currency.');
  if (portfolio.bankInstitution !== undefined || portfolio.bankAccountReference !== undefined || portfolio.bankParentId !== undefined) {
    if(portfolio.classification!=='bank'||portfolio.origin!=='custom'||portfolio.scope?.kind!=='organisation'
      ||!portfolio.bankInstitution?.trim()||!portfolio.bankAccountReference?.trim()
      ||portfolio.bankParentId!=='system_bank')
      throw new Error('Invalid individual bank account portfolio.');
  }
  if (!['system', 'custom'].includes(portfolio.origin)) throw new Error('Invalid portfolio origin.');
  if (!['active', 'inactive'].includes(portfolio.status)) throw new Error('Invalid portfolio status.');
  if (portfolio.scope?.kind === 'branch') {
    if (!isIdentifier(portfolio.scope.branchId)) throw new Error('Branch portfolio requires a valid branch ID.');
  } else if (portfolio.scope?.kind === 'organisation') {
    if ('branchId' in portfolio.scope) throw new Error('Organisation portfolio cannot have a branch ID.');
  } else throw new Error('Invalid portfolio scope.');
  for (const flag of ['supportsChildAccounts', 'allowsTransfersIn', 'allowsTransfersOut'] as const) {
    if (typeof portfolio[flag] !== 'boolean') throw new Error('Invalid portfolio capability: ' + flag);
  }
  if (!validIsoDate(portfolio.createdAt) || !validIsoDate(portfolio.updatedAt))
    throw new Error('Invalid portfolio timestamps.');
  if (portfolio.status === 'inactive') {
    if (!portfolio.deactivatedBy || !isIdentifier(portfolio.deactivatedBy) ||
        !portfolio.deactivatedAt || !validIsoDate(portfolio.deactivatedAt))
      throw new Error('Inactive portfolio requires deactivation attribution.');
  } else if (portfolio.deactivatedBy || portfolio.deactivatedAt || portfolio.deactivationReason) {
    throw new Error('Active portfolio cannot retain deactivation metadata.');
  }
  return portfolio;
}

/** Deterministic pure constructor; caller supplies a reserved tenant-unique ID. */
export function defineFinancialPortfolio(input: NewFinancialPortfolio): FinancialPortfolio {
  return validateFinancialPortfolio({
    ...input,
    name: input.name.trim(),
    status: 'active',
    updatedBy: input.createdBy,
    updatedAt: input.createdAt
  });
}

/** Used by future account/ledger/transfer services to reject scope mismatches. */
export function portfolioMatchesScope(portfolio: FinancialPortfolio, tenantId: string, branchId?: string): boolean {
  return portfolio.tenantId === tenantId &&
    (portfolio.scope.kind === 'organisation' || portfolio.scope.branchId === branchId);
}
