import {collection, doc, getDocs, query, where, runTransaction, serverTimestamp, type Firestore} from 'firebase/firestore';
import {db} from '../../firebase';
import {defineFinancialPortfolio,validateFinancialPortfolio,type FinancialPortfolio,type NewFinancialPortfolio} from './financialPortfolio';
import {validatePortfolioChildAccount,bankAccountIdentity,type PortfolioChildAccount} from './portfolioAccounts';

const portfolios='finance_portfolios_v1';
const accounts='finance_portfolio_accounts_v1';
export const portfolioRef=(database:Firestore,tenantId:string,id:string)=>doc(database,portfolios,tenantId+'__'+id);
export const accountRef=(database:Firestore,tenantId:string,id:string)=>doc(database,accounts,tenantId+'__'+id);
export async function listFinancialPortfolios(
 tenantId:string,branchId?:string,database:Firestore=db
):Promise<FinancialPortfolio[]>{
 const base=collection(database,portfolios);
 const requests=[getDocs(query(base,where('tenantId','==',tenantId),where('scope.kind','==','organisation')))];
 if(branchId)requests.push(getDocs(query(base,where('tenantId','==',tenantId),where('scope.kind','==','branch'),where('scope.branchId','==',branchId))));
 const snapshots=await Promise.all(requests);
 const seen=new Set<string>();
 const result:FinancialPortfolio[]=[];
 for(const snapshot of snapshots)for(const d of snapshot.docs){
   const p=validateFinancialPortfolio(d.data() as FinancialPortfolio);
   if(seen.has(p.id))throw new Error('Duplicate portfolio registry identity.');
   seen.add(p.id);result.push(p);
 }
 return result;
}
export async function listPortfolioAccounts(
 tenantId:string,branchId?:string,database:Firestore=db
):Promise<PortfolioChildAccount[]>{
 const base=collection(database,accounts);
 const requests=[getDocs(query(base,where('tenantId','==',tenantId),where('scope.kind','==','organisation')))];
 if(branchId)requests.push(getDocs(query(base,where('tenantId','==',tenantId),where('scope.kind','==','branch'),where('scope.branchId','==',branchId))));
 const snapshots=await Promise.all(requests);
 return snapshots.flatMap(snapshot=>snapshot.docs.map(d=>d.data() as PortfolioChildAccount));
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
export async function createPortfolioBankAccount(
  input:Omit<PortfolioChildAccount,'id'>,database:Firestore=db
):Promise<PortfolioChildAccount>{
  if(input.status!=='active')throw new Error('Only active accounts can be created.');
  if(!input.institution?.trim())throw new Error('Bank institution required.');
  const id=await bankAccountIdentity(input.tenantId,input.portfolioId,input.institution,input.accountReference);
  const value:PortfolioChildAccount={...input,id};
  const portfolio=portfolioRef(database,input.tenantId,input.portfolioId);
  const account=accountRef(database,input.tenantId,id);
  await runTransaction(database,async tx=>{
    const [p,a]=await Promise.all([tx.get(portfolio),tx.get(account)]);
    if(!p.exists()||p.data().status!=='active')throw new Error('Active parent portfolio required.');
    validatePortfolioChildAccount(value,p.data() as FinancialPortfolio);
    if(a.exists())throw new Error('Bank account already exists.');
    tx.set(account,{...value,balanceUGX:0,openingBalanceUGX:0,initialized:false});
  });
  return value;
}
