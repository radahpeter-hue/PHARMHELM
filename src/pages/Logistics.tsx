import React, { useState } from 'react';
import { 
  Car, Navigation, Users, DollarSign, BarChart3
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { UpgradeRequiredCard } from '../components/UpgradeRequiredCard';
import { cn } from '../utils/cn';
import { VehicleRegister } from '../modules/logistics/VehicleRegister';
import { PersonnelRegister } from '../modules/logistics/PersonnelRegister';
import { TripManagement } from '../modules/logistics/TripManagement';
import { CostLedger } from '../modules/logistics/CostLedger';
import { LogisticsReports } from '../modules/logistics/LogisticsReports';
import { LogisticsDashboard } from '../modules/logistics/LogisticsDashboard';

type TabType = 'dashboard' | 'vehicles' | 'personnel' | 'trips' | 'costs' | 'reports';

const Logistics: React.FC = () => {
  const { userProfile } = useAuth();
  const { tenant } = useTenant();
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  if (tenant?.subscription_tier === 'basic' || tenant?.subscription_tier === 'standard') {
    return (
      <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8">
        <UpgradeRequiredCard moduleName="Fleet & Logistics" />
      </div>
    );
  }

  const tabs = [
    { id: 'dashboard', label: 'Department Dashboard', icon: BarChart3 },
    { id: 'vehicles', label: 'Vehicle Register', icon: Car },
    { id: 'personnel', label: 'Personnel Register', icon: Users },
    { id: 'trips', label: 'Trip Management', icon: Navigation },
    { id: 'costs', label: 'Cost Ledger', icon: DollarSign },
  ];

  return (
    <div className="min-h-screen bg-slate-50/50">
      <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-indigo-600 font-semibold text-sm uppercase tracking-wider">
              <Car className="h-4 w-4" />
              <span>Fleet & Logistics</span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Logistics Operations</h1>
            <p className="text-slate-500 max-w-2xl">
              Manage your fleet, personnel, trips, and operational costs in one centralized dashboard.
            </p>
          </div>
          
          <div className="flex items-center gap-3 bg-white p-1 rounded-xl border border-slate-200 shadow-sm shrink-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                  activeTab === tab.id 
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" 
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <tab.icon className={cn("h-4 w-4", activeTab === tab.id ? "text-white" : "text-slate-400")} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {activeTab === 'dashboard' && <LogisticsDashboard />}
          {activeTab === 'vehicles' && <VehicleRegister />}
          {activeTab === 'personnel' && <PersonnelRegister />}
          {activeTab === 'trips' && <TripManagement />}
          {activeTab === 'costs' && <CostLedger />}
        </div>
      </div>
    </div>
  );
};

export default Logistics;
