import { rejectSupplierCreditDraft } from '../../../services/creditGrnSettlementService';
import { CashOutflowReport } from '../../../components/finance/CashOutflowReport';
import { kampalaBusinessDate } from '../../../utils/eodBusinessDate';
import { ManagementPaymentAccounts, useManagementPaymentAccounts } from '../../../components/finance/ManagementPaymentAccounts';
import { SupplierInvoicePaymentPanel } from '../../../components/finance/SupplierInvoicePaymentPanel';
import { MANAGEMENT_CASH_ACCOUNT, managementAccountDocumentId, stageManagementCashEntry } from '../../../services/managementCashPosting';
import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import { collection, query, where, getDocs, doc, updateDoc, Timestamp, runTransaction } from 'firebase/firestore';
import { db } from '../../../firebase';
import { toast } from 'sonner';
import { exportRecordsToExcel } from '../../../utils/excelExport';

function isSupplierDraft(expense: { source?: string; sourceType?: string }) {
  return expense.source === 'procurement_cash_grn' || expense.source === 'credit_payment';
}

interface ManagementExpense {
  id: string;
  tenantId: string;
  date: string;
  expense_date: string;
  category: string;
  amount: number;
  amount_ugx?: number;
  status: 'draft' | 'approved' | 'rejected' | 'pending' | 'partial';
  paidAmountUGX?: number;
  balanceUGX?: number;
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

export const ManagementExpenseLedger: React.FC = () => {
  const { profile } = useAuth();
  const [expenses, setExpenses] = useState<ManagementExpense[]>([]);
  const { accounts } = useManagementPaymentAccounts();
  const cashAccount = accounts.find(account => account.accountId === MANAGEMENT_CASH_ACCOUNT && account.initialized);
  const pettyCashBalance = cashAccount?.balanceUGX ?? null;
  const [paymentRefresh, setPaymentRefresh] = useState(0);
  const [posting, setPosting] = useState(false);
  const postingLock = useRef(false);
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
    const today = kampalaBusinessDate();
    return { start: today.slice(0, 8) + '01', end: today };
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
    voucher: '',
    expense_date: kampalaBusinessDate()
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

    } catch (e: any) {
      console.error("Error fetching management expenses ledger:", e);
      toast.error("Failed to load management cash outflows.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile?.tenantId]);

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
    if (!profile?.tenantId || postingLock.current) return;

    const amt = Number(manualForm.amount);
    if (!Number.isSafeInteger(amt) || amt <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    const voucher = manualForm.voucher.trim().toUpperCase();
    if (voucher.length < 3 || voucher.length > 100) {
      toast.error('Enter the cash voucher or receipt reference.');
      return;
    }

    postingLock.current = true;
    setPosting(true);
    try {
      const identity = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([profile.tenantId, voucher])));
      const expenseId = 'mcpay_' + Array.from(new Uint8Array(identity), byte => byte.toString(16).padStart(2, '0')).join('');
      const expRef = doc(db, 'management_expenses', expenseId);
      const postingId = 'expense_payment_' + expRef.id;
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
        excludeFromOpexRollup: false,
        cashOutflowPostingId: postingId,
        paymentReference: voucher,
      };

      await runTransaction(db, async tx => {
        const existing = (await tx.get(expRef)).data();
        if (existing) {
          if (existing.tenantId !== profile.tenantId || existing.cashOutflowPostingId !== postingId ||
              existing.paymentReference !== voucher || existing.amount !== amt || existing.category !== expPayload.category || existing.description !== expPayload.description ||
              existing.expense_date !== expPayload.expense_date || existing.department !== expPayload.department)
            throw new Error('This payment reference is already in use.');
          return;
        }
        const accountRef = doc(db, 'finance_payment_accounts', managementAccountDocumentId(profile.tenantId));
        const funding = (await tx.get(accountRef)).data();
        if (!funding?.initialized || !Number.isSafeInteger(funding.balanceUGX) || funding.balanceUGX < amt)
          throw new Error('Reconcile and fund Management Petty Cash before recording the payment.');
        tx.set(expRef, expPayload);
        stageManagementCashEntry(tx, postingId, {
          tenantId: profile.tenantId, date: kampalaBusinessDate(), amount: amt, type: 'outgoing',
          source: manualForm.description || 'Management expense payment', expenseCategory: manualForm.category,
          reference_number: voucher, externalExpenseCollection: 'management_expenses', externalExpenseId: expRef.id,
        }, db, MANAGEMENT_CASH_ACCOUNT, profile.uid);
      });
      setPaymentRefresh(value => value + 1);
      toast.success("Expense logged & disbursed from petty cash successfully.");
      setIsManualModalOpen(false);
      setManualForm({
        amount: '',
        category: 'HR & Remunerations',
        department: 'HQ',
        description: '',
        voucher: '',
        expense_date: kampalaBusinessDate()
      });
      fetchData(); // refresh
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to record the payment.');
    } finally {
      postingLock.current = false;
      setPosting(false);
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
    if (!profile?.tenantId || !reviewingExpense || postingLock.current) return;
    if (isSupplierDraft(reviewingExpense) || reviewingExpense.sourceType === 'procurement' ||
        reviewingExpense.sourceType === 'credit' || reviewingExpense.source === 'cash_grn') {
      toast.error('Use the linked supplier invoice to record this payment.');
      return;
    }

    const amt = reviewForm.amount;
    const origAmt = reviewingExpense.originalAmount || reviewingExpense.amount;

    if (!Number.isSafeInteger(amt) || amt <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }

    // Block issuing more than what the invoice/credit shows (approved ceiling)
    if (amt > origAmt) {
      toast.error(`Block: You cannot issue more than the original approved invoice/credit balance of UGX ${origAmt.toLocaleString()}!`);
      return;
    }

    // Verify petty cash
    if (pettyCashBalance === null || amt > pettyCashBalance) {
      toast.error("Reconcile and fund Management Petty Cash before recording the payment.");
      return;
    }

    postingLock.current = true;
    setPosting(true);
    try {
      const expRef = doc(db, 'management_expenses', reviewingExpense.id);
      const postingId = 'expense_payment_' + expRef.id;
      await runTransaction(db, async tx => {
        const current = (await tx.get(expRef)).data();
        if (!current || current.tenantId !== profile.tenantId) throw new Error('The payment draft is unavailable.');
        if (current.cashOutflowPostingId === postingId) {
          if (current.amount !== amt) throw new Error('The draft already has a different posted amount.');
          return;
        }
        if (!['draft', 'pending', 'partial'].includes(String(current.status).toLowerCase()) ||
            current.source === 'procurement_cash_grn' || current.invoiceId !== reviewingExpense.invoiceId ||
            current.sourceType !== reviewingExpense.sourceType ||
            Number(current.originalAmount || current.amount || current.amount_ugx) !== origAmt)
          throw new Error('The draft changed. Review the current draft before paying.');

        tx.update(expRef, {
          amount: amt,
          amount_ugx: amt,
          category: reviewForm.category,
          department: reviewForm.department,
          description: reviewForm.description,
          status: 'approved', cashOutflowPostingId: postingId,
          updatedAt: new Date().toISOString(),
          issuedAt: new Date().toISOString(),
          issuedBy: profile.fullName || profile.email || 'Authorized Finance',
          excludeFromOpexRollup: reviewingExpense.excludeFromOpexRollup === true ||
            reviewingExpense.source === 'cash_grn' || reviewingExpense.source === 'credit_payment' ||
            reviewingExpense.sourceType === 'procurement' || reviewingExpense.sourceType === 'credit'
        });

        stageManagementCashEntry(tx, postingId, {
          tenantId: profile.tenantId, date: kampalaBusinessDate(), amount: amt, type: 'outgoing',
          source: reviewForm.description || 'Management expense payment', expenseCategory: reviewForm.category,
          reference_number: postingId, externalExpenseCollection: 'management_expenses', externalExpenseId: expRef.id,
        }, db, MANAGEMENT_CASH_ACCOUNT, profile.uid);

      });
      setPaymentRefresh(value => value + 1);
      toast.success("Draft reviewed, confirmed, and issued successfully!");
      setIsReviewModalOpen(false);
      setReviewingExpense(null);
      fetchData(); // refresh
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to issue expense draft");
    } finally {
      postingLock.current = false;
      setPosting(false);
    }
  };

  // Reject draft
  const handleRejectDraft = async () => {
    if (!profile?.tenantId || !reviewingExpense) return;
    if (reviewingExpense.source === 'procurement_cash_grn') {
      toast.error('Supplier invoice payment drafts must be reconciled through the dedicated procurement workflow.');
      return;
    }

    try {
      if (reviewingExpense.source === 'credit_payment') {
        await rejectSupplierCreditDraft({
          tenantId: profile.tenantId, draftId: reviewingExpense.id,
          actor: { uid: profile.uid, name: profile.fullName || profile.full_name || profile.uid },
        });
      } else {
        await updateDoc(doc(db, 'management_expenses', reviewingExpense.id), {
          status: 'rejected',
          rejectedAt: new Date().toISOString(),
          rejectedBy: profile.fullName || profile.email || 'Authorized Finance'
        });
      }

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

  // Export Excel through the shared hardened exporter
  const handleExportExcel = async () => {
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
      'Issued Amount (UGX)': e.source==='procurement_cash_grn'?Number(e.paidAmountUGX||0):e.status==='approved'?e.amount:0,
      'Status': e.status.toUpperCase(),
      'Logged By': e.logged_by
    }));

    // Insert Total row
    const totalIssued = filteredExpenses.reduce((sum,e)=>sum+(e.source==='procurement_cash_grn'?Number(e.paidAmountUGX||0):e.status==='approved'?e.amount:0),0);
    exportData.push({
      'Date': 'TOTAL RECORDED AS ISSUED',
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

    const formattedFrom = dateRange.start.split('-').reverse().join('-');
    const formattedTo = dateRange.end.split('-').reverse().join('-');
    await exportRecordsToExcel(
      exportData,
      'Management Expense Register',
      `ManagementExpenseRegister_${formattedFrom}_to_${formattedTo}.xlsx`
    );
    toast.success("Excel report exported successfully!");
  };

  return (
    <div className="min-w-0 space-y-6 text-zinc-900">
      <ManagementPaymentAccounts showReconciliationReference={false} />
      {/* Treasury Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 bg-white p-6 border border-zinc-200 rounded-[32px] shadow-sm">
        <div className="space-y-1">
          <h2 className="text-2xl font-black text-zinc-950 tracking-tight">Management Cash Outflows</h2>
          <p className="text-xs text-zinc-500 font-medium">Log, audit, review, and confirm company HQ, HR, procurement, and administrative payments.</p>
        </div>
        <div className="flex min-w-0 flex-col items-stretch gap-4 sm:flex-row sm:items-center self-stretch lg:self-auto justify-between lg:justify-end border-t lg:border-t-0 pt-4 lg:pt-0">
          {/* Petty Cash Wallet summary */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-100">
              <Wallet size={20} />
            </div>
            <div>
              <p className="text-[10px] text-zinc-400 font-black uppercase tracking-wider">Petty Cash Balance</p>
              <p className="text-base font-black font-mono text-zinc-950">{pettyCashBalance === null ? 'Unreconciled' : 'UGX ' + pettyCashBalance.toLocaleString()}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsManualModalOpen(true)}
              className="flex min-h-11 items-center gap-1.5 px-4 py-2 text-xs font-bold bg-zinc-950 hover:bg-zinc-800 text-white rounded-xl shadow-sm transition-all"
            >
              <Plus size={14} /> Log Expense
            </button>
            <button
              onClick={handleExportExcel}
              className="flex min-h-11 items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#1A5E38] hover:bg-[#124227] text-white rounded-xl shadow-sm transition-all"
            >
              <Download size={14} /> Download expense register
            </button>
          </div>
        </div>
      </div>

      <CashOutflowReport management refresh={paymentRefresh} />
      <h3 className="text-lg font-bold">Expense and approval register</h3>
      {/* Advanced Filter Box */}
      <div className="bg-zinc-50 border border-zinc-200 p-6 rounded-[24px] shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/60 pb-3">
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
            className="min-h-11 text-xs font-bold text-zinc-700 hover:text-zinc-950 uppercase tracking-wide"
          >
            Clear Filters
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Search bar */}
          <div className="min-w-0 space-y-1">
            <label className="text-[10px] font-black text-zinc-700 uppercase tracking-widest block">Search Note/Ref</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-zinc-400" size={16} />
              <input
                type="text"
                placeholder="Search..."
                className="min-h-11 min-w-0 w-full text-zinc-900 pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-zinc-950/5"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Date range start */}
          <div className="min-w-0 space-y-1">
            <label className="text-[10px] font-black text-zinc-700 uppercase tracking-widest block">From Date</label>
            <input
              type="date"
              className="min-h-11 min-w-0 w-full text-zinc-900 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            />
          </div>

          {/* Date range end */}
          <div className="min-w-0 space-y-1">
            <label className="text-[10px] font-black text-zinc-700 uppercase tracking-widest block">To Date</label>
            <input
              type="date"
              className="min-h-11 min-w-0 w-full text-zinc-900 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            />
          </div>

          {/* Category selection */}
          <div className="min-w-0 space-y-1">
            <label className="text-[10px] font-black text-zinc-700 uppercase tracking-widest block">Expense Category</label>
            <select
              className="min-h-11 min-w-0 w-full text-zinc-900 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={searchCategory}
              onChange={(e) => setSearchCategory(e.target.value)}
            >
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Department selection */}
          <div className="min-w-0 space-y-1">
            <label className="text-[10px] font-black text-zinc-700 uppercase tracking-widest block">Department/Branch</label>
            <select
              className="min-h-11 min-w-0 w-full text-zinc-900 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={searchDepartment}
              onChange={(e) => setSearchDepartment(e.target.value)}
            >
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {/* Logged by selection */}
          <div className="min-w-0 space-y-1">
            <label className="text-[10px] font-black text-zinc-700 uppercase tracking-widest block">Logged By</label>
            <select
              className="min-h-11 min-w-0 w-full text-zinc-900 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={searchLoggedBy}
              onChange={(e) => setSearchLoggedBy(e.target.value)}
            >
              {loggedByUsers.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          {/* Min Amount */}
          <div className="min-w-0 space-y-1">
            <label className="text-[10px] font-black text-zinc-700 uppercase tracking-widest block">Min Amount (UGX)</label>
            <input
              type="number"
              placeholder="Min..."
              className="min-h-11 min-w-0 w-full text-zinc-900 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
            />
          </div>

          {/* Max Amount */}
          <div className="min-w-0 space-y-1">
            <label className="text-[10px] font-black text-zinc-700 uppercase tracking-widest block">Max Amount (UGX)</label>
            <input
              type="number"
              placeholder="Max..."
              className="min-h-11 min-w-0 w-full text-zinc-900 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-semibold outline-none"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3 md:hidden">{loading?<p className="text-sm text-zinc-700">Loading expenses…</p>:filteredExpenses.map(exp=><article key={exp.id} className="min-w-0 space-y-3 rounded-2xl border border-zinc-300 bg-white p-4 text-zinc-900"><div className="min-w-0"><p className="break-words font-bold text-zinc-950">{exp.invoiceRef || exp.category}</p><p className="break-words text-sm text-zinc-700">{exp.department} · {exp.status}</p><p className="mt-1 break-words text-sm text-zinc-700">{exp.description}</p></div><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-zinc-700">Invoice / expense</p><p className="font-bold text-zinc-950">UGX {Number(exp.originalAmount||exp.amount||0).toLocaleString()}</p></div><div><p className="text-zinc-700">Paid / issued</p><p className="font-bold text-zinc-950">UGX {Number(isSupplierDraft(exp)?exp.paidAmountUGX??(exp.status==='approved'?exp.amount:0):exp.status==='approved'?exp.amount:0).toLocaleString()}</p></div></div>{(['draft','pending','partial'].includes(exp.status.toLowerCase())||isSupplierDraft(exp))&&<button onClick={()=>handleOpenReview(exp)} className="min-h-11 w-full rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 font-bold text-emerald-950">{isSupplierDraft(exp)?'Supplier invoice & payments':'Review draft'}</button>}</article>)}</div>
      {/* Main Table / Logs Section */}
      <div className="hidden bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden md:block">
        {loading ? (
          <div className="p-12 text-center text-zinc-500 font-bold flex flex-col items-center gap-2">
            <RefreshCw className="animate-spin text-zinc-400" size={24} />
            Loading management cash outflows ledger...
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
                      UGX {(isSupplierDraft(exp)?Number(exp.paidAmountUGX??(exp.status==='approved'?exp.amount:0)):exp.status==='approved'?exp.amount:0).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                        exp.status?.toLowerCase() === 'approved' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                        (exp.status?.toLowerCase() === 'draft' || exp.status?.toLowerCase() === 'pending' || exp.status?.toLowerCase() === 'partial') ? "bg-amber-50 text-amber-600 border border-amber-100" :
                        exp.status?.toLowerCase() === 'rejected' ? "bg-red-50 text-red-600 border border-red-100" :
                        "bg-zinc-100 text-zinc-500"
                      }`}>
                        {exp.status?.toLowerCase() === 'approved' ? 'issued' : exp.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {(isSupplierDraft(exp) || exp.status?.toLowerCase() === 'draft' || exp.status?.toLowerCase() === 'pending' || exp.status?.toLowerCase() === 'partial') ? (
                        <button
                          onClick={() => handleOpenReview(exp)}
                          className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-wider rounded-lg border border-amber-200 transition-all flex items-center gap-1 mx-auto"
                        >
                          <Eye size={12} />
                          {isSupplierDraft(exp) ? 'Supplier invoice & payments' : 'Review Draft'}
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
                      No management cash outflows logs found matching current search filters.
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-expense-title"
            onSubmit={handleLogManual}
            className="flex max-h-[calc(100dvh-1.5rem)] w-full min-w-0 max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2 sm:px-6">
              <h3 id="manual-expense-title" className="font-black text-zinc-950 sm:text-xl">Log Management Cash Outflow</h3>
              <button type="button" aria-label="Close expense form" onClick={() => setIsManualModalOpen(false)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-600 hover:bg-zinc-100">
                <X size={24} />
              </button>
            </div>
            <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
              <div className="space-y-1">
                <label htmlFor="manual-expense-date" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Expense Date</label>
                <input
                  id="manual-expense-date"
                  type="date"
                  required
                  className="w-full min-w-0 max-w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                  value={manualForm.expense_date}
                  onChange={(e) => setManualForm({ ...manualForm, expense_date: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="manual-expense-amount" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Amount (UGX)</label>
                <input
                  id="manual-expense-amount"
                  type="number"
                  required
                  placeholder="Enter amount..."
                  className="w-full min-w-0 max-w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-bold text-zinc-950"
                  value={manualForm.amount}
                  onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="manual-expense-category" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</label>
                <select
                  id="manual-expense-category"
                  className="w-full min-w-0 max-w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-semibold text-zinc-800"
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
                <label htmlFor="manual-expense-department" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Department/Branch</label>
                <select
                  id="manual-expense-department"
                  className="w-full min-w-0 max-w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-semibold text-zinc-800"
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
                <label htmlFor="manual-expense-description" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Description</label>
                <textarea
                  id="manual-expense-description"
                  rows={3}
                  required
                  placeholder="Describe the nature of this expense..."
                  className="w-full min-w-0 max-w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none text-base"
                  value={manualForm.description}
                  onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
                />
              </div>

              <label className="grid gap-1 text-sm font-semibold">
                Cash voucher or receipt reference
                <input type="text" required minLength={3} maxLength={100} value={manualForm.voucher}
                  onChange={e => setManualForm({ ...manualForm, voucher: e.target.value })}
                  className="w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-base" />
              </label>
              <p className="text-xs text-zinc-600">Record the payment after the recipient has been paid. Reuse the voucher reference if you retry.</p>
            </div>
            <div className="flex shrink-0 gap-2 border-t border-zinc-100 px-4 py-2 sm:px-6">
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="min-h-11 min-w-0 flex-1 px-2 py-2 bg-zinc-100 hover:bg-zinc-250 text-zinc-600 rounded-xl text-xs font-bold uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={posting}
                className="min-h-11 min-w-0 flex-1 px-2 py-2 bg-zinc-950 hover:bg-zinc-850 text-white rounded-xl text-xs font-bold uppercase tracking-widest"
              >
                Record external payment
              </button>
            </div>
          </form>
        </div>
      )}

      {isReviewModalOpen && reviewingExpense && isSupplierDraft(reviewingExpense)&&<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3"><div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg min-w-0 flex-col overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-2xl"><div className="flex shrink-0 items-center justify-between border-b border-zinc-200 p-4"><h3 className="font-bold text-zinc-950">Supplier payment</h3><button aria-label="Close supplier payment" onClick={()=>setIsReviewModalOpen(false)} className="min-h-11 min-w-11 rounded-xl border border-zinc-300 bg-white text-zinc-900"><X size={20} className="mx-auto"/></button></div><div className="min-h-0 overflow-y-auto overscroll-contain p-4"><SupplierInvoicePaymentPanel draftId={reviewingExpense.id} onRejected={reviewingExpense.source === 'credit_payment' ? handleRejectDraft : undefined} onSettled={()=>{setIsReviewModalOpen(false);setReviewingExpense(null);toast.success('Supplier payment recorded.');setPaymentRefresh(value=>value+1);void fetchData();}}/></div></div></div>}
      {/* Review Draft Modal */}
      {isReviewModalOpen && reviewingExpense && !isSupplierDraft(reviewingExpense) && (
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
                    disabled={posting}
                    onClick={handleConfirmAndIssue}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-1"
                  >
                    <Check size={14} /> Record external payment
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
