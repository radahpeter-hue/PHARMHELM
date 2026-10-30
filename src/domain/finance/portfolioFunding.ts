import {collection,doc,getDocs,query,where,runTransaction,Timestamp,type Firestore} from 'firebase/firestore';
import {db} from '../../firebase';
import type {FinancialPortfolio} from './financialPortfolio';
import type {ManagementPaymentAccount} from '../../services/managementCashPosting';
import {managementAccountDocumentId,stageManagementCashEntry} from '../../services/managementCashPosting';

export type PortfolioFundingAccount = ManagementPaymentAccount & {
 portfolioId:string;portfolioClassification:string;
 scope:{kind:'organisation'}|{kind:'branch';branchId:string};
};

/** A ledger is funded ONLY when the CEO has reconciled the opening statement. */
export async function registerPortfolioFunding(input:{
 portfolio:FinancialPortfolio;actorId:string;name:string;
 openingBalanceUGX:number;reconciliationReference:string
},database:Firestore=db):Promise<PortfolioFundingAccount>{
 const {portfolio:p,actorId,name,openingBalanceUGX,reconciliationReference}=input;
 if(p.status!=='active'||p.tenantId.length===0||!actorId||!name.trim()||
   !Number.isSafeInteger(openingBalanceUGX)||openingBalanceUGX<0||
   reconciliationReference.trim().length<5)
  throw new Error('Active portfolio and verified opening reconciliation required.');
 if(p.id==='system_bank' || (p.classification==='bank' && p.bankParentId!=='system_bank'))
  throw new Error('The parent Bank is not a payment account. Select an individual registered bank.');
 if(p.classification==='bank'&&(!p.bankInstitution||!p.bankAccountReference))
  throw new Error('Unverified bank identity.');
 const accountId=p.id;
 const kind:'bank'|'petty_cash'=['bank','mobile_money'].includes(p.classification)?'bank':'petty_cash';
 const account:PortfolioFundingAccount={
  id:managementAccountDocumentId(p.tenantId,accountId),tenantId:p.tenantId,accountId,
  portfolioId:p.id,portfolioClassification:p.classification,
  scope:p.scope,name:name.trim(),kind,currency:'UGX',initialized:true,
  balanceUGX:openingBalanceUGX,openingBalanceUGX,
  reconciliationReference:reconciliationReference.trim()
 };
 const ref=doc(database,'finance_payment_accounts',account.id);
 const settings=doc(database,'system_settings',p.tenantId);
 await runTransaction(database,async tx=>{
  const [setting,existing]=await Promise.all([tx.get(settings),tx.get(ref)]);
  if(!setting.exists()||setting.data().managementCashAccountControlV1!==true)
   throw new Error('Account control not activated.');
  if(existing.exists())throw new Error('Funding already registered. Reconcile, do not reset an existing balance.');
  const now=Timestamp.now();
  tx.set(ref,{...account,registeredBy:actorId,registeredAt:now,updatedAt:now,
   lastPostingId:null,controlVersion:1});
 });
 return account;
}
/** Stable reference key prevents double-posting when operators repeat a request. */
export async function portfolioPostingIdentity(
 tenantId:string,accountId:string,direction:'inflow'|'outflow',reference:string
):Promise<string>{
 const value=[tenantId,accountId,direction,reference.trim().toUpperCase()].join('|');
 if(!tenantId||!accountId||reference.trim().length<3||!globalThis.crypto?.subtle)
  throw new Error('Secure posting identity and external reference required.');
 const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return 'finance_'+Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
/** Existing same-transaction balance and ledger rules provide posting uniqueness.
 * Each request ID is immutable; no unscoped synthetic balance is ever written.
 */
export async function postPortfolioFundingMovement(input:{
 account:PortfolioFundingAccount;actorId:string;amountUGX:number;direction:'inflow'|'outflow';
 requestId:string;reference:string
},database:Firestore=db):Promise<void>{
 const {account:a,actorId,amountUGX,requestId,reference,direction}=input;
 if(!actorId||!a.initialized||!Number.isSafeInteger(amountUGX)||amountUGX<=0||
   !/^[A-Za-z0-9_-]{8,150}$/.test(requestId)||reference.trim().length<3)
  throw new Error('Invalid ledger posting evidence.');
 if(!globalThis.crypto?.subtle)throw new Error('Secure financial posting cryptography required.');
 const seed=new TextEncoder().encode([a.tenantId,a.accountId,reference.trim().toUpperCase()].join('|'));
 const hash=await crypto.subtle.digest('SHA-256',seed);
 const ledgerId='pf_'+Array.from(new Uint8Array(hash)).map(v=>v.toString(16).padStart(2,'0')).join('');
 const ledgerPath=a.kind==='bank'?'banking_records':'petty_cash_ledger';
 const ledgerRef=doc(database,ledgerPath,ledgerId);
 await runTransaction(database,async tx=>{
  const prior=await tx.get(ledgerRef);
  if(prior.exists()){
   if(prior.data().tenantId!==a.tenantId||prior.data().accountDocumentId!==a.id||
      prior.data().amount!==amountUGX||prior.data().postedBy!==actorId||
      prior.data().type!==(direction==='inflow'?'incoming':'outgoing')||prior.data().reference_number!==reference.trim())
    throw new Error('Posting reference conflict.');
   return;
  }
  stageManagementCashEntry(tx,ledgerId,{
   tenantId:a.tenantId,amount:amountUGX,type:direction==='inflow'?'incoming':'outgoing',
   source:'Verified portfolio movement',reference_number:reference.trim()
  },database,a.accountId,actorId);
 });
}
export async function listPortfolioFundingAccounts(tenantId:string,database:Firestore=db):Promise<PortfolioFundingAccount[]>{
 const result=await getDocs(query(collection(database,'finance_payment_accounts'),where('tenantId','==',tenantId)));
 return result.docs.filter(x=>x.data().portfolioId).map(x=>({...x.data(),id:x.id}) as PortfolioFundingAccount);
}
