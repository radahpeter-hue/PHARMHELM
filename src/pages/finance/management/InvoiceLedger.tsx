import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { firestoreService } from '../../../services/firestore';
import { Search, Filter, Download, FileText, ChevronLeft, ChevronRight, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { toast } from 'sonner';
import { dateInRange, financialDate, normalizeInvoiceRecord } from '../../../services/financeRecordNormalization';

interface Invoice {
  id: string;
  tenantId: string;
  invoiceRef: string;
  grnId: string;
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  invoiceValue: number;
  paymentStatus: 'cash' | 'credit' | 'partial' | 'paid';
  creditBalance: number;
  createdAt: any;
  updatedAt: any;
}

export const InvoiceLedger: React.FC = () => {
  const { profile } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  // Date Range (default to current month)
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const end = today.toISOString().split('T')[0];
    return { start, end };
  });

  // Client-side Filter States
  const [selectedBranch, setSelectedBranch] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [selectedSupplier, setSelectedSupplier] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 50;

  // Detail Modal
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Debounce Search Text (300ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchText]);

  // Fetch Invoices based on Date Range and Tenant ID
  const fetchInvoices = async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    try {
      const colRef = collection(db, 'invoices');
      const q = query(
        colRef,
        where('tenantId', '==', profile.tenantId)
      );

      const snapshot = await getDocs(q);
      const data = snapshot.docs
        .map(snap => normalizeInvoiceRecord(snap.id, snap.data()) as Invoice)
        .filter(invoice => dateInRange(invoice.createdAt, dateRange.start, dateRange.end))
        .sort((a, b) => (financialDate(b.createdAt)?.getTime() || 0) - (financialDate(a.createdAt)?.getTime() || 0));

      setInvoices(data);
    } catch (e: any) {
      console.error("Error fetching invoices:", e);
      toast.error("Failed to load invoices. Check if firestore indexes are created.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, [profile?.tenantId, dateRange.start, dateRange.end]);

  // Dynamic filter options based on fetched results
  const branchOptions = useMemo(() => {
    const branches = invoices.map(i => i.branchName).filter(Boolean);
    return ['All', ...Array.from(new Set(branches))];
  }, [invoices]);

  const supplierOptions = useMemo(() => {
    const suppliers = invoices.map(i => i.supplierName).filter(Boolean);
    return ['All', ...Array.from(new Set(suppliers))];
  }, [invoices]);

  // Filtered results
  const filteredInvoices = useMemo(() => {
    return invoices.filter(invoice => {
      // Branch filter
      if (selectedBranch !== 'All' && invoice.branchName !== selectedBranch) return false;
      // Status filter
      if (selectedStatus !== 'All' && invoice.paymentStatus !== selectedStatus.toLowerCase()) return false;
      // Supplier filter
      if (selectedSupplier !== 'All' && invoice.supplierName !== selectedSupplier) return false;
      // Search search on invoiceRef
      if (debouncedSearchText.trim()) {
        const refMatch = (invoice.invoiceRef || '').toLowerCase().includes(debouncedSearchText.toLowerCase().trim());
        if (!refMatch) return false;
      }
      return true;
    });
  }, [invoices, selectedBranch, selectedStatus, selectedSupplier, debouncedSearchText]);

  // Paginated Results
  const paginatedInvoices = useMemo(() => {
    const startIdx = (currentPage - 1) * rowsPerPage;
    return filteredInvoices.slice(startIdx, startIdx + rowsPerPage);
  }, [filteredInvoices, currentPage]);

  const totalPages = Math.ceil(filteredInvoices.length / rowsPerPage) || 1;

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBranch, selectedStatus, selectedSupplier, debouncedSearchText]);

  // Export to Excel using SheetJS
  const handleExport = () => {
    if (filteredInvoices.length === 0) {
      toast.error("No invoice data to export");
      return;
    }

    const exportData = filteredInvoices.map(inv => {
      let dateStr = '';
      if (inv.createdAt) {
        const d = inv.createdAt instanceof Timestamp ? inv.createdAt.toDate() : new Date(inv.createdAt);
        dateStr = d.toLocaleDateString('en-GB');
      }
      return {
        'Date': dateStr,
        'Invoice Ref': inv.invoiceRef || '',
        'Supplier': inv.supplierName || '',
        'Branch': inv.branchName || '',
        'Invoice Value (UGX)': inv.invoiceValue || 0,
        'Payment Status': (inv.paymentStatus || '').toUpperCase()
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invoices");
    
    const formattedFrom = dateRange.start.split('-').reverse().join('-');
    const formattedTo = dateRange.end.split('-').reverse().join('-');
    XLSX.writeFile(wb, `InvoiceReport_${formattedFrom}_${formattedTo}.xlsx`);
    toast.success("Excel report exported successfully");
  };

  const getStatusBadge = (status: 'cash' | 'credit' | 'partial' | 'paid') => {
    switch (status) {
      case 'cash':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Cash</span>;
      case 'credit':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200">Credit</span>;
      case 'partial':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">Partial</span>;
      case 'paid':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Paid</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-zinc-50 text-zinc-500">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-zinc-900 tracking-tight">Invoice Ledger</h2>
          <p className="text-sm text-zinc-500">All GRN-linked invoices across all branches.</p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-[#1A5E38] hover:bg-[#154b2d] text-white rounded-xl shadow-sm transition-all self-start md:self-auto"
        >
          <Download size={16} />
          Download Report
        </button>
      </div>

      {/* Date Range & Controls */}
      <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Date From:</span>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="border border-zinc-200 px-3 py-1.5 rounded-xl text-sm font-medium outline-none text-zinc-700 focus:border-[#1A5E38] focus:ring-1 focus:ring-[#1A5E38]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Date To:</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="border border-zinc-200 px-3 py-1.5 rounded-xl text-sm font-medium outline-none text-zinc-700 focus:border-[#1A5E38] focus:ring-1 focus:ring-[#1A5E38]"
            />
          </div>
        </div>

        {/* Search & Select Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search Box */}
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2 rounded-xl focus-within:border-[#1A5E38] focus-within:ring-1 focus-within:ring-[#1A5E38] transition-all">
            <Search size={16} className="text-zinc-400" />
            <input
              type="text"
              placeholder="Search invoice ref..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="bg-transparent border-none text-sm outline-none w-full placeholder-zinc-400 text-zinc-800"
            />
          </div>

          {/* Branch Filter */}
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2 rounded-xl">
            <Filter size={16} className="text-zinc-400" />
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="bg-transparent border-none text-sm outline-none w-full text-zinc-800"
            >
              <option value="All">All Branches</option>
              {branchOptions.filter(b => b !== 'All').map(branch => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2 rounded-xl">
            <Filter size={16} className="text-zinc-400" />
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-transparent border-none text-sm outline-none w-full text-zinc-800"
            >
              <option value="All">All Statuses</option>
              <option value="Cash">Cash</option>
              <option value="Credit">Credit</option>
              <option value="Partial">Partial</option>
            </select>
          </div>

          {/* Supplier Filter */}
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2 rounded-xl">
            <Filter size={16} className="text-zinc-400" />
            <select
              value={selectedSupplier}
              onChange={(e) => setSelectedSupplier(e.target.value)}
              className="bg-transparent border-none text-sm outline-none w-full text-zinc-800"
            >
              <option value="All">All Suppliers</option>
              {supplierOptions.filter(s => s !== 'All').map(supplier => (
                <option key={supplier} value={supplier}>{supplier}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1A5E38]"></div>
            <p className="text-zinc-500 text-sm font-semibold">Loading invoices...</p>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="mx-auto h-12 w-12 text-zinc-300 mb-3" />
            <p className="text-zinc-500 font-medium">No invoices found for the selected period and filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Invoice Ref</th>
                  <th className="px-6 py-4">Supplier</th>
                  <th className="px-6 py-4">Branch</th>
                  <th className="px-6 py-4 text-right">Invoice Value (UGX)</th>
                  <th className="px-6 py-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-sm font-medium text-zinc-700">
                {paginatedInvoices.map((inv) => {
                  let dateStr = '';
                  if (inv.createdAt) {
                    const d = inv.createdAt instanceof Timestamp ? inv.createdAt.toDate() : new Date(inv.createdAt);
                    dateStr = d.toLocaleDateString('en-GB');
                  }
                  return (
                    <tr key={inv.id} className="hover:bg-zinc-50/30 transition-all">
                      <td className="px-6 py-4 text-zinc-500">{dateStr}</td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setSelectedInvoice(inv)}
                          className="font-bold text-[#1A5E38] hover:underline cursor-pointer focus:outline-none"
                        >
                          {inv.invoiceRef}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-zinc-900">{inv.supplierName}</td>
                      <td className="px-6 py-4 text-zinc-600">{inv.branchName}</td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-zinc-950">
                        {inv.invoiceValue?.toLocaleString() || 0}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {getStatusBadge(inv.paymentStatus)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 bg-zinc-50 border-t border-zinc-200">
                <span className="text-xs text-zinc-500 font-medium">
                  Showing page {currentPage} of {totalPages} ({filteredInvoices.length} invoices)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="p-1 px-3 border border-zinc-200 rounded-lg text-xs font-bold text-zinc-600 hover:bg-white disabled:opacity-50 disabled:hover:bg-transparent transition-all"
                  >
                    <ChevronLeft size={16} className="inline mr-1" />
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="p-1 px-3 border border-zinc-200 rounded-lg text-xs font-bold text-zinc-600 hover:bg-white disabled:opacity-50 disabled:hover:bg-transparent transition-all"
                  >
                    Next
                    <ChevronRight size={16} className="inline ml-1" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-xl border border-zinc-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
              <div className="flex items-center gap-2">
                <FileText className="text-[#1A5E38]" size={20} />
                <h3 className="text-lg font-black text-zinc-950 tracking-tight">Invoice Details</h3>
              </div>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-zinc-400 hover:text-zinc-600 p-1 hover:bg-zinc-100 rounded-full transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Invoice Reference</span>
                  <span className="font-bold text-zinc-900 text-lg">{selectedInvoice.invoiceRef}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Payment Status</span>
                  <div className="mt-1">{getStatusBadge(selectedInvoice.paymentStatus)}</div>
                </div>
              </div>

              <div className="border-t border-zinc-100 pt-4 grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Supplier</span>
                  <span className="font-semibold text-zinc-800">{selectedInvoice.supplierName}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Branch Store</span>
                  <span className="font-semibold text-zinc-800">{selectedInvoice.branchName}</span>
                </div>
              </div>

              <div className="border-t border-zinc-100 pt-4 grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Invoice Value</span>
                  <span className="font-mono font-bold text-zinc-950 text-base">UGX {selectedInvoice.invoiceValue?.toLocaleString() || 0}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Remaining Credit Balance</span>
                  <span className="font-mono font-bold text-amber-600 text-base">UGX {selectedInvoice.creditBalance?.toLocaleString() || 0}</span>
                </div>
              </div>

              <div className="border-t border-zinc-100 pt-4">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Linked GRN Reference ID</span>
                <span className="font-mono text-xs text-zinc-600 bg-zinc-100 px-2 py-1 rounded-md block mt-1 break-all">
                  {selectedInvoice.grnId || 'Direct-logged GRN reference'}
                </span>
              </div>

              <div className="border-t border-zinc-100 pt-4 grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Date Logged</span>
                  <span className="text-xs text-zinc-600">
                    {selectedInvoice.createdAt
                      ? (selectedInvoice.createdAt instanceof Timestamp
                          ? selectedInvoice.createdAt.toDate().toLocaleString('en-GB')
                          : new Date(selectedInvoice.createdAt).toLocaleString('en-GB'))
                      : 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Last Updated</span>
                  <span className="text-xs text-zinc-600">
                    {selectedInvoice.updatedAt
                      ? (selectedInvoice.updatedAt instanceof Timestamp
                          ? selectedInvoice.updatedAt.toDate().toLocaleString('en-GB')
                          : new Date(selectedInvoice.updatedAt).toLocaleString('en-GB'))
                      : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-zinc-100 bg-zinc-50 flex justify-end">
              <button
                onClick={() => setSelectedInvoice(null)}
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
