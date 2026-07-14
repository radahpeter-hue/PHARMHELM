import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Download, 
  Calendar, 
  Eye, 
  ArrowDownToLine,
  Search,
  X,
  User,
  ShieldCheck,
  TrendingDown
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { Payslip } from '../../types';
import { format } from 'date-fns';

const PayslipTab: React.FC = () => {
  const { profile } = useAuth();
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPayslip, setSelectedPayslip] = useState<any | null>(null);

  useEffect(() => {
    if (profile?.uid && profile?.tenantId) {
      const unsubscribe = firestoreService.subscribeToCollection<Payslip>(
        'payslips',
        profile.tenantId,
        (data) => {
          const userPayslips = data.filter(p => p.staffId === profile.uid);
          setPayslips(userPayslips.sort((a, b) => b.month.localeCompare(a.month)));
        }
      );
      return () => unsubscribe();
    }
  }, [profile?.uid, profile?.tenantId]);

  const filteredPayslips = payslips.filter(p => 
    p.month.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDownload = (payslip: any) => {
    if (payslip.pdfUrl) {
      window.open(payslip.pdfUrl, '_blank');
    } else {
      // Professional download payload representing official payslip
      const textContent = `
========================================
       OFFICIAL SALARY PAYSLIP
========================================
Month/Period: ${payslip.month}
Employee Name: ${profile?.displayName || 'Staff Member'}
Employee ID: ${payslip.staffId?.slice(0, 8) || 'N/A'}
----------------------------------------
Earnings Breakdown:
- Gross Base Salary: UGX ${payslip.basePay?.toLocaleString() || 'N/A'}
- Allowances/Bonuses: UGX ${(payslip.allowances || 0).toLocaleString()} ${payslip.allowancesNotes ? `(${payslip.allowancesNotes})` : ''}

Deductions Breakdown:
- Salary Advance Repayments: UGX ${(payslip.advanceDeduction || 0).toLocaleString()}
- Traffic Fines/Penalties: UGX ${(payslip.fineDeduction || 0).toLocaleString()}
- NSSF Pension Employee (5%): UGX ${(payslip.nssfEmployee || 0).toLocaleString()}
- PAYE Progressive Income Tax: UGX ${(payslip.paye || 0).toLocaleString()}
- Unpaid Leave Days Deducts: UGX ${(payslip.unpaidLeaveDeduction || 0).toLocaleString()}
- Total Combined Deductions: UGX ${payslip.deductions?.toLocaleString() || 'N/A'}

----------------------------------------
NET PAYABLE REMITTANCE: UGX ${payslip.netPayable?.toLocaleString() || 'N/A'}
----------------------------------------
Leaves Record In Cycle:
- Approved Leave: ${payslip.approvedLeavesDesc || 'None'}
- Rejected Leave: ${payslip.rejectedLeavesDesc || 'None'}

Advances History Checked:
- ${payslip.advancesDesc || 'None'}

Please contact Human Resources for any inquiries regarding this remittance statement.
Ref: TRANS-${payslip.id || 'EVAL'}
========================================
`;
      const blob = new Blob([textContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip_${payslip.month}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search & Filter */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-[24px] border border-zinc-200 shadow-sm">
        <div className="relative flex-1 max-w-md">
          <input 
            type="text" 
            placeholder="Search by month (YYYY-MM)..." 
            className="w-full pl-12 pr-4 py-3 bg-zinc-50 border border-zinc-100 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-zinc-50 rounded-xl border border-zinc-100">
          <Calendar size={14} className="text-zinc-400" />
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Welfare System</span>
        </div>
      </div>

      {/* Payslips Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPayslips.length === 0 ? (
          <div className="col-span-full py-20 text-center bg-white rounded-[32px] border border-dashed border-zinc-300">
            <FileText size={48} className="mx-auto text-zinc-200 mb-4" />
            <p className="text-zinc-400 font-medium text-xs">No payslips available for your profile yet.</p>
          </div>
        ) : (
          filteredPayslips.map((payslip) => (
            <div key={payslip.id} className="group bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm hover:shadow-xl hover:shadow-zinc-900/5 transition-all duration-300 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <FileText size={80} />
              </div>
              
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-6">
                  <div className="p-3 bg-zinc-900 text-white rounded-2xl">
                    <Calendar size={20} />
                  </div>
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">
                    {format(new Date(payslip.month + '-01'), 'MMMM yyyy')}
                  </span>
                </div>

                <div className="space-y-4 mb-8">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Net Payable</p>
                      <h3 className="text-2xl font-black text-zinc-900">UGX {payslip.netPayable.toLocaleString()}</h3>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-100">
                    <div>
                      <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest mb-0.5">Base Pay</p>
                      <p className="text-xs font-bold text-zinc-700">UGX {payslip.basePay.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest mb-0.5">Deductions</p>
                      <p className="text-xs font-bold text-red-650">-UGX {payslip.deductions.toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={() => handleDownload(payslip)}
                    className="flex-1 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-zinc-900/20 cursor-pointer"
                  >
                    <ArrowDownToLine size={16} />
                    Download
                  </button>
                  <button 
                    onClick={() => setSelectedPayslip(payslip)}
                    className="p-3 bg-zinc-150 hover:bg-zinc-200 text-zinc-700 rounded-2xl transition-all cursor-pointer"
                    title="View Details"
                  >
                    <Eye size={20} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Detailed Corporate Payslip Modal Overlay */}
      {selectedPayslip && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-2xl rounded-[32px] border border-zinc-200 shadow-2xl p-6 md:p-8 space-y-6 relative max-h-[90vh] overflow-y-auto">
            {/* Modal Closer */}
            <button 
              onClick={() => setSelectedPayslip(null)}
              className="absolute top-6 right-6 p-2 text-zinc-400 hover:text-zinc-600 rounded-full bg-zinc-100 hover:bg-zinc-200 transition-colors"
            >
              <X size={18} />
            </button>

            {/* Logo/Corporate Title info */}
            <div className="flex items-center gap-3 border-b border-zinc-100 pb-5">
              <div className="p-3.5 bg-zinc-900 text-white rounded-2xl">
                <FileText size={24} />
              </div>
              <div>
                <h2 className="text-lg font-black text-zinc-900 uppercase tracking-wide">Remittance Advice Details</h2>
                <p className="text-xs text-zinc-400">Official Payslip Record • {format(new Date(selectedPayslip.month + '-01'), 'MMMM yyyy')}</p>
              </div>
            </div>

            {/* Personal credentials strip */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-zinc-50 p-4 rounded-2xl border border-zinc-100 text-xs">
              <div className="space-y-1.5">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-extrabold block">Employee profile</span>
                <div className="flex items-center gap-2 text-zinc-800">
                  <User size={14} className="text-zinc-400" />
                  <span className="font-extrabold">{profile?.displayName || 'Staff Member'}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-extrabold block">Reference Transaction ID</span>
                <div className="flex items-center gap-2 text-zinc-800 font-mono">
                  <ShieldCheck size={14} className="text-zinc-400" />
                  <span>TRANS-{selectedPayslip.id?.slice(0, 8).toUpperCase() || 'EVAL'}</span>
                </div>
              </div>
            </div>

            {/* Income breakdown vs Deductions breakdown grids */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Earnings Column */}
              <div className="space-y-4">
                <div className="border-b border-zinc-100 pb-1.5">
                  <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">Gross Earnings Break-down</h4>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-zinc-50">
                    <span className="text-zinc-500">Gross Base Remuneration</span>
                    <span className="font-bold text-zinc-900">UGX {selectedPayslip.basePay?.toLocaleString() || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-50">
                    <span className="text-zinc-500">Allowances / Performance bonuses</span>
                    <span className="font-bold text-emerald-600">+UGX {(selectedPayslip.allowances || 0).toLocaleString()}</span>
                  </div>
                  {selectedPayslip.allowancesNotes && (
                    <div className="p-2 bg-emerald-50 text-[10px] text-emerald-800 rounded-lg">
                      <strong>Note:</strong> {selectedPayslip.allowancesNotes}
                    </div>
                  )}
                  <div className="flex justify-between pt-2 text-sm font-black border-t border-zinc-100">
                    <span className="text-zinc-800">Total Gross</span>
                    <span className="text-zinc-900">UGX {((selectedPayslip.basePay || 0) + (selectedPayslip.allowances || 0)).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Deductions Column */}
              <div className="space-y-4">
                <div className="border-b border-zinc-100 pb-1.5">
                  <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">Statutory & Other Deductions</h4>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-zinc-50">
                    <span className="text-zinc-500">PAYE progressive tax</span>
                    <span className="font-bold text-zinc-700">UGX {(selectedPayslip.paye || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-50">
                    <span className="text-zinc-500">NSSF pension (5%)</span>
                    <span className="font-bold text-zinc-700">UGX {(selectedPayslip.nssfEmployee || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-50">
                    <span className="text-zinc-500">Salary Advances repayment</span>
                    <span className="font-bold text-rose-500">UGX {(selectedPayslip.advanceDeduction || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-50">
                    <span className="text-zinc-500">Traffic fines deduction</span>
                    <span className="font-bold text-zinc-700">UGX {(selectedPayslip.fineDeduction || 0).toLocaleString()}</span>
                  </div>
                  {selectedPayslip.unpaidLeaveDeduction && selectedPayslip.unpaidLeaveDeduction > 0 ? (
                    <div className="flex justify-between py-1 border-b border-zinc-50 text-rose-600 font-extrabold">
                      <span>Approved Unpaid Leave Deduction</span>
                      <span>UGX {selectedPayslip.unpaidLeaveDeduction.toLocaleString()}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between pt-2 text-sm font-black border-t border-zinc-100 text-rose-600">
                    <span>Total Deducted</span>
                    <span>-UGX {selectedPayslip.deductions?.toLocaleString() || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Leaves & Advances Detailed Period summaries block */}
            <div className="bg-zinc-50 rounded-2xl border border-zinc-100 p-4 space-y-3.5 text-xs">
              <div className="flex items-center gap-1.5 text-[11px] font-black text-indigo-950 uppercase tracking-wide border-b border-zinc-200 pb-1.5">
                <Calendar size={13} className="text-indigo-650" />
                <span>Approved Leaves & Advances Cycle Check</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-extrabold block">Approved Leave Requests</span>
                  <p className="font-bold text-zinc-800 mt-1">{selectedPayslip.approvedLeavesDesc || 'No approved leaves logged in this period'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-extrabold block">Rejected Leave Requests</span>
                  <p className="font-bold text-zinc-800 mt-1">{selectedPayslip.rejectedLeavesDesc || 'No rejected leaves logged in this period'}</p>
                </div>
              </div>
              <div className="pt-2.5 border-t border-zinc-250/50">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-extrabold block">Outstanding Salary Advances Checks</span>
                <p className="font-bold text-zinc-800 mt-1">{selectedPayslip.advancesDesc || 'No salary advance deductions recorded in this month.'}</p>
              </div>
            </div>

            {/* Net Total strip banner */}
            <div className="p-5 rounded-2.5xl bg-zinc-900 text-white flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-black uppercase text-zinc-400 tracking-widest block">Net Disbursed Take-home Pay</span>
                <p className="text-[9px] text-zinc-400">Direct deposit paid reference: {selectedPayslip.paid_date || 'Approved cycle'}</p>
              </div>
              <div className="text-right">
                <h3 className="text-2xl font-black tracking-tight text-white">UGX {selectedPayslip.netPayable?.toLocaleString() || 'N/A'}</h3>
              </div>
            </div>

            {/* Actions: Download / dismiss */}
            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => handleDownload(selectedPayslip)}
                className="flex-1 py-3.5 bg-zinc-950 hover:bg-zinc-850 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-zinc-900/20 cursor-pointer"
              >
                <ArrowDownToLine size={16} />
                Download / Print Document
              </button>
              <button 
                onClick={() => setSelectedPayslip(null)}
                className="px-6 py-3.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-2xl font-extrabold uppercase text-[10px] tracking-widest transition-all cursor-pointer"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayslipTab;
