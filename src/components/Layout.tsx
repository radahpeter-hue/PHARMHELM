import React, { useState } from 'react';
import Sidebar from './Sidebar';
import { Toaster, toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { Building2, ChevronDown, LogOut, User as UserIcon, Settings, RefreshCw, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const { profile, activeBranch, multiBranchMode, assignedBranches, setActiveBranchId, logout } = useAuth();
  const { tenant, setTenantSlugAndMode } = useTenant();
  const navigate = useNavigate();

  const handleSwitchBranch = (branchId: string) => {
    setActiveBranchId(branchId);
    setBranchMenuOpen(false);
    setUserMenuOpen(false);
    toast.success(`Switched to ${assignedBranches.find(b => b.id === branchId)?.name}`);
  };

  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden">
      {/* Sidebar Mobile Backdrop Overlay */}
      {mobileOpen && (
        <div 
          className="fixed inset-0 z-40 bg-zinc-950/40 backdrop-blur-xs md:hidden transition-all duration-300"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <Sidebar 
        collapsed={collapsed} 
        setCollapsed={setCollapsed} 
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Navigation */}
        <header className="h-16 bg-white border-b border-zinc-200 flex items-center justify-between px-4 md:px-8 z-20">
          <div className="flex items-center gap-4 md:gap-6">
            <button 
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 rounded-xl transition-all"
              title="Open Navigation Menu"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-4 mr-4">
              {!multiBranchMode && (
                <div className="text-sm font-medium text-zinc-500">
                  {activeBranch?.brandName || 'PharmHelm Pro ERP'} • <span className="text-zinc-900">{activeBranch?.brandSlogan || 'Standard Edition'}</span>
                </div>
              )}
              {multiBranchMode && (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: activeBranch?.brandPrimaryColor || '#10b981' }} />
                  <span className="text-xs font-bold text-zinc-800 uppercase tracking-widest flex items-center gap-2 font-mono">
                    <span>{activeBranch?.brandName || activeBranch?.name || 'Main Branch'}</span>
                    {activeBranch?.brandSlogan && (
                      <span className="text-[10px] text-zinc-400 capitalize font-medium hidden md:inline">({activeBranch.brandSlogan})</span>
                    )}
                  </span>
                </div>
              )}
            </div>

            <div className="h-8 w-[1px] bg-zinc-200" />            {/* User Profile & Branch Switcher on the Left */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <button 
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-3 p-1.5 hover:bg-zinc-100 rounded-xl transition-colors"
                >
                  <div className="h-9 w-9 bg-zinc-900 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm">
                    {(profile?.full_name || profile?.displayName || profile?.email || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="text-left hidden sm:block">
                    <p className="text-xs font-black text-zinc-900 leading-none mb-1">
                      {profile?.full_name || profile?.displayName || profile?.email || 'User'}
                    </p>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{profile?.role || 'Staff'}</p>
                  </div>
                  <ChevronDown size={14} className={`text-zinc-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {userMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} />
                      <motion.div 
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute left-0 mt-2 w-64 bg-white rounded-2xl border border-zinc-200 shadow-xl overflow-hidden z-40"
                      >
                        <div className="p-4 border-b border-zinc-100 bg-zinc-50/50">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Signed in as</p>
                          <p className="text-sm font-bold text-zinc-900 truncate">{profile?.email}</p>
                        </div>
                        
                        <div className="p-2">
                          <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 rounded-lg transition-colors">
                            <UserIcon size={18} className="text-zinc-400" />
                            My Profile
                          </button>
                          <button 
                            onClick={() => { navigate(`/tenant/${tenant?.slug || 'radah'}/app/settings`); setUserMenuOpen(false); }}
                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 rounded-lg transition-colors"
                          >
                            <Settings size={18} className="text-zinc-400" />
                            Settings
                          </button>
                          <button 
                            onClick={() => { setTenantSlugAndMode(null); }}
                            className="w-full flex items-center gap-3 px-3 py-2 text-xs text-amber-600 hover:bg-amber-50 rounded-lg transition-colors font-bold"
                          >
                            <RefreshCw size={14} className="text-amber-500" />
                            Switch to Platform TMC
                          </button>
                        </div>

                        <div className="p-2 border-t border-zinc-100">
                          <button 
                            onClick={logout}
                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <LogOut size={18} className="text-red-400" />
                            Sign Out
                          </button>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              {multiBranchMode && activeBranch && (
                <div className="flex items-center gap-2">
                  <div className="h-6 w-[1px] bg-zinc-200" />
                  <div className="relative">
                    <button 
                      onClick={() => setBranchMenuOpen(!branchMenuOpen)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100 hover:bg-emerald-100 transition-all group"
                      title="Switch Operating Branch"
                    >
                      <Building2 size={14} className="text-emerald-500" />
                      <div className="text-left">
                        <p className="text-[9px] font-black text-emerald-500/60 uppercase tracking-widest leading-none mb-0.5">Branch</p>
                        <p className="text-xs font-bold text-zinc-900 leading-none">{activeBranch.name}</p>
                      </div>
                      <ChevronDown size={12} className={`text-emerald-400 transition-transform ${branchMenuOpen ? 'rotate-180' : ''}`} />
                    </button>

                    <AnimatePresence>
                      {branchMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setBranchMenuOpen(false)} />
                          <motion.div 
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute left-0 mt-2 w-64 bg-white rounded-2xl border border-zinc-200 shadow-xl overflow-hidden z-40"
                          >
                            <div className="p-4 border-b border-zinc-100 bg-zinc-50/50">
                              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Select Operating Branch</p>
                            </div>
                            <div className="p-2 max-h-64 overflow-y-auto">
                              {assignedBranches.map((branch) => (
                                <button
                                  key={branch.id}
                                  onClick={() => handleSwitchBranch(branch.id)}
                                  className={cn(
                                    "w-full flex flex-col items-start gap-1 px-3 py-2 rounded-xl transition-all",
                                    activeBranch.id === branch.id 
                                      ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                                      : "hover:bg-zinc-50 text-zinc-600 hover:text-zinc-900"
                                  )}
                                >
                                  <div className="flex items-center justify-between w-full">
                                    <span className="text-sm font-bold">{branch.name}</span>
                                    {activeBranch.id === branch.id && <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full" />}
                                  </div>
                                  <span className="text-[10px] uppercase tracking-wider opacity-60">{branch.branch_code} • {branch.type}</span>
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Right side can be empty or have notifications later */}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto relative">
          <div className="p-8 max-w-7xl mx-auto">
            {children}
          </div>
          <Toaster position="top-right" expand={false} richColors />
        </main>
      </div>
    </div>
  );
};

export default Layout;
