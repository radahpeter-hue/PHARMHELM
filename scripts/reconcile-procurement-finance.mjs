import { APPLY, documentsRoot, runQuery, commit } from './firebase-rest-utils.mjs';

const tenantArg = process.argv.find(arg => arg.startsWith('--tenant='));
const tenantId = tenantArg?.split('=')[1]?.trim();
if (!tenantId) throw new Error('Supply exactly one tenant with --tenant=TENANT_ID. The command is dry-run unless --apply is also supplied.');

const value = field => {
  if (!field) return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return Number(field.doubleValue);
  if ('booleanValue' in field) return field.booleanValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('nullValue' in field) return null;
  return undefined;
};
const idOf = document => document.name.split('/').pop();
const get = (document, ...keys) => {
  for (const key of keys) {
    const result = value(document.fields?.[key]);
    if (result !== undefined && result !== '') return result;
  }
  return undefined;
};
const stringValue = v => ({ stringValue: String(v ?? '') });
const numberValue = v => ({ integerValue: String(Math.round(Number(v || 0))) });
const timestampValue = v => ({ timestampValue: new Date(v || Date.now()).toISOString() });

const tenantQuery = collectionId => runQuery({
  from: [{ collectionId }],
  where: { fieldFilter: { field: { fieldPath: 'tenantId' }, op: 'EQUAL', value: { stringValue: tenantId } } }
});

const [grns, invoices, credits, orders] = await Promise.all([
  tenantQuery('grn_records'), tenantQuery('invoices'), tenantQuery('creditLedger'), tenantQuery('stock_orders')
]);
const orderById = new Map(orders.map(order => [idOf(order), order]));
const writes = [];
const report = { scannedCreditGrns: 0, invoiceRepairs: 0, payableRepairs: 0, ambiguous: [], skipped: [] };

const matchOne = (documents, grn, invoiceReference) => {
  const grnId = idOf(grn);
  const grnRef = get(grn, 'grn_number');
  const candidates = documents.filter(document => {
    const linkedGrn = get(document, 'grnId', 'grn_id', 'grnRef', 'grn_number');
    const linkedInvoice = get(document, 'invoiceRef', 'invoiceNumber', 'invoice_number');
    return linkedGrn === grnId || linkedGrn === grnRef || (invoiceReference && linkedInvoice === invoiceReference);
  });
  return candidates.length === 1 ? candidates[0] : candidates.length === 0 ? null : candidates;
};

for (const grn of grns) {
  if (String(get(grn, 'status', 'grn_status') || '').toLowerCase() !== 'completed') continue;
  if (String(get(grn, 'payment_type', 'paymentType') || '').toLowerCase() !== 'credit') continue;
  report.scannedCreditGrns += 1;

  const grnId = idOf(grn);
  const grnRef = get(grn, 'grn_number') || grnId;
  const invoiceReference = get(grn, 'invoice_number', 'invoiceRef') || grnRef;
  const orderId = get(grn, 'order_id');
  const order = orderId ? orderById.get(orderId) : null;
  const branchId = get(grn, 'destination_branch_id', 'branchId', 'branch_id') || (order && get(order, 'requesting_branch_id'));
  const branchName = get(grn, 'destination_branch_name', 'branchName', 'branch_name') || (order && get(order, 'requesting_branch_name'));
  const amount = Number(get(grn, 'total_value_ugx', 'invoiceValue', 'amount') || 0);
  const supplierId = get(grn, 'supplier_id', 'supplierId') || 'UNKNOWN';
  const supplierName = get(grn, 'supplier_name', 'supplierName') || 'Unknown Supplier';
  const originalDate = get(grn, 'invoice_date', 'receivedAt', 'createdAt') || new Date().toISOString();

  if (!branchId || !amount) {
    report.skipped.push({ grnId, reason: 'Missing branch or amount; requires manual review.' });
    continue;
  }

  const invoiceMatch = matchOne(invoices, grn, invoiceReference);
  if (Array.isArray(invoiceMatch)) {
    report.ambiguous.push({ grnId, collection: 'invoices', candidates: invoiceMatch.map(idOf) });
    continue;
  }
  const invoiceId = invoiceMatch ? idOf(invoiceMatch) : `reconciled_invoice_${grnId}`;
  const invoiceFields = {
    tenantId: stringValue(tenantId), invoiceId: stringValue(invoiceId), invoiceRef: stringValue(invoiceReference),
    grnId: stringValue(grnId), grnRef: stringValue(grnRef), supplierId: stringValue(supplierId),
    supplierName: stringValue(supplierName), branchId: stringValue(branchId), branchName: stringValue(branchName || branchId),
    invoiceValue: numberValue(amount), paymentType: stringValue('credit'), paymentStatus: stringValue('credit'),
    creditBalance: numberValue(amount), createdAt: timestampValue(originalDate), updatedAt: timestampValue(new Date())
  };
  writes.push(invoiceMatch ? {
    update: { name: invoiceMatch.name, fields: invoiceFields },
    updateMask: { fieldPaths: Object.keys(invoiceFields) }, currentDocument: { updateTime: invoiceMatch.updateTime }
  } : { update: { name: `${documentsRoot}/invoices/${invoiceId}`, fields: invoiceFields } });
  report.invoiceRepairs += 1;

  const creditMatch = matchOne(credits, grn, invoiceReference);
  if (Array.isArray(creditMatch)) {
    report.ambiguous.push({ grnId, collection: 'creditLedger', candidates: creditMatch.map(idOf) });
    continue;
  }
  const creditId = creditMatch ? idOf(creditMatch) : `reconciled_credit_${grnId}`;
  const existingBalance = creditMatch && get(creditMatch, 'remainingCreditBalance', 'balance');
  const creditFields = {
    tenantId: stringValue(tenantId), invoiceId: stringValue(invoiceId), invoiceRef: stringValue(invoiceReference),
    grnId: stringValue(grnId), grnRef: stringValue(grnRef), supplierId: stringValue(supplierId),
    supplierName: stringValue(supplierName), branchId: stringValue(branchId), branchName: stringValue(branchName || branchId),
    originalCreditAmount: numberValue(amount), remainingCreditBalance: numberValue(existingBalance ?? amount),
    status: stringValue(Number(existingBalance ?? amount) === 0 ? 'paid' : Number(existingBalance ?? amount) < amount ? 'partial' : 'outstanding'),
    creditAccruedAt: timestampValue(originalDate), updatedAt: timestampValue(new Date()),
    reconciledAt: timestampValue(new Date()), reconciliationSource: stringValue('procurement-finance-reconciliation')
  };
  writes.push(creditMatch ? {
    update: { name: creditMatch.name, fields: creditFields },
    updateMask: { fieldPaths: Object.keys(creditFields) }, currentDocument: { updateTime: creditMatch.updateTime }
  } : { update: { name: `${documentsRoot}/creditLedger/${creditId}`, fields: creditFields } });
  writes.push({
    update: {
      name: `${documentsRoot}/financial_posting_audit/reconciliation_${grnId}`,
      fields: {
        tenantId: stringValue(tenantId), action: stringValue('historical_credit_grn_reconciliation'),
        grnId: stringValue(grnId), invoiceId: stringValue(invoiceId), creditLedgerId: stringValue(creditId),
        amount: numberValue(amount), reconciliation: { booleanValue: true }, processedAt: timestampValue(new Date())
      }
    }
  });
  report.payableRepairs += 1;
}
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', tenantId, ...report, writes: writes.length }, null, 2));
if (APPLY) {
  if (report.ambiguous.length) throw new Error('Apply stopped because ambiguous historical matches require manual review.');
  for (let index = 0; index < writes.length; index += 400) await commit(writes.slice(index, index + 400));
  console.log(`Committed ${writes.length} reconciliation writes for tenant ${tenantId}.`);
}
