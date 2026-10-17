import React, { useState, useEffect } from 'react';
import { 
  Plus, Search, Filter, CheckCircle2, AlertCircle, Clock, Package, Truck, FileText,
  ChevronRight, AlertTriangle, Users, Building2, DollarSign, ShoppingCart,
  MoreVertical, Edit2, Trash2, ExternalLink, Eye, Download, FileSpreadsheet,
  File as FileIcon, Check, X, ArrowRight, ArrowLeft, ArrowRightLeft
} from 'lucide-react';
import { where, doc, collection, getDocs, query, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { firestoreService } from '../services/firestore';
import { 
  Product, StockOrder, StockOrderLine, OperationalInventory, OperationalTransfer, InstitutionRegistry, GRNRecord,
  GRNLine, UnsuppliedLine, ProductBatch, CreditLedgerEntry, TransferInvoice,
  TransferInvoiceLine, Branch, AuditLog
} from '../types';
import { toast } from 'sonner';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { processProcurementGrn } from '../services/procurementFinanceService';
import { dispatchPreparedSellableGrn } from '../services/grnDispatchService';
import { grnReceivedDateKey } from '../utils/grnDates';
import { processOperationalGrn } from '../services/operationalGrnService';
import { confirmProcurementApproval } from '../services/procurementApprovalService';
import type { ApprovalAddition, ApprovalQuantityEdit } from '../services/procurementApprovalPolicy';
import { dispatchOperationalOrderToBranch, dispatchPreparedOperationalHqTransfer, fulfillOperationalOrderFromHqStore } from '../services/operationalTransferService';
import { AutoGenerateOrderModal } from '../components/inventory/AutoGenerateOrderModal';
import { isBranchReturnToHq, isHqProcurementDelivery, receiveHqTransfer } from '../services/hqStockReceiptService';
import { isOperationalInventoryRecord } from '../services/inventoryClassification';
import { useOperationalInventoryFeature } from '../hooks/useOperationalInventoryFeature';
import OperationalHQStoreTab from '../components/procurement/OperationalHQStoreTab';
import { SupplierEditor } from '../components/procurement/SupplierEditor';
import { supplierEligibleForStream } from '../services/supplierRegistryPolicy';
import { procurementRequestingBranchLabel } from '../services/procurementBranchDisplay';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

async function fetchOperationalGrnLines(tenantId: string, grnId: string): Promise<GRNLine[]> {
  const linesQuery = query(
    collection(db, 'operational_grn_lines'),
    where('tenantId', '==', tenantId),
    where('grnId', '==', grnId)
  );
  const snapshot = await getDocs(linesQuery);
  return snapshot.docs.map(lineDoc => {
    const line = lineDoc.data();
    return {
      inventoryClass: 'OPERATIONAL',
      operationalType: line.operationalType,
      masterItemId: line.masterItemId,
      product_id: line.itemId,
      product_name: line.itemName,
      qty_ordered: line.qtyOrdered,
      qty_received: line.qtyReceived,
      qty_received_units: line.qtyReceivedUnits,
      unit_cost_ugx: line.unitCostUGX,
      total_cost_ugx: line.totalValueUGX,
      status: 'received'
    } as GRNLine;
  });
}

const Procurement: React.FC = () => {
  const { profile } = useAuth();
  const operationalInventoryEnabled = useOperationalInventoryFeature();
  const [activeMode, setActiveMode] = useState<'hq_store' | 'procurement'>('hq_store');
  const [activeTab, setActiveTab] = useState<'hq_inventory' | 'hq_stock_io' | 'operational_hq_inventory' | 'requisitions' | 'sourcing' | 'finance' | 'grn' | 'dispatch' | 'unsupplied' | 'deferred' | 'suppliers' | 'queries'>('hq_inventory');

  const hqTabs = [
    { id: 'hq_inventory', label: 'HQ Store Inventory', icon: Package },
    { id: 'hq_stock_io', label: 'HQ Stock In/Out', icon: ArrowLeft },
    ...(operationalInventoryEnabled ? [{ id: 'operational_hq_inventory', label: 'Operational HQ Store', icon: Package }] : []),
  ];

  const procurementTabs = [
    { id: 'requisitions', label: 'New Requisitions', icon: ShoppingCart },
    { id: 'sourcing', label: 'Sourcing & Quotation', icon: FileText },
    { id: 'finance', label: 'Financial Approval', icon: DollarSign },
    { id: 'grn', label: 'Central GRN (Receipt)', icon: Truck },
    { id: 'dispatch', label: 'Active Dispatches', icon: Package },
    { id: 'queries', label: 'Query Handling', icon: AlertCircle },
    { id: 'unsupplied', label: 'Unsupplied Logs', icon: AlertTriangle },
    { id: 'deferred', label: 'Deferred Logs', icon: Clock },
    { id: 'suppliers', label: 'Supplier Registry', icon: Users },
  ];

  const currentTabs = activeMode === 'hq_store' ? hqTabs : procurementTabs;

  useEffect(() => {
    if (!operationalInventoryEnabled && activeTab === 'operational_hq_inventory') {
      setActiveTab('hq_inventory');
    }
  }, [operationalInventoryEnabled, activeTab]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Procurement & Sourcing</h1>
          <p className="text-zinc-500">Manage central procurement, HQ Store inventory, supplier relations, and branch order fulfillment.</p>
        </div>

        {/* High-Level Scope Switcher */}
        <div className="flex bg-zinc-100 p-1.5 rounded-2xl w-fit border border-zinc-200 shrink-0">
          <button
            onClick={() => {
              setActiveMode('hq_store');
              setActiveTab('hq_inventory');
            }}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all duration-200",
              activeMode === 'hq_store'
                ? "bg-zinc-900 text-white shadow-md shadow-zinc-900/10"
                : "text-zinc-500 hover:text-zinc-800"
            )}
          >
            <Building2 size={15} />
            HQ Store Management
          </button>
          <button
            onClick={() => {
              setActiveMode('procurement');
              setActiveTab('requisitions');
            }}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all duration-200",
              activeMode === 'procurement'
                ? "bg-zinc-900 text-white shadow-md shadow-zinc-900/10"
                : "text-zinc-500 hover:text-zinc-800"
            )}
          >
            <ShoppingCart size={15} />
            Procurement & Sourcing
          </button>
        </div>
      </div>

      <div className="flex flex-nowrap border-b border-zinc-200 overflow-x-auto pb-2">
        {currentTabs.map((tab) => (
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
        {activeTab === 'hq_inventory' && <HQStoreInventoryTab />}
        {activeTab === 'hq_stock_io' && <HQStockInOutTab />}
        {activeTab === 'operational_hq_inventory' && operationalInventoryEnabled && <OperationalHQStoreTab />}
        {activeTab === 'requisitions' && <NewRequisitions />}
        {activeTab === 'sourcing' && <SourcingTab />}
        {activeTab === 'finance' && <FinancialApprovalTab />}
        {activeTab === 'grn' && <GRNTab />}
        {activeTab === 'dispatch' && <DispatchTab />}
        {activeTab === 'queries' && <QueriesTab />}
        {activeTab === 'unsupplied' && <UnsuppliedTab />}
        {activeTab === 'deferred' && <DeferredTab />}
        {activeTab === 'suppliers' && <SupplierRegistryTab />}
      </div>
    </div>
  );
};

const NewRequisitions: React.FC = () => {
  const { profile } = useAuth();
  const operationalInventoryEnabled = useOperationalInventoryFeature();
  const [orders, setOrders] = useState<StockOrder[]>([]);
  const [branchNames, setBranchNames] = useState<Record<string, string>>({});
  const [selectedOrder, setSelectedOrder] = useState<StockOrder | null>(null);
  useEffect(() => {
    if (!profile?.tenantId) return;
    return firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, records => {
      setBranchNames(Object.fromEntries(records.map(branch => [branch.id, branch.name])));
    });
  }, [profile?.tenantId]);
  const displayBranch = (order: StockOrder): string =>
    procurementRequestingBranchLabel(order, branchNames);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<StockOrder>('stock_orders', profile.tenantId, (data) => {
        setOrders(data.filter(o => o.status === 'submitted' && (operationalInventoryEnabled || !isOperationalInventoryRecord(o))));
      });
    }
  }, [profile?.tenantId, operationalInventoryEnabled]);

  useEffect(() => {
    if (!operationalInventoryEnabled && selectedOrder && isOperationalInventoryRecord(selectedOrder)) {
      setSelectedOrder(null);
      setIsDetailModalOpen(false);
    }
  }, [operationalInventoryEnabled, selectedOrder]);

  const handleDownload = async (order: StockOrder, format: 'pdf' | 'xls') => {
    toast.info(`Generating ${format.toUpperCase()} for order ${order.order_number}...`);
    try {
      const lines = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: order.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
      
      if (format === 'xls') {
        let content = '';
        if (lines.length === 0) {
          content = '"No items found in this order."';
        } else {
          const headers = [
            'Order Number', 
            'Requesting Branch', 
            'Order Type', 
            'Category', 
            'Date Submitted', 
            'Item Name', 
            'Quantity Ordered', 
            'Unit Cost (UGX)', 
            'Line Total (UGX)', 
            'Notes'
          ];
          const rows = lines.map(line => [
            order.order_number || '',
            displayBranch(order),
            order.order_type || '',
            isOperationalInventoryRecord(order) ? 'Operational Inventory' : 'Sellable Inventory',
            order.submitted_at ? new Date(order.submitted_at).toLocaleDateString() : '--',
            line.product_name || line.product_id || '',
            (line.qty_ordered || 0).toString(),
            (line.unit_cost_ugx || 0).toString(),
            (line.line_total_ugx || 0).toString(),
            line.notes || ''
          ]);
          
          const escapeCSV = (val: string) => {
            const clean = val.replace(/"/g, '""');
            return `"${clean}"`;
          };

          const csvHeader = headers.map(escapeCSV).join(',');
          const csvRows = rows.map(r => r.map(escapeCSV).join(',')).join('\n');
          content = '\uFEFF' + csvHeader + '\n' + csvRows;
        }
        
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `Order_${order.order_number || order.id}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success(`Order ${order.order_number} CSV downloaded successfully!`);
      } else {
        toast.info("Opening styled print sheet for requisition...");
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          const tableRows = lines.map(line => `
            <tr>
              <td style="border: 1px solid #ddd; padding: 10px; font-weight: 500;">${line.product_name || line.product_id}</td>
              <td style="border: 1px solid #ddd; padding: 10px; text-align: center; font-family: monospace;">${line.qty_ordered}</td>
              <td style="border: 1px solid #ddd; padding: 10px; font-family: monospace;">UGX ${(line.unit_cost_ugx || 0).toLocaleString()}</td>
              <td style="border: 1px solid #ddd; padding: 10px; font-family: monospace; font-weight: bold;">UGX ${(line.line_total_ugx || 0).toLocaleString()}</td>
              <td style="border: 1px solid #ddd; padding: 10px; font-style: italic; color: #666;">${line.notes || '--'}</td>
            </tr>
          `).join('');

          printWindow.document.write(`
            <html>
              <head>
                <title>Stock Requisition: ${order.order_number}</title>
                <style>
                  body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; color: #1f2937; line-height: 1.5; }
                  h1 { font-size: 24px; font-weight: 800; color: #111827; margin: 0 0 4px 0; letter-spacing: -0.025em; }
                  .status-badge { display: inline-block; padding: 4px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; border-radius: 9999px; background: #f3f4f6; color: #4b5563; }
                  .meta-grid { display: grid; grid-template-cols: repeat(3, 1fr); gap: 16px; margin: 24px 0; background: #f9fafb; padding: 20px; border-radius: 16px; border: 1px solid #f3f4f6; }
                  .meta-title { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #9ca3af; letter-spacing: 0.05em; margin-bottom: 4px; }
                  .meta-value { font-weight: 700; color: #111827; }
                  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
                  th { border-bottom: 2px solid #e5e7eb; padding: 12px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b7280; text-align: left; }
                  tr:hover { background-color: #fafafa; }
                </style>
              </head>
              <body>
                <div style="display: flex; justify-content: space-between; align-items: start;">
                  <div>
                    <h1>Requisition Order: ${order.order_number}</h1>
                    <span class="status-badge">${order.status.replace(/_/g, ' ')}</span>
                  </div>
                </div>
                <div class="meta-grid">
                  <div>
                    <div class="meta-title">Requesting Branch</div>
                    <div class="meta-value">${displayBranch(order)}</div>
                  </div>
                  <div>
                    <div class="meta-title">Order Type</div>
                    <div class="meta-value" style="text-transform: capitalize;">${order.order_type}</div>
                  </div>
                  <div>
                    <div class="meta-title">Inventory Stream</div>
                    <div class="meta-value">${isOperationalInventoryRecord(order) ? 'Operational Inventory' : 'Sellable Inventory'}</div>
                  </div>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Product / Item Description</th>
                      <th style="text-align: center; width: 100px;">Qty Ordered</th>
                      <th>Estimated Unit Cost</th>
                      <th>Line Total</th>
                      <th>Notes / Specs</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${tableRows}
                  </tbody>
                </table>
              </body>
            </html>
          `);
          printWindow.document.close();
          printWindow.focus();
          // Timeout to allow styles/html to render cleanly before print popup interrupts
          setTimeout(() => {
            printWindow.print();
          }, 50);
        }
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to generate requisition file.");
    }
  };

  const handleProcess = async (order: StockOrder) => {
    try {
      await firestoreService.updateDocument('stock_orders', order.id, {
        status: 'sourcing',
        processed_by: profile?.uid,
        processed_at: new Date().toISOString()
      });
      
      // Also update lines to sourcing status
      const lines = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: order.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
      for (const line of lines) {
        await firestoreService.updateDocument('stock_order_lines', line.id, {
          line_status: 'sourcing'
        });
      }
      
      toast.success('Order moved to sourcing');
    } catch (error) {
      toast.error('Failed to process order');
    }
  };

  const handleReject = async (order: StockOrder) => {
    if (!window.confirm('Bounce this order back to branch drafts?')) return;
    try {
      await firestoreService.updateDocument('stock_orders', order.id, {
        status: 'draft',
        rejection_notes: 'Rejected by Procurement personnel',
        rejected_by: profile?.uid,
        rejected_at: new Date().toISOString()
      });
      toast.success('Order bounced back to drafts');
    } catch (error) {
      toast.error('Failed to reject order');
    }
  };

  const handleManualProcess = async (order: StockOrder) => {
    if (!window.confirm('Process this order manually off-system and automatically download XLS sheet?')) return;
    try {
      // Begin manual offline transition
      await firestoreService.updateDocument('stock_orders', order.id, {
        status: 'manual_processing',
        processed_by: profile?.uid,
        processed_at: new Date().toISOString()
      });
      
      toast.success('Order marked for manual processing. Preparing automatic XLS download...');
      
      // Automatically download as XLS
      await handleDownload(order, 'xls');
    } catch (error) {
      toast.error('Failed to transition order to manual processing');
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
              <th className="px-6 py-4">Order Number</th>
              <th className="px-6 py-4">Requesting Branch</th>
              <th className="px-6 py-4">Type</th>
              <th className="px-6 py-4">Category</th>
              <th className="px-6 py-4">Date Submitted</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {orders.map((order) => (
              <tr key={order.id} className="hover:bg-zinc-50/50 transition-colors">
                <td className="px-6 py-4 font-bold text-zinc-900">
                  {order.order_number}
                  {isOperationalInventoryRecord(order) && (
                    <span className="ml-2 px-2 py-0.5 bg-sky-100 text-sky-700 text-[10px] rounded-full uppercase font-black">Operational Inventory</span>
                  )}
                  {order.is_emergency && (
                    <span className="ml-2 px-2 py-0.5 bg-red-500 text-white text-[10px] rounded-full uppercase font-black">Emergency</span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-zinc-600">{displayBranch(order)}</td>
                <td className="px-6 py-4 text-sm capitalize text-zinc-600">{order.order_type}</td>
                <td className="px-6 py-4 text-sm text-zinc-600">{order.category.replace(/_/g, ' ')}</td>
                <td className="px-6 py-4 text-sm text-zinc-500">
                  {order.submitted_at ? new Date(order.submitted_at).toLocaleDateString() : '--'}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button 
                      onClick={() => {
                        setSelectedOrder(order);
                        setIsDetailModalOpen(true);
                      }}
                      className="p-2 text-zinc-400 hover:text-emerald-500 transition-colors"
                      title="View Details"
                    >
                      <Eye size={18} />
                    </button>
                    <button 
                      onClick={() => handleDownload(order, 'pdf')}
                      className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                      title="Download PDF"
                    >
                      <FileIcon size={18} />
                    </button>
                    <button 
                      onClick={() => handleDownload(order, 'xls')}
                      className="p-2 text-zinc-400 hover:text-emerald-600 transition-colors"
                      title="Download XLS"
                    >
                      <FileSpreadsheet size={18} />
                    </button>
                    <button 
                      onClick={() => handleReject(order)}
                      className="p-2 text-zinc-400 hover:text-rose-500 transition-colors"
                      title="Reject Order (Back to Drafts)"
                    >
                      <X size={18} />
                    </button>
                    <button 
                      onClick={() => handleManualProcess(order)}
                      className="bg-zinc-100 hover:bg-zinc-200 text-zinc-600 px-4 py-1.5 rounded-xl text-xs font-bold transition-colors"
                    >
                      Manual
                    </button>
                    <button 
                      onClick={() => handleProcess(order)}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-1.5 rounded-xl text-xs font-bold transition-colors"
                    >
                      Process
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">
                  No new requisitions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isDetailModalOpen && selectedOrder && (
        <RequisitionDetailModal 
          order={selectedOrder}
          onClose={() => setIsDetailModalOpen(false)}
        />
      )}
    </div>
  );
};

const RequisitionDetailModal: React.FC<{ order: StockOrder, onClose: () => void }> = ({ order, onClose }) => {
  const [lines, setLines] = useState<StockOrderLine[]>([]);

  useEffect(() => {
    const fetchLines = async () => {
      const data = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: order.id }, { field: 'tenantId', operator: '==', value: order.tenantId }]);
      setLines(data);
    };
    fetchLines();
  }, [order.id]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[32px] w-full max-w-4xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-zinc-900">Requisition Details</h2>
            <p className="text-sm text-zinc-500">{order.order_number} - {order.requesting_branch_name}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        
        <div className="p-8 overflow-y-auto flex-1">
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div className="p-4 bg-zinc-50 rounded-2xl">
              <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Type</p>
              <p className="font-bold text-zinc-900 capitalize">{order.order_type}</p>
            </div>
            <div className="p-4 bg-zinc-50 rounded-2xl">
              <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Category</p>
              <p className="font-bold text-zinc-900 capitalize">{order.category.replace(/_/g, ' ')}</p>
            </div>
            <div className="p-4 bg-zinc-50 rounded-2xl">
              <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Date Submitted</p>
              <p className="font-bold text-zinc-900">{order.submitted_at ? new Date(order.submitted_at).toLocaleDateString() : '--'}</p>
            </div>
          </div>

          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Qty Ordered</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-3 text-sm font-medium text-zinc-900">{line.product_name}</td>
                  <td className="px-4 py-3 text-sm text-zinc-600">{line.qty_ordered}</td>
                  <td className="px-4 py-3 text-sm text-zinc-500 italic">{line.notes || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="p-8 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 text-zinc-500 font-bold hover:bg-zinc-100 rounded-xl transition-all">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const QueriesTab: React.FC = () => {
  const { profile } = useAuth();
  const [queries, setQueries] = useState<TransferInvoice[]>([]);
  const [selectedQuery, setSelectedQuery] = useState<TransferInvoice | null>(null);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [branches, setBranches] = useState<any[]>([]);
  const [queryLines, setQueryLines] = useState<Record<string, TransferInvoiceLine[]>>({});
  const [activeQuerySubTab, setActiveQuerySubTab] = useState<'active' | 'handled'>('active');
  const [querySearchTerm, setQuerySearchTerm] = useState('');
  const [queryDateRange, setQueryDateRange] = useState({ start: '', end: '' });

  useEffect(() => {
    if (profile?.tenantId) {
      // Fetch query_return invoices (both active dispatched and handled ones)
      const unsub = firestoreService.subscribeToCollectionByQuery<TransferInvoice>(
        'transfer_invoices',
        profile.tenantId,
        [where('transfer_type', '==', 'query_return')],
        setQueries
      );
      
      const unsubLines = firestoreService.subscribeToCollection<TransferInvoiceLine>(
        'transfer_invoice_lines',
        profile.tenantId,
        (linesData) => {
          const grouped: Record<string, TransferInvoiceLine[]> = {};
          linesData.forEach(line => {
            if (!grouped[line.transfer_id]) {
              grouped[line.transfer_id] = [];
            }
            grouped[line.transfer_id].push(line);
          });
          setQueryLines(grouped);
        }
      );

      firestoreService.subscribeToCollection<any>('branches', profile.tenantId, setBranches);
      return () => {
        unsub();
        unsubLines();
      };
    }
  }, [profile?.tenantId]);

  const handleAction = async (action: 'return' | 'transfer' | 'return_to_store', targetBranchId?: string) => {
    if (!selectedQuery || !profile) return;

    try {
      if (action === 'return') {
        // Mark as returned to supplier (completed)
        await firestoreService.updateDocument('transfer_invoices', selectedQuery.id, {
          status: 'returned_to_supplier',
          processed_by: profile.uid,
          processed_at: new Date().toISOString()
        });

        // 1. Get all line items for this query return
        const lines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [{ field: 'transfer_id', operator: '==', value: selectedQuery.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
        
        // 2. For each line item, deduct/remove from HQ stock (since it was temporarily returned to HQ)
        for (const line of lines) {
          const hqBatches = await firestoreService.getDocumentsByQuery<ProductBatch>('product_batches', [
            { field: 'tenantId', operator: '==', value: profile.tenantId },
            { field: 'productId', operator: '==', value: line.product_id },
            { field: 'branchId', operator: '==', value: 'HQ' },
            { field: 'batchNumber', operator: '==', value: line.batch_number }
          ]);

          if (hqBatches.length > 0) {
            const batch = hqBatches[0];
            const newQty = Math.max(0, batch.quantity - (line.qty_dispatched || 0));
            if (newQty <= 0) {
              await firestoreService.deleteDocument('product_batches', batch.id);
            } else {
              await firestoreService.updateDocument('product_batches', batch.id, {
                quantity: newQty,
                lastUpdated: new Date().toISOString()
              });
            }
          }
        }
        toast.success('Items marked as returned to supplier and removed from central stock');
      } else if (action === 'return_to_store') {
        // Mark as returned to store (completed)
        await firestoreService.updateDocument('transfer_invoices', selectedQuery.id, {
          status: 'returned_to_store',
          processed_by: profile.uid,
          processed_at: new Date().toISOString()
        });

        // Get all line items for this query return
        const lines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [{ field: 'transfer_id', operator: '==', value: selectedQuery.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
        
        // Re-add to central store inventory (branchId 'HQ')
        for (const line of lines) {
          const hqBatches = await firestoreService.getDocumentsByQuery<ProductBatch>('product_batches', [
            { field: 'tenantId', operator: '==', value: profile.tenantId },
            { field: 'productId', operator: '==', value: line.product_id },
            { field: 'branchId', operator: '==', value: 'HQ' },
            { field: 'batchNumber', operator: '==', value: line.batch_number }
          ]);

          if (hqBatches.length > 0) {
            const batch = hqBatches[0];
            await firestoreService.updateDocument('product_batches', batch.id, {
              quantity: batch.quantity + (line.qty_dispatched || 0),
              lastUpdated: new Date().toISOString()
            });
          } else {
            await firestoreService.addDocument('product_batches', {
              tenantId: profile.tenantId,
              branchId: 'HQ',
              productId: line.product_id,
              batchNumber: line.batch_number,
              expiryDate: line.expiry_date || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0],
              quantity: line.qty_dispatched || 0,
              purchasePrice: line.unit_cost_ugx || 0,
              sellingPrice: (line.unit_cost_ugx || 0) * 1.3,
              batch_status: 'active',
              createdAt: new Date().toISOString(),
              lastUpdated: new Date().toISOString()
            });
          }
        }
        toast.success('Items successfully added back to central store inventory');
      } else if (action === 'transfer' && targetBranchId) {
        const targetBranch = branches.find(b => b.id === targetBranchId);
        
        // 1. Update current query status
        await firestoreService.updateDocument('transfer_invoices', selectedQuery.id, {
          status: 'transferred',
          processed_by: profile.uid,
          processed_at: new Date().toISOString(),
          notes: `Transferred to ${targetBranch?.name}`
        });

        // 2. Generate new GRN for the target branch
        const newInvoiceRef = doc(collection(db, 'transfer_invoices'));
        const newInvoice: Partial<TransferInvoice> = {
          tenantId: profile.tenantId,
          inventoryClass: selectedQuery.inventoryClass || 'SELLABLE',
          transfer_number: `TRF-${selectedQuery.transfer_number}-${Date.now().toString().slice(-4)}`,
          source_branch_id: 'HQ',
          source_branch_name: 'Central HQ',
          destination_branch_id: targetBranchId,
          destination_branch_name: targetBranch?.name,
          transfer_type: 'central_to_branch',
          status: 'dispatched',
          dispatched_by: profile.uid,
          dispatched_at: new Date().toISOString(),
          total_value_ugx: selectedQuery.total_value_ugx || 0,
          notes: `Redirected query from ${selectedQuery.source_branch_name}`
        };
        await setDoc(newInvoiceRef, { ...newInvoice, createdAt: new Date().toISOString() });

        // Copy lines and deduct from HQ stock
        const lines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [{ field: 'transfer_id', operator: '==', value: selectedQuery.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
        for (const line of lines) {
          const newLineRef = doc(collection(db, 'transfer_invoice_lines'));
          const { id, ...lineData } = line;
          await setDoc(newLineRef, {
            ...lineData,
            inventoryClass: lineData.inventoryClass || selectedQuery.inventoryClass || 'SELLABLE',
            transfer_id: newInvoiceRef.id,
            createdAt: new Date().toISOString()
          });

          // Deduct from HQ since it is now transferred to target branch
          const hqBatches = await firestoreService.getDocumentsByQuery<ProductBatch>('product_batches', [
            { field: 'tenantId', operator: '==', value: profile.tenantId },
            { field: 'productId', operator: '==', value: line.product_id },
            { field: 'branchId', operator: '==', value: 'HQ' },
            { field: 'batchNumber', operator: '==', value: line.batch_number }
          ]);

          if (hqBatches.length > 0) {
            const batch = hqBatches[0];
            const newQty = Math.max(0, batch.quantity - (line.qty_dispatched || 0));
            if (newQty <= 0) {
              await firestoreService.deleteDocument('product_batches', batch.id);
            } else {
              await firestoreService.updateDocument('product_batches', batch.id, {
                quantity: newQty,
                lastUpdated: new Date().toISOString()
              });
            }
          }
        }
        toast.success(`Items redirected to ${targetBranch?.name} and deducted from central stock`);
      }
      setIsActionModalOpen(false);
      setSelectedQuery(null);
    } catch (error) {
      toast.error('Failed to process query action');
    }
  };

  const activeQueries = queries.filter(q => q.status === 'dispatched');
  const handledQueries = queries.filter(q => q.status !== 'dispatched');

  const filteredHandledQueries = handledQueries.filter(q => {
    const qVal = querySearchTerm.toLowerCase().trim();
    const matchesSearch = !qVal ||
      q.transfer_number.toLowerCase().includes(qVal) ||
      (q.source_branch_name || '').toLowerCase().includes(qVal) ||
      (q.destination_branch_name || '').toLowerCase().includes(qVal);

    const dateStr = q.processed_at || q.dispatched_at || '';
    const dateVal = dateStr.split('T')[0];
    const matchesStart = !queryDateRange.start || dateVal >= queryDateRange.start;
    const matchesEnd = !queryDateRange.end || dateVal <= queryDateRange.end;

    return matchesSearch && matchesStart && matchesEnd;
  });

  const handleDownloadHandledQueriesReport = () => {
    if (filteredHandledQueries.length === 0) {
      toast.error("No handled queries found in the current filtered period.");
      return;
    }

    const headers = ['Query Number', 'From Branch', 'Original Destination', 'Value (UGX)', 'Date Handled', 'Resolution Status / Actions Taken'];
    const rows: any[][] = [];

    filteredHandledQueries.forEach(q => {
      rows.push([
        q.transfer_number,
        q.source_branch_name || 'N/A',
        q.destination_branch_name || 'N/A',
        q.total_value_ugx || 0,
        q.processed_at ? q.processed_at.split('T')[0] : (q.dispatched_at ? q.dispatched_at.split('T')[0] : 'N/A'),
        q.status === 'returned_to_store' ? 'Returned to Store' : 
        q.status === 'returned_to_supplier' ? 'Returned to Supplier' : 
        q.status === 'transferred' ? 'Transferred / Redirected' : q.status.toUpperCase()
      ]);
    });

    const BOM = "\uFEFF";
    const csvContent = BOM + [headers.join(','), ...rows.map(e => e.map(val => `"${(val ?? '').toString().replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Handled_Queries_Report_${queryDateRange.start || 'all'}_to_${queryDateRange.end || 'all'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Handled queries report exported successfully.");
  };

  return (
    <div className="space-y-4">
      {/* Sub-tab selectors */}
      <div className="flex border-b border-zinc-200">
        <button
          onClick={() => setActiveQuerySubTab('active')}
          className={cn(
            "px-6 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all",
            activeQuerySubTab === 'active'
              ? "border-emerald-600 text-emerald-600 font-extrabold"
              : "border-transparent text-zinc-400 hover:text-zinc-600"
          )}
        >
          Active Queries ({activeQueries.length})
        </button>
        <button
          onClick={() => setActiveQuerySubTab('handled')}
          className={cn(
            "px-6 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all",
            activeQuerySubTab === 'handled'
              ? "border-emerald-600 text-emerald-600 font-extrabold"
              : "border-transparent text-zinc-400 hover:text-zinc-600"
          )}
        >
          Handled & Resolved Logs ({handledQueries.length})
        </button>
      </div>

      {activeQuerySubTab === 'active' ? (
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Query Number</th>
                <th className="px-6 py-4">From Branch</th>
                <th className="px-6 py-4">Original Destination</th>
                <th className="px-6 py-4">Value</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {activeQueries.map((q) => {
                const lines = queryLines[q.id] || [];
                return (
                  <tr key={q.id} className="hover:bg-zinc-50/50 transition-colors border-b">
                    <td className="px-6 py-4">
                      <span className="font-bold text-zinc-900 block">{q.transfer_number}</span>
                      <div className="mt-2 space-y-1 bg-zinc-50 p-2.5 rounded-xl border border-zinc-100 max-w-sm">
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Queried Items Detail:</p>
                        {lines.map((l, lIdx) => (
                          <div key={lIdx} className="text-xs">
                            <span className="font-semibold text-zinc-800">{l.product_name}</span>
                            <div className="flex justify-between text-[10px] text-zinc-500 mt-0.5">
                              <span>Qty: <strong className="text-zinc-700">{l.qty_dispatched} units</strong></span>
                              <span>Accrued: <strong className="text-indigo-600">UGX {(l.total_cost_ugx || 0).toLocaleString()}</strong></span>
                            </div>
                          </div>
                        ))}
                        {lines.length === 0 && (
                          <span className="text-xs text-zinc-400 italic">No detailed lines fetched</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-600">{q.source_branch_name}</td>
                    <td className="px-6 py-4 text-sm text-zinc-600">{q.destination_branch_name}</td>
                    <td className="px-6 py-4 text-sm font-bold text-zinc-900">UGX {(q.total_value_ugx || 0).toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-zinc-500">{q.dispatched_at ? new Date(q.dispatched_at).toLocaleDateString() : 'N/A'}</td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => {
                          setSelectedQuery(q);
                          setIsActionModalOpen(true);
                        }}
                        className="px-4 py-2 bg-emerald-500 text-white rounded-xl text-xs font-bold hover:bg-emerald-600 transition-all shadow-sm"
                      >
                        Handle Query
                      </button>
                    </td>
                  </tr>
                );
              })}
              {activeQueries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-zinc-400">
                    No active queries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-50 p-4 rounded-2xl border border-zinc-200">
            <div className="flex flex-col md:flex-row md:items-center gap-4 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                <input 
                  type="text"
                  placeholder="Search queries by branch, ID..."
                  className="w-full pl-9 pr-4 py-1.5 bg-white border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs font-bold text-zinc-800"
                  value={querySearchTerm}
                  onChange={(e) => setQuerySearchTerm(e.target.value)}
                />
              </div>
              
              <div className="flex items-center gap-2 bg-white border border-zinc-200 px-3 py-1.5 rounded-xl shadow-sm">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Date range:</span>
                <input 
                  type="date" 
                  value={queryDateRange.start} 
                  onChange={(e) => setQueryDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="bg-transparent border-none text-xs outline-none focus:ring-0 text-zinc-700 w-[110px]"
                />
                <span className="text-xs font-bold text-zinc-400">to</span>
                <input 
                  type="date" 
                  value={queryDateRange.end} 
                  onChange={(e) => setQueryDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="bg-transparent border-none text-xs outline-none focus:ring-0 text-zinc-700 w-[110px]"
                />
              </div>
            </div>

            <button 
              onClick={handleDownloadHandledQueriesReport}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all"
            >
              <Download size={14} />
              Download Audit Report
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-500">
                  <th className="px-6 py-4">Query Number</th>
                  <th className="px-6 py-4">From Branch</th>
                  <th className="px-6 py-4">Original Destination</th>
                  <th className="px-6 py-4 text-right">Value</th>
                  <th className="px-6 py-4 text-center">Date Handled</th>
                  <th className="px-6 py-4 text-right">Actions taken / Resolution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 font-medium text-zinc-700">
                {filteredHandledQueries.map((q) => {
                  const lines = queryLines[q.id] || [];
                  return (
                    <tr key={q.id} className="hover:bg-zinc-50/20">
                      <td className="px-6 py-4">
                        <span className="font-bold text-zinc-950 font-mono block">{q.transfer_number}</span>
                        {lines.length > 0 && (
                          <div className="mt-1 text-[10px] text-zinc-400">
                            {lines.map(l => `${l.product_name} (${l.qty_dispatched} units)`).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 font-semibold text-zinc-900">{q.source_branch_name}</td>
                      <td className="px-6 py-4 text-zinc-500">{q.destination_branch_name}</td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-zinc-900">
                        UGX {(q.total_value_ugx || 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-center text-zinc-400 font-mono">
                        {new Date(q.processed_at || q.dispatched_at || '').toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className={cn(
                          "px-2 py-0.5 rounded-lg text-[9px] uppercase font-black tracking-wider leading-none border",
                          q.status === 'returned_to_store' ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                          q.status === 'returned_to_supplier' ? "bg-rose-50 text-rose-700 border-rose-100" :
                          "bg-blue-50 text-blue-700 border-blue-100"
                        )}>
                          {q.status === 'returned_to_store' ? 'Returned to Store' : 
                           q.status === 'returned_to_supplier' ? 'Returned to Supplier' : 
                           q.status === 'transferred' ? 'Transferred / Redirected' : q.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {filteredHandledQueries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">
                      No handled queries found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action Modal */}
      <AnimatePresence>
        {isActionModalOpen && selectedQuery && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsActionModalOpen(false)}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-[2rem] shadow-2xl overflow-hidden p-8"
            >
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Handle Query: {selectedQuery.transfer_number}</h3>
              <p className="text-sm text-zinc-500 mb-6 font-medium">Choose how to resolve this stock query.</p>

              <div className="space-y-4">
                <button 
                  onClick={() => handleAction('return_to_store')}
                  className="w-full flex items-center justify-between p-4 bg-emerald-50 border border-emerald-100 rounded-2xl hover:bg-emerald-100 transition-all group text-left outline-none"
                >
                  <div className="flex-1 pr-2">
                    <p className="font-bold text-emerald-900">Return to Store</p>
                    <p className="text-[11px] text-emerald-600 leading-normal">Add these queried products straight back into the central HQ Store.</p>
                  </div>
                  <ChevronRight size={18} className="text-emerald-400 group-hover:translate-x-1 transition-transform" />
                </button>

                <button 
                  onClick={() => handleAction('return')}
                  className="w-full flex items-center justify-between p-4 bg-rose-50 border border-rose-100 rounded-2xl hover:bg-rose-100 transition-all group text-left outline-none"
                >
                  <div className="flex-1 pr-2">
                    <p className="font-bold text-rose-900">Return to Supplier</p>
                    <p className="text-[11px] text-rose-600 leading-normal">Permanently return these query products to the vendor / supplier.</p>
                  </div>
                  <ChevronRight size={18} className="text-rose-400 group-hover:translate-x-1 transition-transform" />
                </button>

                <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl space-y-3">
                  <p className="font-bold text-zinc-900">Send to Another Branch</p>
                  <p className="text-xs text-zinc-500">Redirect these items to a different active branch.</p>
                  <select 
                    className="w-full bg-white border border-zinc-200 rounded-xl text-sm p-2 outline-none focus:ring-2 focus:ring-emerald-500/10 font-semibold"
                    onChange={(e) => handleAction('transfer', e.target.value)}
                    defaultValue=""
                  >
                    <option value="" disabled>Select target branch...</option>
                    {branches.filter(b => b.id !== selectedQuery.source_branch_id).map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button 
                onClick={() => setIsActionModalOpen(false)}
                className="w-full mt-6 py-3 text-zinc-400 font-bold hover:text-zinc-600 transition-all"
              >
                Cancel
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const SourcingTab: React.FC = () => {
  const { profile } = useAuth();
  const operationalInventoryEnabled = useOperationalInventoryFeature();
  const [orderLines, setOrderLines] = useState<StockOrderLine[]>([]);
  const [orders, setOrders] = useState<StockOrder[]>([]);
  const [suppliers, setSuppliers] = useState<InstitutionRegistry[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<StockOrder | null>(null);
  const [isSourcingModalOpen, setIsSourcingModalOpen] = useState(false);
  const [hqBatches, setHqBatches] = useState<ProductBatch[]>([]);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<StockOrderLine>('stock_order_lines', profile.tenantId, (data) => {
        setOrderLines(data);
      });
      firestoreService.subscribeToCollection<StockOrder>('stock_orders', profile.tenantId, data => {
        setOrders(data.filter(order => operationalInventoryEnabled || !isOperationalInventoryRecord(order)));
      });
      return firestoreService.subscribeToCollection<InstitutionRegistry>('supplier_registry', profile.tenantId, setSuppliers);
      firestoreService.subscribeToCollection<ProductBatch>('product_batches', profile.tenantId, (data) => {
        setHqBatches(data.filter(b => b.branchId === 'HQ'));
      });
    }
  }, [profile?.tenantId, operationalInventoryEnabled]);

  useEffect(() => {
    if (!operationalInventoryEnabled && selectedOrder && isOperationalInventoryRecord(selectedOrder)) {
      setSelectedOrder(null);
      setIsSourcingModalOpen(false);
    }
  }, [operationalInventoryEnabled, selectedOrder]);

  // Group active sourcing lines by order_id
  const sourcingLinesGrouped = orderLines.filter(l => l.line_status === 'sourcing');
  const activeSourcingOrderIds = Array.from(new Set(sourcingLinesGrouped.map(l => l.order_id)));
  const listOrders = orders.filter(o => activeSourcingOrderIds.includes(o.id));

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-zinc-100">
          <h3 className="text-lg font-bold text-zinc-900">Sourcing & Quotation (Whole Orders)</h3>
          <p className="text-xs text-zinc-500 mt-1">Select an entire order below to review central HQ stock levels, assign internal transfers, and source quotes from vendors.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Order Ref</th>
                <th className="px-6 py-4">Requesting Branch</th>
                <th className="px-6 py-4">Sourcing Items</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Created Date</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {listOrders.map((order) => {
                const lines = sourcingLinesGrouped.filter(l => l.order_id === order.id);
                return (
                  <tr key={order.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-bold text-zinc-900">
                      {order.order_number || 'Unnamed Requisition'}
                      {isOperationalInventoryRecord(order) && (
                        <span className="ml-2 px-2 py-0.5 bg-sky-100 text-sky-700 text-[10px] rounded-full uppercase font-black">Operational Inventory</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-600">{order.requesting_branch_name || order.requesting_branch_id}</td>
                    <td className="px-6 py-4 text-sm text-zinc-600 font-medium">
                      <span className="px-2 py-0.5 bg-zinc-100 rounded-md text-zinc-700 font-bold text-xs">{lines.length} items</span>
                    </td>
                    <td className="px-6 py-4 text-xs font-semibold text-zinc-600 capitalize">{order.category.replace(/_/g, ' ')}</td>
                    <td className="px-6 py-4 text-xs text-zinc-500">
                      {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button 
                          onClick={async () => {
                            if (window.confirm(`Are you sure you want to revert order ${order.order_number || ''} back to the Requisitions tab?`)) {
                              try {
                                await firestoreService.updateDocument('stock_orders', order.id, {
                                  status: 'submitted',
                                  updatedAt: new Date().toISOString()
                                });
                                const lines = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: order.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
                                for (const line of lines) {
                                  await firestoreService.updateDocument('stock_order_lines', line.id, {
                                    line_status: 'submitted',
                                    updatedAt: new Date().toISOString()
                                  });
                                }
                                toast.success('Order reverted to Requisitions.');
                              } catch (error) {
                                console.error(error);
                              }
                            }
                          }}
                          className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-bold rounded-lg transition-colors"
                        >
                          Revert
                        </button>
                        <button 
                          onClick={() => {
                            setSelectedOrder(order);
                            setIsSourcingModalOpen(true);
                          }}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                        >
                          Source Order
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {listOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic text-sm">
                    No comprehensive orders currently awaiting sourcing.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isSourcingModalOpen && selectedOrder && (
        <WholeOrderSourcingModal 
          order={selectedOrder}
          allLines={orderLines}
          suppliers={suppliers}
          hqBatches={hqBatches}
          onClose={() => setIsSourcingModalOpen(false)}
        />
      )}
    </div>
  );
};

const WholeOrderSourcingModal: React.FC<{
  order: StockOrder;
  allLines: StockOrderLine[];
  suppliers: InstitutionRegistry[];
  hqBatches: ProductBatch[];
  onClose: () => void;
}> = ({ order, allLines, suppliers, hqBatches, onClose }) => {
  const { profile } = useAuth();
  const operationalInventoryEnabled = useOperationalInventoryFeature();
  const isOperationalOrder = isOperationalInventoryRecord(order);
  const [lines, setLines] = useState<StockOrderLine[]>([]);
  const [hqOperationalItems, setHqOperationalItems] = useState<OperationalInventory[]>([]);
  const [operationalFulfillPacks, setOperationalFulfillPacks] = useState<Record<string, number>>({});
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [itemCosts, setItemCosts] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!profile?.tenantId || !isOperationalOrder || !operationalInventoryEnabled) {
      setHqOperationalItems([]);
      return;
    }
    return firestoreService.subscribeToCollection<OperationalInventory>('operational_inventory', profile.tenantId, rows => {
      setHqOperationalItems(rows.filter(item => item.branchId === 'HQ' && item.inventoryClass === 'OPERATIONAL' && Boolean(item.masterItemId)));
    });
  }, [profile?.tenantId, isOperationalOrder, operationalInventoryEnabled]);

  useEffect(() => {
    // Only grab lines belonging to this order, and which have line_status === 'sourcing'
    const oLines = allLines.filter(l => l.order_id === order.id && l.line_status === 'sourcing');
    setLines(oLines);
    
    // Initialize prices
    const initialCosts: Record<string, number> = {};
    oLines.forEach(l => {
      initialCosts[l.id] = l.unit_cost_ugx || 0;
    });
    setItemCosts(initialCosts);
  }, [allLines, order.id]);

  const eligibleSuppliers = suppliers.filter(supplier => supplierEligibleForStream(supplier, isOperationalOrder ? 'OPERATIONAL' : 'SELLABLE'));

  // Helper: compute HQ stock total quantity for a product_id
  const getProductHqStock = (productId: string) => {
    return hqBatches
      .filter(b => b.productId === productId)
      .reduce((sum, b) => sum + (b.quantity || 0), 0);
  };

  const getOperationalHqItem = (line: StockOrderLine) => hqOperationalItems.find(item => item.masterItemId === line.masterItemId);
  const getOperationalPacksAvailable = (line: StockOrderLine) => {
    const item = getOperationalHqItem(line);
    return item ? Math.floor(Number(item.quantityInStock || 0) / Math.max(1, Number(item.unitPerPack || 1))) : 0;
  };

  const handleOperationalStoreFulfillment = async (line: StockOrderLine) => {
    if (!profile?.tenantId || !profile.uid || !operationalInventoryEnabled || submitting) return;
    const item = getOperationalHqItem(line);
    const maxPacks = getOperationalPacksAvailable(line);
    const quantityPacks = Math.min(Number(operationalFulfillPacks[line.id] || maxPacks), Number(line.qty_ordered || 0), maxPacks);
    if (!item || quantityPacks <= 0) {
      toast.error('No whole packs are currently available in the HQ Operational Store.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await fulfillOperationalOrderFromHqStore({
        tenantId: profile.tenantId,
        order,
        line,
        quantityPacks,
        actor: { uid: profile.uid, name: profile.fullName || profile.displayName || profile.email || profile.uid }
      });
      toast.success(`Dispatched ${result.quantityPacks} pack(s) from HQ Operational Store. ${result.remainingExternalPacks} pack(s) remain for external sourcing.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Operational Store fulfilment failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // Perform "Assign to Store" (internal transfer) for a single item from HQ Store
  const handleAssignToStore = async (line: StockOrderLine) => {
    if (!profile || submitting) return;
    if (isOperationalOrder || isOperationalInventoryRecord(line) || line.isOperational) {
      toast.error('Operational orders cannot be fulfilled from the Sellable HQ Store.');
      return;
    }
    setSubmitting(true);
    try {
      const hqQty = getProductHqStock(line.product_id);
      if (hqQty < line.qty_ordered) {
        toast.error(`Insufficient HQ Stock! Only ${hqQty} available of ${line.qty_ordered} requested.`);
        return;
      }

      // Step 1: Deduct from HQ batches
      let qtyRemaining = line.qty_ordered;
      const filteredHqBatches = hqBatches
        .filter(b => b.productId === line.product_id)
        .sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || '')); // FIFO: earliest expiry first

      for (const batch of filteredHqBatches) {
        if (qtyRemaining <= 0) break;
        const deduct = Math.min(batch.quantity, qtyRemaining);
        qtyRemaining -= deduct;

        const newQty = batch.quantity - deduct;
        if (newQty <= 0) {
          await firestoreService.deleteDocument('product_batches', batch.id);
        } else {
          await firestoreService.updateDocument('product_batches', batch.id, {
            quantity: newQty,
            lastUpdated: new Date().toISOString()
          });
        }
      }

      // Step 2: Create draft GRN under hq store's operational logs (grn_records) with status 'draft'
      const grnNumber = `DRAFT-GRN-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
      const grnRecord = {
        tenantId: profile.tenantId,
        grn_number: grnNumber,
        status: 'draft',
        supplier_id: 'HQ_STORE',
        supplier_name: 'HQ Store Transfer',
        total_value_ugx: 0,
        receivedAt: new Date().toISOString(),
        items: [{
          product_id: line.product_id,
          product_name: line.product_name || 'Stock item',
          qty_ordered: line.qty_ordered,
          qty_received: line.qty_ordered,
          unit_cost_ugx: 0,
        }],
        createdAt: new Date().toISOString()
      };
      await firestoreService.addDocument('grn_records', grnRecord);

      // Step 3: Update the line item to status 'approved' (assigned internally) and remove from active order sourcing
      await firestoreService.updateDocument('stock_order_lines', line.id, {
        supplier_id: 'HQ_STORE',
        supplier_name: 'HQ Store',
        supplier_type: 'internal_hq',
        line_status: 'approved' // Automatically approved since fulfilled from HQ central!
      });

      // Update local state to filter out this line
      setLines(prev => prev.filter(l => l.id !== line.id));
      toast.success(`HQ Stock of ${line.qty_ordered} assigned. Draft GRN (${grnNumber}) recorded inside internal stock operations!`);
    } catch (err) {
      toast.error('Failed to assign item to HQ store');
    } finally {
      setSubmitting(false);
    }
  };

  // Exclude single item & route to unsupplied/undelivered list
  const handleExcludeItem = async (line: StockOrderLine) => {
    if (!profile || submitting) return;
    setSubmitting(true);
    try {
      await firestoreService.updateDocument('stock_order_lines', line.id, {
        line_status: 'unsupplied'
      });
      setLines(prev => prev.filter(l => l.id !== line.id));
      toast.success(`Removed ${line.product_name || line.product_id} from this supplier; moved to Unsupplied list.`);
    } catch (err) {
      toast.error('Failed to exclude item.');
    } finally {
      setSubmitting(false);
    }
  };

  // Assign the remaining items as a whole order to a chosen supplier
  const handleBulkAssignSupplier = async () => {
    if (!profile || submitting || !selectedSupplierId) return;
    setSubmitting(true);
    try {
      const selectedSupplier = suppliers.find(s => s.id === selectedSupplierId);
      if (!selectedSupplier) {
        toast.error('Selected supplier is invalid.');
        return;
      }

      // 1. Process all remaining lines
      for (const line of lines) {
        const cost = Number(itemCosts[line.id] || 0);
        await firestoreService.updateDocument('stock_order_lines', line.id, {
          supplier_id: selectedSupplier.id,
          supplier_name: selectedSupplier.supplier_name,
          supplier_type: 'external',
          unit_cost_ugx: cost,
          line_total_ugx: cost * line.qty_ordered,
          line_status: 'awaiting_finance_approval'
        });
      }

      // Check if all lines for this order are now sourced
      const allLinesData = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: order.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
      const allSourced = allLinesData.every(l => l.line_status !== 'sourcing' && l.line_status !== 'pending');
      
      if (allSourced) {
        const hasExternal = allLinesData.some(l => l.supplier_type === 'external');
        const totalValue = allLinesData.reduce((sum, l) => sum + (l.line_total_ugx || 0), 0);
        
        await firestoreService.updateDocument('stock_orders', order.id, {
          status: hasExternal ? 'awaiting_finance_approval' : 'approved',
          total_order_value_ugx: totalValue
        });
      }

      toast.success(`Whole order bulk assigned to ${selectedSupplier.supplier_name} successfully! Passed to approval stage.`);
      onClose();
    } catch (err) {
      toast.error('Failed bulk supplier order submission.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 leading-normal">
      <div className="bg-white rounded-[32px] w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col font-sans">
        
        {/* Header */}
        <div className="p-6 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-zinc-950">Procurement Integration Portal</h2>
            <p className="text-xs text-zinc-500 mt-1">Sourcing order <strong className="text-zinc-900">{order.order_number}</strong> for requesting branch <strong className="text-zinc-900">{order.requesting_branch_name}</strong></p>
            <span className={cn('mt-2 inline-block px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide', isOperationalOrder ? 'bg-sky-100 text-sky-700' : 'bg-zinc-100 text-zinc-600')}>
              {isOperationalOrder ? 'Operational Inventory' : 'Sellable Inventory'}
            </span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-200 text-zinc-400 hover:text-zinc-500 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          
          {/* Section 1: Assess HQ Stock & Assign internal items */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-black uppercase text-zinc-500 tracking-wider">Step 1: {isOperationalOrder ? 'Operational HQ Store Assessment' : 'Sellable HQ Store Assessment'}</h3>
              <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full font-bold">{isOperationalOrder ? 'Operational stock is kept in its separate store.' : 'Fulfill internally to bypass supplier cost.'}</span>
            </div>
            
            <div className="border border-zinc-200 rounded-2xl overflow-hidden bg-white">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/50 border-b border-zinc-100 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                    <th className="px-4 py-3">Product Name</th>
                    <th className="px-4 py-3 text-center">Req. Qty</th>
                    <th className="px-4 py-3 text-center">{isOperationalOrder ? 'HQ Operational Stock' : 'HQ Sellable Stock'}</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-sm">
                  {lines.map(line => {
                    const operationalLine = isOperationalOrder || isOperationalInventoryRecord(line) || line.isOperational === true;
                    const canUseHqOperationalStock = order.requesting_branch_id !== 'HQ';
                    const operationalItem = operationalLine ? getOperationalHqItem(line) : undefined;
                    const hqStock = operationalLine ? Number(operationalItem?.quantityInStock || 0) : getProductHqStock(line.product_id);
                    const maxOperationalPacks = operationalLine ? Math.min(Number(line.qty_ordered || 0), getOperationalPacksAvailable(line)) : 0;
                    const requestedOperationalPacks = Math.min(Number(operationalFulfillPacks[line.id] || maxOperationalPacks), maxOperationalPacks);
                    const canFulfill = operationalLine
                      ? canUseHqOperationalStock && operationalInventoryEnabled && Boolean(operationalItem?.masterItemId) && requestedOperationalPacks > 0
                      : hqStock !== null && hqStock >= line.qty_ordered;
                    return (
                      <tr key={line.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-4 py-3 font-semibold text-zinc-900">{line.product_name}</td>
                        <td className="px-4 py-3 text-center font-bold text-zinc-600">{line.qty_ordered}</td>
                        <td className="px-4 py-3 text-center font-bold">
                          <span className={cn("px-2.5 py-1 rounded-full text-xs font-black", canFulfill ? "bg-emerald-100/75 text-emerald-700" : operationalLine ? "bg-sky-100/75 text-sky-700" : "bg-rose-100/75 text-rose-700")}>
                            {operationalLine ? `${hqStock.toLocaleString()} ${operationalItem?.unitOfIssue || 'units'} · up to ${maxOperationalPacks} packs` : `${hqStock} packs`}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {operationalLine && canUseHqOperationalStock && maxOperationalPacks > 0 && <input
                            aria-label={`Operational packs to fulfill for ${line.product_name}`}
                            type="number" min="1" max={maxOperationalPacks} step="1"
                            value={operationalFulfillPacks[line.id] ?? maxOperationalPacks}
                            onChange={event => setOperationalFulfillPacks(previous => ({ ...previous, [line.id]: Math.max(0, Math.min(maxOperationalPacks, Number(event.target.value))) }))}
                            disabled={submitting}
                            className="w-20 mr-2 px-2 py-1.5 rounded-lg border border-zinc-200 text-xs text-right"
                          />}
                          <button
                            disabled={!canFulfill || submitting}
                            onClick={() => operationalLine ? handleOperationalStoreFulfillment(line) : handleAssignToStore(line)}
                            className={cn(
                              "px-3 py-1.5 rounded-xl font-bold text-xs shadow-sm transition-all",
                              canFulfill 
                                ? "bg-emerald-500 hover:bg-emerald-600 text-white cursor-pointer" 
                                : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                            )}
                          >
                            {operationalLine ? (canUseHqOperationalStock ? 'Fulfill from Operational Store' : 'HQ replenishment uses suppliers') : 'Assign to Store'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-zinc-400 italic text-xs">
                        All requisition items of this order are processed or transferred!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Rest of Order to Supplier */}
          {lines.length > 0 && (
            <div className="p-6 bg-zinc-50 rounded-3xl border border-zinc-200 space-y-4">
              <h3 className="text-xs font-black uppercase text-zinc-400 tracking-wider">Step 2: Assign Rest of Order As a Whole to Vendor</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 block">Select Assigned Supplier</label>
                  <select
                    disabled={submitting}
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/15 outline-none text-sm font-semibold"
                  >
                    <option value="">Choose Supplier...</option>
                    {eligibleSuppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.supplier_name} - {s.country || 'Uganda'}</option>
                    ))}
                  </select>
                  {isOperationalOrder && eligibleSuppliers.length === 0 && (
                    <p className="mt-1 text-[11px] text-amber-700">No supplier is tagged for Non-Sellable Operational Items. Update a supplier’s capabilities before assigning this order.</p>
                  )}
                </div>
              </div>

              <div className="border border-zinc-200 rounded-2xl overflow-hidden bg-white mt-4">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-100 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                      <th className="px-4 py-3">Product Name</th>
                      <th className="px-4 py-3 text-center">Qty</th>
                      <th className="px-4 py-3">Vendor Unit Cost (UGX)</th>
                      <th className="px-4 py-3 text-right">Exclude & Route to Unsupplied</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 text-sm">
                    {lines.map(line => (
                      <tr key={line.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-4 py-3 font-semibold text-zinc-900">{line.product_name}</td>
                        <td className="px-4 py-3 text-center font-bold text-zinc-600">{line.qty_ordered}</td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            disabled={submitting}
                            min={0}
                            placeholder="Quote price"
                            className="px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-bold w-36 outline-none focus:ring-2 focus:ring-emerald-500/20"
                            value={itemCosts[line.id] || ''}
                            onChange={(e) => setItemCosts({
                              ...itemCosts,
                              [line.id]: Number(e.target.value)
                            })}
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleExcludeItem(line)}
                            className="px-3 py-1.5 text-rose-500 hover:text-rose-600 text-xs font-black uppercase transition-all"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Action controls footer */}
        <div className="p-6 bg-zinc-50 border-t border-zinc-100 flex gap-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-3.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-2xl font-bold transition-all text-sm"
          >
            Cancel
          </button>
          
          {lines.length > 0 && (
            <button
              disabled={!selectedSupplierId || submitting}
              onClick={handleBulkAssignSupplier}
              className={cn(
                "flex-1 py-3.5 rounded-2xl font-black uppercase text-sm tracking-wider shadow-md transition-all text-white cursor-pointer",
                selectedSupplierId && !submitting
                  ? "bg-zinc-950 hover:bg-zinc-800"
                  : "bg-zinc-300 pointer-events-none"
              )}
            >
              {submitting ? 'Processing Entire Order...' : 'Confirm Bulk Supplier Assignment'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
};

const FinancialApprovalTab: React.FC = () => {
  const { profile } = useAuth();
  const operationalInventoryEnabled = useOperationalInventoryFeature();
  const [orders, setOrders] = useState<StockOrder[]>([]);
  const [branchNames, setBranchNames] = useState<Record<string, string>>({});
  const [selectedOrder, setSelectedOrder] = useState<StockOrder | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const displayBranch = (order: StockOrder): string => procurementRequestingBranchLabel(order, branchNames);

  useEffect(() => {
    if (!profile?.tenantId) return;
    return firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, records => {
      setBranchNames(Object.fromEntries(records.map(branch => [branch.id, branch.name])));
    });
  }, [profile?.tenantId]);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<StockOrder>('stock_orders', profile.tenantId, (data) => {
        setOrders(data.filter(o => o.status === 'awaiting_finance_approval' && (operationalInventoryEnabled || !isOperationalInventoryRecord(o))));
      });
    }
  }, [profile?.tenantId, operationalInventoryEnabled]);

  useEffect(() => {
    if (!operationalInventoryEnabled && selectedOrder && isOperationalInventoryRecord(selectedOrder)) {
      setSelectedOrder(null);
      setIsModalOpen(false);
    }
  }, [operationalInventoryEnabled, selectedOrder]);

  const handleApprove = () => setIsModalOpen(false);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
            <th className="px-6 py-4">Order #</th>
            <th className="px-6 py-4">Total Value</th>
            <th className="px-6 py-4">Requesting Branch (Origin)</th>
            <th className="px-6 py-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {orders.map((order) => (
            <tr key={order.id} className="hover:bg-zinc-50/50 transition-colors">
              <td className="px-6 py-4 font-bold text-zinc-900">{order.order_number}</td>
              <td className="px-6 py-4 font-bold text-zinc-900">UGX {order.total_order_value_ugx.toLocaleString()}</td>
              <td className="px-6 py-4 text-sm text-zinc-600">{displayBranch(order)}</td>
              <td className="px-6 py-4 text-right">
                <div className="flex justify-end gap-2">
                  <button 
                    onClick={async () => {
                      if (window.confirm(`Are you sure you want to revert order ${order.order_number || ''} back to the Sourcing tab?`)) {
                        try {
                          await firestoreService.updateDocument('stock_orders', order.id, {
                            status: 'sourcing',
                            updatedAt: new Date().toISOString()
                          });
                          const lines = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: order.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
                          for (const line of lines) {
                            await firestoreService.updateDocument('stock_order_lines', line.id, {
                              line_status: 'sourcing',
                              updatedAt: new Date().toISOString()
                            });
                          }
                          toast.success('Order reverted to Sourcing.');
                        } catch (error) {
                          console.error(error);
                          toast.error('Failed to revert order.');
                        }
                      }
                    }}
                    className="px-3 py-1 border border-zinc-200 text-zinc-500 hover:bg-zinc-50 rounded-lg text-xs font-bold transition-colors"
                  >
                    Revert
                  </button>
                  <button 
                    onClick={() => {
                      setSelectedOrder(order);
                      setIsModalOpen(true);
                    }}
                    className="bg-zinc-900 text-white px-3 py-1 rounded-lg text-xs font-bold transition-colors"
                  >
                    Review &amp; Approve
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr>
              <td colSpan={4} className="px-6 py-12 text-center text-zinc-400 italic">
                No orders awaiting financial approval.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {isModalOpen && selectedOrder && (
        <FinancialApprovalModal 
          order={selectedOrder}
          onClose={() => setIsModalOpen(false)}
          onApprove={handleApprove}
          originBranchName={displayBranch(selectedOrder)}
        />
      )}
    </div>
  );
};

const FinancialApprovalModal: React.FC<{
  order: StockOrder;
  onClose: () => void;
  onApprove: (id: string) => void;
  originBranchName: string;
}> = ({ order, onClose, onApprove, originBranchName }) => {
  const { profile, hasPermission } = useAuth();
  const operationalInventoryEnabled = useOperationalInventoryFeature();
  const operational = isOperationalInventoryRecord(order);
  const inventoryClass = operational ? 'OPERATIONAL' : 'SELLABLE';
  const [lines, setLines] = useState<StockOrderLine[]>([]);
  const [editedLines, setEditedLines] = useState<Record<string, ApprovalQuantityEdit>>({});
  const [products, setProducts] = useState<Product[]>([]);
  const [operationalItems, setOperationalItems] = useState<OperationalInventory[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [additions, setAdditions] = useState<ApprovalAddition[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [additionQuantity, setAdditionQuantity] = useState(1);
  const [additionCost, setAdditionCost] = useState(0);
  const [additionReason, setAdditionReason] = useState('');
  const [replacesLineId, setReplacesLineId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const canApprove = hasPermission('procurement', 'operate');

  useEffect(() => {
    if (!profile?.tenantId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    const fetchLines = async () => {
      try {
        const data = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [
          { field: 'order_id', operator: '==', value: order.id },
          { field: 'tenantId', operator: '==', value: profile.tenantId }
        ]);
        if (cancelled) return;
        const pending = data.filter(line => line.line_status === 'awaiting_finance_approval');
        setLines(pending);
        setEditedLines(Object.fromEntries(pending.map(line => [line.id, { qty: line.qty_ordered, removed: false }])));
      } catch (error) {
        if (!cancelled) {
          setLoadError(true);
          toast.error('Could not load order lines for financial review. Approval is unavailable.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchLines();
    const unsubProducts = firestoreService.subscribeToCollection<Product>('products', profile.tenantId, records => setProducts(records));
    const unsubOperational = operationalInventoryEnabled
      ? firestoreService.subscribeToCollection<OperationalInventory>('operational_inventory', profile.tenantId, records => {
        setOperationalItems(records.filter(item =>
          item.branchId === order.requesting_branch_id &&
          item.inventoryClass === 'OPERATIONAL' && Boolean(item.masterItemId)
        ));
      }) : undefined;
    const unsubSuppliers = firestoreService.subscribeToCollection<any>('supplier_registry', profile.tenantId, records => setSuppliers(records));
    return () => {
      cancelled = true;
      unsubProducts();
      unsubOperational?.();
      unsubSuppliers();
    };
  }, [profile?.tenantId, order.id, order.requesting_branch_id, operationalInventoryEnabled]);

  const eligibleSuppliers = suppliers.filter(supplier => supplierEligibleForStream(supplier, inventoryClass));
  const availableProducts = operational
    ? operationalItems.map(item => ({ id: item.id, name: item.name, code: item.sku || item.uniqueId || '', defaultCost: item.costPerPack || 0 }))
    : products.filter(product => (product as any).isOperational !== true &&
        product.category !== 'non_sellable')
      .map(product => ({ id: product.id, name: product.name, code: `${product.sku || ''} ${product.productId || ''} ${product.genericName || ''}`, defaultCost: product.costPricePerPack || 0 }));
  const filteredProducts = availableProducts.filter(product =>
    `${product.name} ${product.code}`.toLowerCase().includes(productSearch.trim().toLowerCase()) &&
    !additions.some(addition => addition.productId === product.id)
  ).slice(0, 15);
  const selectedProduct = availableProducts.find(product => product.id === selectedProductId);
  const existingTotal = lines.reduce((sum, line) => {
    const edit = editedLines[line.id] || { qty: line.qty_ordered, removed: false };
    return sum + (edit.removed ? 0 : edit.qty * line.unit_cost_ugx);
  }, 0);
  const addedTotal = additions.reduce((sum, addition) => sum + addition.quantity * addition.unitCostUGX, 0);

  const handleAddProduct = () => {
    if (!selectedProduct || !selectedSupplierId || !additionReason.trim() ||
        !Number.isSafeInteger(additionQuantity) || additionQuantity <= 0 ||
        !Number.isSafeInteger(additionCost) || additionCost <= 0) {
      toast.error('Choose a master product and supplier, enter a positive quantity, quoted cost and reason.');
      return;
    }
    if (lines.some(line => line.product_id === selectedProductId)) {
      toast.error('This product already exists on the order. Edit its quantity instead.');
      return;
    }
    const supplier = eligibleSuppliers.find(item => item.id === selectedSupplierId);
    if (!supplier) {
      toast.error('Select an eligible supplier from the supplier registry.');
      return;
    }
    if (replacesLineId && additions.some(item => item.replacesLineId === replacesLineId)) {
      toast.error('That order line already has an assigned substitute.');
      return;
    }
    setAdditions(prev => [...prev, {
      productId: selectedProduct.id, quantity: additionQuantity,
      unitCostUGX: additionCost, supplierId: supplier.id,
      supplierName: supplier.supplier_name, replacesLineId: replacesLineId || undefined,
      reason: additionReason.trim()
    }]);
    if (replacesLineId) setEditedLines(prev => ({
      ...prev, [replacesLineId]: { qty: 0, removed: true }
    }));
    setSelectedProductId('');
    setProductSearch('');
    setAdditionQuantity(1);
    setAdditionCost(0);
    setAdditionReason('');
    setReplacesLineId('');
  };

  const handleConfirm = async () => {
    if (submitting || !canApprove || !profile?.tenantId || !profile.uid) return;
    if (loading || loadError || lines.length === 0) return;
    setSubmitting(true);
    try {
      const result = await confirmProcurementApproval({
        order, tenantId: profile.tenantId, actorId: profile.uid,
        edits: editedLines, additions
      });
      toast.success(`Approved UGX ${result.approvedTotalUGX.toLocaleString()} with ${result.addedCount} added and ${result.unsuppliedCount} unsupplied line(s).`);
      onApprove(order.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not finalize financial approval.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white text-zinc-900 rounded-2xl sm:rounded-[32px] w-full max-w-5xl max-h-[94dvh] overflow-hidden shadow-2xl flex flex-col">
        <div className="p-3 sm:p-6 border-b border-zinc-100 flex justify-between items-start gap-3 shrink-0">
          <div>
            <h2 className="text-lg sm:text-xl leading-tight font-bold text-zinc-900">Financial Approval — Review & Adjust</h2>
            <p className="text-sm text-zinc-500">{order.order_number} · Requested by: {originBranchName}</p>
            <p className="text-xs mt-1 text-emerald-700 font-semibold">{operational ? 'Operational Inventory' : 'Sellable Inventory'} · Original requisition remains in audit history</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close approval" className="p-2 shrink-0 text-zinc-700 rounded-lg hover:bg-zinc-100"><X size={20} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6">
          {loading ? (
            <p role="status" className="rounded-xl bg-zinc-100 p-4 text-sm text-zinc-700">Loading order products…</p>
          ) : loadError ? (
            <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
              Unable to retrieve this order's products. Close and reopen Financial Approval. Approval has been disabled to prevent an incomplete review.
            </p>
          ) : lines.length === 0 ? (
            <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
              No products awaiting financial approval were found. You cannot approve an order without reviewing its lines.
            </p>
          ) : (
            <section aria-label="Order products awaiting financial review" className="space-y-3 text-zinc-900">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm sm:text-base font-bold text-zinc-900">Products to review ({lines.length})</h3>
                <span className="text-xs text-zinc-600">Check each quantity and cost</span>
              </div>

              {/* On narrow screens each item is shown in full without horizontal scrolling. */}
              <div data-testid="financial-approval-mobile-products" className="grid gap-3 md:hidden">
                {lines.map(line => {
                  const edit = editedLines[line.id] || { qty: line.qty_ordered, removed: false };
                  const approvedQty = edit.removed ? 0 : edit.qty;
                  return (
                    <article key={line.id} className={cn('min-w-0 rounded-xl border p-3 space-y-3 text-zinc-900', edit.removed ? 'border-rose-300 bg-rose-50' : 'border-zinc-200 bg-white')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-zinc-950 break-words">{line.product_name || 'Unnamed order product'}</p>
                          <p className="mt-1 text-xs text-zinc-700 break-words">Supplier: {line.supplier_name || 'Not specified'}</p>
                        </div>
                        <span className={cn('shrink-0 rounded-md px-2 py-1 text-[11px] font-bold', edit.removed ? 'bg-rose-200 text-rose-900' : 'bg-emerald-50 text-emerald-800')}>
                          {edit.removed ? 'Removed' : 'Review'}
                        </span>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                        <div><dt className="text-xs text-zinc-600">Quoted unit cost</dt><dd className="font-semibold text-zinc-950">UGX {Number(line.unit_cost_ugx || 0).toLocaleString()}</dd></div>
                        <div><dt className="text-xs text-zinc-600">Requested quantity</dt><dd className="font-semibold text-zinc-950">{line.qty_ordered}</dd></div>
                        <div><dt className="text-xs text-zinc-600">Approved quantity</dt>
                          <dd className="mt-1"><input type="number" min="0" step="1" inputMode="numeric"
                            aria-label={`Approved quantity for ${line.product_name}`}
                            disabled={!canApprove || submitting || edit.removed}
                            className="w-full max-w-32 rounded-lg border border-zinc-400 bg-white px-2 py-2 text-sm font-semibold text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-600"
                            value={approvedQty}
                            onChange={event => setEditedLines(prev => ({ ...prev, [line.id]: { qty: Number(event.target.value), removed: false } }))}/>
                          </dd>
                        </div>
                        <div><dt className="text-xs text-zinc-600">Approved line total</dt><dd className="mt-2 font-bold text-zinc-950">UGX {(approvedQty * Number(line.unit_cost_ugx || 0)).toLocaleString()}</dd></div>
                      </dl>
                      <button type="button" disabled={!canApprove || submitting}
                        onClick={() => setEditedLines(prev => ({
                          ...prev, [line.id]: { qty: edit.removed ? line.qty_ordered : 0, removed: !edit.removed }
                        }))}
                        className={cn('w-full rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50', edit.removed ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-rose-300 bg-rose-50 text-rose-800')}>
                        {edit.removed ? 'Restore product' : 'Remove product'}
                      </button>
                    </article>
                  );
                })}
              </div>

              {/* Desktop table retains all fields with explicit foreground colors. */}
              <div data-testid="financial-approval-desktop-products" className="hidden md:block overflow-x-auto rounded-xl border border-zinc-200">
                <table className="w-full min-w-[740px] text-left text-zinc-900">
                  <thead className="bg-zinc-100 text-xs font-semibold uppercase text-zinc-700">
                    <tr><th className="p-3">Product</th><th className="p-3">Supplier</th><th className="p-3">Unit cost</th><th className="p-3">Requested</th><th className="p-3">Approved</th><th className="p-3">Line total</th><th className="p-3">Action</th></tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 bg-white text-zinc-900">
                    {lines.map(line => {
                      const edit = editedLines[line.id] || { qty: line.qty_ordered, removed: false };
                      const approvedQty = edit.removed ? 0 : edit.qty;
                      return <tr key={line.id} className={edit.removed ? 'bg-rose-50' : 'bg-white'}>
                        <td className="p-3 text-sm font-bold text-zinc-950 break-words">{line.product_name || 'Unnamed order product'}</td>
                        <td className="p-3 text-sm text-zinc-800">{line.supplier_name || 'Not specified'}</td>
                        <td className="p-3 text-sm text-zinc-900">UGX {Number(line.unit_cost_ugx || 0).toLocaleString()}</td>
                        <td className="p-3 text-sm text-zinc-900">{line.qty_ordered}</td>
                        <td className="p-3"><input type="number" min="0" step="1" inputMode="numeric"
                          aria-label={`Approved quantity for ${line.product_name}`}
                          disabled={!canApprove || submitting || edit.removed}
                          className="w-20 rounded-lg border border-zinc-400 bg-white p-2 text-sm font-semibold text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-600"
                          value={approvedQty}
                          onChange={event => setEditedLines(prev => ({ ...prev, [line.id]: { qty: Number(event.target.value), removed: false } }))}/></td>
                        <td className="p-3 text-sm font-semibold text-zinc-950">UGX {(approvedQty * Number(line.unit_cost_ugx || 0)).toLocaleString()}</td>
                        <td className="p-3"><button type="button" disabled={!canApprove || submitting}
                          onClick={() => setEditedLines(prev => ({ ...prev, [line.id]: { qty: edit.removed ? line.qty_ordered : 0, removed: !edit.removed } }))}
                          className={cn('rounded-lg px-3 py-2 text-xs font-semibold', edit.removed ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-800')}>
                          {edit.removed ? 'Restore' : 'Remove'}
                        </button></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="rounded-2xl border border-emerald-200 bg-white p-3 sm:p-5 space-y-4 text-zinc-900">
            <div>
              <h3 className="font-bold text-emerald-950">Add product or substitute</h3>
              <p className="text-xs text-zinc-600 mt-1">Search the {operational ? 'Operational Inventory master-linked location register' : 'Inventory Product Master'}. The new line is added to this order only after approval.</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-600 mb-1">Search products</label>
              <input type="search" value={productSearch} disabled={!canApprove || submitting}
                onChange={event => {setProductSearch(event.target.value);setSelectedProductId('');}}
                placeholder="Name, SKU, generic name or product ID"
                className="w-full border border-zinc-300 bg-white text-zinc-950 rounded-xl px-3 py-2 text-sm"/>
              {productSearch.trim() && <div className="mt-1 max-h-40 overflow-y-auto border border-zinc-200 rounded-xl">
                {filteredProducts.map(product => <button type="button" key={product.id}
                  onClick={() => {setSelectedProductId(product.id);setProductSearch(product.name);setAdditionCost(product.defaultCost);}}
                  className="w-full text-left px-3 py-2 text-sm text-zinc-950 bg-white hover:bg-emerald-50 border-b border-zinc-100 last:border-0">
                  <strong>{product.name}</strong> <span className="text-zinc-500">{product.code}</span>
                </button>)}
                {filteredProducts.length === 0 && <p className="px-3 py-2 text-xs text-zinc-500">No matching product in this inventory class.</p>}
              </div>}
              {selectedProduct && <p className="text-xs text-emerald-700 mt-1 font-bold">Selected: {selectedProduct.name}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs font-bold text-zinc-600">Supplier
                <select value={selectedSupplierId} onChange={event => setSelectedSupplierId(event.target.value)}
                  disabled={!canApprove || submitting}
                  className="mt-1 w-full min-w-0 border border-zinc-300 bg-white text-zinc-950 rounded-xl p-2 text-sm font-normal">
                  <option value="">Select registered supplier</option>
                  {eligibleSuppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.supplier_name}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-zinc-600">Quantity (packs)
                <input type="number" min="1" step="1" value={additionQuantity}
                  disabled={!canApprove || submitting}
                  onChange={event => setAdditionQuantity(Number(event.target.value))}
                  className="mt-1 w-full min-w-0 border border-zinc-300 bg-white text-zinc-950 rounded-xl p-2 text-sm font-normal"/>
              </label>
              <label className="text-xs font-bold text-zinc-600">Quoted unit cost (UGX)
                <input type="number" min="1" step="1" value={additionCost}
                  disabled={!canApprove || submitting}
                  onChange={event => setAdditionCost(Number(event.target.value))}
                  className="mt-1 w-full min-w-0 border border-zinc-300 bg-white text-zinc-950 rounded-xl p-2 text-sm font-normal"/>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-bold text-zinc-600">Replaces existing product (optional)
                <select value={replacesLineId} disabled={!canApprove || submitting}
                  onChange={event => setReplacesLineId(event.target.value)}
                  className="mt-1 w-full min-w-0 border border-zinc-300 bg-white text-zinc-950 rounded-xl p-2 text-sm font-normal">
                  <option value="">Additional product, not a substitution</option>
                  {lines.map(line => <option key={line.id} value={line.id}>{line.product_name}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-zinc-600">Reason for addition / substitution
                <input value={additionReason} disabled={!canApprove || submitting}
                  onChange={event => setAdditionReason(event.target.value)}
                  placeholder="E.g. Requested item unavailable; authorized alternative"
                  className="mt-1 w-full min-w-0 border border-zinc-300 bg-white text-zinc-950 rounded-xl p-2 text-sm font-normal"/>
              </label>
            </div>
            <button type="button" onClick={handleAddProduct} disabled={!canApprove || submitting}
              className="rounded-xl px-4 py-2 bg-emerald-700 text-white text-sm font-semibold disabled:opacity-40">
              + Add selected product
            </button>
            {additions.length > 0 && <div className="space-y-2">
              <p className="text-sm font-bold">Products to add on approval</p>
              {additions.map((addition, index) => <div key={addition.productId} className="rounded-xl border border-zinc-200 bg-white p-3 flex flex-wrap items-center justify-between gap-2 text-zinc-950">
                <div>
                  <p className="text-sm font-semibold">{availableProducts.find(product => product.id === addition.productId)?.name || addition.productId} · {addition.quantity} pack(s)</p>
                  <p className="text-xs text-zinc-500">UGX {(addition.quantity * addition.unitCostUGX).toLocaleString()} · {addition.reason}{addition.replacesLineId ? ' · Substitute' : ''}</p>
                </div>
                <button type="button" disabled={!canApprove || submitting}
                  onClick={() => {
                    setAdditions(prev => prev.filter((_, i) => i !== index));
                    if (addition.replacesLineId) setEditedLines(prev => ({
                      ...prev, [addition.replacesLineId!]: { qty: lines.find(line => line.id === addition.replacesLineId)?.qty_ordered || 0, removed: false }
                    }));
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50">Remove addition</button>
              </div>)}
            </div>}
          </section>
        </div>
        <div className="shrink-0 border-t border-zinc-200 bg-zinc-50 px-3 py-3 sm:px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 text-zinc-900">
          <div>
            <p className="text-xs text-zinc-500">Approved line total (including new products)</p>
            <p className="text-xl font-black text-zinc-900">UGX {(existingTotal + addedTotal).toLocaleString()}</p>
            <p className="text-[11px] text-zinc-500">Other previously approved internal lines remain unchanged and are included in final validation.</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <button type="button" onClick={onClose} disabled={submitting}
              className="flex-1 sm:flex-none border border-zinc-400 bg-white text-zinc-900 font-semibold rounded-xl px-4 py-2 text-sm">Cancel</button>
            <button type="button" onClick={handleConfirm} disabled={submitting || loading || loadError || !canApprove || lines.length === 0}
              className="flex-1 sm:flex-none bg-emerald-600 text-white font-bold rounded-xl px-5 py-2 text-sm disabled:opacity-40">
              {submitting ? 'Approving…' : 'Approve final order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


const GRNTab: React.FC = () => {
  const { profile } = useAuth();
  const operationalInventoryEnabled = useOperationalInventoryFeature();
  const [grns, setGrns] = useState<GRNRecord[]>([]);
  const [approvedOrders, setApprovedOrders] = useState<StockOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<StockOrder | null>(null);
  const [isProcessModalOpen, setIsProcessModalOpen] = useState(false);
  const [isManualGRNModalOpen, setIsManualGRNModalOpen] = useState(false);
  const [selectedGRN, setSelectedGRN] = useState<GRNRecord | null>(null);
  const [operationalGRNItems, setOperationalGRNItems] = useState<GRNRecord['items']>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [grnDateRange, setGrnDateRange] = useState({ start: '', end: '' });

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubscribeGrns = firestoreService.subscribeToCollection<GRNRecord>('grn_records', profile.tenantId, (data) => {
        setGrns(data.filter(grn => operationalInventoryEnabled || !isOperationalInventoryRecord(grn))
          .sort((a, b) => (grnReceivedDateKey(b.receivedAt) || '').localeCompare(grnReceivedDateKey(a.receivedAt) || '')));
      });
      const unsubscribeOrders = firestoreService.subscribeToCollection<StockOrder>('stock_orders', profile.tenantId, (data) => {
        setApprovedOrders(data.filter(o => o.status === 'approved' && (operationalInventoryEnabled || !isOperationalInventoryRecord(o))));
      });
      const unsubscribeProducts = firestoreService.subscribeToCollection<Product>('products', profile.tenantId, setProducts);
      return () => {
        unsubscribeGrns();
        unsubscribeOrders();
        unsubscribeProducts();
      };
    }
  }, [profile?.tenantId, operationalInventoryEnabled]);

  useEffect(() => {
    if (!operationalInventoryEnabled) {
      if (selectedOrder && isOperationalInventoryRecord(selectedOrder)) setSelectedOrder(null);
      if (selectedGRN && isOperationalInventoryRecord(selectedGRN)) setSelectedGRN(null);
      setIsProcessModalOpen(false);
      setIsManualGRNModalOpen(false);
    }
  }, [operationalInventoryEnabled, selectedOrder, selectedGRN]);

  useEffect(() => {
    if (!selectedGRN || !isOperationalInventoryRecord(selectedGRN) || !profile?.tenantId) {
      setOperationalGRNItems([]);
      return;
    }
    let cancelled = false;
    fetchOperationalGrnLines(profile.tenantId, selectedGRN.id).then(lines => {
      if (cancelled) return;
      setOperationalGRNItems(lines);
    }).catch(error => {
      console.error('Failed to load Operational GRN lines', error);
      if (!cancelled) setOperationalGRNItems(selectedGRN.items || []);
    });
    return () => { cancelled = true; };
  }, [selectedGRN, profile?.tenantId]);

  const getProductCustomId = (id: string) => {
    const prod = products.find(p => p.id === id || p.productId === id);
    return prod ? prod.productId : id;
  };

  const handleDownloadGRN = async (grn: GRNRecord) => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "GOODS RECEIVED NOTE (GRN) HISTORY AND TRANSACTION STATEMENT\n\n";
    csvContent += `GRN/Ref Number,${grn.grn_number}\n`;
    csvContent += `Inventory Class,${isOperationalInventoryRecord(grn) ? 'Operational Inventory' : 'Sellable Inventory'}\n`;
    csvContent += `Origin (Source),${grn.supplier_name || 'N/A'}\n`;
    csvContent += `Destination,${grn.destination_store_id === 'HQ_OPERATIONAL' ? 'HQ Operational Store' : 'HQ Central Store / Main Depot'}\n`;
    csvContent += `Prepared/Sent By,Supplier Dispatch\n`;
    csvContent += `Prepared/Sent At,${grn.invoice_date || grn.receivedAt || 'N/A'}\n`;
    csvContent += `Received/Verified By,${grn.receivedBy || 'Staff Pharmacist'}\n`;
    csvContent += `Received/Verified At,${grn.receivedAt || 'N/A'}\n`;
    csvContent += `Tax Deductions,WHT (UGX ${grn.whtAmount || 0}) / Input VAT (UGX ${grn.inputVat || 0})\n`;
    csvContent += `Payment Status,${grn.payment_status || 'verified'}\n`;
    csvContent += `Total Value,UGX ${grn.total_value_ugx || 0}\n\n`;
    csvContent += "Product ID,Product Name,Expected/Ordered Qty,Received Qty,Unit Cost Price (UGX),Line Total Value (UGX),Batch Number,Expiry Date\n";
    
    const fetchedOperationalItems = isOperationalInventoryRecord(grn) && profile?.tenantId
      ? await fetchOperationalGrnLines(profile.tenantId, grn.id)
      : [];
    const items = isOperationalInventoryRecord(grn)
      ? (fetchedOperationalItems.length ? fetchedOperationalItems : operationalGRNItems.length ? operationalGRNItems : (grn.items || []))
      : (grn.items || []);
    items.forEach(item => {
      const row = [
        getProductCustomId(item.product_id),
        `"${(item.product_name || '').replace(/"/g, '""')}"`,
        item.qty_ordered || 0,
        item.qty_received || 0,
        item.unit_cost_ugx || 0,
        (item.qty_received || 0) * (item.unit_cost_ugx || 0),
        item.batch_number || 'N/A',
        item.expiry_date || 'N/A'
      ].join(",");
      csvContent += row + "\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `GRN_${grn.grn_number}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadAggregateGRN = () => {
    if (filtered.length === 0) {
      toast.error("No GRN records found in the filtered list.");
      return;
    }

    const headers = ['GRN ID', 'Supplier', 'Branch', 'Amount (UGX)', 'Cash/Credit', 'Received Date', 'Invoice Number'];
    const rows: any[][] = [];

    filtered.forEach(g => {
      rows.push([
        g.grn_number,
        g.supplier_name || 'N/A',
        'HQ Store',
        g.total_value_ugx || 0,
        g.payment_type ? g.payment_type.toUpperCase() : 'CREDIT',
        grnReceivedDateKey(g.receivedAt) || '-',
        g.invoice_number || 'N/A'
      ]);
    });

    const BOM = "\uFEFF";
    const csvContent = BOM + [headers.join(','), ...rows.map(e => e.map(val => `"${(val ?? '').toString().replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Central_GRN_Aggregate_Report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Aggregate GRN report downloaded successfully.");
  };

  const filtered = grns.filter(g => {
    const q = searchTerm.toLowerCase().trim();
    const matchesSearch = !q || 
      g.grn_number.toLowerCase().includes(q) ||
      (g.supplier_name || '').toLowerCase().includes(q) ||
      (g.invoice_number || '').toLowerCase().includes(q) ||
      'hq store'.includes(q) ||
      'central store'.includes(q) ||
      'main store'.includes(q);

    const grnDate = grnReceivedDateKey(g.receivedAt);
    const matchesStart = !grnDateRange.start || grnDate >= grnDateRange.start;
    const matchesEnd = !grnDateRange.end || grnDate <= grnDateRange.end;

    return matchesSearch && matchesStart && matchesEnd;
  });
  const displayedGRNItems = selectedGRN && isOperationalInventoryRecord(selectedGRN)
    ? (operationalGRNItems.length ? operationalGRNItems : (selectedGRN.items || []))
    : (selectedGRN?.items || []);

  return (
    <div className="space-y-6">
      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 mb-6">
        <h3 className="text-lg font-bold text-emerald-900 mb-4 flex items-center gap-2">
          <Clock size={20} />
          Approved Orders Awaiting GRN
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {approvedOrders.map(order => (
            <div key={order.id} className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm flex justify-between items-center">
              <div>
                <p className="font-bold text-zinc-900">{order.order_number}</p>
                <p className="text-xs text-zinc-500">{order.requesting_branch_name}</p>
                {isOperationalInventoryRecord(order) && <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">Operational Inventory</p>}
              </div>
              <div className="flex gap-2">
                {!isOperationalInventoryRecord(order) && <button
                  onClick={async () => {
                    if (window.confirm(`Are you sure you want to revert order ${order.order_number || ''} back to the Financial Approval tab?`)) {
                      try {
                        await firestoreService.updateDocument('stock_orders', order.id, {
                          status: 'awaiting_finance_approval',
                          updatedAt: new Date().toISOString()
                        });
                        const lines = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: order.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
                        for (const line of lines) {
                          await firestoreService.updateDocument('stock_order_lines', line.id, {
                            line_status: 'awaiting_finance_approval',
                            updatedAt: new Date().toISOString()
                          });
                        }
                        toast.success('Order reverted to Financial Approval.');
                      } catch (error) {
                        console.error(error);
                        toast.error('Failed to revert order.');
                      }
                    }
                  }}
                  className="border border-zinc-200 text-zinc-500 hover:bg-zinc-50 px-2 py-1.5 rounded-lg text-xs font-bold transition-all"
                >
                  Revert
                </button>}
                <button 
                  onClick={() => {
                    setSelectedOrder(order);
                    setIsProcessModalOpen(true);
                  }}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                >
                  Process GRN
                </button>
              </div>
            </div>
          ))}
          {approvedOrders.length === 0 && (
            <p className="text-sm text-emerald-600 italic">No approved orders awaiting GRN.</p>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-50 p-4 rounded-2xl border border-zinc-200">
        <div className="flex flex-col md:flex-row md:items-center gap-4 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
            <input 
              type="text"
              placeholder="Search GRNs by branch, supplier, ID..."
              className="w-full pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs font-bold text-zinc-800"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-2 bg-white border border-zinc-200 px-3 py-1.5 rounded-xl shadow-sm">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Date range:</span>
            <input 
              type="date" 
              value={grnDateRange.start} 
              onChange={(e) => setGrnDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="bg-transparent border-none text-xs outline-none focus:ring-0 text-zinc-700 w-[110px]"
            />
            <span className="text-xs font-bold text-zinc-400">to</span>
            <input 
              type="date" 
              value={grnDateRange.end} 
              onChange={(e) => setGrnDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="bg-transparent border-none text-xs outline-none focus:ring-0 text-zinc-700 w-[110px]"
            />
            {(grnDateRange.start || grnDateRange.end) && (
              <button 
                onClick={() => setGrnDateRange({ start: '', end: '' })} 
                className="text-zinc-400 hover:text-zinc-700 font-bold text-xs px-1"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={handleDownloadAggregateGRN}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all"
            title="Download Aggregated Excel Report"
          >
            <Download size={14} />
            Download Aggregate
          </button>
          <button 
            onClick={() => setIsManualGRNModalOpen(true)}
            className="bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all"
          >
            <Plus size={14} />
            Record Manual GRN
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">GRN #</th>
                <th className="px-6 py-4">Inventory Class</th>
                <th className="px-6 py-4">Supplier</th>
                <th className="px-6 py-4">Value</th>
                <th className="px-6 py-4">VAT</th>
                <th className="px-6 py-4">WHT</th>
                <th className="px-6 py-4">Payment</th>
                <th className="px-6 py-4">Received At</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((grn) => (
                <tr key={grn.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-zinc-900">{grn.grn_number}</td>
                  <td className="px-6 py-4"><span className={cn('px-2 py-1 rounded-full text-[10px] font-black uppercase', isOperationalInventoryRecord(grn) ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-600')}>{isOperationalInventoryRecord(grn) ? 'Operational' : 'Sellable'}</span></td>
                  <td className="px-6 py-4 text-sm text-zinc-600">{grn.supplier_name}</td>
                  <td className="px-6 py-4 text-sm font-bold text-zinc-900">UGX {grn.total_value_ugx.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-emerald-600 font-medium">UGX {(grn.inputVat || 0).toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-amber-600 font-medium">UGX {(grn.whtAmount || 0).toLocaleString()}</td>
                  <td className="px-6 py-4">
                    {isOperationalInventoryRecord(grn) ? <span className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700">Finance event ready</span> : <span className={cn(
                      "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                      grn.payment_type === 'credit' ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
                    )}>
                      {grn.payment_type}
                    </span>}
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-500">{new Date(grn.receivedAt).toLocaleString()}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 text-xs font-bold font-sans">
                      <button 
                        onClick={() => setSelectedGRN(grn)}
                        className="px-3 py-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <Eye size={12} />
                        View
                      </button>
                      <button 
                        onClick={() => handleDownloadGRN(grn)}
                        className="px-3 py-1 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 rounded-lg transition-colors flex items-center gap-1"
                        title="Download CSV"
                      >
                        <Download size={12} />
                        CSV
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-zinc-400 italic">
                    No GRN records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedGRN && (
        <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white text-zinc-900 rounded-[2rem] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-zinc-200 font-sans leading-normal">
            {/* Header */}
            <div className="p-6 bg-zinc-50 border-b border-zinc-100 flex justify-between items-center">
              <div>
                <span className="text-xs uppercase font-black tracking-widest text-emerald-600 font-mono">Operations Audit Registry</span>
                <h2 className="text-xl font-bold text-zinc-900 mt-0.5">{isOperationalInventoryRecord(selectedGRN) ? 'Operational Goods Received Note' : 'Goods Received Note'} #{selectedGRN.grn_number}</h2>
              </div>
              <button 
                onClick={() => setSelectedGRN(null)} 
                className="text-zinc-600 hover:text-zinc-600 transition-colors p-2 hover:bg-zinc-100 rounded-full"
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6">
              {/* Meta information layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-zinc-50 p-6 rounded-[20px] border border-zinc-200 text-xs">
                <div className="space-y-2">
                  <div>
                    <span className="text-xs font-bold text-zinc-600 uppercase tracking-wider block">Source of Origin (Where it came from)</span>
                    <span className="font-bold text-zinc-800 text-sm mt-0.5 block">{selectedGRN.supplier_name || 'Registry Supplier'}</span>
                  </div>
                  <div className="pt-2 border-t border-zinc-200">
                    <span className="text-xs font-bold text-zinc-600 uppercase tracking-wider block">Sent/Prepared By & When</span>
                    <span className="font-semibold text-zinc-700 mt-0.5 block">Supplier Dispatch Officers</span>
                    <span className="text-zinc-500 font-mono text-xs block">{selectedGRN.invoice_date ? new Date(selectedGRN.invoice_date).toLocaleString() : 'N/A'}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <span className="text-xs font-bold text-zinc-600 uppercase tracking-wider block">Destination (Where arrived)</span>
                    <span className="font-bold text-zinc-800 text-sm mt-0.5 block">{selectedGRN.destination_store_id === 'HQ_OPERATIONAL' ? 'HQ Operational Store' : 'HQ Central Store / Main Depot'}</span>
                  </div>
                  <div className="pt-2 border-t border-zinc-200">
                    <span className="text-xs font-bold text-zinc-600 uppercase tracking-wider block">Received/Verified By & When</span>
                    <span className="font-semibold text-zinc-700 mt-0.5 block">{selectedGRN.receivedBy || 'Staff Pharmacist'}</span>
                    <span className="text-zinc-500 font-mono text-xs block">{new Date(selectedGRN.receivedAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Items details table */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase text-zinc-600 tracking-wider font-mono">Product Line Items</h4>
                <div className="border border-zinc-200 rounded-[20px] overflow-x-auto bg-white text-zinc-900 shadow-sm">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-100 font-bold text-zinc-500 uppercase tracking-wider">
                        <th className="px-4 py-3">Product Name</th>
                        <th className="px-4 py-3 text-center">Ordered Qty</th>
                        <th className="px-4 py-3 text-center">Received Qty</th>
                        <th className="px-4 py-3 text-right">Cost Price</th>
                        {!isOperationalInventoryRecord(selectedGRN) && <th className="px-4 py-3 text-center">Batch Number</th>}
                        {!isOperationalInventoryRecord(selectedGRN) && <th className="px-4 py-3 text-center">Expiry Date</th>}
                        <th className="px-4 py-3 text-right text-zinc-800">Total Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 font-medium">
                      {displayedGRNItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-zinc-50/20 text-zinc-700">
                          <td className="px-4 py-3 font-bold text-zinc-900 break-words">{item.product_name}</td>
                          <td className="px-4 py-3 text-center font-mono text-zinc-500">{item.qty_ordered || 0}</td>
                          <td className="px-4 py-3 text-center font-mono font-bold text-emerald-600">{item.qty_received || 0}</td>
                          <td className="px-4 py-3 text-right font-mono">UGX {(item.unit_cost_ugx || 0).toLocaleString()}</td>
                          {!isOperationalInventoryRecord(selectedGRN) && <td className="px-4 py-3 text-center font-mono font-semibold text-zinc-700">{item.batch_number || 'N/A'}</td>}
                          {!isOperationalInventoryRecord(selectedGRN) && <td className="px-4 py-3 text-center font-mono text-zinc-500">{item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : 'N/A'}</td>}
                          <td className="px-4 py-3 text-right font-mono font-bold text-zinc-900">
                            UGX {((item.qty_received || 0) * (item.unit_cost_ugx || 0)).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedGRN.notes && (
                <div className="p-4 bg-zinc-50 rounded-xl text-xs border border-zinc-200">
                  <span className="font-extrabold uppercase text-zinc-600 select-none block font-mono">Operational logs / Notes</span>
                  <p className="mt-1 text-zinc-700 italic">{selectedGRN.notes}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 bg-zinc-50 border-t border-zinc-100 flex justify-between items-center">
              <span className="text-xs text-zinc-600 font-semibold uppercase tracking-widest font-mono">
                Verification state: {selectedGRN.status.toUpperCase()}
              </span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedGRN(null)}
                  className="px-6 py-2 border border-zinc-200 hover:bg-zinc-100 rounded-xl font-bold text-zinc-600 text-xs uppercase tracking-wider transition-colors"
                >
                  Close View
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadGRN(selectedGRN)}
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

      {isProcessModalOpen && selectedOrder && (
        <GRNProcessModal 
          order={selectedOrder}
          onClose={() => setIsProcessModalOpen(false)}
        />
      )}

      {isManualGRNModalOpen && (
        <ManualGRNModal 
          onClose={() => setIsManualGRNModalOpen(false)}
        />
      )}
    </div>
  );
};

const ManualGRNModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { profile } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<InstitutionRegistry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('cash');
  const [items, setItems] = useState<any[]>([]);
  
  // Item Form
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState(0);
  const [costPrice, setCostPrice] = useState(0);
  const [batch, setBatch] = useState('');
  const [expiry, setExpiry] = useState('');

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Product>('products', profile.tenantId, setProducts);
      firestoreService.subscribeToCollection<InstitutionRegistry>('institutions', profile.tenantId, setSuppliers);
      firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, setBranches);
    }
  }, [profile?.tenantId]);

  const addItem = () => {
    const product = products.find(p => p.id === selectedProductId);
    if (!product || qty <= 0 || !batch || !expiry) {
      toast.error('Please fill all item details');
      return;
    }
    setItems([...items, {
      product_id: product.id,
      product_name: product.name,
      qty,
      unit_cost_ugx: costPrice || product.costPricePerPack,
      batch,
      expiry
    }]);
    // Reset item form
    setSelectedProductId('');
    setQty(0);
    setCostPrice(0);
    setBatch('');
    setExpiry('');
  };

  const handleSave = async () => {
    if (items.length === 0 || !selectedSupplierId || !selectedBranchId) {
      toast.error('Fill GRN header and add at least one item');
      return;
    }

    try {
      const grnNumber = `MGRN-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
      const supplier = suppliers.find(s => s.id === selectedSupplierId);
      const targetBranch = branches.find(b => b.id === selectedBranchId);
      
      const totalValue = items.reduce((sum, item) => sum + (item.qty * item.unit_cost_ugx), 0);

      const grnRecord: any = {
        tenantId: profile?.tenantId,
        grn_number: grnNumber,
        manual_ref: refNumber,
        supplier_id: selectedSupplierId,
        supplier_name: supplier?.supplier_name || 'Manual Supplier',
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        receivedAt: new Date().toISOString(),
        receivedBy: profile?.uid,
        status: 'completed',
        payment_type: paymentType,
        total_value_ugx: totalValue,
        items
      };

      const grnId = await firestoreService.addDocument('grn_records', grnRecord);

      // Write corresponding document to 'invoices' collection
      const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const seq = Math.floor(1000 + Math.random() * 9000);
      const invoiceRef = `INV-${todayStr}-${seq}`;

      const invoiceId = await firestoreService.addDocument('invoices', {
        tenantId: profile?.tenantId,
        invoiceRef,
        grnId: grnId,
        branchId: selectedBranchId,
        branchName: targetBranch?.branch_name || 'Branch Store',
        supplierId: selectedSupplierId,
        supplierName: supplier?.supplier_name || 'Manual Supplier',
        invoiceValue: totalValue,
        paymentStatus: paymentType, // 'cash' | 'credit'
        creditBalance: paymentType === 'credit' ? totalValue : 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      if (paymentType === 'credit') {
        await firestoreService.addDocument('creditLedger', {
          tenantId: profile?.tenantId,
          invoiceId,
          invoiceRef,
          supplierId: selectedSupplierId,
          supplierName: supplier?.supplier_name || 'Manual Supplier',
          branchId: selectedBranchId,
          branchName: targetBranch?.branch_name || 'Branch Store',
          originalCreditAmount: totalValue,
          remainingCreditBalance: totalValue,
          status: 'outstanding',
          creditAccruedAt: new Date().toISOString(),
          lastProcessedAt: null,
          createdAt: new Date().toISOString()
        });
      }

      // Add to Procurement Invoices Ledger for Finance Module
      await firestoreService.addDocument('procurement_invoices', {
        tenantId: profile?.tenantId,
        branch_id: selectedBranchId,
        branch_name: targetBranch?.branch_name || 'Branch Store',
        supplier_id: selectedSupplierId,
        supplier_name: supplier?.supplier_name || 'Manual Supplier',
        invoice_number: invoiceNumber || grnNumber,
        grn_number: grnNumber,
        invoice_date: invoiceDate,
        due_date: new Date(new Date(invoiceDate).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        amount: totalValue,
        total_amount_ugx: totalValue,
        paid_amount_ugx: paymentType === 'cash' ? totalValue : 0,
        status: paymentType === 'cash' ? 'Paid' : 'Credit',
        created_at: new Date().toISOString()
      });

      if (paymentType === 'cash') {
        // Log in Petty Cash Ledger (Outgoing) for cash stock purchase
        await firestoreService.addDocument('petty_cash_ledger', {
          tenantId: profile?.tenantId,
          date: new Date().toISOString(),
          amount: totalValue,
          source: 'Petty Cash Reserve',
          reference_number: invoiceNumber || grnNumber,
          type: 'outgoing',
          branch_id: selectedBranchId,
          logged_by: profile?.uid || 'SYSTEM',
          notes: `Cash stock purchase (Manual) - GRN ${grnNumber} - Supplier: ${supplier?.supplier_name || 'Manual Supplier'}`,
          created_at: new Date().toISOString()
        });
      }

      // Inventory Update logic...
      for (const item of items) {
        const product = products.find(p => p.id === item.product_id);
        const unitsPerPack = product?.unitsPerPack || 1;
        const totalUnits = item.qty * unitsPerPack;

        // Add batch
        await firestoreService.addDocument('product_batches', {
          tenantId: profile?.tenantId,
          branchId: selectedBranchId,
          productId: item.product_id,
          batchNumber: item.batch,
          expiryDate: item.expiry,
          quantity: totalUnits,
          purchasePrice: item.unit_cost_ugx / unitsPerPack,
          sellingPrice: product?.sellingPricePerUnit || (item.unit_cost_ugx / unitsPerPack * 1.3),
          batch_status: 'active',
          supplier: supplier?.supplier_name,
          supplierId: selectedSupplierId,
          lastUpdated: new Date().toISOString(),
          createdAt: new Date().toISOString()
        });

        // Update product stock
        if (product) {
          await firestoreService.updateDocument('products', product.id, {
            quantityInStock: (product.quantityInStock || 0) + totalUnits,
            updatedAt: new Date().toISOString()
          });
        }

        // Movement
        await firestoreService.addDocument('inventory_movements', {
          tenantId: profile?.tenantId,
          branchId: selectedBranchId,
          productId: item.product_id,
          productName: item.product_name,
          batchNumber: item.batch,
          amount: totalUnits,
          type: 'in',
          movementClass: 'received',
          class: 'received',
          reference: grnNumber,
          initiator: profile?.displayName || profile?.full_name || 'System',
          initiatorId: profile?.uid || 'SYSTEM',
          receiver: targetBranch?.name || 'Manual Branch',
          receiverId: selectedBranchId,
          timestamp: new Date().toISOString(),
          amountAttached: item.qty * item.unit_cost_ugx
        });
      }

      toast.success('Manual GRN recorded and inventory updated');
      onClose();
    } catch (error: any) {
      console.error('Manual GRN Process Error:', error);
      toast.error('Failed to save manual GRN: ' + (error?.message || 'Unknown error'));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-[32px] w-full max-w-6xl max-h-[95vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-zinc-900">Record Manual GRN</h2>
            <p className="text-sm text-zinc-500">Record off-system stock fulfillment</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Target Branch</label>
              <select 
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl"
              >
                <option value="">Select Branch</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Supplier</label>
              <select 
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl"
              >
                <option value="">Select Supplier</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Manual Ref / Order #</label>
              <input 
                type="text"
                value={refNumber}
                onChange={(e) => setRefNumber(e.target.value)}
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl"
                placeholder="e.g. M-ORD-123"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Invoice #</label>
              <input 
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl"
              />
            </div>
          </div>

          <div className="p-4 bg-emerald-50 rounded-2xl space-y-4 border border-emerald-100">
            <h4 className="font-bold text-emerald-900 text-sm uppercase tracking-wider">Add Product</h4>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="lg:col-span-2">
                <select 
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-emerald-200 rounded-xl text-sm"
                >
                  <option value="">Select Product...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <input 
                type="number" placeholder="Qty"
                value={qty || ''} onChange={(e) => setQty(Number(e.target.value))}
                className="px-4 py-2 bg-white border border-emerald-200 rounded-xl text-sm"
              />
              <input 
                type="text" placeholder="Batch"
                value={batch} onChange={(e) => setBatch(e.target.value)}
                className="px-4 py-2 bg-white border border-emerald-200 rounded-xl text-sm"
              />
              <input 
                type="date"
                value={expiry} onChange={(e) => setExpiry(e.target.value)}
                className="px-4 py-2 bg-white border border-emerald-200 rounded-xl text-sm"
              />
              <button onClick={addItem} className="bg-emerald-600 text-white font-bold rounded-xl text-sm hover:bg-emerald-700">Add</button>
            </div>
          </div>

          <div className="border border-zinc-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr className="text-[10px] font-black text-zinc-400 uppercase">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3">Expiry</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {items.map((item, idx) => (
                  <tr key={idx} className="text-sm">
                    <td className="px-4 py-3 font-bold">{item.product_name}</td>
                    <td className="px-4 py-3">{item.qty}</td>
                    <td className="px-4 py-3 text-xs">{item.batch}</td>
                    <td className="px-4 py-3 text-xs">{item.expiry}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-red-500 hover:bg-red-50 p-1 rounded">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-400 italic">No items added yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-6 border-t border-zinc-100 flex items-center justify-between bg-zinc-50">
          <div className="text-sm">
            <span className="text-zinc-500">Items: </span>
            <span className="font-bold text-zinc-900">{items.length}</span>
          </div>
          <button 
            onClick={handleSave}
            disabled={items.length === 0}
            className="bg-zinc-900 text-white px-8 py-3 rounded-2xl font-bold hover:bg-zinc-800 disabled:opacity-50"
          >
            Finalize Manual GRN
          </button>
        </div>
      </div>
    </div>
  );
};

const GRNProcessModal: React.FC<{ order: StockOrder, onClose: () => void }> = ({ order, onClose }) => {
  const { profile } = useAuth();
  const isOperationalOrder = isOperationalInventoryRecord(order);
  const [lines, setLines] = useState<StockOrderLine[]>([]);
  const [editedLines, setEditedLines] = useState<Record<string, { qty: number, removed: boolean, batch: string, expiry: string, unitCostUGX?: number }>>({});
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('cash');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [inputVat, setInputVat] = useState<number>(0);
  const [whtAmount, setWhtAmount] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchLines = async () => {
      const data = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: order.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
      const approvedLines = data.filter(l => l.line_status === 'approved' && (!isOperationalOrder || l.supplier_type === 'external'));
      if (isOperationalOrder && approvedLines.some(line => line.inventoryClass !== 'OPERATIONAL' && !line.isOperational)) {
        toast.error('This order contains a non-Operational line and cannot be received as an Operational GRN.');
        return;
      }
      setLines(approvedLines);
      
      const initialEdits: Record<string, { qty: number, removed: boolean, batch: string, expiry: string, unitCostUGX?: number }> = {};
      
      for (const l of approvedLines) {
        let batch = '';
        let expiry = '';
        
        // Auto-fill for HQ items
        if (!isOperationalOrder && (l.supplier_type === 'internal_hq' || l.supplier_type === 'internal_warehouse')) {
          const hqBatches = await firestoreService.getDocumentsByQuery<ProductBatch>('product_batches', [
            { field: 'tenantId', operator: '==', value: profile?.tenantId },
            { field: 'productId', operator: '==', value: l.product_id },
            { field: 'branchId', operator: '==', value: 'HQ' }
          ]);
          if (hqBatches.length > 0) {
            batch = hqBatches[0].batchNumber;
            expiry = hqBatches[0].expiryDate;
          }
        }
        
        const outstanding = Math.max(0, Number(l.qty_ordered || 0) - Number(l.qty_received || 0));
        initialEdits[l.id] = { qty: isOperationalOrder ? outstanding : l.qty_ordered, removed: false, batch, expiry, unitCostUGX: Number(l.unit_cost_ugx || 0) };
      }
      setEditedLines(initialEdits);
    };
    fetchLines();
  }, [order.id, profile?.tenantId, isOperationalOrder]);

  const handleQtyChange = (id: string, qty: number) => {
    setEditedLines(prev => ({
      ...prev,
      [id]: { ...prev[id], qty: Math.max(0, qty) }
    }));
  };

  const handleFieldChange = (id: string, field: 'batch' | 'expiry', value: string) => {
    setEditedLines(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));
  };

  const handleToggleRemove = (id: string) => {
    setEditedLines(prev => ({
      ...prev,
      [id]: { ...prev[id], removed: !prev[id].removed }
    }));
  };

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const tenantId = profile?.tenantId;
      if (!tenantId) throw new Error("Missing tenantId");
      const user = {
        uid: profile?.uid || 'SYSTEM',
        name: profile?.fullName || profile?.displayName || profile?.email || 'Unknown'
      };
      if (isOperationalOrder) {
        const result = await processOperationalGrn({
          tenantId, order, lines, editedLines, invoiceNumber, invoiceDate, paymentType, inputVat, whtAmount, notes, user
        });
        toast.success(result.alreadyProcessed
          ? 'This Operational GRN was already completed. No duplicate stock was added.'
          : `Operational GRN ${result.grnNumber} received into the HQ Operational Store. Cash/Credit invoice and Finance event recorded. Branch dispatch remains a separate step.`);
        onClose();
        return;
      }
      const result = await processProcurementGrn({
        tenantId,
        order,
        lines,
        editedLines,
        paymentType,
        invoiceNumber,
        invoiceDate,
        inputVat,
        whtAmount,
        notes,
        user
      });

      toast.success(result.alreadyProcessed
        ? 'This GRN was already completed. No duplicate records were created.'
        : 'GRN, Finance posting, and branch dispatch completed successfully.');
      onClose();
    } catch (error: any) {
      console.error('GRN Process Error:', error);
      toast.error('Failed to process GRN: ' + (error?.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[32px] w-full max-w-6xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-zinc-900">{isOperationalOrder ? 'Operational Inventory GRN' : 'Process GRN'}</h2>
            <p className="text-sm text-zinc-500">{order.order_number} - {order.requesting_branch_name}</p>
            {isOperationalOrder && <p className="mt-2 text-xs font-bold uppercase tracking-wide text-emerald-700">Operational receipt → HQ Operational Store</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        
        <div className="p-8 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Invoice Number</label>
              <input 
                type="text"
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                placeholder="Required supplier invoice reference"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Invoice Date</label>
              <input 
                type="date"
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Payment Type</label>
              <div className="flex gap-4">
                <button 
                  onClick={() => setPaymentType('cash')}
                  className={cn("flex-1 py-3 rounded-2xl font-bold border transition-all", paymentType === 'cash' ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-500 border-zinc-200")}
                >
                  Cash
                </button>
                <button 
                  onClick={() => setPaymentType('credit')}
                  className={cn("flex-1 py-3 rounded-2xl font-bold border transition-all", paymentType === 'credit' ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-500 border-zinc-200")}
                >
                  Credit
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Input VAT (UGX)</label>
              <input 
                type="number"
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500/20"
                value={inputVat}
                onChange={(e) => setInputVat(Number(e.target.value))}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">WHT Amount (UGX)</label>
              <input 
                type="number"
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500/20"
                value={whtAmount}
                onChange={(e) => setWhtAmount(Number(e.target.value))}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Notes</label>
              <textarea 
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500/20 h-[52px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any GRN notes..."
              />
            </div>
          </div>

          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Qty</th>
                {!isOperationalOrder && <th className="px-4 py-3">Batch #</th>}
                {!isOperationalOrder && <th className="px-4 py-3">Expiry</th>}
                {isOperationalOrder && <th className="px-4 py-3">Unit cost (UGX)</th>}
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {lines.map((line) => {
                const edit = editedLines[line.id] || { qty: line.qty_ordered, removed: false, batch: '', expiry: '' };
                return (
                  <tr key={line.id} className={cn(edit.removed && "opacity-50 bg-red-50/30")}>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-zinc-900">{line.product_name}</p>
                      <p className="text-[10px] text-zinc-500 uppercase font-bold">{line.supplier_name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <input 
                        type="number"
                        min="0"
                        disabled={edit.removed}
                        className="w-20 px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-lg text-sm"
                        value={edit.qty}
                        onChange={(e) => handleQtyChange(line.id, Number(e.target.value))}
                      />
                    </td>
                    {!isOperationalOrder && <td className="px-4 py-3">
                      <input 
                        type="text"
                        disabled={edit.removed}
                        className="w-32 px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-lg text-sm"
                        value={edit.batch}
                        onChange={(e) => handleFieldChange(line.id, 'batch', e.target.value)}
                        placeholder="Batch #"
                      />
                    </td>}
                    {!isOperationalOrder && <td className="px-4 py-3">
                      <input 
                        type="date"
                        disabled={edit.removed}
                        className="w-36 px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-lg text-sm"
                        value={edit.expiry}
                        onChange={(e) => handleFieldChange(line.id, 'expiry', e.target.value)}
                      />
                    </td>}
                    {isOperationalOrder && <td className="px-4 py-3"><input type="number" min="0" disabled={edit.removed} className="w-32 px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-lg text-sm" value={edit.unitCostUGX ?? line.unit_cost_ugx} onChange={e => setEditedLines(prev => ({ ...prev, [line.id]: { ...prev[line.id], unitCostUGX: Number(e.target.value) } }))} /></td>}
                    <td className="px-4 py-3 text-sm font-bold text-zinc-900">
                      UGX {(edit.qty * (isOperationalOrder ? (edit.unitCostUGX ?? line.unit_cost_ugx) : line.unit_cost_ugx)).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button 
                        onClick={() => handleToggleRemove(line.id)}
                        className={cn("p-2 rounded-lg transition-colors", edit.removed ? "text-emerald-500 hover:bg-emerald-50" : "text-red-500 hover:bg-red-50")}
                      >
                        {edit.removed ? <Plus size={18} /> : <Trash2 size={18} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        <div className="p-8 bg-zinc-50 border-t border-zinc-100 flex justify-between items-center">
          <div className="text-zinc-600">
            Total GRN Value: <span className="text-xl font-bold text-zinc-900 ml-2">
              UGX {lines.reduce((sum, l) => {
                const edit = editedLines[l.id] || { qty: l.qty_ordered, removed: false };
                return sum + (edit.removed ? 0 : edit.qty * (isOperationalOrder ? (edit.unitCostUGX ?? l.unit_cost_ugx) : l.unit_cost_ugx));
              }, 0).toLocaleString()}
            </span>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={onClose} 
              disabled={submitting}
              className="px-6 py-2 text-zinc-500 font-bold hover:bg-zinc-100 rounded-xl transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button 
              onClick={handleConfirm} 
              disabled={submitting}
              className="px-6 py-2 bg-zinc-900 text-white font-bold hover:bg-zinc-800 rounded-xl transition-all disabled:bg-zinc-300 disabled:opacity-50"
            >
              {submitting ? 'Completing...' : 'Complete GRN'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const DispatchTab: React.FC = () => {
  const { profile, hasPermission } = useAuth();
  const canDispatch = hasPermission('procurement', 'operate');
  const operationalInventoryEnabled = useOperationalInventoryFeature();
  const [approvedOrders, setApprovedOrders] = useState<StockOrder[]>([]);
  const [preparedSellableOrders, setPreparedSellableOrders] = useState<StockOrder[]>([]);
  const [dispatchingPreparedId, setDispatchingPreparedId] = useState<string | null>(null);
  const [operationalOrders, setOperationalOrders] = useState<StockOrder[]>([]);
  const [dispatchHistory, setDispatchHistory] = useState<StockOrder[]>([]);
  const [showDispatchHistory, setShowDispatchHistory] = useState(false);
  const [pendingOperationalTransfers, setPendingOperationalTransfers] = useState<OperationalTransfer[]>([]);
  const [dispatchingOperationalOrderId, setDispatchingOperationalOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<StockOrder | null>(null);
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [detailsOrder, setDetailsOrder] = useState<StockOrder | null>(null);

  useEffect(() => {
    if (!profile?.tenantId) {
      setPendingOperationalTransfers([]);
      return;
    }
    const unsubscribeOrders = firestoreService.subscribeToCollection<StockOrder>('stock_orders', profile.tenantId, (data) => {
      setPreparedSellableOrders(data.filter(o =>
        o.status === 'ready_for_dispatch' &&
        Boolean((o as any).grn_id && (o as any).transfer_id) &&
        !isOperationalInventoryRecord(o)
      ));
      setApprovedOrders(data.filter(o =>
        o.status === 'fully_received' &&
        !(o as any).transfer_id &&
        o.requesting_branch_id !== 'HQ' &&
        !isOperationalInventoryRecord(o)
      ));
      setOperationalOrders(data.filter(order =>
        order.status === 'fully_received' &&
        order.requesting_branch_id !== 'HQ' &&
        isOperationalInventoryRecord(order) &&
        !(order as any).operational_external_transfer_id
      ));
      setDispatchHistory(data.filter(order =>
        ['dispatched', 'fully_accepted', 'closed', 'queried'].includes(order.status) &&
        order.requesting_branch_id !== 'HQ' &&
        (Boolean((order as any).transfer_id) || Boolean((order as any).operational_external_transfer_id) || Boolean((order as any).operational_transfer_id))
      ));
    });
    const unsubscribeTransfers = operationalInventoryEnabled
      ? firestoreService.subscribeToCollection<OperationalTransfer>('operational_transfers', profile.tenantId, transfers => {
          setPendingOperationalTransfers(transfers.filter(transfer => transfer.fulfillmentSource === 'HQ_OPERATIONAL' && ['draft', 'dispatching'].includes(transfer.status)));
        })
      : undefined;
    if (!operationalInventoryEnabled) setPendingOperationalTransfers([]);
    return () => {
      unsubscribeOrders();
      unsubscribeTransfers?.();
    };
  }, [profile?.tenantId, operationalInventoryEnabled]);

  useEffect(() => {
    if (!operationalInventoryEnabled && selectedOrder && isOperationalInventoryRecord(selectedOrder)) {
      setSelectedOrder(null);
      setIsDispatchModalOpen(false);
    }
  }, [operationalInventoryEnabled, selectedOrder]);

  const handlePreparedDispatch = async (order: StockOrder) => {
    if (!canDispatch) { toast.error('Functional Procurement permission is required for dispatch.'); return; }
    if (!profile?.tenantId || !profile.uid || dispatchingPreparedId) return;
    const grnId = (order as any).grn_id;
    const transferId = (order as any).transfer_id;
    if (!grnId || !transferId) {
      toast.error('Missing prepared GRN or transfer reference. Dispatch has been blocked.');
      return;
    }
    setDispatchingPreparedId(order.id);
    try {
      const result = await dispatchPreparedSellableGrn({
        tenantId: profile.tenantId, grnId, transferId, orderId: order.id,
        actor: { uid: profile.uid, name: profile.fullName || profile.displayName || profile.email || profile.uid }
      });
      toast.success(result.alreadyDispatched ? 'This GRN transfer was already dispatched.' : 'GRN transfer dispatched. The destination branch can now verify receipt.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not dispatch this prepared GRN.');
    } finally {
      setDispatchingPreparedId(null);
    }
  };

  const handleDispatch = async (order: StockOrder, lines: StockOrderLine[]) => {
    try {
      if (order.requesting_branch_id === 'HQ') {
        throw new Error('HQ replenishment orders cannot be dispatched back to HQ.');
      }
      // Fetch products to get unitsPerPack
      const productIds = Array.from(new Set(lines.map(l => l.product_id)));
      const productPromises = productIds.map(id => firestoreService.getDocument<Product>('products', id));
      const productResults = await Promise.all(productPromises);
      const productMap: Record<string, Product> = {};
      productResults.forEach(p => { if (p) productMap[p.id] = p; });

      // Create Transfer Invoice
      const transferInvoiceId = await firestoreService.addDocument('transfer_invoices', {
        tenantId: profile?.tenantId,
        inventoryClass: order.inventoryClass || 'SELLABLE',
        transfer_number: `TI-${Date.now()}`,
        source_branch_id: 'HQ', 
        source_branch_name: 'Central HQ',
        destination_branch_id: order.requesting_branch_id || 'UNKNOWN',
        destination_branch_name: order.requesting_branch_name || 'Branch',
        transfer_type: 'central_to_branch',
        status: 'dispatched',
        dispatched_at: new Date().toISOString(),
        dispatched_by: profile?.uid,
        total_value_ugx: order.total_order_value_ugx,
        order_id: order.id
      });

      // Create Transfer Invoice Lines and handle stock deduction
      for (const line of lines) {
        let batchNumber = 'BATCH-' + Math.random().toString(36).substring(7).toUpperCase();
        let expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const product = productMap[line.product_id];
        const unitsPerPack = product?.unitsPerPack || 1;

        // If internal supplier, deduct from HQ stock
        if (line.supplier_type === 'internal_hq' || line.supplier_type === 'internal_warehouse') {
           const hqBatches = await firestoreService.getDocumentsByQuery<ProductBatch>('product_batches', [
            { field: 'tenantId', operator: '==', value: profile?.tenantId },
            { field: 'productId', operator: '==', value: line.product_id },
            { field: 'branchId', operator: '==', value: 'HQ' }
          ]);

          if (hqBatches.length > 0) {
            const batch = hqBatches[0];
            batchNumber = batch.batchNumber;
            expiryDate = batch.expiryDate;
            
            const totalUnitsToDeduct = line.qty_ordered * unitsPerPack;
            const newQty = Math.max(0, batch.quantity - totalUnitsToDeduct);
            await firestoreService.updateDocument('product_batches', batch.id, {
              quantity: newQty
            });
          }
        }

        await firestoreService.addDocument('transfer_invoice_lines', {
          tenantId: profile?.tenantId,
          inventoryClass: line.inventoryClass || order.inventoryClass || 'SELLABLE',
          transfer_id: transferInvoiceId,
          product_id: line.product_id,
          product_name: line.product_name || 'Unknown Product',
          qty_dispatched: line.qty_ordered, // This is in packs
          qty_received: 0,
          qty_queried: 0,
          batch_number: batchNumber,
          expiry_date: expiryDate,
          unit_cost_ugx: line.unit_cost_ugx || 0,
          total_cost_ugx: (line.unit_cost_ugx || 0) * line.qty_ordered
        });
      }

      // Update Order Status
      await firestoreService.updateDocument('stock_orders', order.id, {
        status: 'dispatched',
        dispatched_at: new Date().toISOString()
      });

      toast.success('Order dispatched and stock updated successfully. It is now available in the branch Stock In section.');
      setIsDispatchModalOpen(false);
    } catch (error) {
      toast.error('Failed to dispatch order');
    }
  };

  const handleOperationalDispatch = async (order: StockOrder) => {
    if (!canDispatch) { toast.error('Functional Procurement permission is required for dispatch.'); return; }
    if (!profile?.tenantId || !profile.uid || dispatchingOperationalOrderId) return;
    setDispatchingOperationalOrderId(order.id);
    try {
      const result = await dispatchOperationalOrderToBranch({
        tenantId: profile.tenantId,
        order,
        destinationBranchName: order.requesting_branch_name || order.requesting_branch_id,
        actor: { uid: profile.uid, name: profile.fullName || profile.displayName || profile.email || profile.uid }
      });
      toast.success(result.alreadyDispatched
        ? `Operational transfer ${result.transferNumber} was already dispatched. No duplicate stock movement was posted.`
        : `Operational transfer ${result.transferNumber} dispatched to ${order.requesting_branch_name || order.requesting_branch_id}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to dispatch Operational Inventory.');
    } finally {
      setDispatchingOperationalOrderId(null);
    }
  };

  const handleResumeOperationalTransfer = async (transfer: OperationalTransfer) => {
    if (!profile?.tenantId || !profile.uid || dispatchingOperationalOrderId) return;
    setDispatchingOperationalOrderId(transfer.id);
    try {
      const result = await dispatchPreparedOperationalHqTransfer({
        tenantId: profile.tenantId, transferId: transfer.id,
        actor: { uid: profile.uid, name: profile.fullName || profile.displayName || profile.email || profile.uid }
      });
      toast.success(result.alreadyDispatched ? `${transfer.transferNumber} was already dispatched.` : `${transfer.transferNumber} dispatch resumed and completed.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not resume the Operational transfer.');
    } finally {
      setDispatchingOperationalOrderId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
        <div className="flex flex-wrap justify-between items-center gap-3 px-5 py-4 border-b">
          <div><h3 className="font-black text-zinc-900">HQ Dispatch Register</h3><p className="text-xs text-zinc-500">Sellable and Operational orders share this register, but retain separate stock ledgers and dispatch processors.</p></div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowDispatchHistory(false)} className={`px-3 py-2 rounded-lg text-xs font-bold ${!showDispatchHistory ? 'bg-zinc-900 text-white' : 'bg-zinc-100'}`}>Pending Dispatch</button>
            <button type="button" onClick={() => setShowDispatchHistory(true)} className={`px-3 py-2 rounded-lg text-xs font-bold ${showDispatchHistory ? 'bg-zinc-900 text-white' : 'bg-zinc-100'}`}>Dispatch History</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[740px]">
            <thead className="bg-zinc-50 text-zinc-500 uppercase text-[11px]"><tr><th className="p-3">Order Reference</th><th className="p-3">Inventory Type</th><th className="p-3">Destination Branch</th><th className="p-3">Order Value</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {(showDispatchHistory ? dispatchHistory : [...preparedSellableOrders, ...operationalOrders, ...approvedOrders]).map(order => {
                const operational = isOperationalInventoryRecord(order);
                const preparedSellable = preparedSellableOrders.some(row => row.id === order.id);
                return <tr key={order.id}>
                  <td className="p-3"><button type="button" onClick={() => setDetailsOrder(order)} className="text-emerald-800 underline font-bold">{order.order_number || order.id}</button></td>
                  <td className="p-3">{operational ? 'Operational' : 'Sellable'}</td>
                  <td className="p-3">{order.requesting_branch_name || order.requesting_branch_id}</td>
                  <td className="p-3">{Number(order.total_order_value_ugx || 0).toLocaleString()} UGX</td>
                  <td className="p-3 capitalize">{showDispatchHistory ? order.status.replace(/_/g, ' ') : 'Ready for dispatch'}</td>
                  <td className="p-3">
                    {showDispatchHistory ? <button type="button" className="text-emerald-800 underline" onClick={() => setDetailsOrder(order)}>View Details</button>
                      : operational ? <button type="button" onClick={() => handleOperationalDispatch(order)} disabled={!canDispatch || dispatchingOperationalOrderId !== null} className="px-3 py-2 rounded-lg bg-emerald-700 text-white font-semibold disabled:opacity-40">{dispatchingOperationalOrderId === order.id ? 'Dispatching…' : 'Dispatch Operational'}</button>
                      : preparedSellable ? <button type="button" onClick={() => handlePreparedDispatch(order)} disabled={!canDispatch || dispatchingPreparedId !== null} className="px-3 py-2 rounded-lg bg-blue-700 text-white font-semibold disabled:opacity-40">{dispatchingPreparedId === order.id ? 'Dispatching…' : 'Confirm Dispatch'}</button>
                      : <button type="button" onClick={() => {setSelectedOrder(order);setIsDispatchModalOpen(true);}} disabled={!canDispatch} className="px-3 py-2 rounded-lg bg-blue-700 text-white font-semibold disabled:opacity-40">Review Dispatch</button>}
                  </td>
                </tr>;
              })}
              {!showDispatchHistory && pendingOperationalTransfers.map(transfer => <tr key={transfer.id}>
                <td className="p-3 font-bold">{transfer.sourceOrderNumber || transfer.transferNumber}</td>
                <td className="p-3">Operational</td><td className="p-3">{transfer.destinationBranchName || transfer.destinationBranchId}</td>
                <td className="p-3">{Number(transfer.totalValueUGX || 0).toLocaleString()} UGX</td>
                <td className="p-3">Staged / awaiting dispatch</td>
                <td className="p-3"><button type="button" disabled={!canDispatch || dispatchingOperationalOrderId !== null} onClick={() => handleResumeOperationalTransfer(transfer)} className="px-3 py-2 rounded-lg bg-amber-700 text-white disabled:opacity-40">Resume Staged Transfer</button></td>
              </tr>)}
              {(showDispatchHistory ? dispatchHistory.length === 0 : (preparedSellableOrders.length + operationalOrders.length + approvedOrders.length + pendingOperationalTransfers.length === 0)) && <tr><td colSpan={6} className="text-zinc-500 p-8 text-center">{showDispatchHistory ? 'No linked dispatch history found.' : 'No orders ready for dispatch.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {detailsOrder && <DispatchOrderDetails order={detailsOrder} onClose={() => setDetailsOrder(null)} />}
      {isDispatchModalOpen && selectedOrder && (
        <DispatchModal 
          order={selectedOrder}
          onClose={() => setIsDispatchModalOpen(false)}
          onConfirm={handleDispatch}
        />
      )}
      </div>
    </div>
  );
};

const DispatchOrderDetails: React.FC<{ order: StockOrder; onClose: () => void }> = ({ order, onClose }) => {
  const [lines, setLines] = useState<StockOrderLine[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [
      { field: 'tenantId', operator: '==', value: order.tenantId },
      { field: 'order_id', operator: '==', value: order.id }
    ]).then(rows => { if (active) setLines(rows); })
      .catch(() => toast.error('Unable to load the order item details.'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [order.id, order.tenantId]);
  return <div className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center">
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6 space-y-4">
      <div className="flex justify-between gap-4">
        <div><h3 className="text-xl font-bold">{order.order_number}</h3>
          <p className="text-sm text-zinc-500">{isOperationalInventoryRecord(order) ? 'Operational' : 'Sellable'} Inventory • {order.requesting_branch_name || order.requesting_branch_id} • {order.status}</p></div>
        <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border">Close</button>
      </div>
      {loading ? <p>Loading item details…</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Item</th><th className="p-2">Ordered</th><th className="p-2">Received</th><th className="p-2">Batch</th><th className="p-2">Expiry</th></tr></thead>
        <tbody>{lines.map(line => <tr key={line.id} className="border-b"><td className="p-2">{line.product_name || line.product_id}</td><td className="p-2">{line.qty_ordered}</td><td className="p-2">{line.qty_received ?? '—'}</td><td className="p-2">{(line as StockOrderLine & { batch_number?: string }).batch_number || '—'}</td><td className="p-2">{(line as StockOrderLine & { expiry_date?: string }).expiry_date || '—'}</td></tr>)}</tbody>
      </table>{lines.length === 0 && <p className="p-3 text-zinc-500">No linked order lines found.</p>}</div>}
    </div>
  </div>;
};

const DispatchModal: React.FC<{ 
  order: StockOrder, 
  onClose: () => void,
  onConfirm: (order: StockOrder, lines: StockOrderLine[]) => Promise<void>
}> = ({ order, onClose, onConfirm }) => {
  const [lines, setLines] = useState<StockOrderLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchLines = async () => {
      try {
        const data = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: order.id }, { field: 'tenantId', operator: '==', value: order.tenantId }]);
        setLines(data);
      } catch (error) {
        toast.error('Failed to fetch order items');
      } finally {
        setLoading(false);
      }
    };
    fetchLines();
  }, [order.id]);

  const handleConfirmClick = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(order, lines);
    } catch {
      // Errors handled inside onConfirm
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[32px] w-full max-w-4xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-zinc-900">Dispatch Order: {order.order_number}</h2>
          <button onClick={onClose} disabled={submitting} className="p-2 hover:bg-zinc-100 rounded-full transition-colors disabled:opacity-50">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        
        <div className="p-8 overflow-y-auto flex-1 space-y-6">
          <div className="grid grid-cols-2 gap-4 p-4 bg-zinc-50 rounded-2xl">
            <div>
              <p className="text-xs font-bold text-zinc-500 uppercase">Destination</p>
              <p className="font-bold text-zinc-900">{order.requesting_branch_name || order.requesting_branch_id}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-500 uppercase">Category</p>
              <p className="font-bold text-zinc-900 capitalize">{order.category.replace(/_/g, ' ')}</p>
            </div>
          </div>

          <div className="border border-zinc-100 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider bg-zinc-50 border-b border-zinc-100">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {lines.map(line => (
                  <tr key={line.id}>
                    <td className="px-4 py-3 text-sm font-medium text-zinc-900">{line.product_name || line.product_id}</td>
                    <td className="px-4 py-3 text-sm text-right text-zinc-600 font-bold">{line.qty_ordered}</td>
                    <td className="px-4 py-3 text-sm text-right text-zinc-600">UGX {line.unit_cost_ugx?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-8 border-t border-zinc-100 bg-zinc-50/50 flex gap-3">
          <button 
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-3 text-zinc-500 font-bold hover:bg-zinc-50 rounded-2xl transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button 
            type="button"
            onClick={handleConfirmClick}
            disabled={loading || lines.length === 0 || submitting}
            className="flex-1 py-3 bg-blue-500 text-white rounded-2xl font-bold hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 disabled:bg-zinc-350 disabled:shadow-none"
          >
            {submitting ? 'Dispatching...' : 'Confirm Dispatch'}
          </button>
        </div>
      </div>
    </div>
  );
};

const UnsuppliedTab: React.FC = () => {
  const { profile } = useAuth();
  const [unsupplied, setUnsupplied] = useState<UnsuppliedLine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (profile?.tenantId) {
      return firestoreService.subscribeToCollectionByQuery<UnsuppliedLine>('unsupplied_lines', profile.tenantId, [
        where('status', '==', 'pending')
      ], (data) => {
        setUnsupplied(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      });
    }
  }, [profile?.tenantId]);

  const handleDefer = async (item: UnsuppliedLine) => {
    const reason = window.prompt('Reason for deferral:');
    if (reason === null) return;
    
    try {
      await firestoreService.updateDocument('unsupplied_lines', item.id, {
        status: 'deferred',
        deferred_reason: reason
      });
      toast.success('Item deferred');
    } catch (error) {
      toast.error('Failed to defer item');
    }
  };

  const handleReorder = async (item: UnsuppliedLine) => {
    try {
      if (item.original_line_id) {
        await firestoreService.updateDocument('stock_order_lines', item.original_line_id, {
          line_status: 'pending',
          qty_ordered: item.qty_unsupplied
        });
      }
      
      await firestoreService.updateDocument('unsupplied_lines', item.id, {
        status: 're-ordered'
      });
      
      toast.success('Item sent back to sourcing');
    } catch (error) {
      toast.error('Failed to re-order item');
    }
  };

  const handleDownload = () => {
    toast.info('Downloading unsupplied items list...');
    // Mock download logic
  };

  const handleCancel = async (item: UnsuppliedLine) => {
    if (window.confirm('Are you sure you want to cancel this item? It will be marked as cancelled.')) {
      try {
        await firestoreService.updateDocument('unsupplied_lines', item.id, {
          status: 'cancelled'
        });
        toast.success('Item cancelled');
      } catch (error) {
        toast.error('Failed to cancel item');
      }
    }
  };

  const filtered = unsupplied.filter(u => 
    u.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.reason.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input 
            type="text"
            placeholder="Search unsupplied items..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button 
          onClick={handleDownload}
          className="bg-zinc-100 text-zinc-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-zinc-200 transition-all flex items-center gap-2"
        >
          <Download size={18} />
          Download List
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Product</th>
                <th className="px-6 py-4">Qty</th>
                <th className="px-6 py-4">Reason</th>
                <th className="px-6 py-4">Flagged At</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-bold text-zinc-900">{item.product_name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{item.order_id}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-900 font-bold">{item.qty_unsupplied}</td>
                  <td className="px-6 py-4 text-sm text-zinc-600">{item.reason}</td>
                  <td className="px-6 py-4 text-sm text-zinc-500">{new Date(item.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => handleDefer(item)}
                        className="bg-amber-50 text-amber-600 px-3 py-1 rounded-lg text-xs font-bold hover:bg-amber-100 transition-colors"
                      >
                        Defer
                      </button>
                      <button 
                        onClick={() => handleReorder(item)}
                        className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-lg text-xs font-bold hover:bg-emerald-100 transition-colors"
                      >
                        Re-order
                      </button>
                      <button 
                        onClick={() => handleCancel(item)}
                        className="bg-rose-50 text-rose-600 px-3 py-1 rounded-lg text-xs font-bold hover:bg-rose-100 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                    No unsupplied items found.
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

const DeferredTab: React.FC = () => {
  const { profile } = useAuth();
  const [deferred, setDeferred] = useState<UnsuppliedLine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (profile?.tenantId) {
      return firestoreService.subscribeToCollectionByQuery<UnsuppliedLine>('unsupplied_lines', profile.tenantId, [
        where('status', '==', 'deferred')
      ], (data) => {
        setDeferred(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      });
    }
  }, [profile?.tenantId]);

  const handleReactivate = async (item: UnsuppliedLine) => {
    try {
      await firestoreService.updateDocument('unsupplied_lines', item.id, {
        status: 'pending'
      });
      toast.success('Item moved back to unsupplied');
    } catch (error) {
      toast.error('Failed to reactivate item');
    }
  };

  const handleCancel = async (item: UnsuppliedLine) => {
    if (window.confirm('Are you sure you want to cancel this item?')) {
      try {
        await firestoreService.updateDocument('unsupplied_lines', item.id, {
          status: 'cancelled'
        });
        toast.success('Item cancelled');
      } catch (error) {
        toast.error('Failed to cancel item');
      }
    }
  };

  const handleReorder = async (item: UnsuppliedLine) => {
    try {
      if (item.original_line_id) {
        await firestoreService.updateDocument('stock_order_lines', item.original_line_id, {
          line_status: 'pending',
          qty_ordered: item.qty_unsupplied
        });
      }
      
      await firestoreService.updateDocument('unsupplied_lines', item.id, {
        status: 're-ordered'
      });
      
      toast.success('Item sent back to sourcing');
    } catch (error) {
      toast.error('Failed to re-order item');
    }
  };

  const filtered = deferred.filter(u => 
    u.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.deferred_reason || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input 
            type="text"
            placeholder="Search deferred items..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Product</th>
                <th className="px-6 py-4">Qty</th>
                <th className="px-6 py-4">Deferral Reason</th>
                <th className="px-6 py-4">Deferred At</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-bold text-zinc-900">{item.product_name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{item.order_id}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-900 font-bold">{item.qty_unsupplied}</td>
                  <td className="px-6 py-4 text-sm text-zinc-600">{item.deferred_reason}</td>
                  <td className="px-6 py-4 text-sm text-zinc-500">{new Date(item.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => handleReactivate(item)}
                        className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-lg text-xs font-bold hover:bg-emerald-100 transition-colors"
                      >
                        Reactivate
                      </button>
                      <button 
                        onClick={() => handleReorder(item)}
                        className="bg-blue-50 text-blue-600 px-3 py-1 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors"
                      >
                        Re-order
                      </button>
                      <button 
                        onClick={() => handleCancel(item)}
                        className="bg-rose-50 text-rose-600 px-3 py-1 rounded-lg text-xs font-bold hover:bg-rose-100 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                    No deferred items found.
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

const SupplierRegistryTab: React.FC = () => {
  const { profile, hasPermission } = useAuth();
  const canMaintainSupplier = hasPermission('procurement', 'operate');
  const [suppliers, setSuppliers] = useState<InstitutionRegistry[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<InstitutionRegistry | null>(null);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<InstitutionRegistry>('supplier_registry', profile.tenantId, setSuppliers);
    }
  }, [profile?.tenantId]);

  const filtered = suppliers.filter(s => 
    (s.supplier_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.supplier_id || '').toLowerCase().includes(searchTerm.toLowerCase())
  );


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input 
            type="text" 
            placeholder="Search suppliers..." 
            className="w-full pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button 
          onClick={() => {
            setEditingSupplier(null);
            setIsModalOpen(true);
          }}
          disabled={!canMaintainSupplier}
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <Plus size={20} />
          Add Supplier
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Supplier Name</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">NDA Licence</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-bold text-zinc-900">{supplier.supplier_name}</p>
                    <p className="break-all font-mono text-[10px] text-zinc-500">{supplier.supplier_id}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-600">
                    <div>{supplier.commercial_category}</div>
                    {supplier.inventoryCapabilities?.length ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {supplier.inventoryCapabilities.map(capability => (
                          <span key={capability} className="px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded text-[9px] font-bold uppercase">{capability.replace(/_/g, ' ')}</span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                      supplier.nda_licence_status === 'valid' ? "bg-emerald-50 text-emerald-600" : 
                      supplier.nda_licence_status === 'expiring_soon' ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"
                    )}>
                      {(supplier.nda_licence_status || 'Not recorded').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {supplier.is_suspended ? (
                      <span className="px-2 py-1 bg-red-500 text-white rounded-md text-[10px] font-bold uppercase tracking-wider">Suspended</span>
                    ) : (
                      <span className="px-2 py-1 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-bold uppercase tracking-wider">Active</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => {
                          setEditingSupplier(supplier);
                          setIsModalOpen(true);
                        }}
                        aria-label={`Edit supplier ${supplier.supplier_name}`}
                        disabled={!canMaintainSupplier}
                        className="text-zinc-400 hover:text-emerald-500 p-1 disabled:opacity-50"
                      >
                        <Edit2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                    No suppliers found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <SupplierEditor
          sourceModule="procurement"
          onClose={() => setIsModalOpen(false)}
          supplier={editingSupplier}
        />
      )}
    </div>
  );
};


// ==========================================
// 1. HQ STORE INVENTORY TAB (REPLICA)
// ==========================================
const HQStoreInventoryTab: React.FC = () => {
  const { profile } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<ProductBatch | null>(null);
  const [adjustmentQty, setAdjustmentQty] = useState<number>(0);
  
  const [isAddBatchModalOpen, setIsAddBatchModalOpen] = useState(false);
  const [newBatchData, setNewBatchData] = useState({
    productId: '',
    batchNumber: '',
    expiryDate: '',
    quantity: 0,
    purchasePrice: 0,
    sellingPrice: 0
  });

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubProducts = firestoreService.subscribeToCollection<Product>('products', profile.tenantId, setProducts);
      const unsubBatches = firestoreService.subscribeToCollectionByQuery<ProductBatch>(
        'product_batches',
        profile.tenantId,
        [where('branchId', '==', 'HQ')],
        setBatches
      );
      return () => {
        unsubProducts();
        unsubBatches();
      };
    }
  }, [profile?.tenantId]);

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatch) return;
    try {
      await firestoreService.updateDocument('product_batches', selectedBatch.id, {
        quantity: adjustmentQty,
        lastUpdated: new Date().toISOString()
      });
      toast.success('Stock quantity adjusted successfully.');
      setIsAdjustModalOpen(false);
      setSelectedBatch(null);
    } catch (err) {
      toast.error('Failed to adjust quantity.');
    }
  };

  const handleAddBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBatchData.productId || !newBatchData.batchNumber || newBatchData.quantity < 0) {
      toast.error('Please fill in all required fields.');
      return;
    }
    try {
      await firestoreService.addDocument('product_batches', {
        tenantId: profile?.tenantId,
        branchId: 'HQ',
        productId: newBatchData.productId,
        batchNumber: newBatchData.batchNumber.toUpperCase().trim(),
        expiryDate: newBatchData.expiryDate || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0],
        quantity: Number(newBatchData.quantity),
        purchasePrice: Number(newBatchData.purchasePrice),
        sellingPrice: Number(newBatchData.sellingPrice) || Number(newBatchData.purchasePrice) * 1.3,
        batch_status: 'active',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      });
      toast.success('Successfully added batch to central store.');
      setIsAddBatchModalOpen(false);
      setNewBatchData({
        productId: '',
        batchNumber: '',
        expiryDate: '',
        quantity: 0,
        purchasePrice: 0,
        sellingPrice: 0
      });
    } catch (err) {
      toast.error('Failed to record batch.');
    }
  };

  const productStockStats = React.useMemo(() => {
    const stats: Record<string, { totalQty: number; count: number; nearExpiry: boolean }> = {};
    batches.forEach(b => {
      if (!stats[b.productId]) {
        stats[b.productId] = { totalQty: 0, count: 0, nearExpiry: false };
      }
      stats[b.productId].totalQty += b.quantity;
      stats[b.productId].count += 1;
      
      if (b.expiryDate) {
        const timeDiff = new Date(b.expiryDate).getTime() - Date.now();
        const daysDiff = timeDiff / (1000 * 3600 * 24);
        if (daysDiff >= 0 && daysDiff <= 90) {
          stats[b.productId].nearExpiry = true;
        }
      }
    });
    return stats;
  }, [batches]);

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (p.sku || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input 
            type="text" 
            placeholder="Search HQ Store items by name or SKU..."
            className="w-full pl-10 pr-4 py-2 border border-zinc-200 bg-white rounded-xl shadow-sm outline-none focus:ring-2 focus:ring-emerald-500/20 font-medium"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button 
          onClick={() => setIsAddBatchModalOpen(true)}
          className="px-5 py-2.5 bg-zinc-900 text-white font-bold text-sm rounded-xl flex items-center gap-2 hover:bg-zinc-800 transition-all shadow-sm"
        >
          <Plus size={18} />
          Add Direct Batch to HQ Store
        </button>
      </div>

      <div className="bg-white rounded-[2rem] border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-zinc-950">HQ Central Store Stock Matrix</h2>
            <p className="text-xs text-zinc-400 font-medium font-sans mt-0.5">Isolated from Kampala branch other branch local operations.</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/20">
                <th className="px-6 py-4">Item Name</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Total Qty (Packs)</th>
                <th className="px-6 py-4">Batches Count</th>
                <th className="px-6 py-4">Status / Alert</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 font-sans">
              {filteredProducts.map(p => {
                const stats = productStockStats[p.id] || { totalQty: 0, count: 0, nearExpiry: false };
                const isExpanded = expandedProduct === p.id;
                const productBatches = batches.filter(b => b.productId === p.id);

                return (
                  <React.Fragment key={p.id}>
                    <tr className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-zinc-900">{p.name}</span>
                          <span className="text-xs text-zinc-400 font-mono mt-0.5">SKU: {p.sku || 'N/A'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-600 font-medium capitalize">
                        {p.category || 'General'}
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-zinc-900">
                        {stats.totalQty} Packs
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-zinc-600">
                        {stats.count} batch(es)
                      </td>
                      <td className="px-6 py-4">
                        {stats.totalQty === 0 ? (
                          <span className="px-2 py-1 bg-rose-50 text-rose-600 rounded-md text-[10px] font-bold uppercase tracking-wider">Out of Stock</span>
                        ) : stats.nearExpiry ? (
                          <span className="px-2 py-1 bg-amber-50 text-amber-600 rounded-md text-[10px] font-bold uppercase tracking-wider">Expiry Alert (90d)</span>
                        ) : (
                          <span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-md text-[10px] font-bold uppercase tracking-wider">Good</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => setExpandedProduct(isExpanded ? null : p.id)}
                          className="px-3 py-1.5 bg-zinc-100 font-bold hover:bg-zinc-200 text-zinc-800 rounded-xl text-xs transition-colors"
                        >
                          {isExpanded ? 'Hide Batches' : 'View Batches'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="px-8 py-4 bg-zinc-50/40 border-y border-zinc-100">
                          <div className="space-y-3">
                            <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-2">Active Store Batches for {p.name}</h4>
                            {productBatches.length === 0 ? (
                              <p className="text-xs text-zinc-400 italic">No batches currently stored at HQ.</p>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {productBatches.map(b => (
                                  <div key={b.id} className="p-4 bg-white rounded-2xl border border-zinc-200 hover:border-zinc-300 transition-all flex flex-col gap-2 relative shadow-sm">
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Batch Number</p>
                                        <p className="text-sm font-bold text-zinc-950 font-mono mt-0.5">{b.batchNumber}</p>
                                      </div>
                                      <span className={cn(
                                        "px-2.5 py-0.5 text-[10px] font-extrabold rounded-full",
                                        b.quantity > 0 ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-800"
                                      )}>
                                        Qty: {b.quantity}
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500 font-medium">
                                      <div>
                                        <span className="text-[10px] text-zinc-400 block uppercase">Expiry Date</span>
                                        <span className="text-zinc-800 font-semibold">{b.expiryDate}</span>
                                      </div>
                                      <div>
                                        <span className="text-[10px] text-zinc-400 block uppercase">Cost Price</span>
                                        <span className="text-zinc-800 font-semibold">UGX {(b.purchasePrice || 0).toLocaleString()}</span>
                                      </div>
                                    </div>
                                    <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100 mt-2">
                                      <button 
                                        onClick={() => {
                                          setSelectedBatch(b);
                                          setAdjustmentQty(b.quantity);
                                          setIsAdjustModalOpen(true);
                                        }}
                                        className="text-emerald-500 hover:text-emerald-600 text-xs font-bold"
                                      >
                                        Adjust Stock Qty
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic font-medium">
                    No products matching search description found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Adjust Stock Modal */}
      {isAdjustModalOpen && selectedBatch && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAdjustSubmit} className="bg-white rounded-[2rem] w-full max-w-sm overflow-hidden shadow-2xl p-8">
            <h3 className="text-xl font-bold text-zinc-950 mb-2">Adjust HQ Store Stock</h3>
            <p className="text-xs text-zinc-500 mb-6">Modify stock quantity for batch: <strong className="font-mono">{selectedBatch.batchNumber}</strong></p>
            
            <div className="space-y-4 mb-6">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Quantity In Stock (Packs)</label>
                <input 
                  type="number"
                  required
                  min={0}
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 font-bold rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500/10 text-zinc-900"
                  value={adjustmentQty}
                  onChange={(e) => setAdjustmentQty(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button 
                type="button" 
                onClick={() => {
                  setIsAdjustModalOpen(false);
                  setSelectedBatch(null);
                }}
                className="flex-1 py-3 text-zinc-400 hover:text-zinc-600 font-bold text-sm transition-all"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="flex-1 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-2xl font-bold text-sm transition-all"
              >
                Apply Change
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Direct Batch Modal */}
      {isAddBatchModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAddBatchSubmit} className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-2xl p-8">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-zinc-950">Add Stock Batch to HQ</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Instantly record incoming bulk replenishment stock.</p>
              </div>
              <button type="button" onClick={() => setIsAddBatchModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 mb-6">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">Select Product</label>
                <select 
                  required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500/10 text-sm font-semibold"
                  value={newBatchData.productId}
                  onChange={(e) => setNewBatchData({...newBatchData, productId: e.target.value})}
                >
                  <option value="">Choose item...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} {p.sku ? `(SKU: ${p.sku})` : ''}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">Batch Number</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. BATCH-A4"
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none text-sm font-mono uppercase"
                    value={newBatchData.batchNumber}
                    onChange={(e) => setNewBatchData({...newBatchData, batchNumber: e.target.value})}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">Expiry Date</label>
                  <input 
                    type="date"
                    required
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none text-sm"
                    value={newBatchData.expiryDate}
                    onChange={(e) => setNewBatchData({...newBatchData, expiryDate: e.target.value})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1 col-span-1">
                  <label className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">Qty (Packs)</label>
                  <input 
                    type="number"
                    required
                    min={1}
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none text-sm font-bold"
                    value={newBatchData.quantity || ''}
                    onChange={(e) => setNewBatchData({...newBatchData, quantity: Number(e.target.value)})}
                  />
                </div>

                <div className="space-y-1 col-span-2">
                  <label className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">Unit Cost (UGX)</label>
                  <input 
                    type="number"
                    required
                    min={0}
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none text-sm font-bold"
                    value={newBatchData.purchasePrice || ''}
                    onChange={(e) => setNewBatchData({...newBatchData, purchasePrice: Number(e.target.value)})}
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                type="button" 
                onClick={() => setIsAddBatchModalOpen(false)}
                className="flex-1 py-3 text-zinc-400 font-bold hover:text-zinc-600 text-sm"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="flex-1 py-3 bg-zinc-950 font-bold text-white rounded-2xl hover:bg-zinc-800 text-sm shadow-md"
              >
                Confirm Add
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

// ==========================================
// 2. HQ STOCK IN/OUT MODULE TAB (REPLICA)
// ==========================================
const HQStockInOutTab: React.FC = () => {
  const { profile } = useAuth();
  const [subTab, setSubTab] = useState<'generate_order' | 'stock_in' | 'transfer_out' | 'transfer_history' | 'reception_history'>('generate_order');
  
  // Master Lists
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<InstitutionRegistry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [hqBatches, setHqBatches] = useState<ProductBatch[]>([]);

  // 1. GENERATE ORDER STATE
  const [orderMethod, setOrderMethod] = useState<'manual' | 'auto'>('manual');
  const [showHqAutoGenerate, setShowHqAutoGenerate] = useState(false);
  const [hqCoverageDays, setHqCoverageDays] = useState(90);
  const [hqProductScopes, setHqProductScopes] = useState<string[]>(['drug/medicine']);
  const [isAggregating, setIsAggregating] = useState(false);
  const [orderLines, setOrderLines] = useState<Array<{
    product_id: string;
    product_name: string;
    qty_ordered: number;
    unit_cost_ugx: number;
    line_total_ugx: number;
    supplier_id: string;
  }>>([]);
  
  // Manual generator single line form
  const [manualForm, setManualForm] = useState({
    productId: '',
    supplierId: '',
    quantity: 10,
    cost: 15000
  });
  const [manualProductSearchTerm, setManualProductSearchTerm] = useState('');
  const [transferProductSearchTerm, setTransferProductSearchTerm] = useState('');

  // 2. STOCK IN STATE
  const [incomingTransfers, setIncomingTransfers] = useState<TransferInvoice[]>([]);
  const [selectedTransfer, setSelectedTransfer] = useState<TransferInvoice | null>(null);
  const [transferLinesDetail, setTransferLinesDetail] = useState<TransferInvoiceLine[]>([]);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [submittingTransferReturn, setSubmittingTransferReturn] = useState(false);

  // 3. TRANSFER OUT STATE
  const [destBranchId, setDestBranchId] = useState('');
  const [transferOutLines, setTransferOutLines] = useState<Array<{
    product_id: string;
    product_name: string;
    qty_dispatched: number;
    unit_cost_ugx: number;
    total_cost_ugx: number;
    batch_number: string;
    expiry_date: string;
    batch_id: string;
  }>>([]);
  const [transferOutForm, setTransferOutForm] = useState({
    productId: '',
    batchId: '',
    quantity: 1
  });
  const [submittingTransferOut, setSubmittingTransferOut] = useState(false);

  // 4. TRANSFER HISTORY & RECEPTION HISTORY STATE
  const [transferHistory, setTransferHistory] = useState<TransferInvoice[]>([]);
  const [receivedOrders, setReceivedOrders] = useState<StockOrder[]>([]);
  const [acceptedReturns, setAcceptedReturns] = useState<TransferInvoice[]>([]);
  const [viewHistoryModal, setViewHistoryModal] = useState<{
    isOpen: boolean;
    type: 'transfer' | 'sourced_receipt' | 'return_receipt';
    title: string;
    items: Array<{ name: string; qty: number; batch?: string; exp?: string; price: number }>;
    meta: {
      date: string;
      operator: string;
      originDest: string;
      notes?: string;
    };
  } | null>(null);

  // DRAFTS STATE
  const [orderDrafts, setOrderDrafts] = useState<any[]>([]);
  const [transferDrafts, setTransferDrafts] = useState<any[]>([]);

  // HQ LEDGER STATES
  const [hqTransferSearch, setHqTransferSearch] = useState('');
  const [hqTransferDateRange, setHqTransferDateRange] = useState({ start: '', end: '' });
  const [hqReceptionSearch, setHqReceptionSearch] = useState('');
  const [hqReceptionDateRange, setHqReceptionDateRange] = useState({ start: '', end: '' });
  const [staff, setStaff] = useState<any[]>([]);

  const getUserName = (uid?: string) => {
    if (!uid) return 'N/A';
    const found = staff.find(s => s.uid === uid || s.id === uid);
    return found ? (found.full_name || found.displayName || found.username || found.email) : uid;
  };

  // Subscriptions & Initial Loads
  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Product>('products', profile.tenantId, setProducts);
      firestoreService.subscribeToCollection<InstitutionRegistry>('supplier_registry', profile.tenantId, setSuppliers);
      firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, setBranches);
      firestoreService.subscribeToCollection<any>('staff', profile.tenantId, setStaff);
      
      // Subscribe to active batches in HQ Store
      const unsubBatches = firestoreService.subscribeToCollectionByQuery<ProductBatch>(
        'product_batches',
        profile.tenantId,
        [where('branchId', '==', 'HQ'), where('quantity', '>', 0)],
        setHqBatches
      );

      // HQ receives only physical shipments. Submitted/approved orders are not
      // receivable until Procurement has processed and dispatched their GRN.
      const unsubIncomingTransfers = firestoreService.subscribeToCollectionByQuery<TransferInvoice>(
        'transfer_invoices',
        profile.tenantId,
        [where('destination_branch_id', '==', 'HQ'), where('status', '==', 'dispatched')],
        setIncomingTransfers
      );

      // Subscribe to past outgoing transfers from HQ (Transfer History)
      const unsubTransferHistory = firestoreService.subscribeToCollectionByQuery<TransferInvoice>(
        'transfer_invoices',
        profile.tenantId,
        [where('source_branch_id', '==', 'HQ')],
        setTransferHistory
      );

      // Subscribe to received HQ purchase orders (Reception History item 1)
      const unsubReceivedOrders = firestoreService.subscribeToCollectionByQuery<StockOrder>(
        'stock_orders',
        profile.tenantId,
        [where('requesting_branch_id', '==', 'HQ'), where('status', '==', 'fully_received')],
        setReceivedOrders
      );

      // Subscribe to accepted returns to HQ (Reception History item 2)
      const unsubAcceptedReturns = firestoreService.subscribeToCollectionByQuery<TransferInvoice>(
        'transfer_invoices',
        profile.tenantId,
        [where('destination_branch_id', '==', 'HQ'), where('status', '==', 'fully_accepted')],
        transfers => setAcceptedReturns(transfers.filter(isBranchReturnToHq))
      );

      // Subscribe to Order Drafts
      const unsubOrderDrafts = firestoreService.subscribeToCollection<any>(
        'hq_order_drafts',
        profile.tenantId,
        (data) => {
          setOrderDrafts(data.sort((a, b) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime()));
        }
      );

      // Subscribe to Transfer Drafts
      const unsubTransferDrafts = firestoreService.subscribeToCollection<any>(
        'hq_transfer_drafts',
        profile.tenantId,
        (data) => {
          setTransferDrafts(data.sort((a, b) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime()));
        }
      );

      return () => {
        unsubBatches();
        unsubIncomingTransfers();
        unsubTransferHistory();
        unsubReceivedOrders();
        unsubAcceptedReturns();
        unsubOrderDrafts();
        unsubTransferDrafts();
      };
    }
  }, [profile?.tenantId]);

  // Add Manual order line
  const handleAddManualLine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.productId || !manualForm.supplierId) {
      toast.error('Please choose a product and supplier.');
      return;
    }
    const selectedProd = products.find(p => p.id === manualForm.productId);
    if (!selectedProd) return;

    // Check if product already added
    if (orderLines.some(l => l.product_id === manualForm.productId)) {
      toast.error('Product is already in the order list. Edit quantity below.');
      return;
    }

    const newLine = {
      product_id: manualForm.productId,
      product_name: selectedProd.name,
      qty_ordered: Number(manualForm.quantity),
      unit_cost_ugx: Number(manualForm.cost),
      line_total_ugx: Number(manualForm.cost) * Number(manualForm.quantity),
      supplier_id: manualForm.supplierId
    };

    setOrderLines([...orderLines, newLine]);
    setManualForm({
      productId: '',
      supplierId: manualForm.supplierId, // Keep supplier for batching ease
      quantity: 10,
      cost: 15000
    });
    toast.success(`${selectedProd.name} added to draft order lines.`);
  };

  // Submit Generated Replenishment Order to Procurement
  const handleSubmitReplenishOrder = async () => {
    if (orderLines.length === 0 || !profile) {
      toast.error('Please add products to your draft order first.');
      return;
    }

    try {
      const orderRef = doc(collection(db, 'stock_orders'));
      const orderNumber = `HQR-${Date.now().toString().slice(-6)}`;
      const totalVal = orderLines.reduce((sum, l) => sum + l.line_total_ugx, 0);

      const orderPayload: Partial<StockOrder> = {
        tenantId: profile.tenantId,
        inventoryClass: 'SELLABLE',
        order_number: orderNumber,
        requesting_branch_id: 'HQ',
        requesting_branch_name: 'HQ Central Store',
        order_type: 'monthly',
        status: 'submitted', // Sent to Procurement for formal approval & sourcing (LPO generation)
        category: 'sellable_non_cosmetic',
        submitted_at: new Date().toISOString(),
        created_by: profile.uid,
        created_at: new Date().toISOString(),
        total_order_value_ugx: totalVal,
        generation_method: orderMethod === 'auto' ? 'auto_generated' : 'manual'
      };

      await setDoc(orderRef, orderPayload);

      // Create lines
      for (const line of orderLines) {
        const lineRef = doc(collection(db, 'stock_order_lines'));
        await setDoc(lineRef, {
          tenantId: profile.tenantId,
          inventoryClass: 'SELLABLE',
          order_id: orderRef.id,
          product_id: line.product_id,
          product_name: line.product_name || 'Unknown Product',
          qty_ordered: Number(line.qty_ordered),
          qty_received: 0,
          unit_cost_ugx: Number(line.unit_cost_ugx),
          line_total_ugx: Number(line.line_total_ugx),
          line_status: 'pending',
          supplier_id: line.supplier_id,
          supplier_type: 'external',
          createdAt: new Date().toISOString()
        });
      }

      toast.success(`HQ Store order ${orderNumber} submitted to Procurement module successfully!`);
      setOrderLines([]);
    } catch (err) {
      toast.error('Failed to submit order to Procurement.');
    }
  };

  // Draft handlers for Requisition/Order drafts
  const handleSaveOrderDraft = async () => {
    if (orderLines.length === 0) {
      toast.error('Add some products to the list first to save a draft.');
      return;
    }
    const titlePrompt = window.prompt('Enter a label/title for this order draft:', `Draft order - ${new Date().toLocaleTimeString()}`);
    if (titlePrompt === null) return; // User cancelled

    try {
      await firestoreService.addDocument('hq_order_drafts', {
        tenantId: profile.tenantId,
        title: titlePrompt || `Draft order - ${new Date().toLocaleString()}`,
        lines: orderLines,
        saved_at: new Date().toISOString(),
        saved_by: profile.uid,
        saved_by_name: profile.full_name || profile.displayName || profile.username || profile.email || 'HQ Staff'
      });
      toast.success('Order draft saved successfully!');
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to save order draft.');
    }
  };

  const handleLoadOrderDraft = (draft: any) => {
    if (orderLines.length > 0 && !window.confirm('This will replace your current unsaved order lines. Continue?')) {
      return;
    }
    setOrderLines(draft.lines || []);
    toast.success(`Loaded draft: ${draft.title}`);
  };

  const handleDeleteOrderDraft = async (id: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this draft?')) return;
    try {
      await firestoreService.deleteDocument('hq_order_drafts', id);
      toast.success('Draft deleted.');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete draft.');
    }
  };

  // Draft handlers for Transfer Out drafts
  const handleSaveTransferDraft = async () => {
    if (transferOutLines.length === 0) {
      toast.error('Add some products to the list first to save a draft.');
      return;
    }
    const titlePrompt = window.prompt('Enter a label/title for this transfer draft:', `Draft transfer - ${new Date().toLocaleTimeString()}`);
    if (titlePrompt === null) return; // User cancelled

    try {
      await firestoreService.addDocument('hq_transfer_drafts', {
        tenantId: profile.tenantId,
        title: titlePrompt || `Draft transfer - ${new Date().toLocaleString()}`,
        dest_branch_id: destBranchId,
        lines: transferOutLines,
        saved_at: new Date().toISOString(),
        saved_by: profile.uid,
        saved_by_name: profile.full_name || profile.displayName || profile.username || profile.email || 'HQ Staff'
      });
      toast.success('Transfer draft saved successfully!');
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to save transfer draft.');
    }
  };

  const handleLoadTransferDraft = (draft: any) => {
    if (transferOutLines.length > 0 && !window.confirm('This will replace your current unsaved dispatch lines. Continue?')) {
      return;
    }
    setDestBranchId(draft.dest_branch_id || '');
    setTransferOutLines(draft.lines || []);
    toast.success(`Loaded draft: ${draft.title}`);
  };

  const handleDeleteTransferDraft = async (id: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this draft?')) return;
    try {
      await firestoreService.deleteDocument('hq_transfer_drafts', id);
      toast.success('Draft deleted.');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete draft.');
    }
  };

  // Open Incoming Returns / Branch Transfer receipt modal
  const handleOpenTransferModal = async (t: TransferInvoice) => {
    setSelectedTransfer(t);
    try {
      const lines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [{ field: 'transfer_id', operator: '==', value: t.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
      setTransferLinesDetail(lines);
      setIsTransferModalOpen(true);
    } catch (err) {
      toast.error('Error fetching transfer lines.');
    }
  };

  // Accept an HQ-bound physical shipment once. Both Procurement GRNs and true
  // branch returns use the same idempotent inventory-posting boundary.
  const handleAcceptTransferReturn = async () => {
    if (!selectedTransfer || !profile || submittingTransferReturn) return;
    setSubmittingTransferReturn(true);
    try {
      await receiveHqTransfer({
        tenantId: profile.tenantId,
        transfer: selectedTransfer,
        lines: transferLinesDetail,
        user: {
          uid: profile.uid,
          name: profile.full_name || profile.displayName || profile.username || profile.email || 'HQ Store Officer'
        }
      });
      toast.success(isHqProcurementDelivery(selectedTransfer)
        ? 'GRN shipment received into HQ inventory.'
        : 'Branch return received into HQ inventory.');
      setIsTransferModalOpen(false);
      setSelectedTransfer(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to receive the HQ shipment.');
    } finally {
      setSubmittingTransferReturn(false);
    }
  };

  // Add transfer out line draft
  const handleAddTransferOutLine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferOutForm.productId || !transferOutForm.batchId || !transferOutForm.quantity) {
      toast.error('Please input product, batch, and non-zero quantity.');
      return;
    }

    const prod = products.find(p => p.id === transferOutForm.productId);
    const batch = hqBatches.find(b => b.id === transferOutForm.batchId);
    if (!prod || !batch) return;

    if (transferOutForm.quantity > batch.quantity) {
      toast.error(`Only ${batch.quantity} available in batch ${batch.batchNumber}.`);
      return;
    }

    if (transferOutLines.some(l => l.batch_id === transferOutForm.batchId)) {
      toast.error('This batch has already been selected.');
      return;
    }

    const newLine = {
      product_id: prod.id,
      product_name: prod.name,
      qty_dispatched: Number(transferOutForm.quantity),
      unit_cost_ugx: batch.purchasePrice,
      total_cost_ugx: Number(transferOutForm.quantity) * batch.purchasePrice,
      batch_number: batch.batchNumber,
      expiry_date: batch.expiryDate,
      batch_id: batch.id
    };

    setTransferOutLines([...transferOutLines, newLine]);
    setTransferOutForm({
      productId: '',
      batchId: '',
      quantity: 1
    });
    toast.success('Line added to outgoing dispatch sheet.');
  };

  // Execute Outgoing Stock Transfer from HQ to branch
  const handleExecuteTransferOut = async () => {
    if (!destBranchId) {
      toast.error('Please select a destination branch.');
      return;
    }
    if (transferOutLines.length === 0) {
      toast.error('No items have been added to the transfer list.');
      return;
    }

    setSubmittingTransferOut(true);
    try {
      const transferNumber = `TRF-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
      const totalVal = transferOutLines.reduce((sum, l) => sum + l.total_cost_ugx, 0);
      const destBranchName = branches.find(b => b.id === destBranchId)?.name || 'Receiving Branch';

      // 1. Create Transfer Invoice
      const transferRef = doc(collection(db, 'transfer_invoices'));
      const transferPayload: Partial<TransferInvoice> = {
        tenantId: profile?.tenantId,
        inventoryClass: 'SELLABLE',
        transfer_number: transferNumber,
        source_branch_id: 'HQ',
        source_branch_name: 'HQ Central Store',
        destination_branch_id: destBranchId,
        destination_branch_name: destBranchName,
        transfer_type: 'central_to_branch',
        status: 'dispatched',
        dispatched_by: profile?.uid || 'HQ Officer',
        dispatched_at: new Date().toISOString(),
        total_value_ugx: totalVal,
        items: transferOutLines.map(l => ({
          product_id: l.product_id,
          product_name: l.product_name,
          qty_dispatched: l.qty_dispatched,
          unit_cost_ugx: l.unit_cost_ugx,
          total_cost_ugx: l.total_cost_ugx,
          batch_number: l.batch_number,
          expiry_date: l.expiry_date
        })) as TransferInvoiceLine[]
      };

      await setDoc(transferRef, { ...transferPayload, createdAt: new Date().toISOString() });

      // 2. Create sub-lines & Decrement HQ Stock batches
      for (const line of transferOutLines) {
        const lineRef = doc(collection(db, 'transfer_invoice_lines'));
        await setDoc(lineRef, {
          tenantId: profile?.tenantId,
          inventoryClass: 'SELLABLE',
          transfer_id: transferRef.id,
          product_id: line.product_id,
          product_name: line.product_name || 'Unknown Product',
          qty_dispatched: line.qty_dispatched,
          unit_cost_ugx: line.unit_cost_ugx || 0,
          total_cost_ugx: line.total_cost_ugx,
          batch_number: line.batch_number,
          expiry_date: line.expiry_date,
          createdAt: new Date().toISOString()
        });

        // Decrement HQ inventory batch
        const batch = hqBatches.find(b => b.id === line.batch_id);
        if (batch) {
          const updatedQty = Math.max(0, batch.quantity - line.qty_dispatched);
          await firestoreService.updateDocument('product_batches', batch.id, {
            quantity: updatedQty,
            lastUpdated: new Date().toISOString()
          });
        }
      }

      toast.success(`Transfer ${transferNumber} successfully dispatched to ${destBranchName}!`);
      setTransferOutLines([]);
      setDestBranchId('');
      setSubTab('transfer_history');
    } catch (err) {
      toast.error('Failed to dispatch outgoing transfer.');
    } finally {
      setSubmittingTransferOut(false);
    }
  };

  // Open History Detail Modal (Transfers or Receipts)
  const handleOpenHistoryDetail = async (item: any, type: 'transfer' | 'sourced_receipt' | 'return_receipt') => {
    let lines: any[] = [];
    let meta = {
      date: '',
      operator: '',
      originDest: '',
      notes: ''
    };
    let title = '';

    if (type === 'transfer') {
      title = `Transfer Dispatch #${item.transfer_number}`;
      let tLines = item.items || [];
      if (tLines.length === 0) {
        try {
          tLines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [{ field: 'transfer_id', operator: '==', value: item.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
        } catch (e) {
          console.error("Error fetching transfer lines:", e);
        }
      }
      lines = tLines;
      meta = {
        date: new Date(item.dispatched_at).toLocaleString(),
        operator: getUserName(item.dispatched_by),
        originDest: `To Branch: ${item.destination_branch_name}`,
        notes: item.notes || 'Routine stock distribution'
      };
    } else if (type === 'sourced_receipt') {
      title = `Sourced GRN Receipt #${item.order_number}`;
      const oLines = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: item.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
      lines = oLines.map((l: any) => ({
        product_name: l.product_name,
        qty_dispatched: l.qty_ordered,
        qty_received: l.qty_received,
        unit_cost_ugx: l.unit_cost_ugx,
        total_cost_ugx: l.line_total_ugx
      }));
      meta = {
        date: item.received_at ? new Date(item.received_at).toLocaleString() : 'N/A',
        operator: getUserName(item.received_by),
        originDest: 'Direct Sourced / Procurement Sourcing',
        notes: 'Replenishment order fully stowed'
      };
    } else {
      title = `Accepted Return #${item.transfer_number}`;
      const tLines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [{ field: 'transfer_id', operator: '==', value: item.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
      lines = tLines.map(l => ({
        product_name: l.product_name,
        qty_dispatched: l.qty_dispatched,
        qty_received: l.qty_dispatched,
        unit_cost_ugx: l.unit_cost_ugx,
        total_cost_ugx: l.total_cost_ugx,
        batch_number: l.batch_number,
        expiry_date: l.expiry_date
      }));
      meta = {
        date: item.accepted_at ? new Date(item.accepted_at).toLocaleString() : 'N/A',
        operator: getUserName(item.accepted_by),
        originDest: `Returned From: ${item.source_branch_name}`,
        notes: item.notes || 'Returned / excess inventory branch return'
      };
    }

    const formattedItems = lines.map(l => ({
      name: l.product_name || 'Generic Product',
      qty: l.qty_received ?? l.qty_dispatched ?? 0,
      batch: l.batch_number,
      exp: l.expiry_date,
      price: l.unit_cost_ugx || 0
    }));

    setViewHistoryModal({
      isOpen: true,
      type,
      title,
      items: formattedItems,
      meta
    });
  };

  // Export CSV helper
  const handleDownloadTransferCSV = async (transfer: TransferInvoice) => {
    let lines = transfer.items || [];
    if (lines.length === 0) {
      try {
        lines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [{ field: 'transfer_id', operator: '==', value: transfer.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
      } catch (e) {
        console.error("Error fetching lines for transfer export:", e);
      }
    }

    const BOM = "\uFEFF";
    let csvContent = BOM + "Transfer Invoice Export\n";
    csvContent += `Transfer Number,${transfer.transfer_number}\n`;
    csvContent += `Source,"${(transfer.source_branch_name || 'HQ').replace(/"/g, '""')}"\n`;
    csvContent += `Destination,"${(transfer.destination_branch_name || '').replace(/"/g, '""')}"\n`;
    csvContent += `Dispatched At,${transfer.dispatched_at}\n`;
    csvContent += `Dispatched By,"${getUserName(transfer.dispatched_by).replace(/"/g, '""')}"\n\n`;
    csvContent += "Product Name,Batch Number,Qty Dispatched,Unit Cost (UGX),Total Cost (UGX)\n";

    lines.forEach(item => {
      csvContent += `"${(item.product_name || '').replace(/"/g, '""')}",${item.batch_number || 'N/A'},${item.qty_dispatched || 0},${item.unit_cost_ugx || 0},${((item.qty_dispatched || 0) * (item.unit_cost_ugx || 0))}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `HQ_TRANSFER_${transfer.transfer_number}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Excel-compatible CSV downloaded successfully.');
  };

  const handleDownloadHqReceptionAggregate = async () => {
    if (displayedHqReceptionHistory.length === 0) {
      toast.error("No goods receipt records found in the current filtered period.");
      return;
    }

    setIsAggregating(true);
    toast.loading("Aggregating reception details from database...", { id: "hq-aggregation" });

    try {
      const rows: any[][] = [];
      const headers = [
        'GRN ID (Ref)', 
        'Source', 
        'Sender (Dispatched By)', 
        'Receiver (Received By)', 
        'Total Qty from Invoice', 
        'Total Qty Received', 
        'Total Qty Queried',
        'Total Value (UGX)',
        'Received Date'
      ];

      for (const item of displayedHqReceptionHistory) {
        let totalInvoiceQty = 0;
        let totalReceivedQty = 0;
        let totalQueriedQty = 0;

        if (item.type === 'sourced_receipt') {
          const oLines = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [{ field: 'order_id', operator: '==', value: item.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
          oLines.forEach(l => {
            const ordered = l.qty_ordered || 0;
            const received = l.qty_supplied ?? l.qty_ordered ?? 0;
            const queried = Math.max(0, ordered - received);
            totalInvoiceQty += ordered;
            totalReceivedQty += received;
            totalQueriedQty += queried;
          });
        } else {
          const tLines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [{ field: 'transfer_id', operator: '==', value: item.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
          tLines.forEach(l => {
            const dispatched = l.qty_dispatched || 0;
            const received = l.qty_received ?? l.qty_dispatched ?? 0;
            const queried = l.qty_queried || Math.max(0, dispatched - received);
            totalInvoiceQty += dispatched;
            totalReceivedQty += received;
            totalQueriedQty += queried;
          });
        }

        const senderName = item.type === 'sourced_receipt' ? 'External Supplier' : 'Branch Staff';
        const receiverName = getUserName(item.operator);

        rows.push([
          item.ref_number,
          item.source,
          senderName,
          receiverName,
          totalInvoiceQty,
          totalReceivedQty,
          totalQueriedQty,
          item.value,
          item.date ? new Date(item.date).toLocaleDateString() : '-'
        ]);
      }

      const BOM = "\uFEFF";
      const csvContent = BOM + [headers.join(','), ...rows.map(e => e.map(val => `"${(val ?? '').toString().replace(/"/g, '""')}"`).join(","))].join("\n");
      
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `HQ_GRN_Reception_Aggregate_${hqReceptionDateRange.start || 'all'}_to_${hqReceptionDateRange.end || 'all'}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast.success("Aggregate reception report exported successfully!", { id: "hq-aggregation" });
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate aggregate report.", { id: "hq-aggregation" });
    } finally {
      setIsAggregating(false);
    }
  };

  const handleDownloadHqTransferAggregate = async () => {
    if (displayedHqTransferHistory.length === 0) {
      toast.error("No transfer records found in the current filtered period.");
      return;
    }

    setIsAggregating(true);
    toast.loading("Aggregating transfer details from database...", { id: "hq-transfer-aggregation" });

    try {
      const rows: any[][] = [];
      const headers = [
        'Transfer ID (Ref)', 
        'Destination', 
        'Sender (Dispatched By)', 
        'Receiver (Received By)', 
        'Total Qty from Invoice', 
        'Total Qty Received', 
        'Total Qty Queried',
        'Total Value (UGX)',
        'Dispatch Date',
        'Status'
      ];

      for (const t of displayedHqTransferHistory) {
        let totalInvoiceQty = 0;
        let totalReceivedQty = 0;
        let totalQueriedQty = 0;

        let tLines = t.items || [];
        if (tLines.length === 0) {
          try {
            tLines = await firestoreService.getDocumentsByQuery<TransferInvoiceLine>('transfer_invoice_lines', [{ field: 'transfer_id', operator: '==', value: t.id }, { field: 'tenantId', operator: '==', value: profile?.tenantId }]);
          } catch (e) {
            console.error("Error fetching lines for transfer export:", e);
          }
        }

        tLines.forEach(l => {
          const dispatched = l.qty_dispatched || 0;
          const received = l.qty_received ?? l.qty_dispatched ?? 0;
          const queried = l.qty_queried || Math.max(0, dispatched - received);
          totalInvoiceQty += dispatched;
          totalReceivedQty += received;
          totalQueriedQty += queried;
        });

        const senderName = getUserName(t.dispatched_by);
        const receiverName = t.received_by ? getUserName(t.received_by) : 'Pending';

        rows.push([
          t.transfer_number,
          t.destination_branch_name || 'Branch Store',
          senderName,
          receiverName,
          totalInvoiceQty,
          totalReceivedQty,
          totalQueriedQty,
          t.total_value_ugx || 0,
          t.dispatched_at ? new Date(t.dispatched_at).toLocaleDateString() : '-',
          t.status
        ]);
      }

      const BOM = "\uFEFF";
      const csvContent = BOM + [headers.join(','), ...rows.map(e => e.map(val => `"${(val ?? '').toString().replace(/"/g, '""')}"`).join(","))].join("\n");
      
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `HQ_Transfer_Aggregate_${hqTransferDateRange.start || 'all'}_to_${hqTransferDateRange.end || 'all'}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast.success("Aggregate transfer report exported successfully!", { id: "hq-transfer-aggregation" });
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate aggregate transfer report.", { id: "hq-transfer-aggregation" });
    } finally {
      setIsAggregating(false);
    }
  };

  // Assemble consolidated Reception History
  const consolidatedReceptionHistory = [
    ...receivedOrders.map(o => ({
      id: o.id,
      ref_number: o.order_number,
      source: 'Direct Procurement PO',
      date: o.received_at || o.submitted_at || '',
      value: o.total_order_value_ugx,
      type: 'sourced_receipt' as const,
      operator: o.received_by,
      originalData: o
    })),
    ...acceptedReturns.map(t => ({
      id: t.id,
      ref_number: t.transfer_number,
      source: t.source_branch_name || 'Branch Return',
      date: t.accepted_at || t.dispatched_at || '',
      value: t.total_value_ugx,
      type: 'return_receipt' as const,
      operator: t.accepted_by,
      originalData: t
    }))
  ].sort((a, b) => b.date.localeCompare(a.date));

  // Filtered lists for UI rendering based on search and date range
  const displayedHqTransferHistory = transferHistory.filter(t => {
    const tDate = (t.dispatched_at || t.createdAt || '').split('T')[0];
    const matchesStart = !hqTransferDateRange.start || tDate >= hqTransferDateRange.start;
    const matchesEnd = !hqTransferDateRange.end || tDate <= hqTransferDateRange.end;
    
    if (!matchesStart || !matchesEnd) return false;

    if (hqTransferSearch.trim()) {
      const q = hqTransferSearch.toLowerCase().trim();
      const transferId = (t.transfer_number || '').toLowerCase();
      const invoiceId = (t.id || '').toLowerCase();
      const srcName = (t.source_branch_name || 'HQ Central Depot').toLowerCase();
      const destName = (t.destination_branch_name || 'Branch Store').toLowerCase();
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

  const displayedHqReceptionHistory = consolidatedReceptionHistory.filter(item => {
    const rDate = (item.date || '').split('T')[0];
    const matchesStart = !hqReceptionDateRange.start || rDate >= hqReceptionDateRange.start;
    const matchesEnd = !hqReceptionDateRange.end || rDate <= hqReceptionDateRange.end;

    if (!matchesStart || !matchesEnd) return false;

    if (hqReceptionSearch.trim()) {
      const q = hqReceptionSearch.toLowerCase().trim();
      const refId = (item.ref_number || '').toLowerCase();
      const itemId = (item.id || '').toLowerCase();
      const source = (item.source || '').toLowerCase();
      const dest = 'HQ Central Store'.toLowerCase();
      const operator = getUserName(item.operator).toLowerCase();

      return refId.includes(q) ||
             itemId.includes(q) ||
             source.includes(q) ||
             dest.includes(q) ||
             operator.includes(q);
    }
    return true;
  });

  const hqGrnDeliveries = incomingTransfers.filter(isHqProcurementDelivery);
  const hqBranchReturns = incomingTransfers.filter(isBranchReturnToHq);
  const pendingHqReceipts = hqGrnDeliveries.length + hqBranchReturns.length;

  return (
    <div className="space-y-6">
      {/* Top mini-tab header */}
      <div className="flex flex-wrap gap-2 p-1 bg-zinc-100 rounded-2xl w-fit">
        <button 
          onClick={() => setSubTab('generate_order')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all inline-flex items-center gap-2",
            subTab === 'generate_order' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700 font-sans"
          )}
        >
          <ShoppingCart size={13} />
          Generate Replenishment Order
        </button>
        <button 
          onClick={() => setSubTab('stock_in')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all inline-flex items-center gap-2",
            subTab === 'stock_in' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700 font-sans"
          )}
        >
          <Package size={13} />
          Stock In (GRN)
          {pendingHqReceipts > 0 && (
            <span className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse inline-block"></span>
          )}
        </button>
        <button 
          onClick={() => setSubTab('transfer_out')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all inline-flex items-center gap-2",
            subTab === 'transfer_out' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700 font-sans"
          )}
        >
          <Truck size={13} />
          Transfer Out (Dispatch)
        </button>
        <button 
          onClick={() => setSubTab('transfer_history')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all inline-flex items-center gap-2",
            subTab === 'transfer_history' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700 font-sans"
          )}
        >
          <FileText size={13} />
          Transfer History
        </button>
        <button 
          onClick={() => setSubTab('reception_history')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all inline-flex items-center gap-2",
            subTab === 'reception_history' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700 font-sans"
          )}
        >
          <Clock size={13} />
          Reception History Ledger
        </button>
      </div>

      <div className="bg-white rounded-[2rem] border border-zinc-200 shadow-sm p-8">
        
        {/* TAB 1: GENERATE ORDER */}
        {subTab === 'generate_order' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-100 pb-5">
              <div>
                <h3 className="text-xl font-black text-zinc-950 tracking-tight">HQ Store Replenishment Order</h3>
                <p className="text-xs text-zinc-400 font-medium">Generate stock replenishment orders manually, or auto-calculate based on global branch consumption metrics.</p>
              </div>
              <div className="flex gap-2 p-1 bg-zinc-100 rounded-xl w-fit">
                <button
                  onClick={() => setOrderMethod('manual')}
                  className={cn("px-4 py-1.5 rounded-lg text-xs font-bold transition-all", orderMethod === 'manual' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500")}
                >
                  Manual Restock Build
                </button>
                <button
                  onClick={() => setOrderMethod('auto')}
                  className={cn("px-4 py-1.5 rounded-lg text-xs font-bold transition-all", orderMethod === 'auto' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500")}
                >
                  Smart Auto-Generator
                </button>
              </div>
            </div>

            {orderMethod === 'auto' && (
              <div className="p-6 bg-emerald-50/50 border border-emerald-100 rounded-2xl space-y-4">
                <div className="space-y-1">
                  <p className="text-sm font-bold text-emerald-950">HQ Consumption Aggregator Engine</p>
                  <p className="text-xs text-zinc-600">Uses the branch replenishment model for every branch, aggregates unmet demand, then deducts usable HQ stock and confirmed incoming supply.</p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_auto] gap-4 items-end">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Coverage period</label>
                    <select value={hqCoverageDays} onChange={event => setHqCoverageDays(Number(event.target.value))} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold">
                      <option value={30}>30 days</option>
                      <option value={60}>60 days</option>
                      <option value={90}>90 days</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Product scope (select one or more)</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 bg-white border border-zinc-200 rounded-xl p-3">
                      {[
                        ['drug/medicine', 'Drug / Medicine'], ['cosmetic', 'Cosmetic'],
                        ['consumable', 'Consumable'], ['device', 'Device'],
                        ['cosmetic therapeutics', 'Cosmetic Therapeutics']
                      ].map(([value, label]) => (
                        <label key={value} className="flex items-center gap-2 text-[10px] font-bold text-zinc-700">
                          <input type="checkbox" checked={hqProductScopes.includes(value)} onChange={() => setHqProductScopes(current => current.includes(value) ? current.filter(scope => scope !== value) : [...current, value])} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button type="button" onClick={() => setShowHqAutoGenerate(true)} disabled={hqProductScopes.length === 0} className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider disabled:opacity-50">
                    Launch Replenishment Console
                  </button>
                </div>
              </div>
            )}

            <AutoGenerateOrderModal
              isOpen={showHqAutoGenerate}
              onClose={() => setShowHqAutoGenerate(false)}
              branches={branches}
              initialCoverageDays={hqCoverageDays}
              initialProductScopes={hqProductScopes}
              initialCategory="sellable_non_cosmetic"
              inventoryClassLock="SELLABLE"
              mode="hq_aggregate"
              fixedBranchId="HQ"
            />

            {orderMethod === 'manual' && (
              <form onSubmit={handleAddManualLine} className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-zinc-50/50 p-5 rounded-2xl border border-zinc-200">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-1">Select Product</label>
                  <input
                    type="text"
                    placeholder="Search product..."
                    value={manualProductSearchTerm}
                    onChange={(e) => setManualProductSearchTerm(e.target.value)}
                    className="w-full px-3 py-1.5 mb-1.5 bg-white border border-zinc-200 rounded-xl text-xs outline-none focus:border-emerald-500 font-medium"
                  />
                  <select
                    required
                    value={manualForm.productId}
                    onChange={(e) => {
                      const p = products.find(prod => prod.id === e.target.value);
                      setManualForm({
                        ...manualForm,
                        productId: e.target.value,
                        cost: p?.costPricePerPack || p?.cost_price || 15000
                      });
                    }}
                    className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold outline-none"
                  >
                    <option value="">Select a product...</option>
                    {products
                      .filter(p => 
                        !manualProductSearchTerm || 
                        p.name.toLowerCase().includes(manualProductSearchTerm.toLowerCase()) || 
                        p.sku.toLowerCase().includes(manualProductSearchTerm.toLowerCase())
                      )
                      .map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                      ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Sourcing Vendor</label>
                  <select
                    required
                    value={manualForm.supplierId}
                    onChange={(e) => setManualForm({...manualForm, supplierId: e.target.value})}
                    className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold outline-none"
                  >
                    <option value="">Select registry vendor...</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.supplier_name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2 col-span-2 md:col-span-1">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Packs</label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={manualForm.quantity}
                      onChange={(e) => setManualForm({...manualForm, quantity: Number(e.target.value)})}
                      className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Est Cost</label>
                    <input
                      type="number"
                      required
                      min={100}
                      value={manualForm.cost}
                      onChange={(e) => setManualForm({...manualForm, cost: Number(e.target.value)})}
                      className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold outline-none"
                    />
                  </div>
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white rounded-xl text-xs font-bold uppercase transition-all"
                  >
                    Add Product Line
                  </button>
                </div>
              </form>
            )}

            {/* Current Order draft table */}
            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase text-zinc-400 tracking-wider font-mono">Draft Sourcing Lines ({orderLines.length})</h4>
              <div className="border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-250 font-bold text-zinc-500">
                      <th className="px-6 py-3">Product Description</th>
                      <th className="px-6 py-3">Supplier Name</th>
                      <th className="px-6 py-3 text-center">Qty Packs</th>
                      <th className="px-6 py-3 text-right">Unit Price (UGX)</th>
                      <th className="px-6 py-3 text-right">Subtotal</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 font-medium text-zinc-700">
                    {orderLines.map((line, idx) => {
                      const supp = suppliers.find(s => s.id === line.supplier_id)?.supplier_name || 'Generic Sourcing';
                      return (
                        <tr key={idx} className="hover:bg-zinc-50/20">
                          <td className="px-6 py-4 font-bold text-zinc-950">{line.product_name}</td>
                          <td className="px-6 py-4 text-zinc-500 font-mono text-[11px]">{supp}</td>
                          <td className="px-6 py-4 text-center">
                            <input
                              type="number"
                              min={1}
                              value={line.qty_ordered}
                              onChange={(e) => {
                                const newQty = Number(e.target.value);
                                const updated = [...orderLines];
                                updated[idx].qty_ordered = newQty;
                                updated[idx].line_total_ugx = newQty * updated[idx].unit_cost_ugx;
                                setOrderLines(updated);
                              }}
                              className="w-16 px-1.5 py-1 text-center border border-zinc-200 rounded-lg focus:ring-1 focus:ring-emerald-500 outline-none"
                            />
                          </td>
                          <td className="px-6 py-4 text-right">
                            <input
                              type="number"
                              min={0}
                              value={line.unit_cost_ugx}
                              onChange={(e) => {
                                const newCost = Number(e.target.value);
                                const updated = [...orderLines];
                                updated[idx].unit_cost_ugx = newCost;
                                updated[idx].line_total_ugx = updated[idx].qty_ordered * newCost;
                                setOrderLines(updated);
                              }}
                              className="w-24 px-1.5 py-1 text-right border border-zinc-200 rounded-lg focus:ring-1 focus:ring-emerald-500 outline-none"
                            />
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-zinc-950 font-mono">
                            UGX {line.line_total_ugx.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => setOrderLines(orderLines.filter((_, i) => i !== idx))}
                              className="text-red-500 hover:text-red-700 text-[10px] font-black uppercase tracking-wider"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {orderLines.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">
                          No lines added yet. Sourcing lines can be loaded via automated data, or added manually above.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-zinc-50/50 font-bold border-t border-zinc-250">
                      <td colSpan={4} className="px-6 py-3 text-right text-zinc-400 uppercase font-mono tracking-wider text-[10px]">Grand Sourced Total</td>
                      <td className="px-6 py-3 text-right text-sm text-zinc-950 font-black font-mono">
                        UGX {orderLines.reduce((sum, l) => sum + l.line_total_ugx, 0).toLocaleString()}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setOrderLines([])}
                className="px-6 py-3 border border-zinc-200 hover:bg-zinc-50 rounded-2xl text-xs font-black uppercase tracking-wider text-zinc-500 transition-colors"
              >
                Clear Sourcing Draft
              </button>
              <button
                type="button"
                onClick={handleSaveOrderDraft}
                disabled={orderLines.length === 0}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-40"
              >
                Save as Draft
              </button>
              <button
                type="button"
                onClick={handleSubmitReplenishOrder}
                disabled={orderLines.length === 0}
                className="px-8 py-3 bg-zinc-950 hover:bg-zinc-800 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-40"
              >
                Submit Replenishment Order to Procurement
              </button>
            </div>

            {/* Saved Order Drafts Section */}
            <div className="pt-6 border-t border-zinc-200 space-y-3">
              <div className="flex items-center gap-2">
                <span className="p-1 bg-amber-50 rounded-md text-amber-600">
                  <FileText size={16} />
                </span>
                <h4 className="text-sm font-bold text-zinc-900">Saved Order Drafts</h4>
                <span className="text-[10px] font-bold text-zinc-400 font-mono">({orderDrafts.length})</span>
              </div>
              
              <div className="border border-zinc-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-500">
                      <th className="px-6 py-3">Draft Label / Title</th>
                      <th className="px-6 py-3">Products Count</th>
                      <th className="px-6 py-3">Last Saved</th>
                      <th className="px-6 py-3">Saved By</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 font-medium text-zinc-700">
                    {orderDrafts.map((draft) => (
                      <tr key={draft.id} className="hover:bg-zinc-50/50">
                        <td className="px-6 py-4 font-bold text-zinc-900">{draft.title}</td>
                        <td className="px-6 py-4 text-zinc-500 font-mono">{(draft.lines || []).length} items</td>
                        <td className="px-6 py-4 text-zinc-400 font-mono">{new Date(draft.saved_at).toLocaleString()}</td>
                        <td className="px-6 py-4 text-zinc-700 font-semibold">{draft.saved_by_name || 'Staff'}</td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-2 text-[10px] font-bold uppercase tracking-wider">
                            <button
                              onClick={() => handleLoadOrderDraft(draft)}
                              className="px-3 py-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors"
                            >
                              Load Draft
                            </button>
                            <button
                              onClick={() => handleDeleteOrderDraft(draft.id)}
                              className="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {orderDrafts.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-10 text-center text-zinc-400 italic">
                          No saved order drafts found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: STOCK IN (RECEIVING PORTAL) */}
        {subTab === 'stock_in' && (
          <div className="space-y-8 font-sans">
            <div>
              <h3 className="text-xl font-black text-zinc-950 tracking-tight">HQ Store Goods Receipt Notes (GRN)</h3>
              <p className="text-xs text-zinc-400 font-medium">Verify and stowed approved incoming stock shipments back into the central HQ store database catalog.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Left Column: Procurement shipments created only after GRN dispatch */}
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase text-zinc-400 tracking-wider font-mono flex items-center gap-2">
                  <Truck size={12} />
                  Dispatched Procurement GRNs ({hqGrnDeliveries.length})
                </h4>
                {hqGrnDeliveries.length === 0 ? (
                  <div className="p-8 border border-dashed border-zinc-200 rounded-3xl bg-zinc-50/20 text-center text-zinc-400 italic text-xs">
                    No processed Procurement GRNs are currently awaiting HQ receipt. Submitted orders remain in Procurement until GRN dispatch.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                    {hqGrnDeliveries.map(transfer => (
                      <div key={transfer.id} className="p-5 border border-zinc-200 rounded-3xl bg-white hover:border-zinc-300 transition-all shadow-sm">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest block">GRN Shipment</span>
                            <span className="text-sm font-bold text-zinc-900">{transfer.transfer_number}</span>
                          </div>
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-lg text-[10px] uppercase font-black tracking-wider">Dispatched</span>
                        </div>
                        <div className="my-4 text-xs font-semibold text-zinc-600 flex justify-between">
                          <span>Supplier: {transfer.source_branch_name || 'Procurement'}</span>
                          <span>Value: UGX {transfer.total_value_ugx?.toLocaleString()}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenTransferModal(transfer)}
                          className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all"
                        >
                          Verify & Receive GRN Shipment
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: Branch Returns */}
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase text-zinc-400 tracking-wider font-mono flex items-center gap-2">
                  <ArrowRightLeft size={12} />
                  Incoming Branch Returns ({hqBranchReturns.length})
                </h4>
                {hqBranchReturns.length === 0 ? (
                  <div className="p-8 border border-dashed border-zinc-200 rounded-3xl bg-zinc-50/20 text-center text-zinc-400 italic text-xs">
                    No incoming branch return transfers currently in transit.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                    {hqBranchReturns.map(t => (
                      <div key={t.id} className="p-5 border border-zinc-200 rounded-3xl bg-white hover:border-zinc-300 transition-all shadow-sm">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest block">Return Invoice</span>
                            <span className="text-sm font-bold text-zinc-900">{t.transfer_number}</span>
                          </div>
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-lg text-[10px] uppercase font-black tracking-wider">In Transit</span>
                        </div>
                        <div className="my-4 text-xs font-semibold text-zinc-600 flex justify-between">
                          <span>From: {t.source_branch_name}</span>
                          <span>Value: UGX {t.total_value_ugx?.toLocaleString()}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenTransferModal(t)}
                          className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all"
                        >
                          Verify & Confirm Return Acceptance
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Transfer return modal */}
            {isTransferModalOpen && selectedTransfer && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-sans">
                <div className="bg-white text-zinc-900 rounded-3xl w-full max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl p-5 sm:p-8 animate-fade-in leading-normal">
                  <h3 className="text-xl font-bold text-zinc-950 mb-1">
                    {isHqProcurementDelivery(selectedTransfer) ? 'Verify Procurement GRN' : 'Verify Return Acceptance'}: {selectedTransfer.transfer_number}
                  </h3>
                  <p className="text-xs text-zinc-600 mb-6">Review the dispatched batches before confirming. Confirmation posts this shipment to HQ inventory exactly once.</p>

                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar mb-6">
                    {transferLinesDetail.map(line => (
                      <div key={line.id} className="p-4 bg-zinc-50 rounded-2xl grid grid-cols-1 sm:grid-cols-2 gap-3 border border-zinc-200">
                        <div>
                          <p className="font-bold text-zinc-900 text-sm">{line.product_name}</p>
                          <p className="text-xs text-zinc-700 font-mono mt-0.5 break-words">Batch: {line.batch_number} | Exp: {line.expiry_date}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-zinc-900">{line.qty_dispatched} Packs</p>
                          <p className="text-xs text-zinc-700 font-mono">Cost: UGX {line.unit_cost_ugx?.toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-4">
                    <button 
                      type="button" 
                      onClick={() => {
                        setIsTransferModalOpen(false);
                        setSelectedTransfer(null);
                      }}
                      disabled={submittingTransferReturn}
                      className="flex-1 py-3 text-zinc-600 hover:text-zinc-700 font-bold text-sm"
                    >
                      Cancel / Close
                    </button>
                    <button 
                      type="button" 
                      onClick={handleAcceptTransferReturn}
                      disabled={submittingTransferReturn}
                      className="flex-1 py-3 bg-zinc-950 hover:bg-zinc-800 font-bold text-white rounded-2xl text-sm shadow-md"
                    >
                      {submittingTransferReturn ? 'Updating Database...' : isHqProcurementDelivery(selectedTransfer) ? 'Confirm GRN Receipt' : 'Confirm Return Goods'}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* TAB 3: TRANSFER OUT (DISPATCH WORKSHOP) */}
        {subTab === 'transfer_out' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-black text-zinc-950 tracking-tight">HQ Store Outward Dispatch</h3>
              <p className="text-xs text-zinc-400 font-medium">Distribute verified central stock inventory batches out to local pharmacy branches.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Dispatch form panel */}
              <div className="lg:col-span-1 bg-zinc-50 p-6 rounded-3xl border border-zinc-200 space-y-4 h-fit">
                <h4 className="text-xs font-black uppercase text-zinc-400 tracking-wider font-mono">Draft Stock Line</h4>
                
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Destination Outlet</label>
                  <select
                    value={destBranchId}
                    onChange={(e) => setDestBranchId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold outline-none"
                  >
                    <option value="">Select destination branch...</option>
                    {branches.filter(b => b.id !== 'HQ').map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <form onSubmit={handleAddTransferOutLine} className="space-y-4 pt-3 border-t border-zinc-200">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-1">Select Product</label>
                    <input
                      type="text"
                      placeholder="Search product..."
                      value={transferProductSearchTerm}
                      onChange={(e) => setTransferProductSearchTerm(e.target.value)}
                      className="w-full px-3 py-1.5 mb-1.5 bg-white border border-zinc-200 rounded-xl text-xs outline-none focus:border-emerald-500 font-medium"
                    />
                    <select
                      required
                      value={transferOutForm.productId}
                      onChange={(e) => setTransferOutForm({ ...transferOutForm, productId: e.target.value, batchId: '' })}
                      className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold outline-none"
                    >
                      <option value="">Select product to dispatch...</option>
                      {products
                        .filter(p => 
                          !transferProductSearchTerm || 
                          p.name.toLowerCase().includes(transferProductSearchTerm.toLowerCase()) || 
                          (p.sku && p.sku.toLowerCase().includes(transferProductSearchTerm.toLowerCase()))
                        )
                        .map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                  </div>

                  {transferOutForm.productId && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Select Active Batch (HQ Store)</label>
                      <select
                        required
                        value={transferOutForm.batchId}
                        onChange={(e) => setTransferOutForm({ ...transferOutForm, batchId: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-mono font-bold outline-none"
                      >
                        <option value="">Select active stock batch...</option>
                        {hqBatches.filter(b => b.productId === transferOutForm.productId).map(b => (
                          <option key={b.id} value={b.id}>
                            {b.batchNumber} (Avail: {b.quantity} packs) - Exp: {b.expiryDate}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Quantity to Dispatch (Packs)</label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={transferOutForm.quantity}
                      onChange={(e) => setTransferOutForm({ ...transferOutForm, quantity: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white rounded-xl text-xs font-bold uppercase transition-all flex items-center justify-center gap-2"
                  >
                    <Plus size={14} />
                    Add Dispatch Line
                  </button>
                </form>
              </div>

              {/* Draft list table */}
              <div className="lg:col-span-2 space-y-4">
                <div className="p-4 border border-zinc-200 rounded-2xl bg-zinc-50/20 flex justify-between items-center">
                  <h4 className="text-xs font-black uppercase text-zinc-400 tracking-wider font-mono">Dispatched Lines ({transferOutLines.length})</h4>
                  <div className="text-xs font-bold text-zinc-500">
                    Grand Total Sourced Value: <span className="text-emerald-600 font-mono font-black">UGX {transferOutLines.reduce((sum, l) => sum + l.total_cost_ugx, 0).toLocaleString()}</span>
                  </div>
                </div>

                <div className="border border-zinc-200 rounded-[20px] overflow-x-auto bg-white text-zinc-900 shadow-sm">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-500">
                        <th className="px-4 py-3">Product Description</th>
                        <th className="px-4 py-3 text-center">Batch ID</th>
                        <th className="px-4 py-3 text-center">Qty Dispatch</th>
                        <th className="px-4 py-3 text-right">Cost Price</th>
                        <th className="px-4 py-3 text-right">Total Cost</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 font-medium text-zinc-700">
                      {transferOutLines.map((line, idx) => (
                        <tr key={idx} className="hover:bg-zinc-50/10">
                          <td className="px-4 py-3 font-bold text-zinc-950">{line.product_name}</td>
                          <td className="px-4 py-3 text-center font-mono font-bold text-zinc-600">{line.batch_number}</td>
                          <td className="px-4 py-3 text-center font-bold text-emerald-600 text-sm">{line.qty_dispatched}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-500">UGX {line.unit_cost_ugx.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-zinc-950">
                            UGX {line.total_cost_ugx.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setTransferOutLines(transferOutLines.filter((_, i) => i !== idx))}
                              className="text-red-500 hover:text-red-700 text-[10px] font-black uppercase tracking-wider"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                      {transferOutLines.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-zinc-400 italic">
                            Draft list empty. Please draft a dispatch order line using the panel on the left.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setTransferOutLines([])}
                    className="px-5 py-2.5 border border-zinc-200 hover:bg-zinc-50 rounded-xl text-xs font-black uppercase tracking-wider text-zinc-500 transition-colors"
                  >
                    Reset List
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTransferDraft}
                    disabled={transferOutLines.length === 0}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-40"
                  >
                    Save as Draft
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteTransferOut}
                    disabled={submittingTransferOut || transferOutLines.length === 0 || !destBranchId}
                    className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-emerald-500/20 disabled:opacity-45"
                  >
                    {submittingTransferOut ? 'Dispatching...' : 'Confirm & Dispatch Transfer'}
                  </button>
                </div>

                {/* Saved Transfer Drafts Section */}
                <div className="pt-6 border-t border-zinc-200 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="p-1 bg-amber-50 rounded-md text-amber-600">
                      <FileText size={16} />
                    </span>
                    <h4 className="text-sm font-bold text-zinc-900">Saved Dispatch Drafts</h4>
                    <span className="text-[10px] font-bold text-zinc-400 font-mono">({transferDrafts.length})</span>
                  </div>
                  
                  <div className="border border-zinc-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-500">
                          <th className="px-6 py-3">Draft Label / Title</th>
                          <th className="px-6 py-3">Destination Branch</th>
                          <th className="px-6 py-3">Products Count</th>
                          <th className="px-6 py-3">Last Saved</th>
                          <th className="px-6 py-3">Saved By</th>
                          <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 font-medium text-zinc-700">
                        {transferDrafts.map((draft) => {
                          const targetBranch = branches.find(b => b.id === draft.dest_branch_id)?.name || 'HQ Central Store';
                          return (
                            <tr key={draft.id} className="hover:bg-zinc-50/50">
                              <td className="px-6 py-4 font-bold text-zinc-900">{draft.title}</td>
                              <td className="px-6 py-4 text-zinc-500 font-semibold">{targetBranch}</td>
                              <td className="px-6 py-4 text-zinc-500 font-mono">{(draft.lines || []).length} items</td>
                              <td className="px-6 py-4 text-zinc-400 font-mono">{new Date(draft.saved_at).toLocaleString()}</td>
                              <td className="px-6 py-4 text-zinc-700 font-semibold">{draft.saved_by_name || 'Staff'}</td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex justify-end gap-2 text-[10px] font-bold uppercase tracking-wider">
                                  <button
                                    onClick={() => handleLoadTransferDraft(draft)}
                                    className="px-3 py-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors"
                                  >
                                    Load Draft
                                  </button>
                                  <button
                                    onClick={() => handleDeleteTransferDraft(draft.id)}
                                    className="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {transferDrafts.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-6 py-10 text-center text-zinc-400 italic">
                              No saved transfer drafts found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 4: TRANSFER OUT HISTORY */}
        {subTab === 'transfer_history' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-zinc-950 tracking-tight">HQ Store Outward Transfer Ledger</h3>
                <p className="text-xs text-zinc-400 font-medium">Complete historic and real-time tracking of stock batches transferred from HQ central store out to branches.</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button 
                  onClick={handleDownloadHqTransferAggregate}
                  disabled={isAggregating}
                  className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 text-white text-xs font-black uppercase tracking-wider rounded-xl hover:bg-emerald-700 transition-all shadow-sm disabled:opacity-50"
                  title="Download Aggregate Excel"
                >
                  <Download size={13} />
                  Export Aggregate
                </button>

                <div className="flex items-center gap-2 bg-white border border-zinc-200 px-3 py-1.5 rounded-xl min-w-[280px] shadow-sm">
                  <Search size={14} className="text-zinc-400" />
                  <input 
                    type="text" 
                    placeholder="Search ID, source, dest, sender..." 
                    value={hqTransferSearch} 
                    onChange={(e) => setHqTransferSearch(e.target.value)}
                    className="bg-transparent border-none text-xs outline-none w-full placeholder-zinc-400 text-zinc-800"
                  />
                  {hqTransferSearch && (
                    <button onClick={() => setHqTransferSearch('')} className="text-zinc-400 hover:text-zinc-600">
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 bg-white border border-zinc-200 px-3 py-1.5 rounded-xl shadow-sm">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Dates:</span>
                  <input 
                    type="date" 
                    value={hqTransferDateRange.start} 
                    onChange={(e) => setHqTransferDateRange(prev => ({ ...prev, start: e.target.value }))}
                    className="bg-transparent border-none text-xs outline-none focus:ring-0 text-zinc-700 w-[110px]"
                  />
                  <span className="text-xs font-bold text-zinc-400">to</span>
                  <input 
                    type="date" 
                    value={hqTransferDateRange.end} 
                    onChange={(e) => setHqTransferDateRange(prev => ({ ...prev, end: e.target.value }))}
                    className="bg-transparent border-none text-xs outline-none focus:ring-0 text-zinc-700 w-[110px]"
                  />
                </div>
              </div>
            </div>

            <div className="border border-zinc-200 rounded-[2rem] overflow-hidden shadow-sm bg-white">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-500">
                    <th className="px-6 py-4">Transfer Number</th>
                    <th className="px-6 py-4">Destination Branch</th>
                    <th className="px-6 py-4">Dispatch Timestamp</th>
                    <th className="px-6 py-4 text-right">Transfer Sourced Value</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 font-medium text-zinc-700">
                  {displayedHqTransferHistory.map(t => (
                    <tr key={t.id} className="hover:bg-zinc-50/20">
                      <td className="px-6 py-4 font-bold text-zinc-950 font-mono">{t.transfer_number}</td>
                      <td className="px-6 py-4 font-semibold text-zinc-900">{t.destination_branch_name}</td>
                      <td className="px-6 py-4 text-zinc-400 font-mono">{new Date(t.dispatched_at).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-zinc-900">
                        UGX {(t.total_value_ugx || 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={cn(
                          "px-2 py-0.5 rounded-lg text-[9px] uppercase font-black tracking-wider leading-none",
                          t.status === 'fully_accepted' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                          t.status === 'dispatched' ? "bg-blue-50 text-blue-700 border border-blue-100 animate-pulse" :
                          "bg-zinc-100 text-zinc-600"
                        )}>
                          {t.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right flex justify-end gap-2">
                        <button
                          onClick={() => handleOpenHistoryDetail(t, 'transfer')}
                          className="px-3 py-1.5 bg-zinc-50 hover:bg-zinc-100 rounded-lg text-zinc-700 flex items-center gap-1 font-bold transition-all border border-zinc-200"
                        >
                          <Eye size={12} />
                          Details
                        </button>
                        <button
                          onClick={() => handleDownloadTransferCSV(t)}
                          className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg flex items-center gap-1 font-bold transition-all border border-emerald-100"
                        >
                          <Download size={12} />
                          CSV
                        </button>
                      </td>
                    </tr>
                  ))}
                  {displayedHqTransferHistory.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">
                        No previous outward transfers recorded from the HQ Store.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: RECEPTION HISTORY (INWARD GRN LEDGER) */}
        {subTab === 'reception_history' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-zinc-950 tracking-tight">HQ Store Inward GRN / Reception Ledger</h3>
                <p className="text-xs text-zinc-400 font-medium">A chronological log of all stock received at HQ (both direct procurement PO completions and incoming branch returns).</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button 
                  onClick={handleDownloadHqReceptionAggregate}
                  disabled={isAggregating}
                  className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 text-white text-xs font-black uppercase tracking-wider rounded-xl hover:bg-emerald-700 transition-all shadow-sm disabled:opacity-50"
                  title="Download Aggregate Excel"
                >
                  <Download size={13} />
                  Export Aggregate
                </button>

                <div className="flex items-center gap-2 bg-white border border-zinc-200 px-3 py-1.5 rounded-xl min-w-[280px] shadow-sm">
                  <Search size={14} className="text-zinc-400" />
                  <input 
                    type="text" 
                    placeholder="Search ID, source, dest, sender..." 
                    value={hqReceptionSearch} 
                    onChange={(e) => setHqReceptionSearch(e.target.value)}
                    className="bg-transparent border-none text-xs outline-none w-full placeholder-zinc-400 text-zinc-800"
                  />
                  {hqReceptionSearch && (
                    <button onClick={() => setHqReceptionSearch('')} className="text-zinc-400 hover:text-zinc-600">
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 bg-white border border-zinc-200 px-3 py-1.5 rounded-xl shadow-sm">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Dates:</span>
                  <input 
                    type="date" 
                    value={hqReceptionDateRange.start} 
                    onChange={(e) => setHqReceptionDateRange(prev => ({ ...prev, start: e.target.value }))}
                    className="bg-transparent border-none text-xs outline-none focus:ring-0 text-zinc-700 w-[110px]"
                  />
                  <span className="text-xs font-bold text-zinc-400">to</span>
                  <input 
                    type="date" 
                    value={hqReceptionDateRange.end} 
                    onChange={(e) => setHqReceptionDateRange(prev => ({ ...prev, end: e.target.value }))}
                    className="bg-transparent border-none text-xs outline-none focus:ring-0 text-zinc-700 w-[110px]"
                  />
                </div>
              </div>
            </div>

            <div className="border border-zinc-200 rounded-[2rem] overflow-hidden shadow-sm bg-white">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-500">
                    <th className="px-6 py-4">Reference ID</th>
                    <th className="px-6 py-4">Stock Source / Branch</th>
                    <th className="px-6 py-4">Received Date</th>
                    <th className="px-6 py-4 text-right font-mono">Value (UGX)</th>
                    <th className="px-6 py-4 text-center">GRN Type</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 font-medium text-zinc-700">
                  {displayedHqReceptionHistory.map((item, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50/20">
                      <td className="px-6 py-4 font-bold text-zinc-950 font-mono">{item.ref_number}</td>
                      <td className="px-6 py-4 font-semibold text-zinc-900">{item.source}</td>
                      <td className="px-6 py-4 text-zinc-400 font-mono">{new Date(item.date).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-zinc-950">
                        UGX {(item.value || 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={cn(
                          "px-2.5 py-0.5 rounded-lg text-[9px] uppercase font-black tracking-wider leading-none border",
                          item.type === 'sourced_receipt' ? "bg-purple-50 text-purple-700 border-purple-100" :
                          "bg-amber-50 text-amber-700 border-amber-100"
                        )}>
                          {item.type === 'sourced_receipt' ? 'Direct Sourced GRN' : 'Branch Return Accepted'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleOpenHistoryDetail(item.originalData, item.type)}
                          className="px-4 py-1.5 bg-zinc-50 hover:bg-zinc-100 rounded-lg text-zinc-700 border border-zinc-200 font-bold transition-all flex items-center gap-1.5 ml-auto"
                        >
                          <Eye size={12} />
                          Review GRN
                        </button>
                      </td>
                    </tr>
                  ))}
                  {displayedHqReceptionHistory.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">
                        No goods receipt records found in the inward ledger.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* History item viewer modal */}
      {viewHistoryModal && viewHistoryModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-sans text-xs">
          <div className="bg-white text-zinc-900 rounded-3xl w-full max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl p-5 sm:p-8 animate-fade-in leading-normal">
            <div className="flex justify-between items-start border-b border-zinc-200 pb-4">
              <div>
                <span className="text-xs uppercase font-black tracking-widest text-emerald-600 font-mono">HQ Store Audit Ledger Record</span>
                <h3 className="text-xl font-bold text-zinc-950 mt-1">{viewHistoryModal.title}</h3>
              </div>
              <button 
                onClick={() => setViewHistoryModal(null)}
                className="text-zinc-600 hover:text-zinc-600 p-1.5 hover:bg-zinc-100 rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="my-5 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-zinc-50 p-4 rounded-2xl border border-zinc-200">
              <div>
                <span className="text-xs font-black text-zinc-600 uppercase tracking-widest block">Metadata Stream</span>
                <span className="font-bold text-zinc-800 text-xs mt-1 block">{viewHistoryModal.meta.originDest}</span>
                <span className="text-zinc-500 font-mono text-xs mt-0.5 block break-all">{viewHistoryModal.meta.date}</span>
              </div>
              <div>
                <span className="text-xs font-black text-zinc-600 uppercase tracking-widest block">Authorized Signatory</span>
                <span className="font-bold text-zinc-800 text-xs mt-1 block">Officer ID: {viewHistoryModal.meta.operator}</span>
                {viewHistoryModal.meta.notes && (
                  <span className="text-zinc-600 italic text-xs mt-0.5 block">"{viewHistoryModal.meta.notes}"</span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-black uppercase text-zinc-600 tracking-wider font-mono">Cataloged Items ({viewHistoryModal.items.length})</h4>
              <div className="border border-zinc-200 rounded-2xl overflow-auto max-h-[50dvh]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-500 text-xs tracking-wider uppercase">
                      <th className="px-4 py-2">Item</th>
                      <th className="px-4 py-2 text-center">Batch ID</th>
                      <th className="px-4 py-2 text-center">Qty</th>
                      <th className="px-4 py-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 font-medium">
                    {viewHistoryModal.items.map((line, idx) => (
                      <tr key={idx} className="text-zinc-700">
                        <td className="px-4 py-3 font-bold text-zinc-950">{line.name}</td>
                        <td className="px-4 py-3 text-center font-mono text-[11px] font-bold text-zinc-600">{line.batch || 'N/A'}</td>
                        <td className="px-4 py-3 text-center text-zinc-950 font-bold">{line.qty}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold">UGX {(line.qty * line.price).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end pt-5 border-t border-zinc-200 mt-5">
              <button
                type="button"
                onClick={() => setViewHistoryModal(null)}
                className="px-6 py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors"
              >
                Close Audit Record
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Procurement;
