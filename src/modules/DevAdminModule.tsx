import React, { useState } from 'react';
import { 
  Globe, 
  Plus, 
  Search, 
  MoreVertical, 
  ExternalLink, 
  ShieldAlert,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { clsx } from 'clsx';

export const DevAdminModule: React.FC = () => {
  const [tenants] = useState([
    { 
      name: 'Radah Pharmaceutical Ltd', 
      slug: 'radah', 
      tier: 'Enterprise', 
      status: 'Active', 
      mode: 'Multi-Branch',
      created: '2026-03-10'
    },
    { 
      name: 'City Care Pharmacy', 
      slug: 'citycare', 
      tier: 'Standard', 
      status: 'Provisioning', 
      mode: 'Single-Branch',
      created: '2026-03-15'
    }
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Platform TMC</h1>
          <p className="text-white/40 text-sm mt-1">Tenant Management Console for PharmHelm Pro ERP Operators</p>
        </div>
        <button className="pharm-btn-primary flex items-center gap-2">
          <Plus size={18} />
          Add New Tenant
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Total Tenants', value: '12', icon: Globe, color: 'text-blue-400' },
          { label: 'Active Sessions', value: '142', icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'System Alerts', value: '0', icon: ShieldAlert, color: 'text-white/40' },
        ].map((stat, i) => (
          <div key={i} className="pharm-card p-6 flex items-center gap-4">
            <div className={clsx("p-3 rounded-xl bg-white/5", stat.color)}>
              <stat.icon size={24} />
            </div>
            <div>
              <p className="text-sm text-white/40 font-medium">{stat.label}</p>
              <h3 className="text-2xl font-bold">{stat.value}</h3>
            </div>
          </div>
        ))}
      </div>

      <div className="pharm-card">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <h3 className="font-semibold">Tenant Registry</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
            <input 
              type="text" 
              placeholder="Filter tenants..." 
              className="pharm-input pl-9 py-1.5 text-sm w-64"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-white/5 border-b border-white/10">
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-white/40">Pharmacy Name</th>
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-white/40">Slug / Tier</th>
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-white/40">Deployment</th>
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-white/40">Status</th>
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-white/40">Created</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tenants.map((tenant, i) => (
                <tr key={i} className="group hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-medium">{tenant.name}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm">{tenant.slug}</div>
                    <div className="text-[10px] text-white/40 font-bold uppercase">{tenant.tier}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs text-white/60">{tenant.mode}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {tenant.status === 'Active' ? (
                        <CheckCircle2 size={14} className="text-emerald-400" />
                      ) : (
                        <Clock size={14} className="text-orange-400" />
                      )}
                      <span className={clsx(
                        "text-xs font-medium",
                        tenant.status === 'Active' ? "text-emerald-400" : "text-orange-400"
                      )}>
                        {tenant.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-white/40">
                    {tenant.created}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="p-2 text-white/40 hover:text-white transition-colors">
                        <ExternalLink size={16} />
                      </button>
                      <button className="p-2 text-white/40 hover:text-white transition-colors">
                        <MoreVertical size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
