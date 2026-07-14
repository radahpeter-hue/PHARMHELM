import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  Users, 
  ToggleLeft, 
  Settings as SettingsIcon, 
  Database, 
  FileText, 
  History, 
  HeartPulse,
  ChevronRight,
  Plus,
  Edit2,
  Trash2,
  Key,
  X,
  Check,
  Loader2
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import { firestoreService } from '../services/firestore';
import { Staff, Branch, PendingActivation } from '../types';
import { toast } from 'sonner';
import { cn } from '../utils/cn';

const domains = [
  { id: 'deployment', label: 'Deployment Mode', icon: Shield },
  { id: 'identity', label: 'Identity & Access', icon: Users },
  { id: 'pending', label: 'Pending Activations', icon: Key },
  { id: 'toggles', label: 'Feature Toggles', icon: ToggleLeft },
  { id: 'config', label: 'Operational Config', icon: SettingsIcon },
  { id: 'registries', label: 'Master Registries', icon: Database },
  { id: 'branding', label: 'Documents & Branding', icon: FileText },
  { id: 'audit', label: 'Global Audit Log', icon: History },
  { id: 'health', label: 'System Health', icon: HeartPulse },
];

export const SettingsModule: React.FC = () => {
  const { profile } = useAuth();
  const [activeDomain, setActiveDomain] = useState('deployment');
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [pendingActivations, setPendingActivations] = useState<PendingActivation[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [selectedActivation, setSelectedActivation] = useState<PendingActivation | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  useEffect(() => {
    if (profile?.tenantId) {
      if (activeDomain === 'identity') {
        const unsubStaff = firestoreService.subscribeToCollection<Staff>(
          'staff',
          profile.tenantId,
          setStaffList
        );
        const unsubBranches = firestoreService.subscribeToCollection<Branch>(
          'branches',
          profile.tenantId,
          setBranches
        );
        return () => {
          unsubStaff();
          unsubBranches();
        };
      }
      if (activeDomain === 'pending') {
        const unsubPending = firestoreService.subscribeToCollection<PendingActivation>(
          'pending_activations',
          profile.tenantId,
          (data) => setPendingActivations(data.filter(a => a.status === 'pending'))
        );
        return () => unsubPending();
      }
    }
  }, [profile?.tenantId, activeDomain]);

  const handleSetPassword = async () => {
    if (!selectedStaff || !newPassword) return;
    setLoading(true);
    try {
      // Update staff record
      await firestoreService.updateDocument('staff', selectedStaff.id, {
        password: newPassword,
        password_set: true,
        active: true,
        status: 'active'
      });

      // Update pending activation record if it exists
      const activation = pendingActivations.find(a => a.staffId === selectedStaff.id);
      if (activation) {
        await firestoreService.updateDocument('pending_activations', activation.id, {
          status: 'activated',
          activatedAt: new Date().toISOString(),
          activatedBy: profile?.uid
        });
      }

      toast.success(`Password set for ${selectedStaff.full_name}. Account activated.`);
      setIsPasswordModalOpen(false);
      setNewPassword('');
      setSelectedStaff(null);
      setSelectedActivation(null);
    } catch (error) {
      toast.error('Failed to set password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-8 h-full">
      {/* Domain Sidebar */}
      <div className="w-64 space-y-1">
        {domains.map((domain) => (
          <button
            key={domain.id}
            onClick={() => setActiveDomain(domain.id)}
            className={clsx(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left",
              activeDomain === domain.id 
                ? "bg-pharm-primary text-white shadow-lg shadow-pharm-primary/20" 
                : "text-white/60 hover:text-white hover:bg-white/5"
            )}
          >
            <domain.icon size={20} />
            <span className="font-medium text-sm">{domain.label}</span>
          </button>
        ))}
      </div>

      {/* Domain Content */}
      <div className="flex-1 min-w-0">
        <div className="pharm-card h-full p-8 overflow-y-auto">
          {activeDomain === 'deployment' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-display font-bold mb-2">Deployment Mode</h2>
                <p className="text-white/40 text-sm">Configure branch architecture and ledger isolation.</p>
              </div>

              <div className="p-6 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">Multi-Branch Mode</h3>
                  <p className="text-sm text-white/40 mt-1">Full enterprise architecture active with inter-branch transfers.</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-pharm-primary uppercase tracking-widest">Active</span>
                  <div className="w-12 h-6 bg-pharm-primary rounded-full relative cursor-pointer">
                    <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeDomain === 'pending' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-display font-bold mb-2">Pending Activations</h2>
                <p className="text-white/40 text-sm">Finalize login details for new staff members registered by HR.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {pendingActivations.map((activation) => (
                  <div key={activation.id} className="p-6 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between group hover:border-pharm-primary/50 transition-all">
                    <div>
                      <h3 className="font-bold text-lg">{activation.name}</h3>
                      <p className="text-xs text-pharm-primary font-mono mt-1 uppercase tracking-widest">{activation.role}</p>
                      <p className="text-[10px] text-white/40 mt-2">Requested: {new Date(activation.requestedAt).toLocaleDateString()}</p>
                    </div>
                    <button 
                      onClick={async () => {
                        const staff = await firestoreService.getDocument<Staff>('staff', activation.staffId);
                        if (staff) {
                          setSelectedStaff(staff);
                          setSelectedActivation(activation);
                          setIsPasswordModalOpen(true);
                        }
                      }}
                      className="bg-pharm-primary hover:bg-pharm-primary/80 text-white px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-lg shadow-pharm-primary/20"
                    >
                      Activate Login
                    </button>
                  </div>
                ))}
                {pendingActivations.length === 0 && (
                  <div className="col-span-full py-20 text-center border-2 border-dashed border-white/5 rounded-[32px]">
                    <Key size={48} className="mx-auto mb-4 text-white/10" />
                    <p className="text-white/40 font-medium">No pending activations found.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeDomain === 'identity' && (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-display font-bold mb-2">Identity & Access</h2>
                  <p className="text-white/40 text-sm">Manage staff accounts, usernames, and passwords.</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="pb-4 font-semibold text-sm text-white/40">Staff Member</th>
                      <th className="pb-4 font-semibold text-sm text-white/40">Username</th>
                      <th className="pb-4 font-semibold text-sm text-white/40">Role</th>
                      <th className="pb-4 font-semibold text-sm text-white/40">Primary Branch</th>
                      <th className="pb-4 font-semibold text-sm text-white/40">Auth Status</th>
                      <th className="pb-4"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {staffList.map((staff) => (
                      <tr key={staff.id} className="group hover:bg-white/5 transition-colors">
                        <td className="py-4 font-medium">{staff.full_name}</td>
                        <td className="py-4 text-sm text-pharm-primary font-mono">{staff.username}</td>
                        <td className="py-4 text-sm text-white/60">{staff.role}</td>
                        <td className="py-4 text-sm text-white/60">
                          {branches.find(b => b.id === staff.branch_id)?.name || 'Unassigned'}
                        </td>
                        <td className="py-4">
                          <span className={clsx(
                            "text-[10px] px-2 py-0.5 rounded font-bold uppercase",
                            staff.password_set ? "bg-emerald-500/20 text-emerald-400" : "bg-orange-500/20 text-orange-400"
                          )}>
                            {staff.password_set ? 'Activated' : 'Pending IT'}
                          </span>
                        </td>
                        <td className="py-4 text-right">
                          <button 
                            onClick={() => {
                              setSelectedStaff(staff);
                              setIsPasswordModalOpen(true);
                            }}
                            className="p-2 text-white/40 hover:text-pharm-primary transition-colors flex items-center gap-2 ml-auto"
                            title="Set Password"
                          >
                            <Key size={16} />
                            <span className="text-xs font-bold uppercase tracking-wider">Set Password</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {isPasswordModalOpen && selectedStaff && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-zinc-900 w-full max-w-md rounded-3xl border border-white/10 shadow-2xl p-8 animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold">Activate Account</h3>
                  <button onClick={() => setIsPasswordModalOpen(false)} className="text-white/40 hover:text-white">
                    <X size={24} />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <p className="text-xs text-white/40 uppercase font-bold tracking-widest mb-1">Staff Member</p>
                    <p className="font-bold">{selectedStaff.full_name}</p>
                    <p className="text-xs text-pharm-primary font-mono mt-1">@{selectedStaff.username}</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-white/40 uppercase tracking-wider">Set New Password</label>
                    <input 
                      type="password" 
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-pharm-primary/20 outline-none"
                      placeholder="Enter secure password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>

                  <button 
                    onClick={handleSetPassword}
                    disabled={loading || !newPassword}
                    className="w-full py-3 bg-pharm-primary text-white rounded-xl font-bold hover:bg-pharm-primary/80 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
                    {loading ? 'Activating...' : 'Activate & Save Credentials'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeDomain === 'toggles' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-display font-bold mb-2">Feature Toggles</h2>
                <p className="text-white/40 text-sm">Enable or disable system modules and sub-features.</p>
              </div>

              <div className="space-y-4">
                {[
                  { key: 'module.transport', label: 'Transport & Logistics', tier: 'Tier 1', status: 'OFF' },
                  { key: 'pos.telepharmacy', label: 'Telepharmacy Support', tier: 'Tier 2', status: 'OFF' },
                  { key: 'inventory.fefo_enforce', label: 'FEFO Batch Enforcement', tier: 'Tier 3', status: 'ON' },
                ].map((toggle) => (
                  <div key={toggle.key} className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{toggle.label}</span>
                        <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-white/40">{toggle.tier}</span>
                      </div>
                      <p className="text-xs text-white/40 mt-1">{toggle.key}</p>
                    </div>
                    <div className={clsx(
                      "w-10 h-5 rounded-full relative cursor-pointer transition-colors",
                      toggle.status === 'ON' ? "bg-pharm-primary" : "bg-white/10"
                    )}>
                      <div className={clsx(
                        "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                        toggle.status === 'ON' ? "right-1" : "left-1"
                      )}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Other domains would be implemented similarly */}
          {!['deployment', 'identity', 'toggles'].includes(activeDomain) && (
            <div className="flex flex-col items-center justify-center h-full text-white/20">
              <SettingsIcon size={64} className="mb-4 opacity-20" />
              <p className="text-lg font-display font-medium">Domain under construction</p>
              <p className="text-sm">Implementing {activeDomain} logic...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
