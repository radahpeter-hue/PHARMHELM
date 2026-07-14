import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { firestoreService } from '../../../services/firestore';
import { Search, Filter, Download, History, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { collection, query, where, getDocs, Timestamp, orderBy } from 'firebase/firestore';
import { db } from '../../../firebase';
import { toast } from 'sonner';

interface EODReconciliation {
  id: string;
  tenantId: string;
  branch_id: string;
  reconciliation_date: string;
  cashier_id: string;
  
  cash_expected: number;
  cash_actual: number;
  cash_variance: number;

  momo_expected: number;
  momo_actual: number;
  momo_variance: number;

  airtel_expected: number;
  airtel_actual: number;
  airtel_variance: number;

  card_expected: number;
  card_actual: number;
  card_variance: number;

  insurance_expected: number;
  insurance_actual: number;
  insurance_variance: number;

  institutional_credit_expected: number;
  institutional_credit_actual: number;
  institutional_credit_variance: number;

  staff_welfare_expected: number;
  staff_welfare_actual: number;
  staff_welfare_variance: number;

  total_expected: number;
  total_actual: number;
  total_variance: number;

  variance_reason?: string;
  logged_by?: string;
  created_at?: string;
  status: string;
}

interface Branch {
  id: string;
  name?: string;
  branch_name?: string;
  tenantId: string;
}

export const EodReconciliationBox: React.FC = () => {
  const { profile } = useAuth();
  const [reconciliations, setReconciliations] = useState<EODReconciliation[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Date range filters based on reconciliation date (defaults to current month)
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const end = today.toISOString().split('T')[0];
    return { start, end };
  });

  // Filters
  const [selectedBranchId, setSelectedBranchId] = useState('All');
  const [selectedVarianceType, setSelectedVarianceType] = useState<'All' | 'Positive' | 'Negative' | 'Zero'>('All');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 50;

  // Fetch branches & reconciliations
  const fetchData = async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    try {
      // Fetch Branches
      const branchesData = await firestoreService.getCollection<Branch>('branches', profile.tenantId);
      setBranches(branchesData);

      // Fetch Staff for mapping UIDs to full names
      const staffData = await firestoreService.getCollection<any>('staff', profile.tenantId);
      setStaffList(staffData);

      // Fetch Reconciliations based on date range
      const colRef = collection(db, 'eod_reconciliations');
      // reconciliation_date is stored as YYYY-MM-DD string
      const q = query(
        colRef,
        where('tenantId', '==', profile.tenantId),
        where('reconciliation_date', '>=', dateRange.start),
        where('reconciliation_date', '<=', dateRange.end)
      );

      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({
        ...(doc.data() as any),
        id: doc.id
      })) as EODReconciliation[];

      // Sort by reconciliation_date descending
      data.sort((a, b) => b.reconciliation_date.localeCompare(a.reconciliation_date));
      setReconciliations(data);
    } catch (e: any) {
      console.error("Error fetching EOD reconciliations:", e);
      toast.error("Failed to load EOD reconciliations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile?.tenantId, dateRange.start, dateRange.end]);

  // Map branch ID to branch Name
  const branchMap = useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach(b => map.set(b.id, b.name || b.branch_name || b.branchName || b.id));
    return map;
  }, [branches]);

  // Helper to map logged_by user ID to staff full name
  const getLoggedByName = (loggedByUid: string | undefined) => {
    if (!loggedByUid) return 'Staff Cashier';
    const match = staffList.find(s => s.uid === loggedByUid || s.id === loggedByUid);
    return match ? (match.full_name || match.fullName || match.displayName || loggedByUid) : loggedByUid;
  };

  // Client-side filtering
  const filteredReconciliations = useMemo(() => {
    return reconciliations.filter(rec => {
      // Branch filter
      if (selectedBranchId !== 'All' && rec.branch_id !== selectedBranchId) return false;

      // Variance Type Filter
      const variance = rec.total_variance || 0;
      if (selectedVarianceType === 'Positive' && variance <= 0) return false;
      if (selectedVarianceType === 'Negative' && variance >= 0) return false;
      if (selectedVarianceType === 'Zero' && variance !== 0) return false;

      return true;
    });
  }, [reconciliations, selectedBranchId, selectedVarianceType]);

  // Paginated Reconciliations
  const paginatedReconciliations = useMemo(() => {
    const startIdx = (currentPage - 1) * rowsPerPage;
    return filteredReconciliations.slice(startIdx, startIdx + rowsPerPage);
  }, [filteredReconciliations, currentPage]);

  const totalPages = Math.ceil(filteredReconciliations.length / rowsPerPage) || 1;

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBranchId, selectedVarianceType]);

  // Calculations for Totals Summary Row across ALL filtered rows
  const totals = useMemo(() => {
    let cash = 0, card = 0, momo = 0, airtel = 0, credit = 0, welfare = 0, revenue = 0, variance = 0;
    filteredReconciliations.forEach(rec => {
      cash += rec.cash_actual || 0;
      card += rec.card_actual || 0;
      momo += rec.momo_actual || 0;
      airtel += rec.airtel_actual || 0;
      credit += rec.institutional_credit_actual || 0;
      welfare += rec.staff_welfare_actual || 0;
      revenue += rec.total_actual || 0;
      variance += rec.total_variance || 0;
    });
    return { cash, card, momo, airtel, credit, welfare, revenue, variance };
  }, [filteredReconciliations]);

  // Export to Excel using SheetJS
  const handleExport = () => {
    if (filteredReconciliations.length === 0) {
      toast.error("No reconciliation data to export");
      return;
    }

    // Map filtered rows to printable rows
    const exportData = filteredReconciliations.map(rec => {
      const branchName = branchMap.get(rec.branch_id) || rec.branch_id || 'Unknown Branch';
      const formattedDate = rec.reconciliation_date.split('-').reverse().join('/');
      return {
        'Date': formattedDate,
        'Branch': branchName,
        'Cash (UGX)': rec.cash_actual || 0,
        'Card (UGX)': rec.card_actual || 0,
        'MoMo (UGX)': rec.momo_actual || 0,
        'Airtel (UGX)': rec.airtel_actual || 0,
        'Institution Credits (UGX)': rec.institutional_credit_actual || 0,
        'Welfare (UGX)': rec.staff_welfare_actual || 0,
        'Total Revenue (UGX)': rec.total_actual || 0,
        'Variance (UGX)': rec.total_variance || 0,
        'Reconciled By': getLoggedByName(rec.logged_by)
      };
    });

    // Append summary/totals row at the bottom
    exportData.push({
      'Date': 'TOTALS',
      'Branch': '',
      'Cash (UGX)': totals.cash,
      'Card (UGX)': totals.card,
      'MoMo (UGX)': totals.momo,
      'Airtel (UGX)': totals.airtel,
      'Institution Credits (UGX)': totals.credit,
      'Welfare (UGX)': totals.welfare,
      'Total Revenue (UGX)': totals.revenue,
      'Variance (UGX)': totals.variance,
      'Reconciled By': ''
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "EOD Reconciliations");

    const branchNamePart = selectedBranchId === 'All' 
      ? 'AllBranches' 
      : (branchMap.get(selectedBranchId) || 'Branch').replace(/\s+/g, '');
    const formattedFrom = dateRange.start.split('-').reverse().join('-');
    const formattedTo = dateRange.end.split('-').reverse().join('-');

    XLSX.writeFile(wb, `EODReport_${branchNamePart}_${formattedFrom}_${formattedTo}.xlsx`);
    toast.success("Excel report exported successfully");
  };

  const formatVariance = (val: number) => {
    const formatted = Math.abs(val).toLocaleString();
    if (val > 0) {
      return <span className="text-emerald-600 font-bold font-mono">+{formatted}</span>;
    } else if (val < 0) {
      return <span className="text-red-600 font-bold font-mono">-{formatted}</span>;
    } else {
      return <span className="text-zinc-400 font-semibold font-mono">0</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-zinc-900 tracking-tight">EOD Reconciliation Log</h2>
          <p className="text-sm text-zinc-500">All branch end-of-day reconciliations.</p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-[#1A5E38] hover:bg-[#154b2d] text-white rounded-xl shadow-sm transition-all self-start md:self-auto"
        >
          <Download size={16} />
          Download Report
        </button>
      </div>

      {/* Date & Filter Panel */}
      <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Date From:</span>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="border border-zinc-200 px-3 py-1.5 rounded-xl text-sm font-medium outline-none text-zinc-700 focus:border-[#1A5E38]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Date To:</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="border border-zinc-200 px-3 py-1.5 rounded-xl text-sm font-medium outline-none text-zinc-700 focus:border-[#1A5E38]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Branch Filter */}
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2 rounded-xl">
            <Filter size={16} className="text-zinc-400" />
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="bg-transparent border-none text-sm outline-none w-full text-zinc-800"
            >
              <option value="All">All Branches</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name || b.branch_name || b.id}</option>
              ))}
            </select>
          </div>

          {/* Variance Type Filter */}
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2 rounded-xl">
            <Filter size={16} className="text-zinc-400" />
            <select
              value={selectedVarianceType}
              onChange={(e) => setSelectedVarianceType(e.target.value as any)}
              className="bg-transparent border-none text-sm outline-none w-full text-zinc-800"
            >
              <option value="All">All Variances</option>
              <option value="Positive">Positive Variance</option>
              <option value="Negative">Negative Variance</option>
              <option value="Zero">Zero Variance</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results Table with Summary Row */}
      <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1A5E38]"></div>
            <p className="text-zinc-500 text-sm font-semibold">Loading reconciliations...</p>
          </div>
        ) : filteredReconciliations.length === 0 ? (
          <div className="text-center py-16">
            <History className="mx-auto h-12 w-12 text-zinc-300 mb-3" />
            <p className="text-zinc-500 font-medium">No reconciliation records found for the selected period.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-500 uppercase tracking-wider">
                  <th className="px-4 py-4">Date</th>
                  <th className="px-4 py-4">Branch</th>
                  <th className="px-4 py-4 text-right">Cash (UGX)</th>
                  <th className="px-4 py-4 text-right">Card (UGX)</th>
                  <th className="px-4 py-4 text-right">MoMo (UGX)</th>
                  <th className="px-4 py-4 text-right">Airtel (UGX)</th>
                  <th className="px-4 py-4 text-right">Credits (UGX)</th>
                  <th className="px-4 py-4 text-right">Welfare (UGX)</th>
                  <th className="px-4 py-4 text-right">Total Rev (UGX)</th>
                  <th className="px-4 py-4 text-right">Variance (UGX)</th>
                  <th className="px-4 py-4">Reconciled By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 font-medium text-zinc-700">
                {paginatedReconciliations.map((rec) => {
                  const branchName = branchMap.get(rec.branch_id) || rec.branch_id || 'Unknown';
                  const formattedDate = rec.reconciliation_date.split('-').reverse().join('/');
                  return (
                    <tr key={rec.id} className="hover:bg-zinc-50/30 transition-all">
                      <td className="px-4 py-4 text-zinc-500 font-mono">{formattedDate}</td>
                      <td className="px-4 py-4 font-bold text-zinc-900">{branchName}</td>
                      <td className="px-4 py-4 text-right font-mono">{rec.cash_actual?.toLocaleString() || 0}</td>
                      <td className="px-4 py-4 text-right font-mono">{rec.card_actual?.toLocaleString() || 0}</td>
                      <td className="px-4 py-4 text-right font-mono">{rec.momo_actual?.toLocaleString() || 0}</td>
                      <td className="px-4 py-4 text-right font-mono">{rec.airtel_actual?.toLocaleString() || 0}</td>
                      <td className="px-4 py-4 text-right font-mono">{rec.institutional_credit_actual?.toLocaleString() || 0}</td>
                      <td className="px-4 py-4 text-right font-mono">{rec.staff_welfare_actual?.toLocaleString() || 0}</td>
                      <td className="px-4 py-4 text-right font-mono font-bold text-zinc-950">{rec.total_actual?.toLocaleString() || 0}</td>
                      <td className="px-4 py-4 text-right font-mono">{formatVariance(rec.total_variance || 0)}</td>
                      <td className="px-4 py-4 text-zinc-500 truncate max-w-[120px]">{getLoggedByName(rec.logged_by)}</td>
                    </tr>
                  );
                })}

                {/* Totals Summary Row */}
                <tr className="bg-zinc-100/80 border-t-2 border-zinc-300 font-black text-zinc-950">
                  <td className="px-4 py-4 font-bold">TOTALS</td>
                  <td className="px-4 py-4"></td>
                  <td className="px-4 py-4 text-right font-mono">{totals.cash.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right font-mono">{totals.card.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right font-mono">{totals.momo.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right font-mono">{totals.airtel.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right font-mono">{totals.credit.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right font-mono">{totals.welfare.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right font-mono">{totals.revenue.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right font-mono">{formatVariance(totals.variance)}</td>
                  <td className="px-4 py-4"></td>
                </tr>
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 bg-zinc-50 border-t border-zinc-200">
                <span className="text-xs text-zinc-500 font-medium">
                  Showing page {currentPage} of {totalPages} ({filteredReconciliations.length} records)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="p-1 px-3 border border-zinc-200 rounded-lg text-xs font-bold text-zinc-600 hover:bg-white disabled:opacity-50 disabled:hover:bg-transparent transition-all"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="p-1 px-3 border border-zinc-200 rounded-lg text-xs font-bold text-zinc-600 hover:bg-white disabled:opacity-50 disabled:hover:bg-transparent transition-all"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
