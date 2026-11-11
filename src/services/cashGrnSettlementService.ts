import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { planCashGrnSettlement } from './cashGrnSettlementPolicy';
import {
  checkSupplierPaymentReplay, readSupplierFunding, readSupplierPayer, recoverSupplierPayment,
  stageSupplierPayment, supplierPaymentAudit, validateSupplierPayment, type SupplierPaymentInput,
} from './supplierPaymentPosting';

/** Reuse requestId for retries and use a new ID for each installment. */
export type CashGrnSettlementInput = SupplierPaymentInput;

/** Supplier invoice, draft, GRN, account and ledgers settle in one transaction. */
export async function settleCashGrnDraft(input: CashGrnSettlementInput, connection: Firestore = db) {
  const payment = validateSupplierPayment(input);
  const { tenantId, draftId, requestId, amountUGX, externalReference, actor } = payment;
  const paymentId = `procurement_cash_settlement_${tenantId}_${draftId}_${requestId}`;
  const paymentRef = doc(connection, 'cash_grn_payments', paymentId);
  try {
    return await runTransaction(connection, async tx => {
      const payer = await readSupplierPayer(tx, connection, payment);
      const priorPayment = await tx.get(paymentRef);
      if (priorPayment.exists()) {
        return { paymentId, alreadyProcessed: true, remainingUGX: checkSupplierPaymentReplay(priorPayment.data(), payment) };
      }
      const draftRef = doc(connection, 'management_expenses', draftId);
      const [draftSnap, settings] = await Promise.all([
        tx.get(draftRef), tx.get(doc(connection, 'system_settings', tenantId)),
      ]);
      if (settings.data()?.managementCashSettlementV1 !== true) {
        throw new Error('Supplier settlement is awaiting Finance release activation.');
      }
      const draft = draftSnap.data();
      if (!draft || draft.tenantId !== tenantId || draft.source !== 'procurement_cash_grn' ||
          draft.excludeFromOpexRollup !== true || !draft.grnId || !draft.invoiceId ||
          !['draft', 'partial'].includes(draft.status)) {
        throw new Error('This Cash GRN draft is unavailable or has been settled.');
      }
      const invoiceRef = doc(connection, 'invoices', draft.invoiceId);
      const grnRef = doc(connection, 'grn_records', draft.grnId);
      const [invoiceSnap, grnSnap] = await Promise.all([tx.get(invoiceRef), tx.get(grnRef)]);
      const invoice = invoiceSnap.data();
      const grn = grnSnap.data();
      if (!invoice || !grn || invoice.tenantId !== tenantId || grn.tenantId !== tenantId ||
          invoice.grnId !== grnRef.id || grn.invoice_id !== invoiceRef.id ||
          !grn.procurement_invoice_id || grn.payment_type !== 'cash') {
        throw new Error('Missing or mismatched canonical supplier invoice records.');
      }
      const legacyInvoiceRef = doc(connection, 'procurement_invoices', grn.procurement_invoice_id);
      const legacy = (await tx.get(legacyInvoiceRef)).data();
      if (!legacy || legacy.tenantId !== tenantId || legacy.grnId !== grnRef.id) {
        throw new Error('The Procurement invoice link requires reconciliation.');
      }
      const invoiceAmount = Number(invoice.invoiceValue);
      const alreadyPaid = Number(invoice.paidAmountUGX ?? legacy.paid_amount_ugx ?? 0);
      if (Number(legacy.paid_amount_ugx || 0) !== alreadyPaid || Number(legacy.paidAmountUGX || 0) !== alreadyPaid ||
          Number(draft.paidAmountUGX || 0) !== alreadyPaid || Number(draft.amount) !== invoiceAmount) {
        throw new Error('Invoice and payment draft amounts require reconciliation.');
      }
      const plan = planCashGrnSettlement(invoiceAmount, alreadyPaid, amountUGX);
      const funding = await readSupplierFunding(tx, connection, payment, paymentId);
      const now = serverTimestamp();
      const reference = `PAY-GRN-${requestId}`;
      const paidAmountUGX = alreadyPaid + amountUGX;
      const paid = plan.remainingUGX === 0;
      const invoiceUpdate = {
        paidAmountUGX, paymentStatus: plan.paymentStatus, creditBalance: plan.remainingUGX,
        updatedAt: now, lastPaymentReference: externalReference, lastPaymentId: paymentId,
      };
      tx.set(paymentRef, {
        ...supplierPaymentAudit(payment, payer), ...funding, grnId: grnRef.id, invoiceId: invoiceRef.id,
        invoiceRef: invoice.supplierInvoiceNumber || invoice.invoiceRef || '',
        procurementInvoiceId: legacyInvoiceRef.id, previouslyPaidUGX: alreadyPaid, totalInvoiceUGX: invoiceAmount,
        amountUGX, remainingUGX: plan.remainingUGX, reference,
      });
      stageSupplierPayment(tx, connection, payment, funding, {
        paymentId, invoiceId: invoiceRef.id, grnId: grnRef.id, supplierPosting: 'cash', reference,
      });
      tx.update(invoiceRef, invoiceUpdate);
      tx.update(legacyInvoiceRef, { ...invoiceUpdate, paid_amount_ugx: paidAmountUGX, status: plan.legacyPaymentStatus });
      tx.update(draftRef, {
        status: paid ? 'approved' : 'partial', paymentStatus: paid ? 'paid' : 'partial',
        paidAmountUGX, balanceUGX: plan.remainingUGX, updatedAt: now, lastPaymentId: paymentId,
        ...(paid ? { issuedAt: now, issuedBy: actor.uid } : {}),
      });
      tx.update(grnRef, { payment_status: paid ? 'paid' : 'partial', lastPaymentId: paymentId, updatedAt: now });
      return { paymentId, alreadyProcessed: false, remainingUGX: plan.remainingUGX };
    });
  } catch (error) {
    return recoverSupplierPayment(connection, 'cash_grn_payments', paymentId, payment, error);
  }
}
