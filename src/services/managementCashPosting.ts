import { collection, doc, getDoc, increment, runTransaction, Timestamp, writeBatch, type Firestore, type Transaction, type WriteBatch, type DocumentReference, type DocumentData } from 'firebase/firestore';
import { auth, db } from '../firebase';

export const MANAGEMENT_CASH_ACCOUNT = 'management_petty_cash';
export const MANAGEMENT_BANK_ACCOUNT = 'management_bank';
export type ManagementPaymentAccount = {
  id: string; tenantId: string; accountId: string; name: string;
  kind: 'petty_cash' | 'bank'; portfolioId?:string; portfolioClassification?:string; scope?:{kind:'organisation'}|{kind:'branch';branchId:string}; currency: 'UGX'; initialized: boolean;
  balanceUGX: number; openingBalanceUGX: number; reconciliationReference: string;
};
export function managementAccountDocumentId(tenantId: string, accountId = MANAGEMENT_CASH_ACCOUNT) {
  if (!/^[a-zA-Z0-9_-]{1,150}$/.test(tenantId) || !/^(management_petty_cash|management_bank|system_[a-zA-Z0-9_-]+|bank_[0-9a-f]{64}|custom_[a-zA-Z0-9_-]+)$/.test(accountId)) throw new Error('Invalid Management payment account.');
  return `${tenantId}_${accountId}`;
}
function cleanRecord(value: any): any {
  if(Array.isArray(value))return value.map(cleanRecord);
  if(value && typeof value==='object' && Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,cleanRecord(v)]));
  return value;
}
export function cashEntryDelta(data: { amount?: unknown; type?: unknown }) {
  const amount = Number(data.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Cash postings require a positive whole UGX amount.');
  const type = String(data.type).toLowerCase();
  if (['incoming','deposit','topup'].includes(type)) return amount;
  if (['outgoing','withdrawal'].includes(type)) return -amount;
  throw new Error('Unknown cash movement type. Reconcile the entry before posting.');
}

/** Atomic server increment plus rule-verified ledger evidence protects batches too.
 * Rules reject a negative resulting balance and every legacy unlinked ledger write.
 */
export function stageManagementCashEntry(
  writer: { set(ref: DocumentReference, data: DocumentData): unknown; update(ref: DocumentReference, data: DocumentData): unknown },
  ledgerId: string, data: Record<string, any>, connection: Firestore = db,
  accountId = MANAGEMENT_CASH_ACCOUNT, actorId = auth.currentUser?.uid || ''
) {
  if (!actorId || !data.tenantId) throw new Error('Authenticated cash posting identity is required.');
  const accountDocumentId = managementAccountDocumentId(data.tenantId, accountId);
  const delta = cashEntryDelta(data);
  const ledgerCollection = accountId === MANAGEMENT_BANK_ACCOUNT || accountId === 'system_mtn_mobile_money' || accountId === 'system_airtel_mobile_money' || accountId.startsWith('bank_') ? 'banking_records' : 'petty_cash_ledger';
  const now = Timestamp.now();
  const payload = cleanRecord(data);
  writer.set(doc(connection, ledgerCollection, ledgerId), {
    ...payload, amount:Math.abs(delta), date:payload.date||now.toDate().toISOString().slice(0,10), accountDocumentId, accountDeltaUGX: delta, postedBy: actorId,
    createdAt: now, updatedAt: now
  });
  writer.update(doc(connection, 'finance_payment_accounts', accountDocumentId), {
    balanceUGX: increment(delta), lastPostingId: ledgerId, updatedAt: now
  });
}

export async function postManagementCashEntry(data: Record<string, any>, connection: Firestore = db, requestId?: string, actorId = auth.currentUser?.uid || '') {
  const ref = requestId ? doc(connection,'petty_cash_ledger',requestId) : doc(collection(connection,'petty_cash_ledger'));
  await runTransaction(connection, async tx => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      if(existing.data().tenantId!==data.tenantId || existing.data().amount!==data.amount || existing.data().type!==data.type || existing.data().postedBy!==actorId) throw new Error('Cash posting reference conflicts with an existing transaction.');
      return;
    }
    stageManagementCashEntry(tx, ref.id, data, connection, MANAGEMENT_CASH_ACCOUNT, actorId);
  });
  return ref;
}

/** Collect existing related records before one atomic commit; no partial expense/allocation. */
export function createManagementFinanceWriteGroup(tenantId: string, actorId: string, connection: Firestore = db) {
  const batch = writeBatch(connection);
  let cashPosted = false;
  let cashDelta: number | null = null;
  let transferCashDelta: number | null = null;
  let bankPosted = false;
  let committed = false;
  let cashLedgerId: string | null = null;
  let cashTransferRef: DocumentReference | null = null;
  const add = (path: string, data: Record<string, any>) => {
    if (committed || data.tenantId !== tenantId) throw new Error('Invalid finance posting scope.');
    const ref = doc(collection(connection,path));
    const clean = cleanRecord(data);
    if(path === 'petty_cash_ledger') {
      if(cashPosted)throw new Error('Only one cash movement per posting is supported.');
      cashPosted=true;cashDelta=cashEntryDelta(clean);cashLedgerId=ref.id;
      stageManagementCashEntry(batch,ref.id,clean,connection,MANAGEMENT_CASH_ACCOUNT,actorId);
    } else {
      if(path === 'cashTransfers') {
        cashTransferRef=ref;
        if(bankPosted)throw new Error('Only one bank transfer per posting is supported.');
        const bankDelta=clean.toPortfolio==='banked'?Number(clean.amount):clean.fromPortfolio==='banked'?-Number(clean.amount):0;
        if(bankDelta) {
          bankPosted=true;
          stageManagementCashEntry(batch,`transfer_${ref.id}`,{tenantId,amount:Math.abs(bankDelta),type:bankDelta>0?'incoming':'outgoing',source:'Management portfolio transfer',transferId:ref.id,reference_number:`TRF-${ref.id}`},connection,MANAGEMENT_BANK_ACCOUNT,actorId);
          clean.bankMovementId=`transfer_${ref.id}`;
        }
        transferCashDelta=clean.toPortfolio==='petty_cash'?Number(clean.amount):clean.fromPortfolio==='petty_cash'?-Number(clean.amount):null;
      }
      batch.set(ref,{...clean,createdAt:Timestamp.now()});
    }
    return ref;
  };
  return {
    add,
    addDocument: async(path:string,data:Record<string,any>)=>add(path,data).id,
    updateDocument: async(path:string,id:string,data:Record<string,any>)=>{
      if(committed)throw new Error('Posting already committed.');
      batch.update(doc(connection,path,id),{...cleanRecord(data),updatedAt:Timestamp.now()});
    },
    async commit() {
      if(committed)throw new Error('Posting already committed.');
      if(transferCashDelta!==null) {
        if(cashPosted && cashDelta!==transferCashDelta)throw new Error('Bank transfer and cash posting amounts differ.');
        if(!cashPosted)add('petty_cash_ledger',{tenantId,amount:Math.abs(transferCashDelta),type:transferCashDelta>0?'incoming':'outgoing',source:'Management bank transfer'});
      }
      if(transferCashDelta!==null&&cashTransferRef&&cashLedgerId){
        batch.update(cashTransferRef,{cashMovementId:cashLedgerId});
        batch.update(doc(connection,'petty_cash_ledger',cashLedgerId),{transferId:cashTransferRef.id});
      }
      committed=true;await batch.commit();
    }
  };
}

/** Existing receivable-to-bank funding writer shares the controlled bank balance. */
export async function postManagementReceivablePayment(input:{tenantId:string;receivableId:string;amountUGX:number;requestId:string;actorId:string},connection:Firestore=db) {
  const transferId=`receivable_${input.tenantId}_${input.receivableId}_${input.requestId}`;
  const transferRef=doc(connection,'cashTransfers',transferId);
  const receivableRef=doc(connection,'credit_receivables',input.receivableId);
  if(!Number.isSafeInteger(input.amountUGX)||input.amountUGX<=0)throw new Error('Enter a positive whole UGX amount.');
  try { return await runTransaction(connection,async tx=>{
    const [transfer,receivable]=await Promise.all([tx.get(transferRef),tx.get(receivableRef)]);
    if(transfer.exists()) {
      if(transfer.data().tenantId!==input.tenantId||transfer.data().amount!==input.amountUGX||transfer.data().processedBy!==input.actorId)throw new Error('Receivable payment reference conflict.');
      return {remainingUGX:Number(transfer.data().remainingReceivableUGX)};
    }
    if(!receivable.exists()||receivable.data().tenantId!==input.tenantId)throw new Error('Post and verify the canonical receivable before banking its payment.');
    const outstanding=Number(receivable.data().outstanding_ugx);
    if(!Number.isSafeInteger(outstanding)||outstanding<input.amountUGX)throw new Error('Payment exceeds the current outstanding receivable.');
    const remaining=outstanding-input.amountUGX,now=Timestamp.now();
    const bankMovementId=`transfer_${transferId}`;
    stageManagementCashEntry(tx,bankMovementId,{tenantId:input.tenantId,amount:input.amountUGX,type:'incoming',source:'Credit receivable payment',transferId,reference_number:transferId},connection,MANAGEMENT_BANK_ACCOUNT,input.actorId);
    tx.set(transferRef,{tenantId:input.tenantId,fromPortfolio:'receivables',toPortfolio:'banked',amount:input.amountUGX,bankMovementId,receivableId:input.receivableId,remainingReceivableUGX:remaining,processedBy:input.actorId,processedAt:now});
    tx.update(receivableRef,{outstanding_ugx:remaining,status:remaining===0?'paid':'outstanding',lastProcessedAt:now});
    return {remainingUGX:remaining};
  }); } catch(error) {
    try {
      const existing=await getDoc(transferRef);
      if(existing.exists()&&existing.data().tenantId===input.tenantId&&existing.data().amount===input.amountUGX&&existing.data().processedBy===input.actorId)
        return {remainingUGX:Number(existing.data().remainingReceivableUGX)};
    } catch {}
    throw error;
  }
}
