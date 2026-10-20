import { stageManagementCashEntry, managementAccountDocumentId } from './managementCashPosting';
import { doc, getDoc, runTransaction, Timestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { planCashGrnSettlement } from './cashGrnSettlementPolicy';

/** Use the SAME requestId on retries; create a new ID only for a new installment. */
export interface CashGrnSettlementInput {
  tenantId: string;
  draftId: string;
  requestId: string;
  amountUGX: number;
  externalReference: string;
  /** Registered, reconciled payment account ID within the tenant. */
  paymentAccountId: string;
  actor: { uid: string; name: string };
}

const safeKey = (s: string) => /^[a-zA-Z0-9_-]{1,150}$/.test(s);
const positiveAmount = (v: number) => Number.isSafeInteger(v) && v > 0;

/** Supplier invoice, draft, GRN, account and ledger settle in one transaction. */
export async function settleCashGrnDraft(input: CashGrnSettlementInput, connection: Firestore = db) {
  const { tenantId, draftId, requestId, amountUGX, paymentAccountId, actor } = input;
  const externalReference=input.externalReference?.trim() || '';
  if (!tenantId || !actor.uid || !safeKey(tenantId) || !safeKey(draftId) || !safeKey(requestId) || !safeKey(paymentAccountId) || !positiveAmount(amountUGX) || externalReference.length < 3 || externalReference.length > 150) {
    throw new Error('Invalid settlement reference, identity or amount.');
  }
  const draftRef = doc(connection, 'management_expenses', draftId);
  const paymentId = `procurement_cash_settlement_${tenantId}_${draftId}_${requestId}`;
  const paymentRef = doc(connection, 'cash_grn_payments', paymentId);
  const accountRef = doc(connection, 'finance_payment_accounts', managementAccountDocumentId(tenantId, paymentAccountId));
  // The ledger reference is selected only after transactionally validating
  // the registered payment account kind (petty cash or bank).
  const cashLedgerRef = doc(connection, 'petty_cash_ledger', paymentId);
  const bankLedgerRef = doc(connection, 'banking_records', paymentId);
  try { return await runTransaction(connection, async tx => {
    const [draft, payment, account] = await Promise.all([
      tx.get(draftRef), tx.get(paymentRef), tx.get(accountRef)
    ]);
    if (payment.exists()) {
      const existing = payment.data();
      if (existing.tenantId !== tenantId || existing.draftId !== draftId ||
        existing.amountUGX !== amountUGX || existing.processedBy !== actor.uid ||
        existing.paymentAccountId !== paymentAccountId || existing.externalReference !== externalReference) {
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
      invoice.data().grnId !== grnRef.id || legacyInvoice.data().grnId !== grnRef.id || grn.data().procurement_invoice_id !== legacyInvoiceRef.id || grn.data().payment_type !== 'cash') {
      throw new Error('Missing or mismatched canonical supplier invoice records.');
    }
    if (ledgerExisting.exists()) throw new Error('A disbursement exists without its linked payment record. Reconcile before retry.');
    const invoiceAmount = Number(invoice.data().invoiceValue);
    const alreadyPaid = Number(invoice.data().paidAmountUGX ?? legacyInvoice.data().paid_amount_ugx ?? 0);
    if (Number(legacyInvoice.data().paid_amount_ugx || 0) !== alreadyPaid || Number(legacyInvoice.data().paidAmountUGX || 0) !== alreadyPaid || Number(draft.data().paidAmountUGX || 0) !== alreadyPaid || Number(draft.data().amount) !== invoiceAmount) throw new Error('Invoice and payment draft amounts require reconciliation.');
    const plan = planCashGrnSettlement(invoiceAmount, alreadyPaid, amountUGX);
    if (accountBalance < amountUGX)
      throw new Error('Insufficient funds in the selected Management Cash or Bank account.');
    const now = Timestamp.now();
    const paymentRefText = `PAY-GRN-${requestId}`;
    tx.set(paymentRef, {
      tenantId,draftId,grnId:grnRef.id,invoiceId:invoiceRef.id,
      externalReference,requestId, procurementInvoiceId:legacyInvoiceRef.id, previouslyPaidUGX:alreadyPaid, totalInvoiceUGX:invoiceAmount,
      amountUGX,remainingUGX:plan.remainingUGX,paymentAccountId,
      paymentAccountKind:account.data().kind,processedBy:actor.uid,
      processedByName:actor.name,processedAt:now,reference:paymentRefText,
      excludeFromOpexRollup:true
    });
    stageManagementCashEntry(tx, paymentId,{
      tenantId,date:now.toDate().toISOString().slice(0,10),amount:amountUGX,
      type:'outgoing',source:'Procurement Cash GRN settlement',
      reference_number:paymentRefText,grnId:grnRef.id,invoiceId:invoiceRef.id,
      paymentId,externalReference,paymentAccountId,paymentAccountKind:account.data().kind,
      logged_by:actor.uid,createdAt:now,created_at:now.toDate().toISOString()
    }, connection, paymentAccountId, actor.uid);
    tx.update(invoiceRef,{
      paidAmountUGX:alreadyPaid+amountUGX,
      paymentStatus:plan.paymentStatus,creditBalance:plan.remainingUGX,
      updatedAt:now,lastPaymentReference:externalReference,lastPaymentId:paymentId
    });
    tx.update(legacyInvoiceRef,{
      paid_amount_ugx:alreadyPaid+amountUGX,paidAmountUGX:alreadyPaid+amountUGX,creditBalance:plan.remainingUGX,status:plan.legacyPaymentStatus,
      paymentStatus:plan.paymentStatus,updatedAt:now,lastPaymentReference:externalReference,lastPaymentId:paymentId
    });
    tx.update(draftRef,{
      status:plan.remainingUGX === 0 ? 'approved' : 'partial',
      paymentStatus:plan.remainingUGX === 0 ? 'paid' : 'partial',
      paidAmountUGX:alreadyPaid+amountUGX,
      balanceUGX:plan.remainingUGX,
      excludeFromOpexRollup:true,updatedAt:now,lastPaymentId:paymentId,
      ...(plan.remainingUGX === 0 ? { issuedAt:now,issuedBy:actor.uid } : {})
    });
    tx.update(grnRef,{
      payment_status:plan.remainingUGX === 0 ? 'paid' : 'partial',
      lastPaymentId:paymentId,updatedAt:now
    });
    return {paymentId,alreadyProcessed:false,remainingUGX:plan.remainingUGX};
  }); } catch (error) {
    // Web transactions can surface a stale immutable-create rule rejection
    // before the retry precondition. Reconcile the SAME request without writing.
    try {
      const recorded=await getDoc(paymentRef);
      if(recorded.exists()) {
        const existing=recorded.data();
        if(existing.tenantId===tenantId && existing.draftId===draftId && existing.amountUGX===amountUGX && existing.processedBy===actor.uid && existing.paymentAccountId===paymentAccountId && existing.externalReference===externalReference)
          return {paymentId,alreadyProcessed:true,remainingUGX:Number(existing.remainingUGX)};
      }
      const accountNow=await getDoc(accountRef);
      if(accountNow.exists()&&accountNow.data().tenantId===tenantId&&Number(accountNow.data().balanceUGX)<amountUGX)
        throw new Error('Insufficient funds in the selected Management Cash or Bank account.');
    } catch (reconciliationError) {
      if(reconciliationError instanceof Error&&reconciliationError.message.startsWith('Insufficient funds'))throw reconciliationError;
    }
    throw error;
  }
}
