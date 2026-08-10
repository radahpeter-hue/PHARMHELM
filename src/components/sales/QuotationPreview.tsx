import React, { useState, useEffect } from 'react';
import { X, Download, Share2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { 
  collection, 
  addDoc, 
  Timestamp, 
  doc, 
  setDoc,
  getDocs,
  query,
  where
} from 'firebase/firestore';
import { db } from '../../firebase';
import { getNextQuotationId } from '../../services/quotationService';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface QuotationPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  branchId: string;
  activeBranch: any;
  systemSettings: any;
  profile: any;
  selectedPatient: any;
  selectedInstitution: any;
  cart: any[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  onSuccess: () => void;
}

export const QuotationPreview: React.FC<QuotationPreviewProps> = ({
  isOpen,
  onClose,
  tenantId,
  branchId,
  activeBranch,
  systemSettings,
  profile,
  selectedPatient,
  selectedInstitution,
  cart,
  subtotal,
  taxTotal,
  grandTotal,
  onSuccess
}) => {
  const [quotationId, setQuotationId] = useState('');
  const [saving, setSaving] = useState(false);

  const branchCode = activeBranch?.branch_code || 'KLA';
  const brandCompanyName = activeBranch?.brandName || systemSettings?.branding?.companyName || 'PharmHelm Pharmacy';
  const brandLogoUrl = activeBranch?.brandLogoUrl || systemSettings?.branding?.logoUrl;
  const brandAddress = activeBranch?.address || systemSettings?.branding?.address || 'Kampala, Uganda';
  const brandPhone = activeBranch?.phone || systemSettings?.branding?.phone || '+256 000 000';
  const brandNdaReg = activeBranch?.brandNdaRegNumber || systemSettings?.branding?.ndaRegNumber || 'NDA/WHL/2026/0847';

  // Validity default is 7 days from now
  const createdAtDate = new Date();
  const validityDays = systemSettings?.replenishment?.validityDays || 7;
  const validityDate = new Date();
  validityDate.setDate(validityDate.getDate() + validityDays);

  useEffect(() => {
    if (isOpen && tenantId) {
      // Pre-generate quotation ID
      getNextQuotationId(tenantId, branchCode, systemSettings)
        .then(id => setQuotationId(id))
        .catch(err => {
          console.error(err);
          setQuotationId(`QUO-${branchCode}-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`);
        });
    }
  }, [isOpen, tenantId, branchCode, systemSettings]);

  if (!isOpen) return null;

  const handleSaveDraft = async () => {
    if (!quotationId) return;
    setSaving(true);
    try {
      const lineItems = cart.map(item => ({
        productId: item.productId,
        productName: item.productName,
        genericName: item.genericName || '',
        qty: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.quantity * item.unitPrice
      }));

      const newQuotation = {
        tenantId,
        quotationId,
        branchId,
        branchName: activeBranch?.name || 'Main Branch',
        createdBy: profile.uid,
        createdByName: profile.full_name || 'Staff Member',
        createdAt: Timestamp.fromDate(createdAtDate),
        clientId: selectedPatient?.id || null,
        clientName: selectedPatient?.full_name || null,
        institutionId: selectedInstitution?.id || null,
        institutionName: selectedInstitution?.supplier_name || null,
        lineItems,
        subtotal,
        taxTotal,
        grandTotal,
        validityDate: Timestamp.fromDate(validityDate),
        status: 'Draft',
        convertedReceiptId: null,
        convertedAt: null,
        convertedValue: null
      };

      await setDoc(doc(db, 'pos_quotations', quotationId), newQuotation);
      toast.success(`Quotation ${quotationId} saved.`);
      onSuccess();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to save quotation draft: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const generatePDFBlob = async (): Promise<Blob | null> => {
    const element = document.getElementById('quotation-preview-container');
    if (!element) return null;
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
    return pdf.output('blob');
  };

  const handleDownloadPDF = async () => {
    const element = document.getElementById('quotation-preview-container');
    if (!element) return;
    try {
      const blob = await generatePDFBlob();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${quotationId}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success('PDF downloaded.');
      }
    } catch (e) {
      toast.error('Failed to generate PDF.');
    }
  };

  const handleDownloadImage = async () => {
    const element = document.getElementById('quotation-preview-container');
    if (!element) return;
    try {
      const canvas = await html2canvas(element, { scale: 2, useCORS: true });
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${quotationId}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          toast.success('PNG Image downloaded.');
        }
      }, 'image/png');
    } catch (e) {
      toast.error('Failed to export Image.');
    }
  };

  const handleShare = async () => {
    try {
      const blob = await generatePDFBlob();
      if (!blob) return;
      const file = new File([blob], `${quotationId}.pdf`, { type: 'application/pdf' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Quotation ${quotationId}`,
          text: `Quotation from ${brandCompanyName} for your review.`
        });
        toast.success('Quotation shared.');
      } else {
        // Fallback: trigger PDF download
        await handleDownloadPDF();
        toast.info('Native sharing not supported. File downloaded instead.');
      }
    } catch (e) {
      console.error(e);
      toast.error('Sharing failed.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-[850px] max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-zinc-150 animate-scale-up">
        
        {/* Header toolbar */}
        <div className="px-6 py-4 border-b flex justify-between items-center bg-zinc-50">
          <div>
            <h3 className="font-bold text-zinc-900 text-sm">Quotation Preview</h3>
            <p className="text-[10px] text-zinc-500 font-medium">Verify pricing and disclaimer details below</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-200 rounded-full text-zinc-400 hover:text-zinc-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Printable/Canvas Container */}
        <div className="flex-1 overflow-y-auto p-8 bg-zinc-100">
          <div 
            id="quotation-preview-container" 
            className="bg-white p-10 shadow-sm border rounded-xl space-y-6 mx-auto text-zinc-800 text-xs w-[790px]"
          >
            {/* Pharmacy Branding Header */}
            <div className="flex justify-between items-start border-b pb-6 border-zinc-200">
              <div className="space-y-1">
                {brandLogoUrl && (
                  <img src={brandLogoUrl} alt="Logo" className="h-10 object-contain block mb-2" />
                )}
                <h1 className="text-base font-extrabold text-zinc-900 tracking-tight">{brandCompanyName}</h1>
                <p className="text-zinc-500 text-[10px] font-semibold">{brandAddress}</p>
                <p className="text-zinc-500 text-[10px] font-semibold">Phone: {brandPhone}</p>
                <p className="text-zinc-500 text-[10px] font-semibold">NDA Lic No: {brandNdaReg}</p>
              </div>
              <div className="text-right space-y-2">
                <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 font-extrabold text-xs rounded-lg uppercase tracking-wider block">
                  Price Quotation
                </span>
                <div className="text-[10px] space-y-0.5">
                  <p className="text-zinc-500">Quotation ID: <span className="font-bold text-zinc-900">{quotationId || 'Generating...'}</span></p>
                  <p className="text-zinc-500">Date Generated: <span className="font-bold text-zinc-900">{createdAtDate.toLocaleDateString()}</span></p>
                  <p className="text-zinc-500">Valid Until: <span className="font-bold text-zinc-900">{validityDate.toLocaleDateString()}</span></p>
                </div>
              </div>
            </div>

            {/* Client / Institution details */}
            {(selectedPatient || selectedInstitution) && (
              <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-150 grid grid-cols-2 gap-4">
                {selectedPatient && (
                  <div>
                    <span className="text-[10px] text-zinc-400 font-bold block uppercase tracking-wider">Client Details</span>
                    <p className="text-zinc-900 font-bold text-sm mt-0.5">{selectedPatient.full_name}</p>
                    <p className="text-zinc-500 text-[10px] font-medium mt-0.5">Phone: {selectedPatient.phone || 'N/A'}</p>
                    <p className="text-zinc-500 text-[10px] font-medium mt-0.5">Address: {selectedPatient.address || 'N/A'}</p>
                  </div>
                )}
                {selectedInstitution && (
                  <div>
                    <span className="text-[10px] text-zinc-400 font-bold block uppercase tracking-wider">Institution Details</span>
                    <p className="text-zinc-900 font-bold text-sm mt-0.5">{selectedInstitution.supplier_name}</p>
                    <p className="text-zinc-500 text-[10px] font-medium mt-0.5">Contact: {selectedInstitution.contact_person || 'N/A'}</p>
                    <p className="text-zinc-500 text-[10px] font-medium mt-0.5">Billing Address: {selectedInstitution.billing_address || 'N/A'}</p>
                  </div>
                )}
              </div>
            )}

            {/* Line Items Table */}
            <div className="border border-zinc-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500 font-bold border-b border-zinc-200">
                    <th className="p-3">Product Name</th>
                    <th className="p-3">Generic Name</th>
                    <th className="p-3 text-center">Qty</th>
                    <th className="p-3 text-right">Unit Price</th>
                    <th className="p-3 text-right">Total Price</th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item, idx) => (
                    <tr key={idx} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/50">
                      <td className="p-3 font-semibold text-zinc-900">{item.productName}</td>
                      <td className="p-3 text-zinc-500 italic">{item.genericName || 'N/A'}</td>
                      <td className="p-3 text-center font-bold text-zinc-800">{item.quantity}</td>
                      <td className="p-3 text-right text-zinc-600">UGX {(item.unitPrice || 0).toLocaleString()}</td>
                      <td className="p-3 text-right font-bold text-zinc-900">UGX {(item.quantity * item.unitPrice).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals Summary */}
            <div className="flex justify-end">
              <div className="w-64 space-y-2 border-t pt-4">
                <div className="flex justify-between text-zinc-500">
                  <span>Subtotal</span>
                  <span className="font-semibold text-zinc-800">UGX {subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-zinc-500">
                  <span>VAT / Tax Total</span>
                  <span className="font-semibold text-zinc-800">UGX {taxTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-zinc-900 text-sm font-extrabold border-t pt-2 border-dashed">
                  <span>Grand Total</span>
                  <span>UGX {grandTotal.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Footer disclaimer */}
            <div className="border-t pt-6 text-center space-y-1 text-zinc-400 text-[10px] font-medium leading-relaxed">
              <p>This is a price quotation, not a receipt or invoice.</p>
              <p>Prices and stock availability are subject to change. Valid until {validityDate.toLocaleDateString()}.</p>
              <p>No stock is reserved by this document.</p>
            </div>

          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t flex justify-end gap-2 bg-zinc-50">
          <button 
            onClick={handleShare}
            className="px-4 py-2 border hover:bg-white rounded-xl text-xs font-bold text-zinc-700 flex items-center gap-1.5 transition-colors"
          >
            <Share2 size={14} /> Share
          </button>
          <button 
            onClick={handleDownloadImage}
            className="px-4 py-2 border hover:bg-white rounded-xl text-xs font-bold text-zinc-700 flex items-center gap-1.5 transition-colors"
          >
            <Download size={14} /> Image
          </button>
          <button 
            onClick={handleDownloadPDF}
            className="px-4 py-2 border hover:bg-white rounded-xl text-xs font-bold text-zinc-700 flex items-center gap-1.5 transition-colors"
          >
            <Download size={14} /> PDF
          </button>
          <button 
            onClick={handleSaveDraft}
            disabled={saving}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs flex items-center gap-1.5 transition-colors shadow-md shadow-emerald-600/10"
          >
            <Save size={14} /> {saving ? 'Saving...' : 'Save as Draft'}
          </button>
        </div>

      </div>
    </div>
  );
};
