import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { firestoreService } from '../../../services/firestore';
import { 
  Search, 
  Filter, 
  Download, 
  Plus, 
  Check, 
  X, 
  Edit2, 
  Eye, 
  Trash2,
  Calendar,
  AlertTriangle,
  CornerDownRight,
  RefreshCw,
  Wallet
} from 'lucide-react';
import { collection, query, where, getDocs, doc, writeBatch, addDoc, updateDoc, Timestamp, orderBy } from 'firebase/firestore';
import { db } from '../../../firebase';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

interface ManagementExpense {
  id: string;
  tenantId: string;
  date: string;
  expense_date: string;
  category: string;
  amount: number;
  amount_ugx?: number;
  status: 'draft' | 'approved' | 'rejected' | 'pending';
  created_at: string;
  logged_by: string;
  description: string;
  department: string;
  // Metadata for auto-logs
  sourceType?: 'hr' | 'procurement' | 'credit' | 'manual';
  sourceRefId?: string; // id of payroll, grn, or credit record
  invoiceId?: string;
  invoiceRef?: string;
  originalAmount?: number;
  source?: string;
  excludeFromOpexRollup?: boolean;
}

interface PettyCashEntry {
  id: string;
  tenantId: string;
  date: string;
  amount: number;
  source: string;
  reference_number: string;
  type: 'incoming' | 'outgoing';
  branch_id?: string;
  logged_by: string;
  created_at: string;
}

export const ManagementExpenseLedger: React.FC = () => {
  const { profile } = useAuth();
  const [expenses, setExpenses] = useState<ManagementExpense[]>([]);
  const [pcLedger, setPcLedger] = useState<PettyCashEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Safe date parsing helpers to prevent crashes from Firestore Timestamp / undefined / invalid values
  const safeGetDateString = (val: any): string => {
    if (!val) return '';
    if (val && typeof val.toDate === 'function') {
      try {
        return val.toDate().toISOString().split('T')[0];
      } catch (e) {
        // ignore
      }
    }
    if (typeof val === 'string') {
      return val.split('T')[0];
    }
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().split('T')[0];
    } catch (e) {
      return '';
    }
  };

  const safeFormatDate = (val: any): string => {
    if (!val) return 'N/A';
    if (val && typeof val.toDate === 'function') {
      try {
        return val.toDate().toLocaleDateString('en-GB');
      } catch (e) {
        // ignore
      }
    }
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return 'N/A';
      return d.toLocaleDateString('en-GB');
    } catch (e) {
      return 'N/A';
    }
  };

  const safeFormatTime = (val: any): string => {
    if (!val) return '';
    if (val && typeof val.toDate === 'function') {
      try {
        return val.toDate().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        // ignore
      }
    }
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [searchCategory, setSearchCategory] = useState('All');
  const [searchDepartment, setSearchDepartment] = useState('All');
  const [searchLoggedBy, setSearchLoggedBy] = useState('All');
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const end = today.toISOString().split('T')[0];
    return { start, end };
  });

  // Modal States
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [reviewingExpense, setReviewingExpense] = useState<ManagementExpense | null>(null);

  // Manual Form State
  const [manualForm, setManualForm] = useState({
    amount: '',
    category: 'HR & Remunerations',
    department: 'HQ',
    description: '',
    expense_date: new Date().toISOString().split('T')[0]
  });

  // Review Form State
  const [reviewForm, setReviewForm] = useState({
    amount: 0,
    category: '',
    department: '',
    description: ''
  });

  // Fetch data
  const fetchData = async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    try {
      // 1. Fetch Management Expenses (subscribing/getting)
      // Note: we support management_expenses collection with underscore as primary
      const expSnap = await getDocs(query(
        collection(db, 'management_expenses'),
        where('tenantId', '==', profile.tenantId)
      ));
      
      const expData = expSnap.docs.map(doc => {
        const data = doc.data() as any;
        // Unify amount vs amount_ugx field to prevent blank/zero displays on HR records
        const mappedAmount = data.amount !== undefined ? data.amount : (data.amount_ugx !== undefined ? data.amount_ugx : 0);
        return {
          ...data,
          amount: mappedAmount,
          id: doc.id
        };
      }) as ManagementExpense[];

      // Sort newest first safely
      expData.sort((a, b) => {
        const timeA = new Date(a.created_at || a.expense_date || a.date || 0).getTime();
        const timeB = new Date(b.created_at || b.expense_date || b.date || 0).getTime();
        return timeB - timeA;
      });
      
      setExpenses(expData);

      // 2. Fetch Petty Cash Balance
      const pcSnap = await getDocs(query(
        collection(db, 'petty_cash_ledger'),
        where('tenantId', '==', profile.tenantId)
      ));
      const pcData = pcSnap.docs.map(doc => ({
        ...(doc.data() as any),
        id: doc.id
      })) as PettyCashEntry[];
      setPcLedger(pcData);
    } catch (e: any) {
      console.error("Error fetching management expenses ledger:", e);
      toast.error("Failed to load management expenses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile?.tenantId]);

  // Available Petty Cash Balance calculation
  const pettyCashBalance = useMemo(() => {
    return pcLedger.reduce((acc, curr) => {
      return curr.type === 'incoming' ? acc + curr.amount : acc - curr.amount;
    }, 0);
  }, [pcLedger]);

  // Dynamic dropdown filters arrays
  const categories = useMemo(() => {
    const set = new Set(expenses.map(e => e.category).filter(Boolean));
    return ['All', ...Array.from(set)];
  }, [expenses]);

  const departments = useMemo(() => {
    const set = new Set(expenses.map(e => e.department).filter(Boolean));
    return ['All', ...Array.from(set)];
  }, [expenses]);

  const loggedByUsers = useMemo(() => {
    const set = new Set(expenses.map(e => e.logged_by).filter(Boolean));
    return ['All', ...Array.from(set)];
  }, [expenses]);

  // Client Side Filtered Expenses
  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
      // 1. Date Filter
      const d = safeGetDateString(e.expense_date || e.date);
      if (dateRange.start && d < dateRange.start) return false;
      if (dateRange.end && d > dateRange.end) return false;

      // 2. Search Text (description / notes)
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const descMatch = (e.description || '').toLowerCase().includes(term);
        const refMatch = (e.invoiceRef || '').toLowerCase().includes(term);
        if (!descMatch && !refMatch) return false;
      }

      // 3. Category Filter
      if (searchCategory !== 'All' && e.category !== searchCategory) return false;

      // 4. Department Filter
      if (searchDepartment !== 'All' && e.department !== searchDepartment) return false;

      // 5. Logged By Filter
      if (searchLoggedBy !== 'All' && e.logged_by !== searchLoggedBy) return false;

      // 6. Amount Filters
      const amt = e.amount || 0;
      if (minAmount && amt < parseFloat(minAmount)) return false;
      if (maxAmount && amt > parseFloat(maxAmount)) return false;

      return true;
    });
  }, [expenses, dateRange, searchTerm, searchCategory, searchDepartment, searchLoggedBy, minAmount, maxAmount]);

  // Log manual expense
  const handleLogManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId) return;

    const amt = parseFloat(manualForm.amount);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (amt > pettyCashBalance) {
      toast.error(`Insufficient petty cash balance! Current available is UGX ${pettyCashBalance.toLocaleString()}`);
      return;
    }

    try {
      // Create manual approved expense and deduct petty cash
      const batch = writeBatch(db);

      // 1. Add to management_expenses
      const expRef = doc(collection(db, 'management_expenses'));
      const expPayload = {
        tenantId: profile.tenantId,
        date: new Date().toISOString(),
        expense_date: manualForm.expense_date,
        category: manualForm.category,
        amount: amt,
        amount_ugx: amt,
        status: 'approved',
        created_at: new Date().toISOString(),
        logged_by: profile.fullName || profile.email || 'Corporate User',
        description: manualForm.description,
        department: manualForm.department,
        sourceType: 'manual',
        excludeFromOpexRollup: false
      };
      batch.set(expRef, expPayload);

      // 2. Add outgoing to petty_cash_ledger
      const pcRef = doc(collection(db, 'petty_cash_ledger'));
      const pcPayload = {
        tenantId: profile.tenantId,
        date: manualForm.expense_date,
        amount: amt,
        source: `Management Expense: ${manualForm.category}`,
        reference_number: `EXP-${expRef.id.slice(-6).toUpperCase()}`,
        type: 'outgoing',
        logged_by: profile.fullName || profile.email || 'SYSTEM',
        created_at: new Date().toISOString()
      };
      batch.set(pcRef, pcPayload);

      await batch.commit();

      toast.success("Expense logged & disbursed from petty cash successfully.");
      setIsManualModalOpen(false);
      setManualForm({
        amount: '',
        category: 'HR & Remunerations',
        department: 'HQ',
        description: '',
        expense_date: new Date().toISOString().split('T')[0]
      });
      fetchData(); // refresh
    } catch (err) {
      console.error(err);
      toast.error("Failed to log manual expense");
    }
  };

  // Open review modal for draft
  const handleOpenReview = (exp: ManagementExpense) => {
    setReviewingExpense(exp);
    setReviewForm({
      amount: exp.amount,
      category: exp.category || 'Procurement & Inventory',
      department: exp.department || 'HQ',
      description: exp.description || ''
    });
    setIsReviewModalOpen(true);
  };

  // Confirm and Issue draft
  const handleConfirmAndIssue = async () => {
    if (!profile?.tenantId || !reviewingExpense) return;

    const amt = reviewForm.amount;
    const origAmt = reviewingExpense.originalAmount || reviewingExpense.amount;

    if (amt <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }

    // Block issuing more than what the invoice/credit shows (approved ceiling)
    if (amt > origAmt) {
      toast.error(`Block: You cannot issue more than the original approved invoice/credit balance of UGX ${origAmt.toLocaleString()}!`);
      return;
    }

    // Verify petty cash
    if (amt > pettyCashBalance) {
      toast.error(`Insufficient petty cash! Available: UGX ${pettyCashBalance.toLocaleString()}`);
      return;
    }

    try {
      const batch = writeBatch(db);

      // 1. Update the management_expenses record status to approved (Issued) and details
      const expRef = doc(db, 'management_expenses', reviewingExpense.id);
      batch.update(expRef, {
        amount: amt,
        amount_ugx: amt,
        category: reviewForm.category,
        department: reviewForm.department,
        description: reviewForm.description,
        status: 'approved',
        updatedAt: new Date().toISOString(),
        issuedAt: new Date().toISOString(),
        issuedBy: profile.fullName || profile.email || 'Authorized Finance',
        excludeFromOpexRollup: reviewingExpense.excludeFromOpexRollup === true ||
          reviewingExpense.source === 'cash_grn' || reviewingExpense.source === 'credit_payment' ||
          reviewingExpense.sourceType === 'procurement' || reviewingExpense.sourceType === 'credit'
      });

      // 2. Add outgoing to petty_cash_ledger
      const pcRef = doc(collection(db, 'petty_cash_ledger'));
      batch.set(pcRef, {
        tenantId: profile.tenantId,
        date: new Date().toISOString().split('T')[0],
        amount: amt,
        source: `Issued Auto-Log: ${reviewForm.category}`,
        reference_number: `PC-${reviewingExpense.id.slice(-6).toUpperCase()}`,
        type: 'outgoing',
        logged_by: profile.fullName || profile.email || 'SYSTEM',
        created_at: new Date().toISOString()
      });

      // 3. Handle specific sourceType logic (Procurement & Credits partial payments)
      if (reviewingExpense.sourceType === 'procurement' && reviewingExpense.invoiceId) {
        const invRef = doc(db, 'invoices', reviewingExpense.invoiceId);
        
        if (amt < origAmt) {
          // It's a partial payment! Label invoice as 'partial' and note remaining in creditLedger
          const remainingCredit = origAmt - amt;
          batch.update(invRef, {
            paymentStatus: 'partial',
            creditBalance: remainingCredit,
            updatedAt: new Date().toISOString()
          });

          // Create a creditLog / creditLedger document for the balance
          const credRef = doc(collection(db, 'creditLedger'));
          batch.set(credRef, {
            tenantId: profile.tenantId,
            invoiceId: reviewingExpense.invoiceId,
            invoiceRef: reviewingExpense.invoiceRef || 'Manual-GRN',
            originalCreditAmount: origAmt,
            remainingCreditBalance: remainingCredit,
            status: 'outstanding',
            creditAccruedAt: new Date().toISOString(),
            branchId: reviewingExpense.department || 'HQ',
            branchName: reviewingExpense.department || 'HQ Branch',
            supplierName: reviewingExpense.description ? reviewingExpense.description.split(' - ')[0] : 'Supplier',
            createdAt: new Date().toISOString()
          });
          toast.info(`Invoice updated to partial payment. Credit of UGX ${remainingCredit.toLocaleString()} Accrued.`);
        } else {
          // Fully paid cash GRN
          batch.update(invRef, {
            paymentStatus: 'cash',
            creditBalance: 0,
            updatedAt: new Date().toISOString()
          });
        }
      } else if (reviewingExpense.sourceType === 'credit' && reviewingExpense.invoiceId && reviewingExpense.sourceRefId) {
        // SourceType is credit. Update the credit record in creditLedger
        const credRef = doc(db, 'creditLedger', reviewingExpense.sourceRefId);
        
        const remainingCredit = origAmt - amt;
        if (remainingCredit > 0) {
          // Partially paid credit! Update creditLedger remaining balance
          batch.update(credRef, {
            remainingCreditBalance: remainingCredit,
            status: 'outstanding',
            lastProcessedAt: new Date().toISOString()
          });

          // Update invoices ledger to partial
          const invRef = doc(db, 'invoices', reviewingExpense.invoiceId);
          batch.update(invRef, {
            paymentStatus: 'partial',
            creditBalance: remainingCredit,
            updatedAt: new Date().toISOString()
          });
        } else {
          // Fully paid credit!
          batch.update(credRef, {
            remainingCreditBalance: 0,
            status: 'paid',
            lastProcessedAt: new Date().toISOString()
          });

          const invRef = doc(db, 'invoices', reviewingExpense.invoiceId);
          batch.update(invRef, {
            paymentStatus: 'cash',
            creditBalance: 0,
            updatedAt: new Date().toISOString()
          });
        }
      }

      await batch.commit();
      toast.success("Draft reviewed, confirmed, and issued successfully!");
      setIsReviewModalOpen(false);
      setReviewingExpense(null);
      fetchData(); // refresh
    } catch (err) {
      console.error(err);
      toast.error("Failed to issue expense draft");
    }
  };

  // Reject draft
  const handleRejectDraft = async () => {
    if (!profile?.tenantId || !reviewingExpense) return;

    try {
      // Set status to rejected
      await updateDoc(doc(db, 'management_expenses', reviewingExpense.id), {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
        rejectedBy: profile.fullName || profile.email || 'Authorized Finance'
      });

      // Note: If HR source, HRAdmin payroll status can be updated to 'review_needed'
      if (reviewingExpense.sourceType === 'hr' && reviewingExpense.sourceRefId) {
        await updateDoc(doc(db, 'payroll', reviewingExpense.sourceRefId), {
          status: 'rejected_by_finance',
          updatedAt: new Date().toISOString()
        });
        toast.info("Payroll draft sent back to HR module for review.");
      }

      toast.warning("Expense draft rejected successfully.");
      setIsReviewModalOpen(false);
      setReviewingExpense(null);
      fetchData(); // refresh
    } catch (err) {
      console.error(err);
      toast.error("Failed to reject draft");
    }
  };

  // Export Excel using SheetJS
  const handleExportExcel = () => {
    if (filteredExpenses.length === 0) {
      toast.error("No data available to export");
      return;
    }

    const exportData = filteredExpenses.map(e => ({
      'Date': safeGetDateString(e.expense_date || e.date),
      'Category/Type': e.category,
      'Department/Branch': e.department,
      'Description': e.description,
      'Source': e.sourceType?.toUpperCase() || 'MANUAL',
      'Ref Number/Invoice': e.invoiceRef || 'N/A',
      'Original Draft Ceiling': e.originalAmount || e.amount,
      'Issued Amount (UGX)': e.amount,
      'Status': e.status.toUpperCase(),
      'Logged By': e.logged_by
    }));

    // Insert Total row
    const totalIssued = filteredExpenses.filter(e => e.status === 'approved').reduce((sum, e) => sum + e.amount, 0);
    exportData.push({
      'Date': 'TOTAL ISSUED EXPENSES',
      'Category/Type': '',
      'Department/Branch': '',
      'Description': '',
      'Source': '',
      'Ref Number/Invoice': '',
      'Original Draft Ceiling': 0,
      'Issued Amount (UGX)': totalIssued,
      'Status': '',
      'Logged By': ''
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Management Expenses");

    const formattedFrom = dateRange.start.split('-').reverse().join('-');
    const formattedTo = dateRange.end.split('-').reverse().join('-');
    XLSX.writeFile(wb, `ManagementExpenses_Report_${formattedFrom}_to_${formattedTo}.xlsx`);
    toast.success("Excel report exported successfully!");
  };

  return (
    <div className="space-y-6">
      {/* Treasury Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 bg-white p-6 border border-zinc-200 rounded-[32px] shadow-sm">
        <div className="space-y-1">
          <h2 className="text-2xl font-black text-zinc-950 tracking-tight">Management Expense Ledger</h2>
          <p className="text-xs text-zinc-500 font-medium">Log, audit, review, and confirm company HQ, HR, procurement, and administrative payments.</p>
        </div>
        <div className="flex items-center gap-6 self-stretch lg:self-auto justify-between lg:justify-end border-t lg:border-t-0 pt-4 lg:pt-0">
          {/* Petty Cash Wallet summary */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-100">
              <Wallet size={20} />
            </div>
            <div>
              <p className="text-[10px] text-zinc-400 font-black uppercase tracking-wider">Petty Cash Balance</p>
              <p className="text-base font-black font-mono text-zinc-950">UGX {pettyCashBalance.toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsManualModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-zinc-950 hover:bg-zinc-800 text-white rounded-xl shadow-sm transition-all"
            >
              <Plus size={14} /> Log Expense
            </button>
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#1A5E38] hover:bg-[#124227] text-white rounded-xl shadow-sm transition-all"
            >
              <Download size={14} /> Download Report
            </button>
          </div>
        </div>
      </div>

      {/* Advanced Filter Box */}
      <div className="bg-zinc-50 border border-zinc-200 p-6 rounded-[24px] shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-200/60 pb-3">
          <h4 className="font-extrabold text-zinc-900 text-sm flex items-center gap-2">
            <Filter size={16} className="text-zinc-500" />
            Filter and Search Ledger
          </h4>
          <button 
            onClick={() => {
              setSearchTerm('');
              setSearchCategory('All');
              setSearchDepartment('All');
              setSearchLoggedBy('All');
              setMinAmount('');
              setMaxAmount('');
            }}
            className="text-[10px] font-bold text-zinc-400 hover:text-zinc-600 uppercase tracking-widest"
          >
            Clear Filters
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Search bar */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Search Note/Ref</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-zinc-400" size={16} />
              <input
                type="text"
                placeholder="Search..."
                className="w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-zinc-950/5"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Date range start */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">From Date</label>
            <input
              type="date"
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            />
          </div>

          {/* Date range end */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">To Date</label>
            <input
              type="date"
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            />
          </div>

          {/* Category selection */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Expense Category</label>
            <select
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={searchCategory}
              onChange={(e) => setSearchCategory(e.target.value)}
            >
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Department selection */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Department/Branch</label>
            <select
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={searchDepartment}
              onChange={(e) => setSearchDepartment(e.target.value)}
            >
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {/* Logged by selection */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Logged By</label>
            <select
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={searchLoggedBy}
              onChange={(e) => setSearchLoggedBy(e.target.value)}
            >
              {loggedByUsers.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          {/* Min Amount */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Min Amount (UGX)</label>
            <input
              type="number"
              placeholder="Min..."
              className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
            />
          </div>

          {/* Max Amount */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Max Amount (UGX)</label>
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

      {/* Main Table / Logs Section */}
      <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-zinc-500 font-bold flex flex-col items-center gap-2">
            <RefreshCw className="animate-spin text-zinc-400" size={24} />
            Loading management expenses ledger...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-150 bg-zinc-50/50">
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Category / Dept</th>
                  <th className="px-6 py-4">Description</th>
                  <th className="px-6 py-4">Source & Ref</th>
                  <th className="px-6 py-4 text-right">Draft Ceiling</th>
                  <th className="px-6 py-4 text-right">Issued Amount</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredExpenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-zinc-900 text-sm">
                        {safeFormatDate(exp.expense_date || exp.date)}
                      </div>
                      <div className="text-[10px] text-zinc-400">Created: {safeFormatTime(exp.created_at || exp.date)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-bold text-zinc-800 text-xs">{exp.category}</div>
                      <div className="text-[10px] text-zinc-400 uppercase tracking-widest font-black mt-0.5">{exp.department}</div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs text-zinc-600 font-medium max-w-xs truncate" title={exp.description}>
                        {exp.description}
                      </p>
                      <span className="text-[9px] text-zinc-400">By: {exp.logged_by || 'Corporate User'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-600">
                        {exp.sourceType || 'manual'}
                      </span>
                      {exp.invoiceRef && (
                        <div className="text-[10px] font-mono text-zinc-500 font-bold mt-1">
                          Ref: {exp.invoiceRef}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right text-xs font-mono font-bold text-zinc-500">
                      UGX {(exp.originalAmount || exp.amount || 0).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-mono font-black text-zinc-950">
                      UGX {exp.amount.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                        exp.status?.toLowerCase() === 'approved' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                        (exp.status?.toLowerCase() === 'draft' || exp.status?.toLowerCase() === 'pending') ? "bg-amber-50 text-amber-600 border border-amber-100" :
                        exp.status?.toLowerCase() === 'rejected' ? "bg-red-50 text-red-600 border border-red-100" :
                        "bg-zinc-100 text-zinc-500"
                      }`}>
                        {exp.status?.toLowerCase() === 'approved' ? 'issued' : exp.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {(exp.status?.toLowerCase() === 'draft' || exp.status?.toLowerCase() === 'pending') ? (
                        <button
                          onClick={() => handleOpenReview(exp)}
                          className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-wider rounded-lg border border-amber-200 transition-all flex items-center gap-1 mx-auto"
                        >
                          <Eye size={12} />
                          Review Draft
                        </button>
                      ) : (
                        <span className="text-[10px] text-zinc-400 italic">No actions</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredExpenses.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-zinc-400 italic text-sm">
                      No management expenses logs found matching current search filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual Expense Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl border border-zinc-100 animate-in zoom-in-95 duration-150">
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black text-zinc-950">Log Management Expense</h3>
                <button onClick={() => setIsManualModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleLogManual} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Expense Date</label>
                  <input
                    type="date"
                    required
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                    value={manualForm.expense_date}
                    onChange={(e) => setManualForm({ ...manualForm, expense_date: e.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Amount (UGX)</label>
                  <input
                    type="number"
                    required
                    placeholder="Enter amount..."
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-bold text-zinc-950"
                    value={manualForm.amount}
                    onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</label>
                  <select
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-semibold text-zinc-800"
                    value={manualForm.category}
                    onChange={(e) => setManualForm({ ...manualForm, category: e.target.value })}
                  >
                    <option value="HR & Remunerations">HR & Remunerations</option>
                    <option value="Procurement & Inventory">Procurement & Inventory</option>
                    <option value="HQ Operational Cost">HQ Operational Cost</option>
                    <option value="Rent & Utilities">Rent & Utilities</option>
                    <option value="Tax Compliance">Tax Compliance</option>
                    <option value="Legal & Audit">Legal & Audit</option>
                    <option value="Marketing Expense">Marketing Expense</option>
                    <option value="Logistics & Fleet">Logistics & Fleet</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Department/Branch</label>
                  <select
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-semibold text-zinc-800"
                    value={manualForm.department}
                    onChange={(e) => setManualForm({ ...manualForm, department: e.target.value })}
                  >
                    <option value="HQ">HQ Administration</option>
                    <option value="Logistics">Logistics Fleet</option>
                    <option value="Marketing">Marketing Agency</option>
                    <option value="HR">Human Resource Office</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Description</label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Describe the nature of this expense..."
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none text-xs"
                    value={manualForm.description}
                    onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsManualModalOpen(false)}
                    className="flex-1 py-3 bg-zinc-100 hover:bg-zinc-250 text-zinc-600 rounded-xl text-xs font-bold uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 bg-zinc-950 hover:bg-zinc-850 text-white rounded-xl text-xs font-bold uppercase tracking-widest"
                  >
                    Confirm & Disburse
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Review Draft Modal */}
      {isReviewModalOpen && reviewingExpense && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[32px] w-full max-w-lg overflow-hidden shadow-2xl border border-zinc-100 animate-in zoom-in-95 duration-150">
            <div className="p-8 space-y-6">
              <div className="flex justify-between items-center border-b border-zinc-100 pb-4">
                <div>
                  <h3 className="text-xl font-black text-zinc-950">Review Auto-Logged Draft</h3>
                  <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wider mt-1">Source: {reviewingExpense.sourceType?.toUpperCase()} Draft</p>
                </div>
                <button onClick={() => setIsReviewModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                  <X size={24} />
                </button>
              </div>

              {/* Warning ceiling banner */}
              <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 flex items-start gap-3">
                <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={18} />
                <div className="space-y-1 text-xs text-zinc-600">
                  <span className="font-bold text-zinc-800 block">Original Document Ceilings Applied</span>
                  <span>This auto draft represents pre-approved capital. You can edit this expense down (creating a partial payment / remaining credit log) but you are **blocked** from issuing more than the ceiling.</span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 bg-zinc-50 p-4 rounded-2xl border border-zinc-200">
                  <div>
                    <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest block">Approved Ceiling</span>
                    <span className="text-sm font-black text-zinc-800 font-mono">UGX {(reviewingExpense.originalAmount || reviewingExpense.amount || 0).toLocaleString()}</span>
                  </div>
                  {reviewingExpense.invoiceRef && (
                    <div>
                      <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest block">Reference</span>
                      <span className="text-sm font-black text-zinc-800 font-mono">{reviewingExpense.invoiceRef}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Editable Amount to Pay (UGX)</label>
                  <input
                    type="number"
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-bold text-zinc-950 text-base"
                    value={reviewForm.amount}
                    onChange={(e) => setReviewForm({ ...reviewForm, amount: parseFloat(e.target.value) || 0 })}
                  />
                  <p className="text-[10px] text-zinc-400">If edited for a lower value, the balance is logged as credit receivable/payable status and invoices are labeled as "partial payments".</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</label>
                    <select
                      className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none font-semibold text-zinc-800"
                      value={reviewForm.category}
                      onChange={(e) => setReviewForm({ ...reviewForm, category: e.target.value })}
                    >
                      <option value="HR & Remunerations">HR & Remunerations</option>
                      <option value="Procurement & Inventory">Procurement & Inventory</option>
                      <option value="HQ Operational Cost">HQ Operational Cost</option>
                      <option value="Rent & Utilities">Rent & Utilities</option>
                      <option value="Tax Compliance">Tax Compliance</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Branch/Department</label>
                    <select
                      className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none font-semibold text-zinc-800"
                      value={reviewForm.department}
                      onChange={(e) => setReviewForm({ ...reviewForm, department: e.target.value })}
                    >
                      <option value="HQ">HQ Administration</option>
                      <option value="Logistics">Logistics Fleet</option>
                      <option value="Marketing">Marketing Agency</option>
                      <option value="HR">Human Resource Office</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Description</label>
                  <textarea
                    rows={3}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none text-xs"
                    value={reviewForm.description}
                    onChange={(e) => setReviewForm({ ...reviewForm, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={handleRejectDraft}
                  className="px-4 py-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-1"
                >
                  <X size={14} /> Reject Draft
                </button>
                <div className="flex-1 flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setIsReviewModalOpen(false)}
                    className="px-4 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-xl text-xs font-bold uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmAndIssue}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-1"
                  >
                    <Check size={14} /> Confirm & Issue
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
