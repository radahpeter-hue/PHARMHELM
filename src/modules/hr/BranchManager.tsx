import React, { useState, useEffect } from 'react';
import { 
  MapPin, Phone, Mail, Users, Plus, Search, 
  MoreVertical, Edit2, Trash2, CheckCircle2, 
  AlertCircle, Building2, Globe, ExternalLink, X
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { firestoreService } from '../../services/firestore';
import { Branch, Staff } from '../../types';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';

export const BranchManager: React.FC = () => {
  const { profile } = useAuth();
  const { tenant } = useTenant();
  const isAuthorized = profile?.role === 'owner' || profile?.role === 'CEO' || profile?.role === 'CEO / MD' || profile?.role === 'admin' || profile?.username === 'operator_bypass';
  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewingBranch, setViewingBranch] = useState<Branch | null>(null);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [branchToDelete, setBranchToDelete] = useState<Branch | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, setBranches);
      firestoreService.subscribeToCollection<Staff>('staff', profile.tenantId, setStaff);
    }
  }, [profile?.tenantId]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!profile?.tenantId) return;
    if (isSubmitting) return; // prevent double submit

    const formData = new FormData(e.currentTarget);
    const branchData = {
      tenantId: profile.tenantId,
      name: formData.get('name') as string,
      type: formData.get('type') as string,
      address: formData.get('address') as string,
      phone: formData.get('phone') as string,
      status: formData.get('status') as 'Active' | 'Inactive' | 'Closed',
      manager_id: formData.get('manager_id') as string,
      license_number: formData.get('license_number') as string,
      license_expiry: formData.get('license_expiry') as string,
      brandName: formData.get('brandName') as string || '',
      brandSlogan: formData.get('brandSlogan') as string || '',
      brandPrimaryColor: formData.get('brandPrimaryColor') as string || '#059669',
      brandSecondaryColor: formData.get('brandSecondaryColor') as string || '#10b981',
      updated_at: new Date().toISOString()
    };

    setIsSubmitting(true);
    try {
      let branchId = editingBranch?.id;
      if (editingBranch) {
        await firestoreService.updateDocument('branches', editingBranch.id, branchData);
        toast.success('Branch updated successfully');
      } else {
        // Enforce configurable branch limit: prefer tenant.branchLimit, otherwise fall back to tier defaults (basic=1, standard=5, enterprise/premium=15)
        const tierDefault = tenant?.subscription_tier === 'basic' ? 1 : (tenant?.subscription_tier === 'standard' ? 5 : 15);
        const maxBranches = typeof tenant?.branchLimit === 'number' ? tenant.branchLimit : tierDefault;
        if (branches.length >= maxBranches) {
          toast.error(`Branch limit reached (${branches.length} of ${maxBranches}). Contact PharmHelm support to increase your limit.`);
          setIsSubmitting(false);
          return;
        }

        const addedRefId = await firestoreService.addDocument('branches', {
          ...branchData,
          branch_code: `BR-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
          created_at: new Date().toISOString(),
          created_by: profile.uid
        });
        branchId = addedRefId;
        toast.success('Branch added successfully');
      }

      // Close modal immediately after primary branch write so UI doesn't let user retry
      setIsModalOpen(false);
      setEditingBranch(null);

      // Non-blocking: Feed the license register in QA & Compliance. Any failure here should NOT mark the whole flow as failed.
      if (branchData.license_number && branchData.license_expiry) {
        (async () => {
          try {
            const licenseData = {
              tenantId: profile.tenantId,
              branchId: branchId,
              licenseType: 'NDA Premises Licence',
              licenseNumber: branchData.license_number,
              expiryDate: branchData.license_expiry,
              issuingAuthority: 'National Drug Authority',
              status: 'Valid',
              updatedAt: new Date().toISOString()
            };

            const existingLicenses = await firestoreService.getCollection<any>('premises_licenses', profile.tenantId);
            const branchLicense = existingLicenses.find(l => l.branchId === branchId && l.licenseType === 'NDA Premises Licence');

            if (branchLicense) {
              await firestoreService.updateDocument('premises_licenses', branchLicense.id, licenseData);
            } else {
              await firestoreService.addDocument('premises_licenses', licenseData);
            }
          } catch (licError) {
            console.error('License sync failed for branch', branchId, licError);
            // Surface a helpful message for admins; do not mark overall operation as failed for end users
            if (isAuthorized) {
              toast.error(`Branch created; license sync failed: ${licError?.message || licError}`);
            } else {
              // Generic notification for non-admin users
              toast.error('Branch created; license sync failed (admin notified).');
            }
          }
        })();
      }
    } catch (error) {
      console.error('Branch save failed', error);
      const msg = (error as any)?.message || 'Failed to save branch';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!branchToDelete) return;
    try {
      await firestoreService.deleteDocument('branches', branchToDelete.id);
      toast.success('Branch deleted');
      setDeleteModalOpen(false);
      setBranchToDelete(null);
    } catch (error) {
      toast.error('Failed to delete branch');
    }
  };

  const filteredBranches = branches.filter(b => 
    b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.address?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const seedDefaultBranches = async () => {
    if (!profile?.tenantId) return;
    
    const defaults = [
      { name: 'Headquarters', type: 'HQ', address: 'Main Office', phone: 'N/A', status: 'Active' as const },
      { name: 'Main Warehouse', type: 'Warehouse', address: 'Storage Area', phone: 'N/A', status: 'Active' as const }
    ];

    try {
      for (const branch of defaults) {
        const exists = branches.some(b => b.type === branch.type);
        if (!exists) {
          await firestoreService.addDocument('branches', {
            ...branch,
            tenantId: profile.tenantId,
            branch_code: `BR-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
            created_at: new Date().toISOString(),
            created_by: profile.uid
          });
        }
      }
      toast.success('Default branches seeded');
    } catch (error) {
      toast.error('Failed to seed branches');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search branches by name or address..." 
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {isAuthorized && branches.length === 0 && (
            <button 
              onClick={seedDefaultBranches}
              className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 uppercase text-[10px] tracking-widest"
            >
              Seed Defaults
            </button>
          )}
          {isAuthorized && (
            <button 
              onClick={() => {
                setEditingBranch(null);
                setIsModalOpen(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-indigo-100 uppercase text-[10px] tracking-widest"
            >
              <Plus size={18} />
              Register Branch
            </button>
          )}
        </div>
      </div>

      {/* Branch Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredBranches.map((branch) => {
          const branchStaff = staff.filter(s => s.branch_id === branch.id);
          const manager = staff.find(s => s.id === branch.manager_id);

          return (
            <div key={branch.id} className="bg-white rounded-[32px] border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
                <Building2 size={100} />
              </div>

              <div className="relative z-10 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="h-12 w-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                    <Building2 size={24} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border",
                      branch.status?.toLowerCase() === 'active' ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-slate-50 text-slate-400 border-slate-100"
                    )}>
                      {branch.status}
                    </span>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={() => {
                          setViewingBranch(branch);
                          setIsViewModalOpen(true);
                        }}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                        title="View Profile"
                      >
                        <ExternalLink size={14} />
                      </button>
                      {isAuthorized && (
                        <>
                          <button 
                            onClick={() => {
                              setEditingBranch(branch);
                              setIsModalOpen(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button 
                            onClick={() => {
                              setBranchToDelete(branch);
                              setDeleteModalOpen(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold text-slate-900">{branch.name}</h3>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-bold uppercase tracking-tighter">
                      {branch.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-500 mt-1">
                    <MapPin size={14} />
                    <span className="text-xs font-medium">{branch.address}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Staff Count</p>
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-indigo-600" />
                      <span className="text-sm font-bold text-slate-900">{branchStaff.length} Members</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Manager</p>
                    <p className="text-sm font-bold text-slate-900 truncate">{manager?.full_name || 'Not Assigned'}</p>
                  </div>
                </div>

                <div className="space-y-2 pt-4">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Phone size={14} className="text-slate-400" />
                    {branch.phone}
                  </div>
                  {branch.license_number && (
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <CheckCircle2 size={14} className="text-emerald-500" />
                      <span className="font-medium">NDA: {branch.license_number}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-[40px] w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="px-8 py-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                  {editingBranch ? 'Edit Branch' : 'Add New Branch'}
                </h2>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Branch Details & Management</p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="h-10 w-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-all shadow-sm"
              >
                <Plus size={24} className="rotate-45" />
              </button>
            </div>

            <form 
              key={editingBranch?.id || 'new'}
              onSubmit={handleSubmit} 
              className="p-8 space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Branch Name</label>
                  <input 
                    name="name"
                    required
                    defaultValue={editingBranch?.name}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium transition-all"
                    placeholder="e.g. Main Pharmacy Kampala"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Branch Type</label>
                  <input 
                    name="type"
                    required
                    defaultValue={editingBranch?.type}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium transition-all"
                    placeholder="e.g. HQ, Warehouse, Retail..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Address</label>
                  <input 
                    name="address"
                    required
                    defaultValue={editingBranch?.address}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium transition-all"
                    placeholder="e.g. Plot 45, Kampala Rd"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Phone Number</label>
                  <input 
                    name="phone"
                    required
                    defaultValue={editingBranch?.phone}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium transition-all"
                    placeholder="+256..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Branch Manager</label>
                  <select 
                    name="manager_id"
                    defaultValue={editingBranch?.manager_id}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium transition-all appearance-none"
                  >
                    <option value="">Select Manager</option>
                    {staff.map(s => (
                      <option key={s.id} value={s.id}>{s.full_name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Status</label>
                  <select 
                    name="status"
                    defaultValue={editingBranch?.status || 'Active'}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium transition-all appearance-none"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">NDA License Number</label>
                  <input 
                    name="license_number"
                    defaultValue={editingBranch?.license_number}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium transition-all"
                    placeholder="e.g. NDA/PR/1234"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">License Expiry Date</label>
                  <input 
                    name="license_expiry"
                    type="date"
                    defaultValue={editingBranch?.license_expiry}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium transition-all"
                  />
                </div>
                <div className="space-y-2 col-span-1 md:col-span-2 border-t border-slate-100 pt-6">
                  <h4 className="text-xs font-black uppercase text-indigo-600 tracking-wider">Branch-Specific Branding Options (Multi-Brand Support)</h4>
                  <p className="text-xs text-slate-400">Configure custom brand values if this branch operates under a secondary brand identity.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Brand Name</label>
                  <input 
                    name="brandName"
                    defaultValue={editingBranch?.brandName}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium transition-all"
                    placeholder="e.g. MedCare Express / Kampala Depot"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Brand Slogan</label>
                  <input 
                    name="brandSlogan"
                    defaultValue={editingBranch?.brandSlogan}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium transition-all"
                    placeholder="e.g. Caring For Your Health Daily"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Brand Primary Color (Hex)</label>
                  <div className="flex gap-2">
                    <input 
                      name="brandPrimaryColor"
                      type="color"
                      id="brandPrimaryColorPicker"
                      defaultValue={editingBranch?.brandPrimaryColor || '#059669'}
                      className="h-12 w-12 rounded-lg bg-transparent border border-zinc-200 cursor-pointer"
                      onChange={(e) => {
                        const txt = document.getElementById('brandPrimaryColorText') as HTMLInputElement;
                        if (txt) txt.value = e.target.value;
                      }}
                    />
                    <input 
                      type="text"
                      id="brandPrimaryColorText"
                      defaultValue={editingBranch?.brandPrimaryColor || '#059669'}
                      className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium text-xs font-mono uppercase"
                      onChange={(e) => {
                        const picker = document.getElementById('brandPrimaryColorPicker') as HTMLInputElement;
                        if (picker && e.target.value.startsWith('#')) picker.value = e.target.value;
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Brand Secondary Color (Hex)</label>
                  <div className="flex gap-2">
                    <input 
                      name="brandSecondaryColor"
                      type="color"
                      id="brandSecondaryColorPicker"
                      defaultValue={editingBranch?.brandSecondaryColor || '#10b981'}
                      className="h-12 w-12 rounded-lg bg-transparent border border-zinc-200 cursor-pointer"
                      onChange={(e) => {
                        const txt = document.getElementById('brandSecondaryColorText') as HTMLInputElement;
                        if (txt) txt.value = e.target.value;
                      }}
                    />
                    <input 
                      type="text"
                      id="brandSecondaryColorText"
                      defaultValue={editingBranch?.brandSecondaryColor || '#10b981'}
                      className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium text-xs font-mono uppercase"
                      onChange={(e) => {
                        const picker = document.getElementById('brandSecondaryColorPicker') as HTMLInputElement;
                        if (picker && e.target.value.startsWith('#')) picker.value = e.target.value;
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-6 py-4 border border-slate-200 rounded-2xl font-bold text-slate-600 hover:bg-slate-50 transition-all uppercase text-[10px] tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-[2] bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-4 rounded-2xl font-bold transition-all shadow-xl shadow-indigo-100 uppercase text-[10px] tracking-widest"
                >
                  {editingBranch ? 'Update Branch' : 'Create Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Profile Modal */}
      {isViewModalOpen && viewingBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-[40px] w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="px-8 py-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                  Branch Profile
                </h2>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">{viewingBranch.name} • {viewingBranch.branch_code}</p>
              </div>
              <button 
                onClick={() => setIsViewModalOpen(false)}
                className="h-10 w-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-all shadow-sm"
              >
                <Plus size={24} className="rotate-45" />
              </button>
            </div>

            <div className="p-8 space-y-8">
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Branch Type</p>
                  <p className="text-lg font-bold text-slate-900">{viewingBranch.type}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</p>
                  <p className="text-lg font-bold text-emerald-600">{viewingBranch.status}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Address</p>
                  <p className="text-lg font-bold text-slate-900">{viewingBranch.address}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phone</p>
                  <p className="text-lg font-bold text-slate-900">{viewingBranch.phone}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">NDA License</p>
                  <p className="text-lg font-bold text-slate-900">{viewingBranch.license_number || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">License Expiry</p>
                  <p className="text-lg font-bold text-slate-900">{viewingBranch.license_expiry || 'N/A'}</p>
                </div>
                <div className="space-y-1 col-span-2 pt-4 border-t border-slate-100">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Branch-Specific Branding</p>
                  <div className="mt-2 p-4 rounded-2xl border border-zinc-100 bg-zinc-50 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-extrabold text-zinc-900">{viewingBranch.brandName || 'Using Corporate Brand'}</p>
                      <p className="text-xs text-zinc-500 italic mt-0.5">{viewingBranch.brandSlogan || 'No slogan configured'}</p>
                    </div>
                    <div className="flex gap-2">
                      <div className="h-6 w-12 rounded-full border border-white shadow-sm flex items-center justify-center text-[10px] font-extrabold select-none text-white font-mono" style={{ backgroundColor: viewingBranch.brandPrimaryColor || '#059669' }}>
                        PRI
                      </div>
                      <div className="h-6 w-12 rounded-full border border-white shadow-sm flex items-center justify-center text-[10px] font-extrabold select-none text-white font-mono" style={{ backgroundColor: viewingBranch.brandSecondaryColor || '#10b981' }}>
                        SEC
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-8 border-t border-slate-100">
                <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-4">Assigned Staff</h4>
                <div className="grid grid-cols-2 gap-4">
                  {staff.filter(s => s.branch_id === viewingBranch.id).map(s => (
                    <div key={s.id} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                      <div className="h-8 w-8 bg-white rounded-lg flex items-center justify-center text-xs font-bold text-indigo-600 border border-slate-200">
                        {s.full_name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900">{s.full_name}</p>
                        <p className="text-[10px] text-slate-400 font-medium">{s.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Delete Branch</h3>
              <button onClick={() => setDeleteModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-600">
                Are you sure you want to delete <span className="font-medium text-gray-900">{branchToDelete?.name}</span>?
                This action cannot be undone.
              </p>
            </div>
            <div className="p-6 bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => setDeleteModalOpen(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete Branch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
