import { StockInRegister } from '../components/stock/StockInRegister';
import { exportRecordsToExcel } from '../utils/excelExport';
import { OperationalItemCode } from '../components/inventory/OperationalItemCode';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  ArrowRight, 
  ArrowLeft, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  Package,
  PackagePlus,
  Truck,
  FileText,
  ChevronRight,
  AlertTriangle,
  Building2,
  ChevronDown,
  Eye,
  Download,
  RotateCw,
  X
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasAnyRole } from '../utils/roles';
import { firestoreService } from '../services/firestore';
import { Product, StockOrder, StockOrderLine, TransferInvoice, Branch, ProductBatch, TransferInvoiceLine, Sale, OperationalInventory, OperationalTransfer, OperationalTransferLine } from '../types';
import { db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, runTransaction, writeBatch, increment } from 'firebase/firestore';
import { logMovementAndAggregateInTx, getBranchProductBatchRefs } from '../services/consumptionService';
import { replaySellableReceiptMovement, reconcilePendingSellableReceipts, sellableReceiptMovementId } from '../services/sellableReceiptRecoveryService';
import { toast } from 'sonner';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';
import { AutoGenerateOrderModal } from '../components/inventory/AutoGenerateOrderModal';
import { isLegacyOperationalInventorySeed } from '../utils/operationalInventory';
import { operationalIssueUnit } from '../utils/operationalStock';
import { inventoryClassForOrderCategory } from '../services/inventoryClassification';
import { useOperationalInventoryFeature } from '../hooks/useOperationalInventoryFeature';
import { createOperationalBranchReturn, receiveOperationalTransferLine } from '../services/operationalTransferService';
import { OpeningStockTab } from '../components/inventory/OpeningStockTab';
import { isScopeAllowedForOrderCategory, scopesForOrderCategory } from '../services/operationalOrderScopes';

import { persistNewManualStockOrder, persistManualStockOrderDraft } from '../services/manualStockOrderService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


const StockInOut: React.FC = () => {
  const { profile, activeBranchId, activeBranch, assignedBranches, setActiveBranchId } = useAuth();
  const [activeTab, setActiveTab] = useState<'inventory' | 'opening-stock' | 'initiate' | 'tracker' | 'stock-in' | 'transfer-out' | 'queried' | 'reports'>('inventory');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showBranchSelector, setShowBranchSelector] = useState(false);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, setBranches);
    }
  }, [profile?.tenantId]);

  const tabs = [
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'opening-stock', label: 'Opening Inventory', icon: PackagePlus },
    { id: 'initiate', label: 'Initiate Order', icon: Plus },
    { id: 'tracker', label: 'Order Tracker', icon: Clock },
    { id: 'stock-in', label: 'Stock In', icon: ArrowLeft },
    { id: 'transfer-out', label: 'Transfer Out', icon: ArrowRight },
    { id: 'queried', label: 'Queries', icon: AlertTriangle },
    { id: 'reports', label: 'Reports Hub', icon: FileText },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Stock In/Out</h1>
          <p className="text-zinc-500">Manage branch inventory orders and transfers.</p>
        </div>
        
        <div className="flex items-center gap-3">
          {activeBranch && (
            <button 
              onClick={() => setShowBranchSelector(true)}
              className="group flex items-center gap-3 px-4 py-2 bg-white border border-zinc-200 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50/30 transition-all shadow-sm"
            >
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                <Building2 size={20} />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 leading-none mb-1">Active Branch</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-zinc-900">{activeBranch.name}</span>
                  <ChevronDown size={14} className="text-zinc-400 group-hover:text-emerald-500 transition-colors" />
                </div>
              </div>
            </button>
          )}

          {!activeBranch && assignedBranches.length > 0 && (
            <button 
              onClick={() => setShowBranchSelector(true)}
              className="px-6 py-2 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20 flex items-center gap-2"
            >
              <Building2 size={18} />
              Select Branch
            </button>
          )}
        </div>
      </div>

      {showBranchSelector && (
        <div className="fixed inset-0 bg-zinc-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
              <div>
                <h2 className="text-xl font-bold text-zinc-900">Switch Branch</h2>
                <p className="text-sm text-zinc-500">Select the branch you want to operate in.</p>
              </div>
              <button 
                onClick={() => setShowBranchSelector(false)}
                className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
              >
                <Plus className="rotate-45 text-zinc-400" size={24} />
              </button>
            </div>
            <div className="p-6 space-y-2 max-h-[400px] overflow-y-auto">
              {assignedBranches.map((branch) => (
                <button
                  key={branch.id}
                  onClick={() => {
                    setActiveBranchId(branch.id);
                    setShowBranchSelector(false);
                    toast.success(`Switched to ${branch.name}`);
                  }}
                  className={cn(
                    "w-full p-4 rounded-2xl border text-left transition-all flex items-center justify-between group",
                    activeBranchId === branch.id
                      ? "bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500"
                      : "bg-white border-zinc-100 hover:border-emerald-500 hover:bg-emerald-50/30"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                      activeBranchId === branch.id
                        ? "bg-emerald-500 text-white"
                        : "bg-zinc-100 text-zinc-400 group-hover:bg-emerald-100 group-hover:text-emerald-600"
                    )}>
                      <Building2 size={20} />
                    </div>
                    <div>
                      <p className={cn(
                        "font-bold text-sm",
                        activeBranchId === branch.id ? "text-emerald-900" : "text-zinc-900"
                      )}>
                        {branch.name}
                      </p>
                      <p className="text-xs text-zinc-500">{branch.branch_code} • {branch.type}</p>
                    </div>
                  </div>
                  {activeBranchId === branch.id && (
                    <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white">
                      <CheckCircle2 size={14} />
                    </div>
                  )}
                </button>
              ))}
              {assignedBranches.length === 0 && (
                <div className="py-12 text-center text-zinc-400 italic">
                  No branches assigned to your profile.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex border-b border-zinc-200 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex items-center gap-2 px-6 py-3 text-sm font-medium transition-all border-b-2 whitespace-nowrap",
              activeTab === tab.id 
                ? "border-emerald-500 text-emerald-600" 
                : "border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300"
            )}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {activeTab === 'inventory' && <InventoryTab />}
        {activeTab === 'opening-stock' && <OpeningStockTab branches={branches} />}
        {activeTab === 'initiate' && <InitiateOrder branches={branches} />}
        {activeTab === 'tracker' && <OrderTracker />}
        {activeTab === 'stock-in' && <StockInWorkspace branches={branches} />}
        {activeTab === 'transfer-out' && <TransferOutTab branches={branches} />}
        {activeTab === 'queried' && <QueriedItemsTab />}
        {activeTab === 'reports' && <StockInOutReportsHub branches={branches} />}
      </div>
    </div>
  );
};

const InventoryTab: React.FC = () => {
  const { profile, activeBranchId, activeBranch } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.tenantId && activeBranchId) {
      setLoading(true);
      const unsubProducts = firestoreService.subscribeToCollection<Product>('products', profile.tenantId, (data) => {
        setProducts(data);
      });
      const unsubBatches = firestoreService.subscribeToCollection<ProductBatch>('product_batches', profile.tenantId, (data) => {
        setBatches(data.filter(b => b.branchId === activeBranchId));
        setLoading(false);
      });
      return () => {
        unsubProducts();
        unsubBatches();
      };
    }
  }, [profile?.tenantId, activeBranchId]);

  const inventoryData = products.map(product => {
    const productBatches = batches.filter(b => b.productId === product.id);
    const totalQty = productBatches.reduce((sum, b) => sum + b.quantity, 0);
    return {
      ...product,
      batches: productBatches,
      totalQty
    };
  }).filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    item.sku.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => b.totalQty - a.totalQty);

  if (!activeBranchId) {
    return (
      <div className="bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl p-12 text-center">
        <Building2 className="mx-auto text-zinc-300 mb-4" size={48} />
        <h3 className="text-lg font-bold text-zinc-900">No Branch Selected</h3>
        <p className="text-sm text-zinc-500 mt-2">Please select a branch from the header to view its inventory.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex justify-between items-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input 
            type="text" 
            placeholder="Search inventory..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
          />
        </div>
        <div className="text-sm text-zinc-500">
          Showing <span className="font-bold text-zinc-900">{inventoryData.length}</span> products in <span className="font-bold text-emerald-600">{activeBranch?.name}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Product</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Total Stock</th>
                <th className="px-6 py-4">Active Batches</th>
                <th className="px-6 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-400">Loading inventory...</td>
                </tr>
              ) : inventoryData.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-bold text-zinc-900">{item.name}</p>
                    <p className="text-xs text-zinc-500">{item.sku}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-600 capitalize">{item.category.replace(/_/g, ' ')}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "font-bold text-lg",
                      item.totalQty <= (item.reorderLevel || 10) ? "text-red-600" : "text-emerald-600"
                    )}>
                      {item.totalQty}
                    </span>
                    <span className="text-xs text-zinc-400 ml-1">units</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {item.batches.map(b => (
                        <span key={b.id} className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded text-[10px] font-mono">
                          {b.batchNumber} ({b.quantity})
                        </span>
                      ))}
                      {item.batches.length === 0 && <span className="text-xs text-zinc-400 italic">No batches</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {item.totalQty <= (item.reorderLevel || 10) ? (
                      <span className="px-2 py-1 bg-red-100 text-red-600 rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 w-fit">
                        <AlertTriangle size={12} />
                        Low Stock
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-emerald-100 text-emerald-600 rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 w-fit">
                        <CheckCircle2 size={12} />
                        Optimal
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {inventoryData.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                    No inventory found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};


const InitiateOrder: React.FC<{ branches: Branch[] }> = ({ branches }) => {
  const pendingNewOrder = useRef<{ id: string; orderNumber: string; createdAt: string } | null>(null);
  const { profile, activeBranchId, activeBranch } = useAuth();
  const operationalInventoryEnabled = useOperationalInventoryFeature();
  const [orderType, setOrderType] = useState<'monthly' | 'weekly' | 'emergency'>('monthly');
  const [category, setCategory] = useState<'sellable_non_cosmetic' | 'sellable_cosmetic' | 'non_sellable'>('sellable_non_cosmetic');
  const [genMethod, setGenMethod] = useState<'manual' | 'auto_generated'>('manual');
  const [coveragePeriod, setCoveragePeriod] = useState<'1_month' | '2_months' | '3_months' | 'custom'>('1_month');
  const [customCoverageDays, setCustomCoverageDays] = useState<number>(30);
  const [productScopes, setProductScopes] = useState<string[]>(['drug/medicine']);
  const [consumptionPeriod, setConsumptionPeriod] = useState<2 | 3 | 6>(3);
  const [products, setProducts] = useState<Product[]>([]);
  const [operationalInventory, setOperationalInventory] = useState<OperationalInventory[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [orderLines, setOrderLines] = useState<Partial<StockOrderLine>[]>([]);
  const [orderReviewSearch, setOrderReviewSearch] = useState('');
  const [orderReviewPage, setOrderReviewPage] = useState(1);
  const [orderReviewPageSize, setOrderReviewPageSize] = useState(20);
  const [orderReviewSort, setOrderReviewSort] = useState<'name' | 'cost_desc'>('name');
  const filteredOrderLines = useMemo(() => orderLines.filter(line =>
    String(line.product_name || '').toLowerCase().includes(orderReviewSearch.trim().toLowerCase())
  ).sort((a, b) => orderReviewSort === 'cost_desc'
    ? Number(b.line_total_ugx || 0) - Number(a.line_total_ugx || 0)
    : String(a.product_name || '').localeCompare(String(b.product_name || ''))),
    [orderLines, orderReviewSearch, orderReviewSort]);
  const orderReviewPageCount = Math.max(1, Math.ceil(filteredOrderLines.length / orderReviewPageSize));
  const visibleOrderLines = filteredOrderLines.slice(
    (Math.min(orderReviewPage, orderReviewPageCount) - 1) * orderReviewPageSize,
    Math.min(orderReviewPage, orderReviewPageCount) * orderReviewPageSize
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAutoGenerateModal, setShowAutoGenerateModal] = useState(false);

  // New states for loading saved draft orders
  const [drafts, setDrafts] = useState<StockOrder[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [selectedDraftDate, setSelectedDraftDate] = useState<string>('');

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubProducts = firestoreService.subscribeToCollection<Product>('products', profile.tenantId, setProducts);
      const unsubOps = firestoreService.subscribeToCollectionByQuery<OperationalInventory>(
        'operational_inventory',
        profile.tenantId,
        [where('branchId', '==', activeBranchId || profile.branchId || '')],
        data => setOperationalInventory(data.filter(item => !isLegacyOperationalInventorySeed(item)))
      );
      return () => {
        unsubProducts();
        unsubOps();
      };
    }
  }, [profile?.tenantId, activeBranchId, profile?.branchId]);

  // Subscribe to draft orders for active branch
  useEffect(() => {
    if (profile?.tenantId && activeBranchId) {
      const unsubDrafts = firestoreService.subscribeToCollectionByQuery<StockOrder>(
        'stock_orders',
        profile.tenantId,
        [
          where('requesting_branch_id', '==', activeBranchId),
          where('status', '==', 'draft')
        ],
        setDrafts
      );
      return () => unsubDrafts();
    }
  }, [profile?.tenantId, activeBranchId]);

  const handleSelectDraft = async (draftId: string) => {
    const draft = drafts.find(d => d.id === draftId);
    if (!draft) return;
    if (draft.category === 'non_sellable' && !operationalInventoryEnabled) {
      toast.error('Operational Inventory is disabled in System Settings.');
      return;
    }

    setIsGenerating(true);
    try {
      setSelectedDraftId(draft.id);
      setOrderType(draft.order_type);
      setCategory(draft.category);
      setGenMethod(draft.generation_method);

      // Fetch the draft lines
      const lines = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: draft.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
      setOrderLines(draft.category === 'non_sellable'
        ? lines.map(line => ({
            ...line,
            masterItemId: line.masterItemId || operationalInventory.find(item => item.id === line.product_id)?.masterItemId
          }))
        : lines);
      toast.success(`Draft loaded: ${draft.order_number}`);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load draft lines.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClearDraft = () => {
    setSelectedDraftId(null);
    setOrderLines([]);
    setCategory('sellable_non_cosmetic');
    toast.info("Cleared draft status. Ready for fresh order.");
  };

  useEffect(() => {
    if (!operationalInventoryEnabled && category === 'non_sellable') {
      setCategory('sellable_non_cosmetic');
      setOrderLines([]);
      setSelectedDraftId(null);
    }
  }, [operationalInventoryEnabled, category]);

  useEffect(() => {
    setProductScopes(current => scopesForOrderCategory(category, current));
  }, [category]);

  // Enforce segregation: clear lines when category swings
  const handleCategoryChange = (val: 'sellable_non_cosmetic' | 'sellable_cosmetic' | 'non_sellable') => {
    if (val === 'non_sellable' && !operationalInventoryEnabled) return;
    const currentDraft = drafts.find(draft => draft.id === selectedDraftId);
    if (currentDraft && inventoryClassForOrderCategory(val) !== inventoryClassForOrderCategory(currentDraft.category)) {
      toast.error('An existing order cannot change inventory class. Clear the draft to start a new order.');
      return;
    }
    if (orderLines.length > 0) {
      if (window.confirm("Changing the category will clear current items in this order to guarantee inventory segregation. Do you wish to proceed?")) {
        setOrderLines([]);
        setCategory(val);
      }
    } else {
      setCategory(val);
    }
  };

  if (!activeBranchId) {
    return (
      <div className="bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl p-12 text-center">
        <Building2 className="mx-auto text-zinc-300 mb-4" size={48} />
        <h3 className="text-lg font-bold text-zinc-900">No Branch Selected</h3>
        <p className="text-sm text-zinc-500 mt-2">Please select a branch from the header to initiate an order.</p>
      </div>
    );
  }

  // Segment products vs operational inventory cleanly
  const searchItems = (() => {
    const term = searchTerm.toLowerCase();
    if (category === 'non_sellable') {
      const filteredOps = operationalInventory.filter(op => op.branchId === activeBranchId && Boolean(op.masterItemId) && (
        op.name.toLowerCase().includes(term) ||
        (op.sku && op.sku.toLowerCase().includes(term)) ||
        (op.uniqueId && op.uniqueId.toLowerCase().includes(term)) ||
        (op.supplier && op.supplier.toLowerCase().includes(term))
      ));
      return filteredOps.map(op => ({
        id: op.id,
        name: op.name,
        sku: op.sku || op.uniqueId || 'Operational Asset',
        genericName: op.type === 'fixed' ? 'Fixed Asset' : 'Non-Fixed Asset',
        costPricePerPack: op.costPerPack || op.cost || 0,
        isOperational: true,
        masterItemId: op.masterItemId || op.id,
        unitOfSell: op.unitOfIssue || 'unit'
      }));
    } else {
      const isCosmetics = (cat: string) => cat === 'cosmetic' || cat === 'cosmetic therapeutics';
      
      const rxProducts = products.filter(p => (p as any).inventoryClass !== 'OPERATIONAL' && (p as any).isOperational !== true).filter(p => {
        if (category === 'sellable_cosmetic') {
          return isCosmetics(p.category || '');
        } else {
          // 'sellable_non_cosmetic'
          return !isCosmetics(p.category || '');
        }
      });

      const filtered = rxProducts.filter(p => 
        p.name.toLowerCase().includes(term) || 
        p.sku.toLowerCase().includes(term) ||
        p.genericName?.toLowerCase().includes(term) ||
        p.manufacturingCompany?.toLowerCase().includes(term) ||
        p.countryOfManufacture?.toLowerCase().includes(term)
      );

      return filtered.map(p => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        genericName: p.genericName || '',
        costPricePerPack: p.costPricePerPack || 0,
        isOperational: false,
        unitOfSell: p.unitOfSell || p.unit || 'pack'
      }));
    }
  })();
  const unlinkedOperationalItemCount = category === 'non_sellable'
    ? operationalInventory.filter(item => item.branchId === activeBranchId && !item.masterItemId).length
    : 0;

  const addProduct = (item: { id: string; name: string; sku: string; genericName: string; costPricePerPack: number; isOperational: boolean; masterItemId?: string }) => {
    if (item.isOperational && !operationalInventoryEnabled) return;
    if (orderLines.find(l => l.product_id === item.id)) return;
    setOrderLines([...orderLines, { 
      product_id: item.id,
      product_name: item.name,
      qty_ordered: 1,
      unit_cost_ugx: item.costPricePerPack,
      line_total_ugx: item.costPricePerPack,
      isOperational: item.isOperational,
      inventoryClass: item.isOperational ? 'OPERATIONAL' : 'SELLABLE',
      ...(item.isOperational ? { masterItemId: item.masterItemId || item.id } : {}),
      tenantId: profile?.tenantId
    }]);
  };

  const removeProduct = (productId: string) => {
    setOrderLines(orderLines.filter(l => l.product_id !== productId));
  };

  const updateQty = (productId: string, qty: number) => {
    setOrderLines(orderLines.map(l => {
      if (l.product_id === productId) {
        const total = qty * (l.unit_cost_ugx || 0);
        return { ...l, qty_ordered: qty, line_total_ugx: total };
      }
      return l;
    }));
  };

  const handleAutoGenerate = async () => {
    if (!activeBranchId || !profile?.tenantId) return;
    
    if (category === 'non_sellable') {
      toast.info("Auto-generate from sales is not applicable for Operational Inventory (as non-sellables are not sold). Please add items manually.");
      return;
    }

    setIsGenerating(true);
    
    try {
      // Calculate start date based on consumptionPeriod
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - consumptionPeriod);
      const startDateStr = startDate.toISOString();

      // Fetch sales for the period at this branch
      const sales = await firestoreService.getDocumentsByQuery<Sale>('sales', [
        { field: 'tenantId', operator: '==', value: profile.tenantId },
        { field: 'branchId', operator: '==', value: activeBranchId },
        { field: 'timestamp', operator: '>=', value: startDateStr }
      ]);

      // Aggregate consumption per product
      const consumption: Record<string, number> = {};
      const productMap: Record<string, Product> = {};
      products.forEach(p => productMap[p.id] = p);

      sales.forEach(sale => {
        sale.items.forEach(item => {
          const product = productMap[item.productId];
          if (product) {
            const multiplier = product.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : 
                              product.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;
            // Convert consumption to individual units
            consumption[item.productId] = (consumption[item.productId] || 0) + (item.quantity * multiplier);
          }
        });
      });

      // Filter products by category and those that have consumption
      const isCosmetics = (cat: string) => cat === 'cosmetic' || cat === 'cosmetic therapeutics';
      const relevantProducts = products.filter(p => {
        if (category === 'sellable_cosmetic') {
          return isCosmetics(p.category || '');
        } else {
          // 'sellable_non_cosmetic'
          return !isCosmetics(p.category || '');
        }
      });

      const suggestedLines: Partial<StockOrderLine>[] = relevantProducts
        .filter(p => consumption[p.id] > 0)
        .map(p => {
          const avgMonthlyConsumptionUnits = consumption[p.id] / consumptionPeriod;
          // Convert monthly consumption in units to packs for ordering
          const unitsPerPack = p.unitsPerPack || 1;
          const avgMonthlyConsumptionPacks = avgMonthlyConsumptionUnits / unitsPerPack;
          
          // Suggest 1.5x monthly consumption for safety stock (in packs)
          const suggestedQtyPacks = Math.ceil(avgMonthlyConsumptionPacks * 1.5);
          
          return {
            product_id: p.id,
            product_name: p.name,
            qty_ordered: suggestedQtyPacks,
            unit_cost_ugx: p.costPricePerPack,
            line_total_ugx: suggestedQtyPacks * p.costPricePerPack,
            isOperational: false,
            tenantId: profile.tenantId
          };
        });

      if (suggestedLines.length === 0) {
        toast.info("No consumption data found for this period and category.");
      } else {
        setOrderLines(suggestedLines);
        toast.success(`Generated ${suggestedLines.length} suggestions based on last ${consumptionPeriod} months.`);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to calculate consumption data.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async (status: 'draft' | 'submitted') => {
    if (category === 'non_sellable' && !operationalInventoryEnabled) {
      toast.error('Operational Inventory is disabled in System Settings.');
      return;
    }
    if (orderLines.length === 0) {
      toast.error("Add at least one product to the order.");
      return;
    }

    const expectedClass = inventoryClassForOrderCategory(category);
    const hasWrongClassLine = orderLines.some(line =>
      line.inventoryClass
        ? line.inventoryClass !== expectedClass
        : Boolean(line.isOperational) !== (expectedClass === 'OPERATIONAL')
    );
    if (hasWrongClassLine) {
      toast.error('This order contains an item from another inventory stream. Remove it or start a new order.');
      return;
    }

    if (isSubmitting) return;

    const branchId = activeBranchId || profile?.branchId || branches[0]?.id;
    if (!branchId) {
      toast.error("Branch ID is missing. Please ensure you are assigned to a branch.");
      return;
    }

    if (!profile?.tenantId) {
      toast.error("Tenant ID is missing. Please log in again.");
      return;
    }

    setIsSubmitting(true);
    try {
      const totalValue = orderLines.reduce((sum, l) => sum + (l.line_total_ugx || 0), 0);
      const orderData: any = {
        tenantId: profile.tenantId,
        inventoryClass: inventoryClassForOrderCategory(category),
        order_type: orderType,
        category: category,
        generation_method: genMethod,
        status: status,
        ...(selectedDraftId && status === 'submitted'
          ? { requesting_branch_name: activeBranch?.name || branches.find(b => b.id === branchId)?.name || 'Unknown Branch' }
          : {}),
        is_emergency: orderType === 'emergency',
        submitted_by: profile.uid || '',
        total_order_value_ugx: totalValue
      };

      if (status === 'submitted') {
        orderData.submitted_at = new Date().toISOString();
      }

      if (expectedClass === 'OPERATIONAL') {
        let orderId = selectedDraftId;
        if (!orderId) {
          pendingNewOrder.current ||= {
            id: doc(collection(db, 'stock_orders')).id,
            orderNumber: `ORD-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`,
            createdAt: new Date().toISOString()
          };
          const pending = pendingNewOrder.current;
          await persistNewManualStockOrder(pending.id, {
            ...orderData,
            order_number: pending.orderNumber,
            requesting_branch_id: branchId,
            requesting_branch_name: activeBranch?.name || branches.find(b => b.id === branchId)?.name || 'Unknown Branch',
            createdAt: pending.createdAt,
            updatedAt: new Date().toISOString()
          }, orderLines.map(line => ({ ...line, tenantId: profile.tenantId, inventoryClass: expectedClass })));
          pendingNewOrder.current = null;
          toast.success(`Order ${status === 'submitted' ? 'submitted' : 'saved as draft'}.`);
          setOrderLines([]);
          setSelectedDraftId(null);
          return;
        }
        const existingLines = await firestoreService.getDocumentsByQuery<any>('stock_order_lines', [{ field: 'order_id', operator: '==', value: orderId }, { field: 'tenantId', operator: '==', value: profile.tenantId }]);
        await persistManualStockOrderDraft(orderId, orderData, existingLines,
          orderLines.map(line => ({ ...line, tenantId: profile.tenantId, inventoryClass: expectedClass })));
        toast.success(`Order ${status === 'submitted' ? 'submitted' : 'saved as draft'}.`);
        setOrderLines([]);
        setSelectedDraftId(null);
        return;
      }
      // Sellable orders must use the same atomic draft lifecycle as Operational orders.
      // In particular, do NOT update the header to submitted before replacing draft lines.
      const requestedLines = orderLines.map(line => ({
        ...line, tenantId: profile.tenantId, inventoryClass: expectedClass
      }));
      if (selectedDraftId) {
        const selected = drafts.find(draft => draft.id === selectedDraftId);
        if (!selected || selected.status !== 'draft' || selected.tenantId !== profile.tenantId
          || selected.requesting_branch_id !== branchId) {
          throw new Error('The selected draft is no longer available for this branch. Refresh before submitting.');
        }
        const existingLines = await firestoreService.getDocumentsByQuery<StockOrderLine>(
          'stock_order_lines', [
            { field: 'order_id', operator: '==', value: selectedDraftId },
            { field: 'tenantId', operator: '==', value: profile.tenantId }
          ]);
        await persistManualStockOrderDraft(selectedDraftId, orderData, existingLines, requestedLines);
      } else {
        pendingNewOrder.current ||= {
          id: doc(collection(db, 'stock_orders')).id,
          orderNumber: `ORD-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`,
          createdAt: new Date().toISOString()
        };
        const pending = pendingNewOrder.current;
        await persistNewManualStockOrder(pending.id, {
          ...orderData,
          order_number: pending.orderNumber,
          requesting_branch_id: branchId,
          requesting_branch_name: activeBranch?.name || branches.find(b => b.id === branchId)?.name || 'Unknown Branch',
          createdAt: pending.createdAt,
          updatedAt: new Date().toISOString()
        }, requestedLines);
        pendingNewOrder.current = null;
      }
      toast.success(status === 'submitted'
        ? 'Order submitted to Procurement → New Requisitions.'
        : 'Order saved in Draft Orders.');
      setOrderLines([]);
      setSelectedDraftId(null);

    } catch (error) {
      console.error('Draft order save/submission failed:', error);
      toast.error('Failed to save/submit order: ' + (error instanceof Error ? error.message : 'Please retry.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-zinc-700">Inventory Stream</label>
              <select
                value={category}
                disabled={Boolean(selectedDraftId)}
                onChange={event => handleCategoryChange(event.target.value as 'sellable_non_cosmetic' | 'sellable_cosmetic' | 'non_sellable')}
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold disabled:opacity-60"
              >
                <option value="sellable_non_cosmetic">Sellable Inventory · Non-Cosmetic</option>
                <option value="sellable_cosmetic">Sellable Inventory · Cosmetic</option>
                {operationalInventoryEnabled && <option value="non_sellable">Operational Inventory</option>}
              </select>
              {selectedDraftId && <p className="text-[10px] text-zinc-500">A saved order keeps its original inventory class. Start a new order to use another stream.</p>}
            </div>
            {/* Step 2: Order coverage period */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-zinc-700">Order Coverage Period</label>
              <select 
                value={coveragePeriod} 
                onChange={(e) => setCoveragePeriod(e.target.value as any)}
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
              >
                <option value="1_month">1 Month (30 days)</option>
                <option value="2_months">2 Months (60 days)</option>
                <option value="3_months">3 Months (90 days)</option>
                <option value="custom">Custom Period</option>
              </select>
              {coveragePeriod === 'custom' && (
                <div className="mt-2 animate-fade-in">
                  <label className="text-xs text-zinc-500 font-bold block mb-1">Coverage Days</label>
                  <input 
                    type="number"
                    value={customCoverageDays}
                    onChange={(e) => setCustomCoverageDays(Number(e.target.value))}
                    className="w-full px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs font-semibold"
                  />
                </div>
              )}
            </div>

            {/* Step 2: Product scope */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-zinc-700">Product Scope (select one or more)</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
                {[
                  ['drug/medicine', 'Drug / Medicine'],
                  ['cosmetic', 'Cosmetic'],
                  ['consumable', 'Consumable'],
                  ['device', 'Device'],
                  ['cosmetic therapeutics', 'Cosmetic Therapeutics'],
                  ...(operationalInventoryEnabled ? [['operational_inventory', 'Operational / Non-Sellable Inventory']] : [])
                ].map(([value, label]) => (
                  <label key={value} className={`flex items-center gap-2 text-xs font-semibold ${isScopeAllowedForOrderCategory(category, value) ? 'text-zinc-700 cursor-pointer' : 'text-zinc-400 cursor-not-allowed'}`}>
                    <input
                      type="checkbox"
                      checked={productScopes.includes(value)}
                      disabled={!isScopeAllowedForOrderCategory(category, value)}
                      onChange={() => setProductScopes(current => {
                        if (!isScopeAllowedForOrderCategory(category, value)) return scopesForOrderCategory(category, current);
                        const next = current.includes(value) ? current.filter(scope => scope !== value) : [...current, value];
                        return category === 'non_sellable' ? ['operational_inventory'] : next.filter(scope => scope !== 'operational_inventory');
                      })}
                      className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    {label}
                  </label>
                ))}
              </div>
              {category === 'non_sellable' && <p className="text-[11px] text-sky-700">Operational orders use only Operational items. Sellable scopes are locked for this order.</p>}
            </div>

            {/* Step 3: Order Method */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-zinc-700">Preparation Method</label>
              <select 
                value={genMethod} 
                onChange={(e) => setGenMethod(e.target.value as any)}
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
              >
                <option value="manual">Manual Order</option>
                <option value="auto_generated">Auto-Generate Order</option>
              </select>
            </div>
          </div>

          {/* Step 4: Auto-Generate order banner triggers modal */}
          {genMethod === 'auto_generated' && (
            <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <span className="text-xs text-zinc-600 font-bold uppercase tracking-wider">Replenishment Engine:</span>
                <span className="text-xs text-zinc-600 block">Calculate stock requirements using core deterministic forecasting model.</span>
              </div>
              <button 
                onClick={() => setShowAutoGenerateModal(true)}
                className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs uppercase tracking-widest transition-colors inline-flex items-center justify-center gap-2 shadow-md shadow-emerald-600/10"
              >
                <RotateCw size={14} className="animate-spin-slow" />
                Launch Replenishment Console
              </button>
            </div>
          )}

          <AutoGenerateOrderModal 
            isOpen={showAutoGenerateModal} 
            onClose={() => setShowAutoGenerateModal(false)} 
            branches={branches}
            initialCoverageDays={coveragePeriod === '1_month' ? 30 : coveragePeriod === '2_months' ? 60 : coveragePeriod === '3_months' ? 90 : customCoverageDays}
            initialProductScopes={productScopes}
            initialCategory={category}
            inventoryClassLock={category === 'non_sellable' ? 'OPERATIONAL' : 'SELLABLE'}
          />

          {orderType === 'emergency' && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 animate-pulse">
              <AlertTriangle size={20} />
              <span className="text-sm font-bold uppercase tracking-wider">Emergency Order - Fast Delivery Required</span>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
            <h3 className="font-bold text-zinc-900">Order Lines ({category === 'non_sellable' ? 'Operational Assets' : 'Sellable Stocks'})</h3>
            <div className="text-xs font-bold text-zinc-500">
              Total Value: <span className="text-emerald-600">UGX {orderLines.reduce((sum, l) => sum + (l.line_total_ugx || 0), 0).toLocaleString()}</span>
            </div>
          </div>
          <div className="p-4 flex flex-wrap items-center gap-3 border-b">
            <input aria-label="Search manual order lines" value={orderReviewSearch} onChange={e => { setOrderReviewSearch(e.target.value); setOrderReviewPage(1); }} placeholder="Search order lines..." className="min-w-0 flex-1 border rounded-lg px-3 py-2 text-sm" />
            <select aria-label="Sort manual order lines" value={orderReviewSort} onChange={e => { setOrderReviewSort(e.target.value as 'name' | 'cost_desc'); setOrderReviewPage(1); }} className="border rounded-lg px-3 py-2 text-sm"><option value="name">Product name</option><option value="cost_desc">Highest cost</option></select>
            <select aria-label="Manual order rows per page" value={orderReviewPageSize} onChange={e => { setOrderReviewPageSize(Number(e.target.value)); setOrderReviewPage(1); }} className="border rounded-lg px-3 py-2 text-sm"><option value={20}>20 per page</option><option value={50}>50 per page</option><option value={100}>100 per page</option></select>
            <span className="text-xs text-zinc-500">{filteredOrderLines.length} matching of {orderLines.length} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/20">
                  <th className="px-6 py-3">Item Name</th>
                  <th className="px-6 py-3 w-32">Qty Requested</th>
                  <th className="px-6 py-3">Unit Cost</th>
                  <th className="px-6 py-3">Line Total</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visibleOrderLines.map((line) => {
                  const product = line.isOperational 
                    ? operationalInventory.find(op => op.id === line.product_id)
                    : products.find(p => p.id === line.product_id);
                  const skuCode = line.isOperational
                    ? (product as any)?.sku || (product as any)?.uniqueId || 'OP-Asset'
                    : (product as any)?.sku;
                  return (
                    <tr key={line.product_id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <p className="font-semibold text-zinc-900">{line.product_name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-zinc-400 font-mono">{skuCode}</span>
                            {line.isOperational && (
                              <span className="text-[9px] font-black uppercase tracking-widest text-sky-600 bg-sky-50 px-1 py-0.2 rounded">
                                Operational Asset
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <input 
                          type="number" 
                          value={line.qty_ordered ?? ''}
                          onChange={(e) => updateQty(line.product_id!, parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-1 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20 outline-none"
                        />
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-600">
                        {line.unit_cost_ugx?.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-zinc-900">
                        {line.line_total_ugx?.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => removeProduct(line.product_id!)}
                          className="text-red-500 hover:text-red-700 p-1 font-bold text-xs uppercase tracking-wider"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {orderLines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                      No items added yet. Search and add {category === 'non_sellable' ? 'operational assets/supplies' : 'products'} from the right panel.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-3 border-t flex justify-between items-center text-sm">
            <span>Page {Math.min(orderReviewPage, orderReviewPageCount)} of {orderReviewPageCount}</span>
            <div className="flex gap-2">
              <button type="button" disabled={orderReviewPage <= 1} onClick={() => setOrderReviewPage(p => Math.max(1, p - 1))} className="border rounded-lg px-3 py-1 disabled:opacity-40">Previous</button>
              <button type="button" disabled={orderReviewPage >= orderReviewPageCount} onClick={() => setOrderReviewPage(p => Math.min(orderReviewPageCount, p + 1))} className="border rounded-lg px-3 py-1 disabled:opacity-40">Next</button>
            </div>
          </div>
          <div className="p-6 border-t border-zinc-100 flex justify-end gap-3 bg-zinc-50/30">
            <button 
              onClick={() => handleSubmit('draft')}
              className="px-6 py-2 border border-zinc-200 rounded-xl font-medium text-zinc-600 hover:bg-zinc-50 transition-colors text-xs uppercase tracking-wider font-bold"
            >
              Save as Draft
            </button>
            <button 
              onClick={() => handleSubmit('submitted')}
              className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-medium transition-colors shadow-lg shadow-emerald-500/20 text-xs uppercase tracking-wider font-bold animate-pulse-subtle"
            >
              Submit to Procurement
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Draft Orders Selector/Resume Card */}
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-zinc-900 flex items-center gap-2">
              <FileText className="text-zinc-500" size={18} />
              <span>Draft Orders ({drafts.length})</span>
            </h3>
            {selectedDraftId && (
              <button 
                onClick={handleClearDraft}
                className="text-xs text-rose-500 hover:text-rose-700 font-bold uppercase tracking-wider"
              >
                Clear / New Order
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-black uppercase text-zinc-400 tracking-wider">Date Filter</label>
                <input 
                  type="date" 
                  value={selectedDraftDate}
                  onChange={(e) => setSelectedDraftDate(e.target.value)}
                  className="w-full mt-1 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-700 outline-none"
                />
              </div>
              {selectedDraftDate && (
                <button 
                  onClick={() => setSelectedDraftDate('')}
                  className="self-end px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-lg text-xs font-semibold"
                >
                  Clear
                </button>
              )}
            </div>

            <select
              value={selectedDraftId || ''}
              onChange={(e) => {
                if (e.target.value) {
                  handleSelectDraft(e.target.value);
                } else {
                  handleClearDraft();
                }
              }}
              className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-emerald-500/20 outline-none"
            >
              <option value="">Select a draft to resume...</option>
              {drafts
                .filter(d => {
                  if (!operationalInventoryEnabled && d.category === 'non_sellable') return false;
                  if (!selectedDraftDate) return true;
                  const dDate = d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt)) : null;
                  const draftDateString = dDate ? dDate.toISOString().split('T')[0] : '';
                  return draftDateString === selectedDraftDate;
                })
                .map(d => {
                  const dDate = d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt)) : null;
                  const draftDate = dDate ? dDate.toLocaleDateString() : 'N/A';
                  return (
                    <option key={d.id} value={d.id}>
                      {d.order_number} ({draftDate}) - {d.category.replace(/_/g, ' ').toUpperCase()} ({d.order_type.toUpperCase()})
                    </option>
                  );
                })
              }
            </select>
          </div>

          {selectedDraftId && (
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-700 text-xs">
              <p className="font-bold">Currently Resuming Draft:</p>
              <p className="mt-0.5 font-mono text-[10px]">
                {drafts.find(d => d.id === selectedDraftId)?.order_number}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed">Saving changes or submitting will update this document instead of duplicating.</p>
            </div>
          )}
        </div>

        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <h3 className="font-bold text-zinc-900 mb-4">{category === 'non_sellable' ? 'Operational Item Search' : 'Product Search'}</h3>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
            <input 
              type="text" 
              placeholder={category === 'non_sellable' ? "Search operational assets/supplies..." : "Search by name, SKU, brand, generic..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
            />
          </div>
          {unlinkedOperationalItemCount > 0 && (
            <p className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {unlinkedOperationalItemCount} legacy Operational item{unlinkedOperationalItemCount === 1 ? '' : 's'} need linking to a tenant item identity in Inventory before they can be ordered.
            </p>
          )}
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {searchItems.map(item => (
              <button
                key={item.id}
                onClick={() => addProduct(item)}
                className="w-full p-3 text-left border border-zinc-100 rounded-xl hover:border-emerald-500 hover:bg-emerald-50/30 transition-all group flex flex-col gap-1"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-900 text-sm truncate">{item.name}</p>
                    <div className="flex gap-2 mt-1">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{item.sku}</span>
                      <span className="text-[10px] text-zinc-400 italic truncate">{item.genericName}</span>
                    </div>
                    {item.isOperational && (
                      <span className="mt-1.5 inline-block text-[9px] bg-sky-50 text-sky-600 px-1.5 py-0.5 rounded font-black uppercase tracking-widest">
                        Operational Item
                      </span>
                    )}
                  </div>
                  <Plus size={16} className="text-zinc-300 group-hover:text-emerald-500 flex-shrink-0 ml-2" />
                </div>
              </button>
            ))}
            {searchItems.length === 0 && (
              <div className="text-center py-6 text-zinc-400 text-sm">
                No matching items found.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const OrderTracker: React.FC = () => {
  const { profile, activeBranchId } = useAuth();
  const [orders, setOrders] = useState<StockOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState({ 
    start: '', 
    end: '' 
  });

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<StockOrder>('stock_orders', profile.tenantId, (data) => {
        let filtered = hasAnyRole(profile, ['owner', 'admin', 'CEO', 'CEO / MD'])
          ? data 
          : data.filter(o => o.requesting_branch_id === activeBranchId);
        
        if (statusFilter !== 'all') {
          filtered = filtered.filter(o => o.status === statusFilter);
        }

        if (dateRange.start) {
          filtered = filtered.filter(o => o.submitted_at && o.submitted_at >= dateRange.start);
        }
        if (dateRange.end) {
          filtered = filtered.filter(o => o.submitted_at && o.submitted_at <= dateRange.end);
        }

        setOrders(filtered.sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || '')));
      });
    }
  }, [profile?.tenantId, activeBranchId, profile?.role, statusFilter, dateRange]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-zinc-100 text-zinc-600';
      case 'submitted': return 'bg-blue-100 text-blue-600';
      case 'in_triage': return 'bg-purple-100 text-purple-600';
      case 'sourcing': return 'bg-orange-100 text-orange-600';
      case 'approved': return 'bg-emerald-100 text-emerald-600';
      case 'dispatched': return 'bg-amber-100 text-amber-600';
      case 'fully_received': return 'bg-zinc-800 text-white';
      case 'closed': return 'bg-zinc-400 text-white';
      default: return 'bg-zinc-100 text-zinc-600';
    }
  };

  const [selectedOrderForDetails, setSelectedOrderForDetails] = useState<StockOrder | null>(null);

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Status Filter</label>
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="sourcing">Sourcing</option>
            <option value="approved">Approved</option>
            <option value="dispatched">Dispatched</option>
            <option value="fully_received">Received</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Start Date</label>
          <input 
            type="date" 
            value={dateRange.start}
            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            className="px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">End Date</label>
          <input 
            type="date" 
            value={dateRange.end}
            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            className="px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Order Number</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Value (UGX)</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-zinc-900">
                    {order.order_number}
                    {order.is_emergency && (
                      <span className="ml-2 px-2 py-0.5 bg-red-500 text-white text-[10px] rounded-full uppercase font-black">Emergency</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm capitalize text-zinc-600">{order.order_type}</td>
                  <td className="px-6 py-4 text-sm text-zinc-600">{order.category.replace(/_/g, ' ')}</td>
                  <td className="px-6 py-4 text-sm font-medium text-zinc-900">{order.total_order_value_ugx?.toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <span className={cn("px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider", getStatusColor(order.status))}>
                      {order.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-500">
                    {order.submitted_at ? new Date(order.submitted_at).toLocaleDateString() : 'Not submitted'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => setSelectedOrderForDetails(order)}
                      className="text-emerald-500 hover:underline text-sm font-bold"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-zinc-400 italic">
                    No orders found matching the criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedOrderForDetails && (
        <OrderDetailsModal 
          order={selectedOrderForDetails} 
          onClose={() => setSelectedOrderForDetails(null)} 
        />
      )}
    </div>
  );
};

const OrderDetailsModal: React.FC<{ order: StockOrder; onClose: () => void }> = ({ order, onClose }) => {
  const { profile } = useAuth();
  const [lines, setLines] = useState<StockOrderLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLines = async () => {
      if (profile?.tenantId) {
        const data = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [
          { field: 'order_id', operator: '==', value: order.id },
          { field: 'tenantId', operator: '==', value: profile.tenantId }
        ]);
        setLines(data);
        setLoading(false);
      }
    };
    fetchLines();
  }, [order.id, profile?.tenantId]);

  return (
    <div className="fixed inset-0 bg-zinc-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Order Details</h2>
            <p className="text-sm text-zinc-500">{order.order_number} • {order.requesting_branch_name}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Order Info</p>
              <div className="space-y-1 text-zinc-800">
                <p className="text-sm"><span className="text-zinc-500">Type:</span> <span className="font-bold capitalize text-zinc-900">{order.order_type}</span></p>
                <p className="text-sm"><span className="text-zinc-500">Category:</span> <span className="font-bold text-zinc-900">{order.category.replace(/_/g, ' ')}</span></p>
                <p className="text-sm"><span className="text-zinc-500">Method:</span> <span className="font-bold capitalize text-zinc-900">{order.generation_method.replace(/_/g, ' ')}</span></p>
              </div>
            </div>
            <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Status & Value</p>
              <div className="space-y-1 text-zinc-800">
                <p className="text-sm"><span className="text-zinc-500">Status:</span> <span className="font-bold text-emerald-600 uppercase">{order.status.replace(/_/g, ' ')}</span></p>
                <p className="text-sm"><span className="text-zinc-500">Total Value:</span> <span className="font-bold text-zinc-900">UGX {order.total_order_value_ugx.toLocaleString()}</span></p>
                <p className="text-sm"><span className="text-zinc-500">Submitted:</span> <span className="font-bold text-zinc-900">{order.submitted_at ? new Date(order.submitted_at).toLocaleString() : 'N/A'}</span></p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-bold text-zinc-900 flex items-center gap-2">
              <Package size={18} className="text-zinc-400" />
              Order Items
            </h3>
            {loading ? (
              <div className="py-12 text-center text-zinc-400">Loading items...</div>
            ) : (
              <div className="border border-zinc-100 rounded-2xl overflow-hidden bg-white">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 bg-zinc-50/50">
                      <th className="px-4 py-3">Product</th>
                      <th className="px-4 py-3">Qty Requested</th>
                      <th className="px-4 py-3">Unit Cost</th>
                      <th className="px-4 py-3 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 text-zinc-800">
                    {lines.map(line => (
                      <tr key={line.id} className="text-sm hover:bg-zinc-50/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-zinc-900">{line.product_name}</td>
                        <td className="px-4 py-3 font-bold text-zinc-800">{line.qty_ordered}</td>
                        <td className="px-4 py-3 text-zinc-600">UGX {line.unit_cost_ugx.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-black text-zinc-950">UGX {(line.line_total_ugx || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-zinc-100 bg-zinc-50/50 flex justify-end">
          <button 
            onClick={onClose}
            className="px-8 py-2 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const StockInWorkspace: React.FC<{ branches: Branch[] }> = ({ branches }) => {
  const operationalEnabled = useOperationalInventoryFeature();
  const [inventoryView, setInventoryView] = useState<'sellable' | 'operational'>('sellable');

  useEffect(() => {
    if (!operationalEnabled && inventoryView === 'operational') {
      setInventoryView('sellable');
    }
  }, [operationalEnabled, inventoryView]);

  return (
    <div className="space-y-5">
      {operationalEnabled && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-3 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="Stock In inventory type">
            <button type="button" aria-pressed={inventoryView === 'sellable'}
              onClick={() => setInventoryView('sellable')}
              className={cn('rounded-xl px-4 py-3 text-left border transition-colors', inventoryView === 'sellable'
                ? 'bg-emerald-50 border-emerald-500 text-emerald-900' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50')}>
              <div className="font-bold text-sm">Sellable Inventory</div>
              <div className="text-xs mt-1">Sales stock receipts and history</div>
            </button>
            <button type="button" aria-pressed={inventoryView === 'operational'}
              onClick={() => setInventoryView('operational')}
              className={cn('rounded-xl px-4 py-3 text-left border transition-colors', inventoryView === 'operational'
                ? 'bg-emerald-50 border-emerald-500 text-emerald-900' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50')}>
              <div className="font-bold text-sm">Operational Inventory</div>
              <div className="text-xs mt-1">Internal-use stock receipts and returns</div>
            </button>
          </div>
        </div>
      )}
      {operationalEnabled && inventoryView === 'operational'
        ? <div className="space-y-5"><OperationalBranchReturnForm /><OperationalBranchReceiptQueue branches={branches} /></div>
        : <StockInTab branches={branches} />}
    </div>
  );
};

/** Legacy transfers without an explicit inventoryClass remain Sellable only when
 * their order is not marked Operational. Operational transfers live in a separate ledger.
 * The Sellable UI must never render an explicit Operational transfer.
 */
export function isSellableStockInInvoice(invoice: Pick<TransferInvoice, 'inventoryClass' | 'transfer_type' | 'status'>): boolean {
  return invoice.inventoryClass !== 'OPERATIONAL'
    && invoice.status !== 'ready_for_dispatch';
}

const StockInTab: React.FC<{ branches: Branch[] }> = ({ branches }) => {
  const { profile, activeBranchId, hasPermission } = useAuth();
  const [invoices, setInvoices] = useState<TransferInvoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<TransferInvoice | null>(null);
  const receptionInFlightRef = useRef(false);
  const [receptionInFlight, setReceptionInFlight] = useState(false);
  const [invoiceLines, setInvoiceLines] = useState<TransferInvoiceLine[]>([]);
  const [receivingData, setReceivingData] = useState<Record<string, { accepted: number; queried: number; reason?: any }>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [staff, setStaff] = useState<any[]>([]);
  const [invoiceLinesLoading, setInvoiceLinesLoading] = useState(false);
  const [invoiceLinesError, setInvoiceLinesError] = useState<string | null>(null);
  const canOperateReception = hasPermission('stock', 'operate') && hasPermission('inventory', 'operate');
  useEffect(() => {
    if (!profile?.tenantId || !activeBranchId || !canOperateReception) return;
    reconcilePendingSellableReceipts(profile.tenantId, activeBranchId)
      .catch(error => console.error('Pending Stock In analytics recovery:', error));
  }, [profile?.tenantId, activeBranchId, canOperateReception]);


  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<any>('staff', profile.tenantId, setStaff);
    }
  }, [profile?.tenantId]);

  const getUserName = (uid?: string) => {
    if (!uid) return 'N/A';
    const found = staff.find(s => s.uid === uid || s.id === uid);
    return found ? (found.full_name || found.fullName || found.name || found.displayName || found.username || found.email || uid) : uid;
  };

  const getSenderName = (invoice: TransferInvoice) => {
    const directoryName = getUserName(invoice.dispatched_by);
    const storedName = invoice.dispatched_by_name?.trim();
    // Older dispatches stored the account email in the display-name field.
    if (storedName && !storedName.includes('@')) return storedName;
    return directoryName && directoryName !== invoice.dispatched_by ? directoryName : (storedName || directoryName);
  };

  const downloadExcelGRN = async (invoice: TransferInvoice) => {
    let lines = invoiceLines;
    if (invoice.id !== selectedInvoice?.id) {
      lines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [
        { field: 'tenantId', operator: '==', value: profile?.tenantId || '' },
        { field: 'transfer_id', operator: '==', value: invoice.id }
      ]);
    }

    const srcName = invoice.source_branch_id === 'HQ' ? 'HQ Central Store' : (branches.find(b => b.id === invoice.source_branch_id)?.name || invoice.source_branch_name || 'Branch Store');
    const destName = invoice.destination_branch_id === 'HQ' ? 'HQ Central Store' : (branches.find(b => b.id === invoice.destination_branch_id)?.name || invoice.destination_branch_name || 'Branch Store');
    const senderName = getSenderName(invoice);
    const receiverName = invoice.received_by ? (invoice.received_by_name || getUserName(invoice.received_by)) : 'N/A';
    const timeSent = invoice.dispatched_at ? new Date(invoice.dispatched_at).toLocaleString() : 'N/A';
    const timeRec = invoice.received_at ? new Date(invoice.received_at).toLocaleString() : 'N/A';
    
    let html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>GRN Details</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <style>
          table { border-collapse: collapse; font-family: Calibri, Arial, sans-serif; width: 100%; }
          td, th { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
          th { background-color: #047857; color: white; font-weight: bold; font-size: 11pt; }
          .title { font-size: 16pt; font-weight: bold; color: #065f46; text-align: center; padding-bottom: 15px; }
          .section-header { font-size: 12pt; font-weight: bold; color: #1e293b; background-color: #f1f5f9; padding: 6px; }
          .label { font-weight: bold; color: #4b5563; background-color: #f8fafc; width: 180px; }
          .value { color: #1f2937; }
          .total-row { font-weight: bold; background-color: #f1f5f9; }
          .number-cell { text-align: right; }
        </style>
      </head>
      <body>
        <table>
          <tr>
            <td colspan="8" class="title">GOODS RECEIVED NOTE (GRN) / INCOMING STOCK AUDIT INVOICE</td>
          </tr>
          <tr>
            <td colspan="8" class="section-header">INVOICE & AUDIT TRAIL METADATA</td>
          </tr>
          <tr>
            <td class="label">Invoice ID:</td>
            <td class="value" colspan="3">${invoice.transfer_number}</td>
            <td class="label">Transfer Type:</td>
            <td class="value" colspan="3">${invoice.transfer_type.replace(/_/g, ' ').toUpperCase()}</td>
          </tr>
          <tr>
            <td class="label">Source (From):</td>
            <td class="value" colspan="3">${srcName}</td>
            <td class="label">Destination (To):</td>
            <td class="value" colspan="3">${destName}</td>
          </tr>
          <tr>
            <td class="label">Sent/Dispatched By:</td>
            <td class="value" colspan="3">${senderName}</td>
            <td class="label">Sent/Dispatched When:</td>
            <td class="value" colspan="3">${timeSent}</td>
          </tr>
          <tr>
            <td class="label">Received/Verified By:</td>
            <td class="value" colspan="3">${receiverName}</td>
            <td class="label">Received/Verified When:</td>
            <td class="value" colspan="3">${timeRec}</td>
          </tr>
          <tr>
            <td class="label">Invoice Status:</td>
            <td class="value" colspan="3">${invoice.status.replace(/_/g, ' ').toUpperCase()}</td>
            <td class="label">Total Invoice Value:</td>
            <td class="value font-bold" colspan="3">UGX ${(invoice.total_value_ugx || 0).toLocaleString()}</td>
          </tr>
          <tr><td colspan="8"></td></tr>
          <tr>
            <td colspan="8" class="section-header">LINE ITEM DETAILS & QUANTITIES PER BATCH</td>
          </tr>
          <tr>
            <th>Product Name</th>
            <th>Product ID</th>
            <th>Batch Number</th>
            <th>Expiry Date</th>
            <th class="number-cell">Qty Dispatched (Packs)</th>
            <th class="number-cell">Qty Received (Packs)</th>
            <th class="number-cell">Cost Price per Pack (UGX)</th>
            <th class="number-cell">Total Row Value (UGX)</th>
          </tr>
    `;

    lines.forEach(l => {
      html += `
          <tr>
            <td>${l.product_name}</td>
            <td>${l.product_id}</td>
            <td>${l.batch_number || 'N/A'}</td>
            <td>${l.expiry_date ? new Date(l.expiry_date).toLocaleDateString() : 'N/A'}</td>
            <td class="number-cell">${l.qty_dispatched || 0}</td>
            <td class="number-cell">${l.qty_accepted ?? l.qty_received ?? l.qty_dispatched ?? 0}</td>
            <td class="number-cell">UGX ${(l.unit_cost_ugx || 0).toLocaleString()}</td>
            <td class="number-cell">UGX ${((l.qty_dispatched || 0) * (l.unit_cost_ugx || 0)).toLocaleString()}</td>
          </tr>
      `;
    });

    html += `
          <tr class="total-row">
            <td colspan="7">GRAND TOTAL INVOICE VALUE</td>
            <td class="number-cell">UGX ${(invoice.total_value_ugx || 0).toLocaleString()}</td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `GRN_${invoice.transfer_number}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Excel GRN invoice downloaded successfully!");
  };

  useEffect(() => {
    if (profile?.tenantId && activeBranchId) {
      return firestoreService.subscribeToCollectionByQuery<TransferInvoice>(
        'transfer_invoices',
        profile.tenantId,
        [where('destination_branch_id', '==', activeBranchId)],
        (filtered) => {
        const sellableInvoices = filtered.filter(isSellableStockInInvoice);
        if (showHistory) {
          setInvoices(sellableInvoices.filter(i => i.status === 'fully_accepted' || i.status === 'queried'));
        } else {
          setInvoices(sellableInvoices.filter(i => ['dispatched', 'receiving'].includes(i.status)));
        }
        }
      );
    }
  }, [profile?.tenantId, activeBranchId, showHistory]);

  if (!activeBranchId) {
    return (
      <div className="bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl p-12 text-center">
        <Building2 className="mx-auto text-zinc-300 mb-4" size={48} />
        <h3 className="text-lg font-bold text-zinc-900">No Branch Selected</h3>
        <p className="text-sm text-zinc-500 mt-2">Please select a branch from the header to manage stock-ins.</p>
      </div>
    );
  }

  const handleOpenReceive = async (invoice: TransferInvoice) => {
    if (!profile?.tenantId || invoice.destination_branch_id !== activeBranchId) {
      toast.error('This invoice is not assigned to the active branch.');
      return;
    }
    if (!isSellableStockInInvoice(invoice)) {
      toast.error('Operational stock must be received in Operational Stock In, not Sellable Stock In.');
      return;
    }
    if (!['dispatched', 'fully_accepted', 'queried'].includes(invoice.status)) {
      toast.error('Only physically dispatched Sellable transfers can be opened for reception.');
      return;
    }

    setSelectedInvoice(invoice);
    setInvoiceLines([]);
    setReceivingData({});
    setInvoiceLinesError(null);
    setInvoiceLinesLoading(true);

    try {
      const lines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [
        { field: 'tenantId', operator: '==', value: profile.tenantId },
        { field: 'transfer_id', operator: '==', value: invoice.id }
      ]);

      if (lines.length === 0) {
        setInvoiceLinesError('No product lines were found for this invoice. Reception has been blocked.');
        return;
      }

      setInvoiceLines(lines);
      const initialReceiving: Record<string, any> = {};
      lines.forEach(l => {
        initialReceiving[l.id] = { accepted: l.qty_dispatched, queried: 0 };
      });
      setReceivingData(initialReceiving);
    } catch (error) {
      console.error('Failed to load incoming invoice lines', error);
      setInvoiceLinesError('The invoice contents could not be loaded. Close this window and try again.');
    } finally {
      setInvoiceLinesLoading(false);
    }
  };

  const handleReceiveSubmit = async () => {
    if (receptionInFlightRef.current) return;
    if (!selectedInvoice || !profile?.tenantId || !activeBranchId) return;
    if (!canOperateReception) {
      toast.error('Your role can view this invoice but cannot confirm stock reception.');
      return;
    }
    if (invoiceLinesLoading || invoiceLinesError || invoiceLines.length === 0) {
      toast.error('Invoice products must load successfully before reception can be confirmed.');
      return;
    }
    if (selectedInvoice.destination_branch_id !== activeBranchId) {
      toast.error('This invoice is not assigned to the active branch.');
      return;
    }
    if (!isSellableStockInInvoice(selectedInvoice)) {
      toast.error('Operational transfers cannot be posted through Sellable Stock In.');
      return;
    }
    if (invoiceLines.some(line => line.inventoryClass === 'OPERATIONAL')) {
      toast.error('An Operational product was found in this Sellable invoice. Reception is blocked.');
      return;
    }
    if (invoiceLines.some(line => {
      const values = receivingData[line.id];
      return !values || !Number.isSafeInteger(values.accepted) || !Number.isSafeInteger(values.queried)
        || values.accepted < 0 || values.queried < 0
        || values.accepted + values.queried !== line.qty_dispatched;
    })) {
      toast.error('All dispatched quantities must be accounted for as accepted or queried.');
      return;
    }

    receptionInFlightRef.current = true;
    setReceptionInFlight(true);
    const selectedInvoiceRef = doc(db, 'transfer_invoices', selectedInvoice.id);
    let receptionClaimed = false;
    let receptionCommitted = false;
    try {
      await runTransaction(db, async transaction => {
        const current = await transaction.get(selectedInvoiceRef);
        if (!current.exists()) throw new Error('The dispatch no longer exists.');
        if (current.data().tenantId !== profile.tenantId ||
            current.data().destination_branch_id !== activeBranchId ||
            current.data().inventoryClass === 'OPERATIONAL') {
          throw new Error('Sellable reception must match the active tenant, branch and inventory class.');
        }
        const status = current.data().status;
        if (status === 'fully_accepted' || status === 'queried' || status === 'received') {
          throw new Error('This dispatch has already been received. No stock was added again.');
        }
        if (status === 'receiving') throw new Error('This dispatch is already being received by another session.');
        if (status !== 'dispatched') throw new Error('This transfer has not been physically dispatched. Reception cannot begin.');
        transaction.update(selectedInvoiceRef, {
          status: 'receiving',
          reception_claimed_by: profile.uid,
          reception_claimed_at: new Date().toISOString()
        });
      });
      receptionClaimed = true;

      const batchPromises = invoiceLines.map(line => 
        firestoreService.getDocumentsByQuery('product_batches', [
          { field: 'tenantId', operator: '==', value: profile.tenantId },
          { field: 'branchId', operator: '==', value: activeBranchId },
          { field: 'productId', operator: '==', value: line.product_id },
          { field: 'batchNumber', operator: '==', value: line.batch_number }
        ])
      );
      const productPromises = invoiceLines.map(line => 
        firestoreService.getDocument('products', line.product_id)
      );

      const [batchResults, productResults] = await Promise.all([
        Promise.all(batchPromises),
        Promise.all(productPromises)
      ]);

      const batchMap: Record<string, any> = {};
      const productMap: Record<string, any> = {};

      invoiceLines.forEach((line, index) => {
        if (batchResults[index] && batchResults[index].length > 0) {
          batchMap[line.id as string] = batchResults[index][0];
        }
        if (productResults[index]) {
          productMap[line.product_id as string] = productResults[index];
        }
      });

      const batch = writeBatch(db);

      let hasQueries = false;
      const successfulMovements: any[] = []; 

      for (const line of invoiceLines) {
        const data = receivingData[line.id];
        if (!data) continue;

        const lineRef = doc(db, 'transfer_invoice_lines', line.id);
        
        batch.update(lineRef, {
          qty_received: data.accepted,
          qty_accepted: data.accepted,
          qty_queried: data.queried,
          query_reason: data.reason || null,
          line_status: data.queried > 0 ? 'queried' : 'received',
          updatedAt: new Date().toISOString()
        });

        if (data.queried > 0) {
          hasQueries = true;
          const queryRef = doc(db, 'stock_queries', line.id);
          const queryObj = {
            id: line.id,
            tenantId: profile.tenantId,
            invoiceId: selectedInvoice.id,
            invoiceNumber: selectedInvoice.transfer_number,
            productId: line.product_id,
            productName: line.product_name,
            batchNumber: line.batch_number || 'N/A',
            qtyQueried: data.queried,
            unitCost: line.unit_cost_ugx || 0,
            amountAccrued: data.queried * (line.unit_cost_ugx || 0),
            reason: data.reason || 'Unspecified discrepancy',
            sourceBranchId: selectedInvoice.source_branch_id,
            sourceBranchName: selectedInvoice.source_branch_name,
            destinationBranchId: selectedInvoice.destination_branch_id,
            destinationBranchName: selectedInvoice.destination_branch_name,
            loggedBy: profile.uid,
            loggedByName: profile.fullName || profile.displayName || profile.email || 'Staff User',
            status: 'pending_return',
            timestamp: new Date().toISOString()
          };
          batch.set(queryRef, queryObj);
        }

        if (data.accepted > 0) {
          const existingBatch = batchMap[line.id as string];
          const product = productMap[line.product_id as string];
          const unitsPerPack = product?.unitsPerPack || 1;
          const totalUnitsAccepted = data.accepted * unitsPerPack;
          
          if (existingBatch) {
            const batchRef = doc(db, 'product_batches', existingBatch.id);
            batch.update(batchRef, {
              quantity: increment(totalUnitsAccepted),
              lastUpdated: new Date().toISOString()
            });
          } else {
            // Stable identity: concurrent first receipts for one product batch
            // must increment the same document rather than create duplicates.
            const newBatchId = ['stockin', profile.tenantId, activeBranchId, line.product_id,
              line.batch_number || 'N/A', line.expiry_date || '']
              .map(value => encodeURIComponent(String(value))).join('_');
            const newBatchRef = doc(db, 'product_batches', newBatchId);
            const purchasePricePerUnit = (line.unit_cost_ugx || 0) / unitsPerPack;
            const sellingPricePerUnit = product?.sellingPricePerUnit || (purchasePricePerUnit * 1.3);
            
            const newBatch = {
              tenantId: profile.tenantId,
              branchId: activeBranchId,
              productId: line.product_id,
              batchNumber: line.batch_number || 'N/A',
              expiryDate: line.expiry_date || '',
              quantity: totalUnitsAccepted,
              purchasePrice: purchasePricePerUnit,
              sellingPrice: sellingPricePerUnit,
              batch_status: 'active',
              lastUpdated: new Date().toISOString()
            };
            // merge + increment preserves simultaneous first receipts of the
            // same canonical batch even when neither caller saw it in a query.
            batch.set(newBatchRef, {
              ...newBatch, quantity: increment(totalUnitsAccepted),
              createdAt: new Date().toISOString()
            }, { merge: true });
          }

          if (product) {
            const productRef = doc(db, 'products', line.product_id);
            batch.update(productRef, {
              quantityInStock: increment(totalUnitsAccepted),
              updatedAt: new Date().toISOString()
            });
          }

          const movementId = sellableReceiptMovementId(selectedInvoice.id, line.id);
          batch.set(doc(db, 'sellable_receipt_movement_outbox', movementId), {
            tenantId: profile.tenantId, branchId: activeBranchId,
            productId: line.product_id, transferId: selectedInvoice.id,
            lineId: line.id, quantityBaseUnits: totalUnitsAccepted,
            actorId: profile.uid, effectiveAt: new Date().toISOString(),
            status: 'pending', createdAt: new Date().toISOString()
          });
          successfulMovements.push(movementId);
        }
      }

      const finalStatus = hasQueries ? 'queried' : 'fully_accepted';
      batch.update(selectedInvoiceRef, {
        status: finalStatus,
        received_at: new Date().toISOString(),
        received_by: profile?.uid,
        received_by_name: profile?.full_name || profile?.displayName || profile?.email || 'Unknown',
        updatedAt: new Date().toISOString()
      });

      if (selectedInvoice.order_id) {
        const orderRef = doc(db, 'stock_orders', selectedInvoice.order_id);
        batch.update(orderRef, {
          status: finalStatus === 'fully_accepted' ? 'closed' : 'queried',
          received_at: new Date().toISOString()
        });
      }

      await batch.commit();
      receptionCommitted = true;

      let analyticsOutstanding = false;
      for (const movementId of successfulMovements) {
        try {
          await replaySellableReceiptMovement(movementId, profile.tenantId, activeBranchId);
        } catch (logErr) {
          analyticsOutstanding = true;
          console.error('Receipt recorded; movement reconciliation will retry on next Stock In visit.', movementId, logErr);
        }
      }
      if (analyticsOutstanding) {
        toast.warning('Stock received successfully. Some analytics records will automatically retry on the next Stock In visit.');
      }

      toast.success("Stock verified and inventory updated.");
      setSelectedInvoice(null);
    } catch (error: any) {
      console.error(error);
      // Never reopen an already committed receipt when a later analytics write fails.
      if (receptionClaimed && !receptionCommitted) {
        try {
          await updateDoc(selectedInvoiceRef, {
            status: 'dispatched',
            reception_claimed_by: null,
            reception_claimed_at: null
          });
        } catch (releaseError) {
          console.error('Failed to release reception claim:', releaseError);
        }
      }
      toast.error(error?.message || "Failed to process reception.");
    } finally {
      receptionInFlightRef.current = false;
      setReceptionInFlight(false);
    }
  };

return (
    <div className="space-y-6">
      <StockInRegister history={showHistory} onHistoryChange={setShowHistory} canReceive={canOperateReception}
        rows={invoices.map(invoice => ({
          id: invoice.id, number: invoice.transfer_number,
          source: invoice.source_branch_id === 'HQ' ? 'Procurement Store' : (branches.find(b => b.id === invoice.source_branch_id)?.name || invoice.source_branch_name || 'Branch Transfer'),
          destination: branches.find(b => b.id === invoice.destination_branch_id)?.name || invoice.destination_branch_name || 'Current Branch',
          sender: getSenderName(invoice), sentAt: invoice.dispatched_at,
          receiver: invoice.received_by ? (invoice.received_by_name || getUserName(invoice.received_by)) : 'Pending',
          receivedAt: invoice.received_at, createdAt: invoice.createdAt,
          value: invoice.total_value_ugx ?? (invoice.items || []).reduce((sum, item) => sum + ((item.qty_dispatched || 0) * (item.unit_cost_ugx || 0)), 0),
          status: invoice.status, onOpen: () => void handleOpenReceive(invoice), onExport: () => void downloadExcelGRN(invoice)
        }))}/>

      {selectedInvoice && (
        <div className="fixed inset-0 bg-zinc-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-5xl max-h-[96vh] sm:max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-zinc-100">
            <div className="p-4 sm:p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
              <div>
                <h2 className="text-xl font-bold text-zinc-900">
                  {showHistory ? 'Goods Received Note (GRN) Details' : 'Verify Incoming Stock'}
                </h2>
                <p className="text-sm text-zinc-500">Invoice: {selectedInvoice.transfer_number}</p>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="text-zinc-400 hover:text-zinc-600 transition-colors p-2 hover:bg-zinc-100 rounded-full">
                <Plus className="rotate-45" size={24} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              {/* Detailed origin, destination, and sender/receiver trail */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-zinc-50 p-5 rounded-2xl border border-zinc-200 text-xs leading-relaxed">
                <div className="space-y-2">
                  <div>
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">Source Branch (From)</span>
                    <span className="font-bold text-zinc-800 text-sm block">
                      {selectedInvoice.source_branch_name || (branches.find(b => b.id === selectedInvoice.source_branch_id)?.name || 'HQ Central Depot')}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-zinc-200">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">Dispatched/Sent By &amp; When</span>
                    <span className="font-semibold text-zinc-700 block">{getSenderName(selectedInvoice)}</span>
                    <span className="text-zinc-500 font-mono text-[11px] block">
                      {selectedInvoice.dispatched_at ? new Date(selectedInvoice.dispatched_at).toLocaleString() : '--'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">Destination Branch (Arrived At)</span>
                    <span className="font-bold text-zinc-800 text-sm block">
                      {selectedInvoice.destination_branch_name || (branches.find(b => b.id === selectedInvoice.destination_branch_id)?.name || 'Destination Branch Store')}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-zinc-200">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">Received/Verified By &amp; When</span>
                    <span className="font-semibold text-zinc-700 block">
                      {selectedInvoice.received_by ? (selectedInvoice.received_by_name || getUserName(selectedInvoice.received_by)) : 'Pending Receipt Verification'}
                    </span>
                    <span className="text-zinc-500 font-mono text-[11px] block">
                      {selectedInvoice.received_at ? new Date(selectedInvoice.received_at).toLocaleString() : 'Pending'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border border-zinc-200 rounded-2xl overflow-x-auto shadow-sm">
                <table className="w-full min-w-[1000px] text-left border-collapse">
                  <thead>
                    <tr className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-100 bg-zinc-50/50">
                      <th className="px-4 py-3">Product</th>
                      <th className="px-4 py-3">Batch/Expiry</th>
                      <th className="px-4 py-3 text-center">Expected</th>
                      <th className="px-4 py-3 text-center w-24">Accepted</th>
                      <th className="px-4 py-3 text-center w-24">Queried</th>
                      <th className="px-4 py-3 text-right">Unit Price</th>
                      <th className="px-4 py-3 text-right">Total Cost</th>
                      <th className="px-4 py-3">Query Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {invoiceLinesLoading && (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-zinc-500">
                          <span className="inline-flex items-center gap-2 font-semibold">
                            <RotateCw size={16} className="animate-spin" /> Loading invoice products...
                          </span>
                        </td>
                      </tr>
                    )}
                    {!invoiceLinesLoading && invoiceLinesError && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center">
                          <div className="inline-flex max-w-xl items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm font-semibold text-red-700">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <span>{invoiceLinesError}</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {invoiceLines.map(line => (
                      <tr key={line.id} className="text-xs">
                        <td className="px-4 py-3">
                          <p className="font-bold text-zinc-900">{line.product_name}</p>
                          <p className="text-[10px] text-zinc-500">ID: {String(line.product_id || 'N/A').slice(0, 8)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-zinc-700 font-mono font-semibold">{line.batch_number}</p>
                          <p className="text-[10px] text-zinc-400">
                            {line.expiry_date ? new Date(line.expiry_date).toLocaleDateString() : 'N/A'}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-zinc-900">{line.qty_dispatched}</td>
                        <td className="px-4 py-3 text-center">
                          {showHistory || !canOperateReception ? (
                            <span className="font-bold text-emerald-600">{line.qty_accepted ?? line.qty_received ?? line.qty_dispatched ?? 0}</span>
                          ) : (
                            <input 
                              type="number" 
                              value={receivingData[line.id]?.accepted ?? ''}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                setReceivingData(prev => ({
                                  ...prev,
                                  [line.id]: { ...prev[line.id], accepted: val, queried: line.qty_dispatched - val }
                                }));
                              }}
                              className="w-full px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/20 text-center text-xs"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {showHistory || !canOperateReception ? (
                            <span className="font-bold text-red-600">{line.qty_queried || 0}</span>
                          ) : (
                            <input 
                              type="number" 
                              value={receivingData[line.id]?.queried ?? ''}
                              readOnly
                              className="w-full px-2 py-1 bg-zinc-100 border border-zinc-200 rounded-lg text-zinc-500 outline-none text-center text-xs"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-700">
                          UGX {(line.unit_cost_ugx || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-zinc-900">
                          UGX {((line.qty_dispatched || 0) * (line.unit_cost_ugx || 0)).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          {showHistory || !canOperateReception ? (
                            <span className="text-[11px] text-red-500 italic">{line.query_reason || '--'}</span>
                          ) : (
                            receivingData[line.id]?.queried > 0 && (
                              <select 
                                value={receivingData[line.id]?.reason || ''}
                                onChange={(e) => setReceivingData(prev => ({
                                  ...prev,
                                  [line.id]: { ...prev[line.id], reason: e.target.value }
                                }))}
                                className="w-full px-2 py-1 bg-red-50 border border-red-100 text-red-600 rounded-lg text-xs outline-none"
                              >
                                <option value="">Select Reason...</option>
                                <option value="damaged">Damaged</option>
                                <option value="short_expiry">Short Expiry</option>
                                <option value="wrong_price">Wrong Price</option>
                                <option value="wrong_product">Wrong Product</option>
                              </select>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-zinc-50/50 font-bold border-t border-zinc-200 text-xs">
                      <td colSpan={6} className="px-4 py-3 text-zinc-600 uppercase text-[10px] tracking-wider">Grand Invoice Total Value</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-zinc-900">
                        UGX {(selectedInvoice.total_value_ugx || 0).toLocaleString()}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="p-4 sm:p-6 border-t border-zinc-100 bg-zinc-50/50 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
              <div className="flex items-center gap-2 text-amber-600 text-xs font-bold">
                {!showHistory && canOperateReception && (
                  <>
                    <AlertCircle size={16} />
                    <span>Verify against physical invoice before submitting.</span>
                  </>
                )}
                {!showHistory && !canOperateReception && (
                  <span>View only. Your role cannot confirm or query stock reception.</span>
                )}
              </div>
              <div className="flex flex-wrap gap-3 w-full sm:w-auto sm:justify-end">
                {showHistory && (
                  <button 
                    onClick={() => downloadExcelGRN(selectedInvoice)}
                    className="px-6 py-2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-xl font-bold hover:bg-emerald-100 transition-colors flex items-center gap-1"
                  >
                    <Download size={16} /> Download Excel
                  </button>
                )}
                <button 
                  onClick={() => setSelectedInvoice(null)}
                  className="px-6 py-2 border border-zinc-200 rounded-xl font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
                >
                  {showHistory ? 'Close' : 'Cancel'}
                </button>
                {!showHistory && (
                  <button 
                    onClick={handleReceiveSubmit}
                    disabled={receptionInFlight || !canOperateReception || invoiceLinesLoading || !!invoiceLinesError || invoiceLines.length === 0}
                    className="px-8 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-colors shadow-lg shadow-emerald-500/20 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none"
                  >
                    {receptionInFlight ? 'Processing Reception…' : 'Confirm Reception'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const OperationalBranchReturnForm: React.FC = () => {
  const { profile, activeBranchId, hasPermission } = useAuth();
  const enabled = useOperationalInventoryFeature();
  const canReturn = hasPermission('stock', 'operate') && hasPermission('inventory', 'operate');
  const [items, setItems] = useState<OperationalInventory[]>([]);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!enabled || !profile?.tenantId || !activeBranchId || activeBranchId === 'HQ') { setItems([]); return; }
    return firestoreService.subscribeToCollectionByQuery<OperationalInventory>('operational_inventory', profile.tenantId, [where('branchId', '==', activeBranchId)], rows => setItems(rows.filter(row => row.branchId === activeBranchId && row.inventoryClass === 'OPERATIONAL' && row.masterItemId)));
  }, [enabled, profile?.tenantId, activeBranchId]);
  if (!enabled || !activeBranchId || activeBranchId === 'HQ') return null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile?.tenantId || !profile.uid || !canReturn) return;
    setSaving(true);
    try {
      const nextRequestId = requestId || globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      if (!requestId) setRequestId(nextRequestId);
      const result = await createOperationalBranchReturn({ tenantId: profile.tenantId, branchId: activeBranchId, itemId, quantity: Number(quantity), reason, requestId: nextRequestId, actor: { uid: profile.uid, name: profile.fullName || profile.displayName || profile.email || profile.uid } });
      toast.success(`Return ${result.transferNumber} dispatched to HQ Operational Store.`);
      setQuantity(''); setReason(''); setRequestId('');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create Operational return.'); }
    finally { setSaving(false); }
  };
  return <section className="rounded-2xl border border-amber-200 bg-white p-5"><h3 className="font-black text-amber-950">Operational Inventory Return to HQ</h3><p className="text-xs text-amber-800 mt-1">Dispatch reduces this branch’s Operational stock. HQ adds it only after confirmed receipt.</p><form onSubmit={submit} className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3"><select required value={itemId} onChange={event => { setItemId(event.target.value); setRequestId(''); }} className="border rounded-xl px-3 py-2 text-sm"><option value="">Select Operational item</option>{items.map(item => <option key={item.id} value={item.id}>{item.name} · SOH {item.quantityInStock} {item.unitOfIssue}</option>)}</select><input type="number" min="0.001" step="any" required value={quantity} onChange={event => { setQuantity(event.target.value); setRequestId(''); }} placeholder="Quantity" className="border rounded-xl px-3 py-2 text-sm" /><input required maxLength={300} value={reason} onChange={event => { setReason(event.target.value); setRequestId(''); }} placeholder="Return reason" className="border rounded-xl px-3 py-2 text-sm" /><button disabled={!canReturn || saving || !itemId} className="rounded-xl bg-amber-700 text-white px-4 py-2 text-sm font-bold disabled:opacity-50">{saving ? 'Dispatching…' : 'Create return'}</button></form></section>;
};

export const OperationalBranchReceiptQueue: React.FC<{ branches?: Branch[] }> = ({ branches = [] }) => {
  const { profile, activeBranchId, hasPermission } = useAuth();
  const enabled = useOperationalInventoryFeature();
  const [transfers, setTransfers] = useState<OperationalTransfer[]>([]);
  const [selectedTransfer, setSelectedTransfer] = useState<OperationalTransfer | null>(null);
  const [lines, setLines] = useState<OperationalTransferLine[]>([]);
  const [receiptValues, setReceiptValues] = useState<Record<string, { accepted: number; queried: number; reason: string }>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const canReceive = hasPermission('stock', 'operate') && hasPermission('inventory', 'operate');

  useEffect(() => {
    if (!enabled || !profile?.tenantId || !activeBranchId || activeBranchId === 'HQ') {
      setTransfers([]);
      return;
    }
    return firestoreService.subscribeToCollectionByQuery<OperationalTransfer>(
      'operational_transfers', profile.tenantId,
      [where('destinationBranchId', '==', activeBranchId)],
      setTransfers
    );
  }, [enabled, profile?.tenantId, activeBranchId]);

  useEffect(() => {
    if (!enabled && selectedTransfer) {
      setSelectedTransfer(null);
      setLines([]);
    }
  }, [enabled, selectedTransfer]);

  if (!enabled || !activeBranchId || activeBranchId === 'HQ') return null;
  const visibleTransfers = transfers.filter(transfer => showHistory
    ? ['received', 'queried'].includes(transfer.status)
    : ['dispatched', 'partially_received'].includes(transfer.status));

  const openTransfer = async (transfer: OperationalTransfer) => {
    if (transfer.destinationBranchId !== activeBranchId || !profile?.tenantId) {
      toast.error('This Operational transfer is not assigned to the active branch.');
      return;
    }
    setSelectedTransfer(transfer);
    setLines([]);
    setLoading(true);
    try {
      const transferLines = await firestoreService.getDocumentsByQuery<OperationalTransferLine>('operational_transfer_lines', [
        { field: 'tenantId', operator: '==', value: profile.tenantId },
        { field: 'transferId', operator: '==', value: transfer.id },
        { field: 'destinationBranchId', operator: '==', value: activeBranchId }
      ]);
      if (!transferLines.length) throw new Error('No Operational transfer lines were found. Receipt is blocked.');
      setLines(transferLines);
      setReceiptValues(Object.fromEntries(transferLines.map(line => [line.id, {
        accepted: line.status === 'dispatched' ? line.quantityDispatched : Number(line.quantityAccepted || 0),
        queried: line.status === 'dispatched' ? 0 : Number(line.quantityQueried || 0),
        reason: line.queryReason || ''
      }])));
    } catch (error) {
      setSelectedTransfer(null);
      toast.error(error instanceof Error ? error.message : 'Failed to load Operational transfer details.');
    } finally {
      setLoading(false);
    }
  };

  const submitReceipt = async () => {
    if (!selectedTransfer || !profile?.tenantId || !activeBranchId) return;
    if (!canReceive) {
      toast.error('Your role can view this Operational transfer but cannot confirm receipt.');
      return;
    }
    setSubmitting(true);
    try {
      for (const line of lines) {
        if (line.status !== 'dispatched') continue;
        const values = receiptValues[line.id];
        if (!values) throw new Error(`Enter the accepted and queried quantity for ${line.itemName}.`);
        await receiveOperationalTransferLine({
          tenantId: profile.tenantId, transferId: selectedTransfer.id, line,
          accepted: values.accepted, queried: values.queried,
          queryReason: values.reason,
          activeBranchId,
          actor: { uid: profile.uid, name: profile.fullName || profile.displayName || profile.email || profile.uid }
        });
      }
      toast.success('Operational receipt recorded. Accepted quantities are now in the branch Operational ledger.');
      setSelectedTransfer(null);
      setLines([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to receive Operational stock.');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadOperationalReceipt = async (transfer: OperationalTransfer) => {
    if (!profile?.tenantId || transfer.destinationBranchId !== activeBranchId) return;
    try {
      const records = await firestoreService.getDocumentsByQuery<OperationalTransferLine>('operational_transfer_lines', [
        { field: 'tenantId', operator: '==', value: profile.tenantId },
        { field: 'transferId', operator: '==', value: transfer.id },
        { field: 'destinationBranchId', operator: '==', value: activeBranchId }
      ]);
      await exportRecordsToExcel(records.map(line => ({
        'Invoice ID': transfer.transferNumber, 'Source order': transfer.sourceOrderNumber || 'HQ distribution',
        'Item': line.itemName, 'Dispatched quantity': line.quantityDispatched,
        'Accepted quantity': line.quantityAccepted || 0, 'Queried quantity': line.quantityQueried || 0,
        'Unit': line.unitOfIssue, 'Received at': transfer.receivedAt || '', 'Status': line.status
      })), 'Operational receipt', `${transfer.transferNumber}.xlsx`);
    } catch { toast.error('Unable to download the Operational receipt. Please retry.'); }
  };

  return (
    <section className="min-w-0 space-y-6">
      <StockInRegister history={showHistory} onHistoryChange={setShowHistory} canReceive={canReceive}
        rows={visibleTransfers.map(transfer => ({
          id: transfer.id, number: transfer.transferNumber,
          source: transfer.deliveryRoute === 'DIRECT_BRANCH' ? 'Direct supplier delivery' : 'HQ Operational Store',
          destination: transfer.destinationBranchName || branches.find(branch => branch.id === transfer.destinationBranchId)?.name || 'Current Branch',
          sender: transfer.dispatchedByName || 'Not recorded', sentAt: transfer.dispatchedAt,
          receiver: transfer.receivedByName || (transfer.receivedAt ? 'Not recorded' : 'Pending'),
          receivedAt: transfer.receivedAt, createdAt: transfer.createdAt, value: transfer.totalValueUGX || 0,
          status: transfer.status, onOpen: () => void openTransfer(transfer),
          onExport: () => void downloadOperationalReceipt(transfer)
        }))}/>

      {selectedTransfer && <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl min-w-0 flex-col overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
          <div className="shrink-0 border-b border-zinc-200 p-4 sm:p-5"><p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Operational Inventory Transfer</p><h3 className="mt-1 break-all text-lg font-black text-zinc-900 sm:text-xl">{selectedTransfer.transferNumber}</h3><p className="mt-1 text-sm font-medium text-zinc-700">{selectedTransfer.deliveryRoute === 'DIRECT_BRANCH' ? 'Supplier direct delivery' : 'HQ Operational Store'} → {selectedTransfer.destinationBranchName || activeBranchId}</p><p className="mt-1 text-sm text-zinc-700">Source: {selectedTransfer.sourceOrderNumber || 'HQ distribution'}</p></div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
            {loading ? <p className="py-8 text-center text-sm text-zinc-500">Loading transfer lines…</p> : <div className="overflow-x-auto rounded-xl border border-zinc-300">
              <table className="block w-full text-left md:table"><thead className="hidden bg-zinc-100 text-xs font-bold uppercase text-zinc-800 md:table-header-group"><tr><th className="p-3">Operational item</th><th className="p-3">Dispatched</th><th className="p-3">Accepted</th><th className="p-3">Queried</th><th className="p-3">Reason</th></tr></thead>
                <tbody className="block divide-y divide-zinc-200 md:table-row-group">{lines.map(line => {
                  const values = receiptValues[line.id] || { accepted: 0, queried: 0, reason: '' };
                  const readOnly = showHistory || line.status !== 'dispatched' || !canReceive;
                  return <tr key={line.id} className="block py-2 md:table-row md:py-0">
                    <td className="block p-3 md:table-cell"><p className="font-bold text-sm text-zinc-900">{line.itemName}</p><OperationalItemCode masterItemId={line.masterItemId} /></td>
                    <td className="block p-3 text-sm font-bold md:table-cell"><span className="mr-2 text-zinc-700 md:hidden">Dispatched:</span><span className="font-bold text-zinc-900">{line.quantityDispatched} {operationalIssueUnit(line.unitOfIssue) || 'units'}</span></td>
                    <td className="block p-3 md:table-cell"><span className="mr-3 inline-block min-w-20 text-sm font-semibold text-zinc-700 md:hidden">Accepted:</span><input aria-label={`Accepted quantity ${line.itemName}`} type="number" min="0" max={line.quantityDispatched} step="any" disabled={readOnly} value={values.accepted} onChange={event => { const accepted = Math.max(0, Number(event.target.value)); setReceiptValues(prev => ({ ...prev, [line.id]: { ...prev[line.id], accepted, queried: Math.max(0, line.quantityDispatched - accepted) } })); }} className="min-h-11 w-24 rounded-lg border border-zinc-400 bg-white px-2 py-2 text-sm font-semibold text-zinc-900 disabled:bg-zinc-100" /></td>
                    <td className="block p-3 md:table-cell"><span className="mr-3 inline-block min-w-20 text-sm font-semibold text-zinc-700 md:hidden">Queried:</span><input aria-label={`Queried quantity ${line.itemName}`} type="number" readOnly disabled={readOnly} value={values.queried} className="min-h-11 w-24 rounded-lg border border-zinc-300 bg-zinc-100 px-2 py-2 text-sm font-semibold text-zinc-900" /></td>
                    <td className="block p-3 md:table-cell">{values.queried > 0 && <select disabled={readOnly} value={values.reason} onChange={event => setReceiptValues(prev => ({ ...prev, [line.id]: { ...prev[line.id], reason: event.target.value } }))} className="min-h-11 w-full rounded-lg md:w-44 border border-zinc-400 bg-white px-2 py-2 text-sm font-medium text-zinc-900"><option value="">Select reason</option><option value="wrong_item">Wrong item</option><option value="damaged">Damaged</option><option value="short_quantity">Short quantity</option><option value="quality_query">Quality query</option><option value="other">Other</option></select>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>}
          </div>
          <div className="flex shrink-0 flex-col gap-3 border-t border-zinc-200 bg-zinc-50 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-zinc-700">Queried units are excluded from branch stock on hand and remain linked to this transfer.</p><div className="flex flex-wrap gap-2"><button onClick={() => setSelectedTransfer(null)} disabled={submitting} className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-bold text-zinc-900">Close</button>{!showHistory && <button onClick={() => void submitReceipt()} disabled={!canReceive || loading || submitting || lines.every(line => line.status !== 'dispatched')} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40">{submitting ? 'Saving…' : 'Confirm Operational receipt'}</button>}</div></div>
        </div>
      </div>}
    </section>
  );
};

const QueriedItemsTab: React.FC = () => {
  const { profile, activeBranchId } = useAuth();
  const [queriedLines, setQueriedLines] = useState<TransferInvoiceLine[]>([]);
  const [auditQueries, setAuditQueries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [auditDateRange, setAuditDateRange] = useState({ 
    start: '', 
    end: '' 
  });

  useEffect(() => {
    if (profile?.tenantId && activeBranchId) {
      const unsubscribe = firestoreService.subscribeToCollection<TransferInvoiceLine>('transfer_invoice_lines', profile.tenantId, (data) => {
        // Filter for lines with queries that haven't been resolved/returned yet
        const filtered = data.filter(l => l.qty_queried > 0 && l.line_status !== 'returned');
        setQueriedLines(filtered);
        setLoading(false);
      });

      const unsubQueries = firestoreService.subscribeToCollection<any>('stock_queries', profile.tenantId, (data) => {
        setAuditQueries(data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      });

      return () => {
        unsubscribe();
        unsubQueries();
      };
    }
  }, [profile?.tenantId, activeBranchId]);

  const filteredAuditQueries = auditQueries.filter(q => {
    const qDate = new Date(q.timestamp).toISOString().split('T')[0];
    const matchesStart = !auditDateRange.start || qDate >= auditDateRange.start;
    const matchesEnd = !auditDateRange.end || qDate <= auditDateRange.end;
    return matchesStart && matchesEnd;
  });

  const handleReturnToHQ = async (line: TransferInvoiceLine) => {
    if (!profile?.tenantId || !activeBranchId) return;
    setProcessing(true);
    try {
      // Pre-fetch HQ batch to avoid getDocs inside transaction
      const hqBatches = await firestoreService.getDocumentsByQuery<ProductBatch>('product_batches', [
        { field: 'tenantId', operator: '==', value: profile.tenantId },
        { field: 'branchId', operator: '==', value: 'HQ' },
        { field: 'productId', operator: '==', value: line.product_id },
        { field: 'batchNumber', operator: '==', value: line.batch_number }
      ]);

      await firestoreService.runTransaction(async (transaction) => {
        // 1. Create Return Transfer Invoice
        const returnTransferData: Partial<TransferInvoice> = {
          tenantId: profile.tenantId,
          inventoryClass: line.inventoryClass || 'SELLABLE',
          transfer_number: `RET-HQ-${Date.now()}`,
          source_branch_id: activeBranchId!,
          source_branch_name: 'Branch Store',
          destination_branch_id: 'HQ',
          destination_branch_name: 'Central HQ',
          transfer_type: 'query_return',
          status: 'dispatched',
          dispatched_by: profile.uid,
          dispatched_at: new Date().toISOString(),
          total_value_ugx: (line.qty_queried || 0) * (line.unit_cost_ugx || 0),
          notes: `Return to HQ for queried item: ${line.product_name}. Reason: ${line.query_reason}`
        };
        const returnRef = doc(collection(db, 'transfer_invoices'));
        transaction.set(returnRef, { ...returnTransferData, createdAt: new Date().toISOString() });

        // 2. Create Return Line
        const returnLineRef = doc(collection(db, 'transfer_invoice_lines'));
        transaction.set(returnLineRef, {
          tenantId: profile.tenantId,
          inventoryClass: line.inventoryClass || 'SELLABLE',
          transfer_id: returnRef.id,
          product_id: line.product_id,
          product_name: line.product_name,
          batch_number: line.batch_number,
          expiry_date: line.expiry_date,
          qty_dispatched: line.qty_queried,
          unit_cost_ugx: line.unit_cost_ugx,
          total_cost_ugx: (line.qty_queried || 0) * line.unit_cost_ugx,
          line_status: 'dispatched',
          createdAt: new Date().toISOString()
        });

        // 3. Update original line status
        const lineRef = doc(db, 'transfer_invoice_lines', line.id);
        transaction.update(lineRef, {
          line_status: 'returned',
          updatedAt: new Date().toISOString()
        });

        // 4. Update the persistent stock_queries status to returned_to_hq
        const queryDocRef = doc(db, 'stock_queries', line.id);
        transaction.set(queryDocRef, {
          status: 'returned_to_hq',
          resolvedAt: new Date().toISOString()
        }, { merge: true });

        // 5. Add back to HQ stock (since it's being returned)
        if (hqBatches.length > 0) {
          const hqBatchRef = doc(db, 'product_batches', hqBatches[0].id);
          transaction.update(hqBatchRef, {
            quantity: hqBatches[0].quantity + (line.qty_queried || 0),
            lastUpdated: new Date().toISOString()
          });
        } else {
          const newHqBatchRef = doc(collection(db, 'product_batches'));
          transaction.set(newHqBatchRef, {
            tenantId: profile.tenantId,
            branchId: 'HQ',
            productId: line.product_id,
            batchNumber: line.batch_number,
            expiryDate: line.expiry_date,
            quantity: line.qty_queried,
            purchasePrice: line.unit_cost_ugx,
            sellingPrice: line.unit_cost_ugx * 1.3,
            batch_status: 'active',
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          });
        }
      });
      toast.success("Item returned to HQ stores successfully.");
    } catch (error) {
      console.error(error);
      toast.error("Failed to return item to HQ.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-zinc-900">Queried Items Verification</h3>
            <p className="text-xs text-zinc-500">Flagged stock receiving errors currently awaiting physical processing.</p>
          </div>
          <span className="text-xs bg-amber-50 text-amber-600 font-bold px-3 py-1 rounded-full border border-amber-200">
            {queriedLines.length} Pending
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Product / Item</th>
                <th className="px-6 py-4">Batch Code</th>
                <th className="px-6 py-4">Qty Discrepant</th>
                <th className="px-6 py-4">Reason Given</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Action Gate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {queriedLines.map((line) => (
                <tr key={line.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-bold text-zinc-900">{line.product_name}</p>
                    <p className="text-[10px] text-zinc-400 font-mono">Line: {line.id.slice(0, 10)}</p>
                  </td>
                  <td className="px-6 py-4 text-sm font-mono text-zinc-600">{line.batch_number}</td>
                  <td className="px-6 py-4 font-bold text-red-600">
                    {line.qty_queried} packs
                    <span className="block text-[10px] font-black text-indigo-600 mt-1 uppercase tracking-wider">
                      Accrued: UGX {((line.qty_queried || 0) * (line.unit_cost_ugx || 0)).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2.5 py-1 bg-red-50 text-red-600 rounded-md text-[10px] font-bold uppercase tracking-wider border border-red-100">
                      {line.query_reason || 'Unspecified'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2.5 py-1 bg-amber-50 text-amber-600 rounded-md text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      Discrepancy Logged
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleReturnToHQ(line)}
                      disabled={processing}
                      className="px-4 py-1.5 bg-zinc-900 text-white rounded-xl text-xs font-bold hover:bg-zinc-800 transition-all disabled:opacity-50"
                    >
                      {processing ? 'Processing...' : 'Return to HQ'}
                    </button>
                  </td>
                </tr>
              ))}
              {queriedLines.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">
                    No active discrepant stock items found in review queue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Persistent Queries Followup & Historical Audit Log Section */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-100 bg-zinc-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-zinc-900">Query Followup & Audit Log</h3>
            <p className="text-xs text-zinc-500">Historical immutable log of all incoming stock queries raised for auditing and compliance tracking.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Filter Date:</span>
            <input 
              type="date" 
              value={auditDateRange.start} 
              onChange={(e) => setAuditDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <span className="text-xs font-bold text-zinc-400">to</span>
            <input 
              type="date" 
              value={auditDateRange.end} 
              onChange={(e) => setAuditDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Date Logged</th>
                <th className="px-6 py-4">Invoice #</th>
                <th className="px-6 py-4">Product & Batch</th>
                <th className="px-6 py-4">Qty & Reason</th>
                <th className="px-6 py-4">Logged By</th>
                <th className="px-6 py-4">Resolution Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-sm">
              {filteredAuditQueries.map((q) => (
                <tr key={q.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4 text-xs font-mono text-zinc-500">
                    {new Date(q.timestamp).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 font-semibold text-zinc-700">
                    {q.invoiceNumber || 'Unknown'}
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-semibold text-zinc-900">{q.productName}</p>
                    <p className="text-[10px] text-zinc-500 font-mono">Batch: {q.batchNumber}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-bold text-zinc-900">{q.qtyQueried} units</p>
                    <p className="text-xs text-red-500 italic mb-1">{q.reason}</p>
                    <span className="block text-[10px] font-black text-indigo-600 uppercase tracking-wider">
                      Accrued: UGX {(q.amountAccrued || q.qtyQueried * (q.unitCost || 0)).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-zinc-600">
                    {q.loggedByName || 'Staff'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                      q.status === 'returned_to_hq' 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}>
                      {q.status === 'returned_to_hq' ? 'Resolved & Returned to HQ' : 'Logged / Pending return'}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredAuditQueries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">
                    Invoice query audit database is empty for selected date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const TransferOutTab: React.FC<{ branches: Branch[] }> = ({ branches }) => {
  const { profile, activeBranchId } = useAuth();
  const [destinationBranch, setDestinationBranch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [transferLines, setTransferLines] = useState<Partial<TransferInvoiceLine>[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productBatches, setProductBatches] = useState<ProductBatch[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [transferHistory, setTransferHistory] = useState<TransferInvoice[]>([]);
  const [historyDateRange, setHistoryDateRange] = useState({ 
    start: '', 
    end: '' 
  });
  const [selectedTransfer, setSelectedTransfer] = useState<TransferInvoice | null>(null);
  const [selectedTransferLines, setSelectedTransferLines] = useState<TransferInvoiceLine[]>([]);
  const [transferSearch, setTransferSearch] = useState('');
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [staff, setStaff] = useState<any[]>([]);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<any>('staff', profile.tenantId, setStaff);
    }
  }, [profile?.tenantId]);

  const getUserName = (uid?: string) => {
    if (!uid) return 'N/A';
    const found = staff.find(s => s.uid === uid || s.id === uid);
    return found ? (found.full_name || found.displayName || found.username || found.email) : uid;
  };

  const getProductCustomId = (id: string) => {
    const prod = products.find(p => p.id === id || p.productId === id);
    return prod ? prod.productId : id;
  };

  const handleDownloadTransfer = async (transfer: TransferInvoice, linesToUse?: TransferInvoiceLine[]) => {
    let lines = linesToUse || transfer.items || [];
    if (lines.length === 0) {
      try {
        lines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [
          { field: 'tenantId', operator: '==', value: profile?.tenantId || '' },
          { field: 'transfer_id', operator: '==', value: transfer.id }
        ]);
      } catch (err) {
        console.error("Error fetching transfer lines for download:", err);
      }
    }

    const BOM = "\uFEFF";
    let csvContent = BOM + "STOCK TRANSFER OUT / TRANSFERRED GRN HISTORY STATEMENT\n\n";
    csvContent += `Transfer Number,${transfer.transfer_number}\n`;
    csvContent += `Type,${transfer.transfer_type.replace(/_/g, ' ')}\n`;
    csvContent += `Source (Origin),"${(transfer.source_branch_name || 'HQ Central Depot').replace(/"/g, '""')}"\n`;
    csvContent += `Destination,"${(transfer.destination_branch_name || 'Receiving Branch').replace(/"/g, '""')}"\n`;
    csvContent += `Sent/Dispatched By,"${getUserName(transfer.dispatched_by).replace(/"/g, '""')}"\n`;
    csvContent += `Sent/Dispatched At,${transfer.dispatched_at || 'N/A'}\n`;
    csvContent += `Received/Verified By,"${(transfer.received_by ? getUserName(transfer.received_by) : 'Pending verification').replace(/"/g, '""')}"\n`;
    csvContent += `Received/Verified At,${transfer.received_at || 'N/A'}\n`;
    csvContent += `Status,${transfer.status}\n`;
    csvContent += `Total Transfer Value,UGX ${transfer.total_value_ugx || 0}\n\n`;
    csvContent += "Product ID,Product Name,Batch Number,Expiry Date,Qty Dispatched,Qty Received,Unit Cost Price (UGX),Total Costs Value (UGX)\n";
    
    lines.forEach(line => {
      const row = [
        getProductCustomId(line.product_id),
        `"${(line.product_name || '').replace(/"/g, '""')}"`,
        line.batch_number || 'N/A',
        line.expiry_date || 'N/A',
        line.qty_dispatched || 0,
        line.qty_received ?? line.qty_dispatched ?? 0,
        line.unit_cost_ugx || 0,
        (line.qty_dispatched || 0) * (line.unit_cost_ugx || 0)
      ].join(",");
      csvContent += row + "\n";
    });
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `TRANSFER_${transfer.transfer_number}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleViewTransfer = async (transfer: TransferInvoice) => {
    setSelectedTransfer(transfer);
    setSelectedTransferLines([]);
    try {
      const lines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [
        { field: 'tenantId', operator: '==', value: profile?.tenantId || '' },
        { field: 'transfer_id', operator: '==', value: transfer.id }
      ]);
      setSelectedTransferLines(lines);
    } catch (err) {
      console.error("Error loading transfer lines:", err);
    }
  };

  useEffect(() => {
    if (profile?.tenantId && activeBranchId) {
      firestoreService.subscribeToCollection<Product>('products', profile.tenantId, setProducts);
      firestoreService.subscribeToCollection<ProductBatch>('product_batches', profile.tenantId, (data) => {
        setBatches(data.filter(b => b.branchId === activeBranchId && b.quantity > 0));
      });
      firestoreService.subscribeToCollection<TransferInvoice>('transfer_invoices', profile.tenantId, (data) => {
        setTransferHistory(data.filter(i => i.source_branch_id === activeBranchId));
      });
    }
  }, [profile?.tenantId, activeBranchId]);

  const displayedTransferHistory = transferHistory.filter(t => {
    const tDate = (t.dispatched_at || t.createdAt || '').split('T')[0];
    const matchesStart = !historyDateRange.start || tDate >= historyDateRange.start;
    const matchesEnd = !historyDateRange.end || tDate <= historyDateRange.end;
    
    if (!matchesStart || !matchesEnd) return false;

    if (transferSearch.trim()) {
      const q = transferSearch.toLowerCase().trim();
      const transferId = (t.transfer_number || '').toLowerCase();
      const invoiceId = (t.id || '').toLowerCase();
      const srcName = (t.source_branch_name || (branches.find(b => b.id === t.source_branch_id)?.name || 'HQ Central Depot')).toLowerCase();
      const destName = (t.destination_branch_name || (branches.find(b => b.id === t.destination_branch_id)?.name || 'Destination Branch Store')).toLowerCase();
      const sender = getUserName(t.dispatched_by).toLowerCase();
      const receiver = t.received_by ? getUserName(t.received_by).toLowerCase() : 'pending';
      
      return transferId.includes(q) || 
             invoiceId.includes(q) || 
             srcName.includes(q) || 
             destName.includes(q) || 
             sender.includes(q) || 
             receiver.includes(q);
    }

    return true;
  });

  if (!activeBranchId) {
    return (
      <div className="bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl p-12 text-center">
        <Building2 className="mx-auto text-zinc-300 mb-4" size={48} />
        <h3 className="text-lg font-bold text-zinc-900">No Branch Selected</h3>
        <p className="text-sm text-zinc-500 mt-2">Please select a branch from the header to manage transfers.</p>
      </div>
    );
  }

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setProductBatches(batches.filter(b => b.productId === product.id));
  };

  const addBatchToTransfer = (batch: ProductBatch) => {
    if (transferLines.find(l => l.batch_number === batch.batchNumber)) {
      toast.error("Batch already added.");
      return;
    }
    setTransferLines([...transferLines, {
      product_id: batch.productId,
      product_name: selectedProduct?.name,
      batch_number: batch.batchNumber,
      expiry_date: batch.expiryDate,
      qty_dispatched: 1,
      unit_cost_ugx: batch.purchasePrice,
      line_total_ugx: batch.purchasePrice,
      tenantId: profile?.tenantId,
      batch_id: batch.id
    }]);
    setSelectedProduct(null);
  };

  const updateLineQty = (batchNumber: string, qty: number) => {
    setTransferLines(transferLines.map(l => {
      if (l.batch_number === batchNumber) {
        const batch = batches.find(b => b.batchNumber === batchNumber);
        if (batch && qty > batch.quantity) {
          toast.error(`Only ${batch.quantity} available in this batch.`);
          qty = batch.quantity;
        }
        return { ...l, qty_dispatched: qty, line_total_ugx: qty * (l.unit_cost_ugx || 0) };
      }
      return l;
    }));
  };

  const handleTransfer = () => {
    if (!destinationBranch || transferLines.length === 0 || !profile?.tenantId) {
      toast.error("Please select a destination and add products.");
      return;
    }
    // Check if any transfer line has 0 or invalid quantity
    const hasInvalidQty = transferLines.some(l => !l.qty_dispatched || l.qty_dispatched <= 0);
    if (hasInvalidQty) {
      toast.error("Please enter a quantity greater than zero for all lines.");
      return;
    }
    setShowPreviewModal(true);
  };

  const executeTransfer = async () => {
    if (isDispatching) return;
    setIsDispatching(true);
    try {
      // Pre-fetch batches to avoid getDocs inside transaction
      const batchPromises = transferLines.map(line => 
        firestoreService.getDocument<ProductBatch>('product_batches', line.batch_id!)
      );
      const batchResults = await Promise.all(batchPromises);
      const batchMap: Record<string, ProductBatch> = {};
      batchResults.forEach(batch => {
        if (batch) batchMap[batch.id] = batch;
      });

      // Pre-fetch source branch batch refs for all products in transfer
      const uniqueProductIds = Array.from(new Set<string>(transferLines.map(line => String(line.product_id))));
      const branchBatchRefsMap: Record<string, { ref: any; id: string }[]> = {};
      for (const pId of uniqueProductIds) {
        branchBatchRefsMap[pId] = await getBranchProductBatchRefs(
          profile?.tenantId!,
          activeBranchId || 'main',
          pId
        );
      }

      await firestoreService.runTransaction(async (transaction) => {
        const transferData: Partial<TransferInvoice> = {
          tenantId: profile?.tenantId,
          inventoryClass: 'SELLABLE',
          transfer_number: `TRF-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`,
          source_branch_id: activeBranchId || 'main',
          source_branch_name: branches.find(b => b.id === activeBranchId)?.name || 'HQ Central Depot',
          destination_branch_id: destinationBranch,
          destination_branch_name: destinationBranch === 'HQ' ? 'HQ Central Store / Main Depot' : (branches.find(b => b.id === destinationBranch)?.name || 'Receiving Branch'),
          transfer_type: destinationBranch === 'HQ' ? 'branch_to_central' : 'branch_to_branch',
          status: 'dispatched',
          dispatched_by: profile?.uid,
          dispatched_at: new Date().toISOString(),
          total_value_ugx: transferLines.reduce((sum, l) => sum + (l.line_total_ugx || 0), 0),
          items: transferLines as TransferInvoiceLine[]
        };

        const transferRef = doc(collection(db, 'transfer_invoices'));
        transaction.set(transferRef, { ...transferData, createdAt: new Date().toISOString() });

        for (const line of transferLines) {
          const lineRef = doc(collection(db, 'transfer_invoice_lines'));
          transaction.set(lineRef, {
            ...line,
            inventoryClass: line.inventoryClass || 'SELLABLE',
            transfer_id: transferRef.id,
            createdAt: new Date().toISOString()
          });
          
          // Decrement batch quantity in source branch
          const batch = batchMap[line.batch_id!];
          if (batch) {
            const newQty = batch.quantity - (line.qty_dispatched || 0);
            if (newQty < 0) {
              throw new Error(`Insufficient stock for batch ${line.batch_number}`);
            }
            
            const batchRef = doc(db, 'product_batches', batch.id);
            transaction.update(batchRef, {
              quantity: newQty,
              lastUpdated: new Date().toISOString()
            });

            // Log TRANSFER_OUT movement event & update summaries
            const batchRefs = branchBatchRefsMap[line.product_id!] || [];
            await logMovementAndAggregateInTx(transaction, batchRefs, {
              tenantId: profile?.tenantId!,
              branchId: activeBranchId || 'main',
              productId: line.product_id!,
              eventType: 'TRANSFER_OUT',
              quantityDeltaBaseUnits: -(line.qty_dispatched || 0),
              consumptionDeltaBaseUnits: 0,
              isExceptional: false,
              exceptionalReason: null,
              sourceCollection: 'transfer_invoices',
              sourceDocumentId: transferRef.id,
              sourceLineId: line.batch_id!,
              reversalOfEventId: null,
              createdBy: profile?.uid || 'system',
              effectiveAt: new Date(),
              timezone: 'Africa/Kampala'
            });
          } else {
            throw new Error(`Batch ${line.batch_number} not found in inventory.`);
          }
        }
      });

      toast.success("Transfer dispatched and inventory updated.");
      setTransferLines([]);
      setDestinationBranch('');
      setShowPreviewModal(false);
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Failed to dispatch transfer.");
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex gap-2 p-1 bg-zinc-100 rounded-xl w-fit">
          <button 
            onClick={() => setShowHistory(false)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
              !showHistory ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            New Transfer
          </button>
          <button 
            onClick={() => setShowHistory(true)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
              showHistory ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            Transfer History
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-zinc-200 px-3 py-1.5 rounded-xl min-w-[260px]">
            <Search size={14} className="text-zinc-400" />
            <input 
              type="text" 
              placeholder="Search ID, source, dest, sender..." 
              value={transferSearch} 
              onChange={(e) => setTransferSearch(e.target.value)}
              className="bg-transparent border-none text-xs outline-none w-full placeholder-zinc-400 text-zinc-800"
            />
            {transferSearch && (
              <button onClick={() => setTransferSearch('')} className="text-zinc-400 hover:text-zinc-600">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 bg-white border border-zinc-200 px-3 py-1.5 rounded-xl">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Dates:</span>
            <input 
              type="date" 
              value={historyDateRange.start} 
              onChange={(e) => setHistoryDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="bg-transparent border-none text-xs outline-none focus:ring-0 text-zinc-700 w-[110px]"
            />
            <span className="text-xs font-bold text-zinc-400">to</span>
            <input 
              type="date" 
              value={historyDateRange.end} 
              onChange={(e) => setHistoryDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="bg-transparent border-none text-xs outline-none focus:ring-0 text-zinc-700 w-[110px]"
            />
          </div>
        </div>
      </div>

      {!showHistory ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Destination Branch</label>
                <select 
                  value={destinationBranch}
                  onChange={(e) => setDestinationBranch(e.target.value)}
                  className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                >
                  <option value="">Select Destination...</option>
                  {branches.filter(b => b.id !== activeBranchId).map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                  <option value="HQ">Procurement Store (Return)</option>
                </select>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                <h3 className="font-bold text-zinc-900">Transfer Items</h3>
                <div className="text-xs font-bold text-zinc-500">
                  Total Value: <span className="text-emerald-600">UGX {transferLines.reduce((sum, l) => sum + (l.line_total_ugx || 0), 0).toLocaleString()}</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100">
                      <th className="px-6 py-3">Product</th>
                      <th className="px-6 py-3">Batch</th>
                      <th className="px-6 py-3 w-36">Qty to Transfer</th>
                      <th className="px-6 py-3">Line Total</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {transferLines.map(line => (
                      <tr key={line.batch_number} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <p className="font-medium text-zinc-900">{line.product_name}</p>
                          <p className="text-[10px] text-zinc-400">Expiry: {new Date(line.expiry_date!).toLocaleDateString()}</p>
                        </td>
                        <td className="px-6 py-4 text-sm font-mono text-zinc-600">{line.batch_number}</td>
                        <td className="px-6 py-4">
                          <input 
                            type="number" 
                            min="1"
                            value={line.qty_dispatched ?? ''}
                            onChange={(e) => updateLineQty(line.batch_number!, parseInt(e.target.value) || 0)}
                            className="w-32 px-3 py-2 text-base font-black text-zinc-950 bg-zinc-50 border border-zinc-300 rounded-xl outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
                          />
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-zinc-900">{line.line_total_ugx?.toLocaleString()}</td>
                        <td className="px-6 py-4 text-right">
                          <button 
                            onClick={() => setTransferLines(prev => prev.filter(l => l.batch_number !== line.batch_number))}
                            className="text-red-500 hover:text-red-700 font-bold"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                    {transferLines.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                          No items added. Search and select batches from the right panel.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="p-6 border-t border-zinc-100 flex justify-end">
                <button 
                  onClick={handleTransfer}
                  className="px-8 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-colors shadow-lg shadow-emerald-500/20"
                >
                  Dispatch Transfer
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
              <h3 className="font-bold text-zinc-900 mb-4">Inventory Search</h3>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                <input 
                  type="text" 
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                />
              </div>
              
              {selectedProduct ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-zinc-900">{selectedProduct.name}</h4>
                    <button onClick={() => setSelectedProduct(null)} className="text-xs text-zinc-500 hover:underline">Back</button>
                  </div>
                  <div className="space-y-2">
                    {productBatches.map(batch => (
                      <button
                        key={batch.id}
                        onClick={() => addBatchToTransfer(batch)}
                        className="w-full p-3 text-left border border-zinc-100 rounded-xl hover:border-emerald-500 hover:bg-emerald-50/30 transition-all"
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-xs font-bold text-zinc-700">Batch: {batch.batchNumber}</p>
                            <p className="text-[10px] text-zinc-500">Exp: {new Date(batch.expiryDate).toLocaleDateString()}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-emerald-600">{batch.quantity} in stock</p>
                            <p className="text-[10px] text-zinc-400">UGX {batch.purchasePrice.toLocaleString()}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                    {productBatches.length === 0 && (
                      <p className="text-center py-4 text-xs text-zinc-400 italic">No active batches found for this product.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  {filteredProducts.map(product => (
                    <button
                      key={product.id}
                      onClick={() => handleSelectProduct(product)}
                      className="w-full p-3 text-left border border-zinc-100 rounded-xl hover:border-emerald-500 hover:bg-emerald-50/30 transition-all group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-zinc-900 text-sm truncate">{product.name}</p>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{product.sku}</p>
                        </div>
                        <ChevronRight size={16} className="text-zinc-300 group-hover:text-emerald-500" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                  <th className="px-6 py-4">Transfer #</th>
                  <th className="px-6 py-4">Destination</th>
                  <th className="px-6 py-4">Products Transferred</th>
                  <th className="px-6 py-4">Transferred By</th>
                  <th className="px-6 py-4">Received By</th>
                  <th className="px-6 py-4 font-bold text-zinc-800">Total Value</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {displayedTransferHistory.map(transfer => {
                  const transferValue = transfer.total_value_ugx || (transfer.items || []).reduce((sum, item) => sum + ((item.qty_dispatched || 0) * (item.unit_cost_ugx || 0)), 0);
                  const isPending = transfer.status !== 'fully_accepted' && transfer.status !== 'closed' && transfer.status !== 'queried';
                  const itemsSummary = (transfer.items || []).map(item => `${item.product_name || 'Product'} (x${item.qty_dispatched})`).join(', ');
                  const truncatedSummary = itemsSummary.length > 40 ? itemsSummary.slice(0, 37) + '...' : itemsSummary;
                  return (
                    <tr key={transfer.id} className="hover:bg-zinc-50/50 transition-colors text-xs">
                      <td className="px-6 py-4 font-bold text-zinc-900">{transfer.transfer_number}</td>
                      <td className="px-6 py-4 text-zinc-700 font-semibold">
                        {transfer.destination_branch_id === 'HQ' ? 'Procurement Store' : (branches.find(b => b.id === transfer.destination_branch_id)?.name || 'Unknown')}
                      </td>
                      <td className="px-6 py-4 text-zinc-500 max-w-xs truncate" title={itemsSummary}>
                        {truncatedSummary || 'No products listed'}
                      </td>
                      <td className="px-6 py-4 text-zinc-700 font-semibold">
                        {getUserName(transfer.dispatched_by)}
                      </td>
                      <td className="px-6 py-4 text-zinc-700">
                        {isPending ? (
                          <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-semibold text-[10px] uppercase tracking-wider">Pending Reception</span>
                        ) : (
                          <span className="font-semibold">{getUserName(transfer.received_by)}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 font-bold text-zinc-900 font-mono">
                        UGX {transferValue.toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                          transfer.status === 'dispatched' ? "bg-blue-50 text-blue-600" :
                          transfer.status === 'fully_accepted' ? "bg-emerald-50 text-emerald-600" :
                          "bg-zinc-100 text-zinc-600"
                        )}>
                          {transfer.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-zinc-500 font-mono">
                        {new Date(transfer.dispatched_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2 text-xs font-bold">
                          <button 
                            onClick={() => handleViewTransfer(transfer)}
                            className="px-3 py-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors flex items-center gap-1 font-sans"
                          >
                            <Eye size={12} />
                            View
                          </button>
                          <button 
                            onClick={() => handleDownloadTransfer(transfer)}
                            className="px-3 py-1 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 rounded-lg transition-colors flex items-center gap-1 font-sans"
                          >
                            <Download size={12} />
                            CSV
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {displayedTransferHistory.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-zinc-400 italic">
                      No transfer history found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedTransfer && (
        <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-zinc-100 font-sans leading-normal">
            {/* Header */}
            <div className="p-6 bg-zinc-50 border-b border-zinc-100 flex justify-between items-center">
              <div>
                <span className="text-[10px] uppercase font-black tracking-widest text-emerald-600 font-mono">Stock Transfer Audit Portal</span>
                <h2 className="text-xl font-bold text-zinc-900 mt-0.5">Transfer Note #{selectedTransfer.transfer_number}</h2>
              </div>
              <button 
                onClick={() => setSelectedTransfer(null)} 
                className="text-zinc-400 hover:text-zinc-700 transition-colors p-2 hover:bg-zinc-100 rounded-full"
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Meta information layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-zinc-50 p-6 rounded-[20px] border border-zinc-200 text-xs">
                <div className="space-y-2">
                  <div>
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">Source Branch (Where it came from)</span>
                    <span className="font-bold text-zinc-800 text-sm mt-0.5 block">
                      {selectedTransfer.source_branch_name || (branches.find(b => b.id === selectedTransfer.source_branch_id)?.name || 'HQ Central Depot')}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-zinc-200">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">Sent/Dispatched By & When</span>
                    <span className="font-semibold text-zinc-700 mt-0.5 block">{getUserName(selectedTransfer.dispatched_by)}</span>
                    <span className="text-zinc-500 font-mono text-[11px] block">{new Date(selectedTransfer.dispatched_at).toLocaleString()}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">Destination Branch (Where arrived)</span>
                    <span className="font-bold text-zinc-800 text-sm mt-0.5 block">
                      {selectedTransfer.destination_branch_name || (branches.find(b => b.id === selectedTransfer.destination_branch_id)?.name || 'Destination Branch Store')}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-zinc-200">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">Received/Verified By & When</span>
                    <span className="font-semibold text-zinc-700 mt-0.5 block">
                      {selectedTransfer.received_by ? (selectedTransfer.received_by_name || getUserName(selectedTransfer.received_by)) : 'Pending Receipt Verification'}
                    </span>
                    <span className="text-zinc-500 font-mono text-[11px] block">{selectedTransfer.received_at ? new Date(selectedTransfer.received_at).toLocaleString() : 'Pending Receipt'}</span>
                  </div>
                </div>
              </div>

              {/* Items details table */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase text-zinc-400 tracking-wider font-mono font-bold">Dispatched Line Items</h4>
                <div className="border border-zinc-200 rounded-[20px] overflow-hidden bg-white shadow-sm">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-100 font-bold text-zinc-500 uppercase tracking-wider">
                        <th className="px-4 py-3">Product ID</th>
                        <th className="px-4 py-3">Product Name</th>
                        <th className="px-4 py-3 text-center">Dispatched Qty</th>
                        <th className="px-4 py-3 text-center">Received Qty</th>
                        <th className="px-4 py-3 text-right">Unit Cost Price</th>
                        <th className="px-4 py-3 text-center">Batch Number</th>
                        <th className="px-4 py-3 text-center">Expiry Date</th>
                        <th className="px-4 py-3 text-right text-zinc-800">Total Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 font-medium">
                      {((selectedTransferLines.length > 0 ? selectedTransferLines : selectedTransfer.items) || []).map((item, idx) => (
                        <tr key={idx} className="hover:bg-zinc-50/20 text-zinc-700">
                          <td className="px-4 py-3 font-mono font-bold text-zinc-900">{getProductCustomId(item.product_id)}</td>
                          <td className="px-4 py-3 font-bold text-zinc-900">{item.product_name}</td>
                          <td className="px-4 py-3 text-center font-mono text-zinc-500">{item.qty_dispatched || 0}</td>
                          <td className="px-4 py-3 text-center font-mono font-bold text-emerald-600">{item.qty_received ?? item.qty_dispatched ?? 0}</td>
                          <td className="px-4 py-3 text-right font-mono">UGX {(item.unit_cost_ugx || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-center font-mono font-semibold text-zinc-600">{item.batch_number || 'N/A'}</td>
                          <td className="px-4 py-3 text-center font-mono text-zinc-500">{item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : 'N/A'}</td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-zinc-900">
                            UGX {((item.qty_dispatched || 0) * (item.unit_cost_ugx || 0)).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedTransfer.notes && (
                <div className="p-4 bg-zinc-50 rounded-xl text-xs border border-zinc-200">
                  <span className="font-extrabold uppercase text-zinc-400 select-none block font-mono">Transfer Notes / Reason</span>
                  <p className="mt-1 text-zinc-700 italic">{selectedTransfer.notes}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 bg-zinc-50 border-t border-zinc-100 flex justify-between items-center">
              <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-widest font-mono">
                Transfer State: {selectedTransfer.status.toUpperCase()}
              </span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedTransfer(null)}
                  className="px-6 py-2 border border-zinc-200 hover:bg-zinc-100 rounded-xl font-bold text-zinc-600 text-xs uppercase tracking-wider transition-colors"
                >
                  Close View
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadTransfer(selectedTransfer, selectedTransferLines)}
                  className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider inline-flex items-center gap-2 transition-all shadow-md shadow-emerald-500/20"
                >
                  <Download size={14} />
                  Download CSV
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPreviewModal && (
        <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200 font-sans">
          <div className="bg-white rounded-[2rem] w-full max-w-3xl overflow-hidden flex flex-col shadow-2xl border border-zinc-100">
            <div className="p-6 bg-zinc-50 border-b border-zinc-100 flex justify-between items-center">
              <div>
                <span className="text-[10px] uppercase font-black tracking-widest text-emerald-600 font-mono font-bold">Please review and confirm dispatch transfer details</span>
                <h2 className="text-xl font-bold text-zinc-900 mt-0.5">Transfer Dispatch Preview</h2>
              </div>
              <button 
                onClick={() => setShowPreviewModal(false)} 
                className="text-zinc-400 hover:text-zinc-700 transition-colors p-2 hover:bg-zinc-100 rounded-full"
              >
                <Plus className="rotate-45" size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto text-zinc-800">
              <div className="grid grid-cols-2 gap-4 bg-zinc-50 p-4 rounded-2xl border border-zinc-200 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">Source Branch (Origin)</span>
                  <span className="font-bold text-zinc-800 text-sm mt-0.5 block">
                    {branches.find(b => b.id === activeBranchId)?.name || 'HQ Central Depot'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">Destination Branch</span>
                  <span className="font-bold text-zinc-800 text-sm mt-0.5 block">
                    {destinationBranch === 'HQ' ? 'HQ Central Store / Main Depot' : (branches.find(b => b.id === destinationBranch)?.name || 'Receiving Branch')}
                  </span>
                </div>
              </div>

              <div className="border border-zinc-200 rounded-[20px] overflow-hidden bg-white shadow-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-100 font-bold text-zinc-500 uppercase tracking-wider">
                      <th className="px-4 py-3">Product Name</th>
                      <th className="px-4 py-3 text-center">Batch Number</th>
                      <th className="px-4 py-3 text-center">Qty to Transfer</th>
                      <th className="px-4 py-3 text-right">Unit Cost Price</th>
                      <th className="px-4 py-3 text-right">Total Line Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 font-medium text-zinc-800">
                    {transferLines.map((line, idx) => (
                      <tr key={idx} className="hover:bg-zinc-50/10">
                        <td className="px-4 py-3 font-bold text-zinc-900">{line.product_name}</td>
                        <td className="px-4 py-3 text-center font-mono font-semibold text-zinc-600">{line.batch_number}</td>
                        <td className="px-4 py-3 text-center font-bold text-emerald-600 text-sm">{line.qty_dispatched}</td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-600">UGX {line.unit_cost_ugx?.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-zinc-900">
                          UGX {((line.qty_dispatched || 0) * (line.unit_cost_ugx || 0)).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-zinc-50/50 font-bold border-t border-zinc-200">
                      <td colSpan={4} className="px-4 py-3 text-right text-zinc-500 uppercase text-[10px] tracking-wider">Grand Total Transfer Value</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-zinc-955 font-black">
                        UGX {transferLines.reduce((sum, l) => sum + (l.line_total_ugx || 0), 0).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="p-6 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="px-6 py-2 border border-zinc-200 hover:bg-zinc-100 rounded-xl font-bold text-zinc-700 text-xs uppercase tracking-wider transition-colors"
                disabled={isDispatching}
              >
                Go Back / Edit
              </button>
              <button
                type="button"
                onClick={executeTransfer}
                disabled={isDispatching}
                className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider inline-flex items-center gap-2 transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50"
              >
                {isDispatching ? 'Dispatching...' : 'Confirm & Dispatch Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ProcurementDashboard: React.FC<{ branches: Branch[] }> = ({ branches }) => {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<StockOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<StockOrder | null>(null);
  const [orderLines, setOrderLines] = useState<StockOrderLine[]>([]);
  const [procurementView, setProcurementView] = useState<'orders' | 'lpos' | 'grns'>('orders');
  const [fulfillingOrder, setFulfillingOrder] = useState<StockOrder | null>(null);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<StockOrder>('stock_orders', profile.tenantId, (data) => {
        setOrders(data.filter(o => o.status !== 'draft').sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || '')));
      });
    }
  }, [profile?.tenantId]);

  const handleViewOrder = async (order: StockOrder) => {
    setSelectedOrder(order);
    const lines = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [
      { field: 'order_id', operator: '==', value: order.id }
    ]);
    setOrderLines(lines);
  };

  const updateOrderStatus = async (orderId: string, newStatus: StockOrder['status']) => {
    try {
      await firestoreService.updateDocument('stock_orders', orderId, { 
        status: newStatus,
        updatedAt: new Date().toISOString()
      });
      toast.success(`Order status updated to ${newStatus.replace(/_/g, ' ')}`);
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(prev => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (error) {
      toast.error("Failed to update status.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-4 border-b border-zinc-100 pb-4">
        <button 
          onClick={() => setProcurementView('orders')}
          className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all", procurementView === 'orders' ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100")}
        >
          Branch Orders
        </button>
        <button 
          onClick={() => setProcurementView('lpos')}
          className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all", procurementView === 'lpos' ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100")}
        >
          Local Purchase Orders (LPOs)
        </button>
        <button 
          onClick={() => setProcurementView('grns')}
          className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all", procurementView === 'grns' ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100")}
        >
          Goods Received Notes (GRNs)
        </button>
      </div>

      {procurementView === 'orders' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                    <th className="px-6 py-4">Order #</th>
                    <th className="px-6 py-4">Branch</th>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {orders.map(order => (
                    <tr key={order.id} className={cn("hover:bg-zinc-50/50 transition-colors cursor-pointer", selectedOrder?.id === order.id && "bg-emerald-50/50")} onClick={() => handleViewOrder(order)}>
                      <td className="px-6 py-4 font-bold text-zinc-900">
                        {order.order_number}
                        {order.is_emergency && <span className="ml-2 text-[8px] bg-red-500 text-white px-1 rounded">URGENT</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-600">
                        {branches.find(b => b.id === order.requesting_branch_id)?.name || 'Unknown'}
                      </td>
                      <td className="px-6 py-4 text-sm capitalize text-zinc-500">{order.order_type}</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-bold uppercase tracking-wider">
                          {order.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="text-emerald-500 hover:underline text-xs font-bold">Review</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-6">
            {selectedOrder ? (
              <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-6 sticky top-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-zinc-900">Order Details</h3>
                    <p className="text-xs text-zinc-500">{selectedOrder.order_number}</p>
                  </div>
                  <button onClick={() => setSelectedOrder(null)} className="text-zinc-400 hover:text-zinc-600">
                    <Plus className="rotate-45" size={20} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="p-3 bg-zinc-50 rounded-xl space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Status:</span>
                      <span className="font-bold text-zinc-900 uppercase">{selectedOrder.status.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Value:</span>
                      <span className="font-bold text-emerald-600">UGX {selectedOrder.total_order_value_ugx.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Order Items</p>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                      {orderLines.map(line => (
                        <div key={line.id} className="p-2 border border-zinc-100 rounded-lg text-xs flex justify-between items-center">
                          <div>
                            <p className="font-bold text-zinc-800">{line.product_name}</p>
                            <p className="text-zinc-500">Qty: {line.qty_ordered}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium text-zinc-900">UGX {(line.line_total_ugx || 0).toLocaleString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 space-y-2">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Actions</p>
                    {selectedOrder.status === 'submitted' && (
                      <button 
                        onClick={() => updateOrderStatus(selectedOrder.id, 'in_triage')}
                        className="w-full py-2 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-colors"
                      >
                        Start Triage
                      </button>
                    )}
                    {selectedOrder.status === 'in_triage' && (
                      <div className="grid grid-cols-2 gap-2">
                        <button 
                          onClick={() => updateOrderStatus(selectedOrder.id, 'approved')}
                          className="py-2 bg-emerald-500 text-white rounded-xl text-sm font-bold hover:bg-emerald-600 transition-colors"
                        >
                          Approve
                        </button>
                        <button 
                          onClick={() => updateOrderStatus(selectedOrder.id, 'sourcing')}
                          className="py-2 bg-orange-500 text-white rounded-xl text-sm font-bold hover:bg-orange-600 transition-colors"
                        >
                          Sourcing
                        </button>
                      </div>
                    )}
                    {selectedOrder.status === 'approved' && (
                      <button 
                        onClick={() => setFulfillingOrder(selectedOrder)}
                        className="w-full py-2 bg-blue-500 text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-colors"
                      >
                        Generate Transfer Invoice
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl p-12 text-center">
                <Package className="mx-auto text-zinc-300 mb-4" size={48} />
                <p className="text-sm text-zinc-500 italic">Select an order to view details and take action.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {fulfillingOrder && (
        <FulfillmentModal 
          order={fulfillingOrder} 
          onClose={() => setFulfillingOrder(null)} 
          onSuccess={() => {
            setFulfillingOrder(null);
            updateOrderStatus(fulfillingOrder.id, 'dispatched');
          }}
        />
      )}

      {procurementView === 'lpos' && (
        <div className="bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl p-24 text-center">
          <FileText className="mx-auto text-zinc-300 mb-4" size={48} />
          <h3 className="text-lg font-bold text-zinc-900">LPO Management</h3>
          <p className="text-sm text-zinc-500 max-w-md mx-auto mt-2">
            Consolidate approved orders and generate Local Purchase Orders for suppliers. (Coming soon)
          </p>
        </div>
      )}

      {procurementView === 'grns' && (
        <div className="bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl p-24 text-center">
          <Truck className="mx-auto text-zinc-300 mb-4" size={48} />
          <h3 className="text-lg font-bold text-zinc-900">GRN Management</h3>
          <p className="text-sm text-zinc-500 max-w-md mx-auto mt-2">
            Receive products from suppliers at the Procurement Store and verify against LPOs. (Coming soon)
          </p>
        </div>
      )}
    </div>
  );
};

export default StockInOut;

const FulfillmentModal: React.FC<{ order: StockOrder; onClose: () => void; onSuccess: () => void }> = ({ order, onClose, onSuccess }) => {
  const { profile } = useAuth();
  const [orderLines, setOrderLines] = useState<StockOrderLine[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [fulfillmentData, setFulfillmentData] = useState<Record<string, { batchId: string; qty: number }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const lines = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [
        { field: 'order_id', operator: '==', value: order.id }
      ]);
      setOrderLines(lines);
      
      const allBatches = await firestoreService.getCollection<ProductBatch>('product_batches', profile?.tenantId!);
      // Filter for HQ batches with stock
      setBatches(allBatches.filter(b => b.branchId === 'HQ' && b.quantity > 0));

      // Fetch products to get unitsPerPack
      const productIds = Array.from(new Set(lines.map(l => l.product_id)));
      const productPromises = productIds.map(id => firestoreService.getDocument<Product>('products', id));
      const productResults = await Promise.all(productPromises);
      const pMap: Record<string, Product> = {};
      productResults.forEach(p => { if (p) pMap[p.id] = p; });
      setProducts(pMap);
      
      const initialFulfillment: Record<string, any> = {};
      lines.forEach(l => {
        initialFulfillment[l.id] = { batchId: '', qty: l.qty_ordered };
      });
      setFulfillmentData(initialFulfillment);
      setLoading(false);
    };
    fetchData();
  }, [order.id, profile?.tenantId]);

  const handleFulfill = async () => {
    if (!profile?.tenantId || !profile?.uid) {
      toast.error("User profile not loaded. Please log in again.");
      return;
    }

    if (!order.requesting_branch_id) {
      toast.error("Order is missing requesting branch ID.");
      return;
    }

    // Validate all lines have a batch selected
    const incomplete = orderLines.some(l => !fulfillmentData[l.id].batchId);
    if (incomplete) {
      toast.error("Please select a batch for all items.");
      return;
    }

    try {
      // Pre-fetch HQ branch batch references for all products in transfer
      const uniqueProductIds = Array.from(new Set<string>(orderLines.map(line => String(line.product_id))));
      const branchBatchRefsMap: Record<string, { ref: any; id: string }[]> = {};
      for (const pId of uniqueProductIds) {
        branchBatchRefsMap[pId] = await getBranchProductBatchRefs(
          profile.tenantId,
          'HQ',
          pId
        );
      }

      await firestoreService.runTransaction(async (transaction) => {
        const transferData: any = {
          tenantId: profile.tenantId,
          inventoryClass: 'SELLABLE',
          transfer_number: `TRF-FUL-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`,
          order_id: order.id,
          source_branch_id: 'HQ',
          destination_branch_id: order.requesting_branch_id,
          transfer_type: 'store_fulfillment',
          status: 'dispatched',
          dispatched_by: profile.uid,
          dispatched_at: new Date().toISOString()
        };

        const transferRef = doc(collection(db, 'transfer_invoices'));
        transaction.set(transferRef, { ...transferData, createdAt: new Date().toISOString() });

        for (const line of orderLines) {
          const fData = fulfillmentData[line.id];
          const batch = batches.find(b => b.id === fData.batchId);
          if (!batch) throw new Error(`Batch not found for ${line.product_name}`);

          const product = products[line.product_id];
          const unitsPerPack = product?.unitsPerPack || 1;
          const totalUnitsToDeduct = fData.qty * unitsPerPack;

          const lineRef = doc(collection(db, 'transfer_invoice_lines'));
          const packCost = batch.purchasePrice * unitsPerPack;
          
          transaction.set(lineRef, {
            tenantId: profile.tenantId,
            inventoryClass: 'SELLABLE',
            transfer_id: transferRef.id,
            product_id: line.product_id,
            product_name: line.product_name,
            batch_number: batch.batchNumber,
            expiry_date: batch.expiryDate,
            qty_dispatched: fData.qty, // This is in packs
            unit_cost_ugx: packCost,
            line_total_ugx: fData.qty * packCost,
            createdAt: new Date().toISOString()
          });

          // Decrement HQ batch
          const batchRef = doc(db, 'product_batches', batch.id);
          const newQty = batch.quantity - totalUnitsToDeduct;
          if (newQty < 0) throw new Error(`Insufficient stock in batch ${batch.batchNumber} for ${line.product_name}`);
          
          transaction.update(batchRef, {
            quantity: newQty,
            lastUpdated: new Date().toISOString()
          });

          // Log TRANSFER_OUT movement event & update summaries for HQ
          const batchRefs = branchBatchRefsMap[line.product_id] || [];
          await logMovementAndAggregateInTx(transaction, batchRefs, {
            tenantId: profile.tenantId,
            branchId: 'HQ',
            productId: line.product_id,
            eventType: 'TRANSFER_OUT',
            quantityDeltaBaseUnits: -totalUnitsToDeduct,
            consumptionDeltaBaseUnits: 0,
            isExceptional: false,
            exceptionalReason: null,
            sourceCollection: 'transfer_invoices',
            sourceDocumentId: transferRef.id,
            sourceLineId: fData.batchId,
            reversalOfEventId: null,
            createdBy: profile.uid || 'system',
            effectiveAt: new Date(),
            timezone: 'Africa/Kampala'
          });
        }
      });

      toast.success("Transfer invoice generated and HQ inventory updated.");
      onSuccess();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Fulfillment failed.");
    }
  };

  if (loading) return null;

  return (
    <div className="fixed inset-0 bg-zinc-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Fulfill Branch Order</h2>
            <p className="text-sm text-zinc-500">Order: {order.order_number}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100">
                <th className="pb-4">Product</th>
                <th className="pb-4">Requested</th>
                <th className="pb-4">Select Batch (HQ)</th>
                <th className="pb-4">Qty to Send</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {orderLines.map(line => {
                const productBatches = batches.filter(b => b.productId === line.product_id);
                return (
                  <tr key={line.id} className="text-sm">
                    <td className="py-4">
                      <p className="font-bold text-zinc-900">{line.product_name}</p>
                    </td>
                    <td className="py-4 font-bold text-zinc-900">{line.qty_ordered}</td>
                    <td className="py-4">
                      <select 
                        value={fulfillmentData[line.id]?.batchId || ''}
                        onChange={(e) => setFulfillmentData(prev => ({
                          ...prev,
                          [line.id]: { ...prev[line.id], batchId: e.target.value }
                        }))}
                        className="w-full px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-emerald-500/20"
                      >
                        <option value="">Select Batch...</option>
                        {productBatches.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.batchNumber} (Exp: {new Date(b.expiryDate).toLocaleDateString()}) - {b.quantity} avail
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-4">
                      <input 
                        type="number" 
                        value={fulfillmentData[line.id]?.qty ?? ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          setFulfillmentData(prev => ({
                            ...prev,
                            [line.id]: { ...prev[line.id], qty: val }
                          }));
                        }}
                        className="w-24 px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="p-6 border-t border-zinc-100 bg-zinc-50/50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-6 py-2 border border-zinc-200 rounded-xl font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleFulfill}
            className="px-8 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold transition-colors shadow-lg shadow-blue-500/20"
          >
            Dispatch Fulfillment
          </button>
        </div>
      </div>
    </div>
  );
};

export const StockInOutReportsHub: React.FC<{ branches: Branch[] }> = ({ branches }) => {
  const { profile, activeBranchId } = useAuth();
  const [transferInvoices, setTransferInvoices] = useState<TransferInvoice[]>([]);
  const [stockQueries, setStockQueries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<'reception' | 'transfer' | 'queries'>('reception');
  const [staff, setStaff] = useState<any[]>([]);

  // Date filters defaulting to current month
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Subscriptions
  useEffect(() => {
    if (profile?.tenantId) {
      setLoading(true);
      const unsubTransfers = firestoreService.subscribeToCollection<TransferInvoice>(
        'transfer_invoices',
        profile.tenantId,
        (data) => {
          setTransferInvoices(data);
        }
      );
      const unsubQueries = firestoreService.subscribeToCollection<any>(
        'stock_queries',
        profile.tenantId,
        (data) => {
          setStockQueries(data);
          setLoading(false);
        }
      );
      const unsubStaff = firestoreService.subscribeToCollection<any>(
        'staff',
        profile.tenantId,
        setStaff
      );

      return () => {
        unsubTransfers();
        unsubQueries();
        unsubStaff();
      };
    }
  }, [profile?.tenantId]);

  const getUserName = (uid?: string) => {
    if (!uid) return 'N/A';
    const found = staff.find(s => s.uid === uid || s.id === uid);
    return found ? (found.full_name || found.displayName || found.username || found.email) : uid;
  };

  // Helper to resolve Branch name from ID (replaces vague IDs with actual branch name)
  const getBranchName = (id: string) => {
    const br = branches.find(b => b.id === id);
    return br ? br.name : id || 'Unknown Branch';
  };

  const parseItemDate = (dateVal: any) => {
    if (!dateVal) return new Date();
    if (dateVal.seconds) return new Date(dateVal.seconds * 1000);
    return new Date(dateVal);
  };

  // 1. Filtered Receptions (transfers received in active branch)
  const filteredReceptions = useMemo(() => {
    return transferInvoices.filter(ti => {
      if (activeBranchId && ti.destination_branch_id !== activeBranchId) return false;
      const rDate = parseItemDate(ti.received_at || ti.dispatched_at);
      const start = new Date(fromDate);
      start.setHours(0,0,0,0);
      const end = new Date(toDate);
      end.setHours(23,59,59,999);
      return rDate >= start && rDate <= end && (ti.status === 'received' || ti.status === 'fully_accepted' || ti.status === 'queried');
    });
  }, [transferInvoices, activeBranchId, fromDate, toDate]);

  // 2. Filtered Transfers (transfers sent from active branch)
  const filteredTransfers = useMemo(() => {
    return transferInvoices.filter(ti => {
      if (activeBranchId && ti.source_branch_id !== activeBranchId) return false;
      const dDate = parseItemDate(ti.dispatched_at);
      const start = new Date(fromDate);
      start.setHours(0,0,0,0);
      const end = new Date(toDate);
      end.setHours(23,59,59,999);
      return dDate >= start && dDate <= end;
    });
  }, [transferInvoices, activeBranchId, fromDate, toDate]);

  // 3. Filtered Queries (audit log within filtered period)
  const filteredQueries = useMemo(() => {
    return stockQueries.filter(q => {
      // Branch check: either source or destination is active branch
      if (activeBranchId && q.sourceBranchId !== activeBranchId && q.destinationBranchId !== activeBranchId) return false;
      const qDate = parseItemDate(q.timestamp);
      const start = new Date(fromDate);
      start.setHours(0,0,0,0);
      const end = new Date(toDate);
      end.setHours(23,59,59,999);
      return qDate >= start && qDate <= end;
    });
  }, [stockQueries, activeBranchId, fromDate, toDate]);

  // Calculations for individual Transfer/GRN row
  const getInvoiceAmounts = (ti: TransferInvoice) => {
    let receivedAmount = 0;
    let queriedAmount = 0;
    
    (ti.items || []).forEach(line => {
      const unitCost = line.unit_cost_ugx || 0;
      receivedAmount += (line.qty_received ?? line.qty_dispatched) * unitCost;
      queriedAmount += (line.qty_queried ?? 0) * unitCost;
    });

    return {
      total: ti.total_value_ugx || receivedAmount,
      received: receivedAmount,
      queried: queriedAmount
    };
  };

  const handleExportCSV = async () => {
    let headers: string[] = [];
    let rows: any[][] = [];
    let filename = `stock_${activeSubTab}_report.csv`;

    if (activeSubTab === 'reception') {
      filename = `reception_history_report.csv`;
      headers = [
        'GRN Invoice ID', 
        'Source Branch', 
        'Sender (Dispatched By)', 
        'Receiver (Received By)', 
        'Total Qty from Invoice', 
        'Total Qty Received', 
        'Total Qty Queried', 
        'Total Value (UGX)', 
        'Received Value (UGX)', 
        'Queried Value (UGX)', 
        'Receipt Date', 
        'Status'
      ];
      
      for (const ti of filteredReceptions) {
        let lines = ti.items || [];
        if (lines.length === 0) {
          try {
            lines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [
              { field: 'tenantId', operator: '==', value: profile?.tenantId || '' },
              { field: 'transfer_id', operator: '==', value: ti.id }
            ]);
          } catch (e) {
            console.error("Error fetching lines for reception:", e);
          }
        }

        let totalQtyInvoice = 0;
        let totalQtyReceived = 0;
        let totalQtyQueried = 0;
        let receivedAmount = 0;
        let queriedAmount = 0;

        lines.forEach(line => {
          const unitCost = line.unit_cost_ugx || 0;
          const dispatched = line.qty_dispatched || 0;
          const received = line.qty_received ?? line.qty_dispatched ?? 0;
          const queried = line.qty_queried || Math.max(0, dispatched - received);

          totalQtyInvoice += dispatched;
          totalQtyReceived += received;
          totalQtyQueried += queried;

          receivedAmount += received * unitCost;
          queriedAmount += queried * unitCost;
        });

        rows.push([
          ti.transfer_number,
          getBranchName(ti.source_branch_id),
          getUserName(ti.dispatched_by),
          ti.received_by ? getUserName(ti.received_by) : 'Pending',
          totalQtyInvoice,
          totalQtyReceived,
          totalQtyQueried,
          ti.total_value_ugx || (receivedAmount + queriedAmount),
          receivedAmount,
          queriedAmount,
          ti.received_at ? format(parseItemDate(ti.received_at), 'yyyy-MM-dd') : '-',
          ti.status
        ]);
      }
    } else if (activeSubTab === 'transfer') {
      filename = `transfer_history_report.csv`;
      headers = [
        'GRN Invoice ID', 
        'Destination Branch', 
        'Sender (Dispatched By)', 
        'Receiver (Received By)', 
        'Total Qty from Invoice', 
        'Total Qty Received', 
        'Total Qty Queried', 
        'Total Value (UGX)', 
        'Received Value (UGX)', 
        'Queried Value (UGX)', 
        'Dispatch Date', 
        'Status'
      ];

      for (const ti of filteredTransfers) {
        let lines = ti.items || [];
        if (lines.length === 0) {
          try {
            lines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [
              { field: 'tenantId', operator: '==', value: profile?.tenantId || '' },
              { field: 'transfer_id', operator: '==', value: ti.id }
            ]);
          } catch (e) {
            console.error("Error fetching lines for transfer:", e);
          }
        }

        let totalQtyInvoice = 0;
        let totalQtyReceived = 0;
        let totalQtyQueried = 0;
        let receivedAmount = 0;
        let queriedAmount = 0;

        lines.forEach(line => {
          const unitCost = line.unit_cost_ugx || 0;
          const dispatched = line.qty_dispatched || 0;
          const received = line.qty_received ?? line.qty_dispatched ?? 0;
          const queried = line.qty_queried || Math.max(0, dispatched - received);

          totalQtyInvoice += dispatched;
          totalQtyReceived += received;
          totalQtyQueried += queried;

          receivedAmount += received * unitCost;
          queriedAmount += queried * unitCost;
        });

        rows.push([
          ti.transfer_number,
          getBranchName(ti.destination_branch_id),
          getUserName(ti.dispatched_by),
          ti.received_by ? getUserName(ti.received_by) : 'Pending',
          totalQtyInvoice,
          totalQtyReceived,
          totalQtyQueried,
          ti.total_value_ugx || (receivedAmount + queriedAmount),
          receivedAmount,
          queriedAmount,
          ti.dispatched_at ? format(parseItemDate(ti.dispatched_at), 'yyyy-MM-dd') : '-',
          ti.status
        ]);
      }
    } else if (activeSubTab === 'queries') {
      filename = `query_followup_and_audit_log.csv`;
      headers = ['Invoice Number', 'Product Queried', 'Batch Number', 'Qty Queried', 'Unit Cost (UGX)', 'Amount Accrued (UGX)', 'Reason', 'Source Branch', 'Destination Branch', 'Status', 'Date Logged'];
      filteredQueries.forEach(q => {
        rows.push([
          q.invoiceNumber || '-',
          q.productName || 'Unknown Product',
          q.batchNumber || '-',
          q.qtyQueried || 0,
          q.unitCost || 0,
          q.amountAccrued || 0,
          q.reason || 'No description',
          getBranchName(q.sourceBranchId),
          getBranchName(q.destinationBranchId),
          q.status || 'pending',
          q.timestamp ? format(parseItemDate(q.timestamp), 'yyyy-MM-dd') : '-'
        ]);
      });
    }

    const BOM = "\uFEFF";
    const csvContent = BOM + [headers.join(','), ...rows.map(e => e.map(val => `"${(val ?? '').toString().replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`${filename} exported successfully`);
  };

  return (
    <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden min-h-[500px]">
      {/* Tab controls */}
      <div className="px-8 py-6 border-b border-zinc-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">Stock Reports Statement Hub</h2>
          <div className="flex gap-1.5 bg-zinc-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveSubTab('reception')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                activeSubTab === 'reception' ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-950"
              )}
            >
              Reception History
            </button>
            <button
              onClick={() => setActiveSubTab('transfer')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                activeSubTab === 'transfer' ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-950"
              )}
            >
              Transfer History
            </button>
            <button
              onClick={() => setActiveSubTab('queries')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                activeSubTab === 'queries' ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-950"
              )}
            >
              Query follow-up
            </button>
          </div>
        </div>

        {/* Date Filters & Download */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">From</span>
            <input 
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">To</span>
            <input 
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-md shadow-emerald-100"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      <div className="p-8">
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
          </div>
        ) : activeSubTab === 'reception' ? (
          /* Reception History table */
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">GRN Invoice ID</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Source Branch</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Sender</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Receiver</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Total Invoice</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Received Amount</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Queried Amount</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Date Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredReceptions.map(ti => {
                const amt = getInvoiceAmounts(ti);
                return (
                  <tr key={ti.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4 text-xs font-black text-zinc-900">{ti.transfer_number}</td>
                    <td className="px-6 py-4 text-xs font-bold text-zinc-700">{getBranchName(ti.source_branch_id)}</td>
                    <td className="px-6 py-4 text-xs text-zinc-500">{ti.dispatched_by}</td>
                    <td className="px-6 py-4 text-xs text-zinc-500">{ti.received_by || 'N/A'}</td>
                    <td className="px-6 py-4 text-xs font-bold text-right text-zinc-800">{amt.total.toLocaleString()}</td>
                    <td className="px-6 py-4 text-xs font-bold text-right text-emerald-600">{amt.received.toLocaleString()}</td>
                    <td className="px-6 py-4 text-xs font-black text-right text-red-600">{amt.queried.toLocaleString()}</td>
                    <td className="px-6 py-4 text-xs text-zinc-500">
                      {ti.received_at ? format(parseItemDate(ti.received_at), 'MMM dd, yyyy') : '-'}
                    </td>
                  </tr>
                );
              })}
              {filteredReceptions.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-zinc-400 italic">
                    No reception records found within this date filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : activeSubTab === 'transfer' ? (
          /* Transfer History table */
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">GRN Invoice ID</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Destination</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Sender</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Receiver</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Total Invoice</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Received Amount</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Queried Amount</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Date Dispatched</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredTransfers.map(ti => {
                const amt = getInvoiceAmounts(ti);
                return (
                  <tr key={ti.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4 text-xs font-black text-zinc-900">{ti.transfer_number}</td>
                    <td className="px-6 py-4 text-xs font-bold text-zinc-700">{getBranchName(ti.destination_branch_id)}</td>
                    <td className="px-6 py-4 text-xs text-zinc-500">{ti.dispatched_by}</td>
                    <td className="px-6 py-4 text-xs text-zinc-500">{ti.received_by || 'Pending'}</td>
                    <td className="px-6 py-4 text-xs font-bold text-right text-zinc-800">{amt.total.toLocaleString()}</td>
                    <td className="px-6 py-4 text-xs font-bold text-right text-emerald-600">{amt.received.toLocaleString()}</td>
                    <td className="px-6 py-4 text-xs font-black text-right text-red-600">{amt.queried.toLocaleString()}</td>
                    <td className="px-6 py-4 text-xs text-zinc-500">
                      {ti.dispatched_at ? format(parseItemDate(ti.dispatched_at), 'MMM dd, yyyy') : '-'}
                    </td>
                  </tr>
                );
              })}
              {filteredTransfers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-zinc-400 italic">
                    No transfer out records found within this date filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          /* Query follow-up table */
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Invoice Number</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Product Queried</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Qty</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Unit Cost</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Queried Value</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Reason</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Audited Status</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Date Logged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredQueries.map(q => (
                <tr key={q.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4 text-xs font-black text-zinc-900">{q.invoiceNumber || '-'}</td>
                  <td className="px-6 py-4 font-bold text-zinc-800">{q.productName}</td>
                  <td className="px-6 py-4 text-xs font-bold text-right text-zinc-700">{q.qtyQueried}</td>
                  <td className="px-6 py-4 text-xs text-right text-zinc-500">{(q.unitCost || 0).toLocaleString()}</td>
                  <td className="px-6 py-4 text-xs font-black text-right text-red-600">{(q.amountAccrued || 0).toLocaleString()} UGX</td>
                  <td className="px-6 py-4 text-xs text-zinc-500">{q.reason}</td>
                  <td className="px-6 py-4 text-xs">
                    <span className={cn(
                      "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest",
                      q.status === 'returned_to_hq' ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                    )}>
                      {q.status || 'pending'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-zinc-500">
                    {q.timestamp ? format(parseItemDate(q.timestamp), 'MMM dd, yyyy') : '-'}
                  </td>
                </tr>
              ))}
              {filteredQueries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-zinc-400 italic">
                    No queried items or logs found in this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
