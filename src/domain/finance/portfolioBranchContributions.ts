import type {FinancialLedgerEntry} from './portfolioLedger';
export interface BranchContribution {
 branchId:string;inflowUGX:number;outflowUGX:number;netUGX:number;movementCount:number;
}
/** Reporting only: tagged ledger movements, never bank account balances. */
export function summarizeBranchContributions(entries:readonly FinancialLedgerEntry[]):{
 branches:BranchContribution[];unattributedUGX:number;attributedInflowUGX:number;
}{
 const groups=new Map<string,BranchContribution>();
 let unattributedUGX=0;
 for(const entry of entries){
  if(entry.status!=='posted'||!Number.isSafeInteger(entry.amountUGX)||entry.amountUGX<=0)
   throw new Error('Invalid posted movement in branch contribution report.');
  if(!entry.branchId){
   if(entry.direction==='inflow')unattributedUGX+=entry.amountUGX;
   continue;
  }
  const current=groups.get(entry.branchId)||{branchId:entry.branchId,inflowUGX:0,outflowUGX:0,netUGX:0,movementCount:0};
  if(entry.direction==='inflow')current.inflowUGX+=entry.amountUGX;
  else if(entry.direction==='outflow')current.outflowUGX+=entry.amountUGX;
  else throw new Error('Invalid movement direction.');
  current.netUGX=current.inflowUGX-current.outflowUGX;
  current.movementCount++;
  if(![current.inflowUGX,current.outflowUGX,current.netUGX].every(Number.isSafeInteger))
   throw new Error('Branch movement total overflow.');
  groups.set(entry.branchId,current);
 }
 if(!Number.isSafeInteger(unattributedUGX))throw new Error('Unattributed movement total overflow.');
 const branches=[...groups.values()].sort((a,b)=>b.inflowUGX-a.inflowUGX||a.branchId.localeCompare(b.branchId));
 const attributedInflowUGX=branches.reduce((total,x)=>total+x.inflowUGX,0);
 if(!Number.isSafeInteger(attributedInflowUGX))throw new Error('Attributed movement total overflow.');
 return {branches,attributedInflowUGX,unattributedUGX};
}
