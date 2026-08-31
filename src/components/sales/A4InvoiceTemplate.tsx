import React, { useEffect, useState } from 'react';
import { X, Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { Sale, SaleItem } from '../../types';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface A4InvoiceTemplateProps {
  receiptId: string;
  isOpen: boolean;
  onClose: () => void;
  activeBranch: any;
  systemSettings: any;
}

export const A4InvoiceTemplate: React.FC<A4InvoiceTemplateProps> = ({
  receiptId,
  isOpen,
  onClose,
  activeBranch,
  systemSettings
}) => {
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && receiptId) {
      setLoading(true);
      const fetchReceipt = async () => {
        try {
          const docRef = doc(db, 'sales', receiptId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setReceipt({ id: docSnap.id, ...docSnap.data() } as Sale);
          } else {
            toast.error('Receipt not found');
            onClose();
          }
        } catch (e: any) {
          console.error(e);
          toast.error('Failed to load receipt: ' + e.message);
          onClose();
        } finally {
          setLoading(false);
        }
      };
      fetchReceipt();
    }
  }, [isOpen, receiptId, onClose]);

  if (!isOpen) return null;
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-white p-6 rounded-2xl flex items-center gap-3">
          <div className="h-5 w-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-semibold text-zinc-700">Loading invoice...</span>
        </div>
      </div>
    );
  }

  if (!receipt) return null;

  // Header branding info
  const brandCompanyName = activeBranch?.brandName || systemSettings?.branding?.companyName || 'PharmHelm Pharmacy';
  const brandLogoUrl = activeBranch?.brandLogoUrl || systemSettings?.branding?.logoUrl;
  const brandAddress = activeBranch?.address || systemSettings?.branding?.address || 'Kampala, Uganda';
  const brandPhone = activeBranch?.phone || systemSettings?.branding?.phone || '+256 000 000';
  const brandEmail = activeBranch?.email || systemSettings?.branding?.email || 'billing@pharmhelm.com';
  const brandNdaReg = activeBranch?.brandNdaRegNumber || systemSettings?.branding?.ndaRegNumber || 'NDA/WHL/2026/0847';
  const brandReceiptFooter = activeBranch?.brandReceiptFooter || systemSettings?.branding?.receiptFooter || 'Thank you for your business!';

  // Bank Info from settings fallback
  const bankName = activeBranch?.bankName || systemSettings?.billing?.bankName;
  const bankAccountName = activeBranch?.bankAccountName || systemSettings?.billing?.bankAccountName;
  const bankAccountNumber = activeBranch?.bankAccountNumber || systemSettings?.billing?.bankAccountNumber;
  const bankBranch = activeBranch?.bankBranch || systemSettings?.billing?.bankBranch;

  const title = 'INVOICE';

  const handlePrint = () => {
    // Open print window specifically for this component
    const printContent = document.getElementById('a4-invoice-container')?.innerHTML;
    if (!printContent) return;
    const windowUrl = 'about:blank';
    const uniqueName = new Date().getTime().toString();
    const printWindow = window.open(windowUrl, uniqueName, 'left=50000,top=50000,width=0,height=0');
    
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>${receipt.receiptNumber}</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
              @media print {
                body { margin: 15mm; }
                .no-print { display: none; }
              }
            </style>
          </head>
          <body class="bg-white text-xs font-sans text-zinc-800">
            ${printContent}
            <script>
              window.onload = function() {
                window.print();
                window.close();
              }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  const handleDownloadPDF = async () => {
    const element = document.getElementById('a4-invoice-container');
    if (!element) return;
    try {
      const canvas = await html2canvas(element, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const pageHeight = 295;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`Invoice_${receipt.receiptNumber}.pdf`);
      toast.success('Invoice PDF downloaded.');
    } catch (e) {
      console.error(e);
      toast.error('Failed to generate PDF.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-[850px] max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-zinc-150 animate-scale-up">
        
        {/* Header toolbar */}
        <div className="px-6 py-4 border-b flex justify-between items-center bg-zinc-50">
          <div>
            <h3 className="font-bold text-zinc-900 text-sm">A4 Invoice</h3>
            <p className="text-[10px] text-zinc-500 font-medium">Verify billable items and client associations</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-200 rounded-full text-zinc-400 hover:text-zinc-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Printable Invoice Container */}
        <div className="flex-1 overflow-y-auto p-8 bg-zinc-100">
          <div 
            id="a4-invoice-container" 
            className="bg-white p-12 border rounded-xl space-y-6 mx-auto text-zinc-800 text-xs w-[790px] shadow-sm"
          >
            {/* Letterhead Header */}
            <div className="flex justify-between items-start border-b pb-6 border-zinc-200">
              <div className="space-y-1">
                {brandLogoUrl && (
                  <img src={brandLogoUrl} alt="Logo" className="h-10 object-contain block mb-2" />
                )}
                <h1 className="text-base font-extrabold text-zinc-900 tracking-tight">{brandCompanyName}</h1>
                <p className="text-zinc-500 text-[10px] font-semibold">{brandAddress}</p>
                <p className="text-zinc-500 text-[10px] font-semibold">Phone: {brandPhone} | Email: {brandEmail}</p>
                <p className="text-zinc-500 text-[10px] font-semibold">NDA Lic No: {brandNdaReg}</p>
              </div>
              <div className="text-right space-y-2">
                <span className="px-4 py-1.5 bg-emerald-50 text-emerald-700 font-extrabold text-sm rounded-lg uppercase tracking-wider block">
                  {title}
                </span>
                <div className="text-[10px] space-y-0.5">
                  <p className="text-zinc-500">Invoice No: <span className="font-bold text-zinc-900">{receipt.receiptNumber}</span></p>
                  <p className="text-zinc-500">Date: <span className="font-bold text-zinc-900">{new Date(receipt.timestamp).toLocaleDateString()}</span></p>
                  <p className="text-zinc-500">Branch: <span className="font-bold text-zinc-900">{receipt.branchName || 'Main Store'}</span></p>
                </div>
              </div>
            </div>

            {/* Bill To Info Block */}
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-150 grid grid-cols-2 gap-4">
              {receipt.patientName && (
                <div>
                  <span className="text-[10px] text-zinc-400 font-bold block uppercase tracking-wider">Bill To Client</span>
                  <p className="text-zinc-900 font-bold text-sm mt-0.5">{receipt.patientName}</p>
                  {receipt.patientId && (
                    <p className="text-zinc-500 text-[10px] font-semibold mt-0.5">ID: {receipt.patientId}</p>
                  )}
                </div>
              )}
              {receipt.institutionName && (
                <div>
                  <span className="text-[10px] text-zinc-400 font-bold block uppercase tracking-wider">Bill To Institution</span>
                  <p className="text-zinc-900 font-bold text-sm mt-0.5">{receipt.institutionName}</p>
                  {receipt.institutionId && (
                    <p className="text-zinc-500 text-[10px] font-semibold mt-0.5">ID: {receipt.institutionId}</p>
                  )}
                </div>
              )}
            </div>

            {/* Itemized Table */}
            <div className="border border-zinc-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500 font-bold border-b border-zinc-200">
                    <th className="p-3 w-8">#</th>
                    <th className="p-3">Item Name</th>
                    <th className="p-3">Generic Name</th>
                    <th className="p-3">Batch / Expiry</th>
                    <th className="p-3 text-center">Qty</th>
                    <th className="p-3 text-right">Unit Price</th>
                    <th className="p-3 text-right">Tax (VAT)</th>
                    <th className="p-3 text-right">Total Price</th>
                  </tr>
                </thead>
                <tbody>
                  {(receipt.items || []).map((item: any, idx: number) => (
                    <tr key={idx} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/50">
                      <td className="p-3 text-zinc-400">{idx + 1}</td>
                      <td className="p-3 font-semibold text-zinc-900">{item.productName}</td>
                      <td className="p-3 text-zinc-500 italic">{item.genericName || 'N/A'}</td>
                      <td className="p-3 text-zinc-600 font-mono text-[10px]">
                        <div>{item.batchNumber || 'N/A'}</div>
                        {item.expiryDate && <div className="text-zinc-400 mt-0.5">Exp: {item.expiryDate}</div>}
                      </td>
                      <td className="p-3 text-center font-bold text-zinc-800">{item.quantity}</td>
                      <td className="p-3 text-right text-zinc-600">UGX {(item.unitPrice || 0).toLocaleString()}</td>
                      <td className="p-3 text-right text-zinc-500">
                        {item.vatAmount && item.vatAmount > 0 ? `UGX ${item.vatAmount.toLocaleString()} (${item.vatRate}%)` : 'Exempt'}
                      </td>
                      <td className="p-3 text-right font-bold text-zinc-900">UGX {(item.quantity * item.unitPrice).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Prescriber & Billing Summary */}
            <div className="grid grid-cols-2 gap-8 items-start">
              <div className="space-y-4">
                {/* Prescriber Block */}
                {receipt.prescriberName && (
                  <div className="p-3 bg-zinc-50 rounded-lg border border-dashed text-[10px]">
                    <span className="text-[9px] text-zinc-400 font-bold block uppercase tracking-wider">Prescribed By</span>
                    <p className="font-bold text-zinc-800">{receipt.prescriberName}</p>
                  </div>
                )}

                {/* Bank Details */}
                {bankAccountNumber && <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 space-y-1 text-[10px]">
                  <span className="text-[9px] text-emerald-700 font-extrabold block uppercase tracking-wider mb-1">
                    Direct Bank Remittance Info
                  </span>
                  <p className="text-zinc-500">Bank: <span className="font-bold text-zinc-800">{bankName}</span></p>
                  <p className="text-zinc-500">Account Name: <span className="font-bold text-zinc-800">{bankAccountName}</span></p>
                  <p className="text-zinc-500">Account No: <span className="font-mono font-bold text-zinc-800">{bankAccountNumber}</span></p>
                  <p className="text-zinc-500">Branch: <span className="font-bold text-zinc-800">{bankBranch}</span></p>
                </div>}
              </div>

              {/* Totals block */}
              <div className="space-y-2 border-t pt-4">
                <div className="flex justify-between text-zinc-500">
                  <span>Subtotal</span>
                  <span className="font-semibold text-zinc-800">UGX {receipt.subtotal?.toLocaleString()}</span>
                </div>
                {receipt.discountAmount && receipt.discountAmount > 0 ? (
                  <div className="flex justify-between text-red-500">
                    <span>Discount ({receipt.discountPercentage}%)</span>
                    <span>- UGX {receipt.discountAmount.toLocaleString()}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-zinc-500">
                  <span>VAT / Tax Total</span>
                  <span className="font-semibold text-zinc-800">UGX {receipt.taxAmount?.toLocaleString() || '0'}</span>
                </div>
                <div className="flex justify-between text-zinc-900 text-sm font-extrabold border-t pt-2 border-dashed">
                  <span>Grand Total</span>
                  <span>UGX {receipt.totalAmount?.toLocaleString()}</span>
                </div>
                <p className="text-[10px] text-zinc-400 font-medium text-right pt-1">
                  Settled via: <span className="font-bold text-zinc-700 uppercase">{receipt.paymentMethod?.replace('_', ' ')}</span>
                </p>
              </div>
            </div>

            {/* Signature blocks */}
            <div className="grid grid-cols-2 gap-8 pt-10 border-t border-zinc-150 border-dashed text-zinc-400 text-[10px]">
              <div>
                <p className="mb-8">Received By:</p>
                <div className="border-b w-48 border-zinc-200"></div>
                <p className="text-[8px] mt-1 text-zinc-400 font-medium">Customer Signature & Date</p>
              </div>
              <div className="text-right flex flex-col items-end">
                <p className="mb-8">Authorised By:</p>
                <div className="border-b w-48 border-zinc-200"></div>
                <p className="text-[8px] mt-1 text-zinc-400 font-medium">{brandCompanyName} Representative</p>
              </div>
            </div>

            {/* Footer */}
            <div className="text-center pt-6 text-[10px] text-zinc-400 border-t border-zinc-100 font-medium leading-relaxed">
              {brandReceiptFooter}
            </div>

          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t flex justify-end gap-2 bg-zinc-50">
          <button 
            onClick={handleDownloadPDF}
            className="px-4 py-2 border hover:bg-white rounded-xl text-xs font-bold text-zinc-700 flex items-center gap-1.5 transition-colors"
          >
            <Download size={14} /> Download PDF
          </button>
          <button 
            onClick={handlePrint}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs flex items-center gap-1.5 transition-colors shadow-md shadow-emerald-600/10"
          >
            <Printer size={14} /> Print Invoice
          </button>
        </div>

      </div>
    </div>
  );
};
