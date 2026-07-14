import React, { useState, useEffect } from 'react';
import { 
  Calendar, Clock, CheckCircle2, XCircle, Search, 
  Filter, UserCheck, UserX, AlertCircle, MapPin,
  ChevronLeft, ChevronRight, Download, Users, Plus, Save, Trash2, Edit2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { Staff, AttendanceRecord } from '../../types';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';

export const AttendanceTracker: React.FC = () => {
  const { profile } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Bulking states
  const [isBulkLogging, setIsBulkLogging] = useState(false);
  const [bulkData, setBulkData] = useState<{
    [staffId: string]: {
      selected: boolean;
      status: 'present' | 'absent' | 'on-leave';
      checkIn: string;
      checkOut: string;
    }
  }>({});

  // Inline editing row state
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingFields, setEditingFields] = useState<{
    status: string;
    checkIn: string;
    checkOut: string;
  } | null>(null);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Staff>('staff', profile.tenantId, setStaff);
      
      // Subscribe to all attendance records to filter client side by selected date
      return firestoreService.subscribeToCollection<AttendanceRecord>(
        'attendance',
        profile.tenantId,
        (data) => {
          setAttendance(data);
        }
      );
    }
  }, [profile?.tenantId]);

  // Handle building bulk dictionary when bulk logging opens or staff status list loads
  useEffect(() => {
    const initial: typeof bulkData = {};
    staff.forEach(s => {
      initial[s.id] = {
        selected: s.status === 'active', // default is active staff selected
        status: 'present',
        checkIn: '08:00',
        checkOut: '17:00'
      };
    });
    setBulkData(initial);
  }, [staff, isBulkLogging]);

  const calculateHours = (inTime: string, outTime: string): number => {
    if (!inTime || !outTime) return 0;
    const [inH, inM] = inTime.split(':').map(Number);
    const [outH, outM] = outTime.split(':').map(Number);
    if (isNaN(inH) || isNaN(outH)) return 0;
    const inMinutes = inH * 60 + (inM || 0);
    const outMinutes = outH * 60 + (outM || 0);
    if (outMinutes <= inMinutes) return 0;
    return parseFloat(((outMinutes - inMinutes) / 60).toFixed(2));
  };

  const filteredAttendance = attendance.filter(a => a.date === selectedDate);

  const stats = {
    total: staff.length,
    present: filteredAttendance.filter(a => a.status === 'present').length,
    absent: filteredAttendance.filter(a => a.status === 'absent').length,
    onLeave: filteredAttendance.filter(a => a.status === 'on-leave').length,
    totalHours: filteredAttendance.reduce((sum, current) => sum + (current.hours_worked || 0), 0)
  };

  const startBulkLogMode = () => {
    setIsBulkLogging(true);
  };

  const handleSaveBulkAttendance = async () => {
    if (!profile?.tenantId) return;

    const selections = Object.keys(bulkData)
      .map(id => ({ id, details: bulkData[id] }))
      .filter(item => item.details.selected);

    if (selections.length === 0) {
      toast.error('Please select at least one staff member to log.');
      return;
    }

    try {
      let count = 0;
      for (const item of selections) {
        const staffMember = staff.find(s => s.id === item.id);
        if (!staffMember) continue;

        const hours = item.details.status === 'present' ? calculateHours(item.details.checkIn, item.details.checkOut) : 0;

        await firestoreService.addDocument('attendance', {
          tenantId: profile.tenantId,
          staffId: item.id,
          staff_name: staffMember.full_name,
          date: selectedDate,
          status: item.details.status,
          check_in_time: item.details.status === 'present' ? item.details.checkIn : null,
          check_out_time: item.details.status === 'present' ? item.details.checkOut : null,
          hours_worked: hours,
          branch_id: staffMember.branch_id || ''
        });
        count++;
      }
      toast.success(`Successfully logged attendance for ${count} staff member(s) on ${selectedDate}`);
      setIsBulkLogging(false);
    } catch (err) {
      toast.error('Failed to log attendance records');
    }
  };

  const handleStartEditRow = (record: AttendanceRecord) => {
    setEditingRowId(record.id);
    setEditingFields({
      status: record.status,
      checkIn: record.check_in_time || '08:00',
      checkOut: record.check_out_time || '17:00'
    });
  };

  const handleSaveRow = async (recordId: string) => {
    if (!editingFields) return;
    try {
      const hours = editingFields.status === 'present' ? calculateHours(editingFields.checkIn, editingFields.checkOut) : 0;
      await firestoreService.updateDocument('attendance', recordId, {
        status: editingFields.status,
        check_in_time: editingFields.status === 'present' ? editingFields.checkIn : null,
        check_out_time: editingFields.status === 'present' ? editingFields.checkOut : null,
        hours_worked: hours
      });
      toast.success('Attendance record updated');
      setEditingRowId(null);
      setEditingFields(null);
    } catch (error) {
      toast.error('Failed to update attendance record');
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (window.confirm('Are you sure you want to remove this attendance record?')) {
      try {
        await firestoreService.deleteDocument('attendance', recordId);
        toast.success('Attendance record removed');
      } catch (error) {
        toast.error('Failed to delete attendance record');
      }
    }
  };

  const handleExportCSV = () => {
    if (filteredAttendance.length === 0) {
      toast.error('No logs available for this date');
      return;
    }
    const headers = ['Date', 'Employee ID', 'Name', 'Role', 'Status', 'Check-In', 'Check-Out', 'Hours Worked'];
    const rows = filteredAttendance.map(a => {
      const s = staff.find(m => m.id === a.staffId);
      return [
        selectedDate,
        s?.employee_id || a.staffId,
        a.staff_name || s?.full_name || 'N/A',
        s?.role || 'N/A',
        a.status,
        a.check_in_time || '-',
        a.check_out_time || '-',
        a.hours_worked || '0'
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `attendance_report_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header and Date Navigation */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Enterprise Attendance Console</h2>
          <p className="text-xs text-slate-400 font-bold uppercase mt-1">Record physical logs, edit timetables, and analyze hours worked directly.</p>
        </div>

        <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
          <button 
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 1);
              setSelectedDate(d.toISOString().split('T')[0]);
              setIsBulkLogging(false);
              setEditingRowId(null);
            }}
            className="p-1.5 hover:bg-slate-50 text-slate-600 rounded-lg transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="flex flex-col items-center px-1">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Attendance Date</span>
            <input 
              type="date" 
              className="text-xs font-bold text-slate-900 bg-transparent border-none p-0 focus:ring-0 cursor-pointer outline-none"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setIsBulkLogging(false);
                setEditingRowId(null);
              }}
            />
          </div>
          <button 
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + 1);
              setSelectedDate(d.toISOString().split('T')[0]);
              setIsBulkLogging(false);
              setEditingRowId(null);
            }}
            className="p-1.5 hover:bg-slate-50 text-slate-600 rounded-lg transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Present Staff" value={stats.present} icon={UserCheck} color="text-emerald-600" bgColor="bg-emerald-50" />
        <StatCard label="Absent Staff" value={stats.absent} icon={UserX} color="text-rose-600" bgColor="bg-rose-50" />
        <StatCard label="On Leave" value={stats.onLeave} icon={Calendar} color="text-amber-600" bgColor="bg-amber-50" />
        <StatCard label="Total Hours" value={`${stats.totalHours} hrs`} icon={Clock} color="text-indigo-600" bgColor="bg-indigo-50" />
        <StatCard label="Daily Coverage" value={staff.length ? `${Math.round((filteredAttendance.length / staff.length) * 100)}%` : '0%'} icon={Users} color="text-slate-600" bgColor="bg-slate-50 md:col-span-1 col-span-2" />
      </div>

      {/* Action panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search logs/staff..." 
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-xs font-semibold"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          {filteredAttendance.length > 0 && (
            <button 
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 bg-white rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all uppercase tracking-widest"
            >
              <Download size={14} />
              Export CSV
            </button>
          )}

          {!isBulkLogging && filteredAttendance.length === 0 && (
            <button 
              onClick={startBulkLogMode}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-indigo-100"
            >
              <Plus size={14} />
              Bulk Log Attendance
            </button>
          )}
        </div>
      </div>

      {/* Main interface area */}
      {isBulkLogging ? (
        <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Bulk Creation Engine</p>
              <h3 className="text-base font-black text-slate-900 mt-1 uppercase tracking-tight">Record Attendance for {selectedDate}</h3>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setIsBulkLogging(false)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all uppercase tracking-widest"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveBulkAttendance}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all uppercase tracking-widest"
              >
                Save Recorded Logs
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 bg-slate-50/50">
                  <th className="px-6 py-4 w-12 text-center">
                    <input 
                      type="checkbox" 
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                      checked={Object.keys(bulkData).length > 0 && Object.keys(bulkData).every(k => bulkData[k].selected)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const copy = { ...bulkData };
                        Object.keys(copy).forEach(k => {
                          copy[k].selected = checked;
                        });
                        setBulkData(copy);
                      }}
                    />
                  </th>
                  <th className="px-6 py-4">Staff Member</th>
                  <th className="px-6 py-4">Desig. / Branch</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Time Clock In</th>
                  <th className="px-6 py-4">Time Clock Out</th>
                  <th className="px-6 py-4 text-center">Hours Worked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staff
                  .filter(s => s.full_name.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map((member) => {
                    const rowState = bulkData[member.id] || { selected: false, status: 'present', checkIn: '08:00', checkOut: '17:00' };
                    const hours = rowState.status === 'present' ? calculateHours(rowState.checkIn, rowState.checkOut) : 0;
                    return (
                      <tr key={member.id} className={cn("transition-colors", rowState.selected ? "bg-indigo-50/20" : "hover:bg-slate-50/50")}>
                        <td className="px-6 py-4 text-center">
                          <input 
                            type="checkbox" 
                            className="rounded text-indigo-600 focus:ring-indigo-500"
                            checked={rowState.selected}
                            onChange={(e) => {
                              setBulkData({
                                ...bulkData,
                                [member.id]: { ...rowState, selected: e.target.checked }
                              });
                            }}
                          />
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-950 text-sm">{member.full_name}</p>
                          <p className="text-[9px] text-slate-400 font-black tracking-widest uppercase mt-0.5">ID: {member.employee_id || member.id.slice(0, 8)}</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-xs font-bold text-slate-700">{member.role}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{member.branch_id}</p>
                        </td>
                        <td className="px-6 py-4">
                          <select 
                            className="text-xs font-bold px-3 py-1.5 bg-white border border-slate-200 rounded-xl outline-none"
                            value={rowState.status}
                            disabled={!rowState.selected}
                            onChange={(e) => {
                              setBulkData({
                                ...bulkData,
                                [member.id]: { ...rowState, status: e.target.value as any }
                              });
                            }}
                          >
                            <option value="present">Present</option>
                            <option value="absent">Absent</option>
                            <option value="on-leave">On-Leave</option>
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <input 
                            type="time" 
                            className="text-xs font-bold px-3 py-1 bg-white border border-slate-200 rounded-lg outline-none"
                            value={rowState.checkIn}
                            disabled={!rowState.selected || rowState.status !== 'present'}
                            onChange={(e) => {
                              setBulkData({
                                ...bulkData,
                                [member.id]: { ...rowState, checkIn: e.target.value }
                              });
                            }}
                          />
                        </td>
                        <td className="px-6 py-4">
                          <input 
                            type="time" 
                            className="text-xs font-bold px-3 py-1 bg-white border border-slate-200 rounded-lg outline-none"
                            value={rowState.checkOut}
                            disabled={!rowState.selected || rowState.status !== 'present'}
                            onChange={(e) => {
                              setBulkData({
                                ...bulkData,
                                [member.id]: { ...rowState, checkOut: e.target.value }
                              });
                            }}
                          />
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={cn(
                            "font-black text-xs px-2.5 py-1 rounded-full",
                            hours > 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "text-slate-300"
                          )}>
                            {hours} hrs
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-200">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 bg-slate-50/50">
                  <th className="px-6 py-4">Staff Member</th>
                  <th className="px-6 py-4">Designation / Branch</th>
                  <th className="px-6 py-4 text-center">Attendance Status</th>
                  <th className="px-6 py-4">Check-In</th>
                  <th className="px-6 py-4">Check-Out</th>
                  <th className="px-6 py-4 text-center">Hours Worked</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAttendance
                  .filter(a => {
                    const member = staff.find(s => s.id === a.staffId);
                    return (member?.full_name || a.staff_name || '').toLowerCase().includes(searchTerm.toLowerCase());
                  })
                  .map((record) => {
                    const member = staff.find(s => s.id === record.staffId);
                    const isEditing = editingRowId === record.id;
                    const hours = isEditing ? calculateHours(editingFields?.checkIn || '', editingFields?.checkOut || '') : (record.hours_worked || 0);

                    return (
                      <tr key={record.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                              <Users size={18} />
                            </div>
                            <div>
                              <p className="font-bold text-slate-900 text-sm">{record.staff_name || member?.full_name || 'Staff'}</p>
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">ID: {member?.employee_id || record.staffId.slice(0, 8)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-xs font-bold text-slate-700">{member?.role || 'Unspecified'}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{member?.branch_id || record.branch_id}</p>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {isEditing ? (
                            <select 
                              className="text-xs font-bold px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl outline-none"
                              value={editingFields?.status}
                              onChange={(e) => setEditingFields({ ...editingFields!, status: e.target.value })}
                            >
                              <option value="present">Present</option>
                              <option value="absent">Absent</option>
                              <option value="on-leave">On-Leave</option>
                            </select>
                          ) : (
                            <span className={cn(
                              "inline-flex px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border",
                              record.status === 'present' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                              record.status === 'absent' ? "bg-rose-50 text-rose-600 border-rose-100" :
                              "bg-amber-50 text-amber-600 border-amber-100"
                            )}>
                              {record.status}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {isEditing ? (
                            <input 
                              type="time" 
                              className="text-xs font-bold px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                              value={editingFields?.checkIn}
                              disabled={editingFields?.status !== 'present'}
                              onChange={(e) => setEditingFields({ ...editingFields!, checkIn: e.target.value })}
                            />
                          ) : (
                            <span className="text-xs font-semibold text-slate-600">
                              {record.check_in_time || '-'}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {isEditing ? (
                            <input 
                              type="time" 
                              className="text-xs font-bold px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                              value={editingFields?.checkOut}
                              disabled={editingFields?.status !== 'present'}
                              onChange={(e) => setEditingFields({ ...editingFields!, checkOut: e.target.value })}
                            />
                          ) : (
                            <span className="text-xs font-semibold text-slate-600">
                              {record.check_out_time || '-'}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={cn(
                            "font-black text-xs px-2.5 py-1 rounded-full",
                            hours > 0 ? "bg-indigo-50 text-indigo-700 border border-indigo-100" : "text-slate-300"
                          )}>
                            {hours} hrs
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isEditing ? (
                              <button 
                                onClick={() => handleSaveRow(record.id)}
                                className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors"
                                title="Save Record"
                              >
                                <Save size={16} />
                              </button>
                            ) : (
                              <button 
                                onClick={() => handleStartEditRow(record)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                                title="Edit Record"
                              >
                                <Edit2 size={16} />
                              </button>
                            )}
                            <button 
                              onClick={() => handleDeleteRecord(record.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Delete Record"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                {filteredAttendance.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center text-slate-400">
                      <Calendar className="mx-auto text-slate-300 mb-2" size={36} />
                      <p className="font-bold text-sm uppercase tracking-wider text-slate-400">No attendance records found for {selectedDate}</p>
                      <p className="text-[10px] text-slate-400 font-semibold uppercase mt-0.5">Please click "Bulk Log Attendance" to setup logs for this shift.</p>
                      <button 
                        onClick={startBulkLogMode}
                        className="mt-4 bg-indigo-600 text-white px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg shadow-indigo-100 inline-flex items-center gap-2"
                      >
                        <Plus size={14} />
                        Bulk Log Attendance
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number | string; icon: any; color: string; bgColor: string }> = ({ label, value, icon: Icon, color, bgColor }) => (
  <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm flex items-center gap-4">
    <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", bgColor, color)}>
      <Icon size={18} />
    </div>
    <div>
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{label}</p>
      <p className="text-lg font-black text-slate-900 leading-none">{value}</p>
    </div>
  </div>
);
