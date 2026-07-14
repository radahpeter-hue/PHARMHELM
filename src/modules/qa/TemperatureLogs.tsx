import React, { useState, useEffect } from 'react';
import { 
  Thermometer, 
  Plus, 
  AlertTriangle, 
  CheckCircle2, 
  History, 
  Filter,
  Download,
  Snowflake,
  Home
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { RoomTempLogEntry, FridgeTempLogEntry } from '../../types';
import { toast } from 'sonner';
import { format, subDays, isWithinInterval, startOfDay, endOfDay } from 'date-fns';

export const TemperatureLogs = () => {
  const { profile, activeBranch, tenantId } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'room' | 'fridge'>('room');
  const [roomLogs, setRoomLogs] = useState<RoomTempLogEntry[]>([]);
  const [fridgeLogs, setFridgeLogs] = useState<FridgeTempLogEntry[]>([]);
  const [dateRange, setDateRange] = useState({
    start: format(new Date(), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });
  const [isLogging, setIsLogging] = useState(false);
  const [loading, setLoading] = useState(true);

  const filteredRoomLogs = roomLogs.filter(log => {
    return (!dateRange.start || log.date >= dateRange.start) &&
           (!dateRange.end || log.date <= dateRange.end);
  });

  const filteredFridgeLogs = fridgeLogs.filter(log => {
    return (!dateRange.start || log.date >= dateRange.start) &&
           (!dateRange.end || log.date <= dateRange.end);
  });

  const handleExportCSV = () => {
    let headers: string[] = [];
    let rows: any[][] = [];
    const filename = `temperature_${activeSubTab}_logs_${dateRange.start}_to_${dateRange.end}.csv`;

    if (activeSubTab === 'room') {
      headers = ['Date / Time', 'Location', 'Temperature (°C)', 'Humidity (%)', 'Status', 'Recorded By'];
      filteredRoomLogs.forEach(log => {
        const isOutOfRange = (log.temperature ?? 0) < 15 || (log.temperature ?? 0) > 25 || (log.humidity ?? 0) > 60;
        const status = isOutOfRange ? 'OUT OF RANGE' : 'Normal';
        rows.push([
          `${log.date} ${log.time}`,
          log.location || 'Main Store',
          log.temperature ?? '-',
          log.humidity ?? '-',
          status,
          log.recordedBy || 'N/A'
        ]);
      });
    } else {
      headers = ['Date / Time', 'Fridge ID', 'Temperature (°C)', 'Status', 'Recorded By'];
      filteredFridgeLogs.forEach(log => {
        const isOutOfRange = (log.temperature ?? 0) < 2 || (log.temperature ?? 0) > 8;
        const status = isOutOfRange ? 'OUT OF RANGE' : 'Normal';
        rows.push([
          `${log.date} ${log.readingPeriod}`,
          log.fridgeId || 'Fridge 1',
          log.temperature ?? '-',
          status,
          log.recordedBy || 'N/A'
        ]);
      });
    }

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

  // Form states
  const [temp, setTemp] = useState('');
  const [humidity, setHumidity] = useState('');
  const [location, setLocation] = useState('Main Store');
  const [fridgeId, setFridgeId] = useState('Fridge 1');
  const [readingPeriod, setReadingPeriod] = useState<'Morning' | 'Evening' | 'Spot Check'>('Morning');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!tenantId || !activeBranch) return;

    const unsubscribeRoom = firestoreService.subscribeToCollection<RoomTempLogEntry>(
      'room_temp_logs',
      tenantId,
      (logs) => {
        const branchLogs = logs.filter(l => l.branchId === activeBranch.id);
        setRoomLogs(branchLogs.sort((a, b) => new Date(b.date + 'T' + b.time).getTime() - new Date(a.date + 'T' + a.time).getTime()));
      }
    );

    const unsubscribeFridge = firestoreService.subscribeToCollection<FridgeTempLogEntry>(
      'fridge_temp_logs',
      tenantId,
      (logs) => {
        const branchLogs = logs.filter(l => l.branchId === activeBranch.id);
        setFridgeLogs(branchLogs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      }
    );

    setLoading(false);

    return () => {
      unsubscribeRoom();
      unsubscribeFridge();
    };
  }, [tenantId, activeBranch]);

  const handleLogTemperature = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !activeBranch || !profile) return;

    const temperature = parseFloat(temp);
    if (isNaN(temperature)) {
      toast.error('Please enter a valid temperature');
      return;
    }

    try {
      if (activeSubTab === 'room') {
        const isOutOfRange = temperature < 15 || temperature > 25;
        const newLog: Omit<RoomTempLogEntry, 'id'> = {
          tenantId,
          branchId: activeBranch.id,
          date: format(new Date(), 'yyyy-MM-dd'),
          time: format(new Date(), 'HH:mm'),
          location,
          temperature,
          humidity: humidity ? parseFloat(humidity) : undefined,
          recordedBy: profile.full_name || profile.displayName || 'Unknown',
          notes,
          isOutOfRange
        };
        await firestoreService.addDocument('room_temp_logs', newLog);
        if (isOutOfRange) toast.warning('Temperature is OUT OF RANGE (15-25°C)');
      } else {
        const isOutOfRange = temperature < 2 || temperature > 8;
        const newLog: Omit<FridgeTempLogEntry, 'id'> = {
          tenantId,
          branchId: activeBranch.id,
          date: format(new Date(), 'yyyy-MM-dd'),
          readingPeriod,
          fridgeId,
          temperature,
          humidity: humidity ? parseFloat(humidity) : undefined,
          recordedBy: profile.full_name || profile.displayName || 'Unknown',
          notes,
          isOutOfRange,
          excursionProtocolTriggered: isOutOfRange,
          affectedProductsConfirmed: false
        };
        await firestoreService.addDocument('fridge_temp_logs', newLog);
        if (isOutOfRange) toast.warning('Fridge temperature is OUT OF RANGE (2-8°C)');
      }

      toast.success('Temperature logged successfully');
      setIsLogging(false);
      setTemp('');
      setHumidity('');
      setNotes('');
    } catch (error) {
      toast.error('Failed to log temperature');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex p-1 bg-gray-100 rounded-lg w-fit">
          <button
            onClick={() => setActiveSubTab('room')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
              activeSubTab === 'room' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Home className="w-4 h-4" />
            <span className="text-sm font-medium">Room Temp</span>
          </button>
          <button
            onClick={() => setActiveSubTab('fridge')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
              activeSubTab === 'fridge' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Snowflake className="w-4 h-4" />
            <span className="text-sm font-medium">Fridge Temp</span>
          </button>
        </div>

        <button
          onClick={() => setIsLogging(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Log Reading</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Thermometer className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Target Range</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {activeSubTab === 'room' ? '15°C - 25°C' : '2°C - 8°C'}
          </p>
          <p className="text-xs text-gray-500 mt-1">Standard Operating Procedure</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-50 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Last Reading</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {activeSubTab === 'room' 
              ? (roomLogs[0]?.temperature ? `${roomLogs[0].temperature}°C` : 'N/A')
              : (fridgeLogs[0]?.temperature ? `${fridgeLogs[0].temperature}°C` : 'N/A')
            }
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {activeSubTab === 'room' 
              ? (roomLogs[0] ? `${roomLogs[0].date} ${roomLogs[0].time}` : 'No data')
              : (fridgeLogs[0] ? `${fridgeLogs[0].date} ${fridgeLogs[0].readingPeriod}` : 'No data')
            }
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-amber-50 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Excursions (7d)</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {activeSubTab === 'room'
              ? roomLogs.filter(l => l.isOutOfRange && new Date(l.date) > subDays(new Date(), 7)).length
              : fridgeLogs.filter(l => l.isOutOfRange && new Date(l.date) > subDays(new Date(), 7)).length
            }
          </p>
          <p className="text-xs text-gray-500 mt-1">Requires immediate action</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <History className="w-4 h-4 text-gray-400" />
            Historical Logs
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
            <button 
              onClick={handleExportCSV}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200"
              title="Export CSV"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500 font-medium">
                <th className="px-6 py-3">Date / Time</th>
                <th className="px-6 py-3">{activeSubTab === 'room' ? 'Location' : 'Fridge ID'}</th>
                <th className="px-6 py-3">Temp / Humidity</th>
                {activeSubTab === 'room' && <th className="px-6 py-3">Humidity</th>}
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Recorded By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activeSubTab === 'room' ? (
                filteredRoomLogs.map((log) => (
                  <tr key={log.id} className="text-sm hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{log.date}</div>
                      <div className="text-xs text-gray-500">{log.time}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{log.location}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${log.isOutOfRange ? 'text-red-600' : 'text-gray-900'}`}>
                          {log.temperature}°C
                        </span>
                        {log.humidity && (
                          <span className="text-xs text-gray-500">
                            ({log.humidity}%)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{log.humidity ? `${log.humidity}%` : '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        log.isOutOfRange 
                          ? 'bg-red-100 text-red-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {log.isOutOfRange ? 'Out of Range' : 'In Range'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{log.recordedBy}</td>
                  </tr>
                ))
              ) : (
                filteredFridgeLogs.map((log) => (
                  <tr key={log.id} className="text-sm hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{log.date}</div>
                      <div className="text-xs text-gray-500">{log.readingPeriod}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{log.fridgeId}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${log.isOutOfRange ? 'text-red-600' : 'text-gray-900'}`}>
                          {log.temperature}°C
                        </span>
                        {log.humidity && (
                          <span className="text-xs text-gray-500">
                            ({log.humidity}%)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        log.isOutOfRange 
                          ? 'bg-red-100 text-red-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {log.isOutOfRange ? 'Out of Range' : 'In Range'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{log.recordedBy}</td>
                  </tr>
                ))
              )}
              {((activeSubTab === 'room' && filteredRoomLogs.length === 0) || (activeSubTab === 'fridge' && filteredFridgeLogs.length === 0)) && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    No temperature readings recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isLogging && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <h3 className="text-xl font-bold text-gray-900">
                  Log {activeSubTab === 'room' ? 'Room' : 'Fridge'} Temperature
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Branch: {activeBranch?.name}
                </p>
              </div>

              <form onSubmit={handleLogTemperature} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Temperature (°C)</label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={temp}
                      onChange={(e) => setTemp(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      placeholder="e.g. 22.5"
                    />
                  </div>
                  {activeSubTab === 'room' ? (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-gray-700">Humidity (%)</label>
                      <input
                        type="number"
                        step="1"
                        value={humidity}
                        onChange={(e) => setHumidity(e.target.value)}
                        className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        placeholder="e.g. 45"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-gray-700">Humidity (%)</label>
                        <input
                          type="number"
                          step="1"
                          value={humidity}
                          onChange={(e) => setHumidity(e.target.value)}
                          className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                          placeholder="e.g. 45"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-gray-700">Period</label>
                        <select
                          value={readingPeriod}
                          onChange={(e) => setReadingPeriod(e.target.value as any)}
                          className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        >
                          <option value="Morning">Morning</option>
                          <option value="Evening">Evening</option>
                          <option value="Spot Check">Spot Check</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">
                    {activeSubTab === 'room' ? 'Location' : 'Fridge ID'}
                  </label>
                  <input
                    type="text"
                    required
                    value={activeSubTab === 'room' ? location : fridgeId}
                    onChange={(e) => activeSubTab === 'room' ? setLocation(e.target.value) : setFridgeId(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Notes (Optional)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all h-20 resize-none"
                    placeholder="Any observations..."
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsLogging(false)}
                    className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    Save Reading
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
