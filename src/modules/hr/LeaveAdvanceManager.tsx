import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Calendar, 
  DollarSign, 
  FileText,
  User,
  Building2,
  ChevronRight,
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { LeaveRequest, AdvanceRequest, Staff } from '../../types';
import { toast } from 'sonner';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const LeaveAdvanceManager: React.FC = () => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'leave' | 'advance'>('leave');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [advanceRequests, setAdvanceRequests] = useState<AdvanceRequest[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);

  const simulatedRole = (profile?.role as any) || 'HR Manager';

  const userRole = simulatedRole.toLowerCase();
  const isHR = ['hr head', 'hr support personnel', 'owner', 'admin', 'hr', 'hr manager', 'owner / admin'].includes(userRole);
  const isCEO = ['ceo', 'ceo / md', 'owner', 'admin', 'managing director', 'md', 'owner / admin'].includes(userRole);

  // Date Range Ledger Filter (default shows Today's requests unless adjusted)
  const [isDateFilterActive, setIsDateFilterActive] = useState(false);
  const [dateRange, setDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubLeave = firestoreService.subscribeToCollection<LeaveRequest>('leave_requests', profile.tenantId, setLeaveRequests);
      const unsubAdvance = firestoreService.subscribeToCollection<AdvanceRequest>('advance_requests', profile.tenantId, setAdvanceRequests);
      const unsubStaff = firestoreService.subscribeToCollection<Staff>('staff', profile.tenantId, setStaff);

      return () => {
        unsubLeave();
        unsubAdvance();
        unsubStaff();
      };
    }
  }, [profile?.tenantId]);

  const filteredLeave = leaveRequests.filter(req => {
    const matchesStatus = statusFilter === 'All' || req.status === statusFilter;
    if (!isDateFilterActive) return matchesStatus;
    const reqDate = (req.startDate || req.start_date || req.created_at || '').split('T')[0];
    return matchesStatus && reqDate >= dateRange.start && reqDate <= dateRange.end;
  });

  const filteredAdvance = advanceRequests.filter(req => {
    const matchesStatus = statusFilter === 'All' || req.status === statusFilter;
    if (!isDateFilterActive) return matchesStatus;
    const reqDate = (req.created_at || req.date_requested || '').split('T')[0];
    return matchesStatus && reqDate >= dateRange.start && reqDate <= dateRange.end;
  });

  return (
    <div className="space-y-6">
      {/* DATE FILTER BAR */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-6">
        <div className="space-y-1">
          <span className="text-[9px] font-black text-indigo-400 bg-indigo-950 px-2.5 py-1 rounded uppercase tracking-wider">
            PharmHelm HR & Leave System
          </span>
          <h3 className="text-sm font-bold text-slate-100">Leave & Cash Advance Ledger</h3>
          <p className="text-[10px] text-slate-400">View and manage requests for active tenant staff.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-xs font-bold">
            Active Role: {simulatedRole}
          </div>

          <div className="h-8 w-px bg-slate-800 hidden md:block"></div>

          {/* Date range controls */}
          <div className="flex items-center gap-2 bg-slate-800/50 p-1.5 rounded-xl border border-slate-700">
            <label className="flex items-center gap-1.5 text-[10px] uppercase font-black text-slate-400 px-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={isDateFilterActive} 
                onChange={(e) => setIsDateFilterActive(e.target.checked)}
                className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0"
              />
              Filter Date
            </label>
            {isDateFilterActive && (
              <div className="flex items-center gap-1.5">
                <input 
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                  className="bg-slate-900 border border-slate-700 text-[10px] font-bold text-white px-2 py-1 rounded outline-none"
                />
                <span className="text-zinc-500 text-[9px]">-</span>
                <input 
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                  className="bg-slate-900 border border-slate-700 text-[10px] font-bold text-white px-2 py-1 rounded outline-none"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 w-fit">
          <button 
            onClick={() => setActiveTab('leave')}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2",
              activeTab === 'leave' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Calendar size={18} />
            Leave Requests
          </button>
          <button 
            onClick={() => setActiveTab('advance')}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2",
              activeTab === 'advance' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <DollarSign size={18} />
            Salary Advances
          </button>
        </div>

        <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200">
          {(['All', 'Pending', 'Approved', 'Rejected'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                statusFilter === status 
                  ? "bg-slate-900 text-white shadow-md" 
                  : "text-slate-500 hover:bg-slate-50"
              )}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {activeTab === 'leave' ? (
          <LeaveRequestsTable 
            requests={filteredLeave} 
            isHR={isHR} 
            isCEO={isCEO} 
          />
        ) : (
          <AdvanceRequestsTable 
            requests={filteredAdvance} 
            isHR={isHR} 
            isCEO={isCEO} 
          />
        )}
      </div>
    </div>
  );
};

const LeaveRequestsTable: React.FC<{ 
  requests: LeaveRequest[], 
  isHR: boolean, 
  isCEO: boolean 
}> = ({ requests, isHR, isCEO }) => {
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100 bg-slate-50/50">
              <th className="px-6 py-4">Staff Member</th>
              <th className="px-6 py-4">Type</th>
              <th className="px-6 py-4">Dates</th>
              <th className="px-6 py-4">Days</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((req) => (
              <tr key={req.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600">
                      <User size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{req.staff_name}</p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">ID: {req.staff_id.slice(-6)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-[10px] font-bold uppercase tracking-wider">
                    {req.leave_type}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {(() => {
                    const sStr = req.startDate || req.start_date || '';
                    const eStr = req.endDate || req.end_date || '';
                    const sDate = sStr ? new Date(sStr) : null;
                    const eDate = eStr ? new Date(eStr) : null;
                    const fStart = sDate && !isNaN(sDate.getTime()) ? sDate.toLocaleDateString() : 'N/A';
                    const fEnd = eDate && !isNaN(eDate.getTime()) ? eDate.toLocaleDateString() : 'N/A';
                    return `${fStart} - ${fEnd}`;
                  })()}
                </td>
                <td className="px-6 py-4 text-sm font-bold text-slate-900">{req.total_days}</td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-1">
                    <StatusBadge status={req.status} />
                    <div className="flex gap-1 mt-1">
                      <ApprovalMiniBadge label="HR" status={req.hr_approval_status} />
                      <ApprovalMiniBadge label="CEO" status={req.ceo_approval_status} />
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <button 
                    onClick={() => setSelectedRequest(req)}
                    className="text-indigo-600 hover:text-indigo-700 font-bold text-sm flex items-center gap-1 ml-auto"
                  >
                    Review <ChevronRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">
                  No leave requests found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedRequest && (
        <ReviewLeaveModal 
          request={selectedRequest} 
          onClose={() => setSelectedRequest(null)} 
          isHR={isHR} 
          isCEO={isCEO} 
        />
      )}
    </div>
  );
};

const AdvanceRequestsTable: React.FC<{ 
  requests: AdvanceRequest[], 
  isHR: boolean, 
  isCEO: boolean 
}> = ({ requests, isHR, isCEO }) => {
  const [selectedRequest, setSelectedRequest] = useState<AdvanceRequest | null>(null);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100 bg-slate-50/50">
              <th className="px-6 py-4">Staff Member</th>
              <th className="px-6 py-4">Amount</th>
              <th className="px-6 py-4">Period</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((req) => (
              <tr key={req.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600">
                      <DollarSign size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{req.staff_name}</p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">ID: {req.staff_id.slice(-6)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 font-bold text-slate-900">
                  UGX {(req.amount_requested || 0).toLocaleString()}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">{req.repayment_period_months} Months</td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-1">
                    <StatusBadge status={req.status} />
                    <div className="flex gap-1 mt-1">
                      <ApprovalMiniBadge label="HR" status={req.hr_approval_status} />
                      <ApprovalMiniBadge label="CEO" status={req.ceo_approval_status} />
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <button 
                    onClick={() => setSelectedRequest(req)}
                    className="text-indigo-600 hover:text-indigo-700 font-bold text-sm flex items-center gap-1 ml-auto"
                  >
                    Review <ChevronRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                  No advance requests found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedRequest && (
        <ReviewAdvanceModal 
          request={selectedRequest} 
          onClose={() => setSelectedRequest(null)} 
          isHR={isHR} 
          isCEO={isCEO} 
        />
      )}
    </div>
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={cn(
    "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider w-fit",
    status === 'Approved' || status === 'Disbursed' ? "bg-emerald-50 text-emerald-600" : 
    status === 'Rejected' || status === 'Cancelled' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
  )}>
    {status}
  </span>
);

const ApprovalMiniBadge: React.FC<{ label: string, status: string }> = ({ label, status }) => (
  <span className={cn(
    "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border",
    status === 'Approved' ? "bg-emerald-500 text-white border-emerald-600" : 
    status === 'Rejected' ? "bg-red-500 text-white border-red-600" : "bg-slate-100 text-slate-400 border-slate-200"
  )}>
    {label}: {status === 'Approved' ? '✓' : status === 'Rejected' ? '✗' : '?'}
  </span>
);

const ReviewLeaveModal: React.FC<{ 
  request: LeaveRequest, 
  onClose: () => void, 
  isHR: boolean, 
  isCEO: boolean 
}> = ({ request, onClose, isHR, isCEO }) => {
  const [notes, setNotes] = useState('');
  const [reviewCapacity, setReviewCapacity] = useState<'HR' | 'CEO'>(() => {
    if (isHR && isCEO) {
      return request.hr_approval_status !== 'Approved' ? 'HR' : 'CEO';
    }
    return isHR ? 'HR' : 'CEO';
  });

  const handleAction = async (action: 'Approved' | 'Rejected') => {
    const update: any = {};
    if (reviewCapacity === 'HR') {
      update.hr_approval_status = action;
      update.hr_notes = notes;
    } else {
      update.ceo_approval_status = action;
      update.ceo_notes = notes;
    }

    // Final status logic
    if (action === 'Rejected') {
      update.status = 'Rejected';
    } else {
      const hrStatus = reviewCapacity === 'HR' ? 'Approved' : (request.hr_approval_status || 'Pending');
      const ceoStatus = reviewCapacity === 'CEO' ? 'Approved' : (request.ceo_approval_status || 'Pending');
      if (hrStatus === 'Approved' && ceoStatus === 'Approved') {
        update.status = 'Approved';
      } else {
        update.status = 'Pending';
      }
    }

    try {
      await firestoreService.updateDocument('leave_requests', request.id, update);
      toast.success(`Request ${action.toLowerCase()} as ${reviewCapacity}`);
      onClose();
    } catch (error) {
      toast.error('Failed to update request');
    }
  };

  const handleApproveBoth = async () => {
    const update: any = {
      hr_approval_status: 'Approved',
      hr_notes: notes || 'Approved as HR',
      ceo_approval_status: 'Approved',
      ceo_notes: notes || 'Approved as CEO / MD',
      status: 'Approved'
    };

    try {
      await firestoreService.updateDocument('leave_requests', request.id, update);
      toast.success('Approved both levels successfully');
      onClose();
    } catch (error) {
      toast.error('Failed to update request');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[32px] w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Review Leave Request</h2>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Staff Member</p>
                <p className="font-bold text-slate-900">{request.staff_name}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Leave Type</p>
                <p className="font-bold text-slate-900">{request.leave_type}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Duration</p>
                <p className="font-bold text-slate-900">{request.total_days} Days</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Dates</p>
                <p className="text-sm text-slate-600">
                  {(() => {
                    const sStr = request.startDate || request.start_date || '';
                    const eStr = request.endDate || request.end_date || '';
                    const sDate = sStr ? new Date(sStr) : null;
                    const eDate = eStr ? new Date(eStr) : null;
                    const fStart = sDate && !isNaN(sDate.getTime()) ? sDate.toLocaleDateString() : 'N/A';
                    const fEnd = eDate && !isNaN(eDate.getTime()) ? eDate.toLocaleDateString() : 'N/A';
                    return `${fStart} - ${fEnd}`;
                  })()}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Reason</p>
              <p className="text-slate-700 text-sm whitespace-pre-wrap">{request.reason}</p>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-1">Approval Status</h4>
              <div className="flex gap-4">
                <div className="flex-1 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200/50 pb-1 mb-1">HR Approval</p>
                  <p className="font-bold text-sm">{request.hr_approval_status || 'Pending'}</p>
                  {request.hr_notes && <p className="text-[10px] text-slate-500 mt-1 italic">"{request.hr_notes}"</p>}
                </div>
                <div className="flex-1 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200/50 pb-1 mb-1">CEO Approval</p>
                  <p className="font-bold text-sm">{request.ceo_approval_status || 'Pending'}</p>
                  {request.ceo_notes && <p className="text-[10px] text-slate-500 mt-1 italic">"{request.ceo_notes}"</p>}
                </div>
              </div>
            </div>

            {request.status !== 'Pending' ? (
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-center gap-2.5 text-amber-800 text-xs font-semibold">
                <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                <div>
                  <p className="font-extrabold uppercase text-[10px] tracking-wider">Locked Status: {request.status}</p>
                  <p className="text-[11px] text-amber-700/80">This leave request has been processed and is locked for auditing integrity.</p>
                </div>
              </div>
            ) : (isHR || isCEO) && (
              <div className="space-y-4 pt-4 border-t border-slate-100">
                {isHR && isCEO && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Review Role/Capacity</label>
                    <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 w-full">
                      <button
                        type="button"
                        onClick={() => setReviewCapacity('HR')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          reviewCapacity === 'HR' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Review as HR Head
                      </button>
                      <button
                        type="button"
                        onClick={() => setReviewCapacity('CEO')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          reviewCapacity === 'CEO' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Review as CEO / MD
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">
                    Your Review Notes {isHR && isCEO ? `(As ${reviewCapacity === 'HR' ? 'HR Head' : 'CEO / MD'})` : ''}
                  </label>
                  <textarea 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none min-h-[80px]"
                    placeholder="Add your comments here..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex gap-3">
                    <button 
                      onClick={() => handleAction('Rejected')}
                      className="flex-1 py-3 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                    >
                      <XCircle size={18} /> Reject
                    </button>
                    <button 
                      onClick={() => handleAction('Approved')}
                      className="flex-1 py-3 bg-emerald-500 text-white rounded-2xl font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 size={18} /> Approve
                    </button>
                  </div>

                  {isHR && isCEO && (
                    <button 
                      onClick={handleApproveBoth}
                      className="w-full py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 border border-indigo-550"
                    >
                      <CheckCircle2 size={18} /> Approve Both (HR & CEO)
                    </button>
                  )}
                </div>
              </div>
            )}

            <button onClick={onClose} className="w-full py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-2xl transition-all">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ReviewAdvanceModal: React.FC<{ 
  request: AdvanceRequest, 
  onClose: () => void, 
  isHR: boolean, 
  isCEO: boolean 
}> = ({ request, onClose, isHR, isCEO }) => {
  const [notes, setNotes] = useState('');
  const [reviewCapacity, setReviewCapacity] = useState<'HR' | 'CEO'>(() => {
    if (isHR && isCEO) {
      return request.hr_approval_status !== 'Approved' ? 'HR' : 'CEO';
    }
    return isHR ? 'HR' : 'CEO';
  });

  const handleAction = async (action: 'Approved' | 'Rejected') => {
    const update: any = {};
    if (reviewCapacity === 'HR') {
      update.hr_approval_status = action;
      update.hr_notes = notes;
    } else {
      update.ceo_approval_status = action;
      update.ceo_notes = notes;
    }

    // Final status logic
    if (action === 'Rejected') {
      update.status = 'Rejected';
    } else {
      const hrStatus = reviewCapacity === 'HR' ? 'Approved' : (request.hr_approval_status || 'Pending');
      const ceoStatus = reviewCapacity === 'CEO' ? 'Approved' : (request.ceo_approval_status || 'Pending');
      if (hrStatus === 'Approved' && ceoStatus === 'Approved') {
        update.status = 'Approved';
      } else {
        update.status = 'Pending';
      }
    }

    try {
      await firestoreService.updateDocument('advance_requests', request.id, update);
      if (update.status === 'Approved') {
        await firestoreService.addDocument('management_expenses', {
          tenantId: request.tenantId || '',
          category: 'Salaries - Advance Request',
          department: 'HR',
          description: `Salary Advance Request: ${request.staff_name} (ID: ${request.staff_id?.slice(-6)})`,
          amount_ugx: parseFloat(request.amount_requested as any) || 0,
          expense_date: new Date().toISOString().split('T')[0],
          payment_method: 'Petty Cash',
          status: 'Pending',
          logged_by: 'HR System - Advance',
          created_at: new Date().toISOString()
        });
        toast.success(`Advance fully approved & sent to Finance Management Expenses!`);
      } else {
        toast.success(`Request ${action.toLowerCase()} as ${reviewCapacity}`);
      }
      onClose();
    } catch (error) {
      toast.error('Failed to update request');
    }
  };

  const handleApproveBoth = async () => {
    const update: any = {
      hr_approval_status: 'Approved',
      hr_notes: notes || 'Approved as HR',
      ceo_approval_status: 'Approved',
      ceo_notes: notes || 'Approved as CEO / MD',
      status: 'Approved'
    };

    try {
      await firestoreService.updateDocument('advance_requests', request.id, update);
      await firestoreService.addDocument('management_expenses', {
        tenantId: request.tenantId || '',
        category: 'Salaries - Advance Request',
        department: 'HR',
        description: `Salary Advance Request: ${request.staff_name} (ID: ${request.staff_id?.slice(-6)})`,
        amount_ugx: parseFloat(request.amount_requested as any) || 0,
        expense_date: new Date().toISOString().split('T')[0],
        payment_method: 'Petty Cash',
        status: 'Pending',
        logged_by: 'HR System - Advance',
        created_at: new Date().toISOString()
      });
      toast.success('Approved both levels successfully & sent to Finance Management Expenses');
      onClose();
    } catch (error) {
      toast.error('Failed to update request');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[32px] w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Review Advance Request</h2>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Staff Member</p>
                <p className="font-bold text-slate-900">{request.staff_name}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Amount</p>
                <p className="font-bold text-emerald-600">UGX {(request.amount_requested || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Repayment Period</p>
                <p className="font-bold text-slate-900">{request.repayment_period_months} Months</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date Requested</p>
                <p className="text-sm text-slate-600">{new Date(request.created_at).toLocaleDateString()}</p>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Reason</p>
              <p className="text-slate-700 text-sm whitespace-pre-wrap">{request.reason}</p>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-1">Approval Status</h4>
              <div className="flex gap-4">
                <div className="flex-1 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200/50 pb-1 mb-1">HR Approval</p>
                  <p className="font-bold text-sm">{request.hr_approval_status || 'Pending'}</p>
                  {request.hr_notes && <p className="text-[10px] text-slate-500 mt-1 italic">"{request.hr_notes}"</p>}
                </div>
                <div className="flex-1 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200/50 pb-1 mb-1">CEO Approval</p>
                  <p className="font-bold text-sm">{request.ceo_approval_status || 'Pending'}</p>
                  {request.ceo_notes && <p className="text-[10px] text-slate-500 mt-1 italic">"{request.ceo_notes}"</p>}
                </div>
              </div>
            </div>

            {request.status !== 'Pending' ? (
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-center gap-2.5 text-amber-800 text-xs font-semibold">
                <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                <div>
                  <p className="font-extrabold uppercase text-[10px] tracking-wider">Locked Status: {request.status}</p>
                  <p className="text-[11px] text-amber-700/80">This advance request has been processed and is locked for auditing integrity.</p>
                </div>
              </div>
            ) : (isHR || isCEO) && (
              <div className="space-y-4 pt-4 border-t border-slate-100">
                {isHR && isCEO && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Review Role/Capacity</label>
                    <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 w-full">
                      <button
                        type="button"
                        onClick={() => setReviewCapacity('HR')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          reviewCapacity === 'HR' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Review as HR Head
                      </button>
                      <button
                        type="button"
                        onClick={() => setReviewCapacity('CEO')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          reviewCapacity === 'CEO' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Review as CEO / MD
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">
                    Your Review Notes {isHR && isCEO ? `(As ${reviewCapacity === 'HR' ? 'HR Head' : 'CEO / MD'})` : ''}
                  </label>
                  <textarea 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none min-h-[100px]"
                    placeholder="Add your comments here..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex gap-3">
                    <button 
                      onClick={() => handleAction('Rejected')}
                      className="flex-1 py-3 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                    >
                      <XCircle size={18} /> Reject
                    </button>
                    <button 
                      onClick={() => handleAction('Approved')}
                      className="flex-1 py-3 bg-emerald-500 text-white rounded-2xl font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 size={18} /> Approve
                    </button>
                  </div>

                  {isHR && isCEO && (
                    <button 
                      onClick={handleApproveBoth}
                      className="w-full py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 border border-indigo-550"
                    >
                      <CheckCircle2 size={18} /> Approve Both (HR & CEO)
                    </button>
                  )}
                </div>
              </div>
            )}

            <button onClick={onClose} className="w-full py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-2xl transition-all">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
};
