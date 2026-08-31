import React, { useState, useEffect, useMemo } from 'react';
import { 
  DollarSign, Briefcase, TrendingUp, BarChart3, AlertCircle, 
  HelpCircle, Archive, Car, Navigation, Calendar, Activity, Zap
} from 'lucide-react';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { startOfMonth, endOfMonth } from 'date-fns';

export const LogisticsDashboard: React.FC = () => {
  const { profile } = useAuth();
  const [deptLedger, setDeptLedger] = useState<any[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);

  useEffect(() => {
    if (!profile?.tenantId) return;

    const dlQuery = query(
      collection(db, 'departmental_petty_cash_ledger'),
      where('tenantId', '==', profile.tenantId),
      where('department', '==', 'Logistics')
    );
    const reqQuery = query(
      collection(db, 'petty_cash_requisitions'),
      where('tenantId', '==', profile.tenantId),
      where('department', '==', 'Logistics')
    );
    const tQuery = query(
      collection(db, 'trips'),
      where('tenantId', '==', profile.tenantId)
    );
    const vQuery = query(
      collection(db, 'vehicles'),
      where('tenantId', '==', profile.tenantId)
    );

    const unsubDL = onSnapshot(dlQuery, (snap) => {
      setDeptLedger(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const unsubReq = onSnapshot(reqQuery, (snap) => {
      setRequisitions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const unsubT = onSnapshot(tQuery, (snap) => {
      setTrips(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const unsubV = onSnapshot(vQuery, (snap) => {
      setVehicles(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubDL();
      unsubReq();
      unsubT();
      unsubV();
    };
  }, [profile?.tenantId]);

  // Calculations
  const metrics = useMemo(() => {
    const totalReceived = deptLedger.reduce((sum, entry) => sum + (entry.amount_received || 0), 0);
    const totalSpent = deptLedger.reduce((sum, entry) => sum + (entry.amount_spent || 0), 0);
    const availableBalance = totalReceived - totalSpent;

    const pendingRequests = requisitions.filter(r => r.status === 'Pending' || r.status === 'Under review');
    const totalPendingAmount = pendingRequests.reduce((sum, r) => sum + (r.amount || 0), 0);

    const approvedNotIssued = requisitions.filter(r => r.status === 'approved' || r.status === 'finance_approved');
    const totalApprovedNotIssuedAmount = approvedNotIssued.reduce((sum, r) => sum + (r.amount || 0), 0);

    const start = startOfMonth(new Date());
    const end = endOfMonth(new Date());

    const issuedThisMonth = deptLedger
      .filter(entry => entry.transaction_type === 'Finance issuance' && new Date(entry.created_at || entry.date) >= start && new Date(entry.created_at || entry.date) <= end)
      .reduce((sum, entry) => sum + (entry.amount_received || 0), 0);

    const expensesThisMonth = deptLedger
      .filter(entry => entry.amount_spent > 0 && new Date(entry.created_at || entry.date) >= start && new Date(entry.created_at || entry.date) <= end)
      .reduce((sum, entry) => sum + (entry.amount_spent || 0), 0);

    const fuelExpenditure = deptLedger
      .filter(entry => entry.transaction_type === 'Fuel expense')
      .reduce((sum, entry) => sum + (entry.amount_spent || 0), 0);

    const maintExpenditure = deptLedger
      .filter(entry => entry.transaction_type === 'Maintenance expense' || entry.transaction_type === 'Repair expense')
      .reduce((sum, entry) => sum + (entry.amount_spent || 0), 0);

    const totalTrips = trips.length;
    const costPerTrip = totalTrips > 0 ? totalSpent / totalTrips : 0;

    const totalVehicles = vehicles.length;
    const costPerVehicle = totalVehicles > 0 ? totalSpent / totalVehicles : 0;

    // Days until likely depletion: calculate burn rate of last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const expensesLast30Days = deptLedger
      .filter(entry => entry.amount_spent > 0 && new Date(entry.created_at || entry.date) >= thirtyDaysAgo)
      .reduce((sum, entry) => sum + (entry.amount_spent || 0), 0);
    const dailyBurnRate = expensesLast30Days / 30;
    const daysUntilDepletion = dailyBurnRate > 0 ? Math.ceil(availableBalance / dailyBurnRate) : 'N/A';

    return {
      availableBalance,
      pendingCount: pendingRequests.length,
      totalPendingAmount,
      totalApprovedNotIssuedAmount,
      issuedThisMonth,
      expensesThisMonth,
      fuelExpenditure,
      maintExpenditure,
      costPerTrip,
      costPerVehicle,
      daysUntilDepletion
    };
  }, [deptLedger, requisitions, trips, vehicles]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        
        {/* Available Balance */}
        <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-3xl relative overflow-hidden shadow-sm">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <DollarSign size={80} className="text-emerald-900" />
          </div>
          <span className="text-[10px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded uppercase tracking-widest mb-1 inline-block">Available Petty Cash</span>
          <h3 className="text-2xl font-black text-emerald-950 mt-2">UGX {metrics.availableBalance.toLocaleString()}</h3>
          <p className="text-[10px] text-emerald-700/80 mt-1 font-semibold">Confirmed Finance issuances less recorded expenditure</p>
        </div>

        {/* Pending Requests */}
        <div className="bg-amber-50 border border-amber-200 p-6 rounded-3xl relative overflow-hidden shadow-sm">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Briefcase size={80} className="text-amber-900" />
          </div>
          <span className="text-[10px] font-black text-amber-800 bg-amber-100 px-2 py-0.5 rounded uppercase tracking-widest mb-1 inline-block">Pending requests</span>
          <h3 className="text-2xl font-black text-amber-950 mt-2">{metrics.pendingCount} Requests</h3>
          <p className="text-[10px] text-amber-700/80 mt-1 font-semibold">UGX {metrics.totalPendingAmount.toLocaleString()}</p>
        </div>

        {/* Approved but not yet issued */}
        <div className="bg-blue-50 border border-blue-200 p-6 rounded-3xl relative overflow-hidden shadow-sm">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <TrendingUp size={80} className="text-blue-900" />
          </div>
          <span className="text-[10px] font-black text-blue-800 bg-blue-100 px-2 py-0.5 rounded uppercase tracking-widest mb-1 inline-block">Approved but not Issued</span>
          <h3 className="text-2xl font-black text-blue-950 mt-2">UGX {metrics.totalApprovedNotIssuedAmount.toLocaleString()}</h3>
          <p className="text-[10px] text-blue-700/80 mt-1 font-semibold">Awaiting Finance payout</p>
        </div>

        {/* Days to likely depletion */}
        <div className="bg-rose-50 border border-rose-200 p-6 rounded-3xl relative overflow-hidden shadow-sm">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <AlertCircle size={80} className="text-rose-900" />
          </div>
          <span className="text-[10px] font-black text-rose-800 bg-rose-100 px-2 py-0.5 rounded uppercase tracking-widest mb-1 inline-block">Days to depletion</span>
          <h3 className="text-2xl font-black text-rose-950 mt-2">{metrics.daysUntilDepletion} Days</h3>
          <p className="text-[10px] text-rose-700/80 mt-1 font-semibold">Based on 30-day burn rate</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Monthly Summary */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <h4 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4 text-indigo-600" />
            Monthly Cash Position
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
              <span className="text-xs font-semibold text-slate-600">Total Funds Issued (MTD)</span>
              <span className="text-xs font-bold text-slate-900">UGX {metrics.issuedThisMonth.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
              <span className="text-xs font-semibold text-slate-600">Total Expenses (MTD)</span>
              <span className="text-xs font-bold text-slate-900">UGX {metrics.expensesThisMonth.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Expenses by Category */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <h4 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-indigo-600" />
            Core Expense Categories
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
              <span className="text-xs font-semibold text-slate-600">Fuel Expenditure</span>
              <span className="text-xs font-bold text-slate-900">UGX {metrics.fuelExpenditure.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
              <span className="text-xs font-semibold text-slate-600">Maintenance & Repairs</span>
              <span className="text-xs font-bold text-slate-900">UGX {metrics.maintExpenditure.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Operational KPIs */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <h4 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-indigo-600" />
            Operational Cost KPIs
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
              <span className="text-xs font-semibold text-slate-600">Average Cost Per Trip</span>
              <span className="text-xs font-bold text-slate-900">UGX {Math.round(metrics.costPerTrip).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
              <span className="text-xs font-semibold text-slate-600">Average Cost Per Vehicle</span>
              <span className="text-xs font-bold text-slate-900">UGX {Math.round(metrics.costPerVehicle).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
