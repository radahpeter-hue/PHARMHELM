import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  Building2,
  DollarSign,
  Settings,
  UserCheck,
  Briefcase,
  ShieldAlert,
  GraduationCap,
  FileSpreadsheet,
  Lock,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { isPeopleSupervisorRoleName, isSystemRoleName } from '../config/rbac';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { StaffDirectory } from '../modules/hr/StaffDirectory';
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

type HRTab =
  | 'staff'
  | 'attendance'
  | 'payroll'
  | 'leave_advance'
  | 'branches'
  | 'recruitment'
  | 'trainees'
  | 'performance'
  | 'reports'
  | 'settings';

const HRAdmin: React.FC = () => {
  const { profile, hasPermission } = useAuth();
  const { tenant } = useTenant();
  const [activeTab, setActiveTab] = useState<HRTab>('staff');

  const normalizedRoles = useMemo(
    () => [profile?.role || '', ...(profile?.secondaryRoles || [])].map(role => role.trim().toLowerCase()),
    [profile?.role, profile?.secondaryRoles]
  );

  const hasAnyFixedRole = (roles: string[]) => roles.some(role => normalizedRoles.includes(role));
  const isExecutive = hasAnyFixedRole(['owner', 'ceo', 'ceo / md']);
  const isGeneralAdmin = hasAnyFixedRole(['admin']);
  const isHRHead = hasAnyFixedRole(['hr head']);
  const isHRSupport = hasAnyFixedRole(['hr support personnel']);
  const isITSupport = hasAnyFixedRole(['it support staff', 'it support personnel', 'it staff']);
  const isPeopleSupervisor = normalizedRoles.some(role => isPeopleSupervisorRoleName(role));

  const canOperateHR = hasPermission('hr', 'operate');
  const canViewHR = hasPermission('hr', 'view');
  const hasCustomRole = normalizedRoles.some(role => role && !isSystemRoleName(role));
  const hasFullHRAuthority = isExecutive || isGeneralAdmin || isHRHead || isHRSupport || (hasCustomRole && canOperateHR && !isPeopleSupervisor);
  const isSupervisorOnly = isPeopleSupervisor && !hasFullHRAuthority;
  const isDiagnosticITSupport = isITSupport && !hasFullHRAuthority;

  const allowedTabs = useMemo<HRTab[]>(() => {
    const allowed = new Set<HRTab>();

    if (hasFullHRAuthority) {
      ['staff', 'attendance', 'payroll', 'leave_advance', 'recruitment', 'trainees', 'performance', 'reports'].forEach(tab => allowed.add(tab as HRTab));
    }

    if (isSupervisorOnly) {
      // Supervisory HR access is deliberately limited to people-management inputs.
      allowed.add('performance');
      allowed.add('recruitment');
      allowed.add('trainees');
    }

    if (isDiagnosticITSupport) {
      allowed.add('reports');
    }

    if (canViewHR && !canOperateHR && !isDiagnosticITSupport && !isSupervisorOnly) {
      allowed.add('reports');
    }

    if (isExecutive || isGeneralAdmin) {
      allowed.add('branches');
      allowed.add('settings');
    }

    return Array.from(allowed);
  }, [hasFullHRAuthority, isSupervisorOnly, isDiagnosticITSupport, canViewHR, canOperateHR, isExecutive, isGeneralAdmin]);

  useEffect(() => {
    if (allowedTabs.length > 0 && !allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]);
    }
  }, [allowedTabs, activeTab]);

  const isBasic = tenant?.subscription_tier === 'basic';
  void isBasic;

  if (allowedTabs.length === 0) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center">
        <Lock className="mx-auto mb-3 text-slate-400" size={28} />
        <h2 className="font-black text-slate-900">HR access is restricted</h2>
        <p className="mt-2 text-sm text-slate-500">Your assigned role does not include an HR function or report view.</p>
      </div>
    );
  }

  const show = (tab: HRTab) => allowedTabs.includes(tab);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">HR & Administration</h1>
          <p className="text-sm font-medium text-slate-500">Role-scoped workforce administration and employee governance.</p>
        </div>
      </div>

      <div className="flex w-full items-center gap-2 overflow-x-auto rounded-2xl bg-slate-100 p-1.5 no-scrollbar">
        {show('staff') && <TabButton active={activeTab === 'staff'} onClick={() => setActiveTab('staff')} icon={Users} label="Staff" />}
        {show('attendance') && <TabButton active={activeTab === 'attendance'} onClick={() => setActiveTab('attendance')} icon={UserCheck} label="Attendance" />}
        {show('payroll') && <TabButton active={activeTab === 'payroll'} onClick={() => setActiveTab('payroll')} icon={DollarSign} label="Payroll" />}
        {show('leave_advance') && <TabButton active={activeTab === 'leave_advance'} onClick={() => setActiveTab('leave_advance')} icon={Briefcase} label="Leave & Advances" />}
        {show('branches') && <TabButton active={activeTab === 'branches'} onClick={() => setActiveTab('branches')} icon={Building2} label="Branches" />}
        {show('recruitment') && <TabButton active={activeTab === 'recruitment'} onClick={() => setActiveTab('recruitment')} icon={Briefcase} label="Recruitment" />}
        {show('trainees') && <TabButton active={activeTab === 'trainees'} onClick={() => setActiveTab('trainees')} icon={GraduationCap} label="Trainees" />}
        {show('performance') && <TabButton active={activeTab === 'performance'} onClick={() => setActiveTab('performance')} icon={ShieldAlert} label="Performance" />}
        {show('reports') && <TabButton active={activeTab === 'reports'} onClick={() => setActiveTab('reports')} icon={FileSpreadsheet} label="Reports" />}
        {show('settings') && <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={Settings} label="HR Settings" />}
      </div>

      <div className="mt-6">
        {activeTab === 'staff' && show('staff') && <StaffDirectory />}
        {activeTab === 'attendance' && show('attendance') && <AttendanceTracker />}
        {activeTab === 'payroll' && show('payroll') && <PayrollManager />}
        {activeTab === 'branches' && show('branches') && <BranchManager />}
        {activeTab === 'recruitment' && show('recruitment') && <RecruitmentManager supervisorOnly={isSupervisorOnly} />}
        {activeTab === 'trainees' && show('trainees') && <TraineesManager supervisorOnly={isSupervisorOnly} />}
        {activeTab === 'performance' && show('performance') && <PerformanceDiscipline supervisorOnly={isSupervisorOnly} />}
        {activeTab === 'leave_advance' && show('leave_advance') && <LeaveAdvanceManager />}
        {activeTab === 'reports' && show('reports') && <HRReportsConsole />}
        {activeTab === 'settings' && show('settings') && <SystemSettings />}
      </div>
    </div>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: any; label: string }> = ({ active, onClick, icon: Icon, label }) => (
  <button
    onClick={onClick}
    className={cn(
      'flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 transition-all',
      active ? 'bg-white text-slate-900 shadow-sm' : 'text-zinc-500 hover:bg-white/50'
    )}
  >
    <Icon size={18} className={active ? 'text-indigo-600' : 'text-slate-400'} />
    <span className="text-sm font-bold">{label}</span>
  </button>
);

export default HRAdmin;
