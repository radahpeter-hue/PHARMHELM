import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, TrendingDown, Clock, Award, ShieldAlert, AlertTriangle, Calendar
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';

const COLORS = ['emerald', 'blue', 'amber', 'purple', 'zinc'];

export const HRAnalytics: React.FC = () => {
  const { profile } = useAuth();
  const [staffList, setStaffList] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.tenantId) {
      setLoading(true);
      const unsubStaff = firestoreService.subscribeToCollection('staff', profile.tenantId, (data) => {
        setStaffList(data);
      });
      
      const unsubSales = firestoreService.subscribeToCollection('sales', profile.tenantId, (data) => {
        setSales(data);
      });

      const unsubAttendance = firestoreService.subscribeToCollection('attendance_records', profile.tenantId, (data) => {
        setAttendance(data);
      });

      const unsubIncidents = firestoreService.subscribeToCollection('disciplinary_incidents', profile.tenantId, (data) => {
        setIncidents(data);
        setLoading(false);
      });
      
      return () => {
        unsubStaff();
        unsubSales();
        unsubAttendance();
        unsubIncidents();
      };
    }
  }, [profile?.tenantId]);

  const metrics = useMemo(() => {
    const totalStaff = staffList.length;

    // 1. Dispenser Leaderboard (Aggregate sales by cashierId/servedBy)
    const staffSales: Record<string, { total: number; txCount: number }> = {};
    sales.forEach(sale => {
      const cashierId = sale.cashierId || sale.servedBy;
      if (cashierId) {
        if (!staffSales[cashierId]) {
          staffSales[cashierId] = { total: 0, txCount: 0 };
        }
        staffSales[cashierId].total += sale.total || sale.totalAmount || 0;
        staffSales[cashierId].txCount += 1;
      }
    });

    const leaderboardList = staffList.map((staff, i) => {
      const salesInfo = staffSales[staff.id] || staffSales[staff.uid] || { total: 0, txCount: 0 };
      return {
        name: staff.full_name || staff.displayName || 'Unnamed Staff',
        sales: salesInfo.total,
        transactions: salesInfo.txCount,
        abv: salesInfo.txCount > 0 ? Math.round(salesInfo.total / salesInfo.txCount) : 0,
        color: COLORS[i % COLORS.length]
      };
    }).filter(s => s.sales > 0).sort((a, b) => b.sales - a.sales).slice(0, 5);

    const topDispenser = leaderboardList.length > 0 ? leaderboardList[0].name : 'None';

    // 2. Staff Cost-to-Revenue Ratio (Calculate sum of base salaries / total sales)
    const totalSalary = staffList.reduce((sum, s) => sum + (s.salary_base || 0), 0);
    const totalSales = sales.reduce((sum, s) => sum + (s.total || s.totalAmount || 0), 0);
    const staffCostRatio = totalSales > 0 
      ? `${((totalSalary / totalSales) * 100).toFixed(1)}%` 
      : '0.0%';

    // 3. Disciplinary incident mapping & Fraud risk scores
    // Each staff starts at risk score 5, +25 per disciplinary incident
    const staffIncidentsCount: Record<string, number> = {};
    incidents.forEach(inc => {
      if (inc.staffId) {
        staffIncidentsCount[inc.staffId] = (staffIncidentsCount[inc.staffId] || 0) + 1;
      }
    });

    const fraudRiskList = staffList.map((staff, i) => {
      const incCount = staffIncidentsCount[staff.id] || staffIncidentsCount[staff.uid] || 0;
      const score = Math.min(5 + (incCount * 25), 100);
      let status = 'Low';
      let color = 'emerald';
      if (score >= 60) {
        status = 'High';
        color = 'red';
      } else if (score >= 25) {
        status = 'Medium';
        color = 'amber';
      }
      return {
        name: staff.full_name || staff.displayName || 'Unnamed Staff',
        score,
        status,
        color
      };
    }).sort((a, b) => b.score - a.score).slice(0, 5);

    const avgFraudRiskVal = fraudRiskList.length > 0 
      ? Math.round(fraudRiskList.reduce((sum, f) => sum + f.score, 0) / fraudRiskList.length) 
      : 0;
    const avgFraudRisk = `${avgFraudRiskVal} / 100`;

    // 4. Attendance calculations (attendance_records)
    const totalAttendanceCount = attendance.length;
    const presentAttendanceCount = attendance.filter(a => a.status === 'Present' || a.status === 'Late').length;
    const attendancePct = totalAttendanceCount > 0 
      ? `${Math.round((presentAttendanceCount / totalAttendanceCount) * 100)}%` 
      : '0%';

    const staffAttendance: Record<string, { present: number; late: number; absent: number }> = {};
    attendance.forEach(a => {
      if (a.staffId) {
        if (!staffAttendance[a.staffId]) {
          staffAttendance[a.staffId] = { present: 0, late: 0, absent: 0 };
        }
        if (a.status === 'Present') staffAttendance[a.staffId].present++;
        else if (a.status === 'Late') staffAttendance[a.staffId].late++;
        else if (a.status === 'Absent') staffAttendance[a.staffId].absent++;
      }
    });

    const attendanceList = staffList.map(staff => {
      const att = staffAttendance[staff.id] || staffAttendance[staff.uid] || { present: 0, late: 0, absent: 0 };
      return {
        name: staff.full_name || staff.displayName || 'Unnamed Staff',
        present: att.present,
        late: att.late,
        absent: att.absent
      };
    }).filter(a => (a.present + a.late + a.absent) > 0).slice(0, 5);

    return {
      totalStaff,
      topDispenser,
      staffCostRatio,
      avgFraudRisk,
      attendancePct,
      leaderboardList,
      fraudRiskList,
      attendanceList
    };
  }, [staffList, sales, attendance, incidents]);

  return (
    <div className="space-y-8">
      {/* Live KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center">
              <Award className="text-emerald-600" size={20} />
            </div>
            <div className="text-emerald-600 text-xs font-bold">Top: {metrics.topDispenser.split(' ')[0]}</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Dispenser Leaderboard</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.topDispenser}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Highest revenue this month</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <TrendingDown className="text-blue-600" size={20} />
            </div>
            <div className="text-blue-600 text-xs font-bold">{metrics.staffCostRatio}</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Staff Cost-to-Revenue</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.staffCostRatio}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Total salary ÷ branch revenue</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <ShieldAlert className="text-amber-600" size={20} />
            </div>
            <div className="text-amber-600 text-xs font-bold">{incidents.length} logs</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Fraud Risk Score (Avg)</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.avgFraudRisk}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Composite risk assessment</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-purple-50 rounded-xl flex items-center justify-center">
              <Calendar className="text-purple-600" size={20} />
            </div>
            <div className="text-purple-600 text-xs font-bold">{metrics.attendancePct}</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Attendance Pattern</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.attendancePct}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">On-time arrival rate</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Dispenser Revenue Leaderboard */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-8">Dispenser Revenue Leaderboard</h3>
          <div className="space-y-4">
            {metrics.leaderboardList.length === 0 ? (
              <div className="p-12 text-center text-zinc-400 text-sm">
                No active staff revenue records.
              </div>
            ) : (
              metrics.leaderboardList.map((staff, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 bg-white rounded-full border border-zinc-200 flex items-center justify-center text-xs font-black text-zinc-400">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-zinc-900">{staff.name}</p>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">
                        {staff.transactions} transactions • ABV: UGX {staff.abv.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-zinc-900">UGX {staff.sales.toLocaleString()}</p>
                    <div className="h-1.5 w-24 bg-zinc-200 rounded-full mt-1 overflow-hidden">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          staff.color === 'emerald' ? "bg-emerald-500" :
                          staff.color === 'blue' ? "bg-blue-500" :
                          staff.color === 'amber' ? "bg-amber-500" :
                          staff.color === 'purple' ? "bg-purple-500" : "bg-zinc-500"
                        )}
                        style={{ width: `${Math.min((staff.sales / Math.max(...metrics.leaderboardList.map(l => l.sales))) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Disciplinary Heatmap */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-bold text-zinc-900">Disciplinary Heatmap</h3>
            <AlertTriangle className="text-zinc-400" size={20} />
          </div>
          <p className="text-sm text-zinc-500 mb-8">Frequency and category of incidents</p>
          <div className="grid grid-cols-4 gap-2">
            {/* Heatmap Grid */}
            {Array.from({ length: 16 }).map((_, i) => {
              const matchesIncidents = incidents.length > 0 && i < incidents.length;
              return (
                <div 
                  key={i} 
                  className={cn(
                    "aspect-square rounded-lg transition-all hover:scale-105 cursor-help",
                    matchesIncidents ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.3)]" : "bg-zinc-100"
                  )}
                  title={matchesIncidents ? `Incident: ${incidents[i].incidentType || 'Misconduct'}` : `Incidents: 0`}
                />
              );
            })}
          </div>
          <div className="mt-6 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            <span>Low Risk</span>
            <div className="flex gap-1">
              <div className="w-3 h-3 bg-zinc-100 rounded-sm" />
              <div className="w-3 h-3 bg-amber-200 rounded-sm" />
              <div className="w-3 h-3 bg-amber-500 rounded-sm" />
              <div className="w-3 h-3 bg-red-500 rounded-sm" />
            </div>
            <span>High Risk</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Fraud Risk Score */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-6">Fraud Risk Score</h3>
          <div className="space-y-4">
            {metrics.fraudRiskList.length === 0 ? (
              <div className="p-12 text-center text-zinc-400 text-sm">
                No active staff logs.
              </div>
            ) : (
              metrics.fraudRiskList.map((staff, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{staff.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Risk Assessment: {staff.status}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "text-sm font-black",
                      staff.color === 'red' ? "text-red-600" :
                      staff.color === 'amber' ? "text-amber-600" : "text-emerald-600"
                    )}>{staff.score} / 100</p>
                    <div className="h-1.5 w-24 bg-zinc-200 rounded-full mt-1 overflow-hidden">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          staff.color === 'red' ? "bg-red-500" :
                          staff.color === 'amber' ? "bg-amber-500" : "bg-emerald-500"
                        )}
                        style={{ width: `${staff.score}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Attendance & Lateness Pattern */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-6">Attendance & Lateness Pattern</h3>
          <div className="space-y-4">
            {metrics.attendanceList.length === 0 ? (
              <div className="p-12 text-center text-zinc-400 text-sm">
                No attendance patterns logged.
              </div>
            ) : (
              metrics.attendanceList.map((staff, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{staff.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium font-mono">
                      Present: {staff.present}d • Late: {staff.late}d • Absent: {staff.absent}d
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={cn(
                      "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest",
                      staff.absent > 3 ? "bg-red-50 text-red-600" :
                      staff.late > 2 ? "bg-amber-50 text-amber-600" :
                      "bg-emerald-50 text-emerald-600"
                    )}>
                      {staff.absent > 3 ? 'Critical' : staff.late > 2 ? 'Warning' : 'Excellent'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
