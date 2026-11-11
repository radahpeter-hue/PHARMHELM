import {collection, doc, getDocs, query, where, runTransaction, setDoc, updateDoc, deleteField, type Firestore} from 'firebase/firestore';
import {db} from '../../firebase';
import {defineFinancialPortfolio,validateFinancialPortfolio,type FinancialPortfolio,type NewFinancialPortfolio} from './financialPortfolio';
import {validatePortfolioChildAccount,bankAccountIdentity,type PortfolioChildAccount} from './portfolioAccounts';
import {defineBuiltInPortfolio,type BuiltInPortfolioKey} from './builtInPortfolios';

const portfolios='finance_portfolios_v1';
const accounts='finance_portfolio_accounts_v1';
export const portfolioRef=(database:Firestore,tenantId:string,id:string)=>doc(database,portfolios,tenantId+'__'+id);
export const accountRef=(database:Firestore,tenantId:string,id:string)=>doc(database,accounts,tenantId+'__'+id);
export async function listFinancialPortfolios(
 tenantId:string,branchId?:string|null,database:Firestore=db
):Promise<FinancialPortfolio[]>{
 const base=collection(database,portfolios);
 // Null requests tenant-wide coverage. The registry Rules authorize each scope.
 const tenant = where('tenantId', '==', tenantId);
 const requests = [getDocs(branchId === null ? query(base, tenant) : query(base, tenant, where('scope.kind', '==', 'organisation')))];
 if(branchId)requests.push(getDocs(query(base,where('tenantId','==',tenantId),where('scope.kind','==','branch'),where('scope.branchId','==',branchId))));
 const snapshots=await Promise.all(requests);
 const seen=new Set<string>();
 const result:FinancialPortfolio[]=[];
 for(const snapshot of snapshots)for(const d of snapshot.docs){
   const p=validateFinancialPortfolio(d.data() as FinancialPortfolio);
   if(p.status==='deleted')continue;
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
 // A transaction GET against a missing registry document is denied by the
 // fail-closed Firestore rules. Its CREATE predicate is authoritative; an ID
 // collision becomes an UPDATE and is denied rather than overwriting history.
 await setDoc(portfolioRef(database,value.tenantId,value.id),value);
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

/** CEO-confirmed, idempotent registration of canonical built-ins. Never mints balances. */
export async function registerBuiltInPortfolio(input:{
  tenantId:string;key:BuiltInPortfolioKey;branchId?:string;
  actorId:string;createdAt:string
},database:Firestore=db):Promise<FinancialPortfolio>{
  const value=defineBuiltInPortfolio({
    tenantId:input.tenantId,key:input.key,branchId:input.branchId,
    createdBy:input.actorId,createdAt:input.createdAt
  });
  const ref=portfolioRef(database,value.tenantId,value.id);
  return runTransaction(database,async tx=>{
    const old=await tx.get(ref);
    if(old.exists()){
      const existing=validateFinancialPortfolio(old.data() as FinancialPortfolio);
      if(existing.origin!=='system'||existing.id!==value.id||existing.tenantId!==input.tenantId)
        throw new Error('System portfolio identity conflicts with an existing record.');
      return existing;
    }
    tx.set(ref,value);
    return value;
  });
}

/**
 * Spark-safe bank account registry: each account is a first-class portfolio
 * with a canonical parent link, not a new writeable financial ledger.
 * The existing CEO-only create rules enforce immutable, tenant-scoped IDs.
 */
export async function registerPortfolioBankIdentity(input:{
 tenantId:string;actorId:string;institution:string;accountReference:string;
 displayName:string;createdAt:string
},database:Firestore=db):Promise<FinancialPortfolio>{
 const {normalizeBankInstitution,normalizeBankReference}=await import('./portfolioAccounts');
 const institution=normalizeBankInstitution(input.institution);
 const accountReference=normalizeBankReference(input.accountReference);
 if(!institution||!accountReference||!input.displayName.trim())throw new Error('Bank and account details are required.');
 if(institution.length>100||accountReference.length>60||!/^[A-Z0-9]+$/.test(accountReference))
  throw new Error('Invalid bank account reference.');
 const id=await bankAccountIdentity(input.tenantId,'system_bank',institution,accountReference);
 const value=defineFinancialPortfolio({
  id,tenantId:input.tenantId,name:input.displayName,
  classification:'bank',description:'Bank account identity; no financial balance initialized',
  scope:{kind:'organisation'},currency:'UGX',origin:'custom',
  supportsChildAccounts:false,allowsTransfersIn:false,allowsTransfersOut:false,
  createdBy:input.actorId,createdAt:input.createdAt,
  bankInstitution:institution,bankAccountReference:accountReference,bankParentId:'system_bank'
 });
 await setDoc(portfolioRef(database,input.tenantId,id),value);
 return value;
}
export function registeredBankAccounts(portfolios:readonly FinancialPortfolio[]):FinancialPortfolio[]{
 return portfolios.filter(p=>p.origin==='custom'&&p.classification==='bank'
   &&p.bankParentId==='system_bank'&&!!p.bankAccountReference&&!!p.bankInstitution);
}

/** CEO lifecycle for individual bank identities, preserving their funding and ledgers. */
export async function setRegisteredBankAccountActive(
 bank:FinancialPortfolio,active:boolean,actorId:string,reason:string,database:Firestore=db
):Promise<FinancialPortfolio>{
 if(bank.origin!=='custom'||bank.classification!=='bank'||bank.bankParentId!=='system_bank')
  throw new Error('Only registered individual bank accounts can be managed.');
 // Use the same transactional zero-balance gate as every other custom portfolio.
 // A stale cached bank identity cannot bypass its current authoritative balance.
 return setCustomPortfolioActive(bank,active,actorId,reason,database);
}

/** Persisted CEO lifecycle for custom portfolios. Firestore Rules independently authorize writes.
 * A funded portfolio cannot be disabled until its authoritative balance is zero.
 * This transaction also prevents stale-state changes from overwriting a concurrent lifecycle action.
 */
export async function setCustomPortfolioActive(
 portfolio:FinancialPortfolio,active:boolean,actorId:string,reason:string,database:Firestore=db
):Promise<FinancialPortfolio>{
 if(portfolio.origin!=='custom'||!actorId||(!active&&!reason.trim()))
  throw new Error('CEO lifecycle actor and deactivation reason required.');
 const ref=portfolioRef(database,portfolio.tenantId,portfolio.id);
 const funding=doc(database,'finance_payment_accounts',portfolio.tenantId+'_'+portfolio.id);
 const now=new Date().toISOString();
 return runTransaction(database,async tx=>{
  const [snapshot,account]=await Promise.all([tx.get(ref),tx.get(funding)]);
  if(!snapshot.exists())throw new Error('Portfolio no longer exists.');
  const current=validateFinancialPortfolio(snapshot.data() as FinancialPortfolio);
  if(current.origin!=='custom'||current.tenantId!==portfolio.tenantId||current.id!==portfolio.id)
   throw new Error('Portfolio identity mismatch.');
  if(current.status!==(active?'inactive':'active'))
   throw new Error('Portfolio status changed; reload before continuing.');
  if(!active&&account.exists()&&(!Number.isSafeInteger(account.data().balanceUGX)||account.data().balanceUGX!==0))
   throw new Error('Resolve the non-zero account balance before deactivation.');
  const metadata=active
   ?{status:'active' as const,updatedBy:actorId,updatedAt:now}
   :{status:'inactive' as const,updatedBy:actorId,updatedAt:now,deactivatedBy:actorId,deactivatedAt:now,deactivationReason:reason.trim()};
  tx.update(ref,active
   ?{...metadata,deactivatedBy:deleteField(),deactivatedAt:deleteField(),deactivationReason:deleteField()}
   :metadata);
  return active
   ?{...current,...metadata,deactivatedBy:undefined,deactivatedAt:undefined,deactivationReason:undefined}
   :{...current,...metadata};
 });
}


/** Remove an unused identity from the directory, retaining an immutable audit tombstone.
 * Funding records are never deleted, so their existence permanently prevents removal.
 */
export async function removeUnusedPortfolio(
 portfolio:FinancialPortfolio,actorId:string,reason:string,database:Firestore=db
):Promise<void>{
 if(portfolio.origin!=='custom'||!actorId||!reason.trim())throw new Error('CEO actor and deletion reason required.');
 const ref=portfolioRef(database,portfolio.tenantId,portfolio.id);
 const funding=doc(database,'finance_payment_accounts',portfolio.tenantId+'_'+portfolio.id);
 await runTransaction(database,async tx=>{
  const [snapshot,account]=await Promise.all([tx.get(ref),tx.get(funding)]);
  if(!snapshot.exists())throw new Error('Portfolio no longer exists.');
  const current=validateFinancialPortfolio(snapshot.data() as FinancialPortfolio);
  if(current.id!==portfolio.id||current.tenantId!==portfolio.tenantId||current.origin!=='custom')throw new Error('Portfolio identity mismatch.');
  if(current.status!=='inactive')throw new Error('Deactivate the unused account before deletion.');
  if(account.exists())throw new Error('Reconciled accounts retain their identity and financial history; deactivate instead.');
  if(current.supportsChildAccounts)throw new Error('Portfolios supporting child accounts must retain their parent identity.');
  const now=new Date().toISOString();
  tx.update(ref,{status:'deleted',deactivationReason:reason.trim(),updatedBy:actorId,updatedAt:now});
 });
}
