import React, { useState } from 'react';
import { 
  Users,
  Building2,
  DollarSign,
  Settings,
  UserCheck,
  Briefcase,
  ShieldAlert,
  GraduationCap,
  FileSpreadsheet
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { UpgradeRequiredCard } from '../components/UpgradeRequiredCard';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Import HR Modules
import { StaffDirectory } from '../modules/hr/StaffDirectory';
import { RolesManager } from '../modules/hr/RolesManager';
import { AttendanceTracker } from '../modules/hr/AttendanceTracker';
import { PayrollManager } from '../modules/hr/PayrollManager';
import { BranchManager } from '../modules/hr/BranchManager';
import { RecruitmentManager } from '../modules/hr/RecruitmentManager';
import { TraineesManager } from '../modules/hr/TraineesManager';
import { PerformanceDiscipline } from '../modules/hr/PerformanceDiscipline';
import { LeaveAdvanceManager } from '../modules/hr/LeaveAdvanceManager';
import { HRReportsConsole } from '../modules/hr/HRReportsConsole';
import { SystemSettings } from '../modules/hr/SystemSettings';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const HRAdmin: React.FC = () => {
  const { profile } = useAuth();
  const { tenant } = useTenant();
  const [activeTab, setActiveTab] = useState<'staff' | 'roles' | 'attendance' | 'payroll' | 'leave_advance' | 'branches' | 'recruitment' | 'trainees' | 'performance' | 'reports' | 'settings'>('staff');

  const isManagement = profile?.role === 'owner' || profile?.role === 'CEO' || profile?.role === 'HR Head';
  const isBasic = tenant?.subscription_tier === 'basic';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">HR & Administration</h1>
          <p className="text-slate-500 text-sm font-medium">Manage your workforce, branches, and system-wide configurations.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl w-full overflow-x-auto no-scrollbar">
        <TabButton active={activeTab === 'staff'} onClick={() => setActiveTab('staff')} icon={Users} label="Staff" />
        <TabButton active={activeTab === 'roles'} onClick={() => setActiveTab('roles')} icon={Briefcase} label="Roles" />
        <TabButton active={activeTab === 'attendance'} onClick={() => setActiveTab('attendance')} icon={UserCheck} label="Attendance" />
        <TabButton active={activeTab === 'payroll'} onClick={() => setActiveTab('payroll')} icon={DollarSign} label="Payroll" />
        <TabButton active={activeTab === 'leave_advance'} onClick={() => setActiveTab('leave_advance')} icon={Briefcase} label="Leave & Advances" />
        <TabButton active={activeTab === 'branches'} onClick={() => setActiveTab('branches')} icon={Building2} label="Branches" />
        {tenant?.subscription_tier === 'enterprise' && (
          <>
            <TabButton active={activeTab === 'recruitment'} onClick={() => setActiveTab('recruitment')} icon={Briefcase} label="Recruitment" />
            <TabButton active={activeTab === 'trainees'} onClick={() => setActiveTab('trainees')} icon={GraduationCap} label="Trainees" />
          </>
        )}
        <TabButton active={activeTab === 'performance'} onClick={() => setActiveTab('performance')} icon={ShieldAlert} label="Performance" />
        <TabButton active={activeTab === 'reports'} onClick={() => setActiveTab('reports')} icon={FileSpreadsheet} label="Reports" />
        {isManagement && (
          <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={Settings} label="Settings" />
        )}
      </div>

      <div className="mt-6">
        {activeTab === 'staff' && <StaffDirectory />}
        {activeTab === 'roles' && <RolesManager />}
        {activeTab === 'attendance' && <AttendanceTracker />}
        {activeTab === 'payroll' && <PayrollManager />}
        {activeTab === 'branches' && <BranchManager />}
        {activeTab === 'recruitment' && (
          tenant?.subscription_tier !== 'enterprise' 
            ? <UpgradeRequiredCard moduleName="Recruitment Management" /> 
            : <RecruitmentManager />
        )}
        {activeTab === 'trainees' && (
          tenant?.subscription_tier !== 'enterprise' 
            ? <UpgradeRequiredCard moduleName="Trainees & Candidates" /> 
            : <TraineesManager />
        )}
        {activeTab === 'performance' && <PerformanceDiscipline />}
        {activeTab === 'leave_advance' && <LeaveAdvanceManager />}
        {activeTab === 'reports' && <HRReportsConsole />}
        {activeTab === 'settings' && <SystemSettings />}
      </div>
    </div>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: any; label: string }> = ({ active, onClick, icon: Icon, label }) => (
  <button 
    onClick={onClick}
    className={cn(
      "flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap",
      active ? "bg-white text-slate-900 shadow-sm" : "text-zinc-500 hover:bg-white/50"
    )}
  >
    <Icon size={18} className={active ? "text-indigo-600" : "text-slate-400"} />
    <span className="text-sm font-bold">{label}</span>
  </button>
);

export default HRAdmin;
