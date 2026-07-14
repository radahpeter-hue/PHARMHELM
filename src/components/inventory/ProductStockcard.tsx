import React, { useState, useEffect } from 'react';
import { X, Package, TrendingUp, History, Activity, Edit3, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Product, ProductBatch, InventoryMovement, SystemSettings } from '../../types';
import { firestoreService } from '../../services/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { format, subMonths } from 'date-fns';
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
  const { profile, activeBranchId } = useAuth();
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
      const diff = adjustmentQty - adjustingBatch.quantity;
      if (diff === 0) {
        setAdjustingBatch(null);
        return;
      }

      const timestamp = new Date().toISOString();
      const adjustmentId = `ADJ-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

      // 1. Update Batch Quantity
      await firestoreService.updateDocument(
        'product_batches',
        adjustingBatch.id,
        { 
          quantity: adjustmentQty,
          lastUpdated: timestamp
        }
      );

      // 2. Create Movement Record
      const movement: Omit<InventoryMovement, 'id'> = {
        tenantId: profile.tenantId,
        branchId: activeBranchId,
        productId: product.id,
        batchId: adjustingBatch.id,
        timestamp,
        reference: adjustmentId,
        movementClass: 'adjustment',
        class: 'adjustment',
        type: diff > 0 ? 'in' : 'out',
        initiator: profile.full_name || profile.username || 'System',
        initiatorId: profile.uid,
        receiver: 'System Adjustment',
        amount: Math.abs(diff),
        amountAttached: (adjustingBatch.purchasePrice || 0) * Math.abs(diff),
        batchNumber: adjustingBatch.batchNumber,
        notes: adjustmentReason || 'Manual stock adjustment'
      };

      const movementId = await firestoreService.addDocument('inventory_movements', movement);

      // 3. Update local state
      setBatches(prev => prev.map(b => b.id === adjustingBatch.id ? { ...b, quantity: adjustmentQty } : b));
      setMovements(prev => [{ id: movementId, ...movement } as InventoryMovement, ...prev]);
      
      toast.success('Stock adjusted successfully');
      setAdjustingBatch(null);
      setAdjustmentReason('');
    } catch (error) {
      console.error('Error adjusting stock:', error);
      toast.error('Failed to adjust stock');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-5xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 bg-emerald-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Package size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">{product.name}</h2>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{product.sku}</span>
                <span className="h-1 w-1 bg-zinc-300 rounded-full" />
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{product.category}</span>
                <span className="h-1 w-1 bg-zinc-300 rounded-full" />
                <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Sell by: {product.unitOfSell}</span>
                <span className="h-1 w-1 bg-zinc-300 rounded-full" />
                <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border", consumption.color)}>
                  {consumption.label}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <X size={24} className="text-zinc-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-zinc-100 mx-8 mt-6 rounded-2xl w-fit">
          <button
            onClick={() => setActiveTab('batches')}
            className={cn(
              "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
              activeTab === 'batches' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <History size={14} />
            Active Batches
          </button>
          <button
            onClick={() => setActiveTab('movement')}
            className={cn(
              "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
              activeTab === 'movement' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <TrendingUp size={14} />
            Movement Tracker
          </button>
          <button
            onClick={() => setActiveTab('intel')}
            className={cn(
              "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
              activeTab === 'intel' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <Activity size={14} />
            Consumption Intel
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
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
                      <div key={batch.id} className="p-5 bg-zinc-50 border border-zinc-100 rounded-3xl space-y-3 group relative overflow-hidden">
                        <div className="flex justify-between items-start">
                          <div>
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
                            <button 
                              onClick={() => {
                                setAdjustingBatch(batch);
                                setAdjustmentQty(batch.quantity);
                              }}
                              className="p-2 bg-white border border-zinc-200 rounded-xl text-zinc-400 hover:text-emerald-600 hover:border-emerald-200 transition-all shadow-sm opacity-0 group-hover:opacity-100"
                            >
                              <Edit3 size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Quantity</p>
                            <p className="text-lg font-black text-zinc-900">{batch.quantity}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Expiry</p>
                            <p className="text-sm font-bold text-red-600">{format(new Date(batch.expiryDate), 'MMM dd, yyyy')}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-zinc-200/50">
                          <div>
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cost Price</p>
                            <p className="text-xs font-bold text-zinc-600">{batch.purchasePrice?.toLocaleString() || '0'} UGX</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Supplier</p>
                            <p className="text-xs font-bold text-zinc-600 truncate">{batch.supplier || batch.supplierName || 'Unknown'}</p>
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
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-zinc-50/50 border-b border-zinc-100">
                        <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Time</th>
                        <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Reference</th>
                        <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Class</th>
                        <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Initiator</th>
                        <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Receiver</th>
                        <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Qty</th>
                        <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {movements.map(m => (
                        <tr key={m.id} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="px-6 py-4 text-xs font-medium text-zinc-600">
                            {format(new Date(m.timestamp), 'MMM dd, HH:mm')}
                          </td>
                          <td className="px-6 py-4 text-xs font-bold text-zinc-900">{m.reference}</td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest",
                              (m.movementClass === 'sale' || m.class === 'sale') ? "bg-emerald-100 text-emerald-700" :
                              (m.movementClass === 'adjustment' || m.class === 'adjustment') ? "bg-amber-100 text-amber-700" :
                              "bg-blue-100 text-blue-700"
                            )}>
                              {m.movementClass || m.class}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-xs text-zinc-500">{m.initiator}</td>
                          <td className="px-6 py-4 text-xs text-zinc-500">{m.receiver || 'N/A'}</td>
                          <td className={cn(
                            "px-6 py-4 text-xs font-black text-right",
                            m.type === 'in' ? "text-emerald-600" : "text-red-600"
                          )}>
                            {m.type === 'in' ? `+${m.amount}` : `-${m.amount}`}
                          </td>
                          <td className="px-6 py-4 text-xs font-bold text-zinc-900 text-right">
                            {(m.amountAttached || 0).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      {movements.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-zinc-400 italic">
                            No movement records found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'intel' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="p-8 bg-zinc-50 rounded-[32px] border border-zinc-100 space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-black text-zinc-900 uppercase tracking-widest">Consumption Analysis</h3>
                      <Activity size={20} className="text-emerald-500" />
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
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
                  
                  <div className="p-8 bg-zinc-900 text-white rounded-[32px] space-y-6 shadow-xl shadow-zinc-900/20">
                    <h3 className="text-sm font-black text-white/50 uppercase tracking-widest">Quick Stats</h3>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Total Sold (All Time)</p>
                        <p className="text-2xl font-black text-white">
                          {Math.abs(movements.filter(m => m.movementClass === 'sale' || m.class === 'sale').reduce((acc, curr) => acc + curr.amount, 0))}
                        </p>
                      </div>
                      <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Avg. Monthly Sales</p>
                        <p className="text-2xl font-black text-white">
                          {consumption.value.toFixed(1)}
                        </p>
                      </div>
                      <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Last Sale</p>
                        <p className="text-xs font-bold text-white">
                          {movements.find(m => m.movementClass === 'sale' || m.class === 'sale') 
                            ? format(new Date(movements.find(m => m.movementClass === 'sale' || m.class === 'sale')!.timestamp), 'MMM dd, yyyy')
                            : 'Never'}
                        </p>
                      </div>
                      <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
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

        {/* Adjustment Modal */}
        {adjustingBatch && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-md">
            <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden p-8 space-y-6">
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
      </div>
    </div>
  );
};

export default ProductStockcard;
