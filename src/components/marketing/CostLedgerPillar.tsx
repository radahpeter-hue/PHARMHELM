import React, { useState, useEffect } from 'react';
import { 
  DollarSign, 
  Settings, 
  Trash2, 
  CheckCircle, 
  AlertTriangle, 
  Plus, 
  TrendingUp, 
  PieChart,
  Calendar,
  Clock,
  Send,
  Sparkles
} from 'lucide-react';
import { firestoreService } from '../../services/firestore';
import { Client } from '../../types';
import { toast } from 'sonner';

interface CostLedgerPillarProps {
  tenantId: string;
  role: string;
}

export const CostLedgerPillar: React.FC<CostLedgerPillarProps> = ({ tenantId, role }) => {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [outreachEvents, setOutreachEvents] = useState<any[]>([]);
  
  // Predict toggling from settings or local storage
  const [includeInPredictive, setIncludeInPredictive] = useState<boolean>(() => {
    return localStorage.getItem('m14_include_predictive_f') === 'true';
  });

  // Expense form state
  const [cat, setCat] = useState('Campaign Activity');
  const [amount, setAmount] = useState<number>(150000);
  const [desc, setDesc] = useState('');

  // Petty Cash Request state
  const [reqAmount, setReqAmount] = useState<string>('');
  const [reqReason, setReqReason] = useState<string>('');
  const [reqIsSubmitting, setReqIsSubmitting] = useState(false);

  // Date Range Auditor Filter (default shows Today's ledger requests)
  const [isDateFilterActive, setIsDateFilterActive] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    if (tenantId) {
      firestoreService.subscribeToCollection<any>('marketing_expenses', tenantId, setExpenses);
      firestoreService.subscribeToCollection<Client>('clients', tenantId, setClients);
      firestoreService.subscribeToCollection<any>('campaigns', tenantId, setCampaigns);
      firestoreService.subscribeToCollection<any>('outreach_events', tenantId, setOutreachEvents);
      // Fetch all petty cash requests for Marketing department
      firestoreService.subscribeToCollection<any>('petty_cash_requisitions', tenantId, (data) => {
        const marketingReqs = data.filter(r => r.department === 'Marketing' || r.purpose?.toLowerCase().includes('marketing'));
        setRequisitions(marketingReqs.sort((a, b) => new Date(b.created_at || b.requisition_date).getTime() - new Date(a.created_at || a.requisition_date).getTime()));
      });
    }
  }, [tenantId]);

  const handleTogglePredictive = (val: boolean) => {
    setIncludeInPredictive(val);
    localStorage.setItem('m14_include_predictive_f', val ? 'true' : 'false');
    toast.success(`Marketing spend is ${val ? 'now included' : 'removed'} from Predictive Engine Fixed Cost (F).`);
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !desc) return;

    try {
      await firestoreService.addDocument('marketing_expenses', {
        tenantId,
        category: cat,
        amount: Number(amount),
        description: desc,
        date: new Date().toISOString().split('T')[0],
        loggedBy: role,
        status: 'approved'
      });

      toast.success('Marketing campaign expense logged successfully');
      setDesc('');
    } catch {
      toast.error('Failed to log expense.');
    }
  };

  const handleRequestPettyCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqAmount || !reqReason) {
      toast.error('Please enter amount and reason');
      return;
    }

    setReqIsSubmitting(true);
    try {
      await firestoreService.addDocument('petty_cash_requisitions', {
        tenantId,
        department: 'Marketing',
        amount: parseFloat(reqAmount),
        purpose: `[Marketing-Campaign] ${reqReason}`,
        requisition_date: new Date().toISOString().split('T')[0],
        status: 'Pending',
        requested_by_name: role || 'Marketing Specialist',
        created_at: new Date().toISOString()
      });

      toast.success('Petty cash requisition sent to Finance Head.');
      setReqAmount('');
      setReqReason('');
    } catch {
      toast.error('Failed to request disbursement.');
    } finally {
      setReqIsSubmitting(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (role === 'Marketing Personnel') {
      toast.error('Personnel are not permitted to delete direct audited expenses.');
      return;
    }
    if (window.confirm('Are you sure you want to delete this expense record?')) {
      try {
        await firestoreService.deleteDocument('marketing_expenses', id);
        toast.success('Expense cleared');
      } catch {
        toast.error('Deletion failed');
      }
    }
  };

  // Filter items based on Date Selection (default is today)
  const filteredExpenses = expenses.filter(e => {
    if (!isDateFilterActive) return true;
    const d = (e.date || '').split('T')[0];
    return d >= dateRange.start && d <= dateRange.end;
  });

  const filteredRequisitions = requisitions.filter(r => {
    if (!isDateFilterActive) return true;
    const d = (r.requisition_date || '').split('T')[0];
    return d >= dateRange.start && d <= dateRange.end;
  });

  // Math metrics for current active date frame
  const totalMarketingExpenses = filteredExpenses.reduce((acc, curr) => acc + (curr.amount || 0), 0);

  // Marketing financed balance setup: Initial budget cash allocation + approved requisitions (disbursements)
  const startingMarketingBudgetFloat = 2500000;
  const approvedDisbursedAmount = requisitions
    .filter(r => r.status === 'Approved' || r.status === 'approved' || r.status === 'finance_approved')
    .reduce((acc, curr) => acc + (curr.amount || 0), 0);

  const totalInflowCash = startingMarketingBudgetFloat + approvedDisbursedAmount;

  // 1. Allocated Portfolio: Active Campaigns & Active Outreaches
  const activeCampaignsAllocated = campaigns
    .filter(c => c.status === 'active')
    .reduce((acc, curr) => acc + (curr.budget || 0), 0);
    
  const activeOutreachesAllocated = outreachEvents
    .filter(o => o.status === 'active')
    .reduce((acc, curr) => acc + (curr.budgetedAmount || 0), 0);
    
  const allocatedPortfolio = activeCampaignsAllocated + activeOutreachesAllocated;

  // 2. Used Portfolio: Total direct expenses
  const usedPortfolio = expenses.reduce((acc, curr) => acc + (curr.amount || 0), 0);

  // 3. Available Portfolio (Funds Available)
  const availablePortfolio = totalInflowCash - allocatedPortfolio - usedPortfolio;

  // PharmPoints Liability
  const totalUnspentPoints = clients.reduce((acc, curr) => acc + (curr.loyalty_points || 0), 0);
  const pointsRedeemValue = 10;
  const pointsLiabilityBalance = totalUnspentPoints * pointsRedeemValue;

  const isFinanceOrHead = role === 'Marketing Head' || role === 'Finance Head' || role === 'CEO' || role === 'admin';

  return (
    <div className="space-y-6 animate-in fade-in">
      
      {/* LOCAL DEPARTMENT DATE SELECTOR AUDITOR */}
      <div className="bg-zinc-50 border border-zinc-200 p-5 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
        <div>
          <h4 className="font-extrabold text-zinc-950 text-xs">Department Finance Auditor & Date Filter</h4>
          <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Reports default to today's date for strict real-time control</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-750 cursor-pointer">
            <input 
              type="checkbox" 
              checked={isDateFilterActive} 
              onChange={(e) => setIsDateFilterActive(e.target.checked)}
              className="rounded bg-white border-zinc-200 text-zinc-950 focus:ring-0"
            />
            Limit Day
          </label>
          {isDateFilterActive && (
            <div className="flex items-center gap-2 animate-in fade-in duration-150">
              <input 
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                className="bg-white border border-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-xl outline-none"
              />
              <span className="text-zinc-400 text-xs">-</span>
              <input 
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                className="bg-white border border-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-xl outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* CLARITY BOX: HOW MONEY FLOWS IN MARKETING */}
      <div className="bg-indigo-50 border border-indigo-150 p-6 rounded-3xl space-y-2">
        <h4 className="font-black text-indigo-950 text-xs uppercase tracking-widest flex items-center gap-2">
          <Sparkles size={14} className="text-indigo-650" /> Portfolio Capital Ledger Guidelines
        </h4>
        <p className="text-zinc-700 text-xs leading-relaxed">
          <strong>How money is brought in:</strong> Initial floating capital is <strong>UGX 2,500,000</strong>. When additional money is needed, request it in the <strong>Petty Cash Requisition Form</strong> below. Once approved and issued by the Finance department, it is automatically added to the <strong>Total Float Capital</strong>.
        </p>
        <p className="text-zinc-700 text-xs leading-relaxed">
          <strong>How money is used:</strong>
          <br />
          1. <strong>Allocated Portfolio:</strong> Entering a budget for a planned or active Campaign/Outreach moves that amount from <em>Available Portfolio</em> to <em>Allocated Portfolio</em>.
          <br />
          2. <strong>Used Portfolio:</strong> When the campaign is marked as completed and locked, or when disbursements/outreach is processed, actual spent funds are registered in the <em>Used Portfolio (Direct Expenses)</em>.
          <br />
          3. <strong>Reverted Balance:</strong> If actual spend is less than the budgeted allocation, the remaining unused balance is automatically returned to the <em>Available Portfolio</em>.
        </p>
      </div>

      {/* FINANCIAL AUDITING BANNER */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="bg-white rounded-3xl border border-emerald-200 p-6 shadow-xs space-y-1 relative overflow-hidden">
          <p className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded w-fit uppercase tracking-widest">Available Portfolio</p>
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Funds Available</p>
          <h2 className="text-2xl font-black font-mono text-emerald-600">UGX {availablePortfolio.toLocaleString()}</h2>
          <p className="text-[10px] text-zinc-500">Ready for campaigns & rewards</p>
        </div>

        <div className="bg-white rounded-3xl border border-amber-200 p-6 shadow-xs space-y-1 relative overflow-hidden">
          <p className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded w-fit uppercase tracking-widest">Allocated Portfolio</p>
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Reserved Budgets</p>
          <h2 className="text-2xl font-black font-mono text-amber-600">UGX {allocatedPortfolio.toLocaleString()}</h2>
          <p className="text-[10px] text-zinc-500">Allocated to active activities</p>
        </div>

        <div className="bg-white rounded-3xl border border-zinc-200 p-6 shadow-xs space-y-1">
          <p className="text-[10px] font-black text-rose-500 bg-rose-50 px-2 py-0.5 rounded w-fit uppercase tracking-widest">Used Portfolio</p>
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Actual Expenditures</p>
          <h2 className="text-2xl font-black font-mono text-rose-650">UGX {usedPortfolio.toLocaleString()}</h2>
          <p className="text-[10px] text-zinc-500 font-medium">All-time settled expenses</p>
        </div>

        <div className="bg-white rounded-3xl border border-indigo-200 p-6 shadow-xs space-y-1">
          <p className="text-[10px] font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded w-fit uppercase tracking-widest font-sans">Total Float Capital</p>
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Total Inflow Float</p>
          <h2 className="text-2xl font-black font-mono text-indigo-700">UGX {totalInflowCash.toLocaleString()}</h2>
          <p className="text-[10px] text-zinc-500">Starting budget + Petty approvals</p>
        </div>

        {/* PREDICTIVE ENGINE SYNERGY CAPABILITY */}
        <div className="bg-zinc-950 text-white rounded-3xl p-6 shadow-sm flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-[9px] font-black text-indigo-400 bg-indigo-950 px-2 py-0.5 rounded uppercase tracking-wider">
              M11 Synergy Optimizer
            </span>
            <p className="text-[10px] text-zinc-400 leading-tight">Sync Marketing spends to master Break-Even optimizer equations (F).</p>
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-zinc-900 mt-2">
            <input
              type="checkbox"
              checked={includeInPredictive}
              onChange={e => handleTogglePredictive(e.target.checked)}
              className="rounded bg-zinc-800 text-indigo-600 focus:ring-0 border-zinc-700"
            />
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Master Sync Spends</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEDGER AND REQUISITIONS AREA */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Main Campaign Expenses Ledger */}
          <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm p-6 space-y-4">
            <div>
              <h3 className="font-black text-zinc-900 text-md uppercase tracking-tight">Campaign Expense Ledger</h3>
              <p className="text-zinc-500 text-[11px]">Real-time departmental marketing expenditures.</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500 font-bold uppercase border-b border-zinc-200">
                    <th className="px-4 py-3">Expense Category</th>
                    <th className="px-4 py-3">Audit Details</th>
                    <th className="px-4 py-3 text-right">Amount (UGX)</th>
                    <th className="px-4 py-3">Auditor / Date</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 font-semibold text-zinc-700">
                  {filteredExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center p-8 text-zinc-400 italic">No marketing expenses logged on this date slot.</td>
                    </tr>
                  ) : (
                    filteredExpenses.map((e, idx) => (
                      <tr key={e.id || idx} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-zinc-950 font-extrabold">{e.category}</span>
                        </td>
                        <td className="px-4 py-3 text-zinc-500 font-normal max-w-xs">{e.description}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-zinc-950">
                          UGX {(e.amount || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-zinc-500">{e.loggedBy || 'Marketing Officer'}</div>
                          <div className="text-[10px] text-zinc-400 font-mono">{e.date}</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            disabled={role === 'Marketing Personnel'}
                            onClick={() => handleDeleteExpense(e.id)}
                            className="p-1.5 text-zinc-400 hover:text-red-650 disabled:text-zinc-200 rounded transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Departmental Petty Cash Requisitions History Tracker */}
          <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm p-6 space-y-4">
            <div>
              <h3 className="font-black text-zinc-900 text-md uppercase tracking-tight flex items-center gap-2">
                <Clock size={16} /> Petty Cash Disbursement Requests
              </h3>
              <p className="text-zinc-500 text-[11px]">Departmental funds requested from Corporate Petty Cash Vault.</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500 font-bold uppercase border-b border-zinc-200">
                    <th className="px-4 py-3">Request Date</th>
                    <th className="px-4 py-3">Requisition Purpose</th>
                    <th className="px-4 py-3 text-right">Requested (UGX)</th>
                    <th className="px-4 py-3 text-right">Approval Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 font-semibold text-zinc-700">
                  {filteredRequisitions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center p-8 text-zinc-400 italic">No departmental petty cash requests found.</td>
                    </tr>
                  ) : (
                    filteredRequisitions.map((req, idx) => (
                      <tr key={req.id || idx} className="hover:bg-zinc-200/40 transition-colors">
                        <td className="px-4 py-3 text-zinc-650">{req.requisition_date || 'Today'}</td>
                        <td className="px-4 py-3 font-normal">
                          <p className="font-extrabold text-zinc-950">{req.purpose}</p>
                          <p className="text-[10px] text-zinc-400">Filed by: {req.requested_by_name || 'Marketing Head'}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-black text-zinc-950">UGX {(req.amount || 0).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`px-2.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                            req.status === 'approved' || req.status === 'finance_approved'
                              ? 'bg-emerald-50 text-emerald-700'
                              : req.status === 'declined' || req.status === 'rejected'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}>
                            {req.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* RIGHT SIDEBAR: QUICK CAMPAIGN EXPENDITURE FORMS */}
        <div className="space-y-6">
          
          {/* Request Petty Cash Form widget */}
          <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-sm space-y-4">
            <div>
              <span className="text-[8px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded uppercase tracking-wider">Fund Request</span>
              <h4 className="font-bold text-zinc-900 text-sm uppercase tracking-tight mt-1 flex items-center gap-2">
                <Send size={15} /> Request Petty Cash Inflow
              </h4>
              <p className="text-zinc-500 text-[11px] mt-1">Submit digital voucher request to corporate Finance Head office for approval.</p>
            </div>

            <form onSubmit={handleRequestPettyCash} className="space-y-3 font-semibold text-xs text-zinc-700">
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 uppercase">Amount Required (UGX)</label>
                <input 
                  type="number" required placeholder="e.g. 500000"
                  value={reqAmount}
                  onChange={(e) => setReqAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl font-bold font-mono outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 uppercase">Purpose / Resource Purchase</label>
                <textarea 
                  required placeholder="Printing 500 brochures for the central clinical prescriber tour."
                  value={reqReason} rows={2}
                  onChange={(e) => setReqReason(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl resize-none outline-none text-xs"
                />
              </div>

              <button
                type="submit" disabled={reqIsSubmitting}
                className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 text-white font-bold uppercase tracking-wider text-[10px] rounded-xl duration-150 flex items-center justify-center gap-2"
              >
                <Sparkles size={12} /> Submit Request
              </button>
            </form>
          </div>

          {/* Action General Campaign Expense logging */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-3xl p-6 h-fit space-y-4">
            <div>
              <span className="text-[8px] font-black text-rose-600 bg-rose-50 px-2.5 py-0.5 rounded uppercase tracking-wider">Campaign Cost Logs</span>
              <h4 className="font-bold text-zinc-900 text-sm uppercase tracking-tight mt-1 flex items-center gap-2">
                <DollarSign size={16} /> Log Campaign Expense
              </h4>
              <p className="text-zinc-500 text-[11px] mt-1">Record marketing materials, printing, banner hire, or local media costs.</p>
            </div>

            <form onSubmit={handleAddExpense} className="space-y-4 font-semibold text-xs text-zinc-700">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Log Category</label>
                <select value={cat} onChange={e => setCat(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl">
                  <option value="Campaign Activity">Campaign Activity cost</option>
                  <option value="KOL Engagement">KOL Engagement payout</option>
                  <option value="Print Materials">Banner & Flyer printing</option>
                  <option value="Media & Radio Outlets">Radio/TV Advertising bills</option>
                  <option value="Feedback Programme">Customer feedback rewards</option>
                </select>
              </div>

              <div className="space-y-1 font-mono">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider font-sans">Payment Amount (UGX)</label>
                <input required type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider font-sans">Expense Audit description</label>
                <textarea required rows={3} value={desc} onChange={e => setDesc(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl resize-none text-xs" placeholder="Cleared radio spot payment with Radio One Kampala for 6 air periods." />
              </div>

              <button
                disabled={!isFinanceOrHead} 
                type="submit" 
                className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all"
              >
                {!isFinanceOrHead ? 'Finance/Head Permission Required' : 'Audit Payment Entry'}
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
};
