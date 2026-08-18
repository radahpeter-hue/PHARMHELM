import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Users, 
  Settings, 
  ChevronLeft,
  ChevronRight,
  LogOut,
  Truck,
  FileText,
  DollarSign,
  ShieldCheck,
  Briefcase,
  TrendingUp,
  BarChart3,
  Heart,
  Megaphone,
  ArrowLeftRight
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  mobileOpen?: boolean;
  setMobileOpen?: (open: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, setCollapsed, mobileOpen, setMobileOpen }) => {
  const location = useLocation();
  const { profile, activeBranch, multiBranchMode, logout, hasPermission } = useAuth();
  const { tenant } = useTenant();

  const isHQ = activeBranch?.type === 'HQ' || !multiBranchMode;
  const profileRoles = [profile?.role || '', ...(profile?.secondaryRoles || [])];
  const isManagement = profileRoles.some(r => ['owner', 'CEO', 'IT Head', 'IT Support Staff'].includes(r));

  const prefix = `/tenant/${tenant?.slug || 'radah'}/app`;

  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: prefix },
    { icon: ShoppingCart, label: 'Sales / POS', path: `${prefix}/sales` },
    { icon: Package, label: 'Inventory', path: `${prefix}/inventory` },
    { icon: Users, label: 'Clients & Inst.', path: `${prefix}/clients` },
    { icon: ArrowLeftRight, label: 'Stock In/Out', path: `${prefix}/stock` },
    { icon: FileText, label: 'Procurement', path: `${prefix}/procurement` },
    { icon: Truck, label: 'Fleet & Logistics', path: `${prefix}/logistics` },
    { icon: DollarSign, label: 'Finance', path: `${prefix}/finance`, management: true },
    { icon: ShieldCheck, label: 'Compliance', path: `${prefix}/qa` },
    { icon: Briefcase, label: 'HR Admin', path: `${prefix}/hr`, management: true },
    { icon: Heart, label: 'Welfare Portal', path: `${prefix}/welfare` },
    { icon: TrendingUp, label: 'Predictive Engine', path: `${prefix}/predictive` },
    { icon: BarChart3, label: 'Analytics', path: `${prefix}/analytics`, management: true },
    { icon: Megaphone, label: 'Marketing', path: `${prefix}/marketing` },
    { icon: Settings, label: 'Settings', path: `${prefix}/settings`, management: true },
  ];

  const filteredItems = menuItems.filter(item => {
    // 1. Management restriction
    if (item.management && !isHQ && !isManagement) return false;

    // 2. Subscription tier restriction
    if (tenant?.subscription_tier === 'basic' || tenant?.subscription_tier === 'standard') {
      if (item.path.endsWith('/marketing') || item.path.endsWith('/logistics') || item.path.endsWith('/predictive')) return false;
    }

    // 3. Role-based module permission restriction
    const pathParts = item.path.split('/');
    const pathSuffix = pathParts[pathParts.length - 1];
    
    if (pathSuffix && pathSuffix !== 'app') {
      let moduleKey = pathSuffix;
      if (pathSuffix === 'logistics') {
        moduleKey = 'procurement';
      }
      
      // Fallback map check for dashboard settings link
      if (!hasPermission(moduleKey as any, 'view')) {
        return false;
      }
    }

    return true;
  });

  return (
    <div 
      className={cn(
        "fixed inset-y-0 left-0 z-50 md:relative h-screen bg-zinc-950 text-zinc-400 border-r border-zinc-800 transition-all duration-300 flex flex-col",
        collapsed ? "w-20" : "w-64",
        mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}
    >
      <div className="p-6 flex items-center justify-between">
        {!collapsed && (
          <div className="flex flex-col">
            <span className="font-bold text-xl text-white tracking-tight">
              {activeBranch?.brandName || 'PharmHelm'}<span className="text-emerald-500" style={activeBranch?.brandPrimaryColor ? { color: activeBranch.brandPrimaryColor } : undefined}>{activeBranch?.brandName ? '' : ' Pro'}</span>
            </span>
            {activeBranch?.brandSlogan && (
              <span className="text-[10px] text-zinc-400 font-mono tracking-wider truncate max-w-[180px] block mt-0.5" style={activeBranch?.brandSecondaryColor ? { color: activeBranch.brandSecondaryColor } : undefined}>
                {activeBranch.brandSlogan}
              </span>
            )}
          </div>
        )}
        <button 
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 hover:bg-zinc-800 rounded-md transition-colors"
        >
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto no-scrollbar py-4">
        {filteredItems.map((item) => {
          const isActive = item.path === prefix ? location.pathname === prefix : location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileOpen?.(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg transition-all group",
                isActive 
                  ? "bg-emerald-500/10 text-emerald-500" 
                  : "hover:bg-zinc-900 hover:text-zinc-200"
              )}
            >
              <item.icon size={20} className={cn(isActive ? "text-emerald-500" : "text-zinc-500 group-hover:text-zinc-300")} />
              {!collapsed && <span className="font-medium">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-zinc-800 space-y-4">
        {!collapsed && profile && (
          <div className="px-3 py-2">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">User</p>
            <p className="text-sm font-bold text-white truncate">{profile.displayName}</p>
            <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">{profile.role}</p>
          </div>
        )}
        <button 
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-all text-zinc-500"
        >
          <LogOut size={20} />
          {!collapsed && <span className="font-medium">Sign Out</span>}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
