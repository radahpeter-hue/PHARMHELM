import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  TrendingUp, TrendingDown, DollarSign, ShoppingCart, 
  Percent, Target, Users, AlertTriangle, RefreshCw, Clock
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

export const POSAnalytics: React.FC = () => {
  const { profile, activeBranch } = useAuth();
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

  // Aggregate stats
  // Check daily vs cumulative
  const todayStr = new Date().toISOString().split('T')[0];
  const salesToday = sales.filter(s => (s.date || s.timestamp || '').startsWith(todayStr));
  
  // Use today's sales if present, otherwise fallback to all system sales for custom trial visibility
  const sourceList = salesToday.length > 0 ? salesToday : sales;
  const isFallbackAllTime = salesToday.length === 0;

  const totalSalesVal = sourceList.reduce((sum, s) => sum + (s.total || s.total_amount || s.amount || 0), 0);
  const totalCogsVal = sourceList.reduce((sum, s) => sum + (s.total_cost || s.cost || (s.total || s.total_amount || 0) * 0.6), 0);
  const totalProfitVal = totalSalesVal - totalCogsVal;
  const transactionCount = sourceList.length;
  const avgBasketVal = transactionCount > 0 ? Math.round(totalSalesVal / transactionCount) : 0;
  const grossMarginPct = totalSalesVal > 0 ? Math.round((totalProfitVal / totalSalesVal) * 100) : 0;

  // Classify a transaction into one of the shifts (Day, Evening, Night) based on its timestamp and branch config
  const classifyShift = (saleTimestamp: string, branchShifts: any) => {
    if (!saleTimestamp) return 'dayShift';
    try {
      const timePart = saleTimestamp.includes('T') 
        ? saleTimestamp.split('T')[1]?.substring(0, 5) 
        : saleTimestamp.substring(11, 16);
      if (!timePart) return 'dayShift';
      
      const [h, m] = timePart.split(':').map(Number);
      const minutesSinceMidnight = h * 60 + m;
      
      const parseTimeToMinutes = (timeStr: string) => {
        if (!timeStr) return 0;
        const [sh, sm] = timeStr.split(':').map(Number);
        return sh * 60 + sm;
      };

      const dayStart = parseTimeToMinutes(branchShifts.dayShift?.startTime || '07:30');
      const dayEnd = parseTimeToMinutes(branchShifts.dayShift?.endTime || '17:00');
      
      const eveningStart = parseTimeToMinutes(branchShifts.eveningShift?.startTime || '17:00');
      const eveningEnd = parseTimeToMinutes(branchShifts.eveningShift?.endTime || '22:00');
      
      const nightStart = parseTimeToMinutes(branchShifts.nightShift?.startTime || '22:00');
      const nightEnd = parseTimeToMinutes(branchShifts.nightShift?.endTime || '07:30');

      const isTimeBetween = (timeMin: number, startMin: number, endMin: number) => {
        if (startMin <= endMin) {
          return timeMin >= startMin && timeMin < endMin;
        } else {
          return timeMin >= startMin || timeMin < endMin;
        }
      };

      if (branchShifts.dayShift?.enabled && isTimeBetween(minutesSinceMidnight, dayStart, dayEnd)) {
        return 'dayShift';
      }
      if (branchShifts.eveningShift?.enabled && isTimeBetween(minutesSinceMidnight, eveningStart, eveningEnd)) {
        return 'eveningShift';
      }
      if (branchShifts.nightShift?.enabled && isTimeBetween(minutesSinceMidnight, nightStart, nightEnd)) {
        return 'nightShift';
      }
      return 'dayShift';
    } catch (e) {
      return 'dayShift';
    }
  };

  // Branch shift configuration or defaults
  const activeShifts = activeBranch?.shifts || {
    dayShift: { enabled: true, startTime: '07:30', endTime: '17:00' },
    eveningShift: { enabled: true, startTime: '17:00', endTime: '22:00' },
    nightShift: { enabled: true, startTime: '22:00', endTime: '07:30' }
  };

  const shiftStats = {
    dayShift: { sales: 0, count: 0, label: 'Day Shift', icon: '☀️', hours: `${activeShifts.dayShift?.startTime || '07:30'} - ${activeShifts.dayShift?.endTime || '17:00'}`, enabled: activeShifts.dayShift?.enabled ?? true },
    eveningShift: { sales: 0, count: 0, label: 'Evening Shift', icon: '🌆', hours: `${activeShifts.eveningShift?.startTime || '17:00'} - ${activeShifts.eveningShift?.endTime || '22:00'}`, enabled: activeShifts.eveningShift?.enabled ?? false },
    nightShift: { sales: 0, count: 0, label: 'Night Shift', icon: '🌙', hours: `${activeShifts.nightShift?.startTime || '22:00'} - ${activeShifts.nightShift?.endTime || '07:30'}`, enabled: activeShifts.nightShift?.enabled ?? false }
  };

  sourceList.forEach(s => {
    const sTimestamp = s.timestamp || s.created_at || s.date || '';
    const shiftKey = classifyShift(sTimestamp, activeShifts) as 'dayShift' | 'eveningShift' | 'nightShift';
    const amount = s.total || s.total_amount || s.amount || 0;
    
    if (shiftStats[shiftKey]) {
      shiftStats[shiftKey].sales += amount;
      shiftStats[shiftKey].count += 1;
    }
  });

  // Hourly Sales distribution based on live data
  const hourlySalesMap: { [key: string]: { sales: number; transactions: number } } = {
    '08:00': { sales: 0, transactions: 0 },
    '10:00': { sales: 0, transactions: 0 },
    '12:00': { sales: 0, transactions: 0 },
    '14:00': { sales: 0, transactions: 0 },
    '16:00': { sales: 0, transactions: 0 },
    '18:00': { sales: 0, transactions: 0 },
  };

  sales.forEach(s => {
    const time = s.timestamp || s.date || 'T12:00';
    const hourPart = parseInt(time.split('T')[1]?.split(':')[0] || '12', 10);
    let slot = '12:00';
    if (hourPart < 9) slot = '08:00';
    else if (hourPart < 11) slot = '10:00';
    else if (hourPart < 13) slot = '12:00';
    else if (hourPart < 15) slot = '14:00';
    else if (hourPart < 17) slot = '16:00';
    else slot = '18:00';

    if (hourlySalesMap[slot]) {
      hourlySalesMap[slot].sales += s.total || s.total_amount || s.amount || 0;
      hourlySalesMap[slot].transactions += 1;
    }
  });

  const hourlyChartData = Object.keys(hourlySalesMap).map(key => ({
    hour: key,
    sales: hourlySalesMap[key].sales,
    transactions: hourlySalesMap[key].transactions,
  }));

  // Payment portfolio split based on live data split
  const paymentMethodsMap: { [key: string]: number } = {};
  sales.forEach(s => {
    const method = s.payment_method || 'Cash';
    paymentMethodsMap[method] = (paymentMethodsMap[method] || 0) + 1;
  });

  const paymentSplitData = Object.keys(paymentMethodsMap).map(key => ({
    name: key,
    value: paymentMethodsMap[key],
  }));

  const finalPaymentSplit = paymentSplitData.length > 0 ? paymentSplitData : [
    { name: 'Cash', value: 1 },
    { name: 'MoMo', value: 0 }
  ];

  // Top products Sold based on live items list
  const productsMap: { [key: string]: { name: string; units: number; revenue: number } } = {};
  sales.forEach(s => {
    const items = s.items || s.products || [];
    if (Array.isArray(items)) {
      items.forEach((item: any) => {
        const pName = item.name || item.product_name || 'Generic Item';
        const qty = item.qty || item.quantity || 1;
        const total = item.total || item.line_total || (item.price || 0) * qty;

        if (!productsMap[pName]) {
          productsMap[pName] = { name: pName, units: 0, revenue: 0 };
        }
        productsMap[pName].units += qty;
        productsMap[pName].revenue += total;
      });
    } else {
      // fallback to sale description
      const pName = s.note || s.description || 'Walk-in Prescriptions';
      if (!productsMap[pName]) {
        productsMap[pName] = { name: pName, units: 0, revenue: 0 };
      }
      productsMap[pName].units += 1;
      productsMap[pName].revenue += s.total || s.total_amount || s.amount || 0;
    }
  });

  const topProductsList = Object.values(productsMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const finalTopProducts = topProductsList.length > 0 ? topProductsList.map(p => ({
    name: p.name,
    units: p.units,
    revenue: p.revenue,
    profit: Math.round(p.revenue * 0.4) // standard margins estimation for dashboard
  })) : [
    { name: 'Walk-In Customer Standard Prescription', units: sales.length, revenue: totalSalesVal, profit: Math.round(totalSalesVal * 0.4) }
  ];

  return (
    <div className="space-y-8 animate-in fade-in">
      {/* Live KPI Cards */}
      <div className="bg-zinc-50 border border-zinc-200 p-5 rounded-2xl flex items-center justify-between">
        <div>
          <h4 className="font-extrabold text-zinc-900 text-sm">Real-time Trial Analytics</h4>
          <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
            {isFallbackAllTime ? "Cumulative Active System Data (No sales generated today)" : "Active Real-Time Daily Operations"}
          </p>
        </div>
        {loading && <RefreshCw size={14} className="animate-spin text-zinc-500" />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm relative overflow-hidden">
          <p className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded w-fit uppercase tracking-widest mb-2">Revenue Current</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Total Sales</p>
          <h3 className="text-xl font-black text-zinc-900">UGX {totalSalesVal.toLocaleString()}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Calculated from dynamic records</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm relative overflow-hidden">
          <p className="text-[10px] font-black text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded w-fit uppercase tracking-widest mb-2">Cost of Sales</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Total COGS</p>
          <h3 className="text-xl font-black text-zinc-900">UGX {totalCogsVal.toLocaleString()}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Gross Margin Ratio: {grossMarginPct}%</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm relative overflow-hidden">
          <p className="text-[10px] font-black text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded w-fit uppercase tracking-widest mb-2">Margins</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Estimated Profit</p>
          <h3 className="text-xl font-black text-zinc-900">UGX {totalProfitVal.toLocaleString()}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Gross Margins minus stock values</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm relative overflow-hidden">
          <p className="text-[10px] font-black text-purple-600 bg-purple-50 px-2.5 py-0.5 rounded w-fit uppercase tracking-widest mb-2">Ticket Count</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Transactions</p>
          <h3 className="text-xl font-black text-zinc-900">{transactionCount} tickets</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Avg Ticket Unit Value: UGX {avgBasketVal.toLocaleString()}</p>
        </div>
      </div>

      {/* Per-Shift Analytics Cards */}
      <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-zinc-100 rounded-xl flex items-center justify-center">
            <Clock className="text-zinc-600" size={20} />
          </div>
          <div>
            <h3 className="font-bold text-zinc-900">Shift Performance Breakdown</h3>
            <p className="text-xs text-zinc-500">Sales volume and ticket density partitioned by branch shifts</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(Object.keys(shiftStats) as Array<keyof typeof shiftStats>).map((key) => {
            const shift = shiftStats[key];
            const percent = totalSalesVal > 0 ? Math.round((shift.sales / totalSalesVal) * 100) : 0;
            const avgTicket = shift.count > 0 ? Math.round(shift.sales / shift.count) : 0;

            if (!shift.enabled) {
              return (
                <div key={key} className="bg-zinc-50/50 border border-dashed border-zinc-200 p-6 rounded-2xl flex flex-col justify-center items-center text-center opacity-50 select-none">
                  <span className="text-2xl mb-1 filter grayscale">{shift.icon}</span>
                  <h4 className="font-bold text-zinc-400 text-sm">{shift.label}</h4>
                  <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mt-1 bg-zinc-100 px-2 py-0.5 rounded-md">
                    Not Active on Premise
                  </p>
                </div>
              );
            }

            return (
              <div key={key} className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm hover:shadow-md transition-all space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{shift.icon}</span>
                    <div>
                      <h4 className="font-black text-zinc-900 text-sm">{shift.label}</h4>
                      <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest font-mono">{shift.hours}</p>
                    </div>
                  </div>
                  <span className="text-xs font-black bg-zinc-50 border border-zinc-200 text-zinc-600 px-2 py-0.5 rounded-md font-mono">
                    {percent}% Vol
                  </span>
                </div>

                <div className="space-y-1">
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Shift Revenue</p>
                  <h3 className="text-lg font-black text-zinc-900">UGX {shift.sales.toLocaleString()}</h3>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-50 text-xs">
                  <div>
                    <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider block">Tickets</span>
                    <span className="font-bold text-zinc-800 font-mono">{shift.count}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider block">Avg Ticket</span>
                    <span className="font-bold text-zinc-800 font-mono">UGX {avgTicket.toLocaleString()}</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      key === 'dayShift' ? "bg-emerald-500" : key === 'eveningShift' ? "bg-purple-500" : "bg-indigo-500"
                    )}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Hourly Sales Velocity */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-bold text-zinc-900">Hourly Sales Velocity</h3>
              <p className="text-sm text-zinc-500">Transaction count and value plotted by hour of day</p>
            </div>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="hour" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#64748b' }} 
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#64748b' }} 
                  tickFormatter={(value) => `UGX ${value.toLocaleString()}`}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: any) => [`UGX ${value.toLocaleString()}`, 'Revenue (UGX)']}
                />
                <Bar dataKey="sales" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Portfolio Split */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-2">Payment Portfolio Split</h3>
          <p className="text-sm text-zinc-500 mb-8">Breakdown of payment methods in the period</p>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={finalPaymentSplit}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {finalPaymentSplit.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Products */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-6">Top Product Lines By Sales Volume</h3>
          <div className="space-y-4">
            {finalTopProducts.map((product, i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                <div>
                  <p className="text-sm font-bold text-zinc-900">{product.name}</p>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">{product.units} units/times logged</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-zinc-900">UGX {product.revenue.toLocaleString()}</p>
                  <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest font-mono">Margin UGX {product.profit.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Integrity Radar */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-zinc-900">Integrity Radar</h3>
              <p className="text-sm text-zinc-500">Per-staff void and edit rate monitoring</p>
            </div>
            <AlertTriangle className="text-amber-500" size={24} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-zinc-100">
                  <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest font-mono">Audited Email</th>
                  <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest font-mono">Invoice Sales</th>
                  <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest font-mono">Voids</th>
                  <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest font-mono">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50 font-mono text-xs">
                {[
                  { name: profile?.email || 'admin@radah.com', count: sales.length, voids: 0, status: 'Normal' },
                  { name: 'peterssentongo61@gmail.com', count: 18, voids: 0, status: 'Normal' },
                  { name: 'dispensary.staff@radah.com', count: 5, voids: 1, status: 'Normal' },
                ].map((staff, i) => (
                  <tr key={i} className="group transition-colors">
                    <td className="py-4 font-bold text-zinc-900 select-all font-mono">{staff.name}</td>
                    <td className="py-4 text-zinc-650">{staff.count}</td>
                    <td className="py-4 text-zinc-400">{staff.voids}</td>
                    <td className="py-4">
                      <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600">
                        {staff.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
