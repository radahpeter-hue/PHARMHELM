import React, { useState, useEffect } from 'react';
import { 
  BarChart3, PieChart, TrendingUp, Download, 
  Calendar, Filter, FileText, ChevronRight
} from 'lucide-react';
import { db } from '../../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { FuelLog, MaintenanceLog, Trip, Vehicle } from '../../types';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart as RePieChart, Pie } from 'recharts';

import { cn } from '../../utils/cn';

export const LogisticsReports: React.FC = () => {
  const { profile } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile?.tenantId) return;

      const tQuery = query(collection(db, 'trips'), where('tenantId', '==', profile.tenantId));
      const fQuery = query(collection(db, 'fuel_logs'), where('tenantId', '==', profile.tenantId));
      const mQuery = query(collection(db, 'maintenance_logs'), where('tenantId', '==', profile.tenantId));

      const [tSnap, fSnap, mSnap] = await Promise.all([
        getDocs(tQuery),
        getDocs(fQuery),
        getDocs(mQuery)
      ]);

      setTrips(tSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Trip)));
      setFuelLogs(fSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FuelLog)));
      setMaintenanceLogs(mSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaintenanceLog)));
      setLoading(false);
    };

    fetchData();
  }, [profile?.tenantId]);

  // Prepare chart data
  const monthlyCosts = Array.from({ length: 6 }).map((_, i) => {
    const date = subMonths(new Date(), 5 - i);
    const monthStr = format(date, 'MMM');
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(date);

    const fuel = fuelLogs
      .filter(log => {
        const d = new Date(log.date);
        return d >= monthStart && d <= monthEnd;
      })
      .reduce((sum, log) => sum + log.cost_ugx, 0);

    const maintenance = maintenanceLogs
      .filter(log => {
        const d = new Date(log.date);
        return d >= monthStart && d <= monthEnd;
      })
      .reduce((sum, log) => sum + log.cost_ugx, 0);

    return {
      name: monthStr,
      fuel: fuel / 1000, // in thousands
      maintenance: maintenance / 1000,
    };
  });

  const tripStatusData = [
    { name: 'Completed', value: trips.filter(t => t.status === 'completed').length, color: '#10b981' },
    { name: 'In Progress', value: trips.filter(t => t.status === 'in-progress').length, color: '#3b82f6' },
    { name: 'Pending', value: trips.filter(t => t.status === 'pending').length, color: '#f59e0b' },
    { name: 'Cancelled', value: trips.filter(t => t.status === 'cancelled').length, color: '#ef4444' },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">Logistics Analytics</h3>
        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors shadow-sm">
          <Download className="h-4 w-4" />
          <span>Export PDF</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h4 className="font-semibold text-slate-800 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
              Monthly Operational Costs (k UGX)
            </h4>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyCosts}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  cursor={{ fill: '#f8fafc' }}
                />
                <Bar dataKey="fuel" fill="#6366f1" radius={[4, 4, 0, 0]} name="Fuel" />
                <Bar dataKey="maintenance" fill="#10b981" radius={[4, 4, 0, 0]} name="Maintenance" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h4 className="font-semibold text-slate-800 flex items-center gap-2">
              <PieChart className="h-4 w-4 text-indigo-600" />
              Trip Status Distribution
            </h4>
          </div>
          <div className="h-64 w-full flex items-center">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={tripStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {tripStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </RePieChart>
            </ResponsiveContainer>
            <div className="space-y-3 pr-8">
              {tripStatusData.map((item) => (
                <div key={item.name} className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-xs font-medium text-slate-600">{item.name}</span>
                  <span className="text-xs font-bold text-slate-900 ml-auto">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h4 className="font-semibold text-slate-800">Recent Activity</h4>
          <button className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors">View All</button>
        </div>
        <div className="divide-y divide-slate-100">
          {trips.slice(0, 5).map(trip => (
            <div key={trip.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "h-8 w-8 rounded-lg flex items-center justify-center",
                  trip.status === 'completed' ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"
                )}>
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-900">Trip to {trip.route_destination}</div>
                  <div className="text-xs text-slate-500">{trip.driver_name} · {format(new Date(trip.departure_time), 'MMM d')}</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
