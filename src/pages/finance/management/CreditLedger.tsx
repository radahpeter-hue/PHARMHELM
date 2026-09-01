import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { firestoreService } from '../../../services/firestore';
import { Search, Filter, Download, CreditCard, ChevronLeft, ChevronRight, X, ArrowRight, Check, Ban } from 'lucide-react';
import * as XLSX from 'xlsx';
import { collection, query, where, getDocs, Timestamp, writeBatch, addDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { toast } from 'sonner';
import { dateInRange, financialDate, normalizeCreditRecord } from '../../../services/financeRecordNormalization';

interface CreditRecord {
  id: string;
  tenantId: string;
  invoiceId: string;
  invoiceRef: string;
  supplierId: string;
  supplierName: string;
  branchId: string;
  branchName: string;
  originalCreditAmount: number;
  remainingCreditBalance: number;
  status: 'outstanding' | 'partial' | 'paid' | 'processing';
  creditAccruedAt: any;
  lastProcessedAt: any;
  createdAt: any;
}

interface ManagementExpenseDraft {
  id?: string;
  tenantId: string;
  source: 'credit_payment';
  sourceRef: string; // CreditId
  invoiceRef: string;
  supplierName: string;
  branchId: string;
  amount: number;
  status: 'draft';
  createdAt: any;
  createdBy: string;
  excludeFromOpexRollup: true;
}

export const CreditLedger: React.FC = () => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'payables' | 'receivables'>('payables');
  const [credits, setCredits] = useState<CreditRecord[]>([]);
  const [receivables, setReceivables] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]); // for payment history
  const [loading, setLoading] = useState(true);

  // Date Range (default to current month)
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const end = today.toISOString().split('T')[0];
    return { start, end };
  });

  // Client-side filters
  const [selectedBranch, setSelectedBranch] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');

  // Inline Payment Processing Panel State (holds the recordId being processed)
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [amountToProcess, setAmountToProcess] = useState<number>(0);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 50;

  // Detail Modal
  const [selectedCredit, setSelectedCredit] = useState<CreditRecord | null>(null);

  // Debounce Search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchText]);

  // Fetch Credits (Payables and Receivables)
  const fetchCredits = async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    try {
      // 1. Fetch Credits Owed to Suppliers (Payables)
      const colRef = collection(db, 'creditLedger');
      const q = query(
        colRef,
        where('tenantId', '==', profile.tenantId)
      );

      const snapshot = await getDocs(q);
      const data = snapshot.docs
        .map(snap => normalizeCreditRecord(snap.id, snap.data()) as CreditRecord)
        .filter(credit => dateInRange(credit.creditAccruedAt, dateRange.start, dateRange.end))
        .sort((a, b) => (financialDate(b.creditAccruedAt)?.getTime() || 0) - (financialDate(a.creditAccruedAt)?.getTime() || 0));

      setCredits(data);

      // 2. Fetch Credits Owed to Company (Receivables)
      const recCol = collection(db, 'credit_receivables');
      const recQ = query(
        recCol,
        where('tenantId', '==', profile.tenantId)
      );
      const recSnapshot = await getDocs(recQ);
      const recData = recSnapshot.docs.map(doc => ({
        ...(doc.data() as any),
        id: doc.id
      }));

      // 2b. Fetch POS sales labeled as institutional_credit
      const salesCol = collection(db, 'sales');
      const salesQ1 = query(
        salesCol,
        where('tenantId', '==', profile.tenantId),
        where('paymentMethod', '==', 'institutional_credit')
      );
      const salesSnapshot1 = await getDocs(salesQ1);
      
      const salesQ2 = query(
        salesCol,
        where('tenantId', '==', profile.tenantId),
        where('secondaryPaymentMethod', '==', 'institutional_credit')
      );
      const salesSnapshot2 = await getDocs(salesQ2);

      const salesMap = new Map<string, any>();
      salesSnapshot1.docs.forEach(doc => {
        const d = doc.data();
        salesMap.set(doc.id, {
          id: doc.id,
          ...d,
          creditAmount: d.totalAmount !== undefined ? d.totalAmount : (d.total || 0)
        });
      });
      salesSnapshot2.docs.forEach(doc => {
        const d = doc.data();
        salesMap.set(doc.id, {
          id: doc.id,
          ...d,
          creditAmount: d.secondaryAmount !== undefined ? d.secondaryAmount : (d.totalAmount !== undefined ? d.totalAmount : (d.total || 0))
        });
      });

      const allSalesAsReceivables = Array.from(salesMap.values());

      // Merge: For each POS sale, if it doesn't exist in recData, add it dynamically!
      // If it exists in recData, we use the recData entry as it tracks payment history.
      const mergedReceivables = [...recData];
      
      allSalesAsReceivables.forEach(sale => {
        const exists = recData.some(r => r.id === sale.id || r.receipt_id === sale.id);
        if (!exists) {
          mergedReceivables.push({
            id: sale.id,
            tenantId: sale.tenantId,
            receipt_id: sale.id,
            client_id: sale.patientId || sale.institutionId || '',
            client_name: sale.institutionName || sale.patientName || 'Individual client',
            amount_ugx: sale.creditAmount,
            outstanding_ugx: sale.creditAmount,
            status: 'outstanding',
            branch_id: sale.branchId || 'HQ',
            due_date: sale.timestamp || new Date().toISOString(),
            invoice_number: sale.receiptNumber || 'N/A',
            created_at: sale.timestamp || new Date().toISOString()
          });
        }
      });

      setReceivables(mergedReceivables);

      // 3. Fetch management_expenses as well for history
      const expCol = collection(db, 'management_expenses');
      const expQ = query(expCol, where('tenantId', '==', profile.tenantId));
      const expSnapshot = await getDocs(expQ);
      setExpenses(expSnapshot.docs.map(doc => {
        const data = doc.data() as any;
        return {
          ...data,
          amount: data.amount !== undefined ? data.amount : (data.amount_ugx || 0),
          id: doc.id
        };
      }));

    } catch (e: any) {
      console.error("Error fetching credit records:", e);
      toast.error("Failed to load credits. Check if firestore indexes are created.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredits();
  }, [profile?.tenantId, dateRange.start, dateRange.end]);

  // Branch dropdown list
  const branchOptions = useMemo(() => {
    const branches = credits.map(c => c.branchName).filter(Boolean);
    return ['All', ...Array.from(new Set(branches))];
  }, [credits]);

  // Filter Credits (Payables)
  const filteredCredits = useMemo(() => {
    return credits.filter(credit => {
      // Branch Filter
      if (selectedBranch !== 'All' && credit.branchName !== selectedBranch) return false;
      // Status Filter
      if (selectedStatus !== 'All') {
        if (selectedStatus === 'Outstanding' && credit.status !== 'outstanding') return false;
        if (selectedStatus === 'Partial' && credit.status !== 'partial') return false;
        if (selectedStatus === 'Paid' && credit.status !== 'paid') return false;
        if (selectedStatus === 'Processing' && credit.status !== 'processing') return false;
      }
      // Search Box (Invoice Ref, Supplier, Branch Name)
      if (debouncedSearchText.trim()) {
        const queryStr = debouncedSearchText.toLowerCase().trim();
        const refMatch = (credit.invoiceRef || '').toLowerCase().includes(queryStr);
        const supplierMatch = (credit.supplierName || '').toLowerCase().includes(queryStr);
        const branchMatch = (credit.branchName || '').toLowerCase().includes(queryStr);
        if (!refMatch && !supplierMatch && !branchMatch) return false;
      }
      return true;
    });
  }, [credits, selectedBranch, selectedStatus, debouncedSearchText]);

  // Filter Receivables (Owing credits to company)
  const filteredReceivables = useMemo(() => {
    return receivables.filter(rec => {
      // Date Filter
      const recDate = rec.created_at ? rec.created_at.split('T')[0] : (rec.due_date ? rec.due_date.split('T')[0] : '');
      if (dateRange.start && recDate < dateRange.start) return false;
      if (dateRange.end && recDate > dateRange.end) return false;

      // Status Filter
      if (selectedStatus !== 'All') {
        const statusLower = rec.status?.toLowerCase();
        if (selectedStatus === 'Outstanding' && statusLower !== 'outstanding' && statusLower !== 'unpaid' && statusLower !== 'overdue') return false;
        if (selectedStatus === 'Paid' && statusLower !== 'paid') return false;
        if (selectedStatus === 'Defaulted' && statusLower !== 'defaulted') return false;
      }

      // Search Box (Invoice Ref / Receipt ID, Client Name)
      if (debouncedSearchText.trim()) {
        const queryStr = debouncedSearchText.toLowerCase().trim();
        const refMatch = (rec.invoice_number || '').toLowerCase().includes(queryStr);
        const receiptMatch = (rec.receipt_id || '').toLowerCase().includes(queryStr);
        const clientMatch = (rec.client_name || '').toLowerCase().includes(queryStr);
        if (!refMatch && !receiptMatch && !clientMatch) return false;
      }
      return true;
    });
  }, [receivables, selectedStatus, debouncedSearchText, dateRange]);

  // Paginated and Unified Results
  const paginatedItems = useMemo(() => {
    const startIdx = (currentPage - 1) * rowsPerPage;
    const items = activeTab === 'payables' ? filteredCredits : filteredReceivables;
    return items.slice(startIdx, startIdx + rowsPerPage);
  }, [activeTab, filteredCredits, filteredReceivables, currentPage, rowsPerPage]);

  const totalPages = useMemo(() => {
    const totalCount = activeTab === 'payables' ? filteredCredits.length : filteredReceivables.length;
    return Math.ceil(totalCount / rowsPerPage) || 1;
  }, [activeTab, filteredCredits.length, filteredReceivables.length]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBranch, selectedStatus, debouncedSearchText, activeTab]);

  // Payment confirmation submission
  const handleConfirmPayment = async (credit: CreditRecord) => {
    if (amountToProcess <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }
    if (amountToProcess > credit.remainingCreditBalance) {
      toast.error(`Cannot process more than the remaining balance of UGX ${credit.remainingCreditBalance.toLocaleString()}`);
      return;
    }

    setIsSubmittingPayment(true);
    try {
      // 1. Create DRAFT document in standardized management_expenses collection
      const draftPayload = {
        tenantId: profile?.tenantId || '',
        date: new Date().toISOString().split('T')[0],
        expense_date: new Date().toISOString().split('T')[0],
        amount: amountToProcess,
        originalAmount: credit.remainingCreditBalance, // the approved ceiling
        category: 'Procurement & Logistics',
        department: credit.branchName || 'HQ',
        description: `Credit payment to ${credit.supplierName || 'Supplier'} - Ref: ${credit.invoiceRef}`,
        status: 'draft',
        sourceType: 'credit',
        source: 'credit_payment',
        excludeFromOpexRollup: true,
        invoiceId: credit.invoiceId || '',
        invoiceRef: credit.invoiceRef || '',
        sourceRefId: credit.id,
        logged_by: profile?.fullName || profile?.email || 'Authorized Finance',
        created_at: new Date().toISOString(),
        createdBy: profile?.uid || 'SYSTEM'
      };

      const draftId = `credit_payment_${credit.id}_${credit.remainingCreditBalance}_${amountToProcess}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const batch = writeBatch(db);
      batch.set(doc(db, 'management_expenses', draftId), {
        ...draftPayload,
        sourceRef: credit.id,
        createdAt: Timestamp.now()
      }, { merge: true });

      // 2. Mark the liability as processing in the same atomic write.
      const creditDocRef = doc(db, 'creditLedger', credit.id);
      batch.update(creditDocRef, {
        status: 'processing',
        lastProcessedAt: Timestamp.now()
      });
      await batch.commit();

      toast.success('Payment draft sent to Management Expense Ledger for review and issuance.');
      setProcessingId(null);
      fetchCredits(); // Refresh list
    } catch (e: any) {
      console.error("Error submitting credit payment:", e);
      toast.error("Failed to process payment. Try again.");
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Receivable payment confirmation and bank transfer
  const handleConfirmReceivablePayment = async (rec: any) => {
    if (amountToProcess <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }
    if (amountToProcess > rec.outstanding_ugx) {
      toast.error(`Cannot process more than the outstanding balance of UGX ${rec.outstanding_ugx.toLocaleString()}`);
      return;
    }

    setIsSubmittingPayment(true);
    try {
      const remainingBalance = rec.outstanding_ugx - amountToProcess;
      const updatedStatus = remainingBalance === 0 ? 'paid' : 'outstanding';

      // 1. Create or update document in credit_receivables collection
      const recDocRef = doc(db, 'credit_receivables', rec.id);
      
      const payload: any = {
        tenantId: profile?.tenantId || '',
        receipt_id: rec.receipt_id || rec.id,
        client_name: rec.client_name || 'Individual client',
        amount_ugx: rec.amount_ugx || rec.totalAmount || rec.total || 0,
        outstanding_ugx: remainingBalance,
        status: updatedStatus,
        branch_id: rec.branch_id || 'HQ',
        due_date: rec.due_date || new Date().toISOString(),
        invoice_number: rec.invoice_number || rec.receiptNumber || 'N/A',
        created_at: rec.created_at || new Date().toISOString(),
        lastProcessedAt: Timestamp.now()
      };

      await setDoc(recDocRef, payload, { merge: true });

      // 2. Log a Cash Transfer from 'receivables' to 'banked'
      await addDoc(collection(db, 'cashTransfers'), {
        tenantId: profile?.tenantId || '',
        fromPortfolio: 'receivables',
        toPortfolio: 'banked',
        amount: amountToProcess,
        processedBy: profile?.fullName || profile?.email || 'Authorized Finance',
        processedAt: Timestamp.now(),
        notes: `Received payment for credit receivable: ${rec.invoice_number || rec.receipt_id || 'N/A'}`
      });

      toast.success(`Payment of UGX ${amountToProcess.toLocaleString()} processed. Remaining: UGX ${remainingBalance.toLocaleString()}. Amount banked successfully!`);
      setProcessingId(null);
      fetchCredits(); // Refresh list
    } catch (e: any) {
      console.error("Error submitting receivable payment:", e);
      toast.error("Failed to process payment. Try again.");
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Excel report generation
  const handleExport = () => {
    const isPayables = activeTab === 'payables';
    const itemsToExport = isPayables ? filteredCredits : filteredReceivables;

    if (itemsToExport.length === 0) {
      toast.error(`No ${activeTab} data to export`);
      return;
    }

    const exportData = itemsToExport.map(c => {
      if (isPayables) {
        let dateStr = '';
        if (c.creditAccruedAt) {
          dateStr = financialDate(c.creditAccruedAt)?.toLocaleDateString('en-GB') || '';
        }
        return {
          'Type': 'PAYABLE (Owed to Supplier)',
          'Date Accrued': dateStr,
          'Invoice Ref': c.invoiceRef || '',
          'Supplier/Client': c.supplierName || '',
          'Branch': c.branchName || '',
          'Original Credit Amount (UGX)': c.originalCreditAmount || 0,
          'Remaining Balance (UGX)': c.remainingCreditBalance || 0,
          'Status': (c.status || '').toUpperCase()
        };
      } else {
        const dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB') : (c.due_date ? new Date(c.due_date).toLocaleDateString('en-GB') : 'N/A');
        return {
          'Type': 'RECEIVABLE (Owed to Company)',
          'Date Accrued': dateStr,
          'Invoice/Receipt Ref': c.invoice_number || c.receipt_id || '',
          'Supplier/Client': c.client_name || 'Client',
          'Branch': c.branch_id || 'HQ',
          'Original Credit Amount (UGX)': c.amount_ugx || 0,
          'Remaining Balance (UGX)': c.outstanding_ugx || 0,
          'Status': (c.status || '').toUpperCase()
        };
      }
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isPayables ? "Payables" : "Receivables");

    const formattedFrom = dateRange.start.split('-').reverse().join('-');
    const formattedTo = dateRange.end.split('-').reverse().join('-');
    XLSX.writeFile(wb, `CreditReport_${isPayables ? "Payables" : "Receivables"}_${formattedFrom}_${formattedTo}.xlsx`);
    toast.success("Excel report exported successfully");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'outstanding':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-50 text-red-700 border border-red-200">Outstanding</span>;
      case 'partial':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200">Partial</span>;
      case 'paid':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Paid</span>;
      case 'processing':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">Processing</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-zinc-50 text-zinc-500">{status}</span>;
    }
  };

  // Payment history for a given credit record
  const selectedCreditHistory = useMemo(() => {
    if (!selectedCredit) return [];
    return expenses.filter(e => e.sourceRef === selectedCredit.id || e.sourceRefId === selectedCredit.id);
  }, [selectedCredit, expenses]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-zinc-900 tracking-tight">Credit Ledger</h2>
          <p className="text-sm text-zinc-500">Owed credits (payables) and owing credits (receivables) ledger.</p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-[#1A5E38] hover:bg-[#154b2d] text-white rounded-xl shadow-sm transition-all self-start md:self-auto"
        >
          <Download size={16} />
          Download Report
        </button>
      </div>

      {/* Dual Tabs for Payables vs Receivables */}
      <div className="flex border-b border-zinc-200">
        <button
          onClick={() => setActiveTab('payables')}
          className={`px-6 py-3 text-sm font-black border-b-2 transition-all ${
            activeTab === 'payables'
              ? 'border-[#1A5E38] text-[#1A5E38]'
              : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          Payables (Owed to Suppliers)
        </button>
        <button
          onClick={() => setActiveTab('receivables')}
          className={`px-6 py-3 text-sm font-black border-b-2 transition-all ${
            activeTab === 'receivables'
              ? 'border-[#1A5E38] text-[#1A5E38]'
              : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          Receivables (Owed to Company)
        </button>
      </div>

      {/* Filter Box */}
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search Box */}
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2 rounded-xl focus-within:border-[#1A5E38] transition-all">
            <Search size={16} className="text-zinc-400" />
            <input
              type="text"
              placeholder={activeTab === 'payables' ? "Search ref, supplier, branch..." : "Search client, receipt, invoice..."}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="bg-transparent border-none text-sm outline-none w-full text-zinc-800 placeholder-zinc-400"
            />
          </div>

          {/* Branch Select */}
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2 rounded-xl">
            <Filter size={16} className="text-zinc-400" />
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="bg-transparent border-none text-sm outline-none w-full text-zinc-800"
              disabled={activeTab === 'receivables'}
            >
              <option value="All">All Branches</option>
              {branchOptions.filter(b => b !== 'All').map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          {/* Status Select */}
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2 rounded-xl">
            <Filter size={16} className="text-zinc-400" />
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-transparent border-none text-sm outline-none w-full text-zinc-800"
            >
              <option value="All">All Statuses</option>
              <option value="Outstanding">Outstanding</option>
              {activeTab === 'payables' && <option value="Partial">Partial</option>}
              <option value="Paid">Paid</option>
              {activeTab === 'receivables' && <option value="Defaulted">Defaulted</option>}
            </select>
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1A5E38]"></div>
            <p className="text-zinc-500 text-sm font-semibold">Loading credit ledger...</p>
          </div>
        ) : filteredCredits.length === 0 ? (
          <div className="text-center py-16">
            <CreditCard className="mx-auto h-12 w-12 text-zinc-300 mb-3" />
            <p className="text-zinc-500 font-medium">No credits found for the selected period and filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  <th className="px-6 py-4">Date {activeTab === 'payables' ? 'Accrued' : 'Due'}</th>
                  <th className="px-6 py-4">{activeTab === 'payables' ? 'Invoice Ref' : 'Invoice/Receipt'}</th>
                  <th className="px-6 py-4">{activeTab === 'payables' ? 'Supplier' : 'Client / Debtor'}</th>
                  <th className="px-6 py-4">Branch</th>
                  <th className="px-6 py-4 text-right">Original (UGX)</th>
                  <th className="px-6 py-4 text-right">Remaining (UGX)</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-sm font-medium text-zinc-700">
                {activeTab === 'payables' ? (
                  (paginatedItems as CreditRecord[]).map((credit) => {
                    const dateStr = financialDate(credit.creditAccruedAt)?.toLocaleDateString('en-GB') || 'N/A';
                    const isProcessing = processingId === credit.id;

                    return (
                      <React.Fragment key={credit.id}>
                        <tr className="hover:bg-zinc-50/30 transition-all">
                          <td className="px-6 py-4 text-zinc-500">{dateStr}</td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() => setSelectedCredit(credit)}
                              className="font-bold text-[#1A5E38] hover:underline cursor-pointer focus:outline-none"
                            >
                              {credit.invoiceRef}
                            </button>
                          </td>
                          <td className="px-6 py-4 text-zinc-900">{credit.supplierName}</td>
                          <td className="px-6 py-4 text-zinc-600">{credit.branchName}</td>
                          <td className="px-6 py-4 text-right font-mono font-bold text-zinc-400">
                            {credit.originalCreditAmount?.toLocaleString() || 0}
                          </td>
                          <td className="px-6 py-4 text-right font-mono font-bold">
                            <span className={credit.remainingCreditBalance > 0 ? "text-amber-600" : "text-zinc-400"}>
                              {credit.remainingCreditBalance?.toLocaleString() || 0}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {getStatusBadge(credit.status)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {(credit.status === 'outstanding' || credit.status === 'partial') ? (
                              <button
                                onClick={() => {
                                  setProcessingId(credit.id);
                                  setAmountToProcess(credit.remainingCreditBalance);
                                }}
                                className="px-3 py-1.5 text-xs font-bold border border-emerald-500 text-emerald-600 rounded-lg hover:bg-emerald-50 transition-all"
                              >
                                Process Payment
                              </button>
                            ) : (
                              <span className="text-xs text-zinc-400">-</span>
                            )}
                          </td>
                        </tr>

                        {/* Inline Processing Panel */}
                        {isProcessing && (
                          <tr>
                            <td colSpan={8} className="px-6 py-4 bg-emerald-50/30 border-y border-emerald-100">
                              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="space-y-1">
                                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest block">Inline Payment Processing</span>
                                  <p className="text-xs text-zinc-600 font-medium">
                                    Sending draft payment for <strong className="text-zinc-900">{credit.invoiceRef}</strong> to supplier <strong className="text-zinc-900">{credit.supplierName}</strong>.
                                    Remaining Balance: <strong className="text-zinc-950">UGX {credit.remainingCreditBalance?.toLocaleString()}</strong>
                                  </p>
                                </div>

                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-2">
                                    <label className="text-xs font-bold text-zinc-500">Amount to process (UGX):</label>
                                    <input
                                      type="number"
                                      min={1}
                                      max={credit.remainingCreditBalance}
                                      value={amountToProcess || ''}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        // Hard block preventing entering more than remainingCreditBalance
                                        if (val > credit.remainingCreditBalance) {
                                          setAmountToProcess(credit.remainingCreditBalance);
                                        } else {
                                          setAmountToProcess(val);
                                        }
                                      }}
                                      className="border border-zinc-200 bg-white px-3 py-1.5 rounded-xl font-mono text-sm font-bold w-40 outline-none text-zinc-800 focus:border-emerald-500"
                                    />
                                  </div>
                                  <button
                                    onClick={() => handleConfirmPayment(credit)}
                                    disabled={isSubmittingPayment}
                                    className="flex items-center gap-1 px-4 py-1.5 text-xs font-bold bg-[#1A5E38] text-white hover:bg-[#154b2d] disabled:opacity-50 rounded-xl transition-all shadow-sm"
                                  >
                                    <Check size={14} />
                                    Confirm & Send to Expense Ledger
                                  </button>
                                  <button
                                    onClick={() => setProcessingId(null)}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 rounded-xl transition-all shadow-sm"
                                  >
                                    <Ban size={14} />
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                ) : (
                  (paginatedItems as any[]).map((rec) => {
                    const dateStr = rec.due_date ? new Date(rec.due_date).toLocaleDateString('en-GB') : 'N/A';
                    const isProcessing = processingId === rec.id;
                    return (
                      <React.Fragment key={rec.id}>
                        <tr className="hover:bg-zinc-50/30 transition-all">
                          <td className="px-6 py-4 text-zinc-500">{dateStr}</td>
                          <td className="px-6 py-4 font-mono font-bold text-zinc-800">
                            {rec.invoice_number || rec.receipt_id || 'N/A'}
                          </td>
                          <td className="px-6 py-4 text-zinc-900 font-bold">{rec.client_name || 'Individual client'}</td>
                          <td className="px-6 py-4 text-zinc-600">{rec.branch_id || 'HQ'}</td>
                          <td className="px-6 py-4 text-right font-mono font-bold text-zinc-400">
                            {(rec.amount_ugx || 0).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-right font-mono font-bold">
                            <span className={rec.outstanding_ugx > 0 ? "text-amber-600" : "text-zinc-400"}>
                              {(rec.outstanding_ugx || 0).toLocaleString()}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {rec.status === 'Paid' || rec.status === 'paid' ? (
                              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Paid</span>
                            ) : rec.status === 'Overdue' || rec.status === 'defaulted' ? (
                              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-50 text-red-700 border border-red-200">Overdue</span>
                            ) : (
                              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200">Outstanding</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {(rec.status !== 'Paid' && rec.status !== 'paid' && rec.outstanding_ugx > 0) ? (
                              <button
                                onClick={() => {
                                  setProcessingId(rec.id);
                                  setAmountToProcess(rec.outstanding_ugx);
                                }}
                                className="px-3 py-1.5 text-xs font-bold border border-emerald-500 text-emerald-600 rounded-lg hover:bg-emerald-50 transition-all"
                              >
                                Process Payment
                              </button>
                            ) : (
                              <span className="text-xs text-zinc-400">-</span>
                            )}
                          </td>
                        </tr>

                        {/* Inline Processing Panel for Receivable */}
                        {isProcessing && (
                          <tr>
                            <td colSpan={8} className="px-6 py-4 bg-emerald-50/30 border-y border-emerald-100">
                              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="space-y-1">
                                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest block">Receivable Payment Processing</span>
                                  <p className="text-xs text-zinc-600 font-medium">
                                    Processing payment for receivable <strong className="text-zinc-900">{rec.invoice_number || rec.receipt_id}</strong> from client <strong className="text-zinc-900">{rec.client_name}</strong>.
                                    Outstanding Balance: <strong className="text-zinc-950">UGX {rec.outstanding_ugx?.toLocaleString()}</strong>
                                  </p>
                                </div>

                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-2">
                                    <label className="text-xs font-bold text-zinc-500">Amount Paid (UGX):</label>
                                    <input
                                      type="number"
                                      min={1}
                                      max={rec.outstanding_ugx}
                                      value={amountToProcess || ''}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        if (val > rec.outstanding_ugx) {
                                          setAmountToProcess(rec.outstanding_ugx);
                                        } else {
                                          setAmountToProcess(val);
                                        }
                                      }}
                                      className="border border-zinc-200 bg-white px-3 py-1.5 rounded-xl font-mono text-sm font-bold w-40 outline-none text-zinc-800 focus:border-emerald-500"
                                    />
                                  </div>
                                  <button
                                    onClick={() => handleConfirmReceivablePayment(rec)}
                                    disabled={isSubmittingPayment}
                                    className="flex items-center gap-1 px-4 py-1.5 text-xs font-bold bg-[#1A5E38] text-white hover:bg-[#154b2d] disabled:opacity-50 rounded-xl transition-all shadow-sm"
                                  >
                                    <Check size={14} />
                                    Confirm Payment & Bank
                                  </button>
                                  <button
                                    onClick={() => setProcessingId(null)}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 rounded-xl transition-all shadow-sm"
                                  >
                                    <Ban size={14} />
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 bg-zinc-50 border-t border-zinc-200">
                <span className="text-xs text-zinc-500 font-medium">
                  Showing page {currentPage} of {totalPages} ({filteredCredits.length} credit items)
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

      {/* Credit Details Modal & History Summary */}
      {selectedCredit && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-xl overflow-hidden shadow-xl border border-zinc-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
              <div className="flex items-center gap-2">
                <CreditCard className="text-[#1A5E38]" size={20} />
                <h3 className="text-lg font-black text-zinc-950 tracking-tight">Credit Details & History</h3>
              </div>
              <button
                onClick={() => setSelectedCredit(null)}
                className="text-zinc-400 hover:text-zinc-600 p-1 hover:bg-zinc-100 rounded-full transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Invoice Reference</span>
                  <span className="font-bold text-zinc-900 text-lg">{selectedCredit.invoiceRef}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Credit Status</span>
                  <div className="mt-1">{getStatusBadge(selectedCredit.status)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Supplier</span>
                  <span className="font-semibold text-zinc-800">{selectedCredit.supplierName}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Branch Store</span>
                  <span className="font-semibold text-zinc-800">{selectedCredit.branchName}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Original Credit Owed</span>
                  <span className="font-mono font-bold text-zinc-950 text-base">UGX {selectedCredit.originalCreditAmount?.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Remaining Credit Balance</span>
                  <span className="font-mono font-bold text-amber-600 text-base">UGX {selectedCredit.remainingCreditBalance?.toLocaleString()}</span>
                </div>
              </div>

              {/* Payment History Log */}
              <div className="border-t border-zinc-100 pt-4">
                <span className="text-xs font-black text-zinc-950 uppercase tracking-wider block mb-2">Payment History & Transactions</span>
                {selectedCreditHistory.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic py-2">No payments processed for this credit item yet.</p>
                ) : (
                  <div className="bg-zinc-50 border border-zinc-200 rounded-xl divide-y divide-zinc-200 overflow-hidden">
                    {selectedCreditHistory.map((exp) => {
                      const date = exp.createdAt?.toDate ? exp.createdAt.toDate() : new Date(exp.createdAt);
                      return (
                        <div key={exp.id} className="p-3 text-xs flex items-center justify-between hover:bg-zinc-100/40 transition-all">
                          <div>
                            <span className="font-semibold text-zinc-800 block">UGX {exp.amount?.toLocaleString()}</span>
                            <span className="text-[10px] text-zinc-400">
                              Logged: {date.toLocaleString('en-GB')}
                            </span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            exp.status === 'issued' 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                              : exp.status === 'draft' 
                                ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                                : 'bg-red-50 text-red-700 border-red-200'
                          }`}>
                            {exp.status ? exp.status.toUpperCase() : 'PENDING'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-zinc-100 bg-zinc-50 flex justify-end">
              <button
                onClick={() => setSelectedCredit(null)}
                className="px-4 py-2 text-xs font-bold border border-zinc-200 rounded-xl hover:bg-white text-zinc-600 shadow-sm transition-all"
              >
                Close details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
