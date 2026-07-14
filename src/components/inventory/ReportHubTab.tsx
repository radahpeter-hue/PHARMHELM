import React, { useState, useEffect } from 'react';
import { BarChart3, PieChart, Calendar, AlertTriangle, FileText, Download, TrendingUp, Package, History } from 'lucide-react';
import { Product, ProductBatch, InventoryMovement } from '../../types';
import { firestoreService } from '../../services/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { format, isAfter, addDays, differenceInDays } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { toast } from 'sonner';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ReportHubTab: React.FC = () => {
  const { profile, activeBranchId } = useAuth();
  const [activeReport, setActiveReport] = useState<'intelligence' | 'expiry' | 'adjustments' | 'onhand'>('intelligence');
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [loading, setLoading] = useState(true);

  // Expiry date threshold (default to 90 days from now)
  const [expiryLimitDate, setExpiryLimitDate] = useState<string>(() => {
    return addDays(new Date(), 90).toISOString().split('T')[0];
  });

  useEffect(() => {
    if (profile?.tenantId) {
      const fetchData = async () => {
        setLoading(true);
        try {
          const [productsData, movementsData, batchesData] = await Promise.all([
            firestoreService.getCollection<Product>('products', profile.tenantId!),
            firestoreService.getCollection<InventoryMovement>('inventory_movements', profile.tenantId!),
            firestoreService.getCollectionGroup<ProductBatch>('product_batches', profile.tenantId!, activeBranchId || undefined)
          ]);
          
          setProducts(productsData);
          setMovements(movementsData.filter(m => !activeBranchId || m.branchId === activeBranchId));
          setBatches(batchesData.filter(b => !activeBranchId || b.branchId === activeBranchId));
        } catch (error) {
          console.error('Error fetching report data:', error);
        } finally {
          setLoading(false);
        }
      };
      fetchData();
    }
  }, [profile?.tenantId, activeBranchId]);

  const totalValuation = batches.reduce((acc, b) => acc + (b.quantity * (b.purchasePrice || 0)), 0);

  // Batches that are expiring soon (after today but before/on defined expiryLimitDate)
  const shortExpiryBatches = batches
    .filter(b => {
      const expiryDate = new Date(b.expiryDate);
      const limitDate = new Date(expiryLimitDate);
      const today = new Date();
      today.setHours(0,0,0,0);
      return expiryDate > today && expiryDate <= limitDate && b.quantity > 0;
    })
    .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

  // Batches that are already expired (expired on or before today) with quantities left (representing loss)
  const expiredBatches = batches
    .filter(b => {
      const expiryDate = new Date(b.expiryDate);
      const today = new Date();
      today.setHours(0,0,0,0);
      return expiryDate <= today && b.quantity > 0;
    })
    .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

  // Perceived financial loss from expired batches
  const totalExpiredLoss = expiredBatches.reduce((acc, b) => acc + (b.quantity * (b.purchasePrice || 0)), 0);

  const adjustmentMovements = movements
    .filter(m => m.movementClass === 'adjustment' || m.class === 'adjustment')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Export CSV Handler
  const handleExportCSV = () => {
    let headers: string[] = [];
    let rows: any[][] = [];
    let filename = `inventory_${activeReport}_report.csv`;

    if (activeReport === 'intelligence') {
      headers = ['Metric', 'Value'];
      rows = [
        ['Total Inventory Valuation', `${totalValuation.toLocaleString()} UGX`],
        ['Stock Turn Rate', '4.2x'],
        ['Days Inventory Cover', '45 Days'],
      ];
    } else if (activeReport === 'expiry') {
      filename = `inventory_expiry_report_until_${expiryLimitDate}.csv`;
      headers = ['Category', 'Product', 'Batch Number', 'Expiry Date', 'Qty On Hand', 'Purchase Price (UGX)', 'Loss/Cost Value (UGX)', 'Audited Status'];
      
      // Short expiry
      shortExpiryBatches.forEach(b => {
        const product = products.find(p => p.id === b.productId);
        const costVal = b.quantity * (b.purchasePrice || 0);
        rows.push([
          'Short Expiry',
          product?.name || 'Unknown',
          b.batchNumber || '-',
          b.expiryDate,
          b.quantity,
          b.purchasePrice || 0,
          costVal,
          'Expiring Soon'
        ]);
      });

      // Expired
      expiredBatches.forEach(b => {
        const product = products.find(p => p.id === b.productId);
        const costVal = b.quantity * (b.purchasePrice || 0);
        rows.push([
          'Already Expired',
          product?.name || 'Unknown',
          b.batchNumber || '-',
          b.expiryDate,
          b.quantity,
          b.purchasePrice || 0,
          costVal,
          'Audited Expired Loss'
        ]);
      });
    } else if (activeReport === 'adjustments') {
      headers = ['Date', 'Product', 'Batch Number', 'Adjustment Quantity', 'Unit Price (UGX)', 'Value Shift (UGX)', 'Reason/Notes', 'Initiator'];
      adjustmentMovements.forEach(m => {
        const product = products.find(p => p.id === m.productId);
        const unitPrice = m.purchasePrice || product?.purchasePrice || 0;
        const valShift = m.amount * unitPrice * (m.type === 'in' ? 1 : -1);
        rows.push([
          format(new Date(m.timestamp), 'yyyy-MM-dd'),
          product?.name || 'Unknown Product',
          m.batchNumber || '-',
          `${m.type === 'in' ? '+' : '-'}${m.amount}`,
          unitPrice,
          valShift,
          m.notes || 'None',
          m.initiator || 'System User'
        ]);
      });
    } else if (activeReport === 'onhand') {
      headers = ['Product Name', 'Category', 'Stock Level', 'Valuation Cost (UGX)'];
      products.forEach(p => {
        const productBatches = batches.filter(b => b.productId === p.id);
        const totalQty = productBatches.reduce((acc, b) => acc + b.quantity, 0);
        const valuation = productBatches.reduce((acc, b) => acc + (b.quantity * (b.purchasePrice || 0)), 0);
        
        if (totalQty > 0) {
          rows.push([
            p.name,
            p.category || 'N/A',
            `${totalQty} ${p.unitOfSell || 'units'}`,
            valuation
          ]);
        }
      });
    }

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${(val ?? '').toString().replace(/"/g, '""')}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`${filename} exported successfully`);
  };

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <ReportCard 
          title="Stock Intelligence" 
          icon={<TrendingUp size={20} />} 
          active={activeReport === 'intelligence'} 
          onClick={() => setActiveReport('intelligence')}
        />
        <ReportCard 
          title="Expiry Reports" 
          icon={<AlertTriangle size={20} />} 
          active={activeReport === 'expiry'} 
          onClick={() => setActiveReport('expiry')}
        />
        <ReportCard 
          title="Adjustments" 
          icon={<History size={20} />} 
          active={activeReport === 'adjustments'} 
          onClick={() => setActiveReport('adjustments')}
        />
        <ReportCard 
          title="Stock on Hand" 
          icon={<Package size={20} />} 
          active={activeReport === 'onhand'} 
          onClick={() => setActiveReport('onhand')}
        />
      </div>

      <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden min-h-[500px]">
        <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">
            {activeReport === 'intelligence' && 'Stock Intelligence & Capital Reports'}
            {activeReport === 'expiry' && 'Expiry & Short Expiry Reports'}
            {activeReport === 'adjustments' && 'Stock Adjustment Reports'}
            {activeReport === 'onhand' && 'Stock on Hand Report'}
          </h2>
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-md shadow-emerald-100"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>

        <div className="p-8">
          {activeReport === 'intelligence' && (
            <div className="space-y-8">
              <div className="grid grid-cols-3 gap-6">
                <div className="p-6 bg-zinc-50 rounded-3xl border border-zinc-100">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Total Inventory Valuation</p>
                  <p className="text-2xl font-black text-zinc-900">{(totalValuation || 0).toLocaleString()} UGX</p>
                </div>
                <div className="p-6 bg-zinc-50 rounded-3xl border border-zinc-100">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Stock Turn Rate</p>
                  <p className="text-2xl font-black text-zinc-900">4.2x</p>
                </div>
                <div className="p-6 bg-zinc-50 rounded-3xl border border-zinc-100">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Days Inventory Cover</p>
                  <p className="text-2xl font-black text-zinc-900">45 Days</p>
                </div>
              </div>
              
              <div className="space-y-4">
                <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest">ABC Classification (By Value)</h3>
                <div className="h-4 w-full bg-zinc-100 rounded-full overflow-hidden flex">
                  <div className="h-full bg-emerald-500" style={{ width: '70%' }} />
                  <div className="h-full bg-amber-500" style={{ width: '20%' }} />
                  <div className="h-full bg-red-500" style={{ width: '10%' }} />
                </div>
                <div className="flex gap-6 text-[10px] font-black uppercase tracking-widest">
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-emerald-500" /> Class A (70%)</div>
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-amber-500" /> Class B (20%)</div>
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-red-500" /> Class C (10%)</div>
                </div>
              </div>
            </div>
          )}

          {activeReport === 'expiry' && (
            <div className="space-y-6">
              {/* Expiry Date Filter UI */}
              <div className="flex flex-col sm:flex-row gap-4 items-end bg-zinc-50 p-6 rounded-[24px] border border-zinc-150 mb-6">
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Audited Short-Expiry Period (Up To)</span>
                  <input 
                    type="date"
                    className="w-full sm:w-56 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 outline-none"
                    value={expiryLimitDate}
                    onChange={(e) => setExpiryLimitDate(e.target.value)}
                  />
                </div>
                <div className="p-2 sm:ml-auto">
                  <p className="text-xs font-black text-red-600 uppercase tracking-widest text-right">
                    Total Expired Value Loss: {totalExpiredLoss.toLocaleString()} UGX
                  </p>
                  <p className="text-[10px] text-zinc-500 text-right mt-0.5">Auditable value of all batches past expiry date.</p>
                </div>
              </div>

              {/* SECTION A: Expired Batches (Perceived Loss) */}
              <div className="space-y-3">
                <h3 className="text-xs font-black text-red-600 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Expired Batches (Audited Financial Loss)
                </h3>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-red-50/50 border-b border-red-100">
                      <th className="px-6 py-4 text-[10px] font-black text-red-700 uppercase tracking-widest">Product</th>
                      <th className="px-6 py-4 text-[10px] font-black text-red-700 uppercase tracking-widest">Batch</th>
                      <th className="px-6 py-4 text-[10px] font-black text-red-700 uppercase tracking-widest">Expiry Date</th>
                      <th className="px-6 py-4 text-[10px] font-black text-red-700 uppercase tracking-widest text-right">Qty</th>
                      <th className="px-6 py-4 text-[10px] font-black text-red-700 uppercase tracking-widest text-right">Unit Price</th>
                      <th className="px-6 py-4 text-[10px] font-black text-red-700 uppercase tracking-widest text-right font-black">Perceived Loss</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100 bg-red-50/10">
                    {expiredBatches.map(batch => {
                      const product = products.find(p => p.id === batch.productId);
                      const unitCost = batch.purchasePrice || 0;
                      const perceivedLoss = batch.quantity * unitCost;
                      return (
                        <tr key={batch.id} className="hover:bg-red-50/30 transition-colors">
                          <td className="px-6 py-4 font-bold text-red-900">{product?.name || 'Unknown Product'}</td>
                          <td className="px-6 py-4 text-xs text-red-800">{batch.batchNumber}</td>
                          <td className="px-6 py-4 text-xs font-bold text-red-600">
                            {format(new Date(batch.expiryDate), 'MMM dd, yyyy')}
                          </td>
                          <td className="px-6 py-4 text-xs font-black text-right text-red-900">{batch.quantity}</td>
                          <td className="px-6 py-4 text-xs text-right text-red-800">{unitCost.toLocaleString()}</td>
                          <td className="px-6 py-4 text-xs font-black text-right text-red-700">{perceivedLoss.toLocaleString()} UGX</td>
                        </tr>
                      );
                    })}
                    {expiredBatches.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-zinc-400 italic">
                          No expired batches found. Excellent!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* SECTION B: Short Expiry Batches */}
              <div className="space-y-3 pt-4 border-t border-zinc-100">
                <h3 className="text-xs font-black text-amber-600 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Short Expiry Batches (Expiring soon)
                </h3>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-amber-50/50 border-b border-amber-100">
                      <th className="px-6 py-4 text-[10px] font-black text-amber-700 uppercase tracking-widest">Product</th>
                      <th className="px-6 py-4 text-[10px] font-black text-amber-700 uppercase tracking-widest">Batch</th>
                      <th className="px-6 py-4 text-[10px] font-black text-amber-700 uppercase tracking-widest">Expiry Date</th>
                      <th className="px-6 py-4 text-[10px] font-black text-amber-700 uppercase tracking-widest text-right">Days Left</th>
                      <th className="px-6 py-4 text-[10px] font-black text-amber-700 uppercase tracking-widest text-right">Qty</th>
                      <th className="px-6 py-4 text-[10px] font-black text-amber-700 uppercase tracking-widest text-right">Cost Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100 bg-amber-50/10">
                    {shortExpiryBatches.map(batch => {
                      const product = products.find(p => p.id === batch.productId);
                      const daysToExpiry = differenceInDays(new Date(batch.expiryDate), new Date());
                      const costValue = batch.quantity * (batch.purchasePrice || 0);
                      return (
                        <tr key={batch.id} className="hover:bg-amber-50/30 transition-colors">
                          <td className="px-6 py-4 font-bold text-amber-900">{product?.name || 'Unknown Product'}</td>
                          <td className="px-6 py-4 text-xs text-amber-800">{batch.batchNumber}</td>
                          <td className="px-6 py-4 text-xs font-bold text-amber-600">
                            {format(new Date(batch.expiryDate), 'MMM dd, yyyy')}
                          </td>
                          <td className="px-6 py-4 text-xs text-right text-amber-700 font-mono font-bold">{daysToExpiry} Days</td>
                          <td className="px-6 py-4 text-xs font-black text-right text-amber-900">{batch.quantity}</td>
                          <td className="px-6 py-4 text-xs font-bold text-right text-amber-800">{costValue.toLocaleString()} UGX</td>
                        </tr>
                      );
                    })}
                    {shortExpiryBatches.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-zinc-400 italic">
                          No short-expiry batches found before {expiryLimitDate}.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeReport === 'adjustments' && (
            <div className="space-y-6">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/50 border-b border-zinc-100">
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Date</th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Product</th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Batch</th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Adjustment Qty</th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Unit Cost</th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Value Variance</th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Reason / Audit Log</th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Initiator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {adjustmentMovements.map(m => {
                    const product = products.find(p => p.id === m.productId);
                    const unitPrice = m.purchasePrice || product?.purchasePrice || 0;
                    const valueShift = m.amount * unitPrice;
                    const isPositive = m.type === 'in';
                    return (
                      <tr key={m.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4 text-xs text-zinc-500">{format(new Date(m.timestamp), 'MMM dd, yyyy')}</td>
                        <td className="px-6 py-4 font-bold text-zinc-900">{product?.name || 'Unknown Product'}</td>
                        <td className="px-6 py-4 text-xs text-zinc-500">{m.batchNumber}</td>
                        <td className={cn("px-6 py-4 text-xs text-right font-black", isPositive ? "text-emerald-600" : "text-red-600")}>
                          {isPositive ? '+' : '-'}{m.amount}
                        </td>
                        <td className="px-6 py-4 text-xs text-right text-zinc-600">{unitPrice.toLocaleString()}</td>
                        <td className={cn("px-6 py-4 text-xs text-right font-bold", isPositive ? "text-emerald-600" : "text-red-600")}>
                          {isPositive ? '+' : '-'}{valueShift.toLocaleString()} UGX
                        </td>
                        <td className="px-6 py-4 text-xs text-zinc-500">{m.notes}</td>
                        <td className="px-6 py-4 text-xs text-zinc-500">{m.initiator}</td>
                      </tr>
                    );
                  })}
                  {adjustmentMovements.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-zinc-400 italic">
                        No audited adjustment records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeReport === 'onhand' && (
            <div className="space-y-6">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/50 border-b border-zinc-100">
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Product Name</th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Stock Level</th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Valuation (Cost)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {products.map(p => {
                    const productBatches = batches.filter(b => b.productId === p.id);
                    const totalQty = productBatches.reduce((acc, b) => acc + b.quantity, 0);
                    const valuation = productBatches.reduce((acc, b) => acc + (b.quantity * (b.purchasePrice || 0)), 0);
                    
                    if (totalQty === 0) return null;

                    return (
                      <tr key={p.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4 font-bold text-slate-900">{p.name}</td>
                        <td className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{p.category}</td>
                        {/* Solved visibility: explicitly set to text-slate-900 with strong font and high-contrast styling */}
                        <td className="px-6 py-4 text-xs font-black text-slate-900 text-right bg-slate-50/40 rounded-lg pr-4">{totalQty.toLocaleString()} {p.unitOfSell}s</td>
                        <td className="px-6 py-4 text-xs font-bold text-slate-900 text-right">{valuation.toLocaleString()} UGX</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ReportCard: React.FC<{ title: string; icon: React.ReactNode; active: boolean; onClick: () => void }> = ({ title, icon, active, onClick }) => (
  <button 
    onClick={onClick}
    className={cn(
      "p-6 rounded-[32px] border transition-all flex flex-col items-center gap-3 text-center",
      active 
        ? "bg-zinc-900 border-zinc-900 text-white shadow-xl shadow-zinc-900/20" 
        : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50"
    )}
  >
    <div className={cn("p-3 rounded-2xl", active ? "bg-white/10" : "bg-zinc-100")}>
      {icon}
    </div>
    <span className="text-[10px] font-black uppercase tracking-widest">{title}</span>
  </button>
);

export default ReportHubTab;
