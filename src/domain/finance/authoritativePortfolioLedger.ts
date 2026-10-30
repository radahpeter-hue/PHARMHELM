import {collection,getDocs,query,where,type Firestore} from 'firebase/firestore';
import {db} from '../../firebase';
import type {ManagementPaymentAccount} from '../../services/managementCashPosting';
import {MANAGEMENT_BANK_ACCOUNT,MANAGEMENT_CASH_ACCOUNT,managementAccountDocumentId} from '../../services/managementCashPosting';
import type {FinancialLedgerEntry,FinancialLedgerQuery} from './portfolioLedger';

/** Read-only views of ledger entries already committed atomically with the account balance. */
export interface AuthoritativePortfolioLedger {
  account:ManagementPaymentAccount;
  entries:FinancialLedgerEntry[];
  currentBalanceUGX:number;
  openingBalanceUGX:number;
  reconciliationReference:string;
}
export function managementLedgerCollection(account:ManagementPaymentAccount):string {
 if(account.kind==='bank' && (account.accountId===MANAGEMENT_BANK_ACCOUNT||account.portfolioId))return 'banking_records';
 if(account.kind==='petty_cash' && (account.accountId===MANAGEMENT_CASH_ACCOUNT||account.portfolioId))return 'petty_cash_ledger';
 throw new Error('No authoritative posting ledger for this account.');
}
function isoDate(value:unknown):string {
 if(typeof value==='string'){
  const d=value.slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d;
 }
 if(value&&typeof value==='object'&&'toDate' in value&&typeof value.toDate==='function')
  return value.toDate().toISOString().slice(0,10);
 throw new Error('Posted ledger entry is missing its business date.');
}
export function mapAuthoritativeMovement(id:string,raw:Record<string,unknown>,account:ManagementPaymentAccount):FinancialLedgerEntry{
 if(raw.tenantId!==account.tenantId || raw.accountDocumentId!==managementAccountDocumentId(account.tenantId,account.accountId))
  throw new Error('Ledger record does not belong to the selected account.');
 const delta=raw.accountDeltaUGX;
 if(typeof delta!=='number'||!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)!==raw.amount)
  throw new Error('Unverified authoritative account movement.');
 const businessDate=isoDate(raw.date||raw.createdAt);
 const stamp=raw.createdAt;
 const occurredAt=stamp&&typeof stamp==='object'&&'toDate' in stamp&&typeof stamp.toDate==='function'
  ?stamp.toDate().toISOString():businessDate+'T00:00:00.000Z';
 return {id,tenantId:account.tenantId,portfolioId:account.accountId,accountId:account.accountId,
  businessDate,occurredAt,reference:String(raw.reference_number||raw.transferId||id),
  description:String(raw.source||raw.type||'Posted management transaction'),
  source:managementLedgerCollection(account),direction:delta>0?'inflow':'outflow',
  amountUGX:Math.abs(delta),actorId:String(raw.postedBy||''),status:'posted'};
}
export async function loadAuthoritativePortfolioLedger(
 account:ManagementPaymentAccount,period:FinancialLedgerQuery,database:Firestore=db
):Promise<AuthoritativePortfolioLedger>{
 if(!account.initialized||account.currency!=='UGX'||!Number.isSafeInteger(account.balanceUGX)||
    !Number.isSafeInteger(account.openingBalanceUGX)||!account.reconciliationReference)
  throw new Error('Account balance is not authoritatively reconciled.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(period.from)||!/^\d{4}-\d{2}-\d{2}$/.test(period.to)||period.from>period.to)
  throw new Error('Invalid ledger date range.');
 const collectionName=managementLedgerCollection(account);
 const snapshot=await getDocs(query(collection(database,collectionName),where('tenantId','==',account.tenantId),where('accountDocumentId','==',managementAccountDocumentId(account.tenantId,account.accountId))));
 const all=snapshot.docs.map(row=>mapAuthoritativeMovement(row.id,row.data(),account));
 const ids=new Set(all.map(e=>e.id));
 if(ids.size!==all.length)throw new Error('Duplicate posting identities.');
 return {account,currentBalanceUGX:account.balanceUGX,openingBalanceUGX:account.openingBalanceUGX,
  reconciliationReference:account.reconciliationReference,
  entries:all.filter(e=>e.businessDate>=period.from&&e.businessDate<=period.to&&
   (period.direction==='all'||e.direction===period.direction))
   .sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id))};
}
