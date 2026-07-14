import React, { useState, useEffect } from 'react';
import { 
  DollarSign, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Plus,
  ArrowRight,
  ShieldCheck,
  CreditCard
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { AdvanceRequest } from '../../types';
import { toast } from 'sonner';
import { format } from 'date-fns';

const AdvanceTab: React.FC = () => {
  const { profile } = useAuth();
  const [requests, setRequests] = useState<AdvanceRequest[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    amount_requested: '',
    reason: '',
    repayment_period_months: 1
  });

  useEffect(() => {
    if (profile?.uid && profile?.tenantId) {
      const unsubscribe = firestoreService.subscribeToCollection<AdvanceRequest>(
        'advance_requests',
        profile.tenantId,
        (data) => {
          const userRequests = data.filter(r => r.staff_id === profile.uid);
          setRequests(userRequests.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
        }
      );
      return () => unsubscribe();
    }
  }, [profile?.uid, profile?.tenantId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.uid || !profile?.tenantId) return;

    const amount = Number(formData.amount_requested);
    if (amount <= 0) {
      toast.error('Invalid amount');
      return;
    }

    try {
      const newRequest: Omit<AdvanceRequest, 'id'> = {
        tenantId: profile.tenantId,
        staffId: profile.uid,
        staff_id: profile.uid,
        staff_name: profile.full_name || profile.displayName || 'Unknown',
        amount: amount,
        amountRequested: amount,
        amount_requested: amount,
        reason: formData.reason,
        repaymentMethod: 'next_payroll',
        repayment_period_months: formData.repayment_period_months,
        status: 'Pending',
        hr_approval_status: 'Pending',
        ceo_approval_status: 'Pending',
        submittedAt: new Date().toISOString(),
        created_at: new Date().toISOString()
      };

      await firestoreService.addDocument('advance_requests', newRequest);
      toast.success('Advance request submitted');
      setIsModalOpen(false);
      setFormData({ amount_requested: '', reason: '', repayment_period_months: 1 });
    } catch (error) {
      toast.error('Failed to submit request');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Approved':
      case 'Disbursed': return 'text-emerald-600 bg-emerald-50';
      case 'Rejected': return 'text-red-600 bg-red-50';
      case 'Pending': return 'text-amber-600 bg-amber-50';
      default: return 'text-zinc-600 bg-zinc-50';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'Pending': return 'Awaiting Review';
      case 'Approved': return 'Approved';
      case 'Disbursed': return 'Disbursed';
      case 'Rejected': return 'Rejected';
      default: return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
              <DollarSign size={24} />
            </div>
            <div>
              <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Outstanding Balance</p>
              <h3 className="text-2xl font-black text-zinc-900">
                UGX {requests.reduce((sum, r) => sum + (r.status === 'Approved' ? r.amount_requested : 0), 0).toLocaleString()}
              </h3>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
              <Clock size={24} />
            </div>
            <div>
              <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Pending Requests</p>
              <h3 className="text-2xl font-black text-zinc-900">
                {requests.filter(r => r.status === 'Pending').length}
              </h3>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 p-6 rounded-3xl shadow-xl shadow-zinc-900/20 flex flex-col justify-center">
          <button 
            onClick={() => setIsModalOpen(true)}
            className="w-full py-3 bg-white text-zinc-900 rounded-2xl font-black uppercase text-xs tracking-[0.2em] hover:bg-zinc-100 transition-all flex items-center justify-center gap-2"
          >
            <Plus size={18} />
            Request Advance
          </button>
        </div>
      </div>

      {/* Requests History */}
      <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-zinc-100">
          <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">My Salary Advances</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Date & Amount</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Repayment</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Status</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-zinc-400 font-medium">
                    No advance requests found.
                  </td>
                </tr>
              ) : (
                requests.map((request) => (
                  <tr key={request.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-bold text-zinc-900">UGX {request.amount_requested.toLocaleString()}</p>
                        <p className="text-[10px] text-zinc-500 uppercase font-black tracking-wider">
                          {format(new Date(request.created_at), 'MMM dd, yyyy')}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <CreditCard size={14} className="text-zinc-400" />
                        <span className="text-[10px] font-bold text-zinc-700 uppercase tracking-tight">
                          {request.repayment_period_months} Months
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${getStatusColor(request.status)}`}>
                        {getStatusLabel(request.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-bold text-zinc-900">UGX {request.amount_requested.toLocaleString()}</p>
                      {request.status === 'Approved' && (
                        <p className="text-[8px] text-zinc-400 uppercase font-black">Active Deduction</p>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Request Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">Request Salary Advance</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
                <XCircle size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Requested Amount (UGX)</label>
                <div className="relative">
                  <input 
                    required
                    type="number" 
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none transition-all pl-12"
                    placeholder="Enter amount..."
                    value={formData.amount_requested}
                    onChange={(e) => setFormData({ ...formData, amount_requested: e.target.value })}
                  />
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Repayment Period (Months)</label>
                <select 
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                  value={formData.repayment_period_months}
                  onChange={(e) => setFormData({ ...formData, repayment_period_months: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 5, 6, 12].map(m => <option key={m} value={m}>{m} Month{m > 1 ? 's' : ''}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Reason for Request</label>
                <textarea 
                  required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none transition-all resize-none"
                  rows={3}
                  placeholder="Explain why you need this advance..."
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                />
              </div>

              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-start gap-3">
                <ShieldCheck className="text-blue-600 shrink-0" size={20} />
                <p className="text-[10px] text-blue-700 font-medium leading-relaxed">
                  Your request will be reviewed by HR, then forwarded to Finance and the CEO for final approval. 
                  Approved amounts may vary based on eligibility.
                </p>
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
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdvanceTab;
