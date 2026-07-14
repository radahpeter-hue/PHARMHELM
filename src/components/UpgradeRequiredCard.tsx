import React from 'react';
import { ShieldAlert } from 'lucide-react';

interface UpgradeRequiredCardProps {
  moduleName: string;
}

export const UpgradeRequiredCard: React.FC<UpgradeRequiredCardProps> = ({ moduleName }) => {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6 bg-zinc-50/50 rounded-3xl border border-dashed border-zinc-200">
      <div className="max-w-md text-center space-y-6 p-8 bg-white rounded-3xl border border-zinc-100 shadow-xl shadow-zinc-100/50">
        <div className="h-16 w-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto text-amber-500 border border-amber-100">
          <ShieldAlert size={32} />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-bold text-zinc-900 tracking-tight uppercase">Plan Upgrade Required</h3>
          <p className="text-zinc-500 text-xs leading-relaxed">
            The <span className="font-bold text-zinc-800">{moduleName}</span> module is locked on your current <span className="font-bold text-zinc-800">Basic Plan</span> subscription. 
            Upgrade to the <span className="font-bold text-emerald-600">Standard</span> or <span className="font-bold text-purple-600">Enterprise</span> tier to gain full system access.
          </p>
        </div>
        <div className="pt-2 border-t border-zinc-100">
          <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
            Contact your platform system administrator to update your license package.
          </p>
        </div>
      </div>
    </div>
  );
};
