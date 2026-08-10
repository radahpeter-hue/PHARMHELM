import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Filter, 
  Calendar, 
  Eye, 
  Play, 
  RefreshCw, 
  AlertTriangle,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  updateDoc,
  getDoc
} from 'firebase/firestore';
import { db } from '../../firebase';
import { format } from 'date-fns';
import { QuotationPreview } from './QuotationPreview';

interface QuotationsLogProps {
  activeBranchId: string;
  activeBranch: any;
  systemSettings: any;
  profile: any;
  staff: any[];
  clients: any[];
  institutions: any[];
  setCart: (cart: any[]) => void;
  setContext: (ctx: any) => void;
  setSelectedPatient: (p: any) => void;
  setSelectedInstitution: (i: any) => void;
  setDiscountPercentage: (pct: number) => void;
  setView: (view: 'pos' | 'ledger' | 'quotations') => void;
  setResumedQuotationId: (id: string | null) => void;
}

export const QuotationsLog: React.FC<QuotationsLogProps> = ({
  activeBranchId,
  activeBranch,
  systemSettings,
  profile,
  staff,
  clients,
  institutions,
  setCart,
  setContext,
  setSelectedPatient,
  setSelectedInstitution,
  setDiscountPercentage,
  setView,
  setResumedQuotationId
}) => {
  const [quotations, setQuotations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [startDate, setStartDate] = useState(
    format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState(
    format(new Date(), 'yyyy-MM-dd')
  );
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [createdByFilter, setCreatedByFilter] = useState('All');

  // Resume/Warnings Dialog
  const [resumingQuotation, setResumingQuotation] = useState<any | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [refetchedItems, setRefetchedItems] = useState<any[]>([]);

  // Preview Modal
  const [previewQuotation, setPreviewQuotation] = useState<any | null>(null);

  const fetchQuotations = async () => {
    if (!profile?.tenantId || !activeBranchId) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'pos_quotations'),
        where('tenantId', '==', profile.tenantId),
        where('branchId', '==', activeBranchId)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Filter list on date range (createdAt is timestamp)
      const filtered = list.filter((item: any) => {
        const itemDate = item.createdAt?.toDate();
        if (!itemDate) return false;
        
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        
        return itemDate >= start && itemDate <= end;
      });

      setQuotations(filtered);
    } catch (e: any) {
      toast.error('Failed to load quotations log: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotations();
  }, [profile?.tenantId, activeBranchId, startDate, endDate]);

  // Client-side expiry calculations with lazy Firestore updates
  const getDisplayStatus = (item: any) => {
    if (item.status === 'Draft') {
      const expiry = item.validityDate?.toDate();
      if (expiry && expiry < new Date()) {
        // Expiry date passed
        return 'Expired';
      }
    }
    return item.status;
  };

  // Perform lazy Firestore status update on interaction
  const checkAndLazyUpdateStatus = async (item: any) => {
    const currentDisplayStatus = getDisplayStatus(item);
    if (currentDisplayStatus === 'Expired' && item.status !== 'Expired') {
      try {
        const docRef = doc(db, 'pos_quotations', item.id);
        await updateDoc(docRef, { status: 'Expired' });
        item.status = 'Expired'; // mutate local reference to update UI
      } catch (e) {
        console.warn('Lazy status update failed:', e);
      }
    }
    return currentDisplayStatus;
  };

  // View read-only preview
  const handleViewQuotation = async (item: any) => {
    await checkAndLazyUpdateStatus(item);
    setPreviewQuotation(item);
  };

  // Resume Draft flow
  const handleResumeQuotation = async (item: any) => {
    const currentStatus = await checkAndLazyUpdateStatus(item);
    if (currentStatus === 'Expired') {
      toast.error('This quotation has expired and cannot be resumed.');
      return;
    }

    setLoading(true);
    const itemWarnings: string[] = [];
    const basketItems: any[] = [];

    try {
      for (const line of item.lineItems) {
        const prodSnap = await getDoc(doc(db, 'products', line.productId));
        if (!prodSnap.exists()) {
          itemWarnings.push(`Product "${line.productName}" no longer exists in inventory.`);
          continue;
        }
        const product = prodSnap.data() as any;

        // Check SOH from product batches
        const batchesSnap = await getDocs(
          query(
            collection(db, 'product_batches'),
            where('tenantId', '==', profile.tenantId),
            where('branchId', '==', activeBranchId),
            where('productId', '==', line.productId),
            where('batch_status', '==', 'available')
          )
        );
        const batchesList = batchesSnap.docs.map(d => d.data());
        const totalSOH = batchesList.reduce((sum, b) => sum + (b.quantity || 0), 0);

        // Check unit price change
        const currentPrice = product.costPricePerPack || line.unitPrice; // standard pricing or default
        // In the app, products are sold by packs or unit price. If price changed:
        if (product.sellingPricePerUnit !== line.unitPrice) {
          // Adjust price or flag warning
          itemWarnings.push(`Price for "${line.productName}" changed from UGX ${line.unitPrice.toLocaleString()} to UGX ${product.sellingPricePerUnit.toLocaleString()}.`);
        }

        if (totalSOH < line.qty) {
          itemWarnings.push(`Stock on Hand for "${line.productName}" is insufficient. Requested: ${line.qty}, Available: ${totalSOH} base units.`);
        }

        basketItems.push({
          productId: line.productId,
          productName: line.productName,
          genericName: line.genericName,
          quantity: line.qty,
          unitPrice: product.sellingPricePerUnit || line.unitPrice,
          costPrice: product.costPricePerPack || 0,
          isService: false
        });
      }

      setRefetchedItems(basketItems);
      setResumingQuotation(item);

      if (itemWarnings.length > 0) {
        setWarnings(itemWarnings);
        setShowWarningModal(true);
      } else {
        // Direct conversion
        loadBasketAndRedirect(basketItems, item);
      }

    } catch (e: any) {
      toast.error('Failed to verify quotation stock levels: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadBasketAndRedirect = (basketItems: any[], sourceQuotation: any) => {
    // Populate POS Basket state
    setCart(basketItems);
    setResumedQuotationId(sourceQuotation.id);

    // Context & Client alignment
    if (sourceQuotation.clientId) {
      const client = clients.find(c => c.id === sourceQuotation.clientId);
      if (client) setSelectedPatient(client);
      setContext('walk-in');
    } else if (sourceQuotation.institutionId) {
      const inst = institutions.find(i => i.id === sourceQuotation.institutionId);
      if (inst) {
        setSelectedInstitution(inst);
        setDiscountPercentage(inst.discountRate || 0);
      }
      setContext('institutional');
    } else {
      setContext('walk-in');
    }

    toast.success(`Loaded items from quotation ${sourceQuotation.quotationId} into basket.`);
    setView('pos');
  };

  // Shortcut to create new quotation from expired
  const handleShortcutCreateNew = (item: any) => {
    const freshBasket = item.lineItems.map((line: any) => {
      const product = clients.find(p => p.id === line.productId) as any; // Find product live
      return {
        productId: line.productId,
        productName: line.productName,
        genericName: line.genericName,
        quantity: line.qty,
        unitPrice: line.unitPrice,
        costPrice: 0,
        isService: false
      };
    });
    setCart(freshBasket);
    setResumedQuotationId(null);
    setView('pos');
    toast.info('Basket pre-filled with quoted items. Adjust quantities normally.');
  };

  // Filter application
  const filteredQuotations = quotations.filter(item => {
    const status = getDisplayStatus(item);
    if (statusFilter !== 'All' && status !== statusFilter) return false;
    
    if (createdByFilter !== 'All' && item.createdBy !== createdByFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchId = item.quotationId?.toLowerCase().includes(q);
      const matchClient = item.clientName?.toLowerCase().includes(q);
      const matchInst = item.institutionName?.toLowerCase().includes(q);
      return matchId || matchClient || matchInst;
    }

    return true;
  });

  return (
    <div className="flex-1 flex flex-col gap-6 bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm overflow-y-auto">
      
      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-zinc-50 border p-2 rounded-xl text-xs font-semibold">
            <Calendar className="text-zinc-400" size={14} />
            <input 
              type="date" 
              value={startDate} 
              onChange={(e) => setStartDate(e.target.value)} 
              className="bg-transparent outline-none text-zinc-700" 
            />
            <span className="text-zinc-400 px-1">to</span>
            <input 
              type="date" 
              value={endDate} 
              onChange={(e) => setEndDate(e.target.value)} 
              className="bg-transparent outline-none text-zinc-700" 
            />
          </div>

          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-zinc-50 border rounded-xl text-xs font-semibold outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="All">All Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Converted">Converted</option>
            <option value="Expired">Expired</option>
          </select>

          <select 
            value={createdByFilter}
            onChange={(e) => setCreatedByFilter(e.target.value)}
            className="px-3 py-2 bg-zinc-50 border rounded-xl text-xs font-semibold outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="All">Created By: All Staff</option>
            {staff.map(s => (
              <option key={s.uid} value={s.uid}>{s.full_name}</option>
            ))}
          </select>
        </div>

        <div className="relative w-64">
          <input 
            type="text" 
            placeholder="Search Quote ID, client..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-zinc-50 border rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
          <Search className="absolute left-3 top-2.5 text-zinc-400" size={14} />
        </div>
      </div>

      {/* Quotations List Table */}
      <div className="overflow-x-auto border border-zinc-150 rounded-2xl">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-50 text-zinc-500 font-bold border-b border-zinc-200">
              <th className="p-3">Quotation ID</th>
              <th className="p-3">Date Created</th>
              <th className="p-3">Client / Institution</th>
              <th className="p-3 text-center">Items</th>
              <th className="p-3 text-right">Grand Total</th>
              <th className="p-3 text-center">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-10">
                  <div className="h-5 w-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <span className="text-zinc-500 font-semibold">Loading quotations...</span>
                </td>
              </tr>
            ) : filteredQuotations.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-zinc-400 font-semibold italic">
                  No quotations matching the active filter criteria found.
                </td>
              </tr>
            ) : (
              filteredQuotations.map(item => {
                const displayStatus = getDisplayStatus(item);
                return (
                  <tr key={item.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/50">
                    <td className="p-3 font-bold text-zinc-900">{item.quotationId}</td>
                    <td className="p-3 text-zinc-500">{item.createdAt?.toDate()?.toLocaleDateString()}</td>
                    <td className="p-3 font-semibold text-zinc-700">
                      {item.clientName || item.institutionName || 'Walk-In Cash Patient'}
                    </td>
                    <td className="p-3 text-center font-semibold text-zinc-600">{item.lineItems?.length || 0} items</td>
                    <td className="p-3 text-right font-bold text-zinc-900">UGX {item.grandTotal?.toLocaleString()}</td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded font-extrabold text-[9px] uppercase tracking-wider ${
                        displayStatus === 'Converted' ? 'bg-green-50 text-green-700' :
                        displayStatus === 'Expired' ? 'bg-red-50 text-red-700' : 'bg-zinc-100 text-zinc-600'
                      }`}>
                        {displayStatus}
                      </span>
                    </td>
                    <td className="p-3 text-right space-x-1.5">
                      {displayStatus === 'Draft' ? (
                        <button 
                          onClick={() => handleResumeQuotation(item)}
                          className="px-3 py-1 bg-emerald-600 text-white font-bold rounded-lg text-[10px] hover:bg-emerald-700 transition-colors inline-flex items-center gap-1"
                        >
                          <Play size={10} fill="white" /> Resume & Convert
                        </button>
                      ) : displayStatus === 'Expired' ? (
                        <>
                          <button 
                            onClick={() => handleViewQuotation(item)}
                            className="px-2 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold rounded-lg text-[10px] transition-colors"
                          >
                            View
                          </button>
                          <button 
                            onClick={() => handleShortcutCreateNew(item)}
                            className="px-2.5 py-1 border border-zinc-200 hover:bg-zinc-50 text-zinc-600 font-bold rounded-lg text-[10px] transition-colors"
                            title="Pre-fill new basket with these items"
                          >
                            Re-quote
                          </button>
                        </>
                      ) : (
                        <div className="inline-flex items-center gap-2">
                          <button 
                            onClick={() => handleViewQuotation(item)}
                            className="px-2 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold rounded-lg text-[10px] transition-colors"
                          >
                            View
                          </button>
                          {item.convertedReceiptId && (
                            <button 
                              onClick={() => {
                                // Redirect to ledger showing this receipt ID
                                setResumedQuotationId(null);
                                setView('ledger');
                                // Wait, we can implement search in ledger or open details if we pass it
                              }}
                              className="px-2 py-1 bg-green-50 hover:bg-green-100 text-green-700 font-bold rounded-lg text-[10px] transition-colors inline-flex items-center gap-0.5"
                            >
                              <ExternalLink size={10} /> Linked Receipt
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Warnings acknowledgement dialog */}
      {showWarningModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-55 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl border animate-scale-up">
            <div className="flex items-center gap-3 border-b pb-2 text-yellow-600">
              <AlertTriangle size={24} />
              <h4 className="font-bold text-zinc-800 text-base">Quotation Drift Warnings</h4>
            </div>
            <p className="text-xs text-zinc-500">
              Slight stock or pricing adjustments occurred since generating this quotation. Acknowledge the changes before loading into POS:
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto border p-3 rounded-lg bg-yellow-50/10">
              {warnings.map((warn, i) => (
                <div key={i} className="text-xs text-yellow-800 border-b pb-1 last:border-0 last:pb-0 font-medium">
                  • {warn}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t pt-3">
              <button 
                onClick={() => {
                  setShowWarningModal(false);
                  setResumingQuotation(null);
                }} 
                className="px-4 py-2 border rounded-lg text-xs font-semibold hover:bg-zinc-50"
              >
                Cancel Resume
              </button>
              <button 
                onClick={() => {
                  setShowWarningModal(false);
                  if (resumingQuotation) {
                    loadBasketAndRedirect(refetchedItems, resumingQuotation);
                  }
                }} 
                className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg text-xs hover:bg-emerald-700"
              >
                Acknowledge & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Quotation Preview modal overlay */}
      {previewQuotation && (
        <QuotationPreview 
          isOpen={!!previewQuotation}
          onClose={() => setPreviewQuotation(null)}
          tenantId={profile?.tenantId || 'demo'}
          branchId={activeBranchId}
          activeBranch={activeBranch}
          systemSettings={systemSettings}
          profile={profile}
          selectedPatient={clients.find(c => c.id === previewQuotation.clientId)}
          selectedInstitution={institutions.find(i => i.id === previewQuotation.institutionId)}
          cart={previewQuotation.lineItems?.map((l: any) => ({
            productId: l.productId,
            productName: l.productName,
            genericName: l.genericName,
            quantity: l.qty,
            unitPrice: l.unitPrice
          })) || []}
          subtotal={previewQuotation.subtotal || 0}
          taxTotal={previewQuotation.taxTotal || 0}
          grandTotal={previewQuotation.grandTotal || 0}
          onSuccess={() => {}}
        />
      )}

    </div>
  );
};
