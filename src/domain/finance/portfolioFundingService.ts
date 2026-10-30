import {collection,doc,getDocs,increment,query,runTransaction,Timestamp,where,type Firestore} from 'firebase/firestore';
import {db} from '../../firebase';
import type {FinancialPortfolio,FinancialPortfolioClassification,FinancialPortfolioScope} from './financialPortfolio';
import {portfolioRef} from './portfolioFirestore';
export type PortfolioFundingAccount={
 tenantId:string;accountId:string;portfolioId:string;
 kind:'bank'|'petty_cash';portfolioClassification:FinancialPortfolioClassification;scope:FinancialPortfolioScope;
 name:string;currency:'UGX';initialized:true;
 openingBalanceUGX:number;balanceUGX:number;reconciliationReference:string;
 registeredBy:string;lastPostingId:string|null;controlVersion:1;
};
const validId=/^[a-zA-Z0-9_-]{1,150}$/;
export function fundingDocumentId(tenantId:string,portfolioId:string){
 if(!validId.test(tenantId)||!validId.test(portfolioId))throw new Error('Invalid portfolio funding identity.');
 return tenantId+'_'+portfolioId;
}
export function ledgerCollectionForPortfolioKind(kind:'bank'|'petty_cash'){
 return kind==='bank'?'banking_records':'petty_cash_ledger';
}
/** A funding account is never silently initialized from historical sales or EOD totals. */
export async function registerPortfolioFundingAccount(input:{
 portfolio:FinancialPortfolio;actorId:string;openingBalanceUGX:number;
 reconciliationReference:string
},database:Firestore=db):Promise<PortfolioFundingAccount>{
 const {portfolio,actorId,openingBalanceUGX}=input;
 if(portfolio.status!=='active'||!actorId||!validId.test(actorId))
  throw new Error('Active portfolio and authenticated actor required.');
 if(!Number.isSafeInteger(openingBalanceUGX)||openingBalanceUGX<0)
  throw new Error('Opening balance must be a reconciled nonnegative whole UGX amount.');
 const reference=input.reconciliationReference.trim();
 if(reference.length<5||reference.length>150)throw new Error('A verified opening reconciliation reference is required.');
 if(portfolio.id==='system_bank')throw new Error('Use individual bank accounts; do not duplicate the legacy Management Bank pool.');
 const allowedSystem=portfolio.origin==='system'&&(
  portfolio.id==='system_mtn_mobile_money'||portfolio.id==='system_airtel_mobile_money'
  ||(portfolio.scope.kind==='branch'&&
    (portfolio.id==='system_branch_cash_sales_'+portfolio.scope.branchId
     ||portfolio.id==='system_petty_cash_'+portfolio.scope.branchId)));
 if(!allowedSystem&&portfolio.origin!=='custom')throw new Error('Unrecognized system portfolio.');
 const ref=doc(database,'finance_payment_accounts',fundingDocumentId(portfolio.tenantId,portfolio.id));
 const settingsRef=doc(database,'system_settings',portfolio.tenantId);
 const result:PortfolioFundingAccount={
  tenantId:portfolio.tenantId,accountId:portfolio.id,portfolioId:portfolio.id,kind:portfolio.classification==='bank'||portfolio.classification==='mobile_money'?'bank':'petty_cash',
  portfolioClassification:portfolio.classification,scope:portfolio.scope,name:portfolio.name,currency:'UGX',initialized:true,
  openingBalanceUGX,balanceUGX:openingBalanceUGX,reconciliationReference:reference,
  registeredBy:actorId,lastPostingId:null,controlVersion:1
 };
 await runTransaction(database,async tx=>{
  const [settings,existing,...extra]=await Promise.all([
   tx.get(settingsRef),tx.get(ref),
   ...(portfolio.origin==='custom'?[tx.get(portfolioRef(database,portfolio.tenantId,portfolio.id))]:
    portfolio.scope.kind==='branch'?[tx.get(doc(database,'branches',portfolio.scope.branchId))]:[])
  ]);
  if(!settings.exists()||settings.data().managementCashAccountControlV1!==true)
   throw new Error('Finance account control must be activated before opening a portfolio balance.');
  if(existing.exists())throw new Error('Portfolio funding account already initialized.');
  if(portfolio.origin==='custom'){
   if(!extra[0]?.exists()||extra[0].data()?.tenantId!==portfolio.tenantId
       ||extra[0].data()?.status!=='active'
       ||extra[0].data()?.classification!==portfolio.classification)
    throw new Error('Active registered custom portfolio required.');
  }else if(portfolio.scope.kind==='branch'&&(!extra[0]?.exists()||
    extra[0].data()?.tenantId!==portfolio.tenantId))
    throw new Error('Branch portfolio is outside this tenant.');
  const now=Timestamp.now();
  tx.set(ref,{...result,openingEntryCount:0,registeredAt:now,updatedAt:now});
 });
 return result;
}
export async function listPortfolioFundingAccounts(tenantId:string,database:Firestore=db):Promise<PortfolioFundingAccount[]>{
 if(!validId.test(tenantId))throw new Error('Invalid finance tenant.');
 const snapshot=await getDocs(query(collection(database,'finance_payment_accounts'),where('tenantId','==',tenantId)));
 return snapshot.docs.map(d=>d.data()).filter(d=>d.portfolioId&&d.accountId===d.portfolioId)
  .map(d=>d as PortfolioFundingAccount);
}
/** Account movement, immutable journal and balance increment commit atomically. */
export async function postPortfolioFundingMovement(input:{
 account:PortfolioFundingAccount;actorId:string;requestId:string;
 amountUGX:number;type:'incoming'|'outgoing';externalReference:string;reason:string
},database:Firestore=db):Promise<{ledgerId:string;replayed:boolean}>{
 const {account,actorId,requestId,amountUGX,type}=input;
 if(!Number.isSafeInteger(amountUGX)||amountUGX<=0||!validId.test(actorId)
  ||!validId.test(requestId)||!validId.test(account.accountId))
  throw new Error('Invalid monetary movement or identity.');
 if(input.externalReference.trim().length<5||input.reason.trim().length<5)
  throw new Error('Movement requires verified external reference and purpose.');
 const ledgerId='portfolio_'+account.accountId+'_'+requestId;
 if(ledgerId.length>300)throw new Error('Posting reference too long.');
 const accountRef=doc(database,'finance_payment_accounts',fundingDocumentId(account.tenantId,account.accountId));
 const journalRef=doc(database,ledgerCollectionForPortfolioKind(account.kind),ledgerId);
 return runTransaction(database,async tx=>{
  const [live,existing]=await Promise.all([tx.get(accountRef),tx.get(journalRef)]);
  if(!live.exists()||live.data().tenantId!==account.tenantId||
      live.data().portfolioId!==account.portfolioId||
      live.data().kind!==account.kind||live.data().portfolioClassification!==account.portfolioClassification||live.data().initialized!==true)
    throw new Error('Funding account has changed; refresh before posting.');
  if(existing.exists()){
   const prior=existing.data();
   if(prior.tenantId!==account.tenantId||prior.accountDocumentId!==accountRef.id||
      prior.type!==type||prior.amount!==amountUGX||prior.postedBy!==actorId||
      prior.reference_number!==input.externalReference.trim())
    throw new Error('Posting identity conflicts with another financial movement.');
   return {ledgerId,replayed:true};
  }
  const delta=type==='incoming'?amountUGX:-amountUGX;
  if(!Number.isSafeInteger(live.data().balanceUGX)||live.data().balanceUGX+delta<0)
   throw new Error('Insufficient or unavailable reconciled balance.');
  const now=Timestamp.now();
  tx.set(journalRef,{
   tenantId:account.tenantId,portfolioId:account.portfolioId,
   accountDocumentId:accountRef.id,accountDeltaUGX:delta,
   amount:amountUGX,type,source:'Portfolio reconciled movement',
   reference_number:input.externalReference.trim(),reason:input.reason.trim(),
   postedBy:actorId,date:now.toDate().toISOString().slice(0,10),
   createdAt:now,updatedAt:now
  });
  tx.update(accountRef,{balanceUGX:increment(delta),lastPostingId:ledgerId,updatedAt:now});
  return {ledgerId,replayed:false};
 });
}
