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
