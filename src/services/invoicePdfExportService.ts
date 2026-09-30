import { jsPDF } from 'jspdf';
import { describeSaleItemQuantity } from './saleTierHistoryService';

interface InvoicePdfBranding {
  companyName: string;
  address: string;
  phone: string;
  email: string;
  ndaReg: string;
  receiptFooter: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankBranch?: string;
}

interface InvoicePdfInput {
  receipt: any;
  branchName: string;
  sellerName: string;
  branding: InvoicePdfBranding;
}

const money = (value: unknown) => `UGX ${Number(value || 0).toLocaleString()}`;

const safeDate = (value: unknown) => {
  const date = new Date(value as any);
  return Number.isNaN(date.getTime()) ? 'Date not available' : date.toLocaleDateString();
};

const clean = (value: unknown, fallback = '') => String(value ?? fallback).trim();

const downloadBlob = (blob: Blob, filename: string) => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
};

/**
 * Deterministic invoice PDF generation for browsers, including mobile Safari.
 *
 * Deliberately does not rasterize the live React DOM. The previous html2canvas
 * path was fragile on iOS Safari. This follows the proven quotation-export
 * pattern: render from already-loaded business data into jsPDF, output a Blob,
 * and download through an object URL. It is read-only and does not write sale data.
 */
export const exportInvoicePdf = ({ receipt, branchName, sellerName, branding }: InvoicePdfInput) => {
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let y = 16;

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageHeight - 18) return;
    pdf.addPage();
    y = 18;
  };

  const line = (x1: number, y1: number, x2: number, y2: number) => {
    pdf.setDrawColor(220, 220, 220);
    pdf.line(x1, y1, x2, y2);
  };

  pdf.setTextColor(20, 20, 20);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text(clean(branding.companyName, 'PharmHelm Pharmacy'), margin, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(90, 90, 90);
  pdf.text(clean(branding.address), margin, y + 5);
  pdf.text(`Phone: ${clean(branding.phone)} | Email: ${clean(branding.email)}`, margin, y + 9);
  pdf.text(`NDA Lic No: ${clean(branding.ndaReg)}`, margin, y + 13);

  pdf.setTextColor(4, 120, 87);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text('INVOICE', pageWidth - margin, y, { align: 'right' });
  pdf.setTextColor(70, 70, 70);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.text(`Invoice No: ${clean(receipt.receiptNumber, 'Not available')}`, pageWidth - margin, y + 5, { align: 'right' });
  pdf.text(`Date: ${safeDate(receipt.timestamp)}`, pageWidth - margin, y + 9, { align: 'right' });
  pdf.text(`Branch: ${clean(branchName, 'Branch not available')}`, pageWidth - margin, y + 13, { align: 'right' });
  pdf.text(`Served By: ${clean(sellerName, 'Operator')}`, pageWidth - margin, y + 17, { align: 'right' });
  y += 25;
  line(margin, y, pageWidth - margin, y);
  y += 7;

  const billedTo = clean(receipt.institutionName || receipt.patientName);
  if (billedTo) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text(receipt.institutionName ? 'BILL TO INSTITUTION' : 'BILL TO CLIENT', margin, y);
    pdf.setFontSize(11);
    pdf.setTextColor(25, 25, 25);
    pdf.text(billedTo, margin, y + 5);
    const identity = clean(receipt.institutionId || receipt.patientId);
    if (identity) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`ID: ${identity}`, margin, y + 10);
    }
    y += 16;
  }

  const cols = {
    no: margin,
    item: margin + 8,
    generic: margin + 48,
    batch: margin + 82,
    qty: margin + 121,
    unit: margin + 141,
    total: pageWidth - margin,
  };

  const drawTableHeader = () => {
    pdf.setFillColor(245, 247, 247);
    pdf.rect(margin, y, contentWidth, 8, 'F');
    pdf.setTextColor(80, 80, 80);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text('#', cols.no + 1, y + 5);
    pdf.text('Item', cols.item, y + 5);
    pdf.text('Generic', cols.generic, y + 5);
    pdf.text('Batch / Expiry', cols.batch, y + 5);
    pdf.text('Qty', cols.qty, y + 5);
    pdf.text('Unit Price', cols.unit, y + 5);
    pdf.text('Total', cols.total, y + 5, { align: 'right' });
    y += 9;
  };

  drawTableHeader();
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  items.forEach((item: any, index: number) => {
    ensureSpace(15);
    if (y < 25) drawTableHeader();

    const quantity = describeSaleItemQuantity(item);
    const allocations = Array.isArray(item.batchAllocations) && item.batchAllocations.length > 1
      ? item.batchAllocations.map((a: any) => `${clean(a.batchNumber, 'N/A')}: ${Number(a.baseQuantity || 0)}`).join(', ')
      : clean(item.batchNumber, 'N/A');
    const expiry = clean(item.expiryDate);
    const itemName = clean(item.productName, 'Unnamed item');
    const generic = clean(item.genericName, 'N/A');
    const unitPrice = Number(item.actualUnitPrice ?? item.unitPrice ?? 0);
    const lineTotal = Number(item.lineTotal ?? item.subtotal ?? item.total ?? (Number(item.quantity || 0) * unitPrice));

    pdf.setFontSize(7.2);
    pdf.setTextColor(45, 45, 45);
    pdf.setFont('helvetica', 'normal');
    pdf.text(String(index + 1), cols.no + 1, y + 4);
    pdf.setFont('helvetica', 'bold');
    pdf.text(pdf.splitTextToSize(itemName, 37).slice(0, 2), cols.item, y + 4);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(95, 95, 95);
    pdf.text(pdf.splitTextToSize(generic, 31).slice(0, 2), cols.generic, y + 4);
    pdf.text(pdf.splitTextToSize(expiry ? `${allocations}\nExp: ${expiry}` : allocations, 36).slice(0, 2), cols.batch, y + 4);
    pdf.setTextColor(45, 45, 45);
    pdf.setFont('helvetica', 'bold');
    pdf.text(clean(quantity.commercialText, String(item.quantity ?? '')), cols.qty, y + 4);
    pdf.setFont('helvetica', 'normal');
    pdf.text(money(unitPrice), cols.unit, y + 4);
    pdf.setFont('helvetica', 'bold');
    pdf.text(money(lineTotal), cols.total, y + 4, { align: 'right' });
    y += 12;
    line(margin, y, pageWidth - margin, y);
    y += 2;
  });

  ensureSpace(48);
  y += 4;
  const totalsX = 125;
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(90, 90, 90);
  pdf.text('Subtotal', totalsX, y);
  pdf.setTextColor(35, 35, 35);
  pdf.text(money(receipt.subtotal), pageWidth - margin, y, { align: 'right' });
  y += 6;
  if (Number(receipt.discountAmount || 0) > 0) {
    pdf.setTextColor(170, 50, 50);
    pdf.text(`Discount (${Number(receipt.discountPercentage || 0)}%)`, totalsX, y);
    pdf.text(`- ${money(receipt.discountAmount)}`, pageWidth - margin, y, { align: 'right' });
    y += 6;
  }
  pdf.setTextColor(90, 90, 90);
  pdf.text('VAT / Tax Total', totalsX, y);
  pdf.setTextColor(35, 35, 35);
  pdf.text(money(receipt.taxAmount), pageWidth - margin, y, { align: 'right' });
  y += 4;
  line(totalsX, y, pageWidth - margin, y);
  y += 7;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('Grand Total', totalsX, y);
  pdf.text(money(receipt.totalAmount), pageWidth - margin, y, { align: 'right' });
  y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(100, 100, 100);
  pdf.text(`Settled via: ${clean(receipt.paymentMethod, 'Not recorded').replace('_', ' ').toUpperCase()}`, pageWidth - margin, y, { align: 'right' });

  if (branding.bankAccountNumber) {
    ensureSpace(32);
    y += 10;
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(4, 120, 87);
    pdf.text('DIRECT BANK REMITTANCE INFO', margin, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(75, 75, 75);
    pdf.text(`Bank: ${clean(branding.bankName)}`, margin, y + 5);
    pdf.text(`Account Name: ${clean(branding.bankAccountName)}`, margin, y + 10);
    pdf.text(`Account No: ${clean(branding.bankAccountNumber)}`, margin, y + 15);
    pdf.text(`Branch: ${clean(branding.bankBranch)}`, margin, y + 20);
    y += 24;
  }

  ensureSpace(34);
  y += 10;
  line(margin, y, pageWidth - margin, y);
  y += 8;
  pdf.setFontSize(8);
  pdf.setTextColor(110, 110, 110);
  pdf.text('Received By:', margin, y);
  pdf.text('Authorised By:', pageWidth - margin, y, { align: 'right' });
  y += 13;
  line(margin, y, margin + 55, y);
  line(pageWidth - margin - 55, y, pageWidth - margin, y);
  pdf.setFontSize(7);
  pdf.text('Customer Signature & Date', margin, y + 4);
  pdf.text(`${clean(branding.companyName)} Representative`, pageWidth - margin, y + 4, { align: 'right' });

  pdf.setFontSize(8);
  pdf.setTextColor(130, 130, 130);
  pdf.text(clean(branding.receiptFooter, 'Thank you for your business!'), pageWidth / 2, pageHeight - 9, { align: 'center' });

  const blob = pdf.output('blob');
  downloadBlob(blob, `Invoice_${clean(receipt.receiptNumber, 'receipt')}.pdf`);
};
