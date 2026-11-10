import {MANAGEMENT_CASH_ACCOUNT,type ManagementPaymentAccount} from '../../services/managementCashPosting';
import type {FinancialPortfolio} from './financialPortfolio';
import {defineBuiltInPortfolio} from './builtInPortfolios';
import {projectPortfolioBalances} from './portfolioWideView';

export const DEFAULT_TREASURY_PORTFOLIOS = [
 {id:'cash',name:'Branch Cash Sales',context:'Reconciled collections across branches'},
 {id:'airtel',name:'Airtel Money',context:'Authoritative Airtel wallet'},
 {id:'mtn',name:'MTN Money',context:'Authoritative MTN wallet'},
 {id:'bank',name:'Bank',context:'Consolidated registered bank accounts'},
 {id:'credit',name:'Credit Receivables',context:'Outstanding credit, excluded from liquid cash'},
 {id:'petty',name:'Petty Cash',context:'Management Petty Cash Ledger'},
 {id:'welfare',name:'Staff Welfare Fund',context:'Restricted staff welfare records'}
] as const;
export type TreasuryCategory = typeof DEFAULT_TREASURY_PORTFOLIOS[number]['id'];
export type TreasuryPosition = {id:string;name:string;context:string;balanceUGX:number|null;reason:string;accounts:ManagementPaymentAccount[]};
export function treasuryPositions(input:{tenantId:string;branches:readonly {id:string}[];portfolios:readonly FinancialPortfolio[];accounts:readonly ManagementPaymentAccount[]}):TreasuryPosition[]{
 const {tenantId,branches}=input;
 if(!tenantId)throw new Error('Tenant required for treasury positions.');
 const accounts=input.accounts.filter(a=>a.tenantId===tenantId);
 const portfolios=input.portfolios.filter(p=>p.tenantId===tenantId);
 if(new Set(accounts.map(a=>a.accountId)).size!==accounts.length)throw new Error('Duplicate authoritative account identity.');
 const bank=defineBuiltInPortfolio({tenantId,key:'bank',createdBy:'treasury_view',createdAt:'2026-01-01T00:00:00Z'});
 const bankView=projectPortfolioBalances([bank,...portfolios.filter(p=>p.id!=='system_bank')],accounts).find(p=>p.portfolioId==='system_bank')!;
 const verified=(a:ManagementPaymentAccount)=>a.initialized===true&&a.currency==='UGX'&&Number.isSafeInteger(a.balanceUGX)&&Number.isSafeInteger(a.openingBalanceUGX)&&!!a.reconciliationReference;
 const cashIds=branches.map(b=>'system_branch_cash_sales_'+b.id);
 const bankIds=new Set(['management_bank',...portfolios.filter(p=>p.bankParentId==='system_bank').map(p=>p.id)]);
 return DEFAULT_TREASURY_PORTFOLIOS.map(p=>{
  const ids=p.id==='cash'?cashIds:p.id==='petty'?[MANAGEMENT_CASH_ACCOUNT]:p.id==='bank'?[...bankIds]:p.id==='mtn'?['system_mtn_mobile_money']:p.id==='airtel'?['system_airtel_mobile_money']:[];
  const matched=accounts.filter(a=>ids.includes(a.accountId));
  let reason=p.id==='credit'?'Outstanding receivables are shown separately.':p.id==='welfare'?'A spendable welfare reserve has not been established.':p.id==='bank'?bankView.reason||'':
   !ids.length?'Branch coverage is unavailable.':ids.some(id=>!matched.some(a=>a.accountId===id))?p.id==='petty'?'Reconcile the Management Petty Cash opening balance.':'Open this portfolio and reconcile each missing account opening balance.':'';
  if(matched.some(a=>!verified(a)))reason='An account requires a verified opening reconciliation.';
  if(matched.some(a=>a.kind!==(['cash','petty'].includes(p.id)?'petty_cash':'bank')))reason='Account classification requires reconciliation.';
  if(p.id==='bank'&&bankView.balanceUGX===null&&!reason)reason='Consolidated bank balance is unavailable.';
  const total=matched.reduce((sum,a)=>sum+a.balanceUGX,0);
  if(!Number.isSafeInteger(total))reason='Invalid consolidated balance.';
  return {...p,accounts:matched,reason,balanceUGX:reason||['credit','welfare'].includes(p.id)?null:p.id==='bank'?bankView.balanceUGX:total};
 });
}
/** Only verified, disjoint liquid categories enter this subtotal. Credit and welfare never do. */
export function verifiedLiquidPosition(positions:readonly TreasuryPosition[]){
 const liquid=positions.filter(p=>['cash','airtel','mtn','bank','petty'].includes(p.id));
 const available=liquid.filter(p=>p.balanceUGX!==null);
 const balanceUGX=available.reduce((sum,p)=>sum+p.balanceUGX!,0);
 if(!Number.isSafeInteger(balanceUGX))throw new Error('Liquid cash total overflow.');
 return {balanceUGX,verifiedCount:available.length,totalCount:liquid.length,complete:available.length===5};
}
