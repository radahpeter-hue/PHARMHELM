import React, { useState, useEffect } from 'react';
import { Plus, Search, ArrowLeftRight, ClipboardList, Package, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { Product, ProductBatch, InventoryMovement } from '../../types';
import { firestoreService } from '../../services/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
import { db } from '../../firebase';
import { doc, runTransaction } from 'firebase/firestore';
import { logMovementAndAggregateInTx, getBranchProductBatchRefs } from '../../services/consumptionService';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const StockManagementTab: React.FC = () => {
  const { profile, activeBranchId } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'adjustments' | 'transfers'>('adjustments');
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubscribeProducts = firestoreService.subscribeToCollection<Product>(
        'products',
        profile.tenantId,
        setProducts
      );
      
      // Subscribe to inventory movements directly
      const unsubscribeMovements = firestoreService.subscribeToCollection<InventoryMovement>(
        'inventory_movements',
        profile.tenantId,
        (data) => {
          const filtered = data.filter(m => 
            (m.movementClass === 'adjustment' || m.class === 'adjustment' || m.movementClass === 'transfer out' || m.movementClass === 'transfer in' || m.class === 'transfer') &&
            (m.branchId === activeBranchId || m.receiverId === activeBranchId)
          );
          
          setMovements(filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
        }
      );
      return () => {
        unsubscribeProducts();
        unsubscribeMovements();
      };
    }
  }, [profile?.tenantId, activeBranchId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-1 bg-zinc-100 rounded-2xl w-fit">
          <button
            onClick={() => setActiveSubTab('adjustments')}
            className={cn(
              "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
              activeSubTab === 'adjustments' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            Stock Adjustments
          </button>
          <button
            onClick={() => setActiveSubTab('transfers')}
            className={cn(
              "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
              activeSubTab === 'transfers' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            Branch Transfers
          </button>
        </div>
        <div className="flex gap-3">
          {activeSubTab === 'adjustments' ? (
            <button 
              onClick={() => setIsAdjustmentModalOpen(true)}
              className="px-4 py-2 bg-zinc-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest flex items-center gap-2"
            >
              <ClipboardList size={16} />
              New Adjustment
            </button>
          ) : (
            <button 
              onClick={() => setIsTransferModalOpen(true)}
              className="px-4 py-2 bg-zinc-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest flex items-center gap-2"
            >
              <ArrowLeftRight size={16} />
              New Transfer
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-100 bg-zinc-50/30">
          <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest">Recent Activity</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Time</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Item</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Type</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Reference</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Amount</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {movements
                .filter(m => {
                  if (activeSubTab === 'adjustments') return m.class === 'adjustment';
                  return m.class === 'transfer';
                })
                .map(movement => {
                  const product = products.find(p => p.id === movement.productId);
                  
                  return (
                    <tr key={movement.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-6 py-4 text-xs font-medium text-zinc-600">
                        {format(new Date(movement.timestamp), 'MMM dd, HH:mm')}
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-bold text-zinc-900">{product?.name || 'Unknown'}</p>
                        {movement.batchNumber && <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Batch: {movement.batchNumber}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest",
                          movement.class === 'adjustment' ? "bg-amber-100 text-amber-700" : 
                          "bg-indigo-100 text-indigo-700"
                        )}>
                          {movement.class}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-zinc-500">
                        {movement.reference}
                      </td>
                      <td className={cn(
                        "px-6 py-4 text-xs font-black text-right",
                        movement.type === 'in' ? "text-emerald-600" : "text-red-600"
                      )}>
                        {movement.type === 'in' ? '+' : '-'}{movement.amount}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-emerald-600">
                          <CheckCircle2 size={14} />
                          <span className="text-[10px] font-black uppercase tracking-widest">Completed</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              {movements.filter(m => activeSubTab === 'adjustments' ? m.class === 'adjustment' : m.class === 'transfer').length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <Clock size={32} strokeWidth={1.5} />
                      <p className="text-xs font-bold uppercase tracking-widest">No recent activity found</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isAdjustmentModalOpen && (
        <AdjustmentModal 
          isOpen={isAdjustmentModalOpen}
          onClose={() => setIsAdjustmentModalOpen(false)}
          products={products}
        />
      )}

      {isTransferModalOpen && (
        <TransferModal 
          isOpen={isTransferModalOpen}
          onClose={() => setIsTransferModalOpen(false)}
          products={products}
        />
      )}
    </div>
  );
};

const AdjustmentModal: React.FC<{ isOpen: boolean; onClose: () => void; products: Product[] }> = ({ isOpen, onClose, products }) => {
  const { profile, activeBranchId } = useAuth();
  const [selectedProductId, setSelectedProductId] = useState('');
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [formData, setFormData] = useState({
    batchId: '',
    newQuantity: 0,
    reason: ''
  });

  useEffect(() => {
    if (selectedProductId && profile?.tenantId && activeBranchId) {
      firestoreService.getCollectionGroup<ProductBatch>('product_batches', profile.tenantId, activeBranchId)
        .then(data => setBatches(data.filter(b => b.productId === selectedProductId)));
    }
  }, [selectedProductId, profile?.tenantId, activeBranchId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId || !activeBranchId || !selectedProductId || !formData.batchId) return;

    const batch = batches.find(b => b.id === formData.batchId);
    if (!batch) return;

    const adjustmentAmount = formData.newQuantity - batch.quantity;
    if (adjustmentAmount === 0) {
      toast.info('No quantity changes.');
      return;
    }

    try {
      // Pre-fetch batch refs outside transaction (required for Web SDK)
      const batchRefs = await getBranchProductBatchRefs(
        profile.tenantId,
        activeBranchId,
        selectedProductId
      );

      // Perform updates inside a Firestore transaction for atomicity
      await runTransaction(db, async (transaction) => {
        // 1. Update batch quantity
        const batchDocRef = doc(db, 'product_batches', batch.id);
        transaction.update(batchDocRef, {
          quantity: formData.newQuantity,
          lastUpdated: new Date().toISOString()
        });

        // 2. Determine detailed event type based on reason
        const reasonLower = (formData.reason || '').toLowerCase();
        let eventType: any = adjustmentAmount > 0 ? 'POSITIVE_ADJUSTMENT' : 'NEGATIVE_ADJUSTMENT';

        if (adjustmentAmount < 0) {
          if (reasonLower.includes('expire') || reasonLower.includes('expiry')) {
            eventType = 'EXPIRY';
          } else if (reasonLower.includes('damage') || reasonLower.includes('broken')) {
            eventType = 'DAMAGE';
          } else if (reasonLower.includes('write') || reasonLower.includes('loss') || reasonLower.includes('theft') || reasonLower.includes('stolen') || reasonLower.includes('missing')) {
            eventType = 'WRITE_OFF';
          }
        }

        // 3. Log movement event & aggregate daily summary in transaction
        await logMovementAndAggregateInTx(transaction, batchRefs, {
          tenantId: profile.tenantId,
          branchId: activeBranchId,
          productId: selectedProductId,
          eventType,
          quantityDeltaBaseUnits: adjustmentAmount,
          consumptionDeltaBaseUnits: 0, // Stock adjustments do not count as customer consumption
          isExceptional: false,
          exceptionalReason: null,
          sourceCollection: 'product_batches',
          sourceDocumentId: batch.id,
          sourceLineId: null,
          reversalOfEventId: null,
          createdBy: profile.uid || 'system',
          effectiveAt: new Date(),
          timezone: 'Africa/Kampala'
        });
      });

      // 4. Log compatibility movement document
      const movement: Omit<InventoryMovement, 'id'> = {
        tenantId: profile.tenantId,
        branchId: activeBranchId || '',
        productId: selectedProductId,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        movementClass: 'adjustment',
        type: adjustmentAmount > 0 ? 'in' : 'out',
        amount: Math.abs(adjustmentAmount),
        amountAttached: (batch.purchasePrice || 0) * Math.abs(adjustmentAmount),
        class: 'adjustment',
        reference: `ADJ-${format(new Date(), 'yyyyMMddHHmm')}`,
        timestamp: new Date().toISOString(),
        initiator: profile.displayName || profile.full_name || 'System',
        initiatorId: profile.uid,
        receiver: 'System',
        notes: formData.reason
      };
      await firestoreService.addDocument('inventory_movements', movement);

      // 5. Update main product stock count
      const product = products.find(p => p.id === selectedProductId);
      if (product) {
        await firestoreService.updateDocument('products', selectedProductId, {
          stock: Math.max(0, (product.stock || 0) + adjustmentAmount)
        });
      }

      toast.success('Stock adjusted successfully');
      onClose();
    } catch (error) {
      console.error(error);
      toast.error('Failed to adjust stock');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden">
        <div className="px-8 py-6 border-b border-zinc-100">
          <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">Stock Adjustment</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Select Product</label>
              <select required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}>
                <option value="">Select Product</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {selectedProductId && (
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Select Batch</label>
                <select required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.batchId} onChange={e => setFormData({...formData, batchId: e.target.value})}>
                  <option value="">Select Batch</option>
                  {batches.map(b => <option key={b.id} value={b.id}>{b.batchNumber} (Current: {b.quantity})</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">New Physical Quantity</label>
              <input 
                required 
                type="number" 
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" 
                value={isNaN(formData.newQuantity) ? '' : formData.newQuantity} 
                onChange={e => setFormData({...formData, newQuantity: parseFloat(e.target.value) || 0})} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Reason for Adjustment</label>
              <textarea required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none min-h-[100px]" value={formData.reason} onChange={e => setFormData({...formData, reason: e.target.value})} placeholder="e.g., Cycle count, damaged, expired..." />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 border border-zinc-200 rounded-xl font-bold text-zinc-600 uppercase text-xs tracking-widest">Cancel</button>
            <button type="submit" className="px-8 py-2 bg-zinc-900 text-white rounded-xl font-bold uppercase text-xs tracking-widest shadow-lg shadow-zinc-900/20">Apply Adjustment</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const TransferModal: React.FC<{ isOpen: boolean; onClose: () => void; products: Product[] }> = ({ isOpen, onClose, products }) => {
  // Simplified transfer modal for now
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden p-12 text-center">
        <AlertCircle className="mx-auto text-zinc-400 mb-4" size={48} />
        <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight mb-2">Branch Transfers</h2>
        <p className="text-zinc-500 text-sm mb-6">Inter-branch transfers are managed via the Stock In/Out module. Please use the Stock In/Out module to initiate a transfer request.</p>
        <button onClick={onClose} className="px-8 py-2 bg-zinc-900 text-white rounded-xl font-bold uppercase text-xs tracking-widest">Close</button>
      </div>
    </div>
  );
};

export default StockManagementTab;
