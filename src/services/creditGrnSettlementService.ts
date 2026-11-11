import { arrayUnion, doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { planCashGrnSettlement } from './cashGrnSettlementPolicy';
import {
  checkSupplierPaymentReplay, readSupplierFunding, readSupplierPayer, recoverSupplierPayment,
  stageSupplierPayment, supplierPaymentAudit, validateSupplierPayment, type SupplierPaymentInput,
} from './supplierPaymentPosting';

export async function requestSupplierCreditDraft(input: {
  tenantId: string; creditLedgerId: string; amountUGX: number; requestId: string;
  actor: SupplierPaymentInput['actor'];
}, connection: Firestore = db) {
  const { tenantId, creditLedgerId, amountUGX, requestId, actor } = input;
  if (!Number.isSafeInteger(amountUGX) || amountUGX <= 0 || !/^[A-Za-z0-9_-]{1,150}$/.test(requestId)) {
    throw new Error('Enter a positive payment amount in whole UGX.');
  }
  const draftId = `credit_payment_${creditLedgerId}_${requestId}`;
  const draftRef = doc(connection, 'management_expenses', draftId);
  const creditRef = doc(connection, 'creditLedger', creditLedgerId);
  return runTransaction(connection, async tx => {
    const payer = await readSupplierPayer(tx, connection, input);
    const [creditSnap, draftSnap] = await Promise.all([tx.get(creditRef), tx.get(draftRef)]);
    const credit = creditSnap.data();
    const prior = draftSnap.data();
    if (prior?.tenantId === tenantId && prior.sourceRefId === creditLedgerId && prior.amount === amountUGX &&
        prior.createdBy === actor.uid) return draftId;
    const outstanding = credit?.remainingCreditBalance ?? credit?.balance ?? credit?.amount_ugx;
    const invoiceId = credit?.invoiceId || credit?.invoice_id;
    const status = String(credit?.status || 'outstanding').toLowerCase();
    if (prior || !credit || credit.tenantId !== tenantId || !invoiceId || credit.pendingDraftId ||
        !['outstanding', 'partial', 'unpaid', 'pending'].includes(status) || !Number.isSafeInteger(outstanding) || amountUGX > outstanding) {
      throw new Error('The liability changed or already has a payment draft awaiting review.');
    }
    const now = serverTimestamp();
    tx.set(draftRef, {
      tenantId, requestId, amount: amountUGX, amount_ugx: amountUGX, originalAmount: outstanding,
      category: 'Procurement & Logistics', department: credit.branchName || 'HQ',
      description: `Credit payment to ${credit.supplierName || 'Supplier'} · ${credit.invoiceRef || credit.invoiceNumber || 'Supplier invoice'}`,
      status: 'draft', sourceType: 'credit', source: 'credit_payment', excludeFromOpexRollup: true,
      invoiceId, invoiceRef: credit.invoiceRef || credit.invoiceNumber || '',
      sourceRefId: creditLedgerId, sourceRef: creditLedgerId, logged_by: payer.name, createdBy: actor.uid, createdAt: now,
      date: new Date().toISOString().slice(0, 10), created_at: new Date().toISOString(),
    });
    tx.update(creditRef, { status: 'processing', pendingDraftId: draftId, lastProcessedAt: now });
    return draftId;
  });
}

export async function rejectSupplierCreditDraft(input: {
  tenantId: string; draftId: string; actor: SupplierPaymentInput['actor'];
}, connection: Firestore = db) {
  const { tenantId, draftId, actor } = input;
  const draftRef = doc(connection, 'management_expenses', draftId);
  return runTransaction(connection, async tx => {
    await readSupplierPayer(tx, connection, input);
    const draft = (await tx.get(draftRef)).data();
    if (!draft || draft.tenantId !== tenantId || draft.source !== 'credit_payment' ||
        !['draft', 'pending', 'partial'].includes(draft.status)) {
      throw new Error('The supplier payment draft is no longer open.');
    }
    const creditRef = doc(connection, 'creditLedger', draft.sourceRefId);
    const credit = (await tx.get(creditRef)).data();
    if (!credit || credit.tenantId !== tenantId || (credit.invoiceId || credit.invoice_id) !== draft.invoiceId ||
        (credit.pendingDraftId && credit.pendingDraftId !== draftId)) {
      throw new Error('The supplier liability has a different active payment draft.');
    }
    const remaining = credit.remainingCreditBalance ?? credit.balance ?? credit.amount_ugx;
    const status = remaining === 0 ? 'paid' : remaining < (credit.originalCreditAmount ?? credit.amount ?? credit.amount_ugx) ? 'partial' : 'outstanding';
    tx.update(draftRef, { status: 'rejected', rejectedAt: serverTimestamp(), rejectedBy: actor.uid });
    tx.update(creditRef, { status, pendingDraftId: '', lastProcessedAt: serverTimestamp(), rejectedDraftId: draftId });
  });
}

export async function settleSupplierCreditDraft(input: SupplierPaymentInput, connection: Firestore = db) {
  const payment = validateSupplierPayment(input);
  const { tenantId, draftId, requestId, amountUGX, externalReference, actor } = payment;
  const paymentId = `supplier_credit_settlement_${tenantId}_${requestId}`;
  const paymentRef = doc(connection, 'creditPayments', paymentId);
  try {
    return await runTransaction(connection, async tx => {
      const payer = await readSupplierPayer(tx, connection, payment);
      const prior = await tx.get(paymentRef);
      if (prior.exists()) {
        return { paymentId, alreadyProcessed: true, remainingUGX: checkSupplierPaymentReplay(prior.data(), payment) };
      }
      const draftRef = doc(connection, 'management_expenses', draftId);
      const [draftSnap, legacyPayment] = await Promise.all([
        tx.get(draftRef), tx.get(doc(connection, 'creditPayments', draftId)),
      ]);
      const draft = draftSnap.data();
      if (legacyPayment.exists() || !draft || draft.tenantId !== tenantId || draft.source !== 'credit_payment' ||
          draft.sourceType !== 'credit' || !draft.sourceRefId || !draft.invoiceId ||
          !['draft', 'pending', 'partial'].includes(draft.status)) {
        throw new Error('This supplier credit draft is unavailable or has been settled.');
      }
      const creditRef = doc(connection, 'creditLedger', draft.sourceRefId);
      const invoiceRef = doc(connection, 'invoices', draft.invoiceId);
      const [creditSnap, invoiceSnap] = await Promise.all([tx.get(creditRef), tx.get(invoiceRef)]);
      const credit = creditSnap.data();
      const invoice = invoiceSnap.data();
      if (!credit || !invoice || credit.tenantId !== tenantId || invoice.tenantId !== tenantId ||
          (credit.invoiceId || credit.invoice_id) !== invoiceRef.id || (credit.pendingDraftId && credit.pendingDraftId !== draftId) || ((credit.grnId || credit.grn_id) && (credit.grnId || credit.grn_id) !== invoice.grnId) ||
          (invoice.paymentType && invoice.paymentType !== 'credit')) {
        throw new Error('The supplier liability and invoice linkage requires reconciliation.');
      }
      const grnId = String(invoice.grnId || '');
      const grnRef = grnId ? doc(connection, 'grn_records', grnId) : null;
      const grn = grnRef ? (await tx.get(grnRef)).data() : undefined;
      if (grnId && (!grn || grn.tenantId !== tenantId ||
          (grn.invoice_id && grn.invoice_id !== invoiceRef.id) ||
          (grn.credit_ledger_id && grn.credit_ledger_id !== creditRef.id) ||
          (invoice.paymentType === 'credit' && grn.payment_type !== 'credit'))) {
        throw new Error('The supplier liability and GRN linkage requires reconciliation.');
      }
      const procurementInvoiceId = String(grn?.procurement_invoice_id || '');
      const registerRef = procurementInvoiceId ? doc(connection, 'procurement_invoices', procurementInvoiceId) : null;
      const register = registerRef ? (await tx.get(registerRef)).data() : undefined;
      if (registerRef && (!register || register.tenantId !== tenantId || register.grnId !== grnId)) {
        throw new Error('The Procurement invoice link requires reconciliation.');
      }

      const totalInvoiceUGX = Number(invoice.invoiceValue);
      const balanceBefore = Number(credit.remainingCreditBalance ?? credit.balance ?? credit.amount_ugx ?? credit.amount);
      const previouslyPaidUGX = totalInvoiceUGX - balanceBefore;
      const draftPaid = Number(draft.paidAmountUGX ?? 0);
      const draftLimit = Number(draft.amount);
      if (invoice.creditBalance !== balanceBefore ||
          (invoice.paidAmountUGX != null && invoice.paidAmountUGX !== previouslyPaidUGX && invoice.lastPaymentId) ||
          !Number.isSafeInteger(draftPaid) || draftPaid < 0 || !Number.isSafeInteger(draftLimit) ||
          amountUGX > draftLimit - draftPaid || draftLimit > Number(draft.originalAmount ?? draftLimit)) {
        throw new Error('Payment exceeds the approved draft or requires balance reconciliation.');
      }
      const plan = planCashGrnSettlement(totalInvoiceUGX, previouslyPaidUGX, amountUGX);
      const movementId = 'credit_payment_' + paymentId;
      const funding = await readSupplierFunding(tx, connection, payment, movementId);
      const now = serverTimestamp();
      const paid = plan.remainingUGX === 0;
      const draftRemaining = Math.min(draftLimit - draftPaid - amountUGX, plan.remainingUGX);
      const draftComplete = draftRemaining === 0;
      const reference = `CP-${requestId}`;
      const invoiceUpdate = {
        paidAmountUGX: previouslyPaidUGX + amountUGX, creditBalance: plan.remainingUGX,
        paymentStatus: paid ? 'paid' : 'partial', updatedAt: now, lastPaymentReference: externalReference, lastPaymentId: paymentId,
      };

      tx.set(paymentRef, {
        ...supplierPaymentAudit(payment, payer), ...funding, expenseId: draftId, grnId, procurementInvoiceId,
        invoiceId: invoiceRef.id, invoiceRef: invoice.supplierInvoiceNumber || invoice.invoiceRef || draft.invoiceRef || '',
        creditLedgerId: creditRef.id, paymentReference: reference, amount: amountUGX,
        balanceBefore, balanceAfter: plan.remainingUGX, previouslyPaidUGX, totalInvoiceUGX,
        paymentSource: funding.paymentAccountId,
      });
      stageSupplierPayment(tx, connection, payment, funding, {
        paymentId, invoiceId: invoiceRef.id, grnId, creditLedgerId: creditRef.id, supplierPosting: 'credit', reference,
      });
      tx.update(creditRef, {
        remainingCreditBalance: plan.remainingUGX, balance: plan.remainingUGX,
        status: paid ? 'paid' : draftComplete ? 'partial' : 'processing', pendingDraftId: draftComplete ? '' : draftId,
        paymentHistoryIds: arrayUnion(paymentId), lastProcessedAt: now, updatedAt: now,
        lastPaymentId: paymentId, lastPaymentReference: externalReference,
      });
      tx.update(invoiceRef, invoiceUpdate);
      if (registerRef) {
        tx.update(registerRef, { ...invoiceUpdate, paid_amount_ugx: invoiceUpdate.paidAmountUGX, status: paid ? 'Paid' : 'Partial' });
      }
      if (grnRef) {
        tx.update(grnRef, { payment_status: paid ? 'paid' : 'partial', lastPaymentId: paymentId, updatedAt: now });
      }
      tx.update(draftRef, {
        status: draftComplete ? 'approved' : 'partial', paymentStatus: draftComplete ? 'paid' : 'partial',
        paidAmountUGX: draftPaid + amountUGX, balanceUGX: draftRemaining, paymentReference: externalReference,
        excludeFromOpexRollup: true, updatedAt: now, lastPaymentId: paymentId,
        ...(draftComplete ? { issuedAt: now, issuedBy: actor.uid } : {}),
      });
      return { paymentId, alreadyProcessed: false, remainingUGX: plan.remainingUGX };
    });
  } catch (error) {
    return recoverSupplierPayment(connection, 'creditPayments', paymentId, payment, error);
  }
}
