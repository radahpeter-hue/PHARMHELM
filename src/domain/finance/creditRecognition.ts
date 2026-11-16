import { timestampBusinessDate, isBusinessDate } from '../../utils/eodBusinessDate';

/** One receivable per POS sale. Recognition never posts cash or another sale. */
export type CreditDebtorType = 'client' | 'institution';
export const CREDIT_METHODS = ['institutional_credit', 'credit'];
type Row = Record<string, any>;
export const CREDIT_SPLIT_TENDER = ['cash', 'mtn_momo', 'airtel_money', 'card', 'momo', 'airtel'];
export const isCreditMethod = (method: unknown): boolean => typeof method === 'string' && CREDIT_METHODS.includes(method);
export function creditDebtorReference(request: Row): { type: CreditDebtorType; id: string; collection: string } {
  const institution = request.institutionId;
  const client = request.patientId || request.customerId || request.clientId;
  const id = institution || client;
  if (typeof id !== 'string' || !id.trim() || id.includes('/')) throw new Error('Select a registered client or billable institution for credit.');
  return { type: institution ? 'institution' : 'client', id, collection: institution ? 'institutions' : 'clients' };
}
export function debtorName(type: CreditDebtorType, master: Row): string {
  return type === 'institution'
    ? master.supplier_name || master.institution_name || master.name || ''
    : master.full_name || master.fullName || master.name || '';
}
export function assertCreditDebtor(reference: ReturnType<typeof creditDebtorReference>, master: Row, tenantId: string, branchId: string) {
  const status = String(master.care_status || master.status || 'active').toLowerCase();
  if (master.tenantId !== tenantId || master.active === false || master.isActive === false
    || !['active'].includes(status) || !debtorName(reference.type, master)
    || master.billingEligible === false || master.billing_eligible === false || master.creditEligible === false || master.credit_eligible === false
    || (reference.type === 'institution' && !['billable', 'both'].includes(String(master.role || 'billable').toLowerCase()))
    || (master.branch_id && master.branch_id !== branchId) || (master.branchId && master.branchId !== branchId)) {
    throw new Error('The registered debtor is not eligible for credit in this tenant and branch.');
  }
  if (reference.type === 'client' && master.billing_type === 'institutional-pay') throw new Error('Select the client’s registered billing institution.');
}
/** Unknown terms stay unknown. No retrospective due-date invention. */
export function creditTerms(master: Row): string | null {
  return typeof master.payment_terms === 'string' ? master.payment_terms : null;
}
export function approvedDueDate(created: string, terms: string | null): string | null {
  const normalized = terms?.trim() || '';
  const match = normalized.match(/^(?:credit\s*(?:[-–—]\s*)?(\d{1,3})\s*days?|net\s*(\d{1,3})(?:\s*days?)?)$/i);
  const days = /^(immediate|due on receipt|cash on delivery)$/i.test(normalized) ? 0 : match ? Number(match[1] || match[2]) : null;
  const businessDate = isBusinessDate(created) ? created : timestampBusinessDate(created);
  if (!businessDate || days === null) return null;
  const date = new Date(businessDate + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function buildCreditRecognition(sale: Row, payment: Row, master: Row) {
  const reference = creditDebtorReference(sale);
  assertCreditDebtor(reference, master, sale.tenantId, sale.branchId);
  const credit = (payment.components || []).filter((row: Row) => CREDIT_METHODS.includes(row.method));
  const amount = credit[0]?.amount;
  if (credit.length !== 1 || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER
    || payment.outstandingAmount !== amount || Math.abs(payment.settledAmount + amount - payment.amount) > 0.0001 || sale.totalAmount !== payment.amount
    || payment.saleId !== sale.id || payment.tenantId !== sale.tenantId || payment.branchId !== sale.branchId
    || payment.paymentId !== sale.canonicalPaymentId) throw new Error('Credit must reconcile to the canonical sale and unpaid payment component.');
  const terms = creditTerms(master);
  return {
    tenantId: sale.tenantId, branch_id: sale.branchId, receipt_id: sale.id,
    paymentId: payment.paymentId, invoice_number: sale.receiptNumber,
    debtorType: reference.type, debtorId: reference.id, client_id: sale.patientId || sale.customerId || sale.clientId || null,
    institution_id: sale.institutionId || null, client_name: debtorName(reference.type, master),
    invoice_amount_ugx: payment.amount, amount_ugx: amount, outstanding_ugx: amount,
    status: 'outstanding', credit_terms: terms, due_date: null,
    created_at: sale.timestamp, originalSaleId: sale.revisionOfSaleId || sale.id, recognizedBy: payment.operatorUid,
    source: 'POS', engineVersion: 2, controlVersion: 2, currency: 'UGX'
  };
}
