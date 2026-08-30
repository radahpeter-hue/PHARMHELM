import React, { useState, useEffect } from 'react';
import { 
  Plus, Search, Filter, Fuel, Settings, AlertTriangle, 
  Calendar, DollarSign, Car, User, FileText, Trash2, CheckCircle, XCircle,
  Briefcase, Send, ShieldAlert, Sparkles, Clock
} from 'lucide-react';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { FuelLog, MaintenanceLog, TrafficFineLog, Vehicle, Staff } from '../../types';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '../../utils/cn';
import { hasAnyRole, hasRoleContaining } from '../../utils/roles';

type CostType = 'fuel' | 'maintenance' | 'fines' | 'petty_cash' | 'general_expenses';

export const CostLedger: React.FC = () => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<CostType>('fuel');
  const [dateRange, setDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([]);
  const [fineLogs, setFineLogs] = useState<TrafficFineLog[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]); // Logistics Petty Cash
  const [generalExpenses, setGeneralExpenses] = useState<any[]>([]); // General Logistics Expenses
  const [deptLedger, setDeptLedger] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedFine, setSelectedFine] = useState<TrafficFineLog | null>(null);

  // Requisition Form states
  const [reqAmount, setReqAmount] = useState('');
  const [reqReason, setReqReason] = useState('');
  const [reqIsSubmitting, setReqIsSubmitting] = useState(false);

  const isFinance = hasRoleContaining(profile, 'Finance') || hasAnyRole(profile, ['owner', 'CEO', 'CEO / MD']);

  useEffect(() => {
    if (!profile?.tenantId) return;

    const vQuery = query(collection(db, 'vehicles'), where('tenantId', '==', profile.tenantId));
    const sQuery = query(collection(db, 'staff'), where('tenantId', '==', profile.tenantId));
    const fQuery = query(collection(db, 'fuel_logs'), where('tenantId', '==', profile.tenantId));
    const mQuery = query(collection(db, 'maintenance_logs'), where('tenantId', '==', profile.tenantId));
    const tQuery = query(collection(db, 'traffic_fine_logs'), where('tenantId', '==', profile.tenantId));
    const reqQuery = query(collection(db, 'petty_cash_requisitions'), where('tenantId', '==', profile.tenantId));
    const gQuery = query(collection(db, 'logistics_expenses'), where('tenantId', '==', profile.tenantId));
    const dlQuery = query(collection(db, 'departmental_petty_cash_ledger'), where('tenantId', '==', profile.tenantId), where('department', '==', 'Logistics'));

    const unsubscribeV = onSnapshot(vQuery, (snapshot) => {
      setVehicles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle)));
    });

    const unsubscribeS = onSnapshot(sQuery, (snapshot) => {
      setStaff(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Staff)));
    });

    const unsubscribeF = onSnapshot(fQuery, (snapshot) => {
      setFuelLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FuelLog)));
      setLoading(false);
    });

    const unsubscribeM = onSnapshot(mQuery, (snapshot) => {
      setMaintenanceLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaintenanceLog)));
    });

    const unsubscribeT = onSnapshot(tQuery, (snapshot) => {
      setFineLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TrafficFineLog)));
    });

    const unsubscribeReq = onSnapshot(reqQuery, (snapshot) => {
      const allReqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const logReqs = allReqs.filter((r: any) => r.department === 'Logistics' || r.purpose?.toLowerCase().includes('logistics') || r.purpose?.toLowerCase().includes('vehicle'));
      setRequisitions(logReqs.sort((a: any, b: any) => new Date(b.created_at || b.requisition_date).getTime() - new Date(a.created_at || a.requisition_date).getTime()));
    });

    const unsubscribeG = onSnapshot(gQuery, (snapshot) => {
      setGeneralExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeDL = onSnapshot(dlQuery, (snapshot) => {
      setDeptLedger(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubscribeV();
      unsubscribeS();
      unsubscribeF();
      unsubscribeM();
      unsubscribeT();
      unsubscribeReq();
      unsubscribeG();
      unsubscribeDL();
    };
  }, [profile?.tenantId]);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const vehicleId = formData.get('vehicleId') as string;
    
    // Determine proposed cost
    let costVal = 0;
    if (activeTab === 'fuel' || activeTab === 'maintenance' || activeTab === 'general_expenses') {
      costVal = parseInt(formData.get('cost_ugx') as string) || 0;
    } else if (activeTab === 'fines') {
      costVal = parseInt(formData.get('fine_amount_ugx') as string) || 0;
    }

    // Spending control validation
    if (logisticsAvailableBalance < costVal) {
      toast.error(`Insufficient Transport and Logistics petty cash balance. Submit an additional petty cash request or reduce the expense amount. Available: UGX ${logisticsAvailableBalance.toLocaleString()}`);
      return;
    }

    try {
      const expenseDate = formData.get('date') as string || new Date().toISOString().split('T')[0];

      if (activeTab === 'fuel') {
        const station = formData.get('station_name') as string;
        const data = {
          vehicleId,
          date: expenseDate,
          fuel_amount_litres: parseFloat(formData.get('fuel_amount_litres') as string),
          cost_ugx: costVal,
          mileage_at_refuel: parseInt(formData.get('mileage_at_refuel') as string),
          station_name: station,
          receipt_number: formData.get('receipt_number') as string,
          staff_id: profile?.uid,
          tenantId: profile?.tenantId,
        };
        const docRef = await addDoc(collection(db, 'fuel_logs'), data);
        
        // Auto deduct from petty cash ledger (global)
        await addDoc(collection(db, 'petty_cash_ledger'), {
          tenantId: profile?.tenantId,
          date: data.date,
          amount: costVal,
          source: `Logistics Cost: Fuel at ${station} (Vehicle ID: ${vehicleId})`,
          reference_number: `LOG-FL-${docRef.id.slice(-4)}`,
          type: 'outgoing',
          branch_id: 'HQ',
          logged_by: profile?.uid,
          created_at: new Date().toISOString()
        });

        // Log to departmental petty cash ledger
        await addDoc(collection(db, 'departmental_petty_cash_ledger'), {
          tenantId: profile?.tenantId,
          department: 'Logistics',
          date: data.date,
          transaction_type: 'Fuel expense',
          description: `Fuel purchase for vehicle ${vehicleId} at ${station}`,
          amount_received: 0,
          amount_spent: costVal,
          finance_request_ref: `LOG-FL-${docRef.id.slice(-4)}`,
          expense_category: 'Fuel',
          vehicle_ref: vehicleId,
          entered_by: profile?.uid,
          created_at: new Date().toISOString()
        });

        toast.success('Fuel log added and cost subtracted from petty cash!');
      } else if (activeTab === 'maintenance') {
        const provider = formData.get('service_provider') as string;
        const serviceType = formData.get('service_type') as string;
        const data = {
          vehicleId,
          date: expenseDate,
          service_type: serviceType,
          description: formData.get('description') as string,
          cost_ugx: costVal,
          mileage_at_service: parseInt(formData.get('mileage_at_service') as string),
          service_provider: provider,
          driver_id: formData.get('driver_id') as string,
          notes: formData.get('notes') as string,
          staff_id: profile?.uid,
          tenantId: profile?.tenantId,
        };
        const docRef = await addDoc(collection(db, 'maintenance_logs'), data);

        // Auto deduct from petty cash ledger
        await addDoc(collection(db, 'petty_cash_ledger'), {
          tenantId: profile?.tenantId,
          date: data.date,
          amount: costVal,
          source: `Logistics Cost: Maintenance - ${serviceType} at ${provider}`,
          reference_number: `LOG-MN-${docRef.id.slice(-4)}`,
          type: 'outgoing',
          branch_id: 'HQ',
          logged_by: profile?.uid,
          created_at: new Date().toISOString()
        });

        // Log to departmental petty cash ledger
        await addDoc(collection(db, 'departmental_petty_cash_ledger'), {
          tenantId: profile?.tenantId,
          department: 'Logistics',
          date: data.date,
          transaction_type: 'Maintenance expense',
          description: `${serviceType} service at ${provider} (Vehicle: ${vehicleId})`,
          amount_received: 0,
          amount_spent: costVal,
          finance_request_ref: `LOG-MN-${docRef.id.slice(-4)}`,
          expense_category: 'Maintenance',
          vehicle_ref: vehicleId,
          entered_by: profile?.uid,
          created_at: new Date().toISOString()
        });

        toast.success('Maintenance log added and cost subtracted from petty cash!');
      } else if (activeTab === 'fines') {
        const reason = formData.get('offence_description') as string;
        const data = {
          vehicleId,
          date: expenseDate,
          offence_description: reason,
          fine_amount_ugx: costVal,
          status: 'pending',
          driver_id: formData.get('driver_id') as string,
          notes: formData.get('notes') as string,
          tenantId: profile?.tenantId,
        };
        const docRef = await addDoc(collection(db, 'traffic_fine_logs'), data);

        // Auto deduct from petty cash ledger
        await addDoc(collection(db, 'petty_cash_ledger'), {
          tenantId: profile?.tenantId,
          date: data.date,
          amount: costVal,
          source: `Logistics Cost: Traffic Fine - ${reason}`,
          reference_number: `LOG-FN-${docRef.id.slice(-4)}`,
          type: 'outgoing',
          branch_id: 'HQ',
          logged_by: profile?.uid,
          created_at: new Date().toISOString()
        });

        // Log to departmental petty cash ledger
        await addDoc(collection(db, 'departmental_petty_cash_ledger'), {
          tenantId: profile?.tenantId,
          department: 'Logistics',
          date: data.date,
          transaction_type: 'Traffic or parking expense',
          description: `Traffic fine: ${reason} (Vehicle: ${vehicleId})`,
          amount_received: 0,
          amount_spent: costVal,
          finance_request_ref: `LOG-FN-${docRef.id.slice(-4)}`,
          expense_category: 'Traffic or parking expense',
          vehicle_ref: vehicleId,
          entered_by: profile?.uid,
          created_at: new Date().toISOString()
        });

        toast.success('Traffic fine logged and cost subtracted from petty cash!');
      } else if (activeTab === 'general_expenses') {
        const category = formData.get('category') as string;
        const notes = formData.get('notes') as string;
        const data = {
          date: expenseDate,
          category,
          cost_ugx: costVal,
          notes,
          staff_id: profile?.uid,
          tenantId: profile?.tenantId,
          created_at: new Date().toISOString()
        };
        const docRef = await addDoc(collection(db, 'logistics_expenses'), data);

        // Auto deduct from petty cash ledger
        await addDoc(collection(db, 'petty_cash_ledger'), {
          tenantId: profile?.tenantId,
          date: data.date,
          amount: costVal,
          source: `Logistics Other Expense: ${category} - ${notes}`,
          reference_number: `LOG-EXP-${docRef.id.slice(-4)}`,
          type: 'outgoing',
          branch_id: 'HQ',
          logged_by: profile?.uid,
          created_at: new Date().toISOString()
        });

        // Log to departmental petty cash ledger
        await addDoc(collection(db, 'departmental_petty_cash_ledger'), {
          tenantId: profile?.tenantId,
          department: 'Logistics',
          date: data.date,
          transaction_type: 'Trip expense',
          description: `${category} - ${notes}`,
          amount_received: 0,
          amount_spent: costVal,
          finance_request_ref: `LOG-EXP-${docRef.id.slice(-4)}`,
          expense_category: category,
          vehicle_ref: vehicleId || '',
          entered_by: profile?.uid,
          created_at: new Date().toISOString()
        });

        toast.success('Other fleet expense logged and cost subtracted from petty cash!');
      }
      setIsModalOpen(false);
    } catch (error) {
      toast.error('Failed to save log');
    }
  };

  const handleRequestPettyCashSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqAmount || !reqReason) {
      toast.error('Please enter amount and reason');
      return;
    }
    setReqIsSubmitting(true);
    try {
      const reqPayload = {
        tenantId: profile?.tenantId,
        branch_id: 'HQ',
        branch_name: 'HQ / Corporate',
        department: 'Logistics',
        amount: parseFloat(reqAmount),
        amount_requested: parseFloat(reqAmount),
        purpose: `[Logistics-Fleet] ${reqReason}`,
        reason: `[Logistics-Fleet] ${reqReason}`,
        requisition_date: new Date().toISOString().split('T')[0],
        status: 'pending',
        requested_by_name: profile?.full_name || 'Fleet Manager',
        logged_by: profile?.uid,
        created_at: new Date().toISOString()
      };
      await addDoc(collection(db, 'petty_cash_requisitions'), reqPayload);
      toast.success('Disbursement requisition successfully transmitted to corporate!');
      setReqAmount('');
      setReqReason('');
    } catch (err) {
      toast.error('Submission failed.');
    } finally {
      setReqIsSubmitting(false);
    }
  };

  const handleMarkDeductible = async (fine: TrafficFineLog, isDeductible: boolean) => {
    try {
      await updateDoc(doc(db, 'traffic_fine_logs', fine.id), {
        is_deductible: isDeductible,
        status: isDeductible ? 'deductible' : 'pending'
      });
      toast.success(isDeductible ? 'Marked as deductible' : 'Marked as company cost');
      setSelectedFine(null);
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  const handleDelete = async (collectionName: string, id: string) => {
    if (!confirm('Are you sure?')) return;
    try {
      await deleteDoc(doc(db, collectionName, id));
      toast.success('Log deleted');
    } catch (error) {
      toast.error('Delete failed');
    }
  };

  // Filters by date
  const filteredFuelLogs = fuelLogs.filter(log => {
    const d = log.date.split('T')[0];
    return (!dateRange.start || d >= dateRange.start) && (!dateRange.end || d <= dateRange.end);
  });

  const filteredMaintenanceLogs = maintenanceLogs.filter(log => {
    const d = log.date.split('T')[0];
    return (!dateRange.start || d >= dateRange.start) && (!dateRange.end || d <= dateRange.end);
  });

  const filteredFineLogs = fineLogs.filter(log => {
    const d = log.date.split('T')[0];
    return (!dateRange.start || d >= dateRange.start) && (!dateRange.end || d <= dateRange.end);
  });

  const filteredRequisitions = requisitions.filter(req => {
    const d = (req.requisition_date || '').split('T')[0];
    return (!dateRange.start || d >= dateRange.start) && (!dateRange.end || d <= dateRange.end);
  });

  const filteredGeneralExpenses = generalExpenses.filter(log => {
    const d = (log.date || '').split('T')[0];
    return (!dateRange.start || d >= dateRange.start) && (!dateRange.end || d <= dateRange.end);
  });

  // Calculate system-authoritative figures
  const totalFuelCost = filteredFuelLogs.reduce((sum, log) => sum + (log.cost_ugx || 0), 0);
  const totalMaintenanceCost = filteredMaintenanceLogs.reduce((sum, log) => sum + (log.cost_ugx || 0), 0);
  const totalFineCost = filteredFineLogs.reduce((sum, log) => sum + (log.fine_amount_ugx || 0), 0);
  const totalGeneralExpensesCost = filteredGeneralExpenses.reduce((sum, log) => sum + (log.cost_ugx || 0), 0);

  // Logistics Petty Cash calculations based on departmental_petty_cash_ledger (Starting Balance 100,000 UGX + inflows - outflows)
  const openingBalance = 100000;
  const totalReceived = deptLedger.reduce((sum, entry) => sum + (entry.amount_received || 0), 0);
  const totalSpent = deptLedger.reduce((sum, entry) => sum + (entry.amount_spent || 0), 0);
  const logisticsAvailableBalance = openingBalance + totalReceived - totalSpent;

  return (
    <div className="space-y-6">
      
      {/* Dynamic Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* WALLET BALANCE CARD */}
        <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-emerald-800">Fleet Wallet Balance</span>
          </div>
          <div className="text-2xl font-bold text-emerald-950">UGX {logisticsAvailableBalance.toLocaleString()}</div>
          <p className="text-[10px] text-emerald-700/80 mt-1 font-medium">Float + Approved Petty cash inflows</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Fuel className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-slate-500">Period Fuel Cost</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">UGX {(totalFuelCost || 0).toLocaleString()}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
              <Settings className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-slate-500">Total Maintenance</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">UGX {(totalMaintenanceCost || 0).toLocaleString()}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-slate-500">Pending Fines</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">UGX {(totalFineCost || 0).toLocaleString()}</div>
        </div>
      </div>

      {/* Date Auditor Selector bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h4 className="text-xs font-bold text-slate-800">Transport & Fleet Audit logs</h4>
          <p className="text-[9px] text-slate-400 font-mono uppercase">Ledger outputs strictly filtered by period (Defaults to Today's date)</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 max-w-xl">
          <div className="relative w-full sm:w-[220px] flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mr-2 pointer-events-none">From:</span>
            <input 
              type="date"
              className="w-full text-xs font-bold text-slate-800 outline-none bg-transparent"
              value={dateRange.start}
              onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
            />
          </div>

          <div className="relative w-full sm:w-[220px] flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mr-2 pointer-events-none">To:</span>
            <input 
              type="date"
              className="w-full text-xs font-bold text-slate-800 outline-none bg-transparent"
              value={dateRange.end}
              onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
            />
          </div>
        </div>
      </div>

      {/* TABS CONTAINER */}
      <div className="flex flex-col lg:flex-row gap-6">
        
        <div className="flex-1 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200">
            <div className="flex items-center gap-6 font-semibold">
              <button
                onClick={() => setActiveTab('fuel')}
                className={cn(
                  "pb-4 text-sm transition-colors relative",
                  activeTab === 'fuel' ? "text-indigo-600 font-bold" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Fuel Logs
                {activeTab === 'fuel' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />}
              </button>
              <button
                onClick={() => setActiveTab('maintenance')}
                className={cn(
                  "pb-4 text-sm transition-colors relative",
                  activeTab === 'maintenance' ? "text-indigo-600 font-bold" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Maintenance Logs
                {activeTab === 'maintenance' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />}
              </button>
              <button
                onClick={() => setActiveTab('fines')}
                className={cn(
                  "pb-4 text-sm transition-colors relative",
                  activeTab === 'fines' ? "text-indigo-600 font-bold" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Traffic Fines
                {activeTab === 'fines' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />}
              </button>
              <button
                onClick={() => setActiveTab('general_expenses')}
                className={cn(
                  "pb-4 text-sm transition-colors relative flex items-center gap-1.5",
                  activeTab === 'general_expenses' ? "text-indigo-600 font-bold" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Other Expenses
                {activeTab === 'general_expenses' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />}
              </button>
              <button
                onClick={() => setActiveTab('petty_cash')}
                className={cn(
                  "pb-4 text-sm transition-colors relative flex items-center gap-1.5",
                  activeTab === 'petty_cash' ? "text-emerald-600 font-bold" : "text-slate-500 hover:text-slate-700"
                )}
              >
                <Briefcase size={14} /> Petty Cash Requisitions
                {activeTab === 'petty_cash' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600 rounded-full" />}
              </button>
            </div>
            
            {activeTab !== 'petty_cash' && (
              <button
                onClick={() => setIsModalOpen(true)}
                className="mb-4 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm text-xs font-bold uppercase tracking-wider"
              >
                <Plus className="h-4 w-4" />
                <span>Add Log</span>
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-6 py-4 text-xs font-semibold text-slate-600 uppercase tracking-wider">Date / Reference</th>
                    <th className="px-6 py-4 text-xs font-semibold text-slate-600 uppercase tracking-wider">Source / Vehicle</th>
                    <th className="px-6 py-4 text-xs font-semibold text-slate-600 uppercase tracking-wider">Details & Auditing</th>
                    <th className="px-6 py-4 text-xs font-semibold text-slate-600 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-4 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  
                  {activeTab === 'fuel' && filteredFuelLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(log.date), 'MMM d, yyyy')}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Car className="h-4 w-4 text-slate-400" />
                          <span className="text-sm font-medium text-slate-900">
                            {vehicles.find(v => v.id === log.vehicleId)?.plate_number || 'Unknown'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-slate-600">{log.fuel_amount_litres}L at {log.station_name}</div>
                        <div className="text-xs text-slate-400">Mileage: {log.mileage_at_refuel} km</div>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900">UGX {(log.cost_ugx || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => handleDelete('fuel_logs', log.id)} className="p-2 text-slate-400 hover:text-rose-600 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {activeTab === 'maintenance' && filteredMaintenanceLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(log.date), 'MMM d, yyyy')}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Car className="h-4 w-4 text-slate-400" />
                          <span className="text-sm font-medium text-slate-900">
                            {vehicles.find(v => v.id === log.vehicleId)?.plate_number || 'Unknown'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-slate-600 font-medium">{log.service_type}</div>
                        <div className="text-xs text-slate-400 truncate max-w-[200px]">{log.description}</div>
                        {log.driver_id && (
                          <div className="text-xs text-indigo-600 font-bold mt-1 flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {staff.find(s => s.id === log.driver_id)?.full_name}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900">UGX {(log.cost_ugx || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => handleDelete('maintenance_logs', log.id)} className="p-2 text-slate-400 hover:text-rose-600 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {activeTab === 'fines' && filteredFineLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(log.date), 'MMM d, yyyy')}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Car className="h-4 w-4 text-slate-400" />
                          <span className="text-sm font-medium text-slate-900">
                            {vehicles.find(v => v.id === log.vehicleId)?.plate_number || 'Unknown'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-slate-600">{log.offence_description}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest",
                            log.status === 'paid' ? "bg-emerald-100 text-emerald-700" :
                            log.status === 'deductible' ? "bg-rose-100 text-rose-700" :
                            "bg-amber-100 text-amber-700"
                          )}>
                            {log.status}
                          </span>
                          {log.driver_id && (
                            <span className="text-xs text-slate-500 font-semibold flex items-center gap-1">
                               <User className="h-3 w-3" />
                               {staff.find(s => s.id === log.driver_id)?.full_name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900">UGX {(log.fine_amount_ugx || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isFinance && log.status === 'pending' && (
                            <button 
                              onClick={() => setSelectedFine(log)}
                              className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="Review Fine"
                            >
                              <FileText className="h-4 w-4" />
                            </button>
                          )}
                          <button onClick={() => handleDelete('traffic_fine_logs', log.id)} className="p-2 text-slate-400 hover:text-rose-600 transition-colors">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {activeTab === 'petty_cash' && filteredRequisitions.map(req => (
                    <tr key={req.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(req.created_at || req.requisition_date), 'MMM d, yyyy')}</td>
                      <td className="px-6 py-4 font-bold text-slate-900">Logistics Depot</td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-semibold text-slate-900">{req.purpose}</p>
                        <p className="text-[10px] text-slate-400">Owner: {req.requested_by_name || 'Fleet Admin'}</p>
                      </td>
                      <td className="px-6 py-4 text-sm font-black text-slate-900">UGX {(req.amount || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                          req.status === 'approved' || req.status === 'finance_approved' ? 'bg-emerald-100 text-emerald-800' :
                          req.status === 'rejected' || req.status === 'declined' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {req.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {activeTab === 'petty_cash' && filteredRequisitions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center p-8 text-slate-400 italic">No departmental petty cash requests match this date slot.</td>
                    </tr>
                  )}

                  {activeTab === 'general_expenses' && filteredGeneralExpenses.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4 text-sm text-slate-600">{log.date ? format(new Date(log.date), 'MMM d, yyyy') : 'N/A'}</td>
                      <td className="px-6 py-4 font-bold text-slate-900">{log.category}</td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-slate-600">{log.notes}</p>
                      </td>
                      <td className="px-6 py-4 text-sm font-black text-slate-900">UGX {(log.cost_ugx || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => handleDelete('logistics_expenses', log.id)} className="p-2 text-slate-400 hover:text-rose-600 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {activeTab === 'general_expenses' && filteredGeneralExpenses.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center p-8 text-slate-400 italic">No other logistics expenses logged yet.</td>
                    </tr>
                  )}

                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* SIDE DIALOG FOR PETTY CASH REQUEST */}
        {activeTab === 'petty_cash' && (
          <div className="w-full lg:w-[320px] bg-slate-50 border border-slate-200 rounded-xl p-5 h-fit space-y-4">
            <div>
              <span className="text-[9px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded uppercase tracking-wider">Depot Float</span>
              <h4 className="text-sm font-bold text-slate-900 uppercase tracking-tight mt-1">Request Depot Cash Inflow</h4>
              <p className="text-[11px] text-slate-500 mt-1">Request disbursements for fuel, tyre service, emergency mechanics, or fines payments.</p>
            </div>

            <form onSubmit={handleRequestPettyCashSubmit} className="space-y-4 text-xs font-semibold text-slate-700">
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-slate-500 font-bold">Inflow Amount (UGX)</label>
                <input 
                  type="number" required placeholder="e.g. 1200000"
                  value={reqAmount}
                  onChange={(e) => setReqAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none font-bold font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase text-slate-500 font-bold">Purpose Description</label>
                <textarea 
                  required placeholder="Replacing 2 tyres on Kampala-Gulu delivery lorry and paying pending toll road fees."
                  value={reqReason} rows={4}
                  onChange={(e) => setReqReason(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none resize-none text-[11px]"
                />
              </div>

              <button
                type="submit" disabled={reqIsSubmitting}
                className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white font-bold uppercase tracking-wider text-[10px] rounded-lg flex items-center justify-center gap-2"
              >
                <Send size={12} /> Submit Float Request
              </button>
            </form>
          </div>
        )}

      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900 capitalize">
                Add {activeTab} Log
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <Plus className="h-5 w-5 rotate-45" />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-4">
              {activeTab !== 'general_expenses' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Vehicle</label>
                  <select name="vehicleId" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                    <option value="">Select Vehicle</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id}>{v.plate_number} - {v.brand_model}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Date</label>
                <input name="date" type="date" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
              </div>

              {activeTab === 'fuel' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">Litres</label>
                      <input name="fuel_amount_litres" type="number" step="0.01" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">Cost (UGX)</label>
                      <input name="cost_ugx" type="number" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Mileage at Refuel</label>
                    <input name="mileage_at_refuel" type="number" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Station Name</label>
                    <input name="station_name" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                  </div>
                </>
              )}

              {activeTab === 'maintenance' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">Service Type</label>
                      <select name="service_type" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                        <option value="Routine">Routine</option>
                        <option value="Repair">Repair</option>
                        <option value="Inspection">Inspection</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">Cost (UGX)</label>
                      <input name="cost_ugx" type="number" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Driver (Optional)</label>
                    <select name="driver_id" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                      <option value="">Select Driver</option>
                      {staff.map(s => (
                        <option key={s.id} value={s.id}>{s.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Description</label>
                    <textarea name="description" rows={2} required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg resize-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Notes (Internal)</label>
                    <textarea name="notes" rows={2} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg resize-none" />
                  </div>
                </>
              )}

              {activeTab === 'fines' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">Fine Amount (UGX)</label>
                      <input name="fine_amount_ugx" type="number" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">Driver</label>
                      <select name="driver_id" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                        <option value="">Select Driver</option>
                        {staff.map(s => (
                          <option key={s.id} value={s.id}>{s.full_name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Offence Description</label>
                    <textarea name="offence_description" rows={2} required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg resize-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Notes (Internal)</label>
                    <textarea name="notes" rows={2} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg resize-none" />
                  </div>
                </>
              )}

              {activeTab === 'general_expenses' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">Category</label>
                      <select name="category" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                        <option value="Road Tolls">Road Tolls</option>
                        <option value="Washing & Cleaning">Washing & Cleaning</option>
                        <option value="Driver Allowance">Driver Allowance</option>
                        <option value="Parking Fees">Parking Fees</option>
                        <option value="Loading & Offloading">Loading & Offloading</option>
                        <option value="Tools & Emergency Equip">Tools & Emergency Equip</option>
                        <option value="Other Logistics Cost">Other Logistics Cost</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">Cost (UGX)</label>
                      <input name="cost_ugx" type="number" required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Explanation & Notes</label>
                    <textarea name="notes" rows={3} required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg resize-none" placeholder="Provide extra reasoning for this expense..." />
                  </div>
                </>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                <button type="submit" className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm">Save Log</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedFine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900 font-bold">Review Traffic Fine</h3>
              <button onClick={() => setSelectedFine(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <Plus className="h-5 w-5 rotate-45" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Driver:</span>
                  <span className="font-semibold text-slate-900">{staff.find(s => s.id === selectedFine.driver_id)?.full_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Amount:</span>
                  <span className="font-semibold text-slate-900">UGX {selectedFine.fine_amount_ugx.toLocaleString()}</span>
                </div>
                <div className="text-sm">
                  <span className="text-slate-500 block mb-1">Offence:</span>
                  <p className="text-slate-900 bg-white p-2 rounded border border-slate-200">{selectedFine.offence_description}</p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-700 text-center">Is this fine payable by the driver?</p>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => handleMarkDeductible(selectedFine, true)}
                    className="flex flex-col items-center gap-2 p-4 border border-rose-200 bg-rose-50 text-rose-700 rounded-xl hover:bg-rose-100 transition-colors"
                  >
                    <CheckCircle className="h-6 w-6" />
                    <span className="text-xs font-bold uppercase tracking-wider">Yes, Deduct</span>
                  </button>
                  <button 
                    onClick={() => handleMarkDeductible(selectedFine, false)}
                    className="flex flex-col items-center gap-2 p-4 border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-xl hover:bg-emerald-100 transition-colors"
                  >
                    <XCircle className="h-6 w-6" />
                    <span className="text-xs font-bold uppercase tracking-wider">No, Company</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
