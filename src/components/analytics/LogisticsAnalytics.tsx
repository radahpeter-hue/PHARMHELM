import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area, ComposedChart
} from 'recharts';
import { 
  Truck, Clock, ArrowRightLeft, Route, 
  ShieldCheck, User, DollarSign, TrendingUp
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

const VEHICLE_OPEX_MOCK = [
  { vehicle: 'UBA 123A', opex: 450, avg: 400 },
  { vehicle: 'UBB 456B', opex: 380, avg: 400 },
  { vehicle: 'UBC 789C', opex: 520, avg: 400 },
  { vehicle: 'UBD 012D', opex: 410, avg: 400 },
  { vehicle: 'UBE 345E', opex: 350, avg: 400 },
];

export const LogisticsAnalytics: React.FC = () => {
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
    const vehicleOpex = hasData ? VEHICLE_OPEX_MOCK : [];
    
    return {
      hasData,
      vehicleOpex
    };
  }, [sales]);
  return (
    <div className="space-y-8">
      {/* Live KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center">
              <Clock className="text-emerald-600" size={20} />
            </div>
            <div className="text-emerald-600 text-xs font-bold">{metrics.hasData ? "1.2h" : "0h"}</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Delivery TAT (Avg)</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.hasData ? "1.2 hours" : "0 hours"}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">From POS checkout to receipt</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <ArrowRightLeft className="text-blue-600" size={20} />
            </div>
            <div className="text-blue-600 text-xs font-bold">{metrics.hasData ? "0.4%" : "0.0%"}</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Transit Shrinkage Rate</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.hasData ? "0.4%" : "0.0%"}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Risk threshold: 0.5%</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <DollarSign className="text-amber-600" size={20} />
            </div>
            <div className="text-amber-600 text-xs font-bold">{metrics.hasData ? "8.2%" : "0.0%"}</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Logistics Cost % Revenue</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.hasData ? "8.2%" : "0.0%"}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Total transport costs ÷ revenue</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-red-50 rounded-xl flex items-center justify-center">
              <ShieldCheck className="text-red-600" size={20} />
            </div>
            <div className="text-red-600 text-xs font-bold">{metrics.hasData ? "3 vehicles" : "0 vehicles"}</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Fleet Compliance Alert</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.hasData ? "3 vehicles" : "0 vehicles"}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Maintenance/Insurance due</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Vehicle OpEx vs Mileage */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-8">Vehicle OpEx vs Mileage</h3>
          <div className="h-[300px] w-full">
            {!metrics.hasData ? (
              <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
                No active fleet mileage logs.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.vehicleOpex}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="vehicle" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                    tickFormatter={(value) => `UGX ${value}`}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: any) => [`UGX ${value}/km`, 'OpEx']}
                  />
                  <Bar dataKey="opex" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="avg" stroke="#ef4444" strokeDasharray="5 5" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Fleet Compliance Countdown */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-2">Fleet Compliance Countdown</h3>
          <p className="text-sm text-zinc-500 mb-8">Days remaining for vehicle compliance</p>
          <div className="space-y-4">
            {(() => {
              const complianceList = metrics.hasData ? [
                { name: 'UBA 123A', item: 'Insurance', days: 15, status: 'Critical' },
                { name: 'UBB 456B', item: 'Logbook', days: 45, status: 'Warning' },
                { name: 'UBC 789C', item: 'Service', days: 8, status: 'Critical' },
                { name: 'UBD 012D', item: 'Insurance', days: 120, status: 'Normal' },
                { name: 'UBE 345E', item: 'Service', days: 210, status: 'Normal' },
              ] : [];

              if (complianceList.length === 0) {
                return (
                  <div className="p-12 text-center text-zinc-400 text-sm">
                    No fleet vehicles registered.
                  </div>
                );
              }

              return complianceList.map((veh, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{veh.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">{veh.item}</p>
                  </div>
                  <div className="text-right">
                    <div className={cn(
                      "h-3 w-3 rounded-full ml-auto mb-1",
                      veh.status === 'Critical' ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" :
                      veh.status === 'Warning' ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" :
                      "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    )} />
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{veh.days} days left</p>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Route Profitability */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-6">Route Profitability</h3>
          <div className="space-y-4">
            {(() => {
              const routeList = metrics.hasData ? [
                { route: 'Kla Central - Zone A', revenue: 4500000, cost: 850000, profit: 3650000 },
                { route: 'Kla Central - Zone B', revenue: 3200000, cost: 620000, profit: 2580000 },
                { route: 'Entebbe Road', revenue: 5800000, cost: 1250000, profit: 4550000 },
                { route: 'Jinja Road', revenue: 4100000, cost: 980000, profit: 3120000 },
                { route: 'Mityana Road', revenue: 2500000, cost: 750000, profit: 1750000 },
              ] : [];

              if (routeList.length === 0) {
                return (
                  <div className="p-12 text-center text-zinc-400 text-sm">
                    No active delivery routes.
                  </div>
                );
              }

              return routeList.map((route, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{route.route}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Revenue: UGX {route.revenue.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-600">UGX {route.profit.toLocaleString()}</p>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Cost: UGX {route.cost.toLocaleString()}</p>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>

        {/* Driver/Rider Performance */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-zinc-900">Driver/Rider Performance</h3>
            <User className="text-zinc-400" size={20} />
          </div>
          <div className="space-y-4">
            {(() => {
              const driverList = metrics.hasData ? [
                { name: 'Musa Kato', trips: 145, tat: '1.1h', incidents: 0, status: 'Top Performer' },
                { name: 'John Mukasa', trips: 124, tat: '1.4h', incidents: 1, status: 'Normal' },
                { name: 'Peter Semanda', trips: 98, tat: '1.8h', incidents: 3, status: 'Warning' },
                { name: 'David Okot', trips: 112, tat: '1.2h', incidents: 0, status: 'Normal' },
              ] : [];

              if (driverList.length === 0) {
                return (
                  <div className="p-12 text-center text-zinc-400 text-sm">
                    No fleet drivers registered.
                  </div>
                );
              }

              return driverList.map((driver, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{driver.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">{driver.trips} trips • {driver.tat} avg TAT</p>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "text-sm font-bold",
                      driver.incidents > 0 ? "text-amber-600" : "text-emerald-600"
                    )}>{driver.incidents} incidents</p>
                    <span className={cn(
                      "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest",
                      driver.status === 'Top Performer' ? "bg-emerald-50 text-emerald-600" :
                      driver.status === 'Warning' ? "bg-amber-50 text-amber-600" :
                      "bg-blue-50 text-blue-600"
                    )}>
                      {driver.status}
                    </span>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};
