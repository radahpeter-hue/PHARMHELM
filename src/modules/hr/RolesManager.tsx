import React, { useState, useEffect } from 'react';
import { 
  Users, Briefcase, Plus, Search, Trash2, Edit2, 
  X, HelpCircle, Shield, ShieldCheck, Activity, Save,
  Sliders, Lock, Unlock, Settings, Eye, Check, Ban, AlertCircle, Building2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { Staff, Branch } from '../../types';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export interface CustomRole {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  isCustom: boolean;
  created_at: string;
  created_by: string;
}

export const DEFAULT_ROLES_LIST = [
  { name: 'owner', label: 'Owner', description: 'Business owner with full admin control' },
  { name: 'admin', label: 'Admin', description: 'System administrator with wide access' },
  { name: 'pharmacist', label: 'Pharmacist', description: 'Qualified pharmacy professional managing prescriptions' },
  { name: 'cashier', label: 'Cashier', description: 'Handles payments and POS checkout' },
  { name: 'QA Head', label: 'QA Head', description: 'Manages quality assurance and compliance operations' },
  { name: 'QA Officer', label: 'QA Officer', description: 'Quality assurance team member' },
  { name: 'Finance Head', label: 'Finance Head', description: 'Oversees financial control and reconciliation' },
  { name: 'Finance Officer', label: 'Finance Officer', description: 'Handles financial entries and accounting support' },
  { name: 'Procurement Head', label: 'Procurement Head', description: 'Oversees purchase requisitions and stock orders' },
  { name: 'Procurement Officer', label: 'Procurement Officer', description: 'Assists with purchase order creations' },
  { name: 'CEO', label: 'CEO', description: 'Chief Executive Officer' },
  { name: 'HR Head', label: 'HR Head', description: 'Manager of human resources and admin tracking' },
  { name: 'HR Support Personnel', label: 'HR Support Personnel', description: 'Assists with payroll, attendance, and leave' },
  { name: 'IT Head', label: 'IT Head', description: 'Manages technology infrastructures and password resets' },
  { name: 'IT Support Staff', label: 'IT Support Staff', description: 'Assists with hardware, software setup' },
  { name: 'Logistics Head', label: 'Logistics Head', description: 'Oversees fleet, fuel logs, and dispatch delivery' },
  { name: 'Transport & Logistics Personnel', label: 'Transport & Logistics Personnel', description: 'Drivers and warehouse transport staff' },
  { name: 'Dispenser', label: 'Dispenser', description: 'Prepares and assists in dispensing pharmacy stock' },
  { name: 'Trainee', label: 'Trainee', description: 'Intern or trainee learning standard operations' },
  { name: 'branch manager', label: 'Branch Manager', description: 'Manages branch specific operations, sales and cash' },
  { name: 'cleaner', label: 'Cleaner', description: 'Handles facility maintenance and sanitation' }
];

export const SYSTEM_MODULES = [
  { id: 'dashboard', name: 'Dashboard', submodules: 'Main Dashboard, Quick Action Widgets' },
  { id: 'sales', name: 'Sales / POS', submodules: 'Point of Sale, Active Sales, Sales Invoices' },
  { id: 'inventory', name: 'Inventory', submodules: 'Product Catalog, FEFO Stock Levels, Stock Movements' },
  { id: 'clients', name: 'Clients & Institutions', submodules: 'Client Register, Institutional Credit Accounts' },
  { id: 'stock', name: 'Stock In/Out', submodules: 'Direct Stock-in, Branch Transfers, Audits' },
  { id: 'procurement', name: 'Procurement', submodules: 'Purchase Orders, Supplier Lists, Price Queries' },
  { id: 'logistics', name: 'Fleet & Logistics', submodules: 'Vehicle Registry, Fuel Tracker, Delivery Dispatch' },
  { id: 'finance', name: 'Finance', submodules: 'Management Ledgers, Tax Engine, Cash & Banking, Petty Cash' },
  { id: 'compliance', name: 'Compliance / QA', submodules: 'Batch Verifications, Quality Assurance Logs' },
  { id: 'hr', name: 'HR Admin', submodules: 'Staff Registry, Roles Manager, Payroll Engine, Attendance' },
  { id: 'welfare', name: 'Welfare Portal', submodules: 'Staff Welfare Funds, Employee Requests' },
  { id: 'predictive', name: 'Predictive Engine', submodules: 'FEFO Expiry Warnings, Demand Forecasting' },
  { id: 'analytics', name: 'Analytics', submodules: 'Financial Reports, Sales Trend Visualizers' },
  { id: 'marketing', name: 'Marketing', submodules: 'Promotional Campaigns, Customer Loyalty' },
  { id: 'settings', name: 'Settings', submodules: 'Tenant Profile, Branch Configurations, Backup Tools' }
];

export const RolesManager: React.FC = () => {
  const { profile } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);

  // Realm of Operation Permissions State
  const [selectedRoleForRealm, setSelectedRoleForRealm] = useState<any | null>(null);
  const [realmPermissions, setRealmPermissions] = useState<Record<string, { accessLevel: string; scope: string; submodules: string }>>({});
  const [isRealmSaving, setIsRealmSaving] = useState(false);

  // Form State
  const [roleName, setRoleName] = useState('');
  const [roleDesc, setRoleDesc] = useState('');

  // Fetch Realm of Operation Permissions on role selection
  useEffect(() => {
    if (selectedRoleForRealm && profile?.tenantId) {
      const docId = `${profile.tenantId}_${selectedRoleForRealm.name.replace(/\s+/g, '_').toLowerCase()}`;
      const docRef = doc(db, 'role_realms_of_operation', docId);
      getDoc(docRef)
        .then(docSnap => {
          if (docSnap.exists() && docSnap.data().permissions) {
            setRealmPermissions(docSnap.data().permissions);
          } else {
            // Default initial state based on the selected role's standard privilege
            const initialPerms: Record<string, any> = {};
            const isFullPower = ['owner', 'ceo', 'ceo / md'].includes(selectedRoleForRealm.name.toLowerCase());
            SYSTEM_MODULES.forEach(mod => {
              initialPerms[mod.id] = {
                accessLevel: isFullPower ? 'view_functional' : 'none',
                scope: 'all',
                submodules: ''
              };
            });
            setRealmPermissions(initialPerms);
          }
        })
        .catch(err => {
          console.error("Error loading realm permissions:", err);
          toast.error("Failed to load custom permission realms");
        });
    }
  }, [selectedRoleForRealm, profile?.tenantId]);

  const handleSaveRealmOfOperation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId || !selectedRoleForRealm) return;

    setIsRealmSaving(true);
    try {
      const docId = `${profile.tenantId}_${selectedRoleForRealm.name.replace(/\s+/g, '_').toLowerCase()}`;
      const docRef = doc(db, 'role_realms_of_operation', docId);

      const payload = {
        tenantId: profile.tenantId,
        roleName: selectedRoleForRealm.name,
        roleLabel: selectedRoleForRealm.label,
        permissions: realmPermissions,
        updatedAt: new Date().toISOString(),
        updatedBy: profile.full_name || profile.email || 'IT Manager'
      };

      await setDoc(docRef, payload, { merge: true });
      toast.success(`Realm of Operation for "${selectedRoleForRealm.label}" saved successfully!`);
      setSelectedRoleForRealm(null);
    } catch (err) {
      console.error("Error saving realm permissions:", err);
      toast.error("Failed to save Realm of Operation config.");
    } finally {
      setIsRealmSaving(false);
    }
  };

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubStaff = firestoreService.subscribeToCollection<Staff>(
        'staff',
        profile.tenantId,
        setStaff
      );
      const unsubRoles = firestoreService.subscribeToCollection<CustomRole>(
        'hr_roles',
        profile.tenantId,
        setCustomRoles
      );
      return () => {
        unsubStaff();
        unsubRoles();
      };
    }
  }, [profile?.tenantId]);

  // Combine Default System Roles and Custom Roles
  const systemRolesMapped = DEFAULT_ROLES_LIST.map(role => ({
    id: `system-${role.name}`,
    tenantId: profile?.tenantId || '',
    name: role.name, // internal key
    label: role.label, // readable label
    description: role.description,
    isCustom: false,
    created_at: '',
    created_by: 'System'
  }));

  const customRolesMapped = customRoles.map(role => ({
    id: role.id,
    tenantId: role.tenantId,
    name: role.name, // both the same for custom roles
    label: role.name,
    description: role.description,
    isCustom: true,
    created_at: role.created_at,
    created_by: role.created_by
  }));

  const allRolesCombined = [...systemRolesMapped, ...customRolesMapped];

  const filteredRoles = allRolesCombined.filter(r => 
    r.label.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStaffCountForRole = (roleName: string) => {
    return staff.filter(s => s.role?.toLowerCase() === roleName.toLowerCase()).length;
  };

  const handleCreateOrUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId) return;

    if (!roleName.trim()) {
      toast.error('Role name is required');
      return;
    }

    // Check if name conflict exists in system roles
    const nameLower = roleName.trim().toLowerCase();
    const isSystemConflict = DEFAULT_ROLES_LIST.some(r => r.name.toLowerCase() === nameLower || r.label.toLowerCase() === nameLower);
    const isCustomConflict = customRoles.some(r => r.id !== editingRole?.id && r.name.toLowerCase() === nameLower);

    if (isSystemConflict || isCustomConflict) {
      toast.error('A role with this name already exists.');
      return;
    }

    try {
      if (editingRole) {
        await firestoreService.updateDocument('hr_roles', editingRole.id, {
          name: roleName.trim(),
          description: roleDesc.trim(),
        });
        toast.success('Role updated successfully');
      } else {
        await firestoreService.addDocument('hr_roles', {
          tenantId: profile.tenantId,
          name: roleName.trim(),
          description: roleDesc.trim(),
          isCustom: true,
          created_at: new Date().toISOString(),
          created_by: profile.full_name || profile.displayName || 'Manager'
        });
        toast.success('New role created successfully');
      }
      setIsModalOpen(false);
      resetForm();
    } catch (error) {
      toast.error('Failed to save role');
    }
  };

  const handleDeleteRole = async (roleId: string, roleName: string) => {
    const assignedCount = getStaffCountForRole(roleName);
    if (assignedCount > 0) {
      toast.error(`Cannot delete role "${roleName}" because ${assignedCount} staff member(s) are currently assigned to it.`);
      return;
    }

    if (window.confirm(`Are you sure you want to delete the custom role "${roleName}"?`)) {
      try {
        await firestoreService.deleteDocument('hr_roles', roleId);
        toast.success('Role deleted');
      } catch (error) {
        toast.error('Failed to delete role');
      }
    }
  };

  const openEditModal = (role: typeof customRolesMapped[0]) => {
    const originalRole = customRoles.find(r => r.id === role.id);
    if (originalRole) {
      setEditingRole(originalRole);
      setRoleName(originalRole.name);
      setRoleDesc(originalRole.description);
      setIsModalOpen(true);
    }
  };

  const resetForm = () => {
    setEditingRole(null);
    setRoleName('');
    setRoleDesc('');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total System Roles</p>
            <p className="text-2xl font-bold text-slate-900">{DEFAULT_ROLES_LIST.length}</p>
          </div>
          <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-500">
            <Shield size={20} />
          </div>
        </div>

        <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Custom Created Roles</p>
            <p className="text-2xl font-bold text-slate-900">{customRoles.length}</p>
          </div>
          <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Briefcase size={20} />
          </div>
        </div>

        <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Active Staff Members</p>
            <p className="text-2xl font-bold text-slate-900">{staff.length}</p>
          </div>
          <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Users size={20} />
          </div>
        </div>
      </div>

      {/* Control Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Staff Roles Directory</h2>
          <p className="text-xs text-slate-400 font-bold uppercase mt-1">Manage static system profiles and create custom workforce designations.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Search roles..." 
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none w-64 text-sm font-semibold text-slate-700"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={() => {
              resetForm();
              setIsModalOpen(true);
            }}
            className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-slate-200 text-sm"
          >
            <Plus size={18} />
            Create Role
          </button>
        </div>
      </div>

      {/* Roles Master Table */}
      <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 bg-slate-50/50">
                <th className="px-6 py-4">Role Profile & Name</th>
                <th className="px-6 py-4">Designation Type</th>
                <th className="px-6 py-4">Job Description</th>
                <th className="px-6 py-4 text-center">Assigned Staff</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRoles.map((role) => {
                const assignedCount = getStaffCountForRole(role.name);
                return (
                  <tr key={role.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center transition-colors group-hover:bg-indigo-50",
                          role.isCustom ? "text-indigo-600" : "text-slate-400"
                        )}>
                          <Briefcase size={20} />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{role.label}</p>
                          <p className="text-[9px] font-black tracking-wider text-slate-400 uppercase">Code: {role.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {role.isCustom ? (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-100">
                          Custom Role
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
                          System Default
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 max-w-sm">
                      <p className="text-sm font-semibold text-slate-600 truncate" title={role.description}>
                        {role.description || '-'}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className={cn(
                        "inline-flex items-center justify-center font-bold px-3 py-1 rounded-full text-xs",
                        assignedCount > 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-slate-50 text-slate-400"
                      )}>
                        {assignedCount} Assigned
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => setSelectedRoleForRealm(role)}
                          className="px-2.5 py-1 text-indigo-600 hover:text-white bg-indigo-50 hover:bg-indigo-600 rounded-lg text-xs font-bold transition-all flex items-center gap-1 border border-indigo-100"
                          title="Configure module permissions, functions, and submodule scope for this role."
                        >
                          <Shield size={12} />
                          <span>Realm</span>
                        </button>

                        {role.isCustom ? (
                          <>
                            <button 
                              onClick={() => openEditModal(role)}
                              className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                              title="Edit Role Settings"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button 
                              onClick={() => handleDeleteRole(role.id, role.name)}
                              className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                              title="Delete Role Designation"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        ) : (
                          <span className="text-[9px] text-slate-400 font-black uppercase tracking-wider pl-1 select-none opacity-40">System</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRoles.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    <HelpCircle className="mx-auto text-slate-300 mb-2" size={32} />
                    <p className="font-bold text-sm">No roles found matching "{searchTerm}"</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Role Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                {editingRole ? 'Edit Custom Role' : 'Create Custom Role'}
              </h2>
              <button 
                onClick={() => {
                  setIsModalOpen(false);
                  resetForm();
                }} 
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreateOrUpdateRole}>
              <div className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Role Designation Name *</label>
                  <input 
                    required 
                    type="text" 
                    placeholder="e.g. Registered Nurse, Assistant Dispenser" 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-bold text-slate-900 text-sm"
                    value={roleName} 
                    onChange={(e) => setRoleName(e.target.value)} 
                  />
                  <p className="text-[10px] text-zinc-400 font-medium">Use a distinct human-readable title. This title will be selectable in the Staff Registry.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Job Description</label>
                  <textarea 
                    rows={3}
                    placeholder="Describe main responsibilities and domain authorizations of this staff designation..." 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-semibold text-slate-700 text-sm resize-none"
                    value={roleDesc} 
                    onChange={(e) => setRoleDesc(e.target.value)} 
                  />
                </div>
              </div>

              <div className="px-8 py-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 rounded-b-[32px]">
                <button 
                  type="button" 
                  onClick={() => {
                    setIsModalOpen(false);
                    resetForm();
                  }} 
                  className="px-6 py-2.5 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors uppercase text-[10px] tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-8 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold transition-all shadow-lg shadow-slate-200 uppercase text-[10px] tracking-widest flex items-center gap-2"
                >
                  <Save size={14} />
                  {editingRole ? 'Update Role' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Realm of Operation Modal */}
      {selectedRoleForRealm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 my-8 flex flex-col max-h-[90vh]">
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                    Realm of Operation: {selectedRoleForRealm.label}
                  </h2>
                  <p className="text-xs text-slate-400 font-bold uppercase mt-0.5">
                    Define access permissions, active functions and sub-modules for this designation.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedRoleForRealm(null)} 
                className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveRealmOfOperation} className="flex-1 overflow-y-auto p-8 space-y-6">
              <div className="bg-amber-50 border border-amber-200/60 p-4 rounded-2xl flex gap-3 text-amber-800">
                <AlertCircle className="flex-shrink-0 text-amber-600" size={20} />
                <div className="text-xs">
                  <p className="font-bold uppercase tracking-wider mb-1">Operational Realm Enforcement Directive</p>
                  <p className="font-semibold leading-relaxed">
                    Changes applied here affect all system users logged under this role. Ensure designated personnel are notified before making bulk role permission updates.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-12 gap-4 text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">
                  <div className="col-span-4">Module Name</div>
                  <div className="col-span-3 text-center">Access Level</div>
                  <div className="col-span-2 text-center">Scope Reach</div>
                  <div className="col-span-3">Submodule Scope (if specific)</div>
                </div>

                <div className="divide-y divide-slate-100 border border-slate-200/60 rounded-3xl overflow-hidden bg-slate-50/20">
                  {SYSTEM_MODULES.map((mod) => {
                    const perm = realmPermissions[mod.id] || { accessLevel: 'none', scope: 'all', submodules: '' };
                    return (
                      <div key={mod.id} className={cn(
                        "grid grid-cols-12 gap-4 items-center p-4 transition-all",
                        perm.accessLevel === 'none' ? 'bg-slate-50/40 opacity-70' : 'bg-white'
                      )}>
                        {/* Module Name & Info */}
                        <div className="col-span-4">
                          <p className="font-bold text-sm text-slate-900">{mod.name}</p>
                          <p className="text-[10px] text-slate-400 font-semibold truncate" title={mod.submodules}>
                            Submodules: {mod.submodules}
                          </p>
                        </div>

                        {/* Access Level Selector */}
                        <div className="col-span-3 flex justify-center">
                          <div className="bg-slate-100 p-1 rounded-xl flex gap-1 w-full max-w-[240px]">
                            <button
                              type="button"
                              onClick={() => {
                                setRealmPermissions(prev => ({
                                  ...prev,
                                  [mod.id]: { ...perm, accessLevel: 'none' }
                                }));
                              }}
                              className={cn(
                                "flex-1 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                                perm.accessLevel === 'none' 
                                  ? "bg-slate-800 text-white shadow-sm" 
                                  : "text-slate-500 hover:text-slate-800"
                              )}
                            >
                              None
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRealmPermissions(prev => ({
                                  ...prev,
                                  [mod.id]: { ...perm, accessLevel: 'view_only' }
                                }));
                              }}
                              className={cn(
                                "flex-1 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                                perm.accessLevel === 'view_only' 
                                  ? "bg-amber-500 text-white shadow-sm" 
                                  : "text-slate-500 hover:text-amber-600"
                              )}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRealmPermissions(prev => ({
                                  ...prev,
                                  [mod.id]: { ...perm, accessLevel: 'view_functional' }
                                }));
                              }}
                              className={cn(
                                "flex-1 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                                perm.accessLevel === 'view_functional' 
                                  ? "bg-emerald-600 text-white shadow-sm" 
                                  : "text-slate-500 hover:text-emerald-600"
                              )}
                            >
                              Full
                            </button>
                          </div>
                        </div>

                        {/* Scope Reach */}
                        <div className="col-span-2 flex justify-center">
                          <select
                            disabled={perm.accessLevel === 'none'}
                            className="text-xs font-bold py-1 px-2 border border-slate-200 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            value={perm.scope || 'all'}
                            onChange={(e) => {
                              setRealmPermissions(prev => ({
                                ...prev,
                                [mod.id]: { ...perm, scope: e.target.value }
                              }));
                            }}
                          >
                            <option value="all">Full Module</option>
                            <option value="specific">Submodule</option>
                          </select>
                        </div>

                        {/* Specific Submodule Input */}
                        <div className="col-span-3">
                          <input
                            type="text"
                            disabled={perm.accessLevel === 'none' || perm.scope === 'all'}
                            placeholder="e.g. POS Billing ONLY"
                            className="w-full text-xs font-semibold py-1 px-3 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 outline-none disabled:bg-slate-100 disabled:text-slate-400 placeholder:text-slate-300"
                            value={perm.submodules || ''}
                            onChange={(e) => {
                              setRealmPermissions(prev => ({
                                ...prev,
                                [mod.id]: { ...perm, submodules: e.target.value }
                              }));
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="pt-4 border-t border-slate-100 flex justify-end gap-3 flex-shrink-0">
                <button 
                  type="button" 
                  onClick={() => setSelectedRoleForRealm(null)} 
                  className="px-6 py-2.5 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors uppercase text-[10px] tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isRealmSaving}
                  className="px-8 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white rounded-xl font-bold transition-all shadow-lg shadow-slate-200 uppercase text-[10px] tracking-widest flex items-center gap-2"
                >
                  {isRealmSaving ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <Save size={14} />
                      <span>Save Realm Configuration</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
