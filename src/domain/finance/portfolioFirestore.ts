import {collection, doc, getDocs, query, where, runTransaction, serverTimestamp, type Firestore} from 'firebase/firestore';
import {db} from '../../firebase';
import {defineFinancialPortfolio,validateFinancialPortfolio,type FinancialPortfolio,type NewFinancialPortfolio} from './financialPortfolio';
import {validatePortfolioChildAccount,normalizeBankReference,type PortfolioChildAccount} from './portfolioAccounts';

const portfolios='finance_portfolios_v1';
const accounts='finance_portfolio_accounts_v1';
export const portfolioRef=(database:Firestore,tenantId:string,id:string)=>doc(database,portfolios,tenantId+'__'+id);
export const accountRef=(database:Firestore,tenantId:string,id:string)=>doc(database,accounts,tenantId+'__'+id);
export async function listFinancialPortfolios(tenantId:string,database:Firestore=db):Promise<FinancialPortfolio[]>{
 const snapshot=await getDocs(query(collection(database,portfolios),where('tenantId','==',tenantId),where('scope.kind','==','organisation')));
 return snapshot.docs.map(d=>validateFinancialPortfolio(d.data() as FinancialPortfolio));
}
export async function listPortfolioAccounts(tenantId:string,database:Firestore=db):Promise<PortfolioChildAccount[]>{
 const snapshot=await getDocs(query(collection(database,accounts),where('tenantId','==',tenantId)));
 return snapshot.docs.map(d=>d.data() as PortfolioChildAccount);
}
/** CEO authorization is independently mandatory in firestore.rules. */
export async function createCustomFinancialPortfolio(input:NewFinancialPortfolio,database:Firestore=db){
 if(input.origin!=='custom')throw new Error('Custom portfolio origin required.');
 const value=defineFinancialPortfolio(input);
 await runTransaction(database,async transaction=>{
  const ref=portfolioRef(database,value.tenantId,value.id);
  if((await transaction.get(ref)).exists())throw new Error('Portfolio identity already exists.');
  transaction.set(ref,value);
 });
 return value;
}
export async function createPortfolioBankAccount(input:PortfolioChildAccount,database:Firestore=db){
 if(input.status!=='active')throw new Error('Only active accounts can be created.');
 if(!input.accountReference.trim())throw new Error('Bank account reference required.');
 const portfolio=portfolioRef(database,input.tenantId,input.portfolioId);
 // Deterministic reservation prohibits duplicates across concurrent requests.
 const reservationId=input.tenantId+'__'+input.portfolioId+'__'+normalizeBankReference(input.accountReference);
 const reservation=doc(database,'finance_account_identity_v1',reservationId);
 const account=accountRef(database,input.tenantId,input.id);
 await runTransaction(database,async tx=>{
  const [p,a,res]=await Promise.all([tx.get(portfolio),tx.get(account),tx.get(reservation)]);
  if(!p.exists()||p.data().status!=='active')throw new Error('Active parent portfolio required.');
  validatePortfolioChildAccount(input,p.data() as FinancialPortfolio);
  if(a.exists()||res.exists())throw new Error('Account identity or reference already in use.');
  tx.set(reservation,{tenantId:input.tenantId,portfolioId:input.portfolioId,accountId:input.id,accountReferenceNormalized:normalizeBankReference(input.accountReference),createdBy:input.createdBy});
  tx.set(account,{...input,balanceUGX:0,openingBalanceUGX:0,initialized:false});
 });
}
