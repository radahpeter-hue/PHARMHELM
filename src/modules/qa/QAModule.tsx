import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Thermometer, 
  Lock, 
  Calendar, 
  ClipboardCheck, 
  AlertTriangle, 
  Building2, 
  BookOpen, 
  UserCheck,
  ChevronRight,
  Search,
  Bell,
  Settings,
  LockKeyhole
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { TemperatureLogs } from './TemperatureLogs';
import { ControlledDrugs } from './ControlledDrugs';
import { ExpiryLogs } from './ExpiryLogs';
import { CleaningLogs } from './CleaningLogs';
import { Recalls } from './Recalls';
import { Licenses } from './Licenses';
import { CME } from './CME';
import { Appraisals } from './Appraisals';

type QATab = 
  | 'temperature' 
  | 'controlled-drugs' 
  | 'expiry' 
  | 'cleaning' 
  | 'recalls' 
  | 'licenses' 
  | 'cme' 
  | 'appraisals';

export const QAModule = () => {
  const { profile, activeBranch } = useAuth();
  const [activeTab, setActiveTab] = useState<QATab>('temperature');

  const isHQBranch = 
    activeBranch?.type === 'HQ' || 
    activeBranch?.id === 'HQ' ||
    activeBranch?.id === 'brn_hq' ||
    profile?.branch_id === 'HQ' ||
    profile?.branch_id === 'brn_hq' ||
    activeBranch?.name?.toLowerCase().includes('hq') ||
    profile?.branch_name?.toLowerCase().includes('hq');

  const userRole = (profile?.role || '').toLowerCase();
  const isAuthorizedRole = 
    userRole === 'owner' || 
    userRole === 'admin' || 
    userRole === 'ceo' ||
    userRole.includes('qa') ||
    userRole.includes('manager') ||
    userRole.includes('head');

  const canAccessHQOps = isHQBranch || isAuthorizedRole;

  const allTabs = [
    { id: 'temperature', label: 'Temp Logs', icon: Thermometer, color: 'text-blue-600', bg: 'bg-blue-50', isHQOp: false },
    { id: 'controlled-drugs', label: 'CD Register', icon: Lock, color: 'text-amber-600', bg: 'bg-amber-50', isHQOp: false },
    { id: 'expiry', label: 'Expiry & Quarantine', icon: Calendar, color: 'text-red-600', bg: 'bg-red-50', isHQOp: false },
    { id: 'cleaning', label: 'Cleaning Logs', icon: ClipboardCheck, color: 'text-green-600', bg: 'bg-green-50', isHQOp: false },
    { id: 'recalls', label: 'Recalls', icon: AlertTriangle, color: 'text-rose-600', bg: 'bg-rose-50', isHQOp: false },
    { id: 'licenses', label: 'Licenses Log', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50', isHQOp: true },
    { id: 'cme', label: 'CME Tracking', icon: BookOpen, color: 'text-purple-600', bg: 'bg-purple-50', isHQOp: true },
    { id: 'appraisals', label: 'Appraisals', icon: UserCheck, color: 'text-emerald-600', bg: 'bg-emerald-50', isHQOp: true },
  ];

  // Filters out HQ operation tabs if the logged-in user is not HQ or in specific QA personnel/manager roles
  const tabs = allTabs.filter(t => !t.isHQOp || canAccessHQOps);

  const renderContent = () => {
    // If somehow a non-authorized user navigates to an HQ tab, block and show secure card
    if ((activeTab === 'licenses' || activeTab === 'cme' || activeTab === 'appraisals') && !canAccessHQOps) {
      return (
        <div className="bg-white rounded-[32px] p-12 border border-slate-200 text-center max-w-xl mx-auto shadow-md">
          <div className="h-16 w-16 bg-red-50 text-red-650 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-red-100">
            <LockKeyhole size={32} />
          </div>
          <h3 className="text-xl font-black text-slate-900 mb-2">Access Restrained</h3>
          <p className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-4">HQ Operations Gateway Only</p>
          <p className="text-sm text-slate-500 leading-relaxed mb-6">
            Licenses tracker, staff appraisal cycle reviews, and CME tracking details are restricted. Access is exclusively granted to personnel assigned to Headquarters or with specific authorized management & QA profiles.
          </p>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-left text-xs text-slate-400 font-medium">
            <p className="font-bold text-slate-600 mb-1 flex items-center gap-1.5">
              <span>●</span> Active Location Check: {activeBranch?.name || 'Unknown'} 
            </p>
            <p className="font-bold text-slate-600 flex items-center gap-1.5">
              <span>●</span> Active Role Matching: {profile?.role || 'Normal staff'} 
            </p>
          </div>
        </div>
      );
    }

    switch (activeTab) {
      case 'temperature': return <TemperatureLogs />;
      case 'controlled-drugs': return <ControlledDrugs />;
      case 'expiry': return <ExpiryLogs />;
      case 'cleaning': return <CleaningLogs />;
      case 'recalls': return <Recalls />;
      case 'licenses': return <Licenses />;
      case 'cme': return <CME />;
      case 'appraisals': return <Appraisals />;
      default: return <TemperatureLogs />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg shadow-sm">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">QA & Compliance</h1>
                <p className="text-xs text-gray-500 font-medium">Standard Operating Procedures & Audit Logs</p>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input 
                  type="text" 
                  placeholder="Global QA Search..." 
                  className="pl-10 pr-4 py-2 bg-gray-100 border-transparent rounded-full text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all w-64"
                />
              </div>
              <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors relative">
                <Bell className="w-5 h-5" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
              </button>
              <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar Navigation */}
          <aside className="lg:w-72 shrink-0">
            <nav className="space-y-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as QATab)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl transition-all group ${
                    activeTab === tab.id 
                      ? 'bg-white shadow-sm border border-gray-200' 
                      : 'hover:bg-white/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg transition-colors ${
                      activeTab === tab.id ? tab.bg : 'bg-gray-100 group-hover:bg-white'
                    }`}>
                      <tab.icon className={`w-5 h-5 ${
                        activeTab === tab.id ? tab.color : 'text-gray-500'
                      }`} />
                    </div>
                    <span className={`text-sm font-semibold ${
                      activeTab === tab.id ? 'text-gray-900' : 'text-gray-600'
                    }`}>
                      {tab.label}
                    </span>
                  </div>
                  {activeTab === tab.id && (
                    <motion.div layoutId="active-indicator">
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </motion.div>
                  )}
                </button>
              ))}
            </nav>

            <div className="mt-8 p-4 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl text-white shadow-lg shadow-blue-200">
              <h4 className="font-bold text-sm">Compliance Score</h4>
              <div className="mt-4 flex items-end justify-between">
                <span className="text-3xl font-black">98.4%</span>
                <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">+2.1%</span>
              </div>
              <div className="mt-4 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-white w-[98.4%] rounded-full"></div>
              </div>
              <p className="mt-4 text-[10px] text-blue-100 leading-relaxed">
                Your branch is currently meeting all critical compliance targets. Keep up the good work!
              </p>
            </div>
          </aside>

          {/* Main Content Area */}
          <main className="flex-1 min-w-0">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {renderContent()}
            </motion.div>
          </main>
        </div>
      </div>
    </div>
  );
};
