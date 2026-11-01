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

/** Two-sided transfer: both ledgers and both balances commit in one transaction.
 * A repeated external transfer reference is a replay, never a second movement.
 */
export async function transferPortfolioFunding(input:{
 from:ManagementPaymentAccount;to:ManagementPaymentAccount;actorId:string;
 amountUGX:number;externalReference:string
},database:Firestore=db):Promise<{replayed:boolean}>{
 const {from,to,actorId,amountUGX,externalReference}=input;
 if(from.tenantId!==to.tenantId||from.accountId===to.accountId
   ||!from.initialized||!to.initialized||!actorId||!Number.isSafeInteger(amountUGX)
   ||amountUGX<=0||externalReference.trim().length<5)
  throw new Error('Invalid or cross-tenant portfolio transfer.');
 const external=externalReference.trim();
 if(!globalThis.crypto?.subtle)throw new Error('Secure transfer identity unavailable.');
 const seed=new TextEncoder().encode([from.tenantId,from.accountId,to.accountId,external.toUpperCase()].join('|'));
 const hash=await crypto.subtle.digest('SHA-256',seed);
 const token=Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('');
 const debitId='pf_d_'+token,creditId='pf_c_'+token;
 const debitCol=from.kind==='bank'?'banking_records':'petty_cash_ledger';
 const creditCol=to.kind==='bank'?'banking_records':'petty_cash_ledger';
 const source=doc(database,'finance_payment_accounts',managementAccountDocumentId(from.tenantId,from.accountId));
 const destination=doc(database,'finance_payment_accounts',managementAccountDocumentId(to.tenantId,to.accountId));
 const debit=doc(database,debitCol,debitId),credit=doc(database,creditCol,creditId);
 return runTransaction(database,async tx=>{
  const [src,dst,d,c]=await Promise.all([tx.get(source),tx.get(destination),tx.get(debit),tx.get(credit)]);
  if(d.exists()||c.exists()){
   if(d.exists()&&c.exists()&&d.data().tenantId===from.tenantId
     &&d.data().accountDocumentId===source.id&&c.data().accountDocumentId===destination.id
     &&d.data().amount===amountUGX&&c.data().amount===amountUGX
     &&d.data().postedBy===actorId&&c.data().postedBy===actorId
     &&d.data().reference_number===external&&c.data().reference_number===external)
    return {replayed:true};
   throw new Error('Transfer reference conflict or incomplete paired posting.');
  }
  if(!src.exists()||!dst.exists()||src.data().tenantId!==from.tenantId
    ||dst.data().tenantId!==to.tenantId||src.data().accountId!==from.accountId
    ||dst.data().accountId!==to.accountId||src.data().kind!==from.kind
    ||dst.data().kind!==to.kind||src.data().initialized!==true
    ||dst.data().initialized!==true||src.data().currency!=='UGX'||dst.data().currency!=='UGX')
   throw new Error('Transfer account identity or reconciliation changed.');
  if(!Number.isSafeInteger(src.data().balanceUGX)||src.data().balanceUGX<amountUGX
    ||!Number.isSafeInteger(dst.data().balanceUGX)
    ||!Number.isSafeInteger(dst.data().balanceUGX+amountUGX))
   throw new Error('Insufficient funds or balance overflow.');
  stageManagementCashEntry(tx,debitId,{
   tenantId:from.tenantId,amount:amountUGX,type:'outgoing',
   source:'Portfolio transfer debit',reference_number:external,linkedMovementId:creditId,
   transferCounterparty:destination.id
  },database,from.accountId,actorId);
  stageManagementCashEntry(tx,creditId,{
   tenantId:to.tenantId,amount:amountUGX,type:'incoming',
   source:'Portfolio transfer credit',reference_number:external,linkedMovementId:debitId,
   transferCounterparty:source.id
  },database,to.accountId,actorId);
  return {replayed:false};
 });
}
