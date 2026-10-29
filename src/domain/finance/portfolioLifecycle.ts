import type {FinancialPortfolio} from './financialPortfolio';
import type {PortfolioChildAccount} from './portfolioAccounts';

export interface LifecycleEvidence {
 ledgerEntryCount:number; transferCount:number; dependentRecordCount:number;
 openingBalanceUGX:number;currentBalanceUGX:number;childMovementCount:number;
}
/** Changes 048-055: fail closed when the existence of money or historical references is unresolved. */
export function assertEvidenceComplete(e:LifecycleEvidence):void {
 for(const [key,value] of Object.entries(e))if(!Number.isSafeInteger(value)||value<0&&key!=='currentBalanceUGX')
  throw new Error('Incomplete or invalid lifecycle evidence: '+key);
}
export function canDeleteUnusedFinancialObject(e:LifecycleEvidence):boolean {
 assertEvidenceComplete(e);
 return Object.values(e).every(value=>value===0);
}
export function canDeactivateFinancialObject(e:LifecycleEvidence):boolean {
 assertEvidenceComplete(e);
 return e.currentBalanceUGX===0;
}
export function deactivatePortfolio(p:FinancialPortfolio, actorId:string, at:string, reason:string, e:LifecycleEvidence):FinancialPortfolio {
 if(!canDeactivateFinancialObject(e))throw new Error('Resolve non-zero balance before deactivation.');
 if(p.status!=='active')throw new Error('Portfolio already inactive.');
 if(!actorId||!reason.trim()||!at)throw new Error('Deactivation audit metadata required.');
 return {...p,status:'inactive',updatedBy:actorId,updatedAt:at,deactivatedBy:actorId,deactivatedAt:at,deactivationReason:reason};
}
export function reactivatePortfolio(p:FinancialPortfolio,actorId:string,at:string):FinancialPortfolio {
 if(p.status!=='inactive')throw new Error('Portfolio already active.');
 if(!actorId||!at)throw new Error('Reactivation audit metadata required.');
 const {deactivatedBy,deactivatedAt,deactivationReason,...rest}=p;
 return {...rest,status:'active',updatedBy:actorId,updatedAt:at};
}
export function deactivateChildAccount(a:PortfolioChildAccount,actorId:string,at:string,e:LifecycleEvidence):PortfolioChildAccount {
 if(!canDeactivateFinancialObject(e))throw new Error('Resolve non-zero account balance before deactivation.');
 if(a.status!=='active'||!actorId||!at)throw new Error('Invalid account deactivation.');
 return {...a,status:'inactive',deactivatedBy:actorId,deactivatedAt:at};
}
export function reactivateChildAccount(a:PortfolioChildAccount):PortfolioChildAccount {
 if(a.status!=='inactive')throw new Error('Account already active.');
 const {deactivatedBy,deactivatedAt,...rest}=a;
 return {...rest,status:'active'};
}
