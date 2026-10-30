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
  const accountId=portfolio.id==='system_bank'?MANAGEMENT_BANK_ACCOUNT:portfolio.id;
  const candidates=managementAccounts.filter(account=>account.tenantId===portfolio.tenantId&&account.accountId===accountId);
  if(candidates.length>1)throw new Error('Duplicate authoritative funding account.');
  const account=candidates[0];
  if(!account||!account.initialized||account.currency!=='UGX'||!Number.isSafeInteger(account.balanceUGX)||!account.reconciliationReference)
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
 if(portfolio.id==='system_bank' ? ledger.account.accountId===MANAGEMENT_BANK_ACCOUNT : ledger.account.accountId===portfolio.id)return;
 throw new Error('Portfolio has no certified authoritative posting integration.');
}

/** Tenant-wide Management Cash is a distinct portfolio and must never be
 * inferred from branch Petty Cash, POS cash or EOD reconciliations. */
export function projectManagementCashBalance(accounts:readonly ManagementPaymentAccount[],tenantId:string):PortfolioBalanceView{
 const candidates=accounts.filter(x=>x.tenantId===tenantId&&x.accountId===MANAGEMENT_CASH_ACCOUNT);
 if(candidates.length>1)throw new Error('Duplicate Management Cash account.');
 const account=candidates[0];
 if(!account||account.kind!=='petty_cash'||account.currency!=='UGX'||!account.initialized
   ||!Number.isSafeInteger(account.balanceUGX)||!account.reconciliationReference)
  return {portfolioId:'management_petty_cash',tenantId,status:'unavailable',balanceUGX:null,source:null};
 return {portfolioId:'management_petty_cash',tenantId,status:'reconciled',balanceUGX:account.balanceUGX,source:'finance_payment_accounts'};
}
