/** One receivable per POS sale. Recognition never posts cash or another sale. */
export type CreditDebtorType = 'client' | 'institution';
export const CREDIT_METHODS = ['institutional_credit', 'credit', 'insurance'];
type Row = Record<string, any>;
export function safeUGX(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function creditDebtorReference(request: Row): { type: CreditDebtorType; id: string; collection: string } {
  const institution = request.institutionId;
  const client = request.patientId || request.customerId;
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
  const match = terms?.match(/^(?:credit\s*(?:[-–—]\s*)?(30|60|90)\s*days|net\s*(30|60|90))$/i);
  if (!match) return null;
  const date = new Date(created);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid credit sale date.');
  date.setUTCDate(date.getUTCDate() + Number(match[1] || match[2]));
  return date.toISOString().slice(0, 10);
}
export function buildCreditRecognition(sale: Row, payment: Row, master: Row) {
  const reference = creditDebtorReference(sale);
  assertCreditDebtor(reference, master, sale.tenantId, sale.branchId);
  const credit = (payment.components || []).filter((row: Row) => CREDIT_METHODS.includes(row.method));
  const amount = credit.reduce((sum: number, row: Row) => sum + row.amount, 0);
  if (credit.length !== 1 || !safeUGX(amount) || amount <= 0 || !safeUGX(payment.amount)
    || !safeUGX(payment.settledAmount) || payment.outstandingAmount !== amount
    || payment.settledAmount + amount !== payment.amount || sale.totalAmount !== payment.amount
    || payment.saleId !== sale.id || payment.tenantId !== sale.tenantId || payment.branchId !== sale.branchId
    || payment.paymentId !== sale.canonicalPaymentId) throw new Error('Credit must reconcile to the canonical sale and unpaid payment component.');
  const terms = creditTerms(master);
  return {
    tenantId: sale.tenantId, branch_id: sale.branchId, receipt_id: sale.id,
    paymentId: payment.paymentId, invoice_number: sale.receiptNumber,
    debtorType: reference.type, debtorId: reference.id, client_id: sale.patientId || sale.customerId || null,
    institution_id: sale.institutionId || null, client_name: debtorName(reference.type, master),
    invoice_amount_ugx: payment.amount, amount_ugx: amount, outstanding_ugx: amount,
    status: 'outstanding', credit_terms: terms, due_date: null,
    created_at: sale.timestamp, recognizedBy: payment.operatorUid,
    source: 'POS', engineVersion: 2, controlVersion: 2, currency: 'UGX'
  };
}

/** Legacy rows are visible evidence, never implicitly promoted into certified balances. */
export function buildReceivablesRegister(records: Row[], sales: Row[], clients: Row[], institutions: Row[], branches: Row[]) {
  const rows: Row[] = [], sourceIds = new Set<string>();
  const counts = new Map<string, number>();
  for (const row of records) if (row.receipt_id) counts.set(row.receipt_id, (counts.get(row.receipt_id) || 0) + 1);
  for (const record of records) {
    const sale = sales.find(s => s.id === record.receipt_id);
    const verified = record.controlVersion === 2 && record.id === record.receipt_id && counts.get(record.receipt_id) === 1
      && sale?.canonicalPaymentId === record.paymentId && sale?.tenantId === record.tenantId
      && sale?.branchId === record.branch_id && safeUGX(record.amount_ugx) && safeUGX(record.outstanding_ugx)
      && record.outstanding_ugx <= record.amount_ugx;
    const master = (record.debtorType === 'institution' ? institutions : clients).find(m => m.id === record.debtorId && m.tenantId === record.tenantId);
    const branch = branches.find(b => b.id === record.branch_id);
    sourceIds.add(record.receipt_id);
    rows.push({ ...record, sourceSale: sale, verified, client_name: master ? debtorName(record.debtorType, master) : record.client_name || 'Unverified debtor',
      contact: master?.phone_number || master?.institution_phone || master?.phone || '',
      branch_name: branch?.name || branch?.branch_name || branch?.branchName || record.branch_id,
      due_date: verified ? approvedDueDate(record.createdAt?.toDate?.().toISOString() || record.created_at, record.credit_terms) : null,
      collectedUGX: verified && record.status !== 'reversed' ? record.amount_ugx - record.outstanding_ugx : null,
      exception: !verified ? 'Historical or duplicate record requires reconciliation' : !master ? 'CRM identity unavailable' : !approvedDueDate(record.created_at, record.credit_terms) ? 'Due date unverified' : null });
  }
  for (const sale of sales) {
    if (sourceIds.has(sale.id) || ['voided', 'reversed', 'superseded'].includes(sale.status)
      || sale.supersededBySaleId || sale.isSuperseded
      || !CREDIT_METHODS.includes(sale.paymentMethod) && !CREDIT_METHODS.includes(sale.secondaryPaymentMethod)) continue;
    rows.push({ id: `missing_${sale.id}`, receipt_id: sale.id, invoice_number: sale.receiptNumber, branch_id: sale.branchId,
      branch_name: branches.find(b => b.id === sale.branchId)?.name || sale.branchId,
      client_name: sale.institutionName || sale.patientName || 'Unverified debtor', created_at: sale.timestamp,
      verified: false, status: 'unverified', due_date: null, exception: 'Source sale has no recognized receivable' });
  }
  return rows;
}
