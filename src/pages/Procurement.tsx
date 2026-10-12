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
import { processOperationalGrn } from '../services/operationalGrnService';
import { dispatchOperationalOrderToBranch, dispatchPreparedOperationalHqTransfer, fulfillOperationalOrderFromHqStore } from '../services/operationalTransferService';
import { AutoGenerateOrderModal } from '../components/inventory/AutoGenerateOrderModal';
import { isBranchReturnToHq, isHqProcurementDelivery, receiveHqTransfer } from '../services/hqStockReceiptService';
import { isOperationalInventoryRecord } from '../services/inventoryClassification';
import { useOperationalInventoryFeature } from '../hooks/useOperationalInventoryFeature';
import OperationalHQStoreTab from '../components/procurement/OperationalHQStoreTab';

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
  const [selectedOrder, setSelectedOrder] = useState<StockOrder | null>(null);
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
            order.requesting_branch_name || order.requesting_branch_id || '',
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
                    <div class="meta-value">${order.requesting_branch_name || order.requesting_branch_id}</div>
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
                <td className="px-6 py-4 text-sm text-zinc-600">{order.requesting_branch_name || order.requesting_branch_id}</td>
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
              className="bg-emerald-600 hover:bg-emerald-750 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all"
            >
              <Download size={14} />
              Download Audit Report
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-150 font-bold text-zinc-500">
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
      firestoreService.subscribeToCollection<InstitutionRegistry>('supplier_registry', profile.tenantId, setSuppliers);
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

  const eligibleSuppliers = isOperationalOrder
    ? suppliers.filter(supplier => supplier.inventoryCapabilities?.includes('NON_SELLABLE_OPERATIONAL'))
    : suppliers;

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
              <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full font-bold">{isOperationalOrder ? 'Operational stock is kept i…62152 tokens truncated…ne.qty_accepted ?? line.qty_received ?? line.qty_dispatched ?? 0}</span>
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
                    disabled={!canOperateReception || invoiceLinesLoading || !!invoiceLinesError || invoiceLines.length === 0}
                    className="px-8 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-colors shadow-lg shadow-emerald-500/20 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none"
                  >
                    Confirm Reception
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
    return firestoreService.subscribeToCollection<OperationalInventory>('operational_inventory', profile.tenantId, rows => setItems(rows.filter(row => row.branchId === activeBranchId && row.inventoryClass === 'OPERATIONAL' && row.masterItemId)));
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

const OperationalBranchReceiptQueue: React.FC = () => {
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
        { field: 'transferId', operator: '==', value: transfer.id }
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

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white shadow-sm overflow-hidden">
      <div className="p-5 border-b border-emerald-100 bg-emerald-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h3 className="font-black text-emerald-950">Operational Inventory Receipts</h3><p className="mt-1 text-xs text-emerald-800">Separate from sellable Stock In. Accepted units post to this branch’s Operational ledger.</p></div>
        <div className="flex rounded-xl bg-white border border-emerald-100 p-1 w-fit">
          <button onClick={() => setShowHistory(false)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${!showHistory ? 'bg-emerald-700 text-white' : 'text-zinc-500'}`}>Pending</button>
          <button onClick={() => setShowHistory(true)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${showHistory ? 'bg-emerald-700 text-white' : 'text-zinc-500'}`}>History</button>
        </div>
      </div>
      <div className="divide-y divide-zinc-100">
        {visibleTransfers.map(transfer => <div key={transfer.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div><p className="font-bold text-zinc-900">{transfer.transferNumber}</p><p className="text-xs text-zinc-500">From HQ Operational Store · {transfer.sourceOrderNumber || 'HQ distribution'} · {transfer.status.replace(/_/g, ' ')}</p></div>
          <button onClick={() => void openTransfer(transfer)} className="px-4 py-2 rounded-xl border border-emerald-200 text-emerald-800 text-xs font-black hover:bg-emerald-50">{showHistory ? 'View receipt' : canReceive ? 'Receive & verify' : 'View details'}</button>
        </div>)}
        {visibleTransfers.length === 0 && <p className="p-8 text-center text-sm text-zinc-400">{showHistory ? 'No Operational receipt history for this branch.' : 'No Operational transfers are awaiting receipt.'}</p>}
      </div>

      {selectedTransfer && <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col">
          <div className="p-5 border-b border-zinc-100"><p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Operational Inventory Transfer</p><h3 className="mt-1 text-xl font-black text-zinc-900">{selectedTransfer.transferNumber}</h3><p className="text-xs text-zinc-500">{selectedTransfer.sourceOrderNumber || 'HQ distribution'} → {selectedTransfer.destinationBranchName || activeBranchId}</p></div>
          <div className="p-5 overflow-y-auto flex-1">
            {loading ? <p className="py-8 text-center text-sm text-zinc-500">Loading transfer lines…</p> : <div className="overflow-x-auto border border-zinc-200 rounded-xl">
              <table className="w-full text-left"><thead className="bg-zinc-50 text-[10px] uppercase text-zinc-500"><tr><th className="p-3">Operational item</th><th className="p-3">Dispatched</th><th className="p-3">Accepted</th><th className="p-3">Queried</th><th className="p-3">Reason</th></tr></thead>
                <tbody className="divide-y divide-zinc-100">{lines.map(line => {
                  const values = receiptValues[line.id] || { accepted: 0, queried: 0, reason: '' };
                  const readOnly = showHistory || line.status !== 'dispatched' || !canReceive;
                  return <tr key={line.id}>
                    <td className="p-3"><p className="font-bold text-sm text-zinc-900">{line.itemName}</p><p className="text-[10px] text-zinc-500">{line.masterItemId}</p></td>
                    <td className="p-3 text-sm font-bold">{line.quantityDispatched} {line.unitOfIssue}</td>
                    <td className="p-3"><input aria-label={`Accepted quantity ${line.itemName}`} type="number" min="0" max={line.quantityDispatched} step="any" disabled={readOnly} value={values.accepted} onChange={event => { const accepted = Math.max(0, Number(event.target.value)); setReceiptValues(prev => ({ ...prev, [line.id]: { ...prev[line.id], accepted, queried: Math.max(0, line.quantityDispatched - accepted) } })); }} className="w-24 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm" /></td>
                    <td className="p-3"><input aria-label={`Queried quantity ${line.itemName}`} type="number" readOnly disabled={readOnly} value={values.queried} className="w-24 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm" /></td>
                    <td className="p-3">{values.queried > 0 && <select disabled={readOnly} value={values.reason} onChange={event => setReceiptValues(prev => ({ ...prev, [line.id]: { ...prev[line.id], reason: event.target.value } }))} className="max-w-48 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"><option value="">Select reason</option><option value="wrong_item">Wrong item</option><option value="damaged">Damaged</option><option value="short_quantity">Short quantity</option><option value="quality_query">Quality query</option><option value="other">Other</option></select>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>}
          </div>
          <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-between items-center gap-3"><p className="text-[11px] text-zinc-500">Queried units are excluded from branch SOH and remain linked to this transfer.</p><div className="flex gap-2"><button onClick={() => setSelectedTransfer(null)} disabled={submitting} className="px-4 py-2 rounded-xl border border-zinc-200 text-xs font-bold">Close</button>{!showHistory && <button onClick={() => void submitReceipt()} disabled={!canReceive || loading || submitting || lines.every(line => line.status !== 'dispatched')} className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-black disabled:opacity-40">{submitting ? 'Saving…' : 'Confirm Operational receipt'}</button>}</div></div>
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
                            className="px-3 py-1 bg-zinc-100 text-zinc-650 hover:bg-zinc-200 rounded-lg transition-colors flex items-center gap-1 font-sans"
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
                className="text-zinc-400 hover:text-zinc-650 transition-colors p-2 hover:bg-zinc-100 rounded-full"
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
                className="text-zinc-400 hover:text-zinc-650 transition-colors p-2 hover:bg-zinc-100 rounded-full"
              >
                <Plus className="rotate-45" size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto text-zinc-800">
              <div className="grid grid-cols-2 gap-4 bg-zinc-50 p-4 rounded-2xl border border-zinc-150 text-xs">
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
                className="px-6 py-2 border border-zinc-200 hover:bg-zinc-100 rounded-xl font-bold text-zinc-650 text-xs uppercase tracking-wider transition-colors"
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
