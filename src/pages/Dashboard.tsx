import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Package, 
  AlertCircle, 
  DollarSign, 
  ArrowUpRight, 
  ArrowDownRight, 
  Clock,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Timer,
  ShieldAlert,
  Truck,
  UserCheck,
  Calendar,
  Eye,
  EyeOff,
  BarChart3
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { firestoreService } from '../services/firestore';
import { Product, Sale, ProductBatch } from '../types';
import { format } from 'date-fns';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const Dashboard: React.FC = () => {
  const { profile, activeBranch } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [isAnalyticsExpanded, setIsAnalyticsExpanded] = useState(true);

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubProducts = firestoreService.subscribeToCollection<Product>(
        'products',
        profile.tenantId,
        setProducts
      );
      const unsubSales = firestoreService.subscribeToCollection<Sale>(
        'sales',
        profile.tenantId,
        setSales
      );
      
      let unsubBatches = () => {};
      if (activeBranch?.id) {
        unsubBatches = firestoreService.subscribeToCollectionGroup<ProductBatch>(
          'product_batches',
          profile.tenantId,
          activeBranch.id,
          setBatches
        );
      }
      
      return () => {
        unsubProducts();
        unsubSales();
        unsubBatches();
      };
    }
  }, [profile?.tenantId, activeBranch?.id]);

  const today = new Date().toISOString().split('T')[0];
  const todaySales = sales.filter(s => s.timestamp.startsWith(today));
  const totalSalesToday = todaySales.reduce((sum, s) => sum + (s.total || s.totalAmount || 0), 0);
  
  // Calculate inventory value dynamically
  const inventoryValue = batches.reduce((sum, b) => sum + (b.quantity || 0) * (b.purchasePrice || 0), 0);

  // Calculate receivables dynamically
  const outstandingReceivables = sales.filter(s => s.paymentMethod === 'Credit' || s.paymentMethod === 'Insurance').reduce((sum, s) => sum + (s.total || s.totalAmount || 0), 0);

  // Calculate stock alerts dynamically
  const zeroStockCount = products.filter(p => (p.stock ?? p.quantityInStock ?? 0) === 0).length;
  const belowMinCount = products.filter(p => (p.stock ?? p.quantityInStock ?? 0) > 0 && (p.stock ?? p.quantityInStock ?? 0) < 10).length;
  const expiredCount = batches.filter(b => b.batch_status === 'expired' || (b.expiryDate && new Date(b.expiryDate) < new Date())).length;
  const inTransitCount = batches.filter(b => b.batch_status === 'in_transit').length;
  const alertCount = zeroStockCount + belowMinCount + expiredCount;

  const userRoles = [profile?.role || 'staff', ...(profile?.secondaryRoles || [])];
  const isManagement = userRoles.some(r => ['ceo', 'CEO', 'CEO / MD', 'finance_head', 'Finance Head', 'IT Head', 'owner'].includes(r));

  const chartData = React.useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const map = days.reduce((acc, d) => ({ ...acc, [d]: 0 }), {} as Record<string, number>);
    
    // Group sales from the last 7 days
    sales.forEach(s => {
      try {
        const d = new Date(s.timestamp);
        const dayName = days[d.getDay()];
        map[dayName] += (s.total || s.totalAmount || 0);
      } catch (e) {}
    });

    return days.map(d => ({ name: d, sales: map[d] }));
  }, [sales]);

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-zinc-900 tracking-tight">Opening Dashboard</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="px-2 py-0.5 bg-zinc-100 text-zinc-500 text-[10px] font-bold uppercase tracking-wider rounded-md border border-zinc-200">
              v2.1 Updated
            </span>
            <p className="text-zinc-500 text-sm font-medium">Live signals from all operational modules.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-white px-4 py-2 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-3">
            <Calendar size={18} className="text-zinc-400" />
            <div className="flex items-center gap-1">
              {['Today', 'This Week', 'This Month'].map((range) => (
                <button 
                  key={range}
                  className={cn(
                    "px-3 py-1 text-xs font-bold rounded-lg transition-all",
                    range === 'Today' ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100"
                  )}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ZONE A: PRIMARY KPI ROW */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        <StatCard 
          title="Revenue Today" 
          value={`UGX ${totalSalesToday.toLocaleString()}`}
          change="+12.5%"
          trend="up"
          icon={TrendingUp}
          color="green"
          subtitle="Cash / MoMo / Card / Insurance"
        />
        <StatCard 
          title="Inventory Value" 
          value={`UGX ${(inventoryValue / 1000000).toFixed(1)}M`}
          change="+2.4%"
          trend="up"
          icon={Package}
          color="blue"
          subtitle="Consolidated at cost"
        />
        <StatCard 
          title="Receivables" 
          value={`UGX ${(outstandingReceivables / 1000000).toFixed(1)}M`}
          change=">60 days"
          trend="down"
          icon={DollarSign}
          color="orange"
          subtitle="Clients + Institutions"
        />
        <StatCard 
          title="System Alerts" 
          value={alertCount.toString()}
          change="Action required"
          trend="down"
          icon={ShieldAlert}
          color="red"
          subtitle="Stock, Compliance, Risk"
          isAlert
        />
        {isManagement && (
          <StatCard 
            title="Sustainability" 
            value="Sustainable"
            change="84% Score"
            trend="up"
            icon={CheckCircle2}
            color="amber"
            subtitle="Predictive Engine Signal"
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ZONE B: SECONDARY ACTION ZONE */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <h2 className="font-black text-zinc-900 uppercase tracking-wider text-sm flex items-center gap-2">
                <Timer size={18} className="text-emerald-500" />
                Priority Task Queue
              </h2>
              <span className="px-2 py-1 bg-emerald-500 text-white text-[10px] font-black rounded-lg">8 NEW</span>
            </div>
            <div className="divide-y divide-zinc-100">
              <TaskItem 
                title="EOD Reconciliation not submitted"
                source="Finance"
                time="Today"
                urgency="critical"
                icon={DollarSign}
              />
              <TaskItem 
                title="Fridge temperature not logged"
                source="QA"
                time="08:00 AM"
                urgency="high"
                icon={AlertCircle}
              />
              <TaskItem 
                title="In-transit delivery pending"
                source="Logistics"
                time="2 hours ago"
                urgency="normal"
                icon={Truck}
              />
              <TaskItem 
                title="Staff license expiring (30 days)"
                source="HR / QA"
                time="Upcoming"
                urgency="low"
                icon={UserCheck}
              />
            </div>
          </div>
        </div>

        {/* Right Side: Live Stock Guard */}
        <div className="space-y-6">
          <div className="bg-zinc-900 rounded-[32px] p-6 text-white shadow-xl shadow-zinc-900/20 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
              <ShieldAlert size={120} />
            </div>
            <h2 className="font-black uppercase tracking-wider text-xs text-zinc-400 mb-6 flex items-center gap-2">
              <div className="h-2 w-2 bg-red-500 rounded-full animate-pulse" />
              Live Stock Guard
            </h2>
            <div className="space-y-4 relative z-10">
              <StockGuardItem label="Zero Stock" count={zeroStockCount} color="red" status="Blocked at POS" />
              <StockGuardItem label="Below Minimum" count={belowMinCount} color="orange" />
              <StockGuardItem label="Expired / Recalled" count={expiredCount} color="grey" status="Blocked at POS" />
              <StockGuardItem label="In Transit" count={inTransitCount} color="blue" />
            </div>
          </div>

          {/* Sustainability Gauge (CEO/Finance Only) */}
          {isManagement && (
            <div className="bg-white rounded-[32px] border border-zinc-200 p-6 shadow-sm">
              <h2 className="font-black text-zinc-900 uppercase tracking-wider text-xs mb-4">Sustainability Run-Rate</h2>
              <div className="space-y-4">
                {(() => {
                  const sustainabilityPct = totalSalesToday > 0 ? Math.min(Math.round((totalSalesToday / 500000) * 100), 100) : 0;
                  return (
                    <>
                      <div className="flex justify-between items-end">
                        <p className="text-2xl font-black text-zinc-900">{sustainabilityPct}%</p>
                        <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Running at {sustainabilityPct}% of pace</p>
                      </div>
                      <div className="h-3 bg-zinc-100 rounded-full overflow-hidden flex">
                        <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${sustainabilityPct}%` }} />
                      </div>
                    </>
                  );
                })()}
                <p className="text-[10px] text-zinc-400 font-medium leading-relaxed">
                  Actual daily sales vs required pace to hit sustainable target (S_SUS).
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ZONE C: ANALYTICS STRIP (COLLAPSIBLE) */}
      <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden">
        <button 
          onClick={() => setIsAnalyticsExpanded(!isAnalyticsExpanded)}
          className="w-full p-6 flex items-center justify-between hover:bg-zinc-50 transition-colors"
        >
          <h2 className="font-black text-zinc-900 uppercase tracking-wider text-sm flex items-center gap-2">
            <BarChart3 size={18} className="text-blue-500" />
            Analytics Strip
          </h2>
          {isAnalyticsExpanded ? <ChevronUp size={20} className="text-zinc-400" /> : <ChevronDown size={20} className="text-zinc-400" />}
        </button>
        
        {isAnalyticsExpanded && (
          <div className="p-8 pt-0 grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Revenue Trend</h3>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                    <XAxis dataKey="name" hide />
                    <YAxis hide />
                    <Tooltip />
                    <Area type="monotone" dataKey="sales" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">COGS vs Sales</h3>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                    <XAxis dataKey="name" hide />
                    <YAxis hide />
                    <Tooltip />
                    <Bar dataKey="sales" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Receivables Aging</h3>
              <div className="h-48 flex items-center justify-center">
                <div className="relative h-32 w-32">
                  <svg className="h-full w-full" viewBox="0 0 36 36">
                    <path className="text-zinc-100" strokeDasharray="100, 100" strokeWidth="4" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path className="text-orange-500" strokeDasharray="70, 100" strokeWidth="4" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-black text-zinc-900">70%</span>
                    <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Current</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Sub-components
interface StatCardProps {
  title: string;
  value: string;
  change: string;
  trend: 'up' | 'down';
  icon: any;
  color: 'green' | 'blue' | 'orange' | 'red' | 'amber';
  subtitle: string;
  isAlert?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, change, trend, icon: Icon, color, subtitle, isAlert }) => {
  const colorMap = {
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    red: 'bg-red-50 text-red-600 border-red-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
  };

  return (
    <div className={cn(
      "bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm hover:shadow-md transition-all group",
      isAlert && "hover:border-red-200"
    )}>
      <div className="flex items-center justify-between mb-4">
        <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center border transition-transform group-hover:scale-110", colorMap[color])}>
          <Icon size={24} />
        </div>
        <div className={cn(
          "flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg",
          trend === 'up' ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
        )}>
          {trend === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {change}
        </div>
      </div>
      <p className="text-zinc-400 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{title}</p>
      <h3 className="text-xl font-black text-zinc-900 tracking-tight">{value}</h3>
      <p className="text-[10px] text-zinc-500 font-medium mt-2">{subtitle}</p>
    </div>
  );
};

const TaskItem: React.FC<{ title: string; source: string; time: string; urgency: 'critical' | 'high' | 'normal' | 'low'; icon: any }> = ({ title, source, time, urgency, icon: Icon }) => {
  const urgencyColors = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    normal: 'bg-blue-500',
    low: 'bg-zinc-300'
  };

  return (
    <div className="p-4 flex items-center gap-4 hover:bg-zinc-50 transition-colors group cursor-pointer">
      <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center bg-zinc-100 text-zinc-400 group-hover:bg-white group-hover:shadow-sm transition-all")}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-zinc-900 truncate">{title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{source}</span>
          <span className="h-1 w-1 bg-zinc-300 rounded-full" />
          <span className="text-[10px] font-medium text-zinc-400">{time}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className={cn("h-2 w-2 rounded-full", urgencyColors[urgency], urgency === 'critical' && "animate-ping")} />
        <button className="p-2 text-zinc-300 hover:text-zinc-900 transition-colors">
          <ArrowUpRight size={18} />
        </button>
      </div>
    </div>
  );
};

const StockGuardItem: React.FC<{ label: string; count: number; color: 'red' | 'orange' | 'grey' | 'blue'; status?: string }> = ({ label, count, color, status }) => {
  const colors = {
    red: 'bg-red-500',
    orange: 'bg-orange-500',
    grey: 'bg-zinc-600',
    blue: 'bg-blue-500'
  };

  return (
    <div className="flex items-center justify-between p-3 bg-white/5 rounded-2xl hover:bg-white/10 transition-colors cursor-pointer border border-white/5">
      <div className="flex items-center gap-3">
        <div className={cn("h-2 w-2 rounded-full", colors[color])} />
        <div>
          <p className="text-xs font-bold text-white">{label}</p>
          {status && <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mt-0.5">{status}</p>}
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-black text-white">{count}</p>
      </div>
    </div>
  );
};

export default Dashboard;
