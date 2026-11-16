import { adjustSellableStock } from '../../services/stockAdjustmentService';
import React, { useState, useEffect, useId, useRef } from 'react';
import { X, Package, TrendingUp, History, Activity, Edit3, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Product, ProductBatch, InventoryMovement, SystemSettings } from '../../types';
import { firestoreService } from '../../services/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { subMonths } from 'date-fns';
import { formatDateValue } from '../../utils/dateValue';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { toast } from 'sonner';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ProductStockcardProps {
  product: Product;
  onClose: () => void;
}

const ProductStockcard: React.FC<ProductStockcardProps> = ({ product, onClose }) => {
  const { profile, activeBranchId, hasPermission } = useAuth();
  const canOperateInventory = hasPermission('inventory', 'operate');
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeTab, setActiveTab] = useState<'batches' | 'movement' | 'intel'>('batches');
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Adjustment State
  const [adjustingBatch, setAdjustingBatch] = useState<ProductBatch | null>(null);
  const [adjustmentQty, setAdjustmentQty] = useState<number>(0);
  const [adjustmentReason, setAdjustmentReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    if (!profile?.tenantId || !product.id || !activeBranchId) return;

    setLoading(true);

    // 1. Fetch settings
    firestoreService.getCollection<any>('system_settings', profile.tenantId).then(docs => {
      if (docs.length > 0) setSettings(docs[0]);
    });

    // 2. Subscribe to batches for this tenant
    const unsubscribeBatches = firestoreService.subscribeToCollection<ProductBatch>(
      'product_batches',
      profile.tenantId,
      (data) => {
        const productBatches = data.filter(b => 
          b.productId === product.id && 
          b.branchId === activeBranchId
        );
        setBatches(productBatches);
        setLoading(false);
      }
    );

    // 3. Subscribe to movements for this product in this branch
    const unsubscribeMovements = firestoreService.subscribeToCollection<InventoryMovement>(
      'inventory_movements',
      profile.tenantId,
      (data) => {
        const filtered = data
          .filter(m => m.productId === product.id && m.branchId === activeBranchId)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setMovements(filtered);
      }
    );

    return () => {
      unsubscribeBatches();
      unsubscribeMovements();
    };
  }, [profile?.tenantId, activeBranchId, product.id]);

  const handleAdjustStock = async () => {
    if (!adjustingBatch || !profile?.tenantId || !activeBranchId) return;
    
    setIsSubmitting(true);
    try {
      const changed = await adjustSellableStock({
        tenantId: profile.tenantId, branchId: activeBranchId, productId: product.id, batchId: adjustingBatch.id,
        quantity: adjustmentQty, expectedQuantity: adjustingBatch.quantity, reason: adjustmentReason,
        actorId: profile.uid, actorName: profile.full_name || profile.username || 'System',
      });
      if (changed) toast.success('Stock adjusted successfully');
      setAdjustingBatch(null);
      setAdjustmentReason('');
    } catch (error) {
      console.error('Error adjusting stock:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to adjust stock');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getConsumptionClass = () => {
    const threeMonthsAgo = subMonths(new Date(), 3);
    
    const recentSales = movements
      .filter(m => (m.movementClass === 'sale' || m.class === 'sale') && new Date(m.timestamp) > threeMonthsAgo)
      .reduce((acc, curr) => acc + (curr.amount || 0), 0);

    const avgMonthlySales = recentSales / 3;
    
    const thresholds = settings?.operationalConfig?.inventory?.consumptionThresholds || {
      fast: 7,
      moderate: 3,
      slow: 1
    };

    if (avgMonthlySales >= thresholds.fast) return { label: 'Fast Moving', color: 'text-emerald-600 bg-emerald-50 border-emerald-100', value: avgMonthlySales };
    if (avgMonthlySales >= thresholds.moderate) return { label: 'Moderate Moving', color: 'text-blue-600 bg-blue-50 border-blue-100', value: avgMonthlySales };
    if (avgMonthlySales >= thresholds.slow) return { label: 'Slow Moving', color: 'text-amber-600 bg-amber-50 border-amber-100', value: avgMonthlySales };
    return { label: 'Dead Stock', color: 'text-red-600 bg-red-50 border-red-100', value: avgMonthlySales };
  };

  const consumption = getConsumptionClass();

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (adjustingBatch) setAdjustingBatch(null);
        else onClose();
      }}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%_-_1rem)] max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl open:flex backdrop:bg-zinc-950/40 backdrop:backdrop-blur-sm sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%_-_2rem)] sm:rounded-[32px]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close product details"
        className="absolute right-2 top-2 z-10 grid h-11 w-11 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-100 sm:right-4 sm:top-4"
      >
        <X size={22} aria-hidden="true" />
      </button>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <header className="flex min-w-0 items-start gap-3 border-b border-zinc-100 bg-zinc-50 px-3 py-4 pr-16 sm:gap-4 sm:p-6 sm:pr-20">
          <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white sm:flex">
            <Package size={24} aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-2">
            <h2 id={titleId} className="text-base font-black text-zinc-900 [overflow-wrap:anywhere] sm:text-xl">{product.name}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-zinc-600 [overflow-wrap:anywhere]">
              <span>{product.sku}</span>
              <span>{product.category}</span>
              {product.unitOfSell && <span className="text-emerald-700">Sell by: {product.unitOfSell}</span>}
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", consumption.color)}>
                {consumption.label}
              </span>
            </div>
          </div>
        </header>

        <div className="p-3 sm:p-6">
          <nav aria-label="Product detail sections" className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1 sm:w-fit">
            {([
              { id: 'batches', label: 'Active Batches', Icon: History },
              { id: 'movement', label: 'Movement Tracker', Icon: TrendingUp },
              { id: 'intel', label: 'Consumption Intel', Icon: Activity },
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1 py-2 text-center text-xs font-bold sm:px-4",
                  activeTab === id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                )}
              >
                <Icon size={14} className="hidden shrink-0 sm:block" aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
            </div>
          ) : (
            <>
              {activeTab === 'batches' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {batches.map(batch => (
                      <div key={batch.id} className="min-w-0 space-y-3 rounded-2xl border border-zinc-100 bg-zinc-50 p-3 sm:p-5">
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0 [overflow-wrap:anywhere]">
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Batch Number</p>
                            <p className="font-bold text-zinc-900">{batch.batchNumber}</p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className={cn(
                              "px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest",
                              batch.batch_status === 'active' ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"
                            )}>
                              {batch.batch_status}
                            </span>
                            {canOperateInventory && (
                              <button
                                type="button"
                                aria-label={`Adjust batch ${batch.batchNumber}`}
                                onClick={() => {
                                  setAdjustingBatch(batch);
                                  setAdjustmentQty(batch.quantity);
                                }}
                                className="grid h-11 w-11 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-800 hover:text-emerald-700 hover:border-emerald-200"
                              >
                                <Edit3 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Quantity</p>
                            <p className="text-lg font-black text-zinc-900">{batch.quantity}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Expiry</p>
                            <p className="text-sm font-bold text-red-600">{formatDateValue(batch.expiryDate, 'MMM dd, yyyy')}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-zinc-200/50">
                          <div>
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cost Price</p>
                            <p className="text-xs font-bold text-zinc-600">{batch.purchasePrice?.toLocaleString() || '0'} UGX</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Supplier</p>
                            <p className="text-xs font-bold text-zinc-600 [overflow-wrap:anywhere]">{batch.supplier || batch.supplierName || 'Unknown'}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {batches.length === 0 && (
                      <div className="col-span-full py-12 text-center text-zinc-400 italic">
                        No active batches found for this branch.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'movement' && (
                <div className="bg-white rounded-3xl border border-zinc-100 overflow-hidden shadow-sm">
                  <table role="table" aria-label="Stock movements" className="block w-full min-w-0! border-collapse text-left lg:table lg:table-fixed">
                    <thead className="hidden lg:table-header-group">
                      <tr className="bg-zinc-50/50 border-b border-zinc-100">
                        <th className="lg:px-3 lg:py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Time</th>
                        <th className="lg:px-3 lg:py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Reference</th>
                        <th className="lg:px-3 lg:py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Class</th>
                        <th className="lg:px-3 lg:py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Initiator</th>
                        <th className="lg:px-3 lg:py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Receiver</th>
                        <th className="lg:px-3 lg:py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Qty</th>
                        <th className="lg:px-3 lg:py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup" className="block divide-y divide-zinc-100 lg:table-row-group">
                      {movements.map(m => (
                        <tr key={m.id} role="row" className="grid min-w-0 grid-cols-2 gap-2 p-3 [overflow-wrap:anywhere] lg:table-row lg:p-0">
                          <td role="cell" className="lg:px-3 lg:py-3 text-xs font-medium text-zinc-600">
                            {formatDateValue(m.timestamp, 'MMM dd, HH:mm')}
                          </td>
                          <td role="cell" className="lg:px-3 lg:py-3 text-xs font-bold text-zinc-900">{m.reference}</td>
                          <td role="cell" className="lg:px-3 lg:py-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest",
                              (m.movementClass === 'sale' || m.class === 'sale') ? "bg-emerald-100 text-emerald-700" :
                              (m.movementClass === 'adjustment' || m.class === 'adjustment') ? "bg-amber-100 text-amber-700" :
                              "bg-blue-100 text-blue-700"
                            )}>
                              {m.movementClass || m.class}
                            </span>
                          </td>
                          <td role="cell" className="lg:px-3 lg:py-3 text-xs text-zinc-500"><span className="font-semibold lg:hidden">From: </span>{m.initiator}</td>
                          <td role="cell" className="lg:px-3 lg:py-3 text-xs text-zinc-500"><span className="font-semibold lg:hidden">To: </span>{m.receiver || 'N/A'}</td>
                          <td role="cell" className={cn(
                            "lg:px-3 lg:py-3 text-xs font-black lg:text-right",
                            m.type === 'in' ? "text-emerald-600" : "text-red-600"
                          )}>
                            <span className="text-zinc-600 lg:hidden">Qty: </span>{m.type === 'in' ? `+${m.amount}` : `-${m.amount}`}
                          </td>
                          <td role="cell" className="lg:px-3 lg:py-3 text-xs font-bold text-zinc-900 text-right">
                            <span className="text-zinc-600 lg:hidden">Value: </span>{(m.amountAttached || 0).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      {movements.length === 0 && (
                        <tr role="row" className="block lg:table-row">
                          <td role="cell" colSpan={7} className="block px-3 py-12 lg:table-cell text-center text-zinc-400 italic">
                            No movement records found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'intel' && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
                  <div className="min-w-0 space-y-4 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 sm:p-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-black text-zinc-900 uppercase tracking-widest">Consumption Analysis</h3>
                      <Activity size={20} className="text-emerald-500" />
                    </div>
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Current Status</p>
                        <span className={cn("px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest border", consumption.color)}>
                          {consumption.label}
                        </span>
                      </div>
                      <div className="h-2 w-full bg-zinc-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-emerald-500 transition-all duration-500" 
                          style={{ width: `${Math.min((consumption.value / (settings?.operationalConfig?.inventory?.consumptionThresholds?.fast || 7)) * 100, 100)}%` }}
                        />
                      </div>
                      <div className="p-4 bg-white rounded-2xl border border-zinc-100 space-y-2">
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Avg. Monthly Sales (3M)</p>
                        <p className="text-lg font-black text-zinc-900">{consumption.value.toFixed(1)} Packs</p>
                      </div>
                      <p className="text-[10px] text-zinc-400 leading-relaxed italic">
                        Classification is based on average monthly sales volume over the last 3 months.
                      </p>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-4 rounded-2xl bg-zinc-900 p-4 text-white sm:p-6 shadow-xl shadow-zinc-900/20">
                    <h3 className="text-sm font-black text-white/50 uppercase tracking-widest">Quick Stats</h3>
                    <div className="grid grid-cols-2 gap-2 sm:gap-4">
                      <div className="min-w-0 p-2 sm:p-4 [overflow-wrap:anywhere] bg-white/5 rounded-2xl border border-white/10">
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Total Sold (All Time)</p>
                        <p className="text-2xl font-black text-white">
                          {Math.abs(movements.filter(m => m.movementClass === 'sale' || m.class === 'sale').reduce((acc, curr) => acc + curr.amount, 0))}
                        </p>
                      </div>
                      <div className="min-w-0 p-2 sm:p-4 [overflow-wrap:anywhere] bg-white/5 rounded-2xl border border-white/10">
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Avg. Monthly Sales</p>
                        <p className="text-2xl font-black text-white">
                          {consumption.value.toFixed(1)}
                        </p>
                      </div>
                      <div className="min-w-0 p-2 sm:p-4 [overflow-wrap:anywhere] bg-white/5 rounded-2xl border border-white/10">
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Last Sale</p>
                        <p className="text-xs font-bold text-white">
                          {movements.find(m => m.movementClass === 'sale' || m.class === 'sale') 
                            ? formatDateValue(movements.find(m => m.movementClass === 'sale' || m.class === 'sale')!.timestamp, 'MMM dd, yyyy')
                            : 'Never'}
                        </p>
                      </div>
                      <div className="min-w-0 p-2 sm:p-4 [overflow-wrap:anywhere] bg-white/5 rounded-2xl border border-white/10">
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Total Adjustments</p>
                        <p className="text-2xl font-black text-white">
                          {movements.filter(m => m.movementClass === 'adjustment' || m.class === 'adjustment').length}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Adjustment Modal */}
      {canOperateInventory && adjustingBatch && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-md">
          <div className="max-h-[calc(100dvh-2rem)] w-full min-w-0 max-w-md space-y-4 overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 shadow-2xl sm:p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center">
                <AlertCircle size={24} />
              </div>
              <div>
                <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">Adjust Stock</h3>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Batch: {adjustingBatch.batchNumber}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 block">New Quantity</label>
                <input
                  type="number"
                  value={adjustmentQty}
                  onChange={(e) => setAdjustmentQty(parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-bold"
                />
                <p className="mt-1 text-[10px] text-zinc-400 italic">Current: {adjustingBatch.quantity}</p>
              </div>

              <div>
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 block">Reason for Adjustment</label>
                <textarea
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="e.g., Cycle count, damaged goods, expired..."
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium text-sm min-h-[100px]"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setAdjustingBatch(null)}
                className="flex-1 px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-zinc-500 hover:bg-zinc-100 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAdjustStock}
                disabled={isSubmitting}
                className="flex-1 px-6 py-3 bg-emerald-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    Confirm
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
};

export default ProductStockcard;
