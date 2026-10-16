import { collection, doc, getDocs, query, runTransaction, Timestamp, where, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { planCashGrnSettlement } from './cashGrnSettlementPolicy';

/** Use the SAME requestId on retries; create a new ID only for a new installment. */
export interface CashGrnSettlementInput {
  tenantId: string;
  draftId: string;
  requestId: string;
  amountUGX: number;
  actor: { uid: string; name: string };
}

const safeKey = (s: string) => /^[a-zA-Z0-9_-]{1,150}$/.test(s);
const positiveAmount = (v: number) => Number.isSafeInteger(v) && v > 0;

/**
 * Atomic settlement prototype for Stage 2.
 * Do not enable in live Finance until ALL legacy petty-cash writers use the
 * same tenant-level balance lock; otherwise a concurrent legacy posting could
 * bypass this balance guard.
 */
export async function settleCashGrnDraft(input: CashGrnSettlementInput, connection: Firestore = db) {
  const { tenantId, draftId, requestId, amountUGX, actor } = input;
  if (!tenantId || !actor.uid || !safeKey(draftId) || !safeKey(requestId) || !positiveAmount(amountUGX)) {
    throw new Error('Invalid settlement reference, identity or amount.');
  }
  const draftRef = doc(connection, 'management_expenses', draftId);
  const paymentId = `procurement_cash_settlement_${draftId}_${requestId}`;
  const paymentRef = doc(connection, 'cash_grn_payments', paymentId);
  const pettyRef = doc(connection, 'petty_cash_ledger', paymentId);
  const lockRef = doc(connection, 'petty_cash_posting_locks', tenantId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  const ledger = await getDocs(query(collection(connection,'petty_cash_ledger'), where('tenantId','==',tenantId)));
  let availableUGX = 0;
  ledger.forEach(snapshot => {
    const data = snapshot.data();
    const amount = Number(data.amount || 0);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid historical petty cash ledger amount.');
    const type = String(data.type || '').toLowerCase();
    availableUGX += ['incoming','deposit','topup'].includes(type) ? amount : -amount;
  });
  if (!Number.isSafeInteger(availableUGX)) throw new Error('Invalid petty-cash balance.');
  return runTransaction(connection, async tx => {
    const [draft, payment, lock] = await Promise.all([
      tx.get(draftRef), tx.get(paymentRef), tx.get(lockRef)
    ]);
    if (payment.exists()) {
      const existing = payment.data();
      if (existing.tenantId !== tenantId || existing.draftId !== draftId ||
        existing.amountUGX !== amountUGX || existing.processedBy !== actor.uid) {
        throw new Error('Settlement reference already belongs to a different payment.');
      }
      return { paymentId, alreadyProcessed:true, remainingUGX:Number(existing.remainingUGX) };
    }
    if (!draft.exists() || draft.data().tenantId !== tenantId ||
      draft.data().source !== 'procurement_cash_grn' ||
      draft.data().excludeFromOpexRollup !== true ||
      !draft.data().grnId || !draft.data().invoiceId) {
      throw new Error('This is not a linked, pending procurement Cash GRN draft.');
    }
    if (!['draft','partial'].includes(draft.data().status)) {
      throw new Error('This GRN invoice is not awaiting payment.');
    }
    const invoiceRef = doc(connection,'invoices',draft.data().invoiceId);
    const grnRef = doc(connection,'grn_records',draft.data().grnId);
    const legacyInvoiceRef = doc(connection,'procurement_invoices',
      draft.data().grnId.startsWith('op_grn_')
        ? `procurement_register_${draft.data().grnId}`
        : `procurement_register_${draft.data().grnId.slice(4)}`);
    const [invoice,grn,legacyInvoice,pettyExisting] = await Promise.all([
      tx.get(invoiceRef),tx.get(grnRef),tx.get(legacyInvoiceRef),tx.get(pettyRef)
    ]);
    if (!invoice.exists() || !grn.exists() || !legacyInvoice.exists() ||
      invoice.data().tenantId !== tenantId || grn.data().tenantId !== tenantId ||
      legacyInvoice.data().tenantId !== tenantId || grn.data().invoice_id !== invoiceRef.id ||
      invoice.data().grnId !== grnRef.id || grn.data().payment_type !== 'cash') {
      throw new Error('Missing or mismatched canonical supplier invoice records.');
    }
    if (pettyExisting.exists()) throw new Error('A cash movement exists without its payment record. Reconcile before retry.');
    const invoiceAmount = Number(invoice.data().invoiceValue);
    const alreadyPaid = Number(invoice.data().paidAmountUGX ?? legacyInvoice.data().paid_amount_ugx ?? 0);
    const plan = planCashGrnSettlement(invoiceAmount, alreadyPaid, amountUGX);
    if (availableUGX < amountUGX) throw new Error('Insufficient Management Petty Cash at payment processing.');
    // Changes to the lock invalidate concurrent dedicated cash-settlement attempts.
    if (lock.exists() && lock.data().postingId && Number(lock.data().expiresAtMs || 0) > Date.now()) {
      throw new Error('Another Management Petty Cash operation is in progress.');
    }
    const now = Timestamp.now();
    const paymentRefText = `PC-GRN-${requestId}`;
    tx.set(paymentRef, {
      tenantId,draftId,grnId:grnRef.id,invoiceId:invoiceRef.id,
      amountUGX,remainingUGX:plan.remainingUGX,processedBy:actor.uid,
      processedByName:actor.name,processedAt:now,reference:paymentRefText,
      excludeFromOpexRollup:true
    });
    tx.set(pettyRef,{
      tenantId,date:now.toDate().toISOString().slice(0,10),amount:amountUGX,
      type:'outgoing',source:'Procurement Cash GRN settlement',
      reference_number:paymentRefText,grnId:grnRef.id,invoiceId:invoiceRef.id,
      paymentId,logged_by:actor.uid,createdAt:now,created_at:now.toDate().toISOString()
    });
    tx.update(invoiceRef,{
      paidAmountUGX:alreadyPaid+amountUGX,
      paymentStatus:plan.paymentStatus,creditBalance:plan.remainingUGX,
      updatedAt:now,lastPaymentReference:paymentRefText
    });
    tx.update(legacyInvoiceRef,{
      paid_amount_ugx:alreadyPaid+amountUGX,status:plan.legacyPaymentStatus,
      paymentStatus:plan.paymentStatus,updatedAt:now,lastPaymentReference:paymentRefText
    });
    tx.update(draftRef,{
      status:plan.remainingUGX === 0 ? 'approved' : 'partial',
      paymentStatus:plan.remainingUGX === 0 ? 'paid' : 'partial',
      paidAmountUGX:alreadyPaid+amountUGX,
      balanceUGX:plan.remainingUGX,
      excludeFromOpexRollup:true,updatedAt:now,
      ...(plan.remainingUGX === 0 ? { issuedAt:now,issuedBy:actor.uid } : {})
    });
    tx.update(grnRef,{
      payment_status:plan.remainingUGX === 0 ? 'paid' : 'partial',
      updatedAt:now
    });
    tx.set(lockRef,{
      tenantId,postingId:null,userId:null,
      lastSettlementId:paymentId,lastPostedAt:now,expiresAtMs:0
    },{merge:true});
    return {paymentId,alreadyProcessed:false,remainingUGX:plan.remainingUGX};
  });
}
