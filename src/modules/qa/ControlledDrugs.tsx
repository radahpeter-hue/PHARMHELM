import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShieldAlert, 
  Plus, 
  History, 
  Filter,
  Download,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  FileText,
  Lock,
  Calendar,
  Package,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { ControlledDrugEntry, Product, ProductBatch, InventoryMovement } from '../../types';
import { toast } from 'sonner';
import { format, startOfDay, endOfDay, isWithinInterval } from 'date-fns';

export const ControlledDrugs = () => {
  const { user, activeBranch, tenantId } = useAuth();
  const [logs, setLogs] = useState<ControlledDrugEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState({
    start: format(new Date(), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });

  // Form states
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [entryType, setEntryType] = useState<'Manual Adjustment' | 'Stock In' | 'Stock Out'>('Manual Adjustment');
  const [reason, setReason] = useState('');
  const [adjustmentDate, setAdjustmentDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    if (!tenantId || !activeBranch) return;

    // Subscribe to controlled drug register logs
    const unsubscribeLogs = firestoreService.subscribeToCollection<ControlledDrugEntry>(
      'controlled_drug_register',
      tenantId,
      (entries) => {
        const branchEntries = entries.filter(e => e.branchId === activeBranch.id);
        setLogs(branchEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      }
    );

    // Fetch controlled products
    const unsubscribeProducts = firestoreService.subscribeToCollection<Product>(
      'products',
      tenantId,
      (entries) => {
        const controlled = entries.filter(p => p.prescriptionCategory === 'controlled');
        setProducts(controlled);
      }
    );

    // Fetch batches for current branch
    const unsubscribeBatches = firestoreService.subscribeToCollection<ProductBatch>(
      'product_batches',
      tenantId,
      (entries) => {
        const branchBatches = entries.filter(b => b.branchId === activeBranch.id);
        setBatches(branchBatches);
      }
    );

    setLoading(false);

    return () => {
      unsubscribeLogs();
      unsubscribeProducts();
      unsubscribeBatches();
    };
  }, [tenantId, activeBranch]);

  const handleAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !activeBranch || !user || !selectedProductId || !selectedBatchId) return;

    const qty = parseFloat(quantity);
    if (isNaN(qty)) {
      toast.error('Please enter a valid quantity');
      return;
    }

    const product = products.find(p => p.id === selectedProductId);
    const batch = batches.find(b => b.id === selectedBatchId);
    if (!product || !batch) return;

    try {
      // Calculate running balance for this specific drug/batch
      const drugLogs = logs.filter(l => l.drugName === product.name && l.batchNumber === batch.batchNumber);
      const currentBalance = drugLogs.length > 0 ? drugLogs[0].runningBalance : batch.quantity;
      const newBalance = currentBalance + qty;

      const timestamp = adjustmentDate === format(new Date(), 'yyyy-MM-dd') 
        ? new Date().toISOString() 
        : new Date(adjustmentDate).toISOString();

      const newEntry: Omit<ControlledDrugEntry, 'id'> = {
        tenantId,
        branchId: activeBranch.id,
        productId: product.id,
        timestamp,
        transactionRef: `ADJ-${Date.now()}`,
        drugName: product.name,
        dosageForm: product.dosageForm || 'N/A',
        strength: product.strength || 'N/A',
        batchNumber: batch.batchNumber,
        quantity: qty,
        runningBalance: newBalance,
        entryType,
        reasonCode: reason,
        authorisedBy: user.fullName,
        movementId: `M-${Date.now()}`
      };

      await firestoreService.addDocument('controlled_drug_register', newEntry);
      
      // Also update the actual batch quantity in inventory
      await firestoreService.updateDocument('product_batches', batch.id, {
        quantity: newBalance,
        lastUpdated: new Date().toISOString()
      });

      toast.success('Adjustment recorded and inventory updated');
      setIsAdjusting(false);
      resetForm();
    } catch (error) {
      toast.error('Failed to record adjustment');
    }
  };

  const resetForm = () => {
    setSelectedProductId('');
    setSelectedBatchId('');
    setQuantity('');
    setReason('');
    setEntryType('Manual Adjustment');
    setAdjustmentDate(format(new Date(), 'yyyy-MM-dd'));
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch = 
        log.drugName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.batchNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.transactionRef.toLowerCase().includes(searchQuery.toLowerCase());
      
      const logDate = new Date(log.timestamp);
      const matchesDate = isWithinInterval(logDate, {
        start: startOfDay(new Date(dateRange.start)),
        end: endOfDay(new Date(dateRange.end))
      });

      return matchesSearch && matchesDate;
    });
  }, [logs, searchQuery, dateRange]);

  const controlledDrugInventory = useMemo(() => {
    return products.map(product => {
      const productBatches = batches.filter(b => b.productId === product.id);
      const totalStock = productBatches.reduce((sum, b) => sum + b.quantity, 0);
      return {
        ...product,
        totalStock,
        batches: productBatches
      };
    }).filter(p => p.totalStock > 0 || searchQuery === '');
  }, [products, batches, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search drug, batch, or ref..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none transition-all"
            />
          </div>
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1">
            <Calendar className="w-4 h-4 text-gray-400" />
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="text-sm outline-none border-none bg-transparent"
            />
            <span className="text-gray-400">to</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="text-sm outline-none border-none bg-transparent"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAdjusting(true)}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Record Movement</span>
          </button>
          <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-4 h-4 text-amber-600" />
            CD Stock Master
          </h3>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden divide-y divide-gray-100">
            {controlledDrugInventory.map(item => (
              <div key={item.id} className="p-3 hover:bg-gray-50 transition-colors cursor-pointer group">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-sm font-bold text-gray-900 group-hover:text-amber-600 transition-colors">{item.name}</h4>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">{item.strength} • {item.dosageForm}</p>
                  </div>
                  <span className={`text-sm font-bold ${item.totalStock < 10 ? 'text-red-600' : 'text-gray-900'}`}>
                    {item.totalStock}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.batches.map(b => (
                    <span key={b.id} className="text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded border border-gray-200">
                      {b.batchNumber}: {b.quantity}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {controlledDrugInventory.length === 0 && (
              <div className="p-8 text-center text-gray-500 text-sm">
                No controlled drugs found.
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Lock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-900">Controlled Drug Register (Class A/B)</h4>
              <p className="text-xs text-amber-700 mt-1">
                All entries are immutable and timestamped. Manual adjustments require authorization.
                Dispensing entries are auto-populated from POS transactions.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <History className="w-4 h-4 text-gray-400" />
                Movement History
              </h3>
              <span className="text-xs text-gray-500">Showing {filteredLogs.length} entries</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500 font-medium">
                    <th className="px-6 py-3">Timestamp</th>
                    <th className="px-6 py-3">Reference</th>
                    <th className="px-6 py-3">Drug / Batch</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Qty</th>
                    <th className="px-6 py-3">Balance</th>
                    <th className="px-6 py-3">Authorised By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="text-sm hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900">{format(new Date(log.timestamp), 'MMM d, HH:mm')}</div>
                        <div className="text-xs text-gray-500">{format(new Date(log.timestamp), 'yyyy')}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-3 h-3 text-gray-400" />
                          <span className="text-xs font-mono text-gray-600">{log.transactionRef}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{log.drugName}</div>
                        <div className="text-xs text-gray-500">Batch: {log.batchNumber}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          log.entryType === 'Dispensed' ? 'bg-blue-50 text-blue-700' :
                          log.entryType === 'Reversal' ? 'bg-green-50 text-green-700' :
                          log.entryType === 'Stock In' ? 'bg-purple-50 text-purple-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {log.entryType}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          {log.quantity > 0 ? (
                            <ArrowUpRight className="w-3 h-3 text-green-500" />
                          ) : (
                            <ArrowDownLeft className="w-3 h-3 text-red-500" />
                          )}
                          <span className={`font-bold ${log.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {log.quantity > 0 ? `+${log.quantity}` : log.quantity}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-bold text-gray-900">{log.runningBalance}</span>
                      </td>
                      <td className="px-6 py-4 text-gray-600">{log.authorisedBy}</td>
                    </tr>
                  ))}
                  {filteredLogs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                        No transactions found for the selected criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isAdjusting && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 bg-amber-50">
                <h3 className="text-xl font-bold text-amber-900 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5" />
                  Record CD Movement
                </h3>
                <p className="text-sm text-amber-700 mt-1">
                  Manual entries will update both the register and inventory.
                </p>
              </div>

              <form onSubmit={handleAdjustment} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Select Drug</label>
                  <select
                    required
                    value={selectedProductId}
                    onChange={(e) => {
                      setSelectedProductId(e.target.value);
                      setSelectedBatchId('');
                    }}
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                  >
                    <option value="">Select a controlled drug...</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.strength})</option>
                    ))}
                  </select>
                </div>

                {selectedProductId && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Select Batch</label>
                    <select
                      required
                      value={selectedBatchId}
                      onChange={(e) => setSelectedBatchId(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                    >
                      <option value="">Select batch...</option>
                      {batches.filter(b => b.productId === selectedProductId).map(b => (
                        <option key={b.id} value={b.id}>
                          {b.batchNumber} (SOH: {b.quantity}) - Exp: {b.expiryDate}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Movement Type</label>
                    <select
                      value={entryType}
                      onChange={(e) => setEntryType(e.target.value as any)}
                      className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                    >
                      <option value="Manual Adjustment">Adjustment</option>
                      <option value="Stock In">Stock In</option>
                      <option value="Stock Out">Stock Out</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Quantity (+/-)</label>
                    <input
                      type="number"
                      required
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                      placeholder="e.g. -5 or 10"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Transaction Date</label>
                  <input
                    type="date"
                    required
                    value={adjustmentDate}
                    onChange={(e) => setAdjustmentDate(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Reason / Reference</label>
                  <textarea
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-amber-500 outline-none transition-all h-20 resize-none"
                    placeholder="Provide details..."
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsAdjusting(false)}
                    className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors shadow-sm"
                  >
                    Confirm Entry
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
