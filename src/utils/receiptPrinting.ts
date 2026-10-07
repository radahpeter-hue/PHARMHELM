import { Sale } from '../types';
import { describeSaleItemQuantity } from '../services/saleTierHistoryService';
import { getPosV2RevisionReceiptPresentation } from '../services/pos-v2/posSaleRevisionV2Presentation';

export interface ReceiptBranding {
  companyName: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  ndaRegistration?: string;
  footer?: string;
}

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

export const openReceiptPrintWindow = () => {
  const printWindow = window.open('', '_blank', 'width=420,height=720');
  if (printWindow) {
    printWindow.document.write('<!doctype html><title>Preparing receipt</title><p style="font-family:sans-serif;padding:24px">Preparing receipt…</p>');
  }
  return printWindow;
};

export const buildReceiptRevisionPlainText = (sale: Sale, operatorName: string): string => {
  const presentation = getPosV2RevisionReceiptPresentation(sale);
  const operatorLabel = presentation.kind === 'CORRECTED_RECEIPT'
    ? 'Replacement executor'
    : presentation.isRevisionRelated
      ? 'Original seller'
      : 'Cashier';
  const lines = [presentation.documentTitle, `${operatorLabel}: ${operatorName}`];
  if (presentation.linkedReceiptNumber && presentation.linkedReceiptLabel) {
    lines.push(`${presentation.linkedReceiptLabel}: ${presentation.linkedReceiptNumber}`);
  }
  if (presentation.revisionId) lines.push(`Revision reference: ${presentation.revisionId}`);
  if (presentation.revisionRequestId) lines.push(`Request reference: ${presentation.revisionRequestId}`);
  if (presentation.editorName) lines.push(`Revision editor: ${presentation.editorName}`);
  if (sale.originalSellerId) lines.push(`Original seller reference: ${sale.originalSellerId}`);
  if (sale.revisionRecordedAt) lines.push(`Edited at: ${new Date(sale.revisionRecordedAt).toLocaleString('en-GB', { timeZone: 'Africa/Kampala' })}`);
  if (presentation.reason) lines.push(`Correction reason: ${presentation.reason}`);
  return lines.join('\n');
};

export const printThermalReceipt = (
  sale: Sale,
  branding: ReceiptBranding,
  cashierName: string,
  duplicate = false,
  existingWindow?: Window | null
) => {
  const printWindow = existingWindow || openReceiptPrintWindow();
  if (!printWindow) return false;

  const total = sale.totalAmount ?? sale.total ?? 0;
  const subtotal = sale.subtotal ?? total;
  const tax = sale.taxAmount ?? sale.tax ?? 0;
  const discount = sale.discountAmount ?? 0;
  const revisionPresentation = getPosV2RevisionReceiptPresentation(sale);
  const operatorLabel = revisionPresentation.kind === 'CORRECTED_RECEIPT'
    ? 'Replacement Executor'
    : revisionPresentation.isRevisionRelated
      ? 'Original Seller'
      : 'Cashier';
  const revisionLinkage = revisionPresentation.isRevisionRelated ? `
      <div class="revision-banner">${escapeHtml(revisionPresentation.documentTitle)}</div>
      ${revisionPresentation.linkedReceiptNumber && revisionPresentation.linkedReceiptLabel ? `<div class="row"><span>${escapeHtml(revisionPresentation.linkedReceiptLabel)}</span><span class="strong">${escapeHtml(revisionPresentation.linkedReceiptNumber)}</span></div>` : ''}
      ${revisionPresentation.revisionId ? `<div class="row"><span>Revision Ref</span><span>${escapeHtml(revisionPresentation.revisionId)}</span></div>` : ''}
      ${revisionPresentation.revisionRequestId ? `<div class="row"><span>Request Ref</span><span>${escapeHtml(revisionPresentation.revisionRequestId)}</span></div>` : ''}
      ${sale.originalSellerId ? `<div class="row"><span>Original Seller Ref</span><span>${escapeHtml(sale.originalSellerId)}</span></div>` : ''}
      ${sale.revisionRecordedAt ? `<div class="row"><span>Edited At</span><span>${escapeHtml(new Date(sale.revisionRecordedAt).toLocaleString('en-GB', { timeZone: 'Africa/Kampala' }))}</span></div>` : ''}
      ${revisionPresentation.editorName ? `<div class="row"><span>Revision Editor</span><span>${escapeHtml(revisionPresentation.editorName)}</span></div>` : ''}
      ${revisionPresentation.reason ? `<div class="revision-reason"><span class="strong">Correction Reason:</span> ${escapeHtml(revisionPresentation.reason)}</div>` : ''}
      <div class="rule"></div>` : '';
  const items = (sale.items || []).map(item => {
    const lineTotal = item.lineTotal ?? item.subtotal ?? item.total ?? (item.quantity * item.unitPrice);
    const quantity = describeSaleItemQuantity(item);
    const batchSummary = item.batchAllocations && item.batchAllocations.length > 1
      ? item.batchAllocations.map(allocation => `${allocation.batchNumber}:${allocation.baseQuantity}`).join(', ')
      : item.batchNumber || '';
    return `
      <tr><td colspan="3" class="item-name">${escapeHtml(item.productName || item.name)}</td></tr>
      <tr class="item-line"><td>${escapeHtml(quantity.commercialText)} × ${Number(item.actualUnitPrice ?? item.unitPrice ?? 0).toLocaleString()}${quantity.baseText ? `<div class="base-qty">${escapeHtml(quantity.baseText)}</div>` : ''}</td><td>${escapeHtml(batchSummary)}</td><td>${Number(lineTotal).toLocaleString()}</td></tr>`;
  }).join('');

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(sale.receiptNumber || sale.id)}</title>
    <style>
      @page { size: 80mm auto; margin: 3mm; }
      * { box-sizing: border-box; }
      body { width: 72mm; margin: 0 auto; color: #111; background: #fff; font: 10px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .center { text-align: center; } .strong { font-weight: 800; } .company { font-size: 14px; margin: 4px 0; }
      .logo { max-width: 38mm; max-height: 14mm; object-fit: contain; margin: 0 auto 4px; display: block; }
      .rule { border-top: 1px dashed #555; margin: 7px 0; }
      .row { display: flex; justify-content: space-between; gap: 8px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th { border-bottom: 1px dashed #555; padding: 3px 0; text-align: left; }
      th:last-child, td:last-child { text-align: right; }
      .item-name { padding-top: 4px; font-weight: 700; overflow-wrap: anywhere; }
      .item-line td { padding-bottom: 3px; color: #444; font-size: 9px; vertical-align: top; }
      .item-line td:nth-child(2) { text-align: center; overflow-wrap: anywhere; }
      .base-qty { color: #666; font-size: 8px; margin-top: 1px; }
      .total { font-size: 13px; font-weight: 900; padding-top: 4px; }
      .duplicate { font-weight: 800; margin-top: 8px; }
      .revision-banner { border: 2px solid #111; padding: 4px; margin: 6px 0; text-align: center; font-size: 12px; font-weight: 900; }
      .revision-reason { margin-top: 4px; overflow-wrap: anywhere; }
      @media print { body { width: 72mm; } }
    </style></head><body>
      ${branding.logoUrl ? `<img class="logo" src="${escapeHtml(branding.logoUrl)}" alt="">` : ''}
      <div class="center"><div class="company strong">${escapeHtml(branding.companyName)}</div>
      <div>${escapeHtml(branding.address || '')}</div><div>${escapeHtml(branding.phone || '')}</div>
      ${branding.ndaRegistration ? `<div>NDA Licence: ${escapeHtml(branding.ndaRegistration)}</div>` : ''}</div>
      <div class="rule"></div>
      ${revisionLinkage}
      <div class="row"><span>Receipt</span><span class="strong">${escapeHtml(sale.receiptNumber || sale.id)}</span></div>
      <div class="row"><span>Date</span><span>${escapeHtml(new Date(sale.timestamp).toLocaleString())}</span></div>
      <div class="row"><span>Context</span><span>${escapeHtml((sale.context || 'walk-in').replace('-', ' ').toUpperCase())}</span></div>
      ${sale.patientName ? `<div class="row"><span>Customer</span><span>${escapeHtml(sale.patientName)}</span></div>` : ''}
      ${sale.institutionName ? `<div class="row"><span>Institution</span><span>${escapeHtml(sale.institutionName)}</span></div>` : ''}
      <div class="row"><span>${operatorLabel}</span><span>${escapeHtml(cashierName)}</span></div>
      <div class="rule"></div>
      <table><thead><tr><th>Item / Qty</th><th>Batch</th><th>Total</th></tr></thead><tbody>${items}</tbody></table>
      <div class="rule"></div>
      <div class="row"><span>Subtotal</span><span>UGX ${Number(subtotal).toLocaleString()}</span></div>
      ${discount > 0 ? `<div class="row"><span>Discount</span><span>- UGX ${Number(discount).toLocaleString()}</span></div>` : ''}
      ${tax > 0 ? `<div class="row"><span>VAT</span><span>UGX ${Number(tax).toLocaleString()}</span></div>` : ''}
      <div class="row total"><span>TOTAL</span><span>UGX ${Number(total).toLocaleString()}</span></div>
      <div class="row"><span>Payment</span><span>${escapeHtml((sale.paymentMethod || '').replaceAll('_', ' ').toUpperCase())}</span></div>
      <div class="rule"></div><div class="center">${escapeHtml(branding.footer || 'Thank you for your business!')}</div>
      ${duplicate ? '<div class="center duplicate">DUPLICATE REPRINT</div>' : ''}
      <script>window.onload=()=>{setTimeout(()=>{window.print();window.close();},200)};<\/script>
    </body></html>`);
  printWindow.document.close();
  return true;
};
