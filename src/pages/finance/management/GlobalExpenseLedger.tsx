import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { firestoreService } from '../../../services/firestore';
import { 
  Search, 
  Filter, 
  Download, 
  RefreshCw,
  TrendingDown,
  Building,
  Truck,
  Layers,
  Award
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
  logged_by?: string;
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

interface ConsolidatedExpense {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  department: string; // Branch Name or Logistics/HR
  type: 'Branch' | 'Management' | 'Logistics' | 'Payroll';
  loggedBy: string;
}

export const GlobalExpenseLedger: React.FC = () => {
  const { profile } = useAuth();
  
  // RAW Data
  const [branchExpenses, setBranchExpenses] = useState<BranchExpense[]>([]);
  const [mgmtExpenses, setMgmtExpenses] = useState<ManagementExpense[]>([]);
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<any[]>([]);
  const [fineLogs, setFineLogs] = useState<any[]>([]);
  const [logisticsExpenses, setLogisticsExpenses] = useState<any[]>([]);
  const [payrollList, setPayrollList] = useState<any[]>([]);
  const [marketingExpenses, setMarketingExpenses] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('All');
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterDept, setFilterDept] = useState<string>('All');
  const [filterLoggedBy, setFilterLoggedBy] = useState<string>('All');
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const end = today.toISOString().split('T')[0];
    return { start, end };
  });

  const fetchData = async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    try {
      // 1. Fetch branches
      const branchSnap = await getDocs(query(
        collection(db, 'branches'),
        where('tenantId', '==', profile.tenantId)
      ));
      const bList = branchSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      setBranches(bList);

      // 2. Fetch Branch Expenses
      const branchExpSnap = await getDocs(query(
        collection(db, 'branch_expenses'),
        where('tenantId', '==', profile.tenantId)
      ));
      setBranchExpenses(branchExpSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      // 3. Fetch Management Expenses (approved / issued only)
      const mgmtExpSnap = await getDocs(query(
        collection(db, 'management_expenses'),
        where('tenantId', '==', profile.tenantId)
      ));
      const mExpenses = mgmtExpSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })) as ManagementExpense[];
      // Filter out drafts or rejected, only take issued/approved
      setMgmtExpenses(mExpenses.filter(e => e.status === 'approved'));

      // 4. Fetch Logistics logs
      const fuelSnap = await getDocs(query(
        collection(db, 'fuel_logs'),
        where('tenantId', '==', profile.tenantId)
      ));
      setFuelLogs(fuelSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      const maintSnap = await getDocs(query(
        collection(db, 'maintenance_logs'),
        where('tenantId', '==', profile.tenantId)
      ));
      setMaintenanceLogs(maintSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      const fineSnap = await getDocs(query(
        collection(db, 'traffic_fine_logs'),
        where('tenantId', '==', profile.tenantId)
      ));
      setFineLogs(fineSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      const logExpSnap = await getDocs(query(
        collection(db, 'logistics_expenses'),
        where('tenantId', '==', profile.tenantId)
      ));
      setLogisticsExpenses(logExpSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      // 5. Fetch payroll
      const payrollSnap = await getDocs(query(
        collection(db, 'payroll'),
        where('tenantId', '==', profile.tenantId)
      ));
      setPayrollList(payrollSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      // 6. Fetch marketing expenses
      const marketExpSnap = await getDocs(query(
        collection(db, 'marketing_expenses'),
        where('tenantId', '==', profile.tenantId)
      ));
      setMarketingExpenses(marketExpSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      // 7. Fetch all staff members to map raw UIDs to full names
      const staffSnap = await getDocs(query(
        collection(db, 'staff'),
        where('tenantId', '==', profile.tenantId)
      ));
      setStaff(staffSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

    } catch (e: any) {
      console.error("Error gathering global expenses:", e);
      toast.error("Failed to load global expenses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile?.tenantId]);

  // Consolidate everything into a single, clean Array
  const consolidatedList = useMemo(() => {
    const list: ConsolidatedExpense[] = [];

    // Map branch mapped name
    const bMap = new Map<string, string>();
    branches.forEach(b => bMap.set(b.id, b.name || b.branch_name));

    // Map staff UID -> Full Name
    const staffMap = new Map<string, string>();
    staff.forEach(s => {
      const name = s.full_name || s.displayName || s.name || '';
      if (name) {
        staffMap.set(s.id, name);
        if (s.uid) staffMap.set(s.uid, name);
      }
    });

    // A. Branch Expenses
    branchExpenses.forEach(e => {
      list.push({
        id: e.id,
        date: e.expense_date || '',
        category: e.category,
        description: e.description,
        amount: e.amount_ugx || 0,
        department: bMap.get(e.branch_id) || e.branch_id || 'Branch Expense',
        type: 'Branch',
        loggedBy: (e as any).logged_by_name || staffMap.get(e.logged_by || '') || e.logged_by || 'Branch Staff'
      });
    });

    // B. Management Expenses
    mgmtExpenses.forEach(e => {
      list.push({
        id: e.id,
        date: (e.expense_date || e.date || '').split('T')[0],
        category: e.category,
        description: e.description,
        amount: e.amount_ugx || e.amount || 0,
        department: e.department || 'HQ',
        type: 'Management',
        loggedBy: (e as any).logged_by_name || staffMap.get(e.logged_by || '') || e.logged_by || 'HQ Finance'
      });
    });

    // C. Logistics - Fuel
    fuelLogs.forEach(e => {
      list.push({
        id: e.id,
        date: e.date || '',
        category: 'Logistics - Fuel',
        description: `Fuel for vehicle ${e.vehicleId} at ${e.station_name || 'Fuel Station'}`,
        amount: e.cost_ugx || 0,
        department: 'Logistics Fleet',
        type: 'Logistics',
        loggedBy: e.driverName || e.driver_name || staffMap.get(e.entered_by || '') || e.entered_by || 'Driver'
      });
    });

    // D. Logistics - Maintenance
    maintenanceLogs.forEach(e => {
      list.push({
        id: e.id,
        date: e.date || '',
        category: 'Logistics - Maintenance',
        description: `Maintenance (${e.service_type || 'Service'}) for vehicle ${e.vehicleId}`,
        amount: e.cost_ugx || 0,
        department: 'Logistics Fleet',
        type: 'Logistics',
        loggedBy: e.logged_by_name || staffMap.get(e.logged_by || e.entered_by || '') || e.logged_by || 'Fleet Officer'
      });
    });

    // E. Logistics - Fines
    fineLogs.forEach(e => {
      list.push({
        id: e.id,
        date: e.date || '',
        category: 'Logistics - Fine',
        description: `Traffic fine: ${e.violation_type || 'Violation'} (${e.vehicleId})`,
        amount: e.fine_amount_ugx || 0,
        department: 'Logistics Fleet',
        type: 'Logistics',
        loggedBy: e.logged_by_name || staffMap.get(e.logged_by || e.entered_by || '') || e.logged_by || 'Fleet Driver'
      });
    });

    // F. Logistics - General
    logisticsExpenses.forEach(e => {
      list.push({
        id: e.id,
        date: e.date || '',
        category: `Logistics - ${e.category || 'General'}`,
        description: e.notes || 'Other fleet operating cost',
        amount: e.cost_ugx || 0,
        department: 'Logistics Fleet',
        type: 'Logistics',
        loggedBy: e.logged_by_name || staffMap.get(e.logged_by || e.entered_by || '') || e.logged_by || 'Fleet Controller'
      });
    });

    // G. Payroll
    payrollList.filter(p => p.status === 'paid').forEach(p => {
      list.push({
        id: p.id,
        date: p.paid_date || (p.generated_at ? p.generated_at.split('T')[0] : ''),
        category: 'HR - Payroll Paid Out',
        description: `Net remuneration payouts to ${p.staff_name || 'Staff User'}`,
        amount: p.net_salary || 0,
        department: 'HQ / HR',
        type: 'Payroll',
        loggedBy: 'HR System'
      });
    });

    // H. Marketing Expenses
    marketingExpenses.forEach(e => {
      list.push({
        id: e.id,
        date: e.date || '',
        category: `Marketing - ${e.category || 'General'}`,
        description: e.description || 'Marketing campaign cost',
        amount: e.amount || 0,
        department: 'Marketing Department',
        type: 'Management',
        loggedBy: e.logged_by_name || staffMap.get(e.logged_by || '') || e.loggedBy || 'Marketing Specialist'
      });
    });

    // Sort descending by date
    list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return list;
  }, [branchExpenses, mgmtExpenses, fuelLogs, maintenanceLogs, fineLogs, logisticsExpenses, payrollList, branches, marketingExpenses, staff]);

  // Dropdown values arrays
  const typesList = ['All', 'Branch', 'Management', 'Logistics', 'Payroll'];
  
  const categoriesList = useMemo(() => {
    const set = new Set(consolidatedList.map(e => e.category).filter(Boolean));
    return ['All', ...Array.from(set)];
  }, [consolidatedList]);

  const departmentsList = useMemo(() => {
    const set = new Set(consolidatedList.map(e => e.department).filter(Boolean));
    return ['All', ...Array.from(set)];
  }, [consolidatedList]);

  const loggedByList = useMemo(() => {
    const set = new Set(consolidatedList.map(e => e.loggedBy).filter(Boolean));
    return ['All', ...Array.from(set)];
  }, [consolidatedList]);

  // Filtered list
  const filteredList = useMemo(() => {
    return consolidatedList.filter(e => {
      // 1. Date Interval
      if (dateRange.start && e.date < dateRange.start) return false;
      if (dateRange.end && e.date > dateRange.end) return false;

      // 2. Search Note (description / category / department)
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const descMatch = e.description.toLowerCase().includes(term);
        const catMatch = e.category.toLowerCase().includes(term);
        const deptMatch = e.department.toLowerCase().includes(term);
        if (!descMatch && !catMatch && !deptMatch) return false;
      }

      // 3. Type
      if (filterType !== 'All' && e.type !== filterType) return false;

      // 4. Category
      if (filterCategory !== 'All' && e.category !== filterCategory) return false;

      // 5. Dept
      if (filterDept !== 'All' && e.department !== filterDept) return false;

      // 6. Logged By
      if (filterLoggedBy !== 'All' && e.loggedBy !== filterLoggedBy) return false;

      // 7. Amount limits
      if (minAmount && e.amount < parseFloat(minAmount)) return false;
      if (maxAmount && e.amount > parseFloat(maxAmount)) return false;

      return true;
    });
  }, [consolidatedList, dateRange, searchTerm, filterType, filterCategory, filterDept, filterLoggedBy, minAmount, maxAmount]);

  // Aggregate sums
  const totalExpenses = useMemo(() => {
    return filteredList.reduce((sum, e) => sum + e.amount, 0);
  }, [filteredList]);

  const statsByType = useMemo(() => {
    let branch = 0, mgmt = 0, logistics = 0, payroll = 0;
    filteredList.forEach(e => {
      if (e.type === 'Branch') branch += e.amount;
      else if (e.type === 'Management') mgmt += e.amount;
      else if (e.type === 'Logistics') logistics += e.amount;
      else if (e.type === 'Payroll') payroll += e.amount;
    });
    return { branch, mgmt, logistics, payroll };
  }, [filteredList]);

  // Excel export using SheetJS
  const handleExport = () => {
    if (filteredList.length === 0) {
      toast.error("No global expenses data to export.");
      return;
    }

    const exportData = filteredList.map(e => ({
      'Date': e.date,
      'Source Type': e.type.toUpperCase(),
      'Category': e.category,
      'Description/Note': e.description,
      'Branch/Department': e.department,
      'Amount (UGX)': e.amount,
      'Logged By': e.loggedBy
    }));

    exportData.push({
      'Date': 'TOTAL AGGREGATED EXPENSES',
      'Source Type': '',
      'Category': '',
      'Description/Note': '',
      'Branch/Department': '',
      'Amount (UGX)': totalExpenses,
      'Logged By': ''
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Global Consolidated Expenses");

    const formattedFrom = dateRange.start.split('-').reverse().join('-');
    const formattedTo = dateRange.end.split('-').reverse().join('-');
    XLSX.writeFile(wb, `GlobalExpenses_Consolidated_${formattedFrom}_to_${formattedTo}.xlsx`);
    toast.success("Consolidated Excel report downloaded successfully!");
  };

  return (
    <div className="space-y-6">
      {/* Aggregator Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 bg-white p-6 border border-zinc-200 rounded-[32px] shadow-sm">
        <div className="space-y-1">
          <h2 className="text-2xl font-black text-zinc-950 tracking-tight">Global Expense Ledger</h2>
          <p className="text-xs text-zinc-500 font-medium">Single source of truth of all operational outgoings from branches, fleet logistics, HR payroll, and corporate management.</p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-5 py-2.5 text-xs font-black bg-[#1A5E38] hover:bg-[#124227] text-white rounded-xl shadow-sm transition-all self-start lg:self-auto"
        >
          <Download size={14} /> Download Consolidated Report
        </button>
      </div>

      {/* Aggregate Widgets */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-zinc-950 text-white p-6 rounded-3xl shadow-md flex flex-col justify-between">
          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Aggregated Total</span>
          <span className="text-xl font-black font-mono block mt-2">UGX {totalExpenses.toLocaleString()}</span>
          <span className="text-[10px] text-zinc-400 mt-2 block">Consolidated Total</span>
        </div>
        <div className="bg-white border border-zinc-200 p-6 rounded-3xl flex flex-col justify-between">
          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 flex items-center gap-1"><Building size={12} /> Branch Costs</span>
          <span className="text-lg font-black font-mono block mt-2">UGX {statsByType.branch.toLocaleString()}</span>
          <span className="text-[10px] text-zinc-500 mt-2 block">All Branches expenses</span>
        </div>
        <div className="bg-white border border-zinc-200 p-6 rounded-3xl flex flex-col justify-between">
          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 flex items-center gap-1"><Layers size={12} /> Management HQ</span>
          <span className="text-lg font-black font-mono block mt-2">UGX {statsByType.mgmt.toLocaleString()}</span>
          <span className="text-[10px] text-zinc-500 mt-2 block">Pre-approved HQ cash costs</span>
        </div>
        <div className="bg-white border border-zinc-200 p-6 rounded-3xl flex flex-col justify-between">
          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 flex items-center gap-1"><Truck size={12} /> Fleet & Logistics</span>
          <span className="text-lg font-black font-mono block mt-2">UGX {statsByType.logistics.toLocaleString()}</span>
          <span className="text-[10px] text-zinc-500 mt-2 block">Fines, maintenance & fuel</span>
        </div>
        <div className="bg-white border border-zinc-200 p-6 rounded-3xl flex flex-col justify-between">
          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 flex items-center gap-1"><Award size={12} /> HR Payroll Payout</span>
          <span className="text-lg font-black font-mono block mt-2">UGX {statsByType.payroll.toLocaleString()}</span>
          <span className="text-[10px] text-zinc-500 mt-2 block">Paid out period salaries</span>
        </div>
      </div>

      {/* Advanced filters */}
      <div className="bg-zinc-50 border border-zinc-200 p-6 rounded-[24px] shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-200/60 pb-3">
          <h4 className="font-extrabold text-zinc-900 text-sm flex items-center gap-2">
            <Filter size={16} className="text-zinc-500" />
            Consolidated Ledger Filters
          </h4>
          <button 
            onClick={() => {
              setSearchTerm('');
              setFilterType('All');
              setFilterCategory('All');
              setFilterDept('All');
              setFilterLoggedBy('All');
              setMinAmount('');
              setMaxAmount('');
            }}
            className="text-[10px] font-bold text-zinc-400 hover:text-zinc-600 uppercase tracking-widest"
          >
            Reset Filters
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Search Note/Category</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-zinc-400" size={16} />
              <input
                type="text"
                placeholder="Search note or details..."
                className="w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-medium outline-none"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">From Date</label>
            <input
              type="date"
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">To Date</label>
            <input
              type="date"
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Source System</label>
            <select
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none font-bold text-zinc-800"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              {typesList.map(t => <option key={t} value={t}>{t === 'All' ? 'All Systems' : t}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Category</label>
            <select
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none font-bold text-zinc-800"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              {categoriesList.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Branch/Department</label>
            <select
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none font-bold text-zinc-800"
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
            >
              {departmentsList.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Logged By</label>
            <select
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none font-bold text-zinc-800"
              value={filterLoggedBy}
              onChange={(e) => setFilterLoggedBy(e.target.value)}
            >
              {loggedByList.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Min (UGX)</label>
              <input
                type="number"
                placeholder="0"
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Max (UGX)</label>
              <input
                type="number"
                placeholder="Max..."
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Grid Content */}
      <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-zinc-500 font-bold flex flex-col items-center gap-2">
            <RefreshCw className="animate-spin text-zinc-400" size={24} />
            Consolidating global company outgoings...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-150 bg-zinc-50/50">
                  <th className="px-6 py-4">Expense Date</th>
                  <th className="px-6 py-4">Origin / Type</th>
                  <th className="px-6 py-4">Branch / Dept</th>
                  <th className="px-6 py-4">Expense Category</th>
                  <th className="px-6 py-4">Description Note</th>
                  <th className="px-6 py-4 text-right">Amount (UGX)</th>
                  <th className="px-6 py-4">Logged By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredList.map((e, idx) => (
                  <tr key={`${e.type}-${e.id || idx}`} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4 font-semibold text-zinc-800 text-xs">
                      {new Date(e.date).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                        e.type === 'Branch' ? "bg-blue-50 text-blue-600 border border-blue-100" :
                        e.type === 'Management' ? "bg-purple-50 text-purple-600 border border-purple-100" :
                        e.type === 'Logistics' ? "bg-amber-50 text-amber-600 border border-amber-100" :
                        "bg-emerald-50 text-emerald-600 border border-emerald-100"
                      }`}>
                        {e.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs font-bold text-zinc-800">
                      {e.department}
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-zinc-750">
                      {e.category}
                    </td>
                    <td className="px-6 py-4 text-xs text-zinc-600 max-w-xs truncate" title={e.description}>
                      {e.description}
                    </td>
                    <td className="px-6 py-4 text-right font-black font-mono text-xs text-zinc-950">
                      UGX {e.amount.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-xs text-zinc-400">
                      {e.loggedBy}
                    </td>
                  </tr>
                ))}
                {filteredList.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-zinc-400 italic text-sm">
                      No consolidated global expenses matched current search/filter metrics.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
