import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Plus,
  FileText,
  User
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { LeaveRequest, Staff } from '../../types';
import { toast } from 'sonner';
import { format, differenceInDays } from 'date-fns';

const LeaveTab: React.FC = () => {
  const { profile } = useAuth();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    leave_type: 'Annual',
    start_date: '',
    end_date: '',
    reason: '',
    attachment_url: ''
  });

  const parseDateSecurely = (val: any): Date | null => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val.toDate === 'function') {
      return val.toDate();
    }
    if (val.seconds) {
      return new Date(val.seconds * 1000);
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  useEffect(() => {
    if (profile?.uid && profile?.tenantId) {
      // Subscribe to user's own leave requests
      const unsubscribe = firestoreService.subscribeToCollection<LeaveRequest>(
        'leave_requests',
        profile.tenantId,
        (data) => {
          const userRequests = data.filter(r => r.staff_id === profile.uid || r.staffId === profile.uid);
          setRequests(userRequests.sort((a: any, b: any) => {
            const dateA = parseDateSecurely(a.created_at || a.createdAt);
            const dateB = parseDateSecurely(b.created_at || b.createdAt);
            const timeA = dateA ? dateA.getTime() : 0;
            const timeB = dateB ? dateB.getTime() : 0;
            return timeB - timeA;
          }));
        }
      );
      return () => unsubscribe();
    }
  }, [profile?.uid, profile?.tenantId]);

  const calculateDays = () => {
    if (formData.start_date && formData.end_date) {
      const start = parseDateSecurely(formData.start_date);
      const end = parseDateSecurely(formData.end_date);
      if (!start || !end) return 0;
      const days = differenceInDays(end, start) + 1;
      return days > 0 ? days : 0;
    }
    return 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.uid || !profile?.tenantId) return;

    const total_days = calculateDays();
    if (total_days <= 0) {
      toast.error('Invalid date range');
      return;
    }

    try {
      const newRequest: Omit<LeaveRequest, 'id'> = {
        tenantId: profile.tenantId,
        staffId: profile.uid,
        staff_id: profile.uid,
        staff_name: profile.full_name || profile.displayName || 'Unknown',
        leave_type: formData.leave_type as any,
        startDate: formData.start_date,
        endDate: formData.end_date,
        start_date: formData.start_date,
        end_date: formData.end_date,
        total_days,
        reason: formData.reason,
        attachment_url: formData.attachment_url,
        status: 'Pending',
        hr_approval_status: 'Pending',
        ceo_approval_status: 'Pending',
        created_at: new Date().toISOString()
      };

      await firestoreService.addDocument('leave_requests', newRequest);
      toast.success('Leave application submitted');
      setIsModalOpen(false);
      setFormData({ leave_type: 'Annual', start_date: '', end_date: '', reason: '', attachment_url: '' });
    } catch (error) {
      toast.error('Failed to submit application');
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
              <Calendar size={24} />
            </div>
            <div>
              <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Annual Leave</p>
              <h3 className="text-2xl font-black text-zinc-900">{(profile as any)?.annual_leave_balance || 0} Days</h3>
            </div>
          </div>
          <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
            <div 
              className="bg-blue-600 h-full transition-all duration-500" 
              style={{ width: `${Math.min(100, (((profile as any)?.annual_leave_balance || 0) / 30) * 100)}%` }}
            />
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
              <Clock size={24} />
            </div>
            <div>
              <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Sick Leave</p>
              <h3 className="text-2xl font-black text-zinc-900">{(profile as any)?.sick_leave_balance || 0} Days</h3>
            </div>
          </div>
          <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
            <div 
              className="bg-emerald-600 h-full transition-all duration-500" 
              style={{ width: `${Math.min(100, (((profile as any)?.sick_leave_balance || 0) / 14) * 100)}%` }}
            />
          </div>
        </div>

        <div className="bg-zinc-900 p-6 rounded-3xl shadow-xl shadow-zinc-900/20 flex flex-col justify-center">
          <button 
            onClick={() => setIsModalOpen(true)}
            className="w-full py-3 bg-white text-zinc-900 rounded-2xl font-black uppercase text-xs tracking-[0.2em] hover:bg-zinc-100 transition-all flex items-center justify-center gap-2"
          >
            <Plus size={18} />
            Apply for Leave
          </button>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">Leave History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Type & Period</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Days</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Status</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Reviewer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-zinc-400 font-medium">
                    No leave requests found.
                  </td>
                </tr>
              ) : (
                requests.map((request) => (
                  <tr key={request.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-bold text-zinc-900 uppercase text-xs">{request.leave_type} Leave</p>
                        <p className="text-[10px] text-zinc-500">
                          {(() => {
                            const sDate = parseDateSecurely(request.startDate || request.start_date);
                            const eDate = parseDateSecurely(request.endDate || request.end_date);
                            const fStart = sDate ? format(sDate, 'MMM dd') : 'N/A';
                            const fEnd = eDate ? format(eDate, 'MMM dd, yyyy') : 'N/A';
                            return `${fStart} - ${fEnd}`;
                          })()}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-bold text-zinc-900">{request.total_days}</span>
                      <span className="text-[10px] text-zinc-400 ml-1 font-black uppercase">{request.leave_type !== 'Unpaid' ? 'Paid' : 'Unpaid'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {request.status === 'Approved' && <CheckCircle2 size={14} className="text-emerald-500" />}
                        {request.status === 'Rejected' && <XCircle size={14} className="text-red-500" />}
                        {request.status === 'Pending' && <Clock size={14} className="text-amber-500" />}
                        <span className={`text-[10px] font-black uppercase tracking-wider ${
                          request.status === 'Approved' ? 'text-emerald-600' :
                          request.status === 'Rejected' ? 'text-red-600' :
                          'text-amber-600'
                        }`}>
                          {request.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {request.hr_notes || request.ceo_notes ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-zinc-100 rounded-full flex items-center justify-center">
                            <User size={12} className="text-zinc-400" />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-zinc-900">Reviewed</p>
                            <p className="text-[8px] text-zinc-400 uppercase font-black truncate max-w-[100px]">
                              {request.hr_notes || request.ceo_notes}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-zinc-300 font-black uppercase tracking-widest">Awaiting Review</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Application Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">Apply for Leave</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
                <XCircle size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Leave Type</label>
                <select 
                  required 
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                  value={formData.leave_type}
                  onChange={(e) => setFormData({ ...formData, leave_type: e.target.value })}
                >
                  <option value="Annual">Annual Leave</option>
                  <option value="Sick">Sick Leave</option>
                  <option value="Study">Study Leave</option>
                  <option value="Maternity">Maternity Leave</option>
                  <option value="Compassionate">Compassionate Leave</option>
                  <option value="Unpaid">Unpaid Leave</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Start Date</label>
                  <input 
                    required
                    type="date" 
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">End Date</label>
                  <input 
                    required
                    type="date" 
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    value={formData.end_date}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  />
                </div>
              </div>

              {calculateDays() > 0 && (
                <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Total Duration</span>
                  <span className="text-lg font-black text-zinc-900">{calculateDays()} Days</span>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Reason</label>
                <textarea 
                  required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none transition-all resize-none"
                  rows={3}
                  placeholder="Provide a brief reason for your leave..."
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Attachment (Optional)</label>
                <div className="relative">
                  <input 
                    type="text" 
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none transition-all pl-10"
                    placeholder="Link to supporting document (e.g., medical note)"
                    value={formData.attachment_url}
                    onChange={(e) => setFormData({ ...formData, attachment_url: e.target.value })}
                  />
                  <FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 border border-zinc-200 rounded-2xl font-black text-zinc-600 hover:bg-zinc-50 transition-colors uppercase text-[10px] tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="flex-2 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-2xl font-black transition-all shadow-lg shadow-zinc-900/20 uppercase text-[10px] tracking-widest"
                >
                  Submit Application
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaveTab;
