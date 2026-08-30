import React, { useState, useEffect } from 'react';
import { 
  Heart, 
  Wallet, 
  FileText, 
  Bell, 
  Plus, 
  Search, 
  Filter, 
  Edit2, 
  Trash2, 
  X,
  Globe,
  Gift,
  HandHeart,
  Calendar,
  DollarSign,
  Award,
  BookOpen,
  LayoutDashboard,
  UserCircle
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasAnyRole } from '../utils/roles';
import { firestoreService } from '../services/firestore';
import { WelfareRecord, CSRProject, Staff } from '../types';
import { toast } from 'sonner';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Import Portal Tabs
import LeaveTab from '../components/welfare/LeaveTab';
import AdvanceTab from '../components/welfare/AdvanceTab';
import PayslipTab from '../components/welfare/PayslipTab';
import CMETab from '../components/welfare/CMETab';
import AppraisalTab from '../components/welfare/AppraisalTab';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type TabType = 'portal' | 'leave' | 'advances' | 'payslips' | 'cme' | 'performance' | 'admin_welfare' | 'admin_csr';

const Welfare: React.FC = () => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('portal');
  const [welfare, setWelfare] = useState<WelfareRecord[]>([]);
  const [csr, setCsr] = useState<CSRProject[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  const isAdmin = hasAnyRole(profile, ['admin', 'HR Head', 'HR Support Personnel', 'HR Manager', 'owner', 'CEO', 'CEO / MD']);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Staff>('staff', profile.tenantId, setStaff);
      firestoreService.subscribeToCollection<WelfareRecord>('welfare', profile.tenantId, setWelfare);
      firestoreService.subscribeToCollection<CSRProject>('csr', profile.tenantId, setCsr);
    }
  }, [profile?.tenantId]);

  const handleDelete = async (collection: string, id: string) => {
    if (window.confirm('Are you sure you want to delete this entry?')) {
      try {
        await firestoreService.deleteDocument(collection, id);
        toast.success('Entry deleted');
      } catch (error) {
        toast.error('Failed to delete entry');
      }
    }
  };

  const handleUpdateWelfareLimit = async (staffMember: Staff, newLimit: number) => {
    if (!profile?.tenantId) return;
    const oldLimit = staffMember.welfare_limit || 50000;
    const difference = newLimit - oldLimit;

    try {
      await firestoreService.updateDocument('staff', staffMember.id, {
        welfare_limit: newLimit
      });

      if (difference !== 0) {
        await firestoreService.addDocument('petty_cash_ledger', {
          tenantId: profile.tenantId,
          amount: Math.abs(difference),
          type: difference > 0 ? 'withdrawal' : 'incoming',
          category: 'Staff Welfare',
          notes: `Welfare limit adjustment for ${staffMember.full_name || staffMember.username} (${oldLimit.toLocaleString()} -> ${newLimit.toLocaleString()})`,
          date: new Date().toISOString(),
          created_by_name: profile.full_name || 'HR Administrator'
        });
      }

      toast.success(`Welfare limit successfully adjusted for ${staffMember.full_name || staffMember.username}`);
    } catch (e) {
      console.error(e);
      toast.error('Failed to adjust welfare limit.');
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'portal':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Quick Stats / Dashboard for Portal */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-zinc-900 p-8 rounded-[32px] text-white relative overflow-hidden shadow-2xl shadow-zinc-900/20">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                  <UserCircle size={120} />
                </div>
                <div className="relative z-10">
                  <h2 className="text-3xl font-black tracking-tight mb-2">Welcome, {profile?.full_name || profile?.displayName}!</h2>
                  <p className="text-zinc-400 text-sm font-medium mb-8">Access your benefits, leave applications, and performance records here.</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Leave Balance</p>
                      <p className="text-xl font-black">{(profile as any)?.annual_leave_balance || 0} Days</p>
                    </div>
                    <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">CME Credits</p>
                      <p className="text-xl font-black">{(profile as any)?.cme_credits_ytd || 0} CPD</p>
                    </div>
                    <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Welfare Used</p>
                      <p className="text-xl font-black">UGX {(profile?.welfare_spent || (profile as any)?.welfare_used_ytd || 0).toLocaleString()}</p>
                    </div>
                    <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Welfare Balance</p>
                      <p className="text-xl font-black text-emerald-300">UGX {((profile?.welfare_limit || 50000) - (profile?.welfare_spent || (profile as any)?.welfare_used_ytd || 0)).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <button onClick={() => setActiveTab('leave')} className="group bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm hover:shadow-xl hover:shadow-zinc-900/5 transition-all text-left">
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl w-fit mb-4 group-hover:scale-110 transition-transform">
                    <Calendar size={24} />
                  </div>
                  <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight mb-1">Leave Management</h3>
                  <p className="text-zinc-500 text-xs font-medium">Apply for leave and track your history.</p>
                </button>
                <button onClick={() => setActiveTab('advances')} className="group bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm hover:shadow-xl hover:shadow-zinc-900/5 transition-all text-left">
                  <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl w-fit mb-4 group-hover:scale-110 transition-transform">
                    <DollarSign size={24} />
                  </div>
                  <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight mb-1">Salary Advances</h3>
                  <p className="text-zinc-500 text-xs font-medium">Request advances and view repayment schedules.</p>
                </button>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm">
                <h3 className="text-sm font-black text-zinc-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Bell size={16} className="text-zinc-400" />
                  Notifications
                </h3>
                <div className="space-y-4">
                  <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Leave Update</p>
                    <p className="text-xs font-bold text-zinc-900">Your annual leave request was approved.</p>
                    <p className="text-[8px] text-zinc-400 mt-2">2 hours ago</p>
                  </div>
                  <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Payroll</p>
                    <p className="text-xs font-bold text-zinc-900">March payslip is now available for download.</p>
                    <p className="text-[8px] text-zinc-400 mt-2">Yesterday</p>
                  </div>
                </div>
              </div>

              <div className="bg-emerald-50 p-6 rounded-[32px] border border-emerald-100">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-emerald-600 text-white rounded-xl">
                    <Award size={20} />
                  </div>
                  <h3 className="text-sm font-black text-emerald-900 uppercase tracking-widest">CME Compliance</h3>
                </div>
                <p className="text-xs text-emerald-700 font-medium mb-4">You are currently compliant with your CME requirements for 2024.</p>
                <button onClick={() => setActiveTab('cme')} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-700 transition-all">
                  View CME Records
                </button>
              </div>
            </div>
          </div>
        );
      case 'leave': return <LeaveTab />;
      case 'advances': return <AdvanceTab />;
      case 'payslips': return <PayslipTab />;
      case 'cme': return <CMETab />;
      case 'performance': return <AppraisalTab />;
      case 'welfare_log' as any:
        return <WelfareLogTab staffId={profile?.id || profile?.uid || ''} welfare={welfare} />;
      case 'admin_welfare':
      case 'admin_csr':
        return (
          <div className="space-y-6">
            {activeTab === 'admin_welfare' && (
              <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm p-6 space-y-6">
                <div>
                  <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">Staff Welfare Allocations</h3>
                  <p className="text-zinc-500 text-xs font-medium">Assign and manage welfare balances for staff members. Allocating limits will withdraw funds from the HQ Petty Cash balance.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {staff.map((s) => {
                    const limit = s.welfare_limit || 50000;
                    const spent = s.welfare_spent || 0;
                    const balance = limit - spent;
                    
                    return (
                      <div key={s.id} className="p-5 bg-zinc-50 border border-zinc-200 rounded-3xl space-y-4">
                        <div>
                          <p className="font-bold text-sm text-zinc-900">{s.full_name || s.username}</p>
                          <p className="text-[10px] text-zinc-400 font-mono">ROLE: {s.role}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center text-xs font-sans">
                          <div className="p-2 bg-white rounded-xl border border-zinc-100">
                            <p className="text-[8px] font-black text-zinc-400 uppercase tracking-wider mb-0.5">Limit</p>
                            <p className="font-bold text-zinc-800">UGX {limit.toLocaleString()}</p>
                          </div>
                          <div className="p-2 bg-white rounded-xl border border-zinc-100">
                            <p className="text-[8px] font-black text-zinc-400 uppercase tracking-wider mb-0.5">Spent</p>
                            <p className="font-bold text-zinc-850">UGX {spent.toLocaleString()}</p>
                          </div>
                          <div className="p-2 bg-emerald-50 rounded-xl border border-emerald-100">
                            <p className="text-[8px] font-black text-emerald-600 uppercase tracking-wider mb-0.5">Balance</p>
                            <p className="font-bold text-emerald-700">UGX {balance.toLocaleString()}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            const newLimit = window.prompt(`Set new Welfare Limit for ${s.full_name || s.username}:`, limit.toString());
                            if (newLimit !== null) {
                              const val = parseFloat(newLimit);
                              if (!isNaN(val) && val >= 0) {
                                handleUpdateWelfareLimit(s, val);
                              } else {
                                toast.error('Invalid limit amount entered.');
                              }
                            }
                          }}
                          className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-850 text-white rounded-xl font-bold uppercase text-[9px] tracking-wider transition-all"
                        >
                          Adjust Limit
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/50 border-b border-zinc-100">
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">
                      {activeTab === 'admin_welfare' ? 'Staff & Type' : 'Project & Description'}
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">
                      {activeTab === 'admin_welfare' ? 'Amount' : 'Budget'}
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Status</th>
                    <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {activeTab === 'admin_welfare' ? (
                    welfare.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center">
                              <Gift size={20} />
                            </div>
                            <div>
                              <p className="font-bold text-zinc-900">{staff.find(s => s.uid === item.staffId)?.full_name || 'Unknown'}</p>
                              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">{item.type}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-bold text-zinc-900">UGX {item.amount.toLocaleString()}</td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider",
                            item.status === 'approved' ? "bg-emerald-50 text-emerald-600" : 
                            item.status === 'pending' ? "bg-amber-50 text-amber-600" : 
                            "bg-red-50 text-red-600"
                          )}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setEditingItem(item); setIsModalOpen(true); }} className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"><Edit2 size={16} /></button>
                            <button onClick={() => handleDelete('welfare', item.id)} className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    csr.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                              <Globe size={20} />
                            </div>
                            <div>
                              <p className="font-bold text-zinc-900">{item.project_name}</p>
                              <p className="text-[10px] text-zinc-400 truncate max-w-[200px]">{item.description}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-bold text-zinc-900">UGX {item.budget.toLocaleString()}</td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider",
                            item.status === 'completed' ? "bg-emerald-50 text-emerald-600" : 
                            item.status === 'ongoing' ? "bg-blue-50 text-blue-600" : 
                            "bg-amber-50 text-amber-600"
                          )}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setEditingItem(item); setIsModalOpen(true); }} className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"><Edit2 size={16} /></button>
                            <button onClick={() => handleDelete('csr', item.id)} className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
      default: return null;
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-zinc-900 tracking-tight uppercase">Welfare Portal</h1>
          <p className="text-zinc-500 text-sm font-medium">Employee self-service and community engagement.</p>
        </div>
        {(activeTab === 'admin_welfare' || activeTab === 'admin_csr') && (
          <button 
            onClick={() => {
              setEditingItem(null);
              setIsModalOpen(true);
            }}
            className="bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 w-fit shadow-lg shadow-zinc-900/20 uppercase text-xs tracking-widest"
          >
            <Plus size={20} />
            Add {activeTab === 'admin_welfare' ? 'Welfare Entry' : 'CSR Project'}
          </button>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-zinc-100 p-1.5 rounded-[24px] w-fit">
        <button 
          onClick={() => setActiveTab('portal')}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest",
            activeTab === 'portal' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-white/50"
          )}
        >
          <LayoutDashboard size={14} />
          Dashboard
        </button>
        <button 
          onClick={() => setActiveTab('leave')}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest",
            activeTab === 'leave' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-white/50"
          )}
        >
          <Calendar size={14} />
          Leave
        </button>
        <button 
          onClick={() => setActiveTab('advances')}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest",
            activeTab === 'advances' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-white/50"
          )}
        >
          <DollarSign size={14} />
          Advances
        </button>
        <button 
          onClick={() => setActiveTab('payslips')}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest",
            activeTab === 'payslips' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-white/50"
          )}
        >
          <FileText size={14} />
          Payslips
        </button>
        <button 
          onClick={() => setActiveTab('cme')}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest",
            activeTab === 'cme' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-white/50"
          )}
        >
          <BookOpen size={14} />
          CME
        </button>
        <button 
          onClick={() => setActiveTab('performance')}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest",
            activeTab === 'performance' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-white/50"
          )}
        >
          <Award size={14} />
          Performance
        </button>
        <button 
          onClick={() => setActiveTab('welfare_log' as any)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest",
            activeTab === 'welfare_log' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-white/50"
          )}
        >
          <Gift size={14} />
          Welfare Log
        </button>
        {isAdmin && (
          <>
            <div className="w-px h-4 bg-zinc-200 mx-1" />
            <button 
              onClick={() => setActiveTab('admin_welfare')}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest",
                activeTab === 'admin_welfare' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-white/50"
              )}
            >
              <HandHeart size={14} />
              Admin Welfare
            </button>
            <button 
              onClick={() => setActiveTab('admin_csr')}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest",
                activeTab === 'admin_csr' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-white/50"
              )}
            >
              <Globe size={14} />
              Admin CSR
            </button>
          </>
        )}
      </div>

      {/* Main Content Area */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        {renderContent()}
      </div>

      {isModalOpen && (activeTab === 'admin_welfare' || activeTab === 'admin_csr') && (
        <WelfareModal 
          type={activeTab === 'admin_welfare' ? 'welfare' : 'csr'}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          item={editingItem}
          staff={staff}
        />
      )}
    </div>
  );
};

const WelfareModal: React.FC<{ type: string; isOpen: boolean; onClose: () => void; item: any; staff: Staff[] }> = ({ type, isOpen, onClose, item, staff }) => {
  const { profile } = useAuth();
  const [formData, setFormData] = useState<any>(item || { status: type === 'welfare' ? 'pending' : 'planned' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId) return;

    const collection = type === 'welfare' ? 'welfare' : 'csr';
    
    try {
      if (item?.id) {
        await firestoreService.updateDocument(collection, item.id, formData);
        toast.success('Updated successfully');
      } else {
        await firestoreService.addDocument(collection, {
          ...formData,
          tenantId: profile.tenantId
        });
        toast.success('Added successfully');
      }
      onClose();
    } catch (error) {
      toast.error('Failed to save');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">
            {item ? 'Edit' : 'Add New'} {type === 'welfare' ? 'Welfare Entry' : 'CSR Project'}
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {type === 'welfare' && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Staff Member *</label>
                  <select required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl" value={formData.staffId || ''} onChange={(e) => setFormData({ ...formData, staffId: e.target.value })}>
                    <option value="">Select Staff...</option>
                    {staff.map(s => <option key={s.uid} value={s.uid}>{s.full_name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Type</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl" value={formData.type || ''} onChange={(e) => setFormData({ ...formData, type: e.target.value })}>
                    <option value="medical">Medical</option>
                    <option value="bonus">Bonus</option>
                    <option value="advance">Advance</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Amount (UGX)</label>
                  <input type="number" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl" value={formData.amount || ''} onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Status</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl" value={formData.status || 'pending'} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </>
            )}

            {type === 'csr' && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Project Name *</label>
                  <input required type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl" value={formData.project_name || ''} onChange={(e) => setFormData({ ...formData, project_name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Budget (UGX)</label>
                  <input type="number" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl" value={formData.budget || ''} onChange={(e) => setFormData({ ...formData, budget: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Date</label>
                  <input type="date" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl" value={formData.date || ''} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Status</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl" value={formData.status || 'planned'} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                    <option value="planned">Planned</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Description / Notes</label>
            <textarea className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl resize-none" rows={2} value={formData.description || formData.notes || ''} onChange={(e) => setFormData({ ...formData, [type === 'csr' ? 'description' : 'notes']: e.target.value })} />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 border border-zinc-200 rounded-xl font-bold text-zinc-600 hover:bg-zinc-50 transition-colors uppercase text-[10px] tracking-widest">Cancel</button>
            <button type="submit" className="px-8 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-bold transition-all shadow-lg shadow-zinc-900/20 uppercase text-[10px] tracking-widest">
              {item ? 'Update Entry' : 'Register Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const WelfareLogTab: React.FC<{ staffId: string; welfare: WelfareRecord[] }> = ({ staffId, welfare }) => {
  const myLogs = welfare.filter(w => w.staffId === staffId);

  return (
    <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden p-6 space-y-6 animate-in fade-in duration-300">
      <div>
        <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">Welfare Transactions Log</h3>
        <p className="text-zinc-500 text-xs font-medium">Log of transactions and deductions from your allocated welfare amounts.</p>
      </div>

      <div className="border border-zinc-150 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-150 font-bold text-zinc-500">
                <th className="px-6 py-3 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 uppercase tracking-wider">Notes</th>
                <th className="px-6 py-3 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {myLogs.map((log) => (
                <tr key={log.id} className="hover:bg-zinc-50/20">
                  <td className="px-6 py-4 font-mono text-[11px] text-zinc-600">
                    {log.date ? new Date(log.date).toLocaleString() : 'N/A'}
                  </td>
                  <td className="px-6 py-4 font-bold text-zinc-800 uppercase tracking-wider">
                    {log.type}
                  </td>
                  <td className="px-6 py-4 font-bold text-zinc-950">
                    UGX {(log.amount || 0).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-zinc-500">
                    {log.notes || 'No description'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider",
                      log.status === 'approved' ? "bg-emerald-50 text-emerald-600" :
                      log.status === 'pending' ? "bg-amber-50 text-amber-600" :
                      "bg-red-50 text-red-600"
                    )}>
                      {log.status}
                    </span>
                  </td>
                </tr>
              ))}
              {myLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-zinc-400 italic">
                    No welfare transactions logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Welfare;
