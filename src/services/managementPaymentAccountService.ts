import { collection, doc, getDocs, query, runTransaction, Timestamp, where, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { cashEntryDelta, managementAccountDocumentId, MANAGEMENT_CASH_ACCOUNT, MANAGEMENT_BANK_ACCOUNT } from './managementCashPosting';

/** After the account-control rules are deployed, legacy unlinked postings are
 * denied and a missing account blocks new postings. This makes first-time cash
 * reconciliation stable. No opportunistic balance initialization during payment.
 */
export async function registerManagementPaymentAccount(input: {
  tenantId: string; actorId: string; kind: 'petty_cash' | 'bank';
  name: string; reconciliationReference: string; bankOpeningBalanceUGX?: number;
}, connection: Firestore = db) {
  if (!input.actorId || !input.name.trim() || input.reconciliationReference.trim().length < 5) throw new Error('Account name and reconciliation evidence are required.');
  const accountId = input.kind === 'petty_cash' ? MANAGEMENT_CASH_ACCOUNT : MANAGEMENT_BANK_ACCOUNT;
  const ref = doc(connection,'finance_payment_accounts',managementAccountDocumentId(input.tenantId,accountId));
  let openingBalanceUGX = input.bankOpeningBalanceUGX ?? 0;
  let openingEntryCount = 0;
  if(input.kind === 'petty_cash') {
    const ledger = await getDocs(query(collection(connection,'petty_cash_ledger'),where('tenantId','==',input.tenantId)));
    openingBalanceUGX=0;openingEntryCount=ledger.size;
    ledger.forEach(row=>{
      const data=row.data();
      // Zero historical entries are harmless; invalid or unknown amounts fail closed.
      if(Number(data.amount)===0 && Number.isSafeInteger(data.amount))return;
      openingBalanceUGX+=cashEntryDelta(data);
    });
  }
  if(!Number.isSafeInteger(openingBalanceUGX)||openingBalanceUGX<0)throw new Error('Reconciled opening balance must be a non-negative whole UGX amount.');
  return runTransaction(connection,async tx=>{
    const existing=await tx.get(ref);
    if(existing.exists())throw new Error('This account is already registered. Reconcile discrepancies without replacing its balance.');
    const now=Timestamp.now();
    tx.set(ref,{tenantId:input.tenantId,accountId,name:input.name.trim(),kind:input.kind,currency:'UGX',initialized:true,balanceUGX:openingBalanceUGX,openingBalanceUGX,openingEntryCount,reconciliationReference:input.reconciliationReference.trim(),registeredBy:input.actorId,registeredAt:now,updatedAt:now,lastPostingId:null,controlVersion:1});
    return {accountId,openingBalanceUGX,openingEntryCount};
  });
}
