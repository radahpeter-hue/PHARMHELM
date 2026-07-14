import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { firestoreService } from '../../../services/firestore';
import { 
  Download, 
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Percent,
  Layers,
  BarChart3,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

interface BranchExpense {
  id: string;
  tenantId: string;
  branch_id: string;
  expense_date: string;
  category: string;
  amount_ugx: number;
  description: string;
}

interface ManagementExpense {
  id: string;
  tenantId: string;
  expense_date?: string;
  date?: string;
  category: string;
  amount: number;
  amount_ugx?: number;
  status: string;
  logged_by: string;
  description: string;
  department: string;
}

export const ProfitabilityLedger: React.FC = () => {
  const { profile } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [branchExpenses, setBranchExpenses] = useState<BranchExpense[]>([]);
  const [mgmtExpenses, setMgmtExpenses] = useState<ManagementExpense[]>([]);
  const [quarantineLogs, setQuarantineLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Date Range Ledger Filter (defaults to Today)
  const [isDateFilterActive, setIsDateFilterActive] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });

  const fetchData = async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    try {
      const salesSnap = await getDocs(query(collection(db, 'sales'), where('tenantId', '==', profile.tenantId)));
      setSales(salesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      const bExpSnap = await getDocs(query(collection(db, 'branch_expenses'), where('tenantId', '==', profile.tenantId)));
      setBranchExpenses(bExpSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      const mExpSnap = await getDocs(query(collection(db, 'management_expenses'), where('tenantId', '==', profile.tenantId)));
      setMgmtExpenses(mExpSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      const quarSnap = await getDocs(query(collection(db, 'quarantine_logs'), where('tenantId', '==', profile.tenantId)));
      setQuarantineLogs(quarSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));
    } catch (e: any) {
      console.error("Error fetching profitability metrics:", e);
      toast.error("Failed to fetch profitability metrics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile?.tenantId]);

  // Filter items globally based on Date Range
  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      if (s.status === 'voided') return false; // Exclude voided sales
      if (!isDateFilterActive) return true;
      const d = (s.timestamp || s.date || '').split('T')[0];
      return d && d >= dateRange.start && d <= dateRange.end;
    });
  }, [sales, isDateFilterActive, dateRange]);

  const filteredBranchExpenses = useMemo(() => {
    return branchExpenses.filter(e => {
      if (!isDateFilterActive) return true;
      const d = (e.expense_date || '').split('T')[0];
      return d && d >= dateRange.start && d <= dateRange.end;
    });
  }, [branchExpenses, isDateFilterActive, dateRange]);

  const filteredMgmtExpenses = useMemo(() => {
    return mgmtExpenses.filter(e => {
      if (e.status !== 'approved') return false; // Only aggregate approved/issued expenses
      if (!isDateFilterActive) return true;
      const d = (e.expense_date || e.date || '').split('T')[0];
      return d && d >= dateRange.start && d <= dateRange.end;
    });
  }, [mgmtExpenses, isDateFilterActive, dateRange]);

  const filteredQuarantine = useMemo(() => {
    return quarantineLogs.filter(q => {
      if (!isDateFilterActive) return true;
      const d = (q.dateLogged || q.date || q.created_at || '').split('T')[0];
      return d && d >= dateRange.start && d <= dateRange.end;
    });
  }, [quarantineLogs, isDateFilterActive, dateRange]);

  // Calculations
  const totalRevenue = useMemo(() => {
    return filteredSales.reduce((sum, s) => sum + (s.total || s.total_amount || s.amount || 0), 0);
  }, [filteredSales]);

  const totalCOGS = useMemo(() => {
    return filteredSales.reduce((sum, s) => sum + (s.total_cost || s.cost || (s.total || s.total_amount || 0) * 0.6), 0);
  }, [filteredSales]);

  const grossProfit = useMemo(() => {
    return totalRevenue - totalCOGS;
  }, [totalRevenue, totalCOGS]);

  const totalBranchExp = useMemo(() => {
    return filteredBranchExpenses.reduce((sum, e) => sum + (e.amount_ugx || e.amount || 0), 0);
  }, [filteredBranchExpenses]);

  const totalMgmtExp = useMemo(() => {
    return filteredMgmtExpenses.reduce((sum, e) => sum + (e.amount_ugx || e.amount || 0), 0);
  }, [filteredMgmtExpenses]);

  const totalWastage = useMemo(() => {
    return filteredQuarantine.reduce((sum, q) => sum + (q.totalCost || q.total_cost || q.estimatedValue || q.cost || 0), 0);
  }, [filteredQuarantine]);

  const totalExpenses = useMemo(() => {
    return totalBranchExp + totalMgmtExp + totalWastage;
  }, [totalBranchExp, totalMgmtExp, totalWastage]);

  const netProfit = useMemo(() => {
    return grossProfit - totalExpenses;
  }, [grossProfit, totalExpenses]);

  // Export spreadsheet report using SheetJS
  const handleExport = () => {
    const reportData = [
      { 'Metric Label': 'Gross Sales Revenue', 'Value (UGX)': totalRevenue, 'Percentage of Revenue': '100.0%' },
      { 'Metric Label': 'Cost of Goods Sold (COGS)', 'Value (UGX)': totalCOGS, 'Percentage of Revenue': totalRevenue > 0 ? `${((totalCOGS / totalRevenue) * 100).toFixed(1)}%` : '0.0%' },
      { 'Metric Label': 'Gross Profit Margin', 'Value (UGX)': grossProfit, 'Percentage of Revenue': totalRevenue > 0 ? `${((grossProfit / totalRevenue) * 100).toFixed(1)}%` : '0.0%' },
      { 'Metric Label': 'Branch Operational Expenses', 'Value (UGX)': totalBranchExp, 'Percentage of Revenue': totalRevenue > 0 ? `${((totalBranchExp / totalRevenue) * 100).toFixed(1)}%` : '0.0%' },
      { 'Metric Label': 'Corporate HQ & Management Expenses', 'Value (UGX)': totalMgmtExp, 'Percentage of Revenue': totalRevenue > 0 ? `${((totalMgmtExp / totalRevenue) * 100).toFixed(1)}%` : '0.0%' },
      { 'Metric Label': 'Wastage & Quarantine Loss', 'Value (UGX)': totalWastage, 'Percentage of Revenue': totalRevenue > 0 ? `${((totalWastage / totalRevenue) * 100).toFixed(1)}%` : '0.0%' },
      { 'Metric Label': 'Total Consolidated Expenses', 'Value (UGX)': totalExpenses, 'Percentage of Revenue': totalRevenue > 0 ? `${((totalExpenses / totalRevenue) * 100).toFixed(1)}%` : '0.0%' },
      { 'Metric Label': 'Net Profit Payout Baseline', 'Value (UGX)': netProfit, 'Percentage of Revenue': totalRevenue > 0 ? `${((netProfit / totalRevenue) * 100).toFixed(1)}%` : '0.0%' }
    ];

    const ws = XLSX.utils.json_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Profitability Statement");

    const formattedFrom = dateRange.start.split('-').reverse().join('-');
    const formattedTo = dateRange.end.split('-').reverse().join('-');
    XLSX.writeFile(wb, `Profitability_Ledger_Statement_${formattedFrom}_to_${formattedTo}.xlsx`);
    toast.success("Profitability excel ledger downloaded successfully!");
  };

  return (
    <div className="space-y-6">
      {/* Date filter auditor */}
      <div className="bg-zinc-50 border border-zinc-200 p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div>
          <h4 className="font-extrabold text-zinc-950 text-sm">Profitability Ledger Auditor</h4>
          <p className="text-[10px] text-zinc-500 font-medium">Configure date intervals to verify Month-to-Date (MTD) or custom period margins.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-750 cursor-pointer">
            <input 
              type="checkbox" 
              checked={isDateFilterActive} 
              onChange={(e) => setIsDateFilterActive(e.target.checked)}
              className="rounded bg-white border-zinc-200 text-zinc-950 focus:ring-0"
            />
            Filter Ledger Date
          </label>
          {isDateFilterActive && (
            <div className="flex items-center gap-2">
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

      {/* Margins Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-emerald-500 p-6 rounded-3xl text-white shadow-xl shadow-emerald-500/20">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Gross Profit</p>
          <h3 className="text-3xl font-black">UGX {grossProfit.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 font-bold bg-white/20 inline-block px-2 py-1 rounded">
            Margin: {totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : 0}%
          </p>
        </div>
        <div className="bg-zinc-900 p-6 rounded-3xl text-white shadow-xl shadow-zinc-900/20">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Total Expenses</p>
          <h3 className="text-3xl font-black">UGX {totalExpenses.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 font-bold bg-white/20 inline-block px-2 py-1 rounded">Incl. Wastage</p>
        </div>
        <div className={`p-6 rounded-3xl text-white shadow-xl ${
          netProfit >= 0 ? "bg-blue-600 shadow-blue-600/20" : "bg-red-600 shadow-red-600/20"
        }`}>
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Net Profit</p>
          <h3 className="text-3xl font-black">UGX {netProfit.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 font-bold bg-white/20 inline-block px-2 py-1 rounded">Bottom Line</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Wastage / Recalls Loss</p>
          <h3 className="text-3xl font-black text-red-500 font-mono">UGX {totalWastage.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 font-bold text-zinc-400">Recall & Quarantine</p>
        </div>
      </div>

      {/* Profitability breakdown statement */}
      <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-150 pb-4">
          <div>
            <h3 className="font-extrabold text-zinc-900 text-base">Profitability Breakdown Statement</h3>
            <p className="text-xs text-zinc-500">A detailed breakdown of revenue, cost of sales, operating expenses, and final profit margins.</p>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#1A5E38] hover:bg-[#124227] text-white rounded-xl shadow-sm transition-all"
          >
            <Download size={14} /> Download Excel Statement
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-zinc-500 font-bold flex flex-col items-center gap-2">
            <RefreshCw className="animate-spin text-zinc-400" size={24} />
            Recalculating bottom line statement...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl hover:bg-zinc-100/50 transition-colors">
              <span className="font-bold text-zinc-600 text-sm">Total Sales Revenue</span>
              <span className="font-black text-zinc-950 font-mono text-sm">UGX {totalRevenue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl hover:bg-zinc-100/50 transition-colors">
              <span className="font-bold text-zinc-600 text-sm">Cost of Goods Sold (COGS)</span>
              <span className="font-black text-red-500 font-mono text-sm">- UGX {totalCOGS.toLocaleString()}</span>
            </div>
            <div className="h-px bg-zinc-200 my-2" />
            <div className="flex justify-between items-center p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
              <span className="font-bold text-emerald-700 text-sm flex items-center gap-1.5"><BarChart3 size={16} /> Gross Profit Margin</span>
              <div className="text-right">
                <span className="font-black text-emerald-700 font-mono text-sm">UGX {grossProfit.toLocaleString()}</span>
                <span className="text-[10px] font-bold text-emerald-600 block">{totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : 0}% margin</span>
              </div>
            </div>
            <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl hover:bg-zinc-100/50 transition-colors">
              <span className="font-bold text-zinc-600 text-sm">Branch Operational Expenses</span>
              <span className="font-black text-red-500 font-mono text-sm">- UGX {totalBranchExp.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl hover:bg-zinc-100/50 transition-colors">
              <span className="font-bold text-zinc-600 text-sm">Management/HQ Expenses</span>
              <span className="font-black text-red-500 font-mono text-sm">- UGX {totalMgmtExp.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl hover:bg-zinc-100/50 transition-colors">
              <span className="font-bold text-zinc-600 text-sm">Inventory Wastage & Recalls (Loss)</span>
              <span className="font-black text-red-500 font-mono text-sm">- UGX {totalWastage.toLocaleString()}</span>
            </div>
            <div className="h-px bg-zinc-200 my-2" />
            <div className={`flex justify-between items-center p-6 rounded-2xl border ${
              netProfit >= 0 ? "bg-blue-50 border-blue-100" : "bg-red-50 border-red-100"
            }`}>
              <span className={`text-base font-black ${netProfit >= 0 ? "text-blue-700" : "text-red-700"}`}>Net Profit Baseline</span>
              <div className="text-right">
                <span className={`text-xl font-black font-mono block ${netProfit >= 0 ? "text-blue-700" : "text-red-700"}`}>UGX {netProfit.toLocaleString()}</span>
                <span className={`text-[10px] font-bold ${netProfit >= 0 ? "text-blue-600" : "text-red-600"}`}>
                  {totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : 0}% net return
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
