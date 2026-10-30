import type {FinancialPortfolio,FinancialPortfolioScope} from './financialPortfolio';
export interface PortfolioChildAccount {
 id:string;tenantId:string;portfolioId:string;displayName:string;
 accountReference:string;institution?:string;currency:'UGX';scope:FinancialPortfolioScope;
 status:'active'|'inactive';createdBy:string;createdAt:string;
 deactivatedBy?:string;deactivatedAt?:string;
}
/** Changes 042-047: model-only guards. Persisted account creation requires separate rules approval. */
export function normalizeBankReference(value:string):string {
 return value.replace(/[\s-]/g,'').toUpperCase();
}
export function normalizeBankInstitution(value:string):string {
 return value.trim().replace(/\s+/g,' ').toUpperCase();
}
export function validatePortfolioChildAccount(account:PortfolioChildAccount,portfolio:FinancialPortfolio):PortfolioChildAccount {
 if(!portfolio.supportsChildAccounts)throw new Error('Portfolio does not permit child accounts.');
 if(account.tenantId!==portfolio.tenantId||account.portfolioId!==portfolio.id)throw new Error('Account portfolio scope mismatch.');
 if(!account.id||!account.displayName.trim()||!account.accountReference.trim())throw new Error('Account identity is required.');
 if(account.currency!==portfolio.currency)throw new Error('Account currency mismatch.');
 if(account.scope.kind!==portfolio.scope.kind||
 (account.scope.kind==='branch'&&portfolio.scope.kind==='branch'&&account.scope.branchId!==portfolio.scope.branchId))
  throw new Error('Account branch scope mismatch.');
 if(account.status==='inactive'&&(!account.deactivatedBy||!account.deactivatedAt))throw new Error('Deactivation must be audited.');
 return account;
}
export function assertUniqueBankAccount(candidate:PortfolioChildAccount,existing:readonly PortfolioChildAccount[]):void {
 const number=normalizeBankReference(candidate.accountReference);
 if(existing.some(x=>x.tenantId===candidate.tenantId&&x.portfolioId===candidate.portfolioId&&
 x.id!==candidate.id&&normalizeBankInstitution(x.institution||'')===normalizeBankInstitution(candidate.institution||'')&&normalizeBankReference(x.accountReference)===number))
  throw new Error('Duplicate bank account reference.');
}
