import { Sale } from '../types';

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
  const items = (sale.items || []).map(item => {
    const lineTotal = item.subtotal ?? item.total ?? (item.quantity * item.unitPrice);
    return `
      <tr><td colspan="3" class="item-name">${escapeHtml(item.productName || item.name)}</td></tr>
      <tr class="item-line"><td>${escapeHtml(item.quantity)} × ${Number(item.unitPrice || 0).toLocaleString()}</td><td>${escapeHtml(item.batchNumber || '')}</td><td>${Number(lineTotal).toLocaleString()}</td></tr>`;
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
      .item-line td { padding-bottom: 3px; color: #444; font-size: 9px; }
      .item-line td:nth-child(2) { text-align: center; overflow-wrap: anywhere; }
      .total { font-size: 13px; font-weight: 900; padding-top: 4px; }
      .duplicate { font-weight: 800; margin-top: 8px; }
      @media print { body { width: 72mm; } }
    </style></head><body>
      ${branding.logoUrl ? `<img class="logo" src="${escapeHtml(branding.logoUrl)}" alt="">` : ''}
      <div class="center"><div class="company strong">${escapeHtml(branding.companyName)}</div>
      <div>${escapeHtml(branding.address || '')}</div><div>${escapeHtml(branding.phone || '')}</div>
      ${branding.ndaRegistration ? `<div>NDA Licence: ${escapeHtml(branding.ndaRegistration)}</div>` : ''}</div>
      <div class="rule"></div>
      <div class="row"><span>Receipt</span><span class="strong">${escapeHtml(sale.receiptNumber || sale.id)}</span></div>
      <div class="row"><span>Date</span><span>${escapeHtml(new Date(sale.timestamp).toLocaleString())}</span></div>
      <div class="row"><span>Context</span><span>${escapeHtml((sale.context || 'walk-in').replace('-', ' ').toUpperCase())}</span></div>
      ${sale.patientName ? `<div class="row"><span>Customer</span><span>${escapeHtml(sale.patientName)}</span></div>` : ''}
      ${sale.institutionName ? `<div class="row"><span>Institution</span><span>${escapeHtml(sale.institutionName)}</span></div>` : ''}
      <div class="row"><span>Cashier</span><span>${escapeHtml(cashierName)}</span></div>
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
