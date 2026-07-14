import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { firestoreService } from '../../../services/firestore';
import { 
  Download, 
  RefreshCw,
  Receipt,
  Users,
  Shield,
  FileText,
  Filter,
  Sliders
} from 'lucide-react';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { toast } from 'sonner';
import { cn } from '../../../utils/cn';
import * as XLSX from 'xlsx';

interface SystemSettings {
  id: string;
  tenantId: string;
  process_tax_deductibles?: boolean;
  taxEngineEnabled?: boolean;
  branding?: {
    logoUrl?: string;
  };
}

export const TaxEngine: React.FC = () => {
  const { profile } = useAuth();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  
  // RAW lists
  const [sales, setSales] = useState<any[]>([]);
  const [grns, setGrns] = useState<any[]>([]);
  const [payrollList, setPayrollList] = useState<any[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Tab state: 'vat' | 'paye' | 'nssf' | 'wht'
  const [activeTab, setActiveTab] = useState<'vat' | 'paye' | 'nssf' | 'wht'>('vat');

  // Filter state
  const [isDateFilterActive, setIsDateFilterActive] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });

  const fetchData = async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    try {
      // 1. Fetch System Settings
      const settingsSnap = await getDocs(query(collection(db, 'system_settings'), where('tenantId', '==', profile.tenantId)));
      if (!settingsSnap.empty) {
        setSettings({ id: settingsSnap.docs[0].id, ...settingsSnap.docs[0].data() as any });
      }

      // 2. Fetch Sales (for output VAT)
      const salesSnap = await getDocs(query(collection(db, 'sales'), where('tenantId', '==', profile.tenantId)));
      setSales(salesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      // 3. Fetch GRNs/Invoices (for input VAT and WHT)
      const grnSnap = await getDocs(query(collection(db, 'grn_records'), where('tenantId', '==', profile.tenantId)));
      setGrns(grnSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      // 4. Fetch Payroll (for PAYE & NSSF)
      const paySnap = await getDocs(query(collection(db, 'payroll'), where('tenantId', '==', profile.tenantId)));
      setPayrollList(paySnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      // 5. Fetch Staff List (to get correct labels and tins)
      const staffSnap = await getDocs(query(collection(db, 'staff'), where('tenantId', '==', profile.tenantId)));
      setStaffList(staffSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

      // 6. Fetch Branches
      const branchSnap = await getDocs(query(collection(db, 'branches'), where('tenantId', '==', profile.tenantId)));
      setBranches(branchSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));

    } catch (e: any) {
      console.error("Error fetching tax engine data:", e);
      toast.error("Failed to load tax registers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile?.tenantId]);

  // Date Filters
  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      if (s.status === 'voided') return false;
      if (!isDateFilterActive) return true;
      const d = (s.timestamp || s.date || '').split('T')[0];
      return d && d >= dateRange.start && d <= dateRange.end;
    });
  }, [sales, isDateFilterActive, dateRange]);

  const filteredGrns = useMemo(() => {
    return grns.filter(g => {
      if (!isDateFilterActive) return true;
      const d = (g.receivedAt || g.date || '').split('T')[0];
      return d && d >= dateRange.start && d <= dateRange.end;
    });
  }, [grns, isDateFilterActive, dateRange]);

  const filteredPayroll = useMemo(() => {
    return payrollList.filter(p => {
      if (!isDateFilterActive) return true;
      const d = (p.paid_date || p.generated_at || '').split('T')[0];
      return d && d >= dateRange.start && d <= dateRange.end;
    });
  }, [payrollList, isDateFilterActive, dateRange]);

  // Calculations
  const outputVat = useMemo(() => {
    return filteredSales.reduce((acc, curr) => acc + (curr.taxAmount || 0), 0);
  }, [filteredSales]);

  const inputVat = useMemo(() => {
    return filteredGrns.reduce((acc, curr) => acc + (curr.inputVat || 0), 0);
  }, [filteredGrns]);

  const netVat = useMemo(() => {
    return outputVat - inputVat;
  }, [outputVat, inputVat]);

  const totalPaye = useMemo(() => {
    return filteredPayroll.reduce((acc, curr) => acc + (curr.paye || 0), 0);
  }, [filteredPayroll]);

  const totalNssf = useMemo(() => {
    return filteredPayroll.reduce((acc, curr) => acc + (curr.nssf_employee || 0) + (curr.nssf_employer || 0), 0);
  }, [filteredPayroll]);

  const totalWht = useMemo(() => {
    return filteredGrns.reduce((acc, curr) => acc + (curr.whtAmount || 0), 0);
  }, [filteredGrns]);

  // Excel Exports
  const handleExportVat = () => {
    const data: any[] = [];
    filteredSales.forEach(s => {
      data.push({
        'Date': new Date(s.timestamp || s.date).toLocaleDateString(),
        'Ref/Receipt': s.receiptNumber || s.id,
        'Type': 'OUTPUT (SALES)',
        'Net Amount (UGX)': s.subtotal || 0,
        'VAT (18% UGX)': s.taxAmount || 0
      });
    });
    filteredGrns.filter(g => (g.inputVat || 0) > 0).forEach(g => {
      data.push({
        'Date': new Date(g.receivedAt || g.date).toLocaleDateString(),
        'Ref/GRN': g.grn_number || g.id,
        'Type': 'INPUT (PURCHASES)',
        'Net Amount (UGX)': g.total_value_ugx || 0,
        'VAT (18% UGX)': g.inputVat || 0
      });
    });

    data.push({
      'Date': 'TOTAL LIABILITY SUMMARY',
      'Ref/Receipt': '',
      'Type': `Net Vat: UGX ${netVat.toLocaleString()}`,
      'Net Amount (UGX)': `Output: UGX ${outputVat.toLocaleString()}`,
      'VAT (18% UGX)': `Input: UGX ${inputVat.toLocaleString()}`
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "VAT Ledger");
    XLSX.writeFile(wb, `VAT_Compliance_Report.xlsx`);
    toast.success("VAT Compliance Excel report exported!");
  };

  const handleExportPaye = () => {
    const data = filteredPayroll.map(p => {
      const staff = staffList.find(s => s.id === p.staffId || s.id === p.staff_id || s.employeeId === p.staffId);
      return {
        'Staff ID': staff?.employeeId || p.staffId || 'N/A',
        'Staff Name': staff?.full_name || p.staff_name || 'System Staff',
        'Employment Type': staff?.employmentType || 'Full-Time',
        'TIN Number': staff?.tin || 'N/A',
        'Month': p.month,
        'Base Gross Pay (UGX)': p.base_salary || p.gross_salary || 0,
        'PAYE Deducted (UGX)': p.paye || 0
      };
    });

    data.push({
      'Staff ID': 'TOTAL PAYE WITHHOLDINGS',
      'Staff Name': '',
      'Employment Type': '',
      'TIN Number': '',
      'Month': '',
      'Base Gross Pay (UGX)': 0,
      'PAYE Deducted (UGX)': totalPaye
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PAYE Register");
    XLSX.writeFile(wb, `PAYE_Withholdings_Register.xlsx`);
    toast.success("PAYE Compliance Excel report exported!");
  };

  const handleExportNssf = () => {
    const data = filteredPayroll.map(p => {
      const staff = staffList.find(s => s.id === p.staffId || s.id === p.staff_id || s.employeeId === p.staffId);
      return {
        'Staff ID': staff?.employeeId || p.staffId || 'N/A',
        'Staff Name': staff?.full_name || p.staff_name || 'System Staff',
        'Employment Type': staff?.employmentType || 'Full-Time',
        'Month': p.month,
        'Base Gross Pay (UGX)': p.base_salary || p.gross_salary || 0,
        'Employee Contribution (5% UGX)': p.nssf_employee || 0,
        'Employer Contribution (10% UGX)': p.nssf_employer || 0,
        'Total (15% UGX)': (p.nssf_employee || 0) + (p.nssf_employer || 0)
      };
    });

    data.push({
      'Staff ID': 'TOTAL CONTRIBUTIONS',
      'Staff Name': '',
      'Employment Type': '',
      'Month': '',
      'Base Gross Pay (UGX)': 0,
      'Employee Contribution (5% UGX)': filteredPayroll.reduce((acc, curr) => acc + (curr.nssf_employee || 0), 0),
      'Employer Contribution (10% UGX)': filteredPayroll.reduce((acc, curr) => acc + (curr.nssf_employer || 0), 0),
      'Total (15% UGX)': totalNssf
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NSSF Register");
    XLSX.writeFile(wb, `NSSF_Contributions_Register.xlsx`);
    toast.success("NSSF Compliance Excel report exported!");
  };

  return (
    <div className="space-y-6">
      {/* Active Tax Engine Banner */}
      <div className="bg-zinc-100/50 border border-zinc-200/60 p-5 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "h-10 w-10 rounded-2xl flex items-center justify-center border transition-colors",
            settings?.process_tax_deductibles !== false 
              ? "bg-emerald-50 text-emerald-600 border-emerald-100" 
              : "bg-red-50 text-red-650 border-red-100"
          )}>
            <Receipt size={20} />
          </div>
          <div>
            <h4 className="text-xs font-black text-zinc-900 uppercase tracking-wider">System-Wide Tax Processing Engine</h4>
            <p className="text-[11px] text-zinc-500 font-medium">
              {settings?.process_tax_deductibles !== false 
                ? "ACTIVE — Automatic progressive PAYE & NSSF calculations are enforced on salary baselines." 
                : "INACTIVE — Salary baselines will generate basic Gross remuneration payouts with zero statutory deductions."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Tax Deductibles Engine</span>
          <button
            onClick={async () => {
              if (!profile?.tenantId || !settings) {
                toast.error("Settings profile not loaded yet. Try again shortly.");
                return;
              }
              const nextVal = settings.process_tax_deductibles === false ? true : false;
              await updateDoc(doc(db, 'system_settings', settings.id), {
                process_tax_deductibles: nextVal
              });
              setSettings({ ...settings, process_tax_deductibles: nextVal });
              toast.success(`Tax Deductibles processing switched ${nextVal ? 'ON' : 'OFF'}`);
            }}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              settings?.process_tax_deductibles !== false ? "bg-emerald-600" : "bg-zinc-300"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                settings?.process_tax_deductibles !== false ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        </div>
      </div>

      {/* Date Auditor Filter Bar */}
      <div className="bg-zinc-50 border border-zinc-200 p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div>
          <h4 className="font-extrabold text-zinc-950 text-sm">Tax Engine Ledger Auditor</h4>
          <p className="text-[10px] text-zinc-500 font-medium font-bold">Defaults to Today's tax entries to prevent data pollution across financial years.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-700 cursor-pointer">
            <input 
              type="checkbox" 
              checked={isDateFilterActive} 
              onChange={(e) => setIsDateFilterActive(e.target.checked)}
              className="rounded bg-white border-zinc-300 text-zinc-900 focus:ring-0"
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

      {/* Four Statutory Widgets */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-emerald-600 p-6 rounded-3xl text-white shadow-xl shadow-emerald-650/10">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Net VAT Liability</p>
          <h3 className="text-2xl font-black font-mono">UGX {netVat.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 opacity-60 italic">Output - Input VAT</p>
        </div>

        <div className="bg-blue-600 p-6 rounded-3xl text-white shadow-xl shadow-blue-650/10">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Total PAYE</p>
          <h3 className="text-2xl font-black font-mono">UGX {totalPaye.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 opacity-60 italic">Employee Tax Deductions</p>
        </div>

        <div className="bg-amber-600 p-6 rounded-3xl text-white shadow-xl shadow-amber-650/10">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Total NSSF</p>
          <h3 className="text-2xl font-black font-mono">UGX {totalNssf.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 opacity-60 italic">15% Joint Contribution</p>
        </div>

        <div className="bg-zinc-900 p-6 rounded-3xl text-white shadow-xl shadow-zinc-900/10">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Total WHT</p>
          <h3 className="text-2xl font-black font-mono">UGX {totalWht.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 opacity-60 italic">Withholding Taxes Claimed</p>
        </div>
      </div>

      {/* Sub-tabs Selection */}
      <div className="flex bg-zinc-100 p-1 rounded-2xl border border-zinc-200 w-fit overflow-x-auto">
        <button
          onClick={() => setActiveTab('vat')}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'vat' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
          )}
        >
          <Receipt size={14} /> VAT Report
        </button>
        <button
          onClick={() => setActiveTab('paye')}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'paye' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
          )}
        >
          <Users size={14} /> PAYE Report
        </button>
        <button
          onClick={() => setActiveTab('nssf')}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'nssf' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
          )}
        >
          <Shield size={14} /> NSSF Report
        </button>
      </div>

      {/* Report Tables Card */}
      <div className="bg-white rounded-[24px] border border-zinc-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-zinc-500 font-bold flex flex-col items-center gap-2">
            <RefreshCw className="animate-spin text-zinc-400" size={24} />
            Recalculating tax audits...
          </div>
        ) : (
          <div className="p-6">
            {activeTab === 'vat' && (
              <div className="space-y-6 animate-in fade-in">
                <div className="flex justify-between items-center border-b border-zinc-150 pb-4">
                  <div>
                    <h4 className="font-extrabold text-zinc-950 text-base">VAT Compliance Audits</h4>
                    <p className="text-xs text-zinc-500">Sales Output VAT minus claimable Purchases Input VAT.</p>
                  </div>
                  <button
                    onClick={handleExportVat}
                    className="flex items-center gap-1 px-4 py-2 bg-zinc-900 hover:bg-zinc-850 text-white rounded-xl text-xs font-bold uppercase tracking-widest"
                  >
                    <Download size={14} /> Export VAT Ledger
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-5 bg-emerald-50 rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-800">Output VAT (Sales)</span>
                    <span className="block text-2xl font-black font-mono text-emerald-600 mt-2">UGX {outputVat.toLocaleString()}</span>
                  </div>
                  <div className="p-5 bg-blue-50 rounded-2xl border border-blue-100">
                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-800">Input VAT (Claimable Purchases)</span>
                    <span className="block text-2xl font-black font-mono text-blue-600 mt-2">UGX {inputVat.toLocaleString()}</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-150 bg-zinc-50/50">
                        <th className="px-6 py-4">Reference ID</th>
                        <th className="px-6 py-4">Date Logged</th>
                        <th className="px-6 py-4 text-center">VAT Class</th>
                        <th className="px-6 py-4 text-right">Taxable Amount</th>
                        <th className="px-6 py-4 text-right">VAT Value (18%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredSales.map((s) => (
                        <tr key={s.id} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="px-6 py-4 font-bold text-zinc-800 text-xs">{s.receiptNumber || s.id}</td>
                          <td className="px-6 py-4 text-xs text-zinc-500">{new Date(s.timestamp || s.date).toLocaleDateString('en-GB')}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 border border-emerald-100">Output (Sales)</span>
                          </td>
                          <td className="px-6 py-4 text-right text-xs text-zinc-600 font-mono">UGX {s.subtotal?.toLocaleString() || s.total?.toLocaleString()}</td>
                          <td className="px-6 py-4 text-right font-black text-xs text-emerald-600 font-mono">UGX {(s.taxAmount || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                      {filteredGrns.filter(g => (g.inputVat || 0) > 0).map((g) => (
                        <tr key={g.id} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="px-6 py-4 font-bold text-zinc-800 text-xs">{g.grn_number || g.id}</td>
                          <td className="px-6 py-4 text-xs text-zinc-500">{new Date(g.receivedAt || g.date).toLocaleDateString('en-GB')}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-blue-50 text-blue-600 border border-blue-100">Input (Purchases)</span>
                          </td>
                          <td className="px-6 py-4 text-right text-xs text-zinc-600 font-mono">UGX {g.total_value_ugx?.toLocaleString()}</td>
                          <td className="px-6 py-4 text-right font-black text-xs text-blue-600 font-mono">UGX {(g.inputVat || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'paye' && (
              <div className="space-y-6 animate-in fade-in">
                <div className="flex justify-between items-center border-b border-zinc-150 pb-4">
                  <div>
                    <h4 className="font-extrabold text-zinc-950 text-base">PAYE Statutory Deductions</h4>
                    <p className="text-xs text-zinc-500">Automatic progressive PAYE withholdings or withholding taxes across consultant levels.</p>
                  </div>
                  <button
                    onClick={handleExportPaye}
                    className="flex items-center gap-1 px-4 py-2 bg-zinc-900 hover:bg-zinc-850 text-white rounded-xl text-xs font-bold uppercase tracking-widest"
                  >
                    <Download size={14} /> Export PAYE Register
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-150 bg-zinc-50/50">
                        <th className="px-6 py-4">Staff Name & ID</th>
                        <th className="px-6 py-4">Employment Type</th>
                        <th className="px-6 py-4">TIN Number</th>
                        <th className="px-6 py-4 text-center">Payroll Period</th>
                        <th className="px-6 py-4 text-right">Gross Earnings</th>
                        <th className="px-6 py-4 text-right font-bold text-zinc-900">PAYE/WHT Deductible</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredPayroll.filter(p => (p.paye || 0) > 0 || p.gross_salary > 0).map((p) => {
                        const staff = staffList.find(s => s.id === p.staffId || s.id === p.staff_id || s.employeeId === p.staffId);
                        const empType = staff?.employmentType || 'Full-Time';
                        return (
                          <tr key={p.id} className="hover:bg-zinc-50/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-bold text-zinc-800 text-xs">{staff?.full_name || p.staff_name}</div>
                              <div className="text-[9px] font-mono text-zinc-400 mt-0.5">ID: {staff?.employeeId || p.staffId}</div>
                            </td>
                            <td className="px-6 py-4 text-xs">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider",
                                empType === 'Full-Time' ? "bg-zinc-100 text-zinc-800" :
                                empType === 'Part-Time' ? "bg-zinc-50 text-zinc-650" :
                                empType === 'Independent Contractor / Self-Employed' ? "bg-amber-50 text-amber-700 border border-amber-100" :
                                "bg-indigo-50 text-indigo-700 border border-indigo-100"
                              )}>
                                {empType}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-xs font-mono text-zinc-600">
                              {staff?.tin || 'N/A'}
                            </td>
                            <td className="px-6 py-4 text-center text-xs text-zinc-500">
                              {p.month}
                            </td>
                            <td className="px-6 py-4 text-right font-semibold text-xs text-zinc-600 font-mono">
                              UGX {(p.base_salary || p.gross_salary || 0).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 text-right font-black text-xs text-blue-600 font-mono">
                              UGX {(p.paye || 0).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredPayroll.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">No PAYE/withholding records generated for selected period.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'nssf' && (
              <div className="space-y-6 animate-in fade-in">
                <div className="flex justify-between items-center border-b border-zinc-150 pb-4">
                  <div>
                    <h4 className="font-extrabold text-zinc-950 text-base">NSSF Contributions Audit (15% Joint)</h4>
                    <p className="text-xs text-zinc-500 font-medium">Monthly 5% employee deductibles plus 10% employer statutory matches.</p>
                  </div>
                  <button
                    onClick={handleExportNssf}
                    className="flex items-center gap-1 px-4 py-2 bg-zinc-900 hover:bg-zinc-850 text-white rounded-xl text-xs font-bold uppercase tracking-widest"
                  >
                    <Download size={14} /> Export NSSF Register
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-150 bg-zinc-50/50">
                        <th className="px-6 py-4">Staff Name & ID</th>
                        <th className="px-6 py-4">Employment Type</th>
                        <th className="px-6 py-4 text-center">Payroll Period</th>
                        <th className="px-6 py-4 text-right">Base Salary</th>
                        <th className="px-6 py-4 text-right">Employee (5%)</th>
                        <th className="px-6 py-4 text-right">Employer (10%)</th>
                        <th className="px-6 py-4 text-right font-bold text-zinc-900">Total Joint (15%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredPayroll.filter(p => (p.nssf_employee || 0) > 0).map((p) => {
                        const staff = staffList.find(s => s.id === p.staffId || s.id === p.staff_id || s.employeeId === p.staffId);
                        const empType = staff?.employmentType || 'Full-Time';
                        const matchTotal = (p.nssf_employee || 0) + (p.nssf_employer || 0);
                        return (
                          <tr key={p.id} className="hover:bg-zinc-50/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-bold text-zinc-800 text-xs">{staff?.full_name || p.staff_name}</div>
                              <div className="text-[9px] font-mono text-zinc-400 mt-0.5">ID: {staff?.employeeId || p.staffId}</div>
                            </td>
                            <td className="px-6 py-4 text-xs">
                              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-zinc-50 text-zinc-600 border border-zinc-200">
                                {empType}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center text-xs text-zinc-500">
                              {p.month}
                            </td>
                            <td className="px-6 py-4 text-right text-xs font-semibold text-zinc-650 font-mono">
                              UGX {(p.base_salary || p.gross_salary || 0).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 text-right text-xs font-semibold text-zinc-650 font-mono">
                              UGX {(p.nssf_employee || 0).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 text-right text-xs font-semibold text-zinc-650 font-mono">
                              UGX {(p.nssf_employer || 0).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 text-right font-black text-xs text-amber-600 font-mono">
                              UGX {matchTotal.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredPayroll.filter(p => (p.nssf_employee || 0) > 0).length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-zinc-400 italic">No NSSF joint contributions found. Note: Consultants & Contractors are non-NSSF.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
