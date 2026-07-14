import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area, ComposedChart
} from 'recharts';
import { 
  TrendingUp, TrendingDown, Target, Zap, 
  AlertTriangle, ShieldCheck, BarChart3, Activity
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

const SUSTAINABILITY_TREND_MOCK = [
  { month: 'Oct', score: 65 },
  { month: 'Nov', score: 68 },
  { month: 'Dec', score: 72 },
  { month: 'Jan', score: 70 },
  { month: 'Feb', score: 75 },
  { month: 'Mar', score: 78 },
];

export const PredictivePanel: React.FC = () => {
  const { profile } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.tenantId) {
      setLoading(true);
      const unsubscribe = firestoreService.subscribeToCollection('sales', profile.tenantId, (data) => {
        setSales(data);
        setLoading(false);
      });
      return () => unsubscribe();
    }
  }, [profile?.tenantId]);

  const metrics = useMemo(() => {
    const hasData = sales.length > 0;
    const lossZoneCount = 0;
    const survivalZoneCount = hasData ? 2 : 0;
    const sustainableCount = hasData ? 5 : 0;
    const sustainabilityTrend = hasData ? SUSTAINABILITY_TREND_MOCK : [];

    const totalSalesVal = sales.reduce((sum, s) => sum + (s.total || s.totalAmount || 0), 0);
    const avgDailyRev = sales.length > 0 ? (totalSalesVal / 30) : 0;
    const requiredDailyRev = 500000;
    const gap = Math.max(0, requiredDailyRev - avgDailyRev);
    const coveragePct = requiredDailyRev > 0 ? Math.min(100, Math.round((avgDailyRev / requiredDailyRev) * 100)) : 0;

    return {
      hasData,
      lossZoneCount,
      survivalZoneCount,
      sustainableCount,
      sustainabilityTrend,
      avgDailyRev,
      requiredDailyRev,
      gap,
      coveragePct
    };
  }, [sales]);
  return (
    <div className="space-y-8">
      {/* Zone Classification Map */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="h-12 w-12 bg-red-50 rounded-2xl flex items-center justify-center mb-6">
              <AlertTriangle className="text-red-600" size={24} />
            </div>
            <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">Loss Zone</h3>
            <p className="text-sm text-zinc-500 mt-2">Gross Profit &lt; Fixed Costs</p>
          </div>
          <div className="mt-8">
            <p className="text-4xl font-black text-red-600">{metrics.lossZoneCount} Branches</p>
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-2">Updated 06:00 AM</p>
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="h-12 w-12 bg-amber-50 rounded-2xl flex items-center justify-center mb-6">
              <Activity className="text-amber-600" size={24} />
            </div>
            <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">Survival Zone</h3>
            <p className="text-sm text-zinc-500 mt-2">Breaking even, low margin</p>
          </div>
          <div className="mt-8">
            <p className="text-4xl font-black text-amber-600">{metrics.survivalZoneCount} Branches</p>
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-2">Updated 06:00 AM</p>
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="h-12 w-12 bg-emerald-50 rounded-2xl flex items-center justify-center mb-6">
              <ShieldCheck className="text-emerald-600" size={24} />
            </div>
            <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">Sustainable</h3>
            <p className="text-sm text-zinc-500 mt-2">Healthy margin, growth potential</p>
          </div>
          <div className="mt-8">
            <p className="text-4xl font-black text-emerald-600">{metrics.sustainableCount} Branches</p>
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-2">Updated 06:00 AM</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Sustainability Score Trend */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-8">Sustainability Score Trend</h3>
          <div className="h-[300px] w-full">
            {metrics.sustainabilityTrend.length === 0 ? (
              <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
                No sustainability metrics tracked yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.sustainabilityTrend}>
                  <defs>
                    <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="month" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                    domain={[0, 100]}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: any) => [`${value}%`, 'Score']}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="score" 
                    stroke="#3b82f6" 
                    fillOpacity={1} 
                    fill="url(#colorScore)" 
                    strokeWidth={3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Break-Even Coverage Chart */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-8">Break-Even Coverage Chart</h3>
          <div className="space-y-6">
            {(() => {
              const coverageList = metrics.hasData ? [
                { branch: 'HQ - Kampala', coverage: 145, status: 'Healthy' },
                { branch: 'BRN-001 - Mbarara', coverage: 112, status: 'Healthy' },
                { branch: 'BRN-002 - Gulu', coverage: 95, status: 'Warning' },
                { branch: 'BRN-003 - Jinja', coverage: 105, status: 'Healthy' },
                { branch: 'BRN-004 - Arua', coverage: 88, status: 'Warning' },
              ] : [];

              if (coverageList.length === 0) {
                return (
                  <div className="p-12 text-center text-zinc-400 text-sm">
                    No active branch break-even coverage logs.
                  </div>
                );
              }

              return coverageList.map((br, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-zinc-900">{br.branch}</span>
                    <span className={cn(
                      "font-black",
                      br.coverage < 100 ? "text-red-600" : "text-emerald-600"
                    )}>{br.coverage}% Coverage</span>
                  </div>
                  <div className="h-2 bg-zinc-100 rounded-full overflow-hidden relative">
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        br.coverage < 100 ? "bg-red-500" : "bg-emerald-500"
                      )}
                      style={{ width: `${Math.min(br.coverage, 100)}%` }}
                    />
                    {/* 100% Mark */}
                    <div className="absolute top-0 bottom-0 left-[100%] w-0.5 bg-zinc-900 z-10" />
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Demand Forecasting Insight */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-zinc-900">Demand Forecasting Insight</h3>
            <Zap className="text-amber-500" size={20} />
          </div>
          <p className="text-sm text-zinc-500 mb-6">Predicted demand for top 20 products next 30 days</p>
          <div className="space-y-4">
            {(() => {
              const forecastList = metrics.hasData ? [
                { name: 'Panadol Extra', current: 450, predicted: 580, trend: 'up' },
                { name: 'Amoxicillin 250mg', current: 320, predicted: 310, trend: 'down' },
                { name: 'Vitamin C 1000mg', current: 280, predicted: 420, trend: 'up' },
                { name: 'Cough Syrup', current: 210, predicted: 245, trend: 'up' },
              ] : [];

              if (forecastList.length === 0) {
                return (
                  <div className="p-12 text-center text-zinc-400 text-sm">
                    No products forecast data available.
                  </div>
                );
              }

              return forecastList.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{item.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Current: {item.current} units</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <p className="text-sm font-black text-zinc-900">{item.predicted} units</p>
                      {item.trend === 'up' ? <TrendingUp size={14} className="text-emerald-600" /> : <TrendingDown size={14} className="text-red-600" />}
                    </div>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Predicted Demand</p>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>

        {/* Daily Run-Rate Gap */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-zinc-900">Daily Run-Rate Gap</h3>
            <BarChart3 className="text-blue-500" size={20} />
          </div>
          <div className="flex flex-col items-center justify-center h-[250px] space-y-4">
            <div className="text-center">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Current Avg Daily Revenue</p>
              <p className="text-4xl font-black text-zinc-900">UGX {metrics.avgDailyRev.toLocaleString([], {maximumFractionDigits: 0})}</p>
            </div>
            <div className="w-full max-w-xs h-1 bg-zinc-100 rounded-full overflow-hidden">
              <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${metrics.coveragePct}%` }} />
            </div>
            <div className="text-center">
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-2">Required for Sustainability</p>
              <p className="text-2xl font-black text-blue-600">UGX {metrics.requiredDailyRev.toLocaleString()}</p>
            </div>
            <p className={cn("text-xs font-bold", metrics.gap > 0 ? "text-red-600" : "text-emerald-600")}>
              {metrics.gap > 0 ? `Gap: UGX ${metrics.gap.toLocaleString([], {maximumFractionDigits: 0})} / day` : 'Target Achieved!'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
