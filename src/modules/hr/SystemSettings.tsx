import React, { useState, useEffect } from 'react';
import { Shield, Save, Globe, Lock, Bell, Eye } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { Tenant } from '../../types';
import { toast } from 'sonner';

import { cn } from '../../utils/cn';

export const SystemSettings: React.FC = () => {
  const { profile } = useAuth();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.getDocument<Tenant>('tenants', profile.tenantId).then(setTenant);
    }
  }, [profile?.tenantId]);

  const handleSave = async () => {
    if (!tenant?.id) return;
    setIsSaving(true);
    try {
      await firestoreService.updateDocument('tenants', tenant.id, tenant);
      toast.success('System settings updated');
    } catch (error) {
      toast.error('Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (!tenant) return (
    <div className="flex items-center justify-center p-12 bg-white rounded-[32px] border border-slate-200 border-dashed">
      <p className="text-slate-400 font-medium italic">Loading system configuration...</p>
    </div>
  );

  return (
    <div className="max-w-4xl space-y-6">
      <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Global System Configuration</h3>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Tenant ID: {tenant.id}</p>
          </div>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-2xl font-bold transition-all shadow-xl shadow-indigo-100 uppercase text-[10px] tracking-widest disabled:opacity-50 flex items-center gap-2"
          >
            <Save size={18} />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Organization Name</label>
              <input 
                type="text" 
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-bold text-slate-900"
                value={tenant.name}
                onChange={(e) => setTenant({ ...tenant, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Base Currency</label>
              <select 
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 outline-none font-bold text-slate-900 appearance-none"
                value={tenant.currency || 'UGX'}
                onChange={(e) => setTenant({ ...tenant, currency: e.target.value })}
              >
                <option value="UGX">Ugandan Shilling (UGX)</option>
                <option value="USD">US Dollar (USD)</option>
                <option value="KES">Kenyan Shilling (KES)</option>
              </select>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-black text-slate-900 flex items-center gap-2 uppercase text-xs tracking-widest border-b border-slate-100 pb-2">
              <Shield size={18} className="text-indigo-600" />
              Security & Access Control
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SettingsToggle 
                title="Two-Factor Authentication" 
                description="Require 2FA for all management staff" 
                icon={Lock}
              />
              <SettingsToggle 
                title="Automatic Session Timeout" 
                description="Log out users after 30 mins of inactivity" 
                icon={Eye}
                active
              />
              <SettingsToggle 
                title="Email Notifications" 
                description="Send alerts for critical inventory changes" 
                icon={Bell}
                active
              />
              <SettingsToggle 
                title="Global Search" 
                description="Allow cross-branch inventory visibility" 
                icon={Globe}
                active
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SettingsToggle: React.FC<{ title: string; description: string; icon: any; active?: boolean }> = ({ title, description, icon: Icon, active = false }) => (
  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between group hover:border-indigo-200 transition-all">
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 bg-white rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 transition-colors">
        <Icon size={20} />
      </div>
      <div>
        <p className="font-bold text-slate-900 text-sm">{title}</p>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{description}</p>
      </div>
    </div>
    <div className={cn(
      "h-6 w-10 rounded-full relative cursor-pointer transition-colors",
      active ? "bg-indigo-600" : "bg-slate-200"
    )}>
      <div className={cn(
        "absolute top-1 h-4 w-4 bg-white rounded-full shadow-sm transition-all",
        active ? "right-1" : "left-1"
      )}></div>
    </div>
  </div>
);
