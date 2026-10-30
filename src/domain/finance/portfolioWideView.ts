import type {FinancialPortfolio} from './financialPortfolio';
import type {ManagementPaymentAccount} from '../../services/managementCashPosting';
import {MANAGEMENT_BANK_ACCOUNT,MANAGEMENT_CASH_ACCOUNT} from '../../services/managementCashPosting';
import type {AuthoritativePortfolioLedger} from './authoritativePortfolioLedger';

/** Strict portfolio-wide read model. Unmapped funds must remain unavailable, never zero. */
export type PortfolioBalanceView={
 portfolioId:string;tenantId:string;status:'reconciled'|'unavailable';
 balanceUGX:number|null;source:string|null;reason?:string;
};
export function projectPortfolioBalances(
 portfolios:readonly FinancialPortfolio[],managementAccounts:readonly ManagementPaymentAccount[]
):PortfolioBalanceView[]{
 const seen=new Set<string>();
 return portfolios.map(portfolio=>{
  const identity=portfolio.tenantId+'|'+portfolio.id;
  if(seen.has(identity))throw new Error('Duplicate portfolio identity.');
  seen.add(identity);
  // Never publish a parent-bank total as complete while separately registered
  // bank identities have no certified mapping to individual authoritative accounts.
  if(portfolio.id==='system_bank'&&portfolios.some(other=>other.tenantId===portfolio.tenantId&&
    other.bankParentId==='system_bank'&&other.origin==='custom'))
   return {portfolioId:portfolio.id,tenantId:portfolio.tenantId,status:'unavailable' as const,
    balanceUGX:null,source:null,reason:'Unmapped bank child accounts prevent safe consolidation'};
  const accountId=portfolio.id==='system_bank'?MANAGEMENT_BANK_ACCOUNT:
   portfolio.id.startsWith('system_petty_cash_')?MANAGEMENT_CASH_ACCOUNT:null;
  // Branch petty cash cannot be inferred from the tenant-wide Management cash account.
  const scopedAccountId=portfolio.scope.kind==='organisation'?accountId:null;
  const candidates=managementAccounts.filter(account=>account.tenantId===portfolio.tenantId&&account.accountId===scopedAccountId);
  if(candidates.length>1)throw new Error('Duplicate authoritative funding account.');
  const account=candidates[0];
  if(!account||!account.initialized||account.currency!=='UGX'||!Number.isSafeInteger(account.balanceUGX))
   return {portfolioId:portfolio.id,tenantId:portfolio.tenantId,status:'unavailable' as const,balanceUGX:null,source:null,reason:'No reconciled authoritative account mapping'};
  return {portfolioId:portfolio.id,tenantId:portfolio.tenantId,status:'reconciled' as const,
   balanceUGX:account.balanceUGX,source:'finance_payment_accounts'};
 });
}
/** A bank identity is not a funding account until a verified mapping exists. */
export function assertAuthoritativeLedgerCoverage(
 ledger:AuthoritativePortfolioLedger,portfolio:FinancialPortfolio
):void{
 if(ledger.account.tenantId!==portfolio.tenantId)throw new Error('Cross-tenant ledger mapping.');
 if(portfolio.id==='system_bank'){
  if(ledger.account.accountId!==MANAGEMENT_BANK_ACCOUNT)throw new Error('Bank ledger mismatch.');
  return;
 }
 throw new Error('Portfolio has no certified authoritative posting integration.');
}
