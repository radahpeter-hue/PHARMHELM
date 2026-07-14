import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  AlertCircle, 
  ShieldAlert, 
  History, 
  Filter,
  Download,
  Search,
  ArrowRight,
  Package,
  Trash2,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { ExpiryLogEntry, QuarantineLogEntry } from '../../types';
import { toast } from 'sonner';
import { format, differenceInDays } from 'date-fns';

export const ExpiryLogs = () => {
  const { user, activeBranch, tenantId } = useAuth();
  const [expiryLogs, setExpiryLogs] = useState<ExpiryLogEntry[]>([]);
  const [quarantineLogs, setQuarantineLogs] = useState<QuarantineLogEntry[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'expiry' | 'quarantine'>('expiry');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState({
    start: format(new Date(), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });

  useEffect(() => {
    if (!tenantId || !activeBranch) return;

    const unsubscribeExpiry = firestoreService.subscribeToCollection<ExpiryLogEntry>(
      'expiry_logs',
      tenantId,
      (entries) => {
        const branchEntries = entries.filter(e => e.branchId === activeBranch.id);
        setExpiryLogs(branchEntries.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()));
      }
    );

    const unsubscribeQuarantine = firestoreService.subscribeToCollection<QuarantineLogEntry>(
      'quarantine_logs',
      tenantId,
      (entries) => {
        const branchEntries = entries.filter(e => e.branchId === activeBranch.id);
        setQuarantineLogs(branchEntries.sort((a, b) => new Date(b.dateQuarantined).getTime() - new Date(a.dateQuarantined).getTime()));
      }
    );

    setLoading(false);

    return () => {
      unsubscribeExpiry();
      unsubscribeQuarantine();
    };
  }, [tenantId, activeBranch]);

  const handleQuarantine = async (log: ExpiryLogEntry) => {
    if (!tenantId || !activeBranch || !user) return;

    try {
      const quarantineEntry: Omit<QuarantineLogEntry, 'id'> = {
        tenantId,
        branchId: activeBranch.id,
        quarantineId: `QR-${Date.now()}`,
        dateQuarantined: format(new Date(), 'yyyy-MM-dd'),
        productId: log.productId,
        productName: log.productName,
        batchNumber: log.batchNumber,
        quantity: log.sohUnits,
        reason: 'Expiry',
        quarantinedBy: user.fullName,
        currentLocation: 'Quarantine Area (Locked Cabinet)',
        status: 'Active (In Quarantine)'
      };

      await firestoreService.addDocument('quarantine_logs', quarantineEntry);
      await firestoreService.updateDocument('expiry_logs', log.id, { status: 'Quarantined' });
      toast.success(`${log.productName} moved to quarantine`);
    } catch (error) {
      toast.error('Failed to quarantine item');
    }
  };

  const filteredExpiry = expiryLogs.filter(log => {
    const matchesSearch = log.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.batchNumber.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDate = (!dateRange.start || log.expiryDate >= dateRange.start) &&
                        (!dateRange.end || log.expiryDate <= dateRange.end);
    return matchesSearch && matchesDate;
  });

  const filteredQuarantine = quarantineLogs.filter(log => {
    const matchesSearch = log.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.batchNumber.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDate = (!dateRange.start || log.dateQuarantined >= dateRange.start) &&
                        (!dateRange.end || log.dateQuarantined <= dateRange.end);
    return matchesSearch && matchesDate;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex p-1 bg-gray-100 rounded-lg w-fit">
          <button
            onClick={() => setActiveSubTab('expiry')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
              activeSubTab === 'expiry' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span className="text-sm font-medium">Expiry Watchlist</span>
          </button>
          <button
            onClick={() => setActiveSubTab('quarantine')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
              activeSubTab === 'quarantine' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span className="text-sm font-medium">Quarantine Area</span>
          </button>
        </div>

        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by product or batch..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-red-50 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Critical (0-30d)</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {expiryLogs.filter(l => l.riskBucket === 'Critical' && l.status === 'Active').length}
          </p>
          <p className="text-xs text-gray-500 mt-1">Immediate quarantine required</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-amber-50 rounded-lg">
              <AlertCircle className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">High Risk (31-60d)</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {expiryLogs.filter(l => l.riskBucket === 'High Risk' && l.status === 'Active').length}
          </p>
          <p className="text-xs text-gray-500 mt-1">Prioritize dispensing</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Package className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Quarantined</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {quarantineLogs.filter(l => l.status === 'Active (In Quarantine)').length}
          </p>
          <p className="text-xs text-gray-500 mt-1">Awaiting disposal/return</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-50 rounded-lg">
              <RefreshCw className="w-5 h-5 text-green-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Watchlist (61-90d)</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {expiryLogs.filter(l => l.riskBucket === 'Medium Risk' && l.status === 'Active').length}
          </p>
          <p className="text-xs text-gray-500 mt-1">Monitor closely</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <History className="w-4 h-4 text-gray-400" />
            {activeSubTab === 'expiry' ? 'Expiry Watchlist' : 'Quarantine Records'}
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
            <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200">
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500 font-medium">
                {activeSubTab === 'expiry' ? (
                  <>
                    <th className="px-6 py-3">Product / Batch</th>
                    <th className="px-6 py-3">Expiry Date</th>
                    <th className="px-6 py-3">Days Left</th>
                    <th className="px-6 py-3">SOH</th>
                    <th className="px-6 py-3">Est. Value</th>
                    <th className="px-6 py-3">Risk</th>
                    <th className="px-6 py-3">Action</th>
                  </>
                ) : (
                  <>
                    <th className="px-6 py-3">Date Quarantined</th>
                    <th className="px-6 py-3">Product / Batch</th>
                    <th className="px-6 py-3">Quantity</th>
                    <th className="px-6 py-3">Reason</th>
                    <th className="px-6 py-3">Location</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Quarantined By</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activeSubTab === 'expiry' ? (
                filteredExpiry.map((log) => (
                  <tr key={log.id} className="text-sm hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{log.productName}</div>
                      <div className="text-xs text-gray-500">Batch: {log.batchNumber}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{log.expiryDate}</td>
                    <td className="px-6 py-4">
                      <span className={`font-bold ${
                        log.remainingDays <= 30 ? 'text-red-600' :
                        log.remainingDays <= 60 ? 'text-amber-600' :
                        'text-blue-600'
                      }`}>
                        {log.remainingDays} days
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{log.sohUnits}</td>
                    <td className="px-6 py-4 text-gray-600">UGX {log.estimatedValue.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        log.riskBucket === 'Critical' ? 'bg-red-100 text-red-800' :
                        log.riskBucket === 'High Risk' ? 'bg-amber-100 text-amber-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {log.riskBucket}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {log.status === 'Active' ? (
                        <button
                          onClick={() => handleQuarantine(log)}
                          className="flex items-center gap-1 text-amber-600 hover:text-amber-700 font-medium transition-colors"
                        >
                          <ShieldAlert className="w-4 h-4" />
                          Quarantine
                        </button>
                      ) : (
                        <span className="text-gray-400 italic">{log.status}</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                filteredQuarantine.map((log) => (
                  <tr key={log.id} className="text-sm hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-gray-600">{log.dateQuarantined}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{log.productName}</div>
                      <div className="text-xs text-gray-500">Batch: {log.batchNumber}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-900 font-medium">{log.quantity}</td>
                    <td className="px-6 py-4 text-gray-600">{log.reason}</td>
                    <td className="px-6 py-4 text-gray-600">{log.currentLocation}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        log.status.includes('Active') ? 'bg-amber-100 text-amber-800' :
                        log.status.includes('Released') ? 'bg-green-100 text-green-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{log.quarantinedBy}</td>
                  </tr>
                ))
              )}
              {((activeSubTab === 'expiry' && filteredExpiry.length === 0) || (activeSubTab === 'quarantine' && filteredQuarantine.length === 0)) && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    No records found.
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
