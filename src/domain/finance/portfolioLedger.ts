import type {FinancialPortfolio} from './financialPortfolio';
export type LedgerDirection='inflow'|'outflow';
export interface FinancialLedgerEntry {
 id:string;tenantId:string;portfolioId:string;accountId?:string;
 businessDate:string;occurredAt:string;reference:string;description:string;
 source:string;direction:LedgerDirection;amountUGX:number;actorId:string;
 status:'posted'|'reversed';linkedRecordId?:string;
}
/** Changes 037-041: presentation-only ledger view, no posting or balances invented. */
export interface FinancialLedgerQuery {from:string;to:string;direction:'all'|LedgerDirection}
export function defaultLedgerQuery(today:string):FinancialLedgerQuery {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Number.isFinite(Date.parse(today+'T00:00:00Z')))
  throw new Error('Invalid business date.');
 const date=new Date(today+'T00:00:00Z');
 date.setUTCDate(date.getUTCDate()-2);
 return {from:date.toISOString().slice(0,10),to:today,direction:'all'};
}
export function filterFinancialLedger(entries:readonly FinancialLedgerEntry[],portfolio:FinancialPortfolio,filter:FinancialLedgerQuery):FinancialLedgerEntry[]{
 if(filter.from>filter.to)throw new Error('Invalid ledger period.');
 return entries.filter(x=>x.tenantId===portfolio.tenantId&&x.portfolioId===portfolio.id&&
 x.businessDate>=filter.from&&x.businessDate<=filter.to&&
 (filter.direction==='all'||x.direction===filter.direction))
 .sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id));
}
export function consolidatedAccountBalance(balances:readonly {accountId:string;portfolioId:string;tenantId:string;balanceUGX:number}[],portfolio:FinancialPortfolio):number {
 const matched=balances.filter(x=>x.tenantId===portfolio.tenantId&&x.portfolioId===portfolio.id);
 if(matched.some(x=>!Number.isSafeInteger(x.balanceUGX)))throw new Error('Invalid account balance.');
 const ids=new Set(matched.map(x=>x.accountId));
 if(ids.size!==matched.length)throw new Error('Duplicate financial account.');
 const sum=matched.reduce((s,x)=>s+x.balanceUGX,0);
 if(!Number.isSafeInteger(sum))throw new Error('Balance overflow.');
 return sum;
}

/**
 * Validated projection over an authoritative, complete posting history.
 * Reversals are represented only by their own compensating entries; a reversed
 * marker on an original entry is NOT a second debit/credit.
 * Never use the filtered 3-day view to derive an opening or current balance.
 */
export function projectLedgerWithRunningBalances(
 entries:readonly FinancialLedgerEntry[],openingBalanceUGX:number
):Array<FinancialLedgerEntry&{runningBalanceUGX:number}>{
 if(!Number.isSafeInteger(openingBalanceUGX))
  throw new Error('Unverified ledger opening balance.');
 const seen=new Set<string>();
 let balance=openingBalanceUGX;
 return [...entries].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id))
 .map(entry=>{
  if(!entry.id||seen.has(entry.id)||!Number.isSafeInteger(entry.amountUGX)||entry.amountUGX<=0
     ||!['inflow','outflow'].includes(entry.direction)||!['posted','reversed'].includes(entry.status))
   throw new Error('Invalid or duplicate ledger posting.');
  seen.add(entry.id);
  if(entry.status==='posted'){
   balance+=entry.direction==='inflow'?entry.amountUGX:-entry.amountUGX;
   if(!Number.isSafeInteger(balance))throw new Error('Ledger balance overflow.');
  }
  return {...entry,runningBalanceUGX:balance};
 });
}
/** Consolidate independent child account balances without fabricating a zero. */
export function assertPortfolioAccountCoverage(
 expectedAccountIds:readonly string[],
 balances:readonly {accountId:string;portfolioId:string;tenantId:string;balanceUGX:number}[],
 portfolio:FinancialPortfolio
):number{
 const expected=new Set(expectedAccountIds);
 if(expected.size!==expectedAccountIds.length)throw new Error('Duplicate expected account identity.');
 const relevant=balances.filter(x=>x.portfolioId===portfolio.id&&x.tenantId===portfolio.tenantId);
 if(relevant.length!==expected.size||relevant.some(x=>!expected.has(x.accountId)))
  throw new Error('Portfolio balance is unavailable: child account coverage incomplete.');
 return consolidatedAccountBalance(relevant,portfolio);
}
