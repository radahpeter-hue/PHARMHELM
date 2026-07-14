import React, { useState, useEffect, useMemo } from 'react';
import { 
  Download, Calendar, BarChart3, FileSpreadsheet, Clock, CalendarDays, Users, 
  Briefcase, Activity, Sparkles, Filter, FileText, CheckCircle, TrendingUp, AlertCircle
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { Staff, LeaveRequest, HiringApplication } from '../../types';
import { toast } from 'sonner';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, 
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area
} from 'recharts';

export const HRReportsConsole: React.FC = () => {
  const { profile } = useAuth();
  
  // Data subscriptions
  const [staff, setStaff] = useState<Staff[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [candidates, setCandidates] = useState<HiringApplication[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  
  // Navigation tabs of Reports Console
  const [activeSubTab, setActiveSubTab] = useState<'insights' | 'exports'>('insights');

  // Filter Periods
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Staff>('staff', profile.tenantId, setStaff);
      firestoreService.subscribeToCollection<any>('attendance', profile.tenantId, setAttendance);
      firestoreService.subscribeToCollection<LeaveRequest>('leave_requests', profile.tenantId, setLeaves);
      firestoreService.subscribeToCollection<HiringApplication>('hiring_applications', profile.tenantId, setCandidates);
      firestoreService.subscribeToCollection<any>('branches', profile.tenantId, setBranches);
    }
  }, [profile?.tenantId]);

  // Color Palette for charts
  const CHART_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];

  // Helper trigger to download CSV
  const downloadCSV = (filename: string, headers: string[], rows: any[][]) => {
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${(val ?? '').toString().replace(/"/g, '""')}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Report downloaded: ${filename}`);
  };

  // 1: Hours Worked Report Export
  const exportHoursWorkedReport = () => {
    const filteredAttendance = attendance.filter(a => a.date >= fromDate && a.date <= toDate);
    
    if (filteredAttendance.length === 0) {
      toast.warning('No attendance records found for the selected period.');
      return;
    }

    const headers = [
      'Record ID', 'Employee Name', 'Log Date', 'Attendance Status', 
      'Check In Time', 'Check Out Time', 'Hours Logged', 'Assigned Branch'
    ];

    const rows = filteredAttendance.map(item => {
      const sId = item.staffId || item.staff_id;
      const matchStaff = staff.find(s => s.id === sId || s.uid === sId);
      
      const bId = item.branch_id || item.branchId;
      const branchObj = branches.find(b => b.id === bId);
      const branchName = branchObj?.name || branchObj?.branch_name || branchObj?.branchName || bId || 'HQ';

      return [
        item.id,
        item.staff_name || matchStaff?.full_name || matchStaff?.fullName || matchStaff?.displayName || 'Unspecified Staff',
        item.date,
        item.status || 'not logged',
        item.check_in_time || '—',
        item.check_out_time || '—',
        item.hours_worked ?? 0,
        branchName
      ];
    });

    downloadCSV(`hr_hours_worked_report_${fromDate}_to_${toDate}.csv`, headers, rows);
  };

  // 2: Leaves Taken Registry Export
  const exportLeavesReport = () => {
    if (leaves.length === 0) {
      toast.warning('No leave requests recorded.');
      return;
    }

    const headers = [
      'ID', 'Employee Name', 'Leave Category/Type', 'Start Date', 
      'End Date', 'Total Calendar Days', 'Reason/Dossier Notes', 'Approval Status', 'HR Appraisal'
    ];

    const rows = leaves.map(l => {
      const matchStaff = staff.find(s => s.id === l.staffId || s.id === l.staff_id);
      return [
        l.id,
        l.staff_name || matchStaff?.full_name || 'Staff',
        l.leave_type || 'Annual',
        l.startDate || '—',
        l.endDate || '—',
        l.total_days || 0,
        l.reason || 'No written reason details',
        l.status || 'pending',
        l.hr_approval_status || 'Unreviewed'
      ];
    });

    downloadCSV(`hr_leaves_registry_report.csv`, headers, rows);
  };

  // 3: Active Staff Roster Export
  const exportStaffRosterReport = () => {
    if (staff.length === 0) {
      toast.warning('Staff Roster is empty.');
      return;
    }

    const headers = [
      'Staff ID', 'Full Name', 'Internal Account Username', 'Primary Email', 
      'Mobile contacts', 'Corporate Designation/Role', 'Rationing Scheme', 'Gross salary pay base', 'Joined Date', 'Roster Status'
    ];

    const rows = staff.map(s => [
      s.id,
      s.full_name,
      s.username || 'no-account',
      s.email || '—',
      s.phone || '—',
      s.role || 'Officer',
      s.remunerationType || 'Salary',
      s.remunerationRate || 0,
      s.joinedDate || '—',
      s.status || 'active'
    ]);

    downloadCSV(`hr_workforce_roster_report.csv`, headers, rows);
  };

  // 4: Recruitment & Candidates Pipeline Export
  const exportRecruitmentReport = () => {
    if (candidates.length === 0) {
      toast.warning('Recruitment entries databases are empty.');
      return;
    }

    const headers = [
      'Application ID', 'Candidate full name', 'Position requested', 'Education Level', 
      'Years Experience', 'Current Pipeline Stage', 'Applied date', 
      'Theoretical Assessment Exam mark (%)', 'Oral Interview evaluation Rating (%)', 'On-Field Practical exam marks (%)'
    ];

    const rows = candidates.map(c => [
      c.id,
      c.full_name,
      c.position_applied || '—',
      c.education_level || 'Diploma',
      c.experience_years || 0,
      c.status || 'applied',
      c.applied_at || '—',
      c.theory_score !== null && c.theory_score !== undefined ? `${c.theory_score}%` : 'Not evaluated',
      c.oral_score !== null && c.oral_score !== undefined ? `${c.oral_score}%` : 'Not evaluated',
      c.practical_score !== null && c.practical_score !== undefined ? `${c.practical_score}%` : 'Not evaluated'
    ]);

    downloadCSV(`hr_recruitment_assessments_report.csv`, headers, rows);
  };

  // 5: Trainee Performance Report Export
  const exportTraineesReport = () => {
    const trainees = candidates.filter(c => 
      ['recommended_training', 'training_accepted', 'hired', 'rejected'].includes(c.status) &&
      (c.training_recommended_date || c.training_accepted_date)
    );

    if (trainees.length === 0) {
      toast.warning('No active or previous trainees profiles registered in training archives.');
      return;
    }

    const headers = [
      'Trainee ID', 'Full Name', 'Target Designation', 'Recruitment Date', 
      'Recommended date', 'Training accepted date',
      'Week 4 Appraisal %', 'Week 4 Exam %',
      'Week 8 Appraisal %', 'Week 8 Exam %',
      'Week 12 Appraisal %', 'Week 12 Exam %', 'Milestone Outcome'
    ];

    const rows = trainees.map(t => [
      t.id,
      t.full_name,
      t.position_applied || '—',
      t.applied_at || '—',
      t.training_recommended_date || '—',
      t.training_accepted_date || '—',
      t.week4_appraisal_score !== null && t.week4_appraisal_score !== undefined ? `${t.week4_appraisal_score}%` : 'Not evaluated',
      t.week4_theory_score !== null && t.week4_theory_score !== undefined ? `${t.week4_theory_score}%` : 'Not evaluated',
      t.week8_appraisal_score !== null && t.week8_appraisal_score !== undefined ? `${t.week8_appraisal_score}%` : 'Not evaluated',
      t.week8_theory_score !== null && t.week8_theory_score !== undefined ? `${t.week8_theory_score}%` : 'Not evaluated',
      t.week12_appraisal_score !== null && t.week12_appraisal_score !== undefined ? `${t.week12_appraisal_score}%` : 'Not evaluated',
      t.week12_theory_score !== null && t.week12_theory_score !== undefined ? `${t.week12_theory_score}%` : 'Not evaluated',
      t.status === 'hired' ? 'Graduated & Hired' : t.status === 'rejected' ? 'Terminated/Failed' : 'Active in Training'
    ]);

    downloadCSV(`hr_trainee_performance_academic_report.csv`, headers, rows);
  };

  // ==================== VISUAL DATA AGGREGATION & MEMOIZATION ====================

  // Aggregate Staff designations/roles count
  const staffRoleData = useMemo(() => {
    const counts: { [role: string]: number } = {};
    staff.forEach(s => {
      const r = s.role || 'Staff / Officer';
      counts[r] = (counts[r] || 0) + 1;
    });
    return Object.keys(counts).map(key => ({
      name: key,
      value: counts[key]
    })).sort((a, b) => b.value - a.value);
  }, [staff]);

  // Aggregate daily total logged hours or entries over range
  const dailyAttendanceTrend = useMemo(() => {
    const dailyMap: { [date: string]: { date: string; hours: number; present: number; total: number } } = {};
    
    // Fill the keys of selected range to avoid layout empty cut-offs
    const start = new Date(fromDate);
    const end = new Date(toDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dStr = d.toISOString().split('T')[0];
      dailyMap[dStr] = { date: dStr, hours: 0, present: 0, total: 0 };
    }

    attendance.forEach(log => {
      if (log.date >= fromDate && log.date <= toDate) {
        if (!dailyMap[log.date]) {
          dailyMap[log.date] = { date: log.date, hours: 0, present: 0, total: 0 };
        }
        dailyMap[log.date].total += 1;
        if (log.status === 'present') {
          dailyMap[log.date].present += 1;
          dailyMap[log.date].hours += log.hours_worked || 0;
        }
      }
    });

    return Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  }, [attendance, fromDate, toDate]);

  // Candidate funnel aggregates
  const recruitmentFunnel = useMemo(() => {
    const stages: { [key: string]: number } = {
      'applied': 0,
      'recommended_training': 0,
      'training_accepted': 0,
      'hired': 0,
      'rejected': 0
    };

    candidates.forEach(c => {
      const st = c.status || 'applied';
      if (st in stages) {
        stages[st]++;
      } else {
        stages['applied']++;
      }
    });

    return [
      { name: 'Applied Candidates', value: stages['applied'] },
      { name: 'Recommended', value: stages['recommended_training'] },
      { name: 'In Active Training', value: stages['training_accepted'] },
      { name: 'Onboarded / Hired', value: stages['hired'] },
      { name: 'Rejected', value: stages['rejected'] }
    ];
  }, [candidates]);

  // Key performance numbers
  const statisticsSummary = useMemo(() => {
    const totalHours = attendance
      .filter(a => a.date >= fromDate && a.date <= toDate && a.status === 'present')
      .reduce((sum, item) => sum + (item.hours_worked || 0), 0);

    const activeTrainees = candidates.filter(c => c.status === 'training_accepted').length;

    const leaveStatsCount = leaves.filter(l => l.startDate >= fromDate && l.startDate <= toDate).length;

    // Calculate dynamic attendance rate (present logs / total logs)
    const validLogs = attendance.filter(a => a.date >= fromDate && a.date <= toDate);
    const presentLogs = validLogs.filter(a => a.status === 'present').length;
    const rate = validLogs.length > 0 ? Math.round((presentLogs / validLogs.length) * 100) : 100;

    return {
      totalHours,
      activeTrainees,
      leaveStatsCount,
      rate
    };
  }, [attendance, candidates, leaves, fromDate, toDate]);

  return (
    <div className="space-y-6">
      
      {/* Upper Navigation Tabs and Period Selector */}
      <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveSubTab('insights')}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${activeSubTab === 'insights' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <div className="flex items-center gap-2">
              <TrendingUp size={14} />
              <span>Operational Analytics</span>
            </div>
          </button>
          <button
            onClick={() => setActiveSubTab('exports')}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${activeSubTab === 'exports' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <div className="flex items-center gap-2">
              <Download size={14} />
              <span>Spreadsheet Reports</span>
            </div>
          </button>
        </div>

        {/* Dynamic Calendar Period Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-1 max-w-xl">
          <div className="relative w-full sm:w-1/2">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400 uppercase tracking-widest pointer-events-none">From:</span>
            <input 
              type="date"
              required
              className="w-full pl-14 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          <div className="relative w-full sm:w-1/2">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400 uppercase tracking-widest pointer-events-none">To:</span>
            <input 
              type="date"
              required
              className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* METRIC PERSPECTIVE A: OPERATIONAL ANALYTICS AND CHARTS */}
      {activeSubTab === 'insights' && (
        <div className="space-y-6">
          
          {/* Dashboard Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            
            <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <span className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600">
                  <Users size={18} />
                </span>
                <span className="text-[10px] bg-indigo-50 px-2 py-0.5 text-indigo-700 rounded-full font-bold">Total Enlisted</span>
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Active Roster</p>
              <h3 className="text-2xl font-black text-slate-800">{staff.length}</h3>
              <p className="text-[10px] text-slate-400 mt-1">Authorized health practitioners</p>
            </div>

            <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <span className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600">
                  <Clock size={18} />
                </span>
                <span className="text-[10px] bg-emerald-50 px-2 py-0.5 text-emerald-700 rounded-full font-bold">Accumulated</span>
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Total Hours Logged</p>
              <h3 className="text-2xl font-black text-slate-800">{statisticsSummary.totalHours.toLocaleString()} hrs</h3>
              <p className="text-[10px] text-slate-400 mt-1">Worked hours during selected filter</p>
            </div>

            <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <span className="p-2.5 bg-amber-50 rounded-xl text-amber-600">
                  <CheckCircle size={18} />
                </span>
                <span className="text-[10px] bg-amber-50 px-2 py-0.5 text-amber-700 rounded-full font-bold">Daily Coverage</span>
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Attendance Rate</p>
              <h3 className="text-2xl font-black text-slate-800">{statisticsSummary.rate}%</h3>
              <p className="text-[10px] text-slate-400 mt-1">Of employees checked present</p>
            </div>

            <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <span className="p-2.5 bg-purple-50 rounded-xl text-purple-600">
                  <Briefcase size={18} />
                </span>
                <span className="text-[10px] bg-purple-50 px-2 py-0.5 text-purple-700 rounded-full font-bold">In Program</span>
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Active Trainees</p>
              <h3 className="text-2xl font-black text-slate-800">{statisticsSummary.activeTrainees}</h3>
              <p className="text-[10px] text-slate-400 mt-1">Pending milestone graduations</p>
            </div>

          </div>

          {/* Interactive Recharts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Chart Block 1: Daily Logged Hours Trend */}
            <div className="bg-white p-6 rounded-[32px] border border-slate-200 lg:col-span-2 shadow-sm space-y-4">
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Attendance Trend (Daily Logged Hours)</h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Historical graph of logged work volume across the active range.</p>
              </div>

              <div className="h-72 w-full">
                {dailyAttendanceTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyAttendanceTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25}/>
                          <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="#cbd5e1" />
                      <YAxis tick={{ fontSize: 9 }} stroke="#cbd5e1" label={{ value: 'Hours', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                      <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '12px', border: '1px solid #f1f5f9' }} />
                      <Area type="monotone" dataKey="hours" name="Hours Worked" stroke="#4f46e5" strokeWidth={2} fillOpacity={1} fill="url(#colorHours)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                    No timeline data to draw trend
                  </div>
                )}
              </div>
            </div>

            {/* Chart Block 2: Workforce Designation Mix */}
            <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Practitioners Designation Mix</h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Breakdown of the pharmacy's human resource roles.</p>
              </div>

              <div className="h-56 relative flex items-center justify-center">
                {staffRoleData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={staffRoleData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={75}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {staffRoleData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-slate-400 text-xs">No personnel registered</div>
                )}
              </div>

              {/* Legends list */}
              <div className="max-h-24 overflow-y-auto space-y-1.5 custom-scrollbar bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                {staffRoleData.slice(0, 4).map((item, index) => (
                  <div key={item.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                      <span className="font-semibold text-slate-700 truncate">{item.name}</span>
                    </div>
                    <span className="font-black text-slate-500 shrink-0">{item.value} count</span>
                  </div>
                ))}
              </div>
            </div>

          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Chart Block 3: Recruitment Pipeline Status */}
            <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm space-y-4">
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Recruitment Funnel Pipelines</h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Candidate tallies active across hiring stages.</p>
              </div>

              <div className="h-64 w-full">
                {candidates.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={recruitmentFunnel} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="#cbd5e1" />
                      <YAxis tick={{ fontSize: 9 }} stroke="#cbd5e1" allowDecimals={false} />
                      <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '12px' }} />
                      <Bar dataKey="value" name="Candidates count" fill="#8b5cf6" radius={[6, 6, 0, 0]}>
                        {recruitmentFunnel.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                    Pipeline is empty
                  </div>
                )}
              </div>
            </div>

            {/* Practical Dossier: Recent Leaves and Pending Actions */}
            <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Leaves Registry Tracker</h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Roster of leave exemptions affecting current operational availability.</p>
              </div>

              <div className="space-y-3 flex-1 overflow-y-auto max-h-64 custom-scrollbar pr-1 mt-2">
                {leaves.slice(0, 5).map((l, index) => {
                  const sMatch = staff.find(s => s.id === l.staffId || s.id === l.staff_id);
                  const statusColor = l.status === 'Approved' || l.hr_approval_status === 'Approved' 
                    ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
                    : l.status === 'Rejected' ? 'text-red-700 bg-red-50 border-red-100' : 'text-amber-700 bg-amber-50 border-amber-100';

                  return (
                    <div key={l.id || index} className="p-3 bg-slate-50 hover:bg-slate-100/60 rounded-xl border border-slate-100 transition-colors flex items-center justify-between text-xs gap-4">
                      <div>
                        <p className="font-bold text-slate-800">{l.staff_name || sMatch?.full_name || 'Staff'}</p>
                        <p className="text-[10px] font-medium text-slate-400 mt-0.5">{l.leave_type || 'Annual'} • {l.startDate || '—'} to {l.endDate || '—'}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border shrink-0 ${statusColor}`}>
                        {l.status || 'Pending'}
                      </span>
                    </div>
                  );
                })}

                {leaves.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 p-8">
                    <CalendarDays className="text-slate-300 w-10 h-10 mb-2" />
                    <p className="text-xs">No active leave petitions found in registry</p>
                  </div>
                )}
              </div>

              <button
                onClick={() => setActiveSubTab('exports')}
                className="w-full mt-4 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-150 text-slate-600 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
              >
                Inspect All Data Logs
              </button>
            </div>

          </div>

        </div>
      )}

      {/* METRIC PERSPECTIVE B: THE EXISTING DETAILED CSV DOWNLOAD CARDS */}
      {activeSubTab === 'exports' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-200">
          
          {/* Card 1: Hours Worked Report */}
          <div className="bg-white rounded-[32px] border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-6 relative overflow-hidden group">
            <div className="space-y-4">
              <div className="h-10 w-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
                <Clock size={20} />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Attendance & Logged Hours</h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Details employee work hours logged over the active date period.</p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase">{statisticsSummary.totalHours.toLocaleString()} Work Hours</span>
              <button 
                onClick={exportHoursWorkedReport}
                className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-900 hover:text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <Download size={14} /> Download CSV
              </button>
            </div>
          </div>

          {/* Card 2: Leaves Taken Registry */}
          <div className="bg-white rounded-[32px] border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-6 relative overflow-hidden group">
            <div className="space-y-4">
              <div className="h-10 w-10 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
                <CalendarDays size={20} />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Leaves and Exemptions Registry</h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Log book of all leaves taken, request justifications, and status.</p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase">{statisticsSummary.leaveStatsCount} Period Filings</span>
              <button 
                onClick={exportLeavesReport}
                className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-900 hover:text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <Download size={14} /> Download CSV
              </button>
            </div>
          </div>

          {/* Card 3: Active Staff Roster */}
          <div className="bg-white rounded-[32px] border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-6 relative overflow-hidden group">
            <div className="space-y-4">
              <div className="h-10 w-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
                <Users size={20} />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Active Workforce & Wages Roster</h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Full profile register of active employees, emails, phones, and wage scales.</p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase">{staff.length} Active Employees</span>
              <button 
                onClick={exportStaffRosterReport}
                className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-900 hover:text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <Download size={14} /> Download CSV
              </button>
            </div>
          </div>

          {/* Card 4: Recruitment performance report */}
          <div className="bg-white rounded-[32px] border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-6 relative overflow-hidden group">
            <div className="space-y-4">
              <div className="h-10 w-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
                <Briefcase size={20} />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Recruitment Performance Matrix</h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">History of candidates, exams, oral ratings and practical completions.</p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase">{candidates.length} Logged Candidates</span>
              <button 
                onClick={exportRecruitmentReport}
                className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-900 hover:text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <Download size={14} /> Download CSV
              </button>
            </div>
          </div>

          {/* Card 5: Trainee Performance report */}
          <div className="bg-white rounded-[32px] border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-6 relative overflow-hidden group">
            <div className="space-y-4">
              <div className="h-10 w-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
                <Activity size={20} />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Trainees Performance & Appraisals</h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Grades history after week 4, 8 and 12 with final graduation metrics.</p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase">{candidates.filter(c => c.status === 'training_accepted').length} Active Trainees</span>
              <button 
                onClick={exportTraineesReport}
                className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-900 hover:text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <Download size={14} /> Download CSV
              </button>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};
