import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Plus, Filter, Mail, Phone, MapPin, 
  Building2, Calendar, Shield, MoreVertical, 
  Edit2, Trash2, UserPlus, X, Briefcase, 
  GraduationCap, Award, Heart, Activity, Users,
  ShieldCheck, Lock, Check
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { firestoreService } from '../../services/firestore';
import { Staff, Branch } from '../../types';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';
import { registerAuthUser } from '../../firebase';
import { deduplicateStaff } from '../../utils/deduplicateStaff';

export const StaffDirectory: React.FC = () => {
  const { profile } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [customRoles, setCustomRoles] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [viewingStaffCard, setViewingStaffCard] = useState<Staff | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'on-leave' | 'suspended'>('all');

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubStaff = firestoreService.subscribeToCollection<Staff>(
        'staff',
        profile.tenantId,
        setStaff
      );
      const unsubBranches = firestoreService.subscribeToCollection<Branch>(
        'branches',
        profile.tenantId,
        setBranches
      );
      const unsubRoles = firestoreService.subscribeToCollection<any>(
        'hr_roles',
        profile.tenantId,
        setCustomRoles
      );
      return () => {
        unsubStaff();
        unsubBranches();
        unsubRoles();
      };
    }
  }, [profile?.tenantId]);

  const dedupedStaff = useMemo(() => deduplicateStaff(staff), [staff]);
  const filteredStaff = dedupedStaff.filter(s => {
    const matchesSearch = s.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         s.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         s.employee_id?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = activeFilter === 'all' || s.status === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this staff member?')) {
      try {
        await firestoreService.deleteDocument('staff', id);
        toast.success('Staff member deleted');
      } catch (error) {
        toast.error('Failed to delete staff member');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard 
          label="Total Workforce" 
          value={dedupedStaff.length}
          icon={Users} 
          color="text-slate-600" 
          bgColor="bg-slate-50" 
        />
        <StatCard 
          label="Active Staff" 
          value={dedupedStaff.filter(s => s.status === 'active').length}
          icon={Activity} 
          color="text-emerald-600" 
          bgColor="bg-emerald-50" 
        />
        <StatCard 
          label="On Leave" 
          value={dedupedStaff.filter(s => s.status === 'on-leave').length}
          icon={Calendar} 
          color="text-amber-600" 
          bgColor="bg-amber-50" 
        />
        <StatCard 
          label="Branches" 
          value={branches.length} 
          icon={Building2} 
          color="text-indigo-600" 
          bgColor="bg-indigo-50" 
        />
      </div>

      {/* Filters & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm overflow-x-auto no-scrollbar">
          {(['all', 'active', 'on-leave', 'suspended'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                activeFilter === filter 
                  ? "bg-slate-900 text-white shadow-md" 
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              {filter}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Search staff..." 
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none w-64"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={() => {
              setEditingStaff(null);
              setIsModalOpen(true);
            }}
            className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-slate-200"
          >
            <UserPlus size={18} />
            Add Staff
          </button>
        </div>
      </div>

      {/* Staff Table */}
      <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 bg-slate-50/50">
                <th className="px-6 py-4">Staff Identity</th>
                <th className="px-6 py-4">Role & Branch</th>
                <th className="px-6 py-4">Contact Info</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStaff.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td 
                    className="px-6 py-4 cursor-pointer"
                    onClick={() => setViewingStaffCard(member)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                        <Users size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 group-hover:text-indigo-600 group-hover:underline">{member.full_name}</p>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">ID: {member.employee_id || member.id.slice(0, 8)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-bold text-slate-700">{member.role}</p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Building2 size={10} />
                      {branches.find(b => b.id === member.branch_id)?.branch_name || 'Unassigned'}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Mail size={12} className="text-slate-400" /> {member.email}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Phone size={12} className="text-slate-400" /> {member.phone_number}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border",
                      member.status === 'active' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                      member.status === 'on-leave' ? "bg-amber-50 text-amber-600 border-amber-100" :
                      "bg-rose-50 text-rose-600 border-rose-100"
                    )}>
                      {member.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => {
                          setEditingStaff(member);
                          setIsModalOpen(true);
                        }}
                        className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDelete(member.id)}
                        className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <StaffModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          staff={editingStaff}
          branches={branches}
          customRoles={customRoles}
        />
      )}

      {viewingStaffCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" 
            onClick={() => setViewingStaffCard(null)} 
          />
          <div className="relative w-full max-w-lg bg-white rounded-[32px] shadow-2xl p-8 border border-slate-100 overflow-hidden text-slate-805 animate-fade-in">
            <div className="flex items-start justify-between mb-6">
              <div>
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                  Secure Employee Security Roster Card
                </span>
                <h3 className="text-2xl font-black text-slate-900 mt-3">{viewingStaffCard.full_name}</h3>
                <p className="text-xs text-slate-400 font-mono">System Username: @{viewingStaffCard.username || 'n/a'}</p>
                {viewingStaffCard.authEmail && (
                  <p className="text-xs text-indigo-650 font-bold font-mono mt-0.5">Auth Email: {viewingStaffCard.authEmail}</p>
                )}
              </div>
              <button 
                onClick={() => setViewingStaffCard(null)}
                className="text-slate-400 hover:text-slate-900 p-1.5 hover:bg-slate-100 rounded-xl transition-all"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-6">
              {/* Profile Details Grid */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div>
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Operational Designation</span>
                  <span className="text-xs font-bold text-slate-800 capitalize">
                    {viewingStaffCard.role}
                    {viewingStaffCard.secondaryRoles && viewingStaffCard.secondaryRoles.length > 0 && (
                      <span className="text-[10px] text-indigo-600 block font-semibold mt-0.5">
                        Sec: {viewingStaffCard.secondaryRoles.join(', ')}
                      </span>
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Primary Branch</span>
                  <span className="text-xs font-bold text-indigo-750">
                    {branches.find(b => b.id === viewingStaffCard.branch_id)?.name || 'Unassigned'}
                  </span>
                </div>
                <div>
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Staff ID</span>
                  <span className="text-xs font-bold text-slate-800">{viewingStaffCard.employee_id || 'n/a'}</span>
                </div>
                <div>
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">NDA License Status</span>
                  <span className={cn(
                    "text-xs font-bold",
                    viewingStaffCard.nda_licence_status === 'valid' ? 'text-emerald-600' : 'text-red-500'
                  )}>
                    {viewingStaffCard.nda_licence_status?.toUpperCase() || 'VALID'}
                  </span>
                </div>
              </div>

              {/* ENFORCED BRANCH ACCESS DIRECTIVE */}
              <div className="space-y-3 bg-indigo-50/40 border border-indigo-150/50 p-5 rounded-2xl">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="text-indigo-600" size={18} />
                  <span className="text-xs font-black text-indigo-950 uppercase tracking-wider">🔒 Enforced Branch Access Directives</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-normal">
                  This employee is programmatically and legally authorized to log in, view details, sign logs, and transact only within the following audited locations:
                </p>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  {branches.map(b => {
                    const isAuthorized = viewingStaffCard.assigned_branches?.includes(b.id) || viewingStaffCard.branch_id === b.id;
                    return (
                      <div 
                        key={b.id} 
                        className={cn(
                          "flex items-center gap-2 p-2.5 rounded-xl border text-[11px] font-bold transition-all",
                          isAuthorized 
                            ? "bg-emerald-50/70 border-emerald-150 text-emerald-800" 
                            : "bg-slate-50/50 border-slate-100 text-slate-400 opacity-60"
                        )}
                      >
                        {isAuthorized ? (
                          <div className="p-0.5 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
                            <Check size={10} strokeWidth={3} />
                          </div>
                        ) : (
                          <div className="p-0.5 bg-slate-200 text-slate-400 rounded-full flex items-center justify-center">
                            <Lock size={10} />
                          </div>
                        )}
                        <span className="truncate">{b.name}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="bg-indigo-100/50 border border-indigo-150/30 p-2.5 rounded-xl flex items-start gap-2 mt-1">
                  <p className="text-[9px] font-bold text-indigo-900 leading-normal">
                    <strong>Programmatic Authorization Lock: Active.</strong> The platform enforces branch-specific constraints. Personnel matches must resolve to active branches for compliance.
                  </p>
                </div>
              </div>

              {/* Financial Profile & Shift Expected Hours */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Base Salary</span>
                  <span className="text-xs font-black text-slate-800">UGX {viewingStaffCard.salary_base?.toLocaleString() || 0}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Hrs/Day</span>
                  <span className="text-xs font-black text-slate-800">{viewingStaffCard.expected_work_hours_per_day || 8}h</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Days/Month</span>
                  <span className="text-xs font-black text-slate-800">{viewingStaffCard.expected_days_per_month || 26}d</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-8">
              <button 
                onClick={() => setViewingStaffCard(null)}
                className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-1.5"
              >
                Dismiss Secure Card
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number; icon: any; color: string; bgColor: string }> = ({ label, value, icon: Icon, color, bgColor }) => (
  <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm">
    <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center mb-4", bgColor, color)}>
      <Icon size={20} />
    </div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
    <p className="text-2xl font-bold text-slate-900">{value}</p>
  </div>
);

const StaffModal: React.FC<{ isOpen: boolean; onClose: () => void; staff: Staff | null; branches: Branch[]; customRoles?: any[] }> = ({ isOpen, onClose, staff, branches, customRoles = [] }) => {
  const { profile } = useAuth();
  const { tenant } = useTenant();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const systemDefaultRoleNames = [
    'owner', 'admin', 'pharmacist', 'cashier', 'qa head', 'qa officer', 
    'finance head', 'finance officer', 'procurement head', 'procurement officer', 
    'ceo', 'hr head', 'hr support personnel', 'it head', 'it support staff', 
    'logistics head', 'transport & logistics personnel', 'dispenser', 'trainee',
    'branch manager', 'cleaner', 'marketing head', 'marketing personnel'
  ];

  const allAvailableRoles = [
    'owner', 'admin', 'pharmacist', 'cashier', 'QA Head', 'QA Officer', 
    'Finance Head', 'Finance Officer', 'Procurement Head', 'Procurement Officer', 
    'CEO', 'HR Head', 'HR Support Personnel', 'IT Head', 'IT Support Staff', 
    'Logistics Head', 'Transport & Logistics Personnel', 'Marketing Head', 'Marketing Personnel', 'Dispenser', 'Trainee',
    'branch manager', 'cleaner',
    ...(customRoles || [])
      .map((r: any) => r.name?.trim())
      .filter(roleName => roleName && !systemDefaultRoleNames.includes(roleName.toLowerCase()))
  ].map(r => r.trim())
   .filter((v, i, self) => self.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i); // Case-insensitive deduplication
  const [formData, setFormData] = useState<Partial<Staff>>(() => {
    if (staff) {
      return {
        ...staff,
        secondaryRoles: staff.secondaryRoles || [],
        expected_work_hours_per_day: staff.expected_work_hours_per_day || 8,
        expected_days_per_month: staff.expected_days_per_month || 26,
        salary_base: staff.salary_base || 0
      };
    }
    return {
      full_name: '',
      username: '',
      role: '',
      secondaryRoles: [],
      email: '',
      phone_number: '',
      branch_id: '',
      assigned_branches: [],
      employee_id: '',
      status: 'active',
      active: false,
      password_set: false,
      nda_licence_status: 'valid',
      employmentType: 'Full-Time',
      salary_base: 0,
      expected_work_hours_per_day: 8,
      expected_days_per_month: 26,
      hire_date: new Date().toISOString().split('T')[0]
    };
  });

  const toggleBranch = (branchId: string) => {
    const current = formData.assigned_branches || [];
    const updated = current.includes(branchId)
      ? current.filter(id => id !== branchId)
      : [...current, branchId];
    
    setFormData(prev => ({ 
      ...prev, 
      assigned_branches: updated,
      // If primary branch is removed from assigned, clear it
      branch_id: updated.includes(prev.branch_id || '') ? prev.branch_id : updated[0] || ''
    }));
  };

  const toggleSecondaryRole = (roleName: string) => {
    const current = formData.secondaryRoles || [];
    const updated = current.includes(roleName)
      ? current.filter(r => r !== roleName)
      : [...current, roleName];
    setFormData(prev => ({ ...prev, secondaryRoles: updated }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId || isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (staff?.id) {
        await firestoreService.updateDocument('staff', staff.id, formData);
        toast.success('Staff member updated');
      } else {
        // Save staff record to Firestore as pending activation
        const staffId = await firestoreService.addDocument('staff', {
          ...formData,
          username: '',
          loginHandle: '',
          authEmail: '',
          contactEmail: formData.email || '',
          password: '',
          password_set: false,
          active: false,
          status: 'pending',
          tenantId: profile.tenantId,
          uid: ''
        });

        if (staffId) {
          await firestoreService.addDocument('pending_activations', {
            tenantId: profile.tenantId,
            staffId: staffId,
            name: formData.full_name,
            role: formData.role,
            status: 'pending',
            requestedAt: new Date().toISOString()
          });
        }
        
        toast.success('Staff member registered successfully. Awaiting IT activation.');
      }
      onClose();
    } catch (error: any) {
      console.error('Error saving staff:', error);
      toast.error(error.message || 'Failed to save staff member');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[90vh] flex flex-col">
        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">
            {staff ? 'Edit Staff Member' : 'Register New Staff'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8">
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <Users size={18} className="text-indigo-600" />
                Basic Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Full Name *</label>
                  <input required type="text" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.full_name || ''} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} />
                </div>
                <div className="space-y-2 bg-slate-50 border border-slate-200/65 p-3 rounded-xl flex flex-col justify-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Username / Auth Email</span>
                  <div className="text-[11px] text-slate-700 leading-normal">
                    {formData.authEmail ? (
                      <div className="flex flex-col">
                        <span className="font-mono text-indigo-600 block font-bold">{formData.authEmail}</span>
                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mt-0.5">Username: {formData.username || formData.loginHandle}</span>
                      </div>
                    ) : (
                      <span className="text-slate-500 italic">Deferred to IT activation (Settings panel).</span>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Employee ID</label>
                  <input type="text" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.employee_id || ''} onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Status</label>
                  <select className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.status || 'active'} onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}>
                    <option value="active">Active</option>
                    <option value="on-leave">On Leave</option>
                    <option value="suspended">Suspended</option>
                    <option value="terminated">Terminated</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Role & Assignment */}
            <div className="space-y-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <Briefcase size={18} className="text-indigo-600" />
                Role & Assignment
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Primary Role *</label>
                  <select required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900" value={formData.role || ''} onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}>
                    <option value="">Select Primary...</option>
                    <optgroup label="System Defaults">
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="pharmacist">Pharmacist</option>
                      <option value="cashier">Cashier</option>
                      <option value="QA Head">QA Head</option>
                      <option value="QA Officer">QA Officer</option>
                      <option value="Finance Head">Finance Head</option>
                      <option value="Finance Officer">Finance Officer</option>
                      <option value="Procurement Head">Procurement Head</option>
                      <option value="Procurement Officer">Procurement Officer</option>
                      <option value="CEO">CEO</option>
                      <option value="HR Head">HR Head</option>
                      <option value="HR Support Personnel">HR Support Personnel</option>
                      <option value="IT Head">IT Head</option>
                      <option value="IT Support Staff">IT Support Staff</option>
                      <option value="Logistics Head">Logistics Head</option>
                      <option value="Transport & Logistics Personnel">Transport & Logistics Personnel</option>
                      <option value="Dispenser">Dispenser</option>
                      <option value="Trainee">Trainee</option>
                      <option value="branch manager">Branch Manager</option>
                      <option value="cleaner">Cleaner</option>
                    </optgroup>
                    {customRoles.length > 0 && (
                      <optgroup label="Custom Roles">
                        {customRoles
                          .filter(role => role.name && !systemDefaultRoleNames.includes(role.name.toLowerCase().trim()))
                          .filter((role, index, self) => self.findIndex(r => r.name?.toLowerCase().trim() === role.name?.toLowerCase().trim()) === index)
                          .map(role => (
                            <option key={role.id} value={role.name}>{role.name}</option>
                          ))
                        }
                      </optgroup>
                    )}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Secondary Roles</label>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl max-h-40 overflow-y-auto space-y-1.5">
                    {allAvailableRoles
                      .filter(r => r !== formData.role)
                      .map(roleName => {
                        const isChecked = (formData.secondaryRoles || []).includes(roleName);
                        return (
                          <label key={roleName} className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSecondaryRole(roleName)}
                              className="rounded border-slate-300 text-indigo-650 focus:ring-indigo-500/20"
                            />
                            <span className="text-xs font-semibold text-slate-700 capitalize">{roleName}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Assigned Branches *</label>
                  <div className="grid grid-cols-1 gap-1.5 p-3 bg-slate-50 border border-slate-200 rounded-xl max-h-40 overflow-y-auto">
                    {branches.map(b => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => toggleBranch(b.id)}
                        className={cn(
                          "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-all text-left",
                          formData.assigned_branches?.includes(b.id)
                            ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                            : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                        )}
                      >
                        <div className={cn(
                          "h-2 w-2 rounded-full",
                          formData.assigned_branches?.includes(b.id) ? "bg-indigo-500" : "bg-slate-300"
                        )} />
                        <span className="truncate">{b.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Primary Operating Branch *</label>
                  <select 
                    required 
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900" 
                    value={formData.branch_id || ''} 
                    onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                  >
                    <option value="">Select Primary...</option>
                    {branches
                      .filter(b => formData.assigned_branches?.includes(b.id))
                      .map(b => <option key={b.id} value={b.id}>{b.name}</option>)
                    }
                  </select>
                  <p className="text-[10px] text-slate-400 italic">Must be one of the assigned branches.</p>
                </div>
                
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Hire Date</label>
                  <input type="date" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.hire_date || ''} onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Financial & Compliance */}
            <div className="space-y-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <Award size={18} className="text-indigo-600" />
                Financial & Compliance
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Employment Type *</label>
                  <select 
                    required 
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-950" 
                    value={formData.employmentType || 'Full-Time'} 
                    onChange={(e) => setFormData({ ...formData, employmentType: e.target.value })}
                  >
                    <option value="Full-Time">Full-Time</option>
                    <option value="Part-Time">Part-Time</option>
                    <option value="Resident Consultant">Resident Consultant</option>
                    <option value="Non-Resident Consultant">Non-Resident Consultant</option>
                    <option value="Independent Contractor / Self-Employed">Independent Contractor / Self-Employed</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Base Salary (UGX) *</label>
                  <input type="number" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900" value={formData.salary_base || 0} onChange={(e) => setFormData({ ...formData, salary_base: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Expected Work Hours / Day *</label>
                  <input type="number" step="0.5" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900" value={formData.expected_work_hours_per_day || 0} onChange={(e) => setFormData({ ...formData, expected_work_hours_per_day: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Expected Days / Month *</label>
                  <input type="number" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900" value={formData.expected_days_per_month || 0} onChange={(e) => setFormData({ ...formData, expected_days_per_month: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">NDA Licence Status</label>
                  <select className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.nda_licence_status || 'valid'} onChange={(e) => setFormData({ ...formData, nda_licence_status: e.target.value as any })}>
                    <option value="valid">Valid</option>
                    <option value="expired">Expired</option>
                    <option value="pending">Pending</option>
                    <option value="n/a">N/A</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Licence Expiry</label>
                  <input type="date" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.nda_licence_expiry || ''} onChange={(e) => setFormData({ ...formData, nda_licence_expiry: e.target.value })} />
                </div>
              </div>

              {/* Dynamic Hourly Remuneration Callback Card */}
              {((formData.expected_work_hours_per_day || 0) * (formData.expected_days_per_month || 0)) > 0 && (
                <div className="p-5 bg-indigo-50/70 border border-indigo-100 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-indigo-950">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 block mb-1">Expected Monthly Hours</span>
                    <span className="text-xl font-extrabold text-indigo-900">
                      {((formData.expected_work_hours_per_day || 0) * (formData.expected_days_per_month || 0)).toFixed(1)} hrs / month
                    </span>
                  </div>
                  <div className="h-px sm:h-8 w-full sm:w-px bg-indigo-200/60" />
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 block mb-1">Expected Remuneration / Hour</span>
                    <span className="text-xl font-extrabold text-indigo-900">
                      UGX {Math.round((formData.salary_base || 0) / (((formData.expected_work_hours_per_day || 0) * (formData.expected_days_per_month || 0)) || 1)).toLocaleString()} / hr
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Contact Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <Mail size={18} className="text-indigo-600" />
                Contact Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Email Address</label>
                  <input type="email" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.email || ''} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Phone Number</label>
                  <input type="text" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.phone_number || ''} onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
              <button type="button" onClick={onClose} className="px-6 py-2 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-colors uppercase text-[10px] tracking-widest">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-8 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all shadow-lg shadow-slate-200 uppercase text-[10px] tracking-widest">
                {isSubmitting ? 'Saving...' : staff ? 'Update Member' : 'Register Member'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
