import React, { useState, useMemo } from 'react';
import { 
  LayoutDashboard, ShoppingCart, Package, Users, 
  Wallet, ShieldCheck, Truck, UserCircle, 
  Zap, Download, Globe, Building2, Calendar as CalendarIcon,
  ChevronDown, Filter, RefreshCw
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../utils/cn';
import { DateRangePicker, DateRangeOption } from '../components/analytics/DateRangePicker';
import { POSAnalytics } from '../components/analytics/POSAnalytics';
import { InventoryAnalytics } from '../components/analytics/InventoryAnalytics';
import { CRMAnalytics } from '../components/analytics/CRMAnalytics';
import { FinanceAnalytics } from '../components/analytics/FinanceAnalytics';
import { QAAnalytics } from '../components/analytics/QAAnalytics';
import { LogisticsAnalytics } from '../components/analytics/LogisticsAnalytics';
import { HRAnalytics } from '../components/analytics/HRAnalytics';
import { PredictivePanel } from '../components/analytics/PredictivePanel';
import { ReportHub } from '../components/analytics/ReportHub';

type AnalyticsDomain = 
  | 'POS & Sales' 
  | 'Inventory & Stock' 
  | 'CRM' 
  | 'Finance & OpEx' 
  | 'QA & Compliance' 
  | 'Logistics & Transport' 
  | 'HR & Personnel' 
  | 'Predictive Engine' 
  | 'Central Report Hub';

const Analytics = () => {
  const { profile, activeBranch, assignedBranches, setActiveBranchId } = useAuth();
  const [activeDomain, setActiveDomain] = useState<AnalyticsDomain>('POS & Sales');
  const [dateRange, setDateRange] = useState<DateRangeOption>('This Month');
  const [isGlobalView, setIsGlobalView] = useState(false);

  const userRole = profile?.role || 'Staff';

  // Access Control Logic based on Specification A.2 & A.4
  const canSeeGlobalView = ['owner', 'admin', 'IT Head', 'Finance Manager'].includes(userRole);
  const canSwitchBranch = assignedBranches.length > 1 || canSeeGlobalView;

  const domains = useMemo(() => {
    const allDomains: { id: AnalyticsDomain; icon: any; label: string }[] = [
      { id: 'POS & Sales', icon: ShoppingCart, label: 'POS & Sales' },
      { id: 'Inventory & Stock', icon: Package, label: 'Inventory' },
      { id: 'CRM', icon: Users, label: 'CRM' },
      { id: 'Finance & OpEx', icon: Wallet, label: 'Finance' },
      { id: 'QA & Compliance', icon: ShieldCheck, label: 'QA & Compliance' },
      { id: 'Logistics & Transport', icon: Truck, label: 'Logistics' },
      { id: 'HR & Personnel', icon: UserCircle, label: 'HR & Personnel' },
      { id: 'Predictive Engine', icon: Zap, label: 'Predictive Engine' },
      { id: 'Central Report Hub', icon: Download, label: 'Report Hub' },
    ];

    // Filter domains based on role (A.4)
    return allDomains.filter(domain => {
      if (['owner', 'admin', 'IT Head'].includes(userRole)) return true;
      if (userRole === 'Finance Manager') return true; // Finance Head has full access
      if (userRole === 'manager') return domain.id !== 'Logistics & Transport'; // Branch Manager
      if (userRole === 'QA Manager') return domain.id === 'QA & Compliance' || domain.id === 'Central Report Hub';
      if (userRole === 'HR Manager') return domain.id === 'HR & Personnel' || domain.id === 'Central Report Hub';
      if (userRole === 'Logistics Manager') return domain.id === 'Logistics & Transport' || domain.id === 'Central Report Hub';
      
      // Default staff access
      return ['POS & Sales', 'Inventory & Stock'].includes(domain.id);
    });
  }, [userRole]);

  // Set initial domain if current one is not allowed
  React.useEffect(() => {
    if (!domains.find(d => d.id === activeDomain)) {
      setActiveDomain(domains[0]?.id || 'POS & Sales');
    }
  }, [domains, activeDomain]);

  const renderDomainContent = () => {
    switch (activeDomain) {
      case 'POS & Sales': return <POSAnalytics />;
      case 'Inventory & Stock': return <InventoryAnalytics />;
      case 'CRM': return <CRMAnalytics />;
      case 'Finance & OpEx': return <FinanceAnalytics />;
      case 'QA & Compliance': return <QAAnalytics />;
      case 'Logistics & Transport': return <LogisticsAnalytics />;
      case 'HR & Personnel': return <HRAnalytics />;
      case 'Predictive Engine': return <PredictivePanel />;
      case 'Central Report Hub': return <ReportHub />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Navigation Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 bg-zinc-900 rounded-2xl flex items-center justify-center text-white">
            <LayoutDashboard size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-zinc-900 uppercase tracking-tight">Analytics Intelligence</h1>
            <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
              <span>M12 Analytics Spec v2.0</span>
              <span className="h-1 w-1 bg-zinc-300 rounded-full" />
              <div className="flex items-center gap-1">
                <RefreshCw size={10} className="animate-spin-slow" />
                Refreshed: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Global View Toggle (A.2) */}
          {canSeeGlobalView && (
            <button
              onClick={() => setIsGlobalView(!isGlobalView)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all",
                isGlobalView 
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-200" 
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              )}
            >
              <Globe size={18} />
              <span>Global View</span>
            </button>
          )}

          {/* Branch Selector (A.2) */}
          {!isGlobalView && canSwitchBranch && (
            <div className="relative">
              <select
                value={activeBranch?.id || ''}
                onChange={(e) => setActiveBranchId(e.target.value)}
                className="appearance-none pl-10 pr-10 py-2 bg-white border border-zinc-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all cursor-pointer shadow-sm"
              >
                {assignedBranches.map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" size={14} />
            </div>
          )}

          {isGlobalView && (
            <div className="px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-700 text-sm font-bold flex items-center gap-2">
              <Globe size={18} />
              Viewing: All Branches
            </div>
          )}

          <div className="h-8 w-px bg-zinc-200 mx-1 hidden md:block" />

          {/* Date Range Picker (A.3) */}
          <DateRangePicker selected={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {/* Domain Tabs */}
      <div className="flex overflow-x-auto pb-2 gap-2 no-scrollbar">
        {domains.map((domain) => {
          const Icon = domain.icon;
          return (
            <button
              key={domain.id}
              onClick={() => setActiveDomain(domain.id)}
              className={cn(
                "flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold whitespace-nowrap transition-all border",
                activeDomain === domain.id
                  ? "bg-zinc-900 text-white border-zinc-900 shadow-lg shadow-zinc-200"
                  : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50"
              )}
            >
              <Icon size={18} />
              {domain.label}
            </button>
          );
        })}
      </div>

      {/* Domain Dashboard Content */}
      <div className="mt-8">
        {renderDomainContent()}
      </div>
    </div>
  );
};

export default Analytics;
