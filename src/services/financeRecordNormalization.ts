export function financialDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateInRange(value: any, start: string, end: string): boolean {
  const date = financialDate(value);
  if (!date) return false;
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T23:59:59.999`);
  return date >= startDate && date <= endDate;
}

export function normalizeInvoiceRecord(id: string, data: any) {
  const rawStatus = String(data.paymentStatus || data.payment_type || data.status || '').toLowerCase();
  const paymentStatus = rawStatus === 'paid' ? 'cash'
    : rawStatus === 'unpaid' ? 'credit'
      : rawStatus === 'paid-in-full' ? 'paid'
        : rawStatus || 'credit';
  return {
    ...data,
    id,
    invoiceRef: data.invoiceRef || data.invoice_number || data.invoiceNumber || id,
    grnId: data.grnId || data.grn_id || data.grn_number || '',
    branchId: data.branchId || data.branch_id || '',
    branchName: data.branchName || data.branch_name || data.destination_branch_name || 'Unknown Branch',
    supplierId: data.supplierId || data.supplier_id || '',
    supplierName: data.supplierName || data.supplier_name || 'Unknown Supplier',
    invoiceValue: Number(data.invoiceValue ?? data.amount ?? data.total_amount_ugx ?? 0),
    paymentStatus,
    creditBalance: Number(data.creditBalance ?? (paymentStatus === 'credit' ? (data.amount ?? data.total_amount_ugx ?? 0) : 0)),
    createdAt: data.createdAt || data.created_at || data.invoiceDate || data.invoice_date,
    updatedAt: data.updatedAt || data.updated_at || data.createdAt || data.created_at
  };
}

export function normalizeCreditRecord(id: string, data: any) {
  const rawStatus = String(data.status || '').toLowerCase();
  const status = rawStatus === 'unpaid' || rawStatus === 'pending' ? 'outstanding' : rawStatus || 'outstanding';
  return {
    ...data,
    id,
    invoiceId: data.invoiceId || data.invoice_id || '',
    invoiceRef: data.invoiceRef || data.invoiceNumber || data.invoice_number || id,
    grnId: data.grnId || data.grn_id || data.grnRef || '',
    supplierId: data.supplierId || data.supplier_id || '',
    supplierName: data.supplierName || data.supplier_name || 'Unknown Supplier',
    branchId: data.branchId || data.branch_id || '',
    branchName: data.branchName || data.branch_name || 'Unknown Branch',
    originalCreditAmount: Number(data.originalCreditAmount ?? data.amount ?? data.amount_ugx ?? 0),
    remainingCreditBalance: Number(data.remainingCreditBalance ?? data.balance ?? data.amount_ugx ?? 0),
    status,
    creditAccruedAt: data.creditAccruedAt || data.createdAt || data.created_at || data.date,
    lastProcessedAt: data.lastProcessedAt || data.updatedAt || data.updated_at || null,
    createdAt: data.createdAt || data.created_at || data.creditAccruedAt
  };
}

export function calculateCreditSettlement(remainingBefore: number, payment: number) {
  if (!Number.isFinite(remainingBefore) || remainingBefore < 0) throw new Error('Invalid outstanding balance.');
  if (!Number.isFinite(payment) || payment <= 0) throw new Error('Payment must be greater than zero.');
  if (payment > remainingBefore) throw new Error('Payment exceeds the outstanding balance.');
  const remainingAfter = remainingBefore - payment;
  return { remainingAfter, status: remainingAfter === 0 ? 'paid' as const : 'partial' as const };
}
