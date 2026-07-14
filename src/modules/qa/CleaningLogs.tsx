import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  Plus, 
  History, 
  Filter,
  Download,
  Search,
  Clock,
  ClipboardCheck,
  Camera,
  AlertCircle,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { CleaningTask, CleaningLogEntry } from '../../types';
import { toast } from 'sonner';
import { format, startOfDay, endOfDay } from 'date-fns';

export const CleaningLogs = () => {
  const { profile, activeBranch, tenantId } = useAuth();
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [logs, setLogs] = useState<CleaningLogEntry[]>([]);
  const [dateRange, setDateRange] = useState({
    start: format(new Date(), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });
  const [isLogging, setIsLogging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<CleaningTask | null>(null);

  const filteredLogs = logs.filter(log => {
    return (!dateRange.start || log.dateCompleted >= dateRange.start) &&
           (!dateRange.end || log.dateCompleted <= dateRange.end);
  });

  const handleExportCSV = () => {
    const headers = ['Date Completed', 'Time Completed', 'Task Name', 'Completed By', 'Photo Attached'];
    const rows: any[][] = [];
    const filename = `cleaning_logs_${dateRange.start}_to_${dateRange.end}.csv`;

    filteredLogs.forEach(log => {
      rows.push([
        log.dateCompleted,
        log.timeCompleted || '-',
        log.taskName || 'Unnamed Task',
        log.completedBy || 'N/A',
        log.photoUrl ? 'Yes' : 'No'
      ]);
    });

    if (rows.length === 0) {
      toast.error("No log data to export");
      return;
    }

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${(val ?? '').toString().replace(/"/g, '""')}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`${filename} exported successfully`);
  };

  useEffect(() => {
    if (!tenantId || !activeBranch) return;

    const unsubscribeTasks = firestoreService.subscribeToCollection<CleaningTask>(
      'cleaning_tasks',
      tenantId,
      (entries) => {
        const branchEntries = entries.filter(e => e.branchId === activeBranch.id);
        setTasks(branchEntries);
      }
    );

    const unsubscribeLogs = firestoreService.subscribeToCollection<CleaningLogEntry>(
      'cleaning_logs',
      tenantId,
      (entries) => {
        const branchEntries = entries.filter(e => e.branchId === activeBranch.id);
        setLogs(branchEntries.sort((a, b) => new Date(b.dateCompleted + 'T' + b.timeCompleted).getTime() - new Date(a.dateCompleted + 'T' + a.timeCompleted).getTime()));
      }
    );

    setLoading(false);

    return () => {
      unsubscribeTasks();
      unsubscribeLogs();
    };
  }, [tenantId, activeBranch]);

  const handleLogCompletion = async (task: CleaningTask) => {
    if (!tenantId || !activeBranch || !profile) return;

    try {
      const newLog: Omit<CleaningLogEntry, 'id'> = {
        tenantId,
        branchId: activeBranch.id,
        taskId: task.id,
        taskName: task.taskName,
        date: format(new Date(), 'yyyy-MM-dd'),
        dateCompleted: format(new Date(), 'yyyy-MM-dd'),
        timeCompleted: format(new Date(), 'HH:mm'),
        completedBy: profile?.full_name || profile?.displayName || 'Unknown',
        status: 'Completed'
      };

      await firestoreService.addDocument('cleaning_logs', newLog);
      toast.success(`${task.taskName} logged as completed`);
    } catch (error) {
      toast.error('Failed to log cleaning task');
    }
  };

  const getTaskStatus = (taskId: string) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const log = logs.find(l => l.taskId === taskId && l.dateCompleted === today);
    return log ? 'Completed' : 'Pending';
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isModalOpen) {
      const initial: Record<string, boolean> = {};
      tasks.forEach(t => {
        initial[t.id] = false;
      });
      setChecklist(initial);
    }
  }, [tasks, isModalOpen]);

  const handleAddLog = async () => {
    if (!tenantId || !activeBranch || !profile) return;

    try {
      const activeTasks = tasks.filter(t => checklist[t.id]);
      const activities = activeTasks.map(t => t.taskName);

      if (activities.length === 0) {
        toast.error('Please select at least one activity');
        return;
      }

      const newLog: Omit<CleaningLogEntry, 'id'> = {
        tenantId,
        branchId: activeBranch.id,
        taskId: 'general-cleaning',
        taskName: 'General Branch Cleaning',
        date: format(new Date(), 'yyyy-MM-dd'),
        dateCompleted: format(new Date(), 'yyyy-MM-dd'),
        timeCompleted: format(new Date(), 'HH:mm'),
        completedBy: profile?.full_name || profile?.displayName || 'Unknown',
        status: 'Completed',
        notes: `Activities: ${activities.join(', ')}`
      };

      await firestoreService.addDocument('cleaning_logs', newLog);
      toast.success('Cleaning log added successfully');
      setIsModalOpen(false);
      setChecklist({});
    } catch (error) {
      toast.error('Failed to add cleaning log');
    }
  };

  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [newActivityName, setNewActivityName] = useState('');
  const [newActivityFrequency, setNewActivityFrequency] = useState('Daily');
  const [newActivityRole, setNewActivityRole] = useState('Anyone');

  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !activeBranch) {
      toast.error('Unable to verify branch or tenant');
      return;
    }
    if (!newActivityName.trim()) {
      toast.error('Please enter an activity name');
      return;
    }

    try {
      const newActivity = {
        tenantId,
        branchId: activeBranch.id,
        taskName: newActivityName.trim(),
        name: newActivityName.trim(),
        frequency: newActivityFrequency,
        responsibleRole: newActivityRole,
      };

      await firestoreService.addDocument('cleaning_tasks', newActivity);
      toast.success(`Activity "${newActivityName.trim()}" added to checklist!`);
      setIsActivityModalOpen(false);
      setNewActivityName('');
      setNewActivityFrequency('Daily');
      setNewActivityRole('Anyone');
    } catch (error) {
      toast.error('Failed to add cleaning checklist activity');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-blue-600" />
          Branch Cleaning Checklist
        </h2>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsActivityModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium text-sm shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Cleaning Activity
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Cleaning Log
          </button>
          <button 
            onClick={handleExportCSV}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200"
            title="Export CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isActivityModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">Add Cleaning Activity</h3>
                <button onClick={() => setIsActivityModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              <form onSubmit={handleCreateActivity}>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Activity / Task Name
                    </label>
                    <input 
                      type="text"
                      className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g. Sterilize counter surfaces"
                      value={newActivityName}
                      onChange={(e) => setNewActivityName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                        Frequency
                      </label>
                      <select
                        className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={newActivityFrequency}
                        onChange={(e) => setNewActivityFrequency(e.target.value)}
                      >
                        <option value="Daily">Daily</option>
                        <option value="Weekly">Weekly</option>
                        <option value="Bi-weekly">Bi-weekly</option>
                        <option value="Monthly">Monthly</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                        Responsible Role
                      </label>
                      <select
                        className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={newActivityRole}
                        onChange={(e) => setNewActivityRole(e.target.value)}
                      >
                        <option value="Anyone">Anyone</option>
                        <option value="Cleaners">Cleaners</option>
                        <option value="Pharmacist">Pharmacist</option>
                        <option value="QA Officer">QA Officer</option>
                        <option value="Admin">Admin</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="p-6 bg-gray-50 flex gap-3 border-t border-gray-100">
                  <button 
                    type="button"
                    onClick={() => setIsActivityModalOpen(false)}
                    className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-white transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors text-sm shadow-md shadow-emerald-200"
                  >
                    Create Activity
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">Add Cleaning Log</h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                 <div className="space-y-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Cleaning Activities Checklist:</p>
                  
                  {tasks.map((task) => (
                    <label key={task.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                      <input 
                        type="checkbox" 
                        checked={!!checklist[task.id]}
                        onChange={(e) => setChecklist({...checklist, [task.id]: e.target.checked})}
                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{task.taskName}</span>
                    </label>
                  ))}
                  {tasks.length === 0 && (
                    <p className="text-sm text-gray-400 italic">No tasks specified for this branch yet. Use "Add Cleaning Activity" to populate tasks.</p>
                  )}
                </div>

                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="flex items-center gap-2 text-blue-700 text-xs font-bold uppercase tracking-wider mb-1">
                    <Clock className="w-3.5 h-3.5" />
                    Auto-Captured
                  </div>
                  <p className="text-sm text-blue-900 font-medium">
                    {format(new Date(), 'PPPP')} at {format(new Date(), 'p')}
                  </p>
                </div>
              </div>
              <div className="p-6 bg-gray-50 flex gap-3">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-white transition-colors text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAddLog}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors text-sm shadow-md shadow-blue-200"
                >
                  Submit Log
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tasks.map((task) => {
          const status = getTaskStatus(task.id);
          return (
            <div 
              key={task.id} 
              className={`p-4 rounded-xl border transition-all ${
                status === 'Completed' 
                  ? 'bg-green-50 border-green-200 shadow-sm' 
                  : 'bg-white border-gray-200 hover:border-blue-300 shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 bg-white rounded-lg border border-gray-100">
                  <ClipboardCheck className={`w-5 h-5 ${status === 'Completed' ? 'text-green-600' : 'text-blue-600'}`} />
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  status === 'Completed' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {status}
                </span>
              </div>
              <h4 className="font-bold text-gray-900">{task.taskName}</h4>
              <p className="text-xs text-gray-500 mt-1">Frequency: {task.frequency}</p>
              <p className="text-xs text-gray-500">Responsible: {task.responsibleRole}</p>
              
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                {status === 'Completed' ? (
                  <div className="flex items-center gap-1.5 text-green-600">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-xs font-medium">Done today</span>
                  </div>
                ) : (
                  <button
                    onClick={() => handleLogCompletion(task)}
                    className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-medium text-xs transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Mark as Completed
                  </button>
                )}
                <button className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
                  <Camera className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
        {tasks.length === 0 && (
          <div className="col-span-full p-12 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
            <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-500">No cleaning tasks configured for this branch.</p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <History className="w-4 h-4 text-gray-400" />
            Recent Completion Logs
          </h3>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[8px] font-black text-gray-400 uppercase tracking-widest pointer-events-none">From:</span>
              <input 
                type="date"
                className="pl-12 pr-2 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-800 outline-none focus:ring-1 focus:ring-blue-500"
                value={dateRange.start}
                onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
              />
            </div>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[8px] font-black text-gray-400 uppercase tracking-widest pointer-events-none">To:</span>
              <input 
                type="date"
                className="pl-8 pr-2 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-800 outline-none focus:ring-1 focus:ring-blue-500"
                value={dateRange.end}
                onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500 font-medium">
                <th className="px-6 py-3">Date / Time</th>
                <th className="px-6 py-3">Task Name</th>
                <th className="px-6 py-3">Completed By</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="text-sm hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="font-medium text-gray-900">{log.dateCompleted}</div>
                    <div className="text-xs text-gray-500">{log.timeCompleted}</div>
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900">{log.taskName}</td>
                  <td className="px-6 py-4 text-gray-600">{log.completedBy}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Completed
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {log.photoUrl ? (
                      <button className="text-blue-600 hover:underline text-xs">View Photo</button>
                    ) : (
                      <span className="text-gray-400 text-xs italic">No photo</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No cleaning logs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
