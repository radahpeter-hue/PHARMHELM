import { doc, runTransaction, Timestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { planCashGrnSettlement } from './cashGrnSettlementPolicy';

/** Use the SAME requestId on retries; create a new ID only for a new installment. */
export interface CashGrnSettlementInput {
  tenantId: string;
  draftId: string;
  requestId: string;
  amountUGX: number;
  /** Registered, reconciled payment account ID within the tenant. */
  paymentAccountId: string;
  actor: { uid: string; name: string };
}

const safeKey = (s: string) => /^[a-zA-Z0-9_-]{1,150}$/.test(s);
const positiveAmount = (v: number) => Number.isSafeInteger(v) && v > 0;

/**
 * Atomic settlement prototype for Stage 2.
 * NOT LIVE: requires registered/reconciled finance_payment_accounts and every
 * competing petty-cash writer migrated to the same transactional account balance.
 * Never initialize account balances opportunistically from nontransactional queries.
 */
export async function settleCashGrnDraft(input: CashGrnSettlementInput, connection: Firestore = db) {
  const { tenantId, draftId, requestId, amountUGX, paymentAccountId, actor } = input;
  if (!tenantId || !actor.uid || !safeKey(tenantId) || !safeKey(draftId) || !safeKey(requestId) || !safeKey(paymentAccountId) || !positiveAmount(amountUGX)) {
    throw new Error('Invalid settlement reference, identity or amount.');
  }
  const draftRef = doc(connection, 'management_expenses', draftId);
  const paymentId = `procurement_cash_settlement_${draftId}_${requestId}`;
  const paymentRef = doc(connection, 'cash_grn_payments', paymentId);
  const accountRef = doc(connection, 'finance_payment_accounts', `${tenantId}_${paymentAccountId}`);
  // The ledger reference is selected only after transactionally validating
  // the registered payment account kind (petty cash or bank).
  const cashLedgerRef = doc(connection, 'petty_cash_ledger', paymentId);
  const bankLedgerRef = doc(connection, 'banking_records', paymentId);
  return runTransaction(connection, async tx => {
    const [draft, payment, account] = await Promise.all([
      tx.get(draftRef), tx.get(paymentRef), tx.get(accountRef)
    ]);
    if (payment.exists()) {
      const existing = payment.data();
      if (existing.tenantId !== tenantId || existing.draftId !== draftId ||
        existing.amountUGX !== amountUGX || existing.processedBy !== actor.uid ||
        existing.paymentAccountId !== paymentAccountId) {
        throw new Error('Settlement reference already belongs to a different payment.');
      }
      return { paymentId, alreadyProcessed:true, remainingUGX:Number(existing.remainingUGX) };
    }
    if (!account.exists() || account.data().tenantId !== tenantId ||
      account.data().accountId !== paymentAccountId ||
      account.data().currency !== 'UGX' || account.data().initialized !== true ||
      !['petty_cash', 'bank'].includes(account.data().kind)) {
      throw new Error('Select a registered, reconciled Management Cash or Bank payment account.');
    }
    const accountBalance = Number(account.data().balanceUGX);
    if (!Number.isSafeInteger(accountBalance) || accountBalance < 0)
      throw new Error('The selected payment account has an invalid balance.');
    const ledgerRef = account.data().kind === 'bank' ? bankLedgerRef : cashLedgerRef;
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
    const [invoice,grn,legacyInvoice,ledgerExisting] = await Promise.all([
      tx.get(invoiceRef),tx.get(grnRef),tx.get(legacyInvoiceRef),tx.get(ledgerRef)
    ]);
    if (!invoice.exists() || !grn.exists() || !legacyInvoice.exists() ||
      invoice.data().tenantId !== tenantId || grn.data().tenantId !== tenantId ||
      legacyInvoice.data().tenantId !== tenantId || grn.data().invoice_id !== invoiceRef.id ||
      invoice.data().grnId !== grnRef.id || grn.data().payment_type !== 'cash') {
      throw new Error('Missing or mismatched canonical supplier invoice records.');
    }
    if (ledgerExisting.exists()) throw new Error('A disbursement exists without its linked payment record. Reconcile before retry.');
    const invoiceAmount = Number(invoice.data().invoiceValue);
    const alreadyPaid = Number(invoice.data().paidAmountUGX ?? legacyInvoice.data().paid_amount_ugx ?? 0);
    const plan = planCashGrnSettlement(invoiceAmount, alreadyPaid, amountUGX);
    if (accountBalance < amountUGX)
      throw new Error('Insufficient funds in the selected Management Cash or Bank account.');
    const now = Timestamp.now();
    const paymentRefText = `PC-GRN-${requestId}`;
    tx.set(paymentRef, {
      tenantId,draftId,grnId:grnRef.id,invoiceId:invoiceRef.id,
      amountUGX,remainingUGX:plan.remainingUGX,paymentAccountId,
      paymentAccountKind:account.data().kind,processedBy:actor.uid,
      processedByName:actor.name,processedAt:now,reference:paymentRefText,
      excludeFromOpexRollup:true
    });
    tx.set(ledgerRef,{
      tenantId,date:now.toDate().toISOString().slice(0,10),amount:amountUGX,
      type:'outgoing',source:'Procurement Cash GRN settlement',
      reference_number:paymentRefText,grnId:grnRef.id,invoiceId:invoiceRef.id,
      paymentId,paymentAccountId,paymentAccountKind:account.data().kind,
      logged_by:actor.uid,createdAt:now,created_at:now.toDate().toISOString()
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
    // A shared account balance is the serialization point for concurrent
    // supplier installments and (after migration) ALL other cash/bank writers.
    tx.update(accountRef,{
      balanceUGX:accountBalance-amountUGX,
      lastPostingId:paymentId,lastPostedAt:now,updatedAt:now
    });
    return {paymentId,alreadyProcessed:false,remainingUGX:plan.remainingUGX};
  });
}
