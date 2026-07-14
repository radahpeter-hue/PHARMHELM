import React, { useState, useEffect } from 'react';
import { 
  Heart, 
  MapPin, 
  Plus, 
  CheckCircle, 
  AlertTriangle, 
  TrendingUp, 
  Users, 
  Trash2, 
  ShoppingBag,
  DollarSign,
  X,
  Lock,
  Activity,
  Clock
} from 'lucide-react';
import { firestoreService } from '../../services/firestore';
import { Client, Product, ProductBatch } from '../../types';
import { toast } from 'sonner';

interface BrandLedgerPillarProps {
  tenantId: string;
  role: string;
}

export const BrandLedgerPillar: React.FC<BrandLedgerPillarProps> = ({ tenantId, role }) => {
  const [outreachEvents, setOutreachEvents] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  // Outreach register form
  const [eventName, setEventName] = useState('');
  const [area, setArea] = useState('Kawempe');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty] = useState(1);
  const [cashExp, setCashExp] = useState(250000); // Logistics/tents cash costs
  
  // New state variables for Budgeted and Used amounts
  const [outreachStatus, setOutreachStatus] = useState<'planned' | 'active' | 'completed'>('active');
  const [budgetedAmount, setBudgetedAmount] = useState<number>(500000);
  const [completingEvent, setCompletingEvent] = useState<any | null>(null);
  const [completeActualSpend, setCompleteActualSpend] = useState<number>(250000);

  useEffect(() => {
    if (tenantId) {
      firestoreService.subscribeToCollection<any>('outreach_events', tenantId, setOutreachEvents);
      firestoreService.subscribeToCollection<Product>('products', tenantId, setProducts);
      firestoreService.subscribeToCollection<ProductBatch>('product_batches', tenantId, setBatches);
      firestoreService.subscribeToCollection<Client>('clients', tenantId, setClients);
    }
  }, [tenantId]);

  // Aggregate metrics: cashCost tracks used amount for completed, budgetedAmount tracks planned for active/planned
  const totalOutreachCash = outreachEvents.reduce((acc, curr) => acc + (curr.status === 'completed' ? (curr.cashCost || 0) : (curr.budgetedAmount || curr.budget || 0)), 0);
  const totalOutreachStock = outreachEvents.reduce((acc, curr) => acc + (curr.stockCost || 0), 0);
  const totalInvestedCommunityUgx = totalOutreachCash + totalOutreachStock;

  // Referred clients acquired
  const referredClients = clients.filter(c => !!c.referred_by_activity);
  const clientAcquisitionsCount = referredClients.length;

  const averageCAC = clientAcquisitionsCount > 0 
    ? Math.round(totalInvestedCommunityUgx / clientAcquisitionsCount) 
    : totalInvestedCommunityUgx;

  const handlePostOutreach = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventName || !area) return;

    try {
      let computedStockCost = 0;
      let matchedProdName = 'None';

      const prod = products.find(p => p.id === selectedProduct);
      if (prod) {
        matchedProdName = prod.name;
        
        // Find batch at main/active branch
        const prodBatches = batches.filter(b => b.productId === selectedProduct && b.quantity >= qty);
        if (prodBatches.length > 0) {
          const targetedBatch = prodBatches[0];
          // Update Stock Quantity in Firestore!
          await firestoreService.updateDocument('product_batches', targetedBatch.id, {
            quantity: targetedBatch.quantity - qty
          });

          computedStockCost = (prod.costPricePerPack || 1000) * qty;
          
          // Log stock movement audit trail
          await firestoreService.addDocument('inventory_movements', {
            tenantId,
            branchId: targetedBatch.branchId || 'main',
            productId: selectedProduct,
            batchId: targetedBatch.id,
            timestamp: new Date().toISOString(),
            movementClass: 'adjustment',
            reference: 'OUTREACH_WRITE_OFF',
            initiator: role,
            quantity: -qty,
            amount: computedStockCost
          });
        } else {
          toast.warning('No batches with sufficient quantity found in inventory. Carrying on as logistics-only event.');
        }
      }

      const isCompleted = outreachStatus === 'completed';

      // Add outreach log
      await firestoreService.addDocument('outreach_events', {
        tenantId,
        eventName,
        communityArea: area,
        productId: selectedProduct || null,
        productName: selectedProduct ? matchedProdName : null,
        quantityUsed: selectedProduct ? qty : 0,
        stockCost: computedStockCost,
        cashCost: isCompleted ? Number(cashExp) : 0,
        budgetedAmount: Number(budgetedAmount),
        status: outreachStatus,
        date: new Date().toISOString().split('T')[0]
      });

      // Write transactional expense to Cost Ledger (Pillar 7) ONLY if completed
      if (isCompleted) {
        await firestoreService.addDocument('marketing_expenses', {
          tenantId,
          category: 'Community Outreach',
          subCategory: 'Completed Outreach Spend',
          amount: computedStockCost + Number(cashExp),
          description: `Social brand investment campaign ${eventName} in ${area}. Includes goods write-off.`,
          date: new Date().toISOString().split('T')[0],
          loggedBy: role,
          status: 'approved'
        });
        toast.success(`Outreach registered as completed! Expense logged: UGX ${(computedStockCost + Number(cashExp)).toLocaleString()}`);
      } else {
        toast.success(`Outreach campaign registered as ${outreachStatus}! Budget of UGX ${Number(budgetedAmount).toLocaleString()} allocated.`);
      }

      setEventName('');
      setSelectedProduct('');
      setQty(1);
      setBudgetedAmount(500000);
      setCashExp(250000);
    } catch (error) {
      toast.error('Failed to register outreach.');
    }
  };

  const handleCompleteOutreachEvent = async (event: any) => {
    try {
      await firestoreService.updateDocument('outreach_events', event.id, {
        status: 'completed',
        cashCost: Number(completeActualSpend)
      });

      // Write transactional expense to Cost Ledger (Pillar 7)
      await firestoreService.addDocument('marketing_expenses', {
        tenantId,
        category: 'Community Outreach',
        subCategory: 'Completed Outreach Spend',
        amount: (event.stockCost || 0) + Number(completeActualSpend),
        description: `Actual spend of completed outreach: ${event.eventName} in ${event.communityArea}. Includes goods write-off.`,
        date: new Date().toISOString().split('T')[0],
        loggedBy: role,
        status: 'approved'
      });

      toast.success(`Outreach campaign "${event.eventName}" completed and locked!`);
      setCompletingEvent(null);
    } catch (error) {
      toast.error('Failed to complete outreach campaign.');
    }
  };

  const isPersonnel = role === 'Marketing Personnel' || role === 'Marketing Head' || role === 'admin';

  return (
    <div className="space-y-6">
      {/* SOCIAL BRAND VALUE DECK CARD */}
      <div className="bg-zinc-950 text-white rounded-[32px] p-8 relative overflow-hidden shadow-xl shadow-zinc-950/10">
        <div className="absolute -right-16 -top-16 w-48 h-48 bg-heart bg-indigo-500/10 rounded-full blur-2xl" />
        
        <div className="relative space-y-6">
          <div className="flex items-center gap-2">
            <span className="bg-indigo-500/20 text-indigo-400 p-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-1.5">
              <Heart size={14} className="fill-indigo-400 animate-pulse" /> Social Brand Ledger metrics
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-400 font-black uppercase tracking-wider">Total Community Investment YTD</span>
              <h2 className="text-2xl font-black font-mono">UGX {totalInvestedCommunityUgx.toLocaleString()}</h2>
              <p className="text-[10px] text-zinc-500">Cash expenses: UGX {totalOutreachCash.toLocaleString()}</p>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-zinc-400 font-black uppercase tracking-wider">Referred Clients Acquired</span>
              <h2 className="text-2xl font-black text-indigo-400 font-mono">{clientAcquisitionsCount} leads</h2>
              <p className="text-[10px] text-zinc-500">Linked referred profiles</p>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-zinc-400 font-black uppercase tracking-wider">Computed Brand CAC</span>
              <h2 className="text-2xl font-black font-mono">UGX {averageCAC.toLocaleString()}</h2>
              <p className="text-[10px] text-zinc-500">Outreach cost per referral client</p>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-zinc-400 font-black uppercase tracking-wider">Top investment Hub</span>
              <h2 className="text-2xl font-black text-emerald-400">
                {outreachEvents.length > 0 ? outreachEvents[0].communityArea : 'None'}
              </h2>
              <p className="text-[10px] text-zinc-500">High-yield response zone</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Event log */}
        <div className="lg:col-span-2 bg-white rounded-3xl border border-zinc-200 shadow-sm p-6 space-y-4">
          <div>
            <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight">Geographic Community Outreach Registry</h3>
            <p className="text-zinc-500 text-xs">Audit medical free campaigns, diagnostic wellness camps, and inventory write-offs with progressive budget allocation.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-600">
              <thead>
                <tr className="bg-zinc-50 text-zinc-500 font-bold uppercase border-b border-zinc-200">
                  <th className="px-4 py-3">Outreach Campaign / Date</th>
                  <th className="px-4 py-3">Location & Status</th>
                  <th className="px-4 py-3">Physically Dispensed Stock</th>
                  <th className="px-4 py-3 text-right">Planned Budget</th>
                  <th className="px-4 py-3 text-right">Actual Spend</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {outreachEvents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center p-8 text-zinc-400 font-medium">No medical outreach events currently logged.</td>
                  </tr>
                ) : (
                  outreachEvents.map((o, i) => {
                    const isCompletedStatus = o.status === 'completed';
                    const isPlannedStatus = o.status === 'planned';
                    const isActiveStatus = o.status === 'active' || !o.status;
                    
                    return (
                      <tr key={o.id || i} className="hover:bg-zinc-50/50 transition-colors font-semibold">
                        <td className="px-4 py-3">
                          <span className="font-bold text-zinc-900">{o.eventName}</span>
                          <div className="text-[10px] text-zinc-400 font-mono">{o.date}</div>
                        </td>
                        <td className="px-4 py-3 space-y-1">
                          <span className="text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase inline-flex items-center gap-1">
                            <MapPin size={10} /> {o.communityArea}
                          </span>
                          <div>
                            {isCompletedStatus ? (
                              <span className="text-[9px] font-black uppercase tracking-wider text-purple-600 bg-purple-50 border border-purple-150 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                <CheckCircle size={8} /> Completed
                              </span>
                            ) : isPlannedStatus ? (
                              <span className="text-[9px] font-black uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-150 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                <Clock size={8} /> Planned
                              </span>
                            ) : (
                              <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-150 px-2 py-0.5 rounded-full inline-flex items-center gap-1 animate-pulse">
                                <Activity size={8} /> Active
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {o.productName ? (
                            <span>Dispensed {o.quantityUsed}x {o.productName}</span>
                          ) : (
                            <span className="text-zinc-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-900 font-mono font-bold">
                          UGX {Number(o.budgetedAmount || o.budget || 500000).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-900 font-mono font-bold">
                          {isCompletedStatus ? (
                            <span className="text-purple-700">UGX {((o.stockCost || 0) + (o.cashCost || 0)).toLocaleString()}</span>
                          ) : (
                            <span className="text-zinc-400 italic">Allocated</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isCompletedStatus ? (
                            <div className="flex items-center justify-center text-zinc-400 gap-1 text-[10px]">
                              <Lock size={12} className="text-zinc-400" /> Finished
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setCompletingEvent(o);
                                setCompleteActualSpend(Number(o.budgetedAmount || o.budget || 250000));
                              }}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm"
                            >
                              Complete
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Outreach Registry Form */}
        <div className="bg-zinc-50 border border-zinc-200 rounded-3xl p-6 h-fit space-y-4">
          <div>
            <h4 className="font-bold text-zinc-900 text-sm uppercase tracking-tight flex items-center gap-2">
              <MapPin size={16} /> Register Outreach Campaign
            </h4>
            <p className="text-zinc-500 text-xs mt-1">Updates pharmacy inventory write-off and locks in/allocates budget portfolios.</p>
          </div>

          <form onSubmit={handlePostOutreach} className="space-y-4 font-semibold text-xs text-zinc-700">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Outreach Campaign Name</label>
              <input required type="text" value={eventName} onChange={e => setEventName(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-zinc-800 font-bold" placeholder="Kawempe Pediatric Health Camp" />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Community Area Tag</label>
              <select value={area} onChange={e => setArea(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-zinc-800 font-bold">
                <option value="Kawempe">Kawempe division</option>
                <option value="Makerere">Makerere / Kivulu</option>
                <option value="Ntinda">Ntinda / Nakawa</option>
                <option value="Kisekka">Kisekka Market</option>
                <option value="Kamwokya">Kamwokya slums</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Campaign Execution Status</label>
              <select 
                value={outreachStatus} 
                onChange={e => setOutreachStatus(e.target.value as any)} 
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-zinc-800 font-bold"
              >
                <option value="planned">Planned (Ready in pipeline)</option>
                <option value="active">Active (En route / Allocating Portfolio)</option>
                <option value="completed">Completed (Done / Direct Expense)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Planned Budget Provision (UGX)</label>
              <input 
                required 
                type="number" 
                value={budgetedAmount} 
                onChange={e => setBudgetedAmount(Number(e.target.value))} 
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl font-mono text-zinc-800 font-bold" 
              />
              <p className="text-[9px] text-zinc-400">Allocated portfolio holding size in cost ledger.</p>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Simulate Dispensing Stock (optional write-off)</label>
              <select value={selectedProduct} onChange={e => setSelectedProduct(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-zinc-800 font-bold">
                <option value="">-- No Stock Dispensation --</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} [(Cost: UGX {p.costPricePerPack?.toLocaleString()})]</option>
                ))}
              </select>
            </div>

            {selectedProduct && (
              <div className="space-y-1 animate-in slide-in-from-top-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Dispensation Volume (packs/units)</label>
                <input type="number" min={1} value={qty} onChange={e => setQty(Number(e.target.value))} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl font-mono text-zinc-800 font-bold" />
              </div>
            )}

            {outreachStatus === 'completed' && (
              <div className="space-y-1 animate-in slide-in-from-top-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider font-sans">Actual Cash Cost Spent (UGX)</label>
                <input required type="number" value={cashExp} onChange={e => setCashExp(Number(e.target.value))} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl font-mono text-zinc-800 font-bold" />
              </div>
            )}

            <button
              disabled={!isPersonnel} 
              type="submit" 
              className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all"
            >
              {!isPersonnel ? 'Personnel Clearance Required' : 'Post Outreach Specifications'}
            </button>
          </form>
        </div>
      </div>

      {/* Complete Outreach Event Modal Overlay */}
      {completingEvent && (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 border border-zinc-200 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center pb-2 border-b border-zinc-100">
              <h4 className="font-bold text-zinc-900 text-sm uppercase tracking-tight">Complete Outreach Campaign</h4>
              <button onClick={() => setCompletingEvent(null)} className="p-1 text-zinc-400 hover:text-zinc-600 rounded-lg">
                <X size={16} />
              </button>
            </div>
            
            <div className="bg-zinc-50 p-4 rounded-2xl text-xs space-y-2 text-zinc-600">
              <p><strong>Campaign Name:</strong> {completingEvent.eventName}</p>
              <p><strong>Community Hub:</strong> {completingEvent.communityArea}</p>
              <p><strong>Allocated Budget:</strong> UGX {Number(completingEvent.budgetedAmount || completingEvent.budget || 500000).toLocaleString()}</p>
              {completingEvent.productName && (
                <p><strong>Dispensed Inventory:</strong> {completingEvent.quantityUsed}x {completingEvent.productName} (Worth UGX {Number(completingEvent.stockCost || 0).toLocaleString()})</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Actual Cash Spend (UGX)</label>
              <input 
                type="number"
                value={completeActualSpend}
                onChange={e => setCompleteActualSpend(Number(e.target.value))}
                className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl font-mono text-sm font-bold text-zinc-800 outline-none focus:ring-2 focus:ring-emerald-500/10"
              />
              <p className="text-[10px] text-zinc-400">Specify actual logistic, transport, and flyers cash cost incurred. Unused budget will return to available funds.</p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button 
                type="button"
                onClick={() => setCompletingEvent(null)}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-bold rounded-xl transition-all"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={() => handleCompleteOutreachEvent(completingEvent)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-100"
              >
                Lock & Archive Spend
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
