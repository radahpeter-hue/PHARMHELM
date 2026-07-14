import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  Package,
  Truck,
  FileText,
  ChevronRight,
  AlertTriangle,
  Users,
  Building2,
  DollarSign,
  ShoppingCart,
  MoreVertical,
  Edit2,
  Trash2,
  ExternalLink,
  Wallet,
  Receipt,
  TrendingUp,
  TrendingDown,
  CreditCard,
  Banknote,
  Smartphone,
  Eye,
  EyeOff,
  Briefcase,
  History,
  PieChart,
  BarChart3,
  Globe,
  XCircle,
  X,
  Sliders,
  ShieldAlert,
  Download
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { UpgradeRequiredCard } from '../components/UpgradeRequiredCard';
import { firestoreService } from '../services/firestore';
import { FinanceLedger, EODReconciliation, BranchExpense, CashRequisition, CreditReceivable, SupplierPayable, ManagementExpense, ProcurementInvoice, PettyCashRequisition, PettyCashLedger, PettyCashIssue, Branch, SystemSettings, Sale, GRNRecord } from '../types';
import { toast } from 'sonner';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { InvoiceLedger as NewInvoiceLedger } from './finance/management/InvoiceLedger';
import { CreditLedger as NewCreditLedger } from './finance/management/CreditLedger';
import { EodReconciliationBox as NewEodReconciliationBox } from './finance/management/EodReconciliationBox';
import { CashAndBanking as NewCashAndBanking } from './finance/management/CashAndBanking';
import { ManagementExpenseLedger } from './finance/management/ManagementExpenseLedger';
import { GlobalExpenseLedger } from './finance/management/GlobalExpenseLedger';
import { ProfitabilityLedger } from './finance/management/ProfitabilityLedger';
import { TaxEngine } from './finance/management/TaxEngine';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const Finance: React.FC = () => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'branch' | 'management'>('branch');
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.getCollection<SystemSettings>('system_settings', profile.tenantId).then(docs => {
        if (docs.length > 0) setSettings(docs[0]);
      });
    }
  }, [profile?.tenantId]);

  const userRoles = [profile?.role || 'staff', ...(profile?.secondaryRoles || [])];
  const isManagement = userRoles.some(r => ['owner', 'CEO', 'CEO / MD', 'Finance Head', 'admin'].includes(r));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Financial Operations</h1>
          <p className="text-zinc-500">Manage branch reconciliations, expenses, and management-level oversight.</p>
        </div>
        {isManagement && (
          <div className="flex bg-zinc-100 p-1 rounded-xl border border-zinc-200">
            <button 
              onClick={() => setActiveTab('branch')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                activeTab === 'branch' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              Branch Ops
            </button>
            <button 
              onClick={() => setActiveTab('management')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                activeTab === 'management' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              Management
            </button>
          </div>
        )}
      </div>

      <div className="mt-6">
        {activeTab === 'branch' ? <BranchFinance /> : <ManagementFinance settings={settings} />}
      </div>
    </div>
  );
};

const BranchFinance: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'eod' | 'expenses' | 'credit' | 'petty_cash'>('eod');

  const tabs = [
    { id: 'eod', label: 'EOD Reconciliation', icon: History },
    { id: 'expenses', label: 'Expense Log', icon: Receipt },
    { id: 'credit', label: 'Credit View', icon: CreditCard },
    { id: 'petty_cash', label: 'Petty Cash', icon: Wallet },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Revenue Today</p>
          <h3 className="text-2xl font-black text-zinc-900">UGX 2,450,000</h3>
          <div className="mt-2 flex items-center gap-1 text-emerald-500 text-xs font-bold">
            <TrendingUp size={14} />
            <span>+12% from yesterday</span>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Expenses Today</p>
          <h3 className="text-2xl font-black text-zinc-900">UGX 125,000</h3>
          <div className="mt-2 flex items-center gap-1 text-amber-500 text-xs font-bold">
            <TrendingDown size={14} />
            <span>3 entries logged</span>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Credit Raised</p>
          <h3 className="text-2xl font-black text-zinc-900">UGX 450,000</h3>
          <div className="mt-2 flex items-center gap-1 text-blue-500 text-xs font-bold">
            <CreditCard size={14} />
            <span>2 insurance invoices</span>
          </div>
        </div>
      </div>

      <div className="flex border-b border-zinc-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            className={cn(
              "flex items-center gap-2 px-6 py-3 text-sm font-medium transition-all border-b-2",
              activeSubTab === tab.id 
                ? "border-emerald-500 text-emerald-600" 
                : "border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300"
            )}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {activeSubTab === 'eod' && <EODReconciliationTab />}
        {activeSubTab === 'expenses' && <BranchExpenseLog />}
        {activeSubTab === 'credit' && <BranchCreditView />}
        {activeSubTab === 'petty_cash' && <BranchPettyCash />}
      </div>
    </div>
  );
};

const EODReconciliationTab: React.FC = () => {
  const { profile, activeBranchId } = useAuth();
  const isFinanceHead = profile?.role === 'Finance Head';
  const [revealed, setRevealed] = useState(false);
  const [sales, setSales] = useState<Sale[]>([]);
  const [formData, setFormData] = useState({
    cash: 0,
    mtn: 0,
    airtel: 0,
    card: 0,
    insurance: 0,
    institutional_credit: 0,
    staff_welfare: 0,
    date: new Date().toISOString().split('T')[0]
  });

  const [varianceReason, setVarianceReason] = useState('');

  // Subscribe to actual sales to fetch the dynamic EOD expectation
  useEffect(() => {
    if (profile?.tenantId) {
      const unsubSales = firestoreService.subscribeToCollection<Sale>('sales', profile.tenantId, (data) => {
        setSales(data);
      });
      return () => unsubSales();
    }
  }, [profile?.tenantId]);

  // Dynamically compute system expected values from actual POS data for this branch & date
  const { computedExpected, relevantSalesCount } = React.useMemo(() => {
    const targetDate = formData.date;
    const filtered = sales.filter(s => {
      const isCompleted = s.status === 'completed' || s.status === 'active';
      const isSameBranch = s.branchId === activeBranchId;
      if (!s.timestamp) return false;
      const saleDate = s.timestamp.split('T')[0];
      return isCompleted && isSameBranch && saleDate === targetDate;
    });

    let cash = 0;
    let momo = 0;
    let airtel = 0;
    let card = 0;
    let insurance = 0;
    let instCredit = 0;
    let staffWelfare = 0;

    filtered.forEach(s => {
      const totalAmount = s.totalAmount ?? s.total ?? 0;
      const isSplit = s.paymentMethod === 'staff_welfare' && s.secondaryPaymentMethod;
      
      if (isSplit) {
        const welfareVal = s.welfareAmount ?? 0;
        const secVal = s.secondaryAmount ?? (totalAmount - welfareVal);
        
        // Welfare component
        staffWelfare += welfareVal;
        
        // Secondary payment component
        const secMethod = s.secondaryPaymentMethod;
        if (secMethod === 'cash') cash += secVal;
        else if (secMethod === 'mtn_momo') momo += secVal;
        else if (secMethod === 'airtel_money') airtel += secVal;
        else if (secMethod === 'card') card += secVal;
        else if (secMethod === 'insurance') insurance += secVal;
        else if (secMethod === 'institutional_credit') instCredit += secVal;
      } else {
        // Simple direct payment
        const pMethod = s.paymentMethod;
        if (pMethod === 'cash') cash += totalAmount;
        else if (pMethod === 'mtn_momo') momo += totalAmount;
        else if (pMethod === 'airtel_money') airtel += totalAmount;
        else if (pMethod === 'card') card += totalAmount;
        else if (pMethod === 'insurance') insurance += totalAmount;
        else if (pMethod === 'institutional_credit') instCredit += totalAmount;
        else if (pMethod === 'staff_welfare') staffWelfare += totalAmount;
      }
    });

    return {
      computedExpected: {
        cash,
        momo,
        airtel,
        card,
        insurance,
        institutional_credit: instCredit,
        staff_welfare: staffWelfare,
        total: cash + momo + airtel + card + insurance + instCredit + staffWelfare
      },
      relevantSalesCount: filtered.length
    };
  }, [sales, formData.date, activeBranchId]);

  const handleSubmit = async () => {
    if (!profile) return;
    try {
      const cash_var = formData.cash - computedExpected.cash;
      const mtn_var = formData.mtn - computedExpected.momo;
      const airtel_var = formData.airtel - computedExpected.airtel;
      const card_var = formData.card - computedExpected.card;
      const insurance_var = formData.insurance - computedExpected.insurance;
      const inst_var = formData.institutional_credit - computedExpected.institutional_credit;
      const welfare_var = formData.staff_welfare - computedExpected.staff_welfare;

      const total_act = 
        formData.cash + 
        formData.mtn + 
        formData.airtel + 
        formData.card + 
        formData.insurance + 
        formData.institutional_credit + 
        formData.staff_welfare;

      const total_exp = computedExpected.total;
      const total_var = total_act - total_exp;

      if (total_var !== 0 && !varianceReason.trim()) {
        toast.warning("Please specify a reason for the discrepancy / variance to proceed.");
        return;
      }

      await firestoreService.addDocument('eod_reconciliations', {
        tenantId: profile.tenantId,
        branch_id: activeBranchId || 'main',
        reconciliation_date: formData.date,
        cashier_id: profile.uid,
        
        cash_expected: computedExpected.cash,
        cash_actual: formData.cash,
        cash_variance: cash_var,

        momo_expected: computedExpected.momo,
        momo_actual: formData.mtn,
        momo_variance: mtn_var,

        airtel_expected: computedExpected.airtel,
        airtel_actual: formData.airtel,
        airtel_variance: airtel_var,

        card_expected: computedExpected.card,
        card_actual: formData.card,
        card_variance: card_var,

        insurance_expected: computedExpected.insurance,
        insurance_actual: formData.insurance,
        insurance_variance: insurance_var,

        institutional_credit_expected: computedExpected.institutional_credit,
        institutional_credit_actual: formData.institutional_credit,
        institutional_credit_variance: inst_var,

        staff_welfare_expected: computedExpected.staff_welfare,
        staff_welfare_actual: formData.staff_welfare,
        staff_welfare_variance: welfare_var,

        total_expected: total_exp,
        total_actual: total_act,
        total_variance: total_var,

        variance_reason: varianceReason,
        status: 'Pending',
        logged_by: profile.uid,
        created_at: new Date().toISOString()
      });

      toast.success('EOD Reconciliation submitted successfully!');
      setRevealed(false);
      setFormData({
        cash: 0,
        mtn: 0,
        airtel: 0,
        card: 0,
        insurance: 0,
        institutional_credit: 0,
        staff_welfare: 0,
        date: new Date().toISOString().split('T')[0]
      });
      setVarianceReason('');
    } catch (error) {
      toast.error('Failed to submit reconciliation');
    }
  };

  const declaredTotals = 
    formData.cash + 
    formData.mtn + 
    formData.airtel + 
    formData.card + 
    formData.insurance + 
    formData.institutional_credit + 
    formData.staff_welfare;

  return (
    <div className="max-w-6xl mx-auto bg-white p-6 sm:p-8 rounded-3xl border border-zinc-200 shadow-xl animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-zinc-100">
        <div>
          <h2 className="text-2xl font-black text-zinc-900 tracking-tight">Daily EOD Reconciliation</h2>
          <p className="text-zinc-500 text-sm mt-1">Reconcile transaction tallies against physical and voucher counts for this branch.</p>
          <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-100">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
            {relevantSalesCount} Transaction{relevantSalesCount === 1 ? '' : 's'} recorded on this date
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Select Operations Date</p>
          <input 
            type="date"
            className="px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-sm text-zinc-800"
            value={formData.date}
            onChange={(e) => {
              setFormData({...formData, date: e.target.value});
              setRevealed(false); // require re-reveal on date change for dynamic recalculation
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left column: Inputs */}
        <div className="lg:col-span-7 space-y-6">
          <h3 className="font-bold text-zinc-950 uppercase tracking-wider text-xs border-b border-zinc-100 pb-2">Step 1: Input Physical & Voucher Totals</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-zinc-50/50 border border-zinc-100 rounded-2xl space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <Banknote size={14} className="text-emerald-500" /> Cash (Physical Cash Hand)
              </label>
              <input 
                type="number" 
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-md font-bold"
                placeholder="0"
                value={formData.cash || ''}
                onChange={(e) => setFormData({...formData, cash: parseInt(e.target.value) || 0})}
              />
            </div>

            <div className="p-4 bg-zinc-50/50 border border-zinc-100 rounded-2xl space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <Smartphone size={14} className="text-amber-500" /> MTN MoMo Tally
              </label>
              <input 
                type="number" 
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-md font-bold"
                placeholder="0"
                value={formData.mtn || ''}
                onChange={(e) => setFormData({...formData, mtn: parseInt(e.target.value) || 0})}
              />
            </div>

            <div className="p-4 bg-zinc-50/50 border border-zinc-100 rounded-2xl space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <Smartphone size={14} className="text-red-500" /> Airtel Money Tally
              </label>
              <input 
                type="number" 
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-md font-bold"
                placeholder="0"
                value={formData.airtel || ''}
                onChange={(e) => setFormData({...formData, airtel: parseInt(e.target.value) || 0})}
              />
            </div>

            <div className="p-4 bg-zinc-50/50 border border-zinc-100 rounded-2xl space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <CreditCard size={14} className="text-blue-500" /> Card / POS Terminal
              </label>
              <input 
                type="number" 
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-md font-bold"
                placeholder="0"
                value={formData.card || ''}
                onChange={(e) => setFormData({...formData, card: parseInt(e.target.value) || 0})}
              />
            </div>

            <div className="p-4 bg-zinc-50/50 border border-zinc-100 rounded-2xl space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-cyan-500" /> Insurance Orders
              </label>
              <input 
                type="number" 
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-md font-bold"
                placeholder="0"
                value={formData.insurance || ''}
                onChange={(e) => setFormData({...formData, insurance: parseInt(e.target.value) || 0})}
              />
            </div>

            <div className="p-4 bg-zinc-50/50 border border-zinc-100 rounded-2xl space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 size={14} className="text-indigo-500" /> Institutional Credit
              </label>
              <input 
                type="number" 
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-md font-bold"
                placeholder="0"
                value={formData.institutional_credit || ''}
                onChange={(e) => setFormData({...formData, institutional_credit: parseInt(e.target.value) || 0})}
              />
            </div>

            <div className="p-4 bg-zinc-50/50 border border-zinc-100 rounded-2xl space-y-1.5 sm:col-span-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <Users size={14} className="text-violet-500" /> Staff Welfare Deductions
              </label>
              <input 
                type="number" 
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-md font-bold"
                placeholder="0"
                value={formData.staff_welfare || ''}
                onChange={(e) => setFormData({...formData, staff_welfare: parseInt(e.target.value) || 0})}
              />
            </div>
          </div>

          <div className="p-4 bg-zinc-900 text-white rounded-3xl flex justify-between items-center">
            <div>
              <p className="text-[10px] text-zinc-400 font-extrabold uppercase tracking-widest">Aggregate Declared Cash & Credit</p>
              <p className="text-2xl font-black text-emerald-400">UGX {declaredTotals.toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* Right column: System Totals & Reconciliation */}
        <div className="lg:col-span-5 space-y-6">
          <h3 className="font-bold text-zinc-950 uppercase tracking-wider text-xs border-b border-zinc-100 pb-2">Step 2: System Audit Tally</h3>
          
          {revealed ? (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-3 max-h-[440px] overflow-y-auto pr-2 custom-scrollbar">
                <VarianceRow label="Cash" declared={formData.cash} expected={computedExpected.cash} />
                <VarianceRow label="MTN MoMo" declared={formData.mtn} expected={computedExpected.momo} />
                <VarianceRow label="Airtel Money" declared={formData.airtel} expected={computedExpected.airtel} />
                <VarianceRow label="Card / POS" declared={formData.card} expected={computedExpected.card} />
                <VarianceRow label="Insurance" declared={formData.insurance} expected={computedExpected.insurance} />
                <VarianceRow label="Inst. Credit" declared={formData.institutional_credit} expected={computedExpected.institutional_credit} />
                <VarianceRow label="Staff Welfare" declared={formData.staff_welfare} expected={computedExpected.staff_welfare} />
                <VarianceRow label="Grand Total" declared={declaredTotals} expected={computedExpected.total} />
              </div>

              <div className="pt-4 border-t border-zinc-100 space-y-4">
                {(declaredTotals - computedExpected.total) !== 0 && (
                  <div className="space-y-2 animate-pulse-subtle">
                    <label className="text-xs font-black text-red-600 uppercase flex items-center gap-1.5">
                      <AlertTriangle size={14} /> Variance Reason Required
                    </label>
                    <textarea 
                      required
                      className="w-full px-4 py-3 bg-red-50/30 border border-red-200 rounded-2xl focus:ring-2 focus:ring-red-500/20 outline-none text-sm min-h-[80px]"
                      placeholder="Please account for the discrepancy found..."
                      value={varianceReason}
                      onChange={(e) => setVarianceReason(e.target.value)}
                    ></textarea>
                  </div>
                )}
                
                <button 
                  onClick={handleSubmit}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-lg transition-all shadow-xl shadow-emerald-600/10"
                >
                  Submit EOD Audit Report
                </button>
              </div>
            </div>
          ) : (
            <div className="h-[400px] flex flex-col items-center justify-center text-center p-8 bg-zinc-50 rounded-3xl border border-dashed border-zinc-200">
              <EyeOff size={48} className="text-zinc-300 mb-4" />
              <p className="font-bold text-zinc-900 text-sm">Blind Count Protocol</p>
              <p className="text-zinc-500 text-xs max-w-xs mt-1 mb-6">Staff must verify physical and record tallies before matching against computer models.</p>
              <button 
                onClick={() => setRevealed(true)}
                className="bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all shadow-lg shadow-zinc-900/15"
              >
                Reveal System Totals
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const VarianceRow: React.FC<{ label: string, declared: number, expected: number }> = ({ label, declared, expected }) => {
  const variance = declared - expected;
  return (
    <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100 flex items-center justify-between">
      <div>
        <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">{label}</p>
        <p className="text-xs text-zinc-500 mt-0.5">Exp: UGX {(expected || 0).toLocaleString()}</p>
      </div>
      <div className="text-right">
        <p className={cn(
          "text-sm font-black",
          variance === 0 ? "text-emerald-600" : "text-red-500"
        )}>
          {variance > 0 ? '+' : ''}{(variance || 0).toLocaleString()}
        </p>
        <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Variance</p>
      </div>
    </div>
  );
};

const BranchExpenseLog: React.FC = () => {
  const { profile, activeBranchId } = useAuth();
  const isFinanceHead = profile?.role === 'Finance Head';
  const [expenses, setExpenses] = useState<BranchExpense[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingExpense, setEditingExpense] = useState<BranchExpense | null>(null);
  const [dateRange, setDateRange] = useState({ 
    start: new Date().toISOString().split('T')[0], 
    end: new Date().toISOString().split('T')[0] 
  });
  const [formData, setFormData] = useState({
    category: 'utilities',
    amount: 0,
    description: '',
    recipient: '',
    date: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    if (profile?.tenantId && activeBranchId) {
      firestoreService.subscribeToCollection<BranchExpense>('branch_expenses', profile.tenantId, (data) => {
        setExpenses(data.filter(e => e.branch_id === activeBranchId).sort((a, b) => new Date(b.expense_date).getTime() - new Date(a.expense_date).getTime()));
      });
    }
  }, [profile?.tenantId, activeBranchId]);

  const filteredExpenses = expenses.filter(e => {
    const eDate = e.expense_date.split('T')[0];
    const matchesStart = !dateRange.start || eDate >= dateRange.start;
    const matchesEnd = !dateRange.end || eDate <= dateRange.end;
    return matchesStart && matchesEnd;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId || !activeBranchId) return;

    try {
      if (editingExpense) {
        await firestoreService.updateDocument('branch_expenses', editingExpense.id, {
          expense_date: formData.date,
          category: formData.category,
          description: formData.description,
          amount_ugx: formData.amount,
        });
        toast.success('Expense updated');
      } else {
        await firestoreService.addDocument('branch_expenses', {
          tenantId: profile.tenantId,
          branch_id: activeBranchId,
          expense_date: formData.date,
          category: formData.category,
          description: formData.description,
          amount_ugx: formData.amount,
          payment_method: 'Petty Cash',
          logged_by: profile.uid,
          status: 'Pending',
          created_at: new Date().toISOString()
        });
        toast.success('Expense logged successfully');
      }
      setIsAdding(false);
      setEditingExpense(null);
      setFormData({ category: 'utilities', amount: 0, description: '', recipient: '', date: new Date().toISOString().split('T')[0] });
    } catch (error) {
      toast.error('Failed to save expense');
    }
  };

  const handleEdit = (exp: BranchExpense) => {
    if (!isFinanceHead) {
      toast.error('Only Finance Head can edit expenses');
      return;
    }
    setEditingExpense(exp);
    setFormData({
      category: exp.category,
      amount: exp.amount_ugx,
      description: exp.description,
      recipient: '',
      date: exp.expense_date
    });
    setIsAdding(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-zinc-900">Branch Operational Expenses</h3>
          <p className="text-xs text-zinc-500">Log of local expenses matching the current date by default.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-zinc-200 text-xs">
            <span className="font-bold text-zinc-400 px-1 uppercase tracking-widest">Date:</span>
            <input 
              type="date" 
              value={dateRange.start} 
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="px-2 py-1 bg-zinc-50 border border-zinc-100 rounded-lg outline-none font-bold text-zinc-700"
            />
            <span className="text-zinc-400">to</span>
            <input 
              type="date" 
              value={dateRange.end} 
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="px-2 py-1 bg-zinc-50 border border-zinc-100 rounded-lg outline-none font-bold text-zinc-700"
            />
          </div>
          <button 
            onClick={() => setIsAdding(true)}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium transition-colors flex items-center gap-2"
          >
            <Plus size={20} />
            Log Expense
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm animate-in fade-in slide-in-from-top-4">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Date</label>
              <input 
                type="date"
                required
                disabled={!isFinanceHead && !!editingExpense}
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50"
                value={formData.date}
                onChange={(e) => setFormData({...formData, date: e.target.value})}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Category</label>
              <select 
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20"
                value={formData.category}
                onChange={(e) => setFormData({...formData, category: e.target.value})}
              >
                <option value="utilities">Utilities</option>
                <option value="rent">Rent</option>
                <option value="salaries">Salaries</option>
                <option value="supplies">Supplies</option>
                <option value="maintenance">Maintenance</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Amount (UGX)</label>
              <input 
                type="number"
                required
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20"
                value={formData.amount || ''}
                onChange={(e) => setFormData({...formData, amount: parseInt(e.target.value) || 0})}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-bold text-zinc-500 uppercase">Description</label>
              <input 
                type="text"
                required
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20"
                placeholder="What was this for?"
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
              />
            </div>
            <div className="md:col-span-4 flex justify-end gap-3 mt-2">
              <button 
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-6 py-2 text-zinc-500 font-bold hover:text-zinc-700"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="px-8 py-2 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 transition-all"
              >
                Save Expense
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Category</th>
              <th className="px-6 py-4">Description</th>
              <th className="px-6 py-4">Amount</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {filteredExpenses.map((expense) => (
              <tr key={expense.id} className="hover:bg-zinc-50/50 transition-colors">
                <td className="px-6 py-4 text-sm text-zinc-600">
                  {new Date(expense.expense_date).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  <span className="px-2 py-1 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-bold uppercase tracking-wider">
                    {expense.category}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-zinc-600">{expense.description}</td>
                <td className="px-6 py-4 font-bold text-zinc-900">UGX {(expense.amount_ugx || 0).toLocaleString()}</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                    expense.status === 'approved' ? "bg-emerald-50 text-emerald-600" : 
                    expense.status === 'rejected' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                  )}>
                    {expense.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  {isFinanceHead && (
                    <button 
                      onClick={() => handleEdit(expense)}
                      className="p-2 text-zinc-400 hover:text-zinc-900 transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filteredExpenses.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">
                  No operational expenses found for the selected date range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const BranchCreditView: React.FC = () => {
  const { profile, activeBranchId } = useAuth();
  const [credits, setCredits] = useState<CreditReceivable[]>([]);
  const [dateRange, setDateRange] = useState({ 
    start: new Date().toISOString().split('T')[0], 
    end: new Date().toISOString().split('T')[0] 
  });

  useEffect(() => {
    if (profile?.tenantId && activeBranchId) {
      firestoreService.subscribeToCollection<CreditReceivable>('credit_receivables', profile.tenantId, (data) => {
        setCredits(data.filter(c => c.branch_id === activeBranchId));
      });
    }
  }, [profile?.tenantId, activeBranchId]);

  const filteredCredits = credits.filter(c => {
    // try payment date, due date or createdAt
    const rawDate = c.due_date || (c as any).createdAt || '';
    const cDate = rawDate.split('T')[0];
    const matchesStart = !dateRange.start || cDate >= dateRange.start;
    const matchesEnd = !dateRange.end || cDate <= dateRange.end;
    return matchesStart && matchesEnd;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-zinc-900">Branch Credit & Insurance Invoices</h3>
          <p className="text-xs text-zinc-500">List of credit transactions filtered for today by default.</p>
        </div>
        <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-zinc-200 text-xs">
          <span className="font-bold text-zinc-400 px-1 uppercase tracking-widest">Date:</span>
          <input 
            type="date" 
            value={dateRange.start} 
            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            className="px-2 py-1 bg-zinc-50 border border-zinc-100 rounded-lg outline-none font-bold text-zinc-700"
          />
          <span className="text-zinc-400">to</span>
          <input 
            type="date" 
            value={dateRange.end} 
            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            className="px-2 py-1 bg-zinc-50 border border-zinc-100 rounded-lg outline-none font-bold text-zinc-700"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
              <th className="px-6 py-4">Invoice #</th>
              <th className="px-6 py-4">Client / Institution</th>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Amount</th>
              <th className="px-6 py-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {filteredCredits.map((credit) => (
              <tr key={credit.id} className="hover:bg-zinc-50/50 transition-colors">
                <td className="px-6 py-4 font-bold text-zinc-900">{credit.invoice_number}</td>
                <td className="px-6 py-4 text-sm text-zinc-600">{credit.client_name}</td>
                <td className="px-6 py-4 text-sm text-zinc-500">{new Date(credit.due_date).toLocaleDateString()}</td>
                <td className="px-6 py-4 font-bold text-zinc-900">UGX {(credit.amount_ugx || 0).toLocaleString()}</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                    credit.status === 'Paid' ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                  )}>
                    {credit.status}
                  </span>
                </td>
              </tr>
            ))}
            {filteredCredits.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                  No credit invoices found for the selected date range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const BranchPettyCash: React.FC = () => {
  const { profile, activeBranchId, activeBranch } = useAuth();
  const [requisitions, setRequisitions] = useState<PettyCashRequisition[]>([]);
  const [issues, setIssues] = useState<PettyCashIssue[]>([]);
  const [expenses, setExpenses] = useState<BranchExpense[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    amount: 0,
    reason: '',
    urgency: 'normal' as 'normal' | 'urgent' | 'emergency'
  });

  useEffect(() => {
    if (profile?.tenantId && activeBranchId) {
      const unsubReqs = firestoreService.subscribeToCollection<PettyCashRequisition>('petty_cash_requisitions', profile.tenantId, (data) => {
        setRequisitions(data.filter(r => r.branch_id === activeBranchId).sort((a, b) => new Date(b.requisition_date).getTime() - new Date(a.requisition_date).getTime()));
      });
      const unsubIssues = firestoreService.subscribeToCollection<PettyCashIssue>('petty_cash_issues', profile.tenantId, (data) => {
        setIssues(data.filter(i => i.branch_id === activeBranchId).sort((a, b) => new Date(b.issue_date).getTime() - new Date(a.issue_date).getTime()));
      });
      const unsubExpenses = firestoreService.subscribeToCollection<BranchExpense>('branch_expenses', profile.tenantId, (data) => {
        setExpenses(data.filter(e => e.branch_id === activeBranchId && e.payment_method === 'Petty Cash'));
      });
      return () => {
        unsubReqs();
        unsubIssues();
        unsubExpenses();
      };
    }
  }, [profile?.tenantId, activeBranchId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId || !activeBranchId) return;

    try {
      await firestoreService.addDocument('petty_cash_requisitions', {
        tenantId: profile.tenantId,
        branch_id: activeBranchId,
        branch_name: activeBranch?.name || 'Unknown Branch',
        requisition_date: new Date().toISOString().split('T')[0],
        amount_requested: formData.amount,
        reason: formData.reason,
        urgency: formData.urgency,
        status: 'pending',
        logged_by: profile.uid,
        created_at: new Date().toISOString()
      });
      toast.success('Requisition submitted');
      setIsAdding(false);
      setFormData({ amount: 0, reason: '', urgency: 'normal' });
    } catch (error) {
      toast.error('Failed to submit requisition');
    }
  };

  const handleAcceptIssue = async (issue: PettyCashIssue) => {
    try {
      await firestoreService.updateDocument('petty_cash_issues', issue.id, {
        status: 'received',
        received_by: profile?.uid,
        received_at: new Date().toISOString()
      });

      if (issue.requisition_id) {
        await firestoreService.updateDocument('petty_cash_requisitions', issue.requisition_id, {
          status: 'received'
        });
      }

      toast.success('Petty cash received and accepted');
    } catch (error) {
      toast.error('Failed to accept petty cash');
    }
  };

  const totalPettyCashReceived = issues
    .filter(i => i.status === 'received')
    .reduce((sum, i) => sum + i.amount, 0);

  const totalPettyCashSpent = expenses
    .reduce((sum, e) => sum + e.amount_ugx, 0);

  const totalPettyCash = totalPettyCashReceived - totalPettyCashSpent;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-zinc-900 p-6 rounded-3xl text-white shadow-xl shadow-zinc-900/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Wallet size={80} />
          </div>
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Total Branch Petty Cash</p>
          <h3 className="text-3xl font-black">UGX {(totalPettyCash || 0).toLocaleString()}</h3>
          <p className="text-[10px] mt-2 font-bold bg-white/20 inline-block px-2 py-1 rounded">Available for Operations</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 flex flex-col items-center justify-center gap-2 hover:bg-emerald-100 transition-all group"
        >
          <div className="h-12 w-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 group-hover:scale-110 transition-transform">
            <Plus size={24} />
          </div>
          <span className="font-bold text-emerald-700 text-lg">New Requisition</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
            <h3 className="font-bold text-zinc-900 flex items-center gap-2">
              <Truck size={20} className="text-blue-500" />
              Incoming Petty Cash
            </h3>
          </div>
          <div className="p-4 space-y-3">
            {issues.filter(i => i.status !== 'received').map((issue) => (
              <div key={issue.id} className="flex items-center justify-between p-4 bg-blue-50 rounded-2xl border border-blue-100">
                <div>
                  <p className="font-bold text-blue-900">UGX {issue.amount.toLocaleString()}</p>
                  <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">Ref: {issue.reference_number}</p>
                  <p className="text-xs text-blue-500 mt-1">Issued on {new Date(issue.issue_date).toLocaleDateString()}</p>
                </div>
                <button 
                  onClick={() => handleAcceptIssue(issue)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
                >
                  Accept Cash
                </button>
              </div>
            ))}
            {issues.filter(i => i.status !== 'received').length === 0 && (
              <div className="text-center py-12 text-zinc-400 italic text-sm">
                No pending incoming petty cash
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
            <h3 className="font-bold text-zinc-900 flex items-center gap-2">
              <FileText size={20} className="text-amber-500" />
              Petty Cash Requisitions
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 bg-zinc-50/50">
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {requisitions.map((req) => (
                  <tr key={req.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-zinc-600">{new Date(req.requisition_date).toLocaleDateString()}</td>
                    <td className="px-6 py-4 font-bold text-zinc-900">UGX {req.amount_requested.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                        req.status === 'received' ? "bg-emerald-50 text-emerald-600" :
                        req.status === 'rejected' ? "bg-red-50 text-red-600" :
                        req.status === 'issued' ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-600"
                      )}>
                        {req.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-8">
              <h2 className="text-2xl font-bold text-zinc-900 mb-6">New Petty Cash Requisition</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Amount (UGX)</label>
                  <input 
                    type="number"
                    required
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    value={formData.amount || ''}
                    onChange={(e) => setFormData({...formData, amount: parseInt(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Urgency</label>
                  <select 
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    value={formData.urgency}
                    onChange={(e) => setFormData({...formData, urgency: e.target.value as any})}
                  >
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                    <option value="emergency">Emergency</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Reason / Purpose</label>
                  <textarea 
                    required
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 outline-none min-h-[100px]"
                    placeholder="Why is this cash needed?"
                    value={formData.reason}
                    onChange={(e) => setFormData({...formData, reason: e.target.value})}
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="flex-1 py-3 text-zinc-500 font-bold hover:bg-zinc-50 rounded-2xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 bg-emerald-500 text-white rounded-2xl font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
                  >
                    Submit
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const InvoicesLedger: React.FC = () => {
  return <NewInvoiceLedger />;
};

const LegacyInvoicesLedger: React.FC = () => {
  const { profile } = useAuth();
  const [invoices, setInvoices] = useState<ProcurementInvoice[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<ProcurementInvoice | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [dateRange, setDateRange] = useState({ 
    start: new Date().toISOString().split('T')[0], 
    end: new Date().toISOString().split('T')[0] 
  });
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, setBranches);
      return firestoreService.subscribeToCollection<ProcurementInvoice>('procurement_invoices', profile.tenantId, (data) => {
        setInvoices(data.sort((a, b) => new Date(b.invoice_date).getTime() - new Date(a.invoice_date).getTime()));
      });
    }
  }, [profile?.tenantId]);

  const filteredInvoices = invoices.filter(inv => {
    const searchStr = searchTerm.toLowerCase();
    const matchesSearch = (inv.invoice_number || '').toLowerCase().includes(searchStr) || 
                         (inv.supplier_name || '').toLowerCase().includes(searchStr) ||
                         (inv.grn_number || '').toLowerCase().includes(searchStr);
    const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
    const matchesBranch = branchFilter === 'all' || inv.branch_id === branchFilter;
    const matchesDate = (!dateRange.start || inv.invoice_date >= dateRange.start) && 
                       (!dateRange.end || inv.invoice_date <= dateRange.end);
    return matchesSearch && matchesStatus && matchesBranch && matchesDate;
  });

  const totalOutstanding = filteredInvoices.reduce((sum, inv) => sum + (inv.total_amount_ugx - inv.paid_amount_ugx), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-zinc-900 p-6 rounded-3xl text-white shadow-xl shadow-zinc-900/20">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Total Outstanding</p>
          <h3 className="text-3xl font-black">UGX {(totalOutstanding || 0).toLocaleString()}</h3>
          <p className="text-[10px] mt-2 font-bold bg-white/20 inline-block px-2 py-1 rounded">Filtered Results</p>
        </div>
        <div className="md:col-span-3 bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px] space-y-1">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
              <input 
                type="text"
                placeholder="Invoice # or Supplier..."
                className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Status</label>
            <select 
              className="px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="Paid">Paid</option>
              <option value="Credit">Credit</option>
              <option value="Partial">Partial</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Branch</label>
            <select 
              className="px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
            >
              <option value="all">All Branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Date Range</label>
            <div className="flex items-center gap-2">
              <input 
                type="date"
                className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none"
                value={dateRange.start}
                onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
              />
              <span className="text-zinc-400">-</span>
              <input 
                type="date"
                className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none"
                value={dateRange.end}
                onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Invoice #</th>
              <th className="px-6 py-4">Supplier</th>
              <th className="px-6 py-4">Branch</th>
              <th className="px-6 py-4 text-right">Total</th>
              <th className="px-6 py-4 text-right">Balance</th>
              <th className="px-6 py-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {filteredInvoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-zinc-50/50 transition-colors">
                <td className="px-6 py-4 text-sm text-zinc-600">{new Date(inv.invoice_date).toLocaleDateString()}</td>
                <td className="px-6 py-4 text-sm font-bold text-zinc-900">
                  <div>{inv.invoice_number}</div>
                  {inv.grn_number && <div className="text-[10px] text-zinc-400">GRN: {inv.grn_number}</div>}
                </td>
                <td className="px-6 py-4 text-sm text-zinc-600">{inv.supplier_name}</td>
                <td className="px-6 py-4 text-sm text-zinc-500">
                  {branches.find(b => b.id === inv.branch_id)?.name || inv.branch_name || 'Main'}
                </td>
                <td className="px-6 py-4 text-sm text-right font-bold">UGX {inv.total_amount_ugx.toLocaleString()}</td>
                <td className="px-6 py-4 text-sm text-right font-bold text-amber-600">
                  UGX {(inv.total_amount_ugx - inv.paid_amount_ugx).toLocaleString()}
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                    inv.status === 'Paid' ? "bg-emerald-50 text-emerald-600" : 
                    inv.status === 'Credit' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                  )}>
                    {inv.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button 
                    onClick={() => setEditingInvoice(inv)}
                    className="p-2 text-zinc-400 hover:text-zinc-900 transition-colors"
                  >
                    <Edit2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(isModalOpen || editingInvoice) && (
        <ProcurementInvoiceModal 
          isOpen={isModalOpen || !!editingInvoice} 
          invoice={editingInvoice}
          onClose={() => {
            setIsModalOpen(false);
            setEditingInvoice(null);
          }} 
        />
      )}
    </div>
  );
};

const ProcurementInvoiceModal: React.FC<{ isOpen: boolean, invoice?: ProcurementInvoice | null, onClose: () => void }> = ({ isOpen, invoice, onClose }) => {
  const { profile, activeBranchId } = useAuth();
  const [formData, setFormData] = useState({
    invoice_number: invoice?.invoice_number || '',
    supplier_name: invoice?.supplier_name || '',
    invoice_date: invoice?.invoice_date || new Date().toISOString().split('T')[0],
    due_date: invoice?.due_date || new Date().toISOString().split('T')[0],
    total_amount_ugx: invoice?.total_amount_ugx || 0,
    paid_amount_ugx: invoice?.paid_amount_ugx || 0,
    status: invoice?.status || 'Credit' as const
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      if (invoice) {
        await firestoreService.updateDocument('procurement_invoices', invoice.id, {
          ...formData,
          amount: formData.total_amount_ugx
        });
        toast.success('Invoice updated');
      } else {
        await firestoreService.addDocument('procurement_invoices', {
          ...formData,
          amount: formData.total_amount_ugx,
          tenantId: profile.tenantId,
          branch_id: activeBranchId || 'main',
          created_at: new Date().toISOString()
        });
        toast.success('Invoice added to ledger');
      }
      onClose();
    } catch (error) {
      toast.error('Failed to save invoice');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl">
        <div className="p-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">{invoice ? 'Edit' : 'Add'} Procurement Invoice</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Invoice #</label>
                <input 
                  type="text" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                  value={formData.invoice_number}
                  onChange={(e) => setFormData({...formData, invoice_number: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Supplier</label>
                <input 
                  type="text" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                  value={formData.supplier_name}
                  onChange={(e) => setFormData({...formData, supplier_name: e.target.value})}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Invoice Date</label>
                <input 
                  type="date" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                  value={formData.invoice_date}
                  onChange={(e) => setFormData({...formData, invoice_date: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Due Date</label>
                <input 
                  type="date" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                  value={formData.due_date}
                  onChange={(e) => setFormData({...formData, due_date: e.target.value})}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Total Amount</label>
                <input 
                  type="number" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                  value={formData.total_amount_ugx}
                  onChange={(e) => setFormData({...formData, total_amount_ugx: parseInt(e.target.value) || 0})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Paid Amount</label>
                <input 
                  type="number" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                  value={formData.paid_amount_ugx}
                  onChange={(e) => setFormData({...formData, paid_amount_ugx: parseInt(e.target.value) || 0})}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Status</label>
              <select 
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                value={formData.status}
                onChange={(e) => setFormData({...formData, status: e.target.value as any})}
              >
                <option value="Paid">Paid</option>
                <option value="Credit">Credit</option>
                <option value="Partial">Partial</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4">
              <button 
                type="button" onClick={onClose}
                className="flex-1 px-6 py-3 border border-zinc-200 text-zinc-600 font-bold rounded-2xl hover:bg-zinc-50 transition-all"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="flex-1 px-6 py-3 bg-zinc-900 text-white font-bold rounded-2xl hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-900/20"
              >
                {invoice ? 'Save Changes' : 'Add Invoice'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

const OldManagementExpenseLedger: React.FC = () => {
  const { profile } = useAuth();
  const [expenses, setExpenses] = useState<ManagementExpense[]>([]);
  const [pcLedger, setPcLedger] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [dateRange, setDateRange] = useState({ 
    start: new Date().toISOString().split('T')[0], 
    end: new Date().toISOString().split('T')[0] 
  });

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubMg = firestoreService.subscribeToCollection<ManagementExpense>('management_expenses', profile.tenantId, (data) => {
        setExpenses(data.sort((a, b) => new Date(b.expense_date || b.created_at || '').getTime() - new Date(a.expense_date || a.created_at || '').getTime()));
      });
      const unsubPc = firestoreService.subscribeToCollection<any>('petty_cash_ledger', profile.tenantId, setPcLedger);
      return () => {
        unsubMg();
        unsubPc();
      };
    }
  }, [profile?.tenantId]);

  const filteredExpenses = expenses.filter(exp => {
    const expDate = (exp.expense_date || '').split('T')[0];
    const matchesStart = !dateRange.start || expDate >= dateRange.start;
    const matchesEnd = !dateRange.end || expDate <= dateRange.end;
    return matchesStart && matchesEnd;
  });

  const totalFiltered = filteredExpenses.reduce((sum, exp) => sum + (exp.amount_ugx || 0), 0);

  const pcBalance = pcLedger.reduce((acc, curr) => {
    return curr.type === 'incoming' ? acc + curr.amount : acc - curr.amount;
  }, 0);

  const handleApproveExpense = async (exp: ManagementExpense) => {
    const expenseAmt = (exp.amount_ugx || 0);
    if (pcBalance < expenseAmt) {
      toast.error(`Insufficient corporate petty cash balance! Available: UGX ${pcBalance.toLocaleString()}`);
      return;
    }

    try {
      await firestoreService.updateDocument('management_expenses', exp.id!, {
        status: 'Approved',
        approved_at: new Date().toISOString(),
        approved_by: profile?.name || 'Finance System'
      });

      // Deduct from petty cash ledger
      await firestoreService.addDocument('petty_cash_ledger', {
        tenantId: profile!.tenantId,
        date: new Date().toISOString().split('T')[0],
        amount: expenseAmt,
        source: `Management Expense: ${exp.category}`,
        reference_number: `EXP-${exp.id ? exp.id.slice(-6) : Date.now().toString().slice(-6)}`,
        type: 'outgoing',
        branch_id: 'HQ',
        logged_by: profile!.uid,
        created_at: new Date().toISOString()
      });

      toast.success('Management expense approved and successfully deducted from petty cash!');
    } catch (error) {
      toast.error('Failed to disburse management expense');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900 p-6 rounded-3xl text-white shadow-xl shadow-zinc-900/20">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Expenses (Selected Period)</p>
          <h3 className="text-3xl font-black">UGX {(totalFiltered || 0).toLocaleString()}</h3>
          <p className="text-[10px] mt-2 font-bold bg-white/20 inline-block px-2 py-1 rounded">HQ Operations</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 flex flex-col justify-center gap-2">
          <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Filter Date Range</p>
          <div className="flex items-center gap-2">
            <input 
              type="date" 
              value={dateRange.start} 
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="w-full px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500/20"
            />
            <span className="text-xs text-zinc-400 font-bold">to</span>
            <input 
              type="date" 
              value={dateRange.end} 
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="w-full px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500/20"
            />
          </div>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-amber-50 p-6 rounded-3xl border border-amber-100 flex flex-col items-center justify-center gap-2 hover:bg-amber-100 transition-all group"
        >
          <div className="h-12 w-12 bg-amber-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-amber-500/20 group-hover:scale-110 transition-transform">
            <Plus size={24} />
          </div>
          <span className="font-bold text-amber-700">Log HQ Expense</span>
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-zinc-50 border-b border-zinc-100 flex justify-between items-center text-xs font-bold text-zinc-600">
          <span>CORPORATE PETTY CASH BALANCE: UGX {pcBalance.toLocaleString()}</span>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Category</th>
              <th className="px-6 py-4">Description</th>
              <th className="px-6 py-4 text-right">Amount</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {filteredExpenses.map((exp) => (
              <tr key={exp.id} className="hover:bg-zinc-50/50 transition-colors">
                <td className="px-6 py-4 text-sm text-zinc-600">{exp.expense_date ? new Date(exp.expense_date).toLocaleDateString() : 'N/A'}</td>
                <td className="px-6 py-4 text-sm font-bold text-zinc-900">{exp.category}</td>
                <td className="px-6 py-4 text-sm text-zinc-600">{exp.description}</td>
                <td className="px-6 py-4 text-sm text-right font-bold">UGX {exp.amount_ugx.toLocaleString()}</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                    exp.status === 'Approved' ? "bg-emerald-50 text-emerald-600" : 
                    exp.status === 'Rejected' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                  )}>
                    {exp.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-center">
                  {exp.status === 'Pending' && (
                    <button
                      onClick={() => handleApproveExpense(exp)}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-extrabold shadow-sm transition-colors"
                    >
                      Approve & Issue Cash
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filteredExpenses.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">
                  No HQ management expenses found for the selected date range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {isModalOpen && <ManagementExpenseModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />}
    </div>
  );
};

const ManagementExpenseModal: React.FC<{ isOpen: boolean, onClose: () => void }> = ({ isOpen, onClose }) => {
  const { profile } = useAuth();
  const [disburseDirectly, setDisburseDirectly] = useState(false);
  const [formData, setFormData] = useState({
    category: '',
    department: 'General Admin',
    description: '',
    amount_ugx: 0,
    expense_date: new Date().toISOString().split('T')[0],
    payment_method: 'Bank Transfer'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      const status = disburseDirectly ? 'Approved' : 'Pending';
      const expenseDoc = {
        ...formData,
        tenantId: profile.tenantId,
        logged_by: profile.name,
        status: status,
        created_at: new Date().toISOString()
      };
      const savedDoc = await firestoreService.addDocument('management_expenses', expenseDoc);

      if (disburseDirectly) {
        // Also add an outgoing record to petty_cash_ledger!
        await firestoreService.addDocument('petty_cash_ledger', {
          tenantId: profile.tenantId,
          date: formData.expense_date,
          amount: formData.amount_ugx,
          source: `Management Expense: ${formData.category}`,
          reference_number: `EXP-${savedDoc ? savedDoc.slice(-6) : Date.now().toString().slice(-6)}`,
          type: 'outgoing',
          branch_id: 'HQ',
          logged_by: profile.uid,
          created_at: new Date().toISOString()
        });
        toast.success('HQ Expense logged and disbursed from Petty Cash!');
      } else {
        toast.success('HQ Expense logged successfully (Scheduled for Approval)');
      }
      onClose();
    } catch (error) {
      toast.error('Failed to log expense');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl">
        <div className="p-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">Log Management Expense</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Category</label>
              <select 
                required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                value={formData.category}
                onChange={(e) => setFormData({...formData, category: e.target.value})}
              >
                <option value="">Select Category</option>
                <option value="Rent">Rent</option>
                <option value="Salaries">Salaries</option>
                <option value="Utilities">Utilities</option>
                <option value="Marketing">Marketing</option>
                <option value="Taxes">Taxes/Licenses</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Department</label>
              <select 
                required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                value={formData.department}
                onChange={(e) => setFormData({...formData, department: e.target.value})}
              >
                <option value="General Admin">General Admin</option>
                <option value="Finance">Finance</option>
                <option value="HR">HR</option>
                <option value="Operations">Operations</option>
                <option value="Logistics">Logistics</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Description</label>
              <input 
                type="text" required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Amount (UGX)</label>
              <input 
                type="number" required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                value={formData.amount_ugx || ''}
                onChange={(e) => setFormData({...formData, amount_ugx: parseInt(e.target.value) || 0})}
              />
            </div>
            <div className="flex items-center gap-2 py-2">
              <input 
                type="checkbox"
                id="disburseDirectly"
                checked={disburseDirectly}
                onChange={(e) => setDisburseDirectly(e.target.checked)}
                className="rounded border-zinc-300 text-zinc-950 focus:ring-0 cursor-pointer h-4 w-4"
              />
              <label htmlFor="disburseDirectly" className="text-xs font-semibold text-zinc-700 cursor-pointer select-none">
                Approve & Direct disburse from Corporate Petty Cash Ledger
              </label>
            </div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 py-3 text-zinc-500 font-bold">Cancel</button>
              <button type="submit" className="flex-1 py-3 bg-zinc-900 text-white rounded-2xl font-bold">Log Expense</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

const OldGlobalExpenseLedger: React.FC = () => {
  const { profile } = useAuth();
  const [branchExpenses, setBranchExpenses] = useState<BranchExpense[]>([]);
  const [mgmtExpenses, setMgmtExpenses] = useState<ManagementExpense[]>([]);
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<any[]>([]);
  const [fineLogs, setFineLogs] = useState<any[]>([]);
  const [logisticsExpenses, setLogisticsExpenses] = useState<any[]>([]);
  const [payrollList, setPayrollList] = useState<any[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, setBranches);
      const unsubBranch = firestoreService.subscribeToCollection<BranchExpense>('branch_expenses', profile.tenantId, setBranchExpenses);
      const unsubMgmt = firestoreService.subscribeToCollection<ManagementExpense>('management_expenses', profile.tenantId, setMgmtExpenses);
      const unsubFuel = firestoreService.subscribeToCollection<any>('fuel_logs', profile.tenantId, setFuelLogs);
      const unsubMaint = firestoreService.subscribeToCollection<any>('maintenance_logs', profile.tenantId, setMaintenanceLogs);
      const unsubFines = firestoreService.subscribeToCollection<any>('traffic_fine_logs', profile.tenantId, setFineLogs);
      const unsubGeneralExp = firestoreService.subscribeToCollection<any>('logistics_expenses', profile.tenantId, setLogisticsExpenses);
      const unsubPayroll = firestoreService.subscribeToCollection<any>('payroll', profile.tenantId, setPayrollList);
      
      return () => {
        unsubBranch();
        unsubMgmt();
        unsubFuel();
        unsubMaint();
        unsubFines();
        unsubGeneralExp();
        unsubPayroll();
      };
    }
  }, [profile?.tenantId]);

  const allExpenses = [
    ...branchExpenses.map(e => ({ ...e, type: 'Branch' })),
    ...mgmtExpenses.map(e => ({ ...e, type: 'Management', branch_id: (e as any).department || 'HQ' })),
    ...fuelLogs.map(e => ({
      id: e.id,
      expense_date: e.date,
      category: 'Logistics - Fuel',
      description: `Fuel for vehicle ${e.vehicleId} at ${e.station_name}`,
      amount_ugx: e.cost_ugx,
      type: 'Logistics',
      branch_id: 'Fleet'
    })),
    ...maintenanceLogs.map(e => ({
      id: e.id,
      expense_date: e.date,
      category: 'Logistics - Maintenance',
      description: `${e.service_type} for vehicle ${e.vehicleId}`,
      amount_ugx: e.cost_ugx,
      type: 'Logistics',
      branch_id: 'Fleet'
    })),
    ...fineLogs.map(e => ({
      id: e.id,
      expense_date: e.date,
      category: 'Logistics - Fine',
      description: `Traffic fine: ${e.violation_type} (${e.vehicleId})`,
      amount_ugx: e.fine_amount_ugx,
      type: 'Logistics',
      branch_id: 'Fleet'
    })),
    ...logisticsExpenses.map(e => ({
      id: e.id,
      expense_date: e.date,
      category: `Logistics - ${e.category || 'General'}`,
      description: e.notes || 'Other logistics expense',
      amount_ugx: e.cost_ugx || 0,
      type: 'Logistics',
      branch_id: 'Fleet'
    })),
    ...payrollList.filter(p => p.status === 'paid').map(p => ({
      id: p.id,
      expense_date: p.paid_date || (p.generated_at ? p.generated_at.split('T')[0] : selectedDate),
      category: 'HR - Payroll Paid Out',
      description: `Disbursed Period Net Pay to ${p.staff_name || p.staffId}`,
      amount_ugx: p.net_salary || 0,
      type: 'Payroll',
      branch_id: p.branch_id || 'HQ'
    }))
  ].filter(e => e.expense_date === selectedDate);

  const totalDaily = allExpenses.reduce((sum, e) => sum + e.amount_ugx, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
        <div>
          <h3 className="text-xl font-black text-zinc-900">Global Expense Aggregator</h3>
          <p className="text-sm text-zinc-500">Consolidated view of all operational costs</p>
        </div>
        <div className="flex items-center gap-4">
          <input 
            type="date"
            className="px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          <div className="text-right">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Daily Total</p>
            <p className="text-xl font-black text-zinc-900">UGX {totalDaily.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
              <th className="px-6 py-4">Source</th>
              <th className="px-6 py-4">Branch/Dept</th>
              <th className="px-6 py-4">Category</th>
              <th className="px-6 py-4">Description</th>
              <th className="px-6 py-4 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {allExpenses.map((exp: any, index: number) => (
              <tr key={`${exp.type}-${exp.id || index}`} className="hover:bg-zinc-50/50 transition-colors">
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                    exp.type === 'Branch' ? "bg-blue-50 text-blue-600" : 
                    exp.type === 'Management' ? "bg-purple-50 text-purple-600" :
                    "bg-amber-50 text-amber-600"
                  )}>
                    {exp.type}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm font-bold text-zinc-900">
                  {branches.find(b => b.id === exp.branch_id)?.name || exp.branch_id}
                </td>
                <td className="px-6 py-4 text-sm text-zinc-600">{exp.category}</td>
                <td className="px-6 py-4 text-sm text-zinc-600">{exp.description}</td>
                <td className="px-6 py-4 text-sm text-right font-bold text-zinc-900">UGX {exp.amount_ugx.toLocaleString()}</td>
              </tr>
            ))}
            {allExpenses.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">No expenses recorded for this date.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const OldProfitabilityLedger: React.FC = () => {
  const { profile } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [branchExpenses, setBranchExpenses] = useState<BranchExpense[]>([]);
  const [mgmtExpenses, setMgmtExpenses] = useState<ManagementExpense[]>([]);
  const [quarantineLogs, setQuarantineLogs] = useState<any[]>([]);

  // Date Range Ledger Filter (default shows Today's requests unless adjusted)
  const [isDateFilterActive, setIsDateFilterActive] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubSales = firestoreService.subscribeToCollection('sales', profile.tenantId, setSales);
      const unsubBranch = firestoreService.subscribeToCollection<BranchExpense>('branch_expenses', profile.tenantId, setBranchExpenses);
      const unsubMgmt = firestoreService.subscribeToCollection<ManagementExpense>('management_expenses', profile.tenantId, setMgmtExpenses);
      const unsubQuarantine = firestoreService.subscribeToCollection('quarantine_logs', profile.tenantId, setQuarantineLogs);
      return () => {
        unsubSales();
        unsubBranch();
        unsubMgmt();
        unsubQuarantine();
      };
    }
  }, [profile?.tenantId]);

  // Filter items globally based on Date Range
  const filteredSales = sales.filter(s => {
    if (s.status === 'voided') return false; // Exclude voided sales
    if (!isDateFilterActive) return true;
    const d = (s.timestamp || s.date || '').split('T')[0];
    return d >= dateRange.start && d <= dateRange.end;
  });

  const filteredBranchExpenses = branchExpenses.filter(e => {
    if (!isDateFilterActive) return true;
    const d = (e.expense_date || '').split('T')[0];
    return d >= dateRange.start && d <= dateRange.end;
  });

  const filteredMgmtExpenses = mgmtExpenses.filter(e => {
    if (!isDateFilterActive) return true;
    const d = (e.expense_date || '').split('T')[0];
    return d >= dateRange.start && d <= dateRange.end;
  });

  const filteredQuarantine = quarantineLogs.filter(q => {
    if (!isDateFilterActive) return true;
    const d = (q.dateLogged || q.date || q.created_at || '').split('T')[0];
    return d && d >= dateRange.start && d <= dateRange.end;
  });

  // Calculate dynamic figures with correct property mapping keys
  const totalRevenue = filteredSales.reduce((sum, s) => sum + (s.total || s.total_amount || s.amount || 0), 0);
  const totalCOGS = filteredSales.reduce((sum, s) => sum + (s.total_cost || s.cost || (s.total || s.total_amount || 0) * 0.6), 0);
  const grossProfit = totalRevenue - totalCOGS;
  
  const totalBranchExp = filteredBranchExpenses.reduce((sum, e) => sum + (e.amount_ugx || e.amount || 0), 0);
  const totalMgmtExp = filteredMgmtExpenses.reduce((sum, e) => sum + (e.amount_ugx || e.amount || 0), 0);
  const totalWastage = filteredQuarantine.reduce((sum, q) => sum + (q.totalCost || q.total_cost || q.estimatedValue || 0), 0);
  
  const totalExpenses = totalBranchExp + totalMgmtExp + totalWastage;
  const netProfit = grossProfit - totalExpenses;

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* LEDGER DATE FILTER BAR */}
      <div className="bg-zinc-50 border border-zinc-200 p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div>
          <h4 className="font-extrabold text-zinc-950 text-sm">Profitability Ledger Auditor</h4>
          <p className="text-[10px] text-zinc-500 font-medium">Configure date intervals to verify Month-to-Date (MTD) or custom period margins.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-750 cursor-pointer">
            <input 
              type="checkbox" 
              checked={isDateFilterActive} 
              onChange={(e) => setIsDateFilterActive(e.target.checked)}
              className="rounded bg-white border-zinc-200 text-zinc-950 focus:ring-0"
            />
            Filter Ledger Date
          </label>
          {isDateFilterActive && (
            <div className="flex items-center gap-2">
              <input 
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                className="bg-white border border-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-xl outline-none"
              />
              <span className="text-zinc-400 text-xs">-</span>
              <input 
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                className="bg-white border border-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-xl outline-none"
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-emerald-500 p-6 rounded-3xl text-white shadow-xl shadow-emerald-500/20">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Gross Profit (MTD)</p>
          <h3 className="text-3xl font-black">UGX {grossProfit.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 font-bold bg-white/20 inline-block px-2 py-1 rounded">
            Margin: {totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : 0}%
          </p>
        </div>
        <div className="bg-zinc-900 p-6 rounded-3xl text-white shadow-xl shadow-zinc-900/20">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Total Expenses</p>
          <h3 className="text-3xl font-black">UGX {totalExpenses.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 font-bold bg-white/20 inline-block px-2 py-1 rounded">Incl. Wastage</p>
        </div>
        <div className={cn(
          "p-6 rounded-3xl text-white shadow-xl",
          netProfit >= 0 ? "bg-blue-600 shadow-blue-600/20" : "bg-red-600 shadow-red-600/20"
        )}>
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Net Profit (MTD)</p>
          <h3 className="text-3xl font-black">UGX {netProfit.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 font-bold bg-white/20 inline-block px-2 py-1 rounded">Bottom Line</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Wastage/Loss</p>
          <h3 className="text-3xl font-black text-red-500">UGX {totalWastage.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 font-bold text-zinc-400">Recall & Quarantine</p>
        </div>
      </div>

      <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
        <h3 className="font-bold text-zinc-900 mb-6">Profitability Breakdown</h3>
        <div className="space-y-4">
          <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl">
            <span className="font-bold text-zinc-600">Total Revenue</span>
            <span className="font-black text-zinc-900">UGX {totalRevenue.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl">
            <span className="font-bold text-zinc-600">Cost of Goods Sold (COGS)</span>
            <span className="font-black text-red-500">- UGX {totalCOGS.toLocaleString()}</span>
          </div>
          <div className="h-px bg-zinc-200 my-2" />
          <div className="flex justify-between items-center p-4 bg-emerald-50 rounded-2xl">
            <span className="font-bold text-emerald-700">Gross Profit</span>
            <span className="font-black text-emerald-700">UGX {grossProfit.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl">
            <span className="font-bold text-zinc-600">Branch Operational Expenses</span>
            <span className="font-black text-red-500">- UGX {totalBranchExp.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl">
            <span className="font-bold text-zinc-600">Management/HQ Expenses</span>
            <span className="font-black text-red-500">- UGX {totalMgmtExp.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl">
            <span className="font-bold text-zinc-600">Inventory Wastage & Recalls</span>
            <span className="font-black text-red-500">- UGX {totalWastage.toLocaleString()}</span>
          </div>
          <div className="h-px bg-zinc-200 my-2" />
          <div className={cn(
            "flex justify-between items-center p-6 rounded-2xl",
            netProfit >= 0 ? "bg-blue-50" : "bg-red-50"
          )}>
            <span className={cn("text-lg font-black", netProfit >= 0 ? "text-blue-700" : "text-red-700")}>Net Profit</span>
            <span className={cn("text-2xl font-black", netProfit >= 0 ? "text-blue-700" : "text-red-700")}>UGX {netProfit.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const ManagementFinance: React.FC<{ settings: SystemSettings | null }> = ({ settings }) => {
  const [activeSubTab, setActiveSubTab] = useState<'invoices' | 'management_expenses' | 'global_expenses' | 'profitability' | 'credit_ledger' | 'oversight' | 'inbox' | 'petty_cash' | 'tax_engine'>('invoices');
  const { tenant } = useTenant();

  const tabs = [
    { id: 'invoices', label: 'Invoices Ledger', icon: FileText },
    { id: 'management_expenses', label: 'Management Expenses', icon: Briefcase },
    { id: 'global_expenses', label: 'Global Expense Ledger', icon: Globe },
    { id: 'profitability', label: 'Profitability Ledger', icon: BarChart3 },
    { id: 'credit_ledger', label: 'Credit Ledger', icon: CreditCard },
    { id: 'petty_cash', label: 'Petty Cash', icon: Wallet },
    { id: 'tax_engine', label: 'Tax Engine', icon: Sliders, hidden: !settings?.taxEngineEnabled || tenant?.subscription_tier === 'basic' },
    { id: 'oversight', label: 'Cash & Banking', icon: Building2 },
    { id: 'inbox', label: 'Reconciliation Inbox', icon: History },
  ].filter(t => !t.hidden);

  return (
    <div className="space-y-6">
      <div className="flex border-b border-zinc-200 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            className={cn(
              "flex items-center gap-2 px-6 py-3 text-sm font-medium transition-all border-b-2 whitespace-nowrap",
              activeSubTab === tab.id 
                ? "border-emerald-500 text-emerald-600" 
                : "border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300"
            )}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {activeSubTab === 'invoices' && <InvoicesLedger />}
        {activeSubTab === 'management_expenses' && <ManagementExpenseLedger />}
        {activeSubTab === 'global_expenses' && <GlobalExpenseLedger />}
        {activeSubTab === 'profitability' && <ProfitabilityLedger />}
        {activeSubTab === 'credit_ledger' && <CreditLedgerPanel />}
        {activeSubTab === 'petty_cash' && <PettyCashManagement />}
        {activeSubTab === 'tax_engine' && (
          tenant?.subscription_tier === 'basic' 
            ? <UpgradeRequiredCard moduleName="Taxes Calculation Engine" /> 
            : <TaxEngine />
        )}
        {activeSubTab === 'oversight' && <CashBankingOversight />}
        {activeSubTab === 'inbox' && <ReconciliationInbox />}
      </div>
    </div>
  );
};

const OldTaxManagement: React.FC<{ settings: SystemSettings | null }> = ({ settings }) => {
  const { profile } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [grns, setGrns] = useState<GRNRecord[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [branchesList, setBranchesList] = useState<any[]>([]);
  const [activeTaxTab, setActiveTaxTab] = useState<'vat' | 'paye' | 'nssf' | 'wht'>('vat');
  const [loading, setLoading] = useState(true);

  // Date Range Ledger Filter (default shows Today's requests unless adjusted)
  const [isDateFilterActive, setIsDateFilterActive] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubSales = firestoreService.subscribeToCollection<Sale>('sales', profile.tenantId, (data) => {
        setSales(data.filter(s => s.status === 'completed' || s.status === 'active'));
      });
      const unsubGrns = firestoreService.subscribeToCollection<GRNRecord>('grn_records', profile.tenantId, setGrns);
      const unsubPayroll = firestoreService.subscribeToCollection<any>('payroll', profile.tenantId, setPayroll);
      const unsubStaff = firestoreService.subscribeToCollection<any>('staff', profile.tenantId, setStaffList);
      const unsubBranches = firestoreService.subscribeToCollection<any>('branches', profile.tenantId, setBranchesList);
      
      setLoading(false);
      return () => {
        unsubSales();
        unsubGrns();
        unsubPayroll();
        unsubStaff();
        unsubBranches();
      };
    }
  }, [profile?.tenantId]);

  // Filter items globally based on Date Range
  const filteredSales = sales.filter(s => {
    if (!isDateFilterActive) return true;
    const d = (s.timestamp || s.date || '').split('T')[0];
    return d >= dateRange.start && d <= dateRange.end;
  });

  const filteredGrns = grns.filter(g => {
    if (!isDateFilterActive) return true;
    const d = (g.receivedAt || g.date || '').split('T')[0];
    return d && d >= dateRange.start && d <= dateRange.end;
  });

  const filteredPayroll = payroll.filter(p => {
    if (!isDateFilterActive) return true;
    const d = (p.payment_date || p.date || p.created_at || '').split('T')[0];
    if (!d) return true; // keep as fallback
    return d >= dateRange.start && d <= dateRange.end;
  });

  const outputVat = filteredSales.reduce((acc, curr) => acc + (curr.taxAmount || 0), 0);
  const inputVat = filteredGrns.reduce((acc, curr) => acc + (curr.inputVat || 0), 0);
  const netVat = outputVat - inputVat;

  const totalPaye = filteredPayroll.reduce((acc, curr) => acc + (curr.paye || 0), 0);
  const totalNssf = filteredPayroll.reduce((acc, curr) => acc + (curr.nssf_employee || 0) + (curr.nssf_employer || 0), 0);
  const totalWht = filteredGrns.reduce((acc, curr) => acc + (curr.whtAmount || 0), 0);

  const taxTabs = [
    { id: 'vat', label: 'VAT Report', icon: Receipt },
    { id: 'paye', label: 'PAYE Report', icon: Users },
    { id: 'nssf', label: 'NSSF Report', icon: ShieldAlert },
    { id: 'wht', label: 'WHT Report', icon: FileText },
  ];

  return (
    <div className="space-y-6">
      {/* Dynamic Tax Control Toggle Banner */}
      <div className="bg-zinc-100/50 border border-zinc-200/60 p-5 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-2xl flex items-center justify-center border transition-colors ${
            (settings?.process_tax_deductibles !== false) 
              ? "bg-emerald-50 text-emerald-600 border-emerald-100" 
              : "bg-red-50 text-red-650 border-red-100"
          }`}>
            <Receipt size={20} />
          </div>
          <div>
            <h4 className="text-xs font-black text-zinc-900 uppercase tracking-wider">System-Wide Tax Processing Engine</h4>
            <p className="text-[11px] text-zinc-500 font-medium">
              {(settings?.process_tax_deductibles !== false) 
                ? "ACTIVE — Automatic progressive PAYE & NSSF calculations are enforced on salary baselines." 
                : "INACTIVE (OFF-SYSTEM OPERATIONAL ROUTINE) — Salary baseline will generate basic Gross remuneration payouts."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Tax Deductibles Engine</span>
          <button
            onClick={async () => {
              if (!profile?.tenantId || !settings) {
                toast.error("Settings profile not loaded yet. Try again shortly.");
                return;
              }
              const nextVal = settings.process_tax_deductibles === false ? true : false;
              await firestoreService.updateDocument('system_settings', settings.id, {
                process_tax_deductibles: nextVal
              });
              toast.success(`Tax Deductibles processing switched ${nextVal ? 'ON' : 'OFF'}`);
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              (settings?.process_tax_deductibles !== false) ? "bg-emerald-600" : "bg-zinc-300"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                (settings?.process_tax_deductibles !== false) ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* GLOBAL DATE FILTER BAR FOR TAX REPORTS */}
      <div className="bg-zinc-50 border border-zinc-200 p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div>
          <h4 className="font-extrabold text-zinc-950 text-sm">Tax Engine Ledger Auditor</h4>
          <p className="text-[10px] text-zinc-500 font-medium">Defaults to Today's tax entries to prevent data pollution across financial years.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-700 cursor-pointer">
            <input 
              type="checkbox" 
              checked={isDateFilterActive} 
              onChange={(e) => setIsDateFilterActive(e.target.checked)}
              className="rounded bg-white border-zinc-300 text-zinc-900 focus:ring-0"
            />
            Filter Ledger Date
          </label>
          {isDateFilterActive && (
            <div className="flex items-center gap-2">
              <input 
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                className="bg-white border border-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-xl outline-none"
              />
              <span className="text-zinc-400 text-xs">-</span>
              <input 
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                className="bg-white border border-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-xl outline-none"
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-emerald-600 p-6 rounded-3xl text-white shadow-xl shadow-emerald-600/20 relative overflow-hidden">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Net VAT Liability</p>
          <h3 className="text-2xl font-black">UGX {netVat.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 opacity-60 italic">Output - Input VAT</p>
        </div>

        <div className="bg-blue-600 p-6 rounded-3xl text-white shadow-xl shadow-blue-600/20 relative overflow-hidden">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Total PAYE</p>
          <h3 className="text-2xl font-black">UGX {totalPaye.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 opacity-60 italic">Employee Tax Deductions</p>
        </div>

        <div className="bg-amber-600 p-6 rounded-3xl text-white shadow-xl shadow-amber-600/20 relative overflow-hidden">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Total NSSF</p>
          <h3 className="text-2xl font-black">UGX {totalNssf.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 opacity-60 italic">15% Total Contribution</p>
        </div>

        <div className="bg-zinc-900 p-6 rounded-3xl text-white shadow-xl shadow-zinc-900/20 relative overflow-hidden">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Total WHT</p>
          <h3 className="text-2xl font-black">UGX {totalWht.toLocaleString()}</h3>
          <p className="text-[10px] mt-2 opacity-60 italic">Withholding Tax</p>
        </div>
      </div>

      <div className="flex bg-zinc-100 p-1 rounded-2xl border border-zinc-200 w-fit">
        {taxTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTaxTab(tab.id as any)}
            className={cn(
              "flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all",
              activeTaxTab === tab.id 
                ? "bg-white text-zinc-900 shadow-sm" 
                : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden relative">
        {/* Dynamic Report Watermark Background */}
        {settings?.branding?.logoUrl && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none opacity-[0.04] z-0 overflow-hidden p-12">
            <img src={settings.branding.logoUrl} alt="Watermark Logo" className="max-w-[40%] max-h-[50%] object-contain" referrerPolicy="no-referrer" />
          </div>
        )}
        
        <div className="relative z-10">
          {activeTaxTab === 'vat' && (
          <div className="space-y-6 p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100">
                <h4 className="text-sm font-black text-emerald-900 uppercase tracking-widest mb-4">Output VAT (Sales)</h4>
                <p className="text-3xl font-black text-emerald-600">UGX {outputVat.toLocaleString()}</p>
                <p className="text-xs text-emerald-500 mt-2">Collected from {sales.length} sales</p>
              </div>
              <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100">
                <h4 className="text-sm font-black text-blue-900 uppercase tracking-widest mb-4">Input VAT (Purchases)</h4>
                <p className="text-3xl font-black text-blue-600">UGX {inputVat.toLocaleString()}</p>
                <p className="text-xs text-blue-500 mt-2">Claimable from {grns.length} GRNs</p>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                    <th className="px-6 py-4">Reference</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4 text-right">Taxable Amount</th>
                    <th className="px-6 py-4 text-right">VAT Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {sales.slice(0, 5).map((sale) => (
                    <tr key={sale.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-zinc-900">{sale.receiptNumber}</td>
                      <td className="px-6 py-4 text-sm text-zinc-500">{new Date(sale.timestamp).toLocaleDateString()}</td>
                      <td className="px-6 py-4"><span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-1 rounded uppercase">Output</span></td>
                      <td className="px-6 py-4 text-sm text-zinc-600 text-right">UGX {sale.subtotal.toLocaleString()}</td>
                      <td className="px-6 py-4 font-bold text-emerald-600 text-right">UGX {(sale.taxAmount || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                  {grns.filter(g => (g.inputVat || 0) > 0).slice(0, 5).map((grn) => (
                    <tr key={grn.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-zinc-900">{grn.grn_number}</td>
                      <td className="px-6 py-4 text-sm text-zinc-500">{new Date(grn.receivedAt).toLocaleDateString()}</td>
                      <td className="px-6 py-4"><span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded uppercase">Input</span></td>
                      <td className="px-6 py-4 text-sm text-zinc-600 text-right">UGX {grn.total_value_ugx.toLocaleString()}</td>
                      <td className="px-6 py-4 font-bold text-blue-600 text-right">UGX {(grn.inputVat || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTaxTab === 'paye' && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-zinc-900">PAYE Deductions Ledger</h4>
              <button className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-bold uppercase tracking-widest">
                <Download size={16} /> Export Report
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                    <th className="px-6 py-4">Staff ID & Name</th>
                    <th className="px-6 py-4">Branch Attached</th>
                    <th className="px-6 py-4">Month</th>
                    <th className="px-6 py-4 text-right">Gross Salary</th>
                    <th className="px-6 py-4 text-right">PAYE Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredPayroll.filter(p => (p.paye || 0) > 0).map((p) => {
                    const stf = staffList.find(s => s.id === p.staffId || s.id === p.staff_id || s.employeeId === p.staffId);
                    const br = branchesList.find(b => b.id === (stf?.branch_id || p.branch_id || p.branchId));
                    return (
                      <tr key={p.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-zinc-900">{stf?.full_name || p.staff_name || 'System Staff'}</div>
                          <div className="text-[10px] text-zinc-400 font-mono">ID: {stf?.employeeId || stf?.id || p.staffId || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-800 font-medium">
                          {br?.name || 'Main HQ / General'}
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-500">{p.month}</td>
                        <td className="px-6 py-4 text-sm text-zinc-600 text-right">UGX {p.base_salary?.toLocaleString() || p.gross_salary?.toLocaleString() || '0'}</td>
                        <td className="px-6 py-4 font-bold text-blue-600 text-right">UGX {(p.paye || 0).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                  {filteredPayroll.filter(p => (p.paye || 0) > 0).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">No PAYE records found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTaxTab === 'nssf' && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-zinc-900">NSSF Contributions Ledger (15%)</h4>
              <button className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-bold uppercase tracking-widest">
                <Download size={16} /> Export Report
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                    <th className="px-6 py-4">Staff ID & Name</th>
                    <th className="px-6 py-4">Branch Attached</th>
                    <th className="px-6 py-4">Month</th>
                    <th className="px-6 py-4 text-right">Employee (5%)</th>
                    <th className="px-6 py-4 text-right">Employer (10%)</th>
                    <th className="px-6 py-4 text-right">Total (15%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredPayroll.filter(p => (p.nssf_employee || 0) > 0).map((p) => {
                    const stf = staffList.find(s => s.id === p.staffId || s.id === p.staff_id || s.employeeId === p.staffId);
                    const br = branchesList.find(b => b.id === (stf?.branch_id || p.branch_id || p.branchId));
                    return (
                      <tr key={p.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-zinc-900">{stf?.full_name || p.staff_name || 'System Staff'}</div>
                          <div className="text-[10px] text-zinc-400 font-mono">ID: {stf?.employeeId || stf?.id || p.staffId || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-800 font-medium">
                          {br?.name || 'Main HQ / General'}
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-500">{p.month}</td>
                        <td className="px-6 py-4 text-sm text-zinc-600 text-right">UGX {p.nssf_employee.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm text-zinc-600 text-right">UGX {p.nssf_employer.toLocaleString()}</td>
                        <td className="px-6 py-4 font-bold text-amber-600 text-right">UGX {(p.nssf_employee + p.nssf_employer).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                  {filteredPayroll.filter(p => (p.nssf_employee || 0) > 0).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">No NSSF records found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTaxTab === 'wht' && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-zinc-900">Withholding Tax (WHT) Ledger</h4>
              <button className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-bold uppercase tracking-widest">
                <Download size={16} /> Export Report
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                    <th className="px-6 py-4">GRN #</th>
                    <th className="px-6 py-4">Supplier</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4 text-right">Gross Amount</th>
                    <th className="px-6 py-4 text-right">WHT Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {grns.filter(g => (g.whtAmount || 0) > 0).map((g) => (
                    <tr key={g.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-zinc-900">{g.grn_number}</td>
                      <td className="px-6 py-4 text-sm text-zinc-600">{g.supplier_name}</td>
                      <td className="px-6 py-4 text-sm text-zinc-500">{new Date(g.receivedAt).toLocaleDateString()}</td>
                      <td className="px-6 py-4 text-sm text-zinc-600 text-right">UGX {g.total_value_ugx.toLocaleString()}</td>
                      <td className="px-6 py-4 font-bold text-zinc-900 text-right">UGX {(g.whtAmount || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                  {grns.filter(g => (g.whtAmount || 0) > 0).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">No WHT records found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

const PettyCashManagement: React.FC = () => {
  const { profile } = useAuth();
  const [ledger, setLedger] = useState<PettyCashLedger[]>([]);
  const [requisitions, setRequisitions] = useState<PettyCashRequisition[]>([]);
  const [issues, setIssues] = useState<PettyCashIssue[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'incoming' | 'outgoing'>('incoming');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<PettyCashIssue | null>(null);
  const [dateRange, setDateRange] = useState({ 
    start: new Date().toISOString().split('T')[0], 
    end: new Date().toISOString().split('T')[0] 
  });

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<PettyCashLedger>('petty_cash_ledger', profile.tenantId, (data) => {
        setLedger(data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      });
      firestoreService.subscribeToCollection<PettyCashRequisition>('petty_cash_requisitions', profile.tenantId, (data) => {
        setRequisitions(data.sort((a, b) => new Date(b.requisition_date).getTime() - new Date(a.requisition_date).getTime()));
      });
      firestoreService.subscribeToCollection<PettyCashIssue>('petty_cash_issues', profile.tenantId, (data) => {
        setIssues(data.sort((a, b) => new Date(b.issue_date).getTime() - new Date(a.issue_date).getTime()));
      });
      firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, setBranches);
    }
  }, [profile?.tenantId]);

  const filteredLedger = ledger.filter(entry => {
    const entryDate = entry.date.split('T')[0];
    const matchesStart = !dateRange.start || entryDate >= dateRange.start;
    const matchesEnd = !dateRange.end || entryDate <= dateRange.end;
    return matchesStart && matchesEnd;
  });

  const balance = ledger.reduce((acc, curr) => {
    return curr.type === 'incoming' ? acc + curr.amount : acc - curr.amount;
  }, 0);

  const handleApproveFinance = async (reqId: string) => {
    try {
      await firestoreService.updateDocument('petty_cash_requisitions', reqId, { 
        status: 'finance_approved',
        finance_approval_by: profile?.uid,
        finance_approval_at: new Date().toISOString()
      });
      toast.success('Finance approved');
    } catch (error) {
      toast.error('Approval failed');
    }
  };

  const handleApproveCEO = async (reqId: string) => {
    try {
      await firestoreService.updateDocument('petty_cash_requisitions', reqId, { 
        status: 'approved', // Both approved
        ceo_approval_by: profile?.uid,
        ceo_approval_at: new Date().toISOString()
      });

      // Auto-generate issue form (PettyCashIssue)
      const req = requisitions.find(r => r.id === reqId);
      if (req) {
        await firestoreService.addDocument('petty_cash_issues', {
          tenantId: profile!.tenantId,
          requisition_id: req.id,
          branch_id: req.branch_id,
          branch_name: req.branch_name,
          amount: req.amount_requested,
          issue_date: new Date().toISOString().split('T')[0],
          reference_number: `ISS-${Date.now().toString().slice(-6)}`,
          status: 'pending',
          issued_by: '',
          issued_at: '',
          created_at: new Date().toISOString()
        });
      }

      toast.success('CEO approved and Issue Form generated');
    } catch (error) {
      toast.error('Approval failed');
    }
  };

  const handleReject = async (reqId: string) => {
    try {
      await firestoreService.updateDocument('petty_cash_requisitions', reqId, { status: 'rejected' });
      toast.success('Requisition rejected');
    } catch (error) {
      toast.error('Rejection failed');
    }
  };

  const handleCompleteIssue = async (issue: PettyCashIssue) => {
    if (balance < issue.amount) {
      toast.error('Insufficient petty cash balance');
      return;
    }

    try {
      // 1. Log in Petty Cash Ledger (Outgoing)
      await firestoreService.addDocument('petty_cash_ledger', {
        tenantId: profile!.tenantId,
        date: new Date().toISOString().split('T')[0],
        amount: issue.amount,
        source: 'Petty Cash Reserve',
        reference_number: issue.reference_number,
        type: 'outgoing',
        branch_id: issue.branch_id,
        logged_by: profile!.uid,
        created_at: new Date().toISOString()
      });

      // 2. Update Issue Status
      await firestoreService.updateDocument('petty_cash_issues', issue.id, {
        status: 'completed',
        issued_by: profile?.uid,
        issued_at: new Date().toISOString()
      });

      // 3. Update Requisition Status
      if (issue.requisition_id) {
        await firestoreService.updateDocument('petty_cash_requisitions', issue.requisition_id, {
          status: 'issued'
        });
      }

      toast.success('Petty cash issued successfully');
      setSelectedIssue(null);
    } catch (error) {
      toast.error('Issuance failed');
    }
  };

  const handleDisburse = async (req: PettyCashRequisition) => {
    if (balance < req.amount_requested) {
      toast.error('Insufficient petty cash balance');
      return;
    }

    try {
      await firestoreService.addDocument('petty_cash_ledger', {
        tenantId: profile!.tenantId,
        date: new Date().toISOString().split('T')[0],
        amount: req.amount_requested,
        source: 'Petty Cash Reserve',
        reference_number: `REQ-${req.id.slice(-6)}`,
        type: 'outgoing',
        branch_id: req.branch_id,
        logged_by: profile!.uid,
        created_at: new Date().toISOString()
      });

      await firestoreService.updateDocument('petty_cash_requisitions', req.id, { status: 'disbursed' });
      toast.success('Cash disbursed successfully');
    } catch (error) {
      toast.error('Disbursement failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900 p-6 rounded-3xl text-white shadow-xl shadow-zinc-900/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Wallet size={80} />
          </div>
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">Petty Cash Balance</p>
          <h3 className="text-3xl font-black">UGX {(balance || 0).toLocaleString()}</h3>
          <div className="flex gap-2 mt-4">
            <button 
              onClick={() => { setModalType('incoming'); setIsModalOpen(true); }}
              className="flex-1 bg-white/10 hover:bg-white/20 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
            >
              <Plus size={14} /> Log Inflow
            </button>
            <button 
              onClick={() => { setModalType('outgoing'); setIsModalOpen(true); }}
              className="flex-1 bg-white/10 hover:bg-white/20 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
            >
              <Truck size={14} /> Issue Cash
            </button>
          </div>
        </div>

        <div className="md:col-span-2 bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="font-bold text-zinc-900 mb-4 flex items-center gap-2">
            <Clock size={20} className="text-amber-500" />
            Pending Requisitions
          </h3>
          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
            {requisitions.filter(r => r.status !== 'issued' && r.status !== 'received' && r.status !== 'rejected').map((req) => (
              <div key={req.id} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                <div>
                  <p className="font-bold text-zinc-900">{req.branch_name}</p>
                  <p className="text-xs text-zinc-500">UGX {(req.amount_requested || 0).toLocaleString()} • {req.reason}</p>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mt-1">Status: {req.status.replace('_', ' ')}</p>
                </div>
                <div className="flex gap-2">
                  {req.status === 'pending' && (profile?.role === 'Finance Head' || profile?.role === 'owner' || profile?.role === 'admin') && (
                    <>
                      <button 
                        onClick={() => handleApproveFinance(req.id)}
                        className="px-3 py-1 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-amber-200 transition-colors"
                      >
                        Finance Appr.
                      </button>
                      <button 
                        onClick={() => handleReject(req.id)}
                        className="px-3 py-1 bg-red-50 text-red-600 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-red-100 transition-colors"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {req.status === 'finance_approved' && (
                    ['CEO', 'CEO / MD', 'owner', 'admin'].includes(profile?.role || '') ||
                    (profile?.secondaryRoles || []).some(r => ['CEO', 'CEO / MD', 'owner', 'admin'].includes(r))
                  ) && (
                    <>
                      <button 
                        onClick={() => handleApproveCEO(req.id)}
                        className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-blue-200 transition-colors"
                      >
                        CEO Appr.
                      </button>
                      <button 
                        onClick={() => handleReject(req.id)}
                        className="px-3 py-1 bg-red-50 text-red-600 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-red-100 transition-colors"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {req.status === 'approved' && (
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                      Ready to Issue
                    </span>
                  )}
                </div>
              </div>
            ))}
            {requisitions.filter(r => r.status !== 'issued' && r.status !== 'received' && r.status !== 'rejected').length === 0 && (
              <p className="text-center py-8 text-zinc-400 italic text-sm">No pending requisitions</p>
            )}
          </div>
        </div>
      </div>

      {/* Petty Cash Issue Log Section */}
      <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
          <h3 className="font-bold text-zinc-900 flex items-center gap-2">
            <Truck size={20} className="text-blue-500" />
            Petty Cash Issue Log (Pending Completion)
          </h3>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {issues.filter(i => i.status === 'pending').map((issue) => (
            <div key={issue.id} className="p-5 bg-zinc-50 rounded-2xl border border-zinc-200 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Branch</p>
                  <p className="font-bold text-zinc-900">{issue.branch_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Amount</p>
                  <p className="font-bold text-emerald-600">UGX {issue.amount.toLocaleString()}</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Reference</p>
                <p className="text-xs font-mono text-zinc-600">{issue.reference_number}</p>
              </div>
              <button 
                onClick={() => handleCompleteIssue(issue)}
                className="w-full py-2 bg-zinc-900 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/20"
              >
                Complete Issue
              </button>
            </div>
          ))}
          {issues.filter(i => i.status === 'pending').length === 0 && (
            <div className="col-span-full text-center py-12 text-zinc-400 italic text-sm">
              No pending issues to complete
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-zinc-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="font-bold text-zinc-900">Petty Cash Ledger</h3>
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-zinc-200 text-xs">
            <span className="font-bold text-zinc-400 px-1 uppercase tracking-widest">Date:</span>
            <input 
              type="date" 
              value={dateRange.start} 
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="px-2 py-1 bg-zinc-50 border border-zinc-100 rounded-lg outline-none font-bold text-zinc-700"
            />
            <span className="text-zinc-400">to</span>
            <input 
              type="date" 
              value={dateRange.end} 
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="px-2 py-1 bg-zinc-50 border border-zinc-100 rounded-lg outline-none font-bold text-zinc-700"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Reference</th>
                <th className="px-6 py-4">Source/Recipient</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredLedger.map((entry) => (
                <tr key={entry.id} className="hover:bg-zinc-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <p className="text-sm font-bold text-zinc-900">{new Date(entry.date).toLocaleDateString()}</p>
                    <p className="text-[10px] text-zinc-400">{new Date(entry.created_at).toLocaleTimeString()}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs text-zinc-500 bg-zinc-100 px-2 py-1 rounded-md">
                      {entry.reference_number}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-bold text-zinc-700">{entry.source}</p>
                    {entry.branch_id && (
                      <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">
                        {branches.find(b => b.id === entry.branch_id)?.name || entry.branch_id}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                      entry.type === 'incoming' ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                    )}>
                      {entry.type}
                    </span>
                  </td>
                  <td className={cn(
                    "px-6 py-4 text-right font-black",
                    entry.type === 'incoming' ? "text-emerald-500" : "text-amber-500"
                  )}>
                    {entry.type === 'incoming' ? '+' : '-'} {(entry.amount || 0).toLocaleString()}
                  </td>
                </tr>
              ))}
              {filteredLedger.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                    No petty cash ledger logs found for the selected date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <PettyCashModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          type={modalType}
          balance={balance}
          branches={branches}
        />
      )}
    </div>
  );
};

const PettyCashModal: React.FC<{ 
  isOpen: boolean, 
  onClose: () => void, 
  type: 'incoming' | 'outgoing',
  balance: number,
  branches: Branch[]
}> = ({ isOpen, onClose, type, balance, branches }) => {
  const { profile } = useAuth();
  const [sourceType, setSourceType] = useState<'bank' | 'manual'>('manual');
  const [formData, setFormData] = useState({
    amount: 0,
    source: '',
    reference_number: '',
    branch_id: '',
    notes: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    if (type === 'outgoing' && formData.amount > balance) {
      toast.error('Insufficient balance');
      return;
    }

    try {
      // 1. Add to petty_cash_ledger
      await firestoreService.addDocument('petty_cash_ledger', {
        tenantId: profile.tenantId,
        date: new Date().toISOString().split('T')[0],
        amount: formData.amount,
        source: type === 'incoming' ? (sourceType === 'bank' ? 'Bank Transfer' : formData.source) : 'Petty Cash Reserve',
        reference_number: formData.reference_number,
        type,
        branch_id: type === 'outgoing' ? formData.branch_id : undefined,
        logged_by: profile.uid,
        created_at: new Date().toISOString()
      });

      // 2. Trigger bank transfer if selected sourceType is bank
      if (type === 'incoming' && sourceType === 'bank') {
        await firestoreService.addDocument('cashTransfers', {
          tenantId: profile.tenantId,
          fromPortfolio: 'banked',
          toPortfolio: 'petty_cash',
          amount: formData.amount,
          processedBy: profile.fullName || profile.email || 'Authorized Finance',
          processedAt: new Date().toISOString()
        });
        toast.info('Bank portfolio balance updated for this transfer.');
      }

      toast.success(type === 'incoming' ? 'Inflow logged successfully' : 'Issuance logged successfully');
      onClose();
    } catch (error) {
      console.error(error);
      toast.error('Failed to log transaction');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            {type === 'incoming' ? 'Log Cash Inflow' : 'Issue Petty Cash'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Amount (UGX)</label>
              <input 
                type="number"
                required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                value={formData.amount || ''}
                onChange={(e) => setFormData({...formData, amount: parseInt(e.target.value) || 0})}
              />
            </div>

            {type === 'incoming' && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Inflow Source Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSourceType('manual');
                      setFormData(prev => ({ ...prev, source: '' }));
                    }}
                    className={cn(
                      "py-2 px-3 text-xs font-bold rounded-xl border transition-all",
                      sourceType === 'manual'
                        ? "bg-zinc-900 border-zinc-900 text-white"
                        : "bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                    )}
                  >
                    Custom Cash Source
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSourceType('bank');
                      setFormData(prev => ({ ...prev, source: 'Bank Transfer' }));
                    }}
                    className={cn(
                      "py-2 px-3 text-xs font-bold rounded-xl border transition-all",
                      sourceType === 'bank'
                        ? "bg-zinc-900 border-zinc-900 text-white"
                        : "bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                    )}
                  >
                    Bank Portfolio
                  </button>
                </div>
              </div>
            )}

            {type === 'incoming' ? (
              sourceType === 'manual' && (
                <div className="space-y-1 animate-in slide-in-from-top-1 duration-150">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Source Name</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. CEO, Shareholder Injection"
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    value={formData.source}
                    onChange={(e) => setFormData({...formData, source: e.target.value})}
                  />
                </div>
              )
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Recipient Branch</label>
                <select 
                  required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                  value={formData.branch_id}
                  onChange={(e) => setFormData({...formData, branch_id: e.target.value})}
                >
                  <option value="">Select Branch</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Reference Number</label>
              <input 
                type="text"
                required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                value={formData.reference_number}
                onChange={(e) => setFormData({...formData, reference_number: e.target.value})}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button 
                type="button"
                onClick={onClose}
                className="flex-1 py-3 text-zinc-500 font-bold hover:bg-zinc-50 rounded-2xl transition-all"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className={cn(
                  "flex-1 py-3 text-white rounded-2xl font-bold transition-all shadow-lg",
                  type === 'incoming' ? "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20" : "bg-amber-500 hover:bg-amber-600 shadow-amber-500/20"
                )}
              >
                Log {type === 'incoming' ? 'Inflow' : 'Issuance'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

const InvoicesTab: React.FC = () => {
  const { profile } = useAuth();
  const [invoices, setInvoices] = useState<CreditReceivable[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<CreditReceivable | null>(null);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<CreditReceivable>('credit_receivables', profile.tenantId, setInvoices);
    }
  }, [profile?.tenantId]);

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this invoice?')) {
      try {
        await firestoreService.deleteDocument('credit_receivables', id);
        toast.success('Invoice deleted');
      } catch (error) {
        toast.error('Failed to delete invoice');
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-zinc-900">Client & Institutional Invoices</h3>
        <button 
          onClick={() => {
            setEditingInvoice(null);
            setIsModalOpen(true);
          }}
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={20} />
          Create Invoice
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
              <th className="px-6 py-4">Client</th>
              <th className="px-6 py-4">Amount</th>
              <th className="px-6 py-4">Due Date</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="hover:bg-zinc-50/50 transition-colors">
                <td className="px-6 py-4">
                  <p className="text-sm font-bold text-zinc-900">{invoice.client_name}</p>
                </td>
                <td className="px-6 py-4 font-bold text-zinc-900">UGX {(invoice.amount_ugx || 0).toLocaleString()}</td>
                <td className="px-6 py-4 text-sm text-zinc-500">{new Date(invoice.due_date).toLocaleDateString()}</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                    invoice.status === 'Paid' ? "bg-emerald-50 text-emerald-600" : 
                    invoice.status === 'Overdue' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                  )}>
                    {invoice.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => {
                        setEditingInvoice(invoice);
                        setIsModalOpen(true);
                      }}
                      className="p-2 text-zinc-400 hover:text-emerald-500 transition-colors"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button 
                      onClick={() => handleDelete(invoice.id)}
                      className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                  No invoices found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <InvoiceModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          invoice={editingInvoice}
        />
      )}
    </div>
  );
};

const InvoiceModal: React.FC<{ isOpen: boolean, onClose: () => void, invoice: CreditReceivable | null }> = ({ isOpen, onClose, invoice }) => {
  const { profile, activeBranchId } = useAuth();
  const [formData, setFormData] = useState({
    client_name: invoice?.client_name || '',
    amount_ugx: invoice?.amount_ugx || 0,
    due_date: invoice?.due_date || new Date().toISOString().split('T')[0],
    status: invoice?.status || 'Pending'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    try {
      if (invoice) {
        await firestoreService.updateDocument('credit_receivables', invoice.id, formData);
        toast.success('Invoice updated');
      } else {
        await firestoreService.addDocument('credit_receivables', {
          ...formData,
          tenantId: profile.tenantId,
          branch_id: activeBranchId || 'main',
          client_id: 'manual_' + Date.now(),
          invoice_number: 'INV-' + Date.now().toString().slice(-6),
          created_at: new Date().toISOString()
        });
        toast.success('Invoice created');
      }
      onClose();
    } catch (error) {
      toast.error('Failed to save invoice');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">{invoice ? 'Edit Invoice' : 'Create New Invoice'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Client Name</label>
              <input 
                type="text"
                required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                value={formData.client_name}
                onChange={(e) => setFormData({...formData, client_name: e.target.value})}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Amount (UGX)</label>
              <input 
                type="number"
                required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                value={formData.amount_ugx || ''}
                onChange={(e) => setFormData({...formData, amount_ugx: parseInt(e.target.value) || 0})}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Due Date</label>
              <input 
                type="date"
                required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                value={formData.due_date}
                onChange={(e) => setFormData({...formData, due_date: e.target.value})}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Status</label>
              <select 
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 outline-none"
                value={formData.status}
                onChange={(e) => setFormData({...formData, status: e.target.value as any})}
              >
                <option value="Pending">Pending</option>
                <option value="Paid">Paid</option>
                <option value="Overdue">Overdue</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4">
              <button 
                type="button"
                onClick={onClose}
                className="flex-1 py-3 text-zinc-500 font-bold hover:bg-zinc-50 rounded-2xl transition-all"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="flex-1 py-3 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/20"
              >
                {invoice ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

const CashBankingOversight: React.FC = () => {
  return <NewCashAndBanking />;
};

const LegacyCashBankingOversight: React.FC = () => {
  const { profile } = useAuth();
  const [reconciliations, setReconciliations] = useState<any[]>([]);
  const [pettyCashLedger, setPettyCashLedger] = useState<any[]>([]);
  const [managementExpenses, setManagementExpenses] = useState<any[]>([]);
  const [procurementInvoices, setProcurementInvoices] = useState<any[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [bankingFormOpen, setBankingFormOpen] = useState(false);
  const [bankingLogs, setBankingLogs] = useState<any[]>([]);
  const [oversightTab, setOversightTab] = useState<'physical_cash' | 'bank_transfers'>('physical_cash');
  
  const [formData, setFormData] = useState({
    amount: '',
    type: 'deposit' as 'deposit' | 'withdrawal',
    source_channel: 'Bank Transfer',
    reference: '',
    recipient: '',
    notes: ''
  });

  // Date Range Auditor Filter (default shows Today's ledger requests)
  const [isDateFilterActive, setIsDateFilterActive] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubRecs = firestoreService.subscribeToCollection('eod_reconciliations', profile.tenantId, setReconciliations);
      const unsubPc = firestoreService.subscribeToCollection('petty_cash_ledger', profile.tenantId, setPettyCashLedger);
      const unsubMe = firestoreService.subscribeToCollection('management_expenses', profile.tenantId, setManagementExpenses);
      const unsubInvs = firestoreService.subscribeToCollection('procurement_invoices', profile.tenantId, setProcurementInvoices);
      const unsubBranches = firestoreService.subscribeToCollection('branches', profile.tenantId, setBranches);
      const unsubBLogs = firestoreService.subscribeToCollection('banking_transactions', profile.tenantId, setBankingLogs);

      return () => {
        unsubRecs();
        unsubPc();
        unsubMe();
        unsubInvs();
        unsubBranches();
        unsubBLogs();
      };
    }
  }, [profile?.tenantId]);

  // Handle manual deposit/withdrawal logging
  const handleBankingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      await firestoreService.addDocument('banking_transactions', {
        tenantId: profile.tenantId,
        amount: parseFloat(formData.amount) || 0,
        type: formData.type,
        source_channel: formData.source_channel,
        reference: formData.reference || 'REF-' + Date.now().toString().slice(-6),
        recipient: formData.recipient || 'Main Bank',
        notes: formData.notes,
        date: new Date().toISOString(),
        created_by_name: profile.full_name || 'System Auditor'
      });
      toast.success('HQ banking transaction successfully logged!');
      setFormData({ amount: '', type: 'deposit', source_channel: 'Bank Transfer', reference: '', recipient: '', notes: '' });
      setBankingFormOpen(false);
    } catch {
      toast.error('Failed to log transaction');
    }
  };

  // Filter items globally based on Date Range
  const filteredRecs = reconciliations.filter(r => {
    if (!isDateFilterActive) return true;
    const d = (r.reconciliation_date || '').split('T')[0];
    return d >= dateRange.start && d <= dateRange.end;
  });

  const filteredPcLedger = pettyCashLedger.filter(entry => {
    if (!isDateFilterActive) return true;
    const d = (entry.date || '').split('T')[0];
    return d >= dateRange.start && d <= dateRange.end;
  });

  const filteredBLogs = bankingLogs.filter(b => {
    if (!isDateFilterActive) return true;
    const d = (b.date || b.created_at || '').split('T')[0];
    return d >= dateRange.start && d <= dateRange.end;
  });

  // Calculations based on the dynamic data
  // Unbanked cash is cash actual from reconciliations where status is verified but is_banked is false (needs banking transfer)
  const unbankedCash = filteredRecs
    .filter(r => r.status === 'Verified' && !r.is_banked)
    .reduce((sum, r) => sum + (r.cash_actual || 0), 0);

  // Bank Balance formula: Base Stanbic/Centenary balance + Verified banked cash sale EODs + logged manual deposits - manual bank withdrawals/expenses
  const baselineReserves = 0; // Set to 0 to show precise test run transactions
  const verifiedBankedEODAmount = filteredRecs
    .filter(r => r.status === 'Verified' && r.is_banked)
    .reduce((sum, r) => sum + (r.banked_amount || r.cash_actual || 0), 0);

  const manualDeposits = filteredBLogs
    .filter(b => b.type === 'deposit')
    .reduce((sum, b) => sum + b.amount, 0);

  const manualWithdrawals = filteredBLogs
    .filter(b => b.type === 'withdrawal')
    .reduce((sum, b) => sum + b.amount, 0);

  // Corporate bank balance
  const bankBalance = baselineReserves + verifiedBankedEODAmount + manualDeposits - manualWithdrawals;

  // Mobile money assets (filtered momo + airtel from EOD)
  const momoBalance = filteredRecs
    .filter(r => r.status === 'Verified')
    .reduce((sum, r) => sum + (r.momo_actual || r.momo_expected || 0) + (r.airtel_actual || r.airtel_expected || 0), 0);

  // Dynamic system calculated HQ Petty Cash available balance
  // Replenishments logged as incoming cash vs expenses paid via petty/hand cash
  const availableHQPettyCash = filteredPcLedger.reduce((acc, curr) => {
    return curr.type === 'incoming' ? acc + (curr.amount || 0) : acc - (curr.amount || 0);
  }, 0); // Set starting float fallback to 0 for exact test run values

  // Institutional Credit totals logged at EOD (verified)
  const institutionalCreditTotal = filteredRecs
    .filter(r => r.status === 'Verified')
    .reduce((sum, r) => sum + (r.institutional_credit_actual || 0), 0);

  // Staff Welfare totals logged at EOD (verified)
  const staffWelfareTotal = filteredRecs
    .filter(r => r.status === 'Verified')
    .reduce((sum, r) => sum + (r.staff_welfare_actual || 0), 0);

  return (
    <div className="space-y-6">
      {/* GLOBAL DATE FILTER BAR FOR CASH & BANKING REPORTS */}
      <div className="bg-zinc-50 border border-zinc-200 p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div>
          <h4 className="font-extrabold text-zinc-950 text-sm">Cash, EOD & Banking Oversight</h4>
          <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mt-0.5">Real-time Bank Position & Consolidated Funds</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button 
            onClick={() => setBankingFormOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 duration-150 hover:bg-zinc-850 text-white rounded-xl text-xs font-bold uppercase tracking-wider"
          >
            <DollarSign size={14} /> Log Banking Transaction
          </button>
          
          <div className="h-4 w-px bg-zinc-200" />

          <label className="flex items-center gap-2 text-xs font-bold text-zinc-750 cursor-pointer">
            <input 
              type="checkbox" 
              checked={isDateFilterActive} 
              onChange={(e) => setIsDateFilterActive(e.target.checked)}
              className="rounded bg-white border-zinc-200 text-zinc-950 focus:ring-0"
            />
            Filter Ledger Date
          </label>
          {isDateFilterActive && (
            <div className="flex items-center gap-2">
              <input 
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                className="bg-white border border-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-xl outline-none"
              />
              <span className="text-zinc-400 text-xs">-</span>
              <input 
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                className="bg-white border border-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-xl outline-none"
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm relative overflow-hidden">
          <p className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded w-fit uppercase tracking-widest mb-2">HQ Petty Funds</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Available Petty Cash</p>
          <h3 className="text-xl font-black text-zinc-900">UGX {availableHQPettyCash.toLocaleString()}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">HQ invoice & operation expense</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm relative overflow-hidden">
          <p className="text-[10px] font-black text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded w-fit uppercase tracking-widest mb-2">Stanbic/Centenary</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Corporate Bank Balance</p>
          <h3 className="text-xl font-black text-zinc-900">UGX {bankBalance.toLocaleString()}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Reflects certified EOD Bankings</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm relative overflow-hidden">
          <p className="text-[10px] font-black text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded w-fit uppercase tracking-widest mb-2">MTN/Airtel</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Mobile Money Float</p>
          <h3 className="text-xl font-black text-zinc-900">UGX {momoBalance.toLocaleString()}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">EOD Mobile Collections</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm relative overflow-hidden">
          <p className="text-[10px] font-black text-red-650 bg-red-50 px-2.5 py-0.5 rounded w-fit uppercase tracking-widest mb-2">Action Required</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Unbanked EOD Cash</p>
          <h3 className="text-xl font-black text-red-650">UGX {unbankedCash.toLocaleString()}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Verified cash sales awaiting deposits</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm relative overflow-hidden">
          <p className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded w-fit uppercase tracking-widest mb-2">EOD Credit</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Institutional Credit</p>
          <h3 className="text-xl font-black text-zinc-900">UGX {institutionalCreditTotal.toLocaleString()}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Verified EOD credit sales total</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm relative overflow-hidden">
          <p className="text-[10px] font-black text-violet-600 bg-violet-50 px-2.5 py-0.5 rounded w-fit uppercase tracking-widest mb-2">EOD Welfare</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Staff Welfare Total</p>
          <h3 className="text-xl font-black text-zinc-900">UGX {staffWelfareTotal.toLocaleString()}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Verified EOD staff deductions</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm p-6 lg:col-span-1">
          <h3 className="font-extrabold text-zinc-900 text-sm mb-4">Branch Cash Distribution</h3>
          <div className="space-y-4">
            {branches.map((b) => {
              const branchRecs = filteredRecs.filter(r => r.branch_id === b.id && r.status === 'Verified');
              const localCash = branchRecs.filter(r => !r.is_banked).reduce((sum, r) => sum + (r.cash_actual || 0), 0);
              const localBanked = branchRecs.filter(r => r.is_banked).reduce((sum, r) => sum + (r.banked_amount || r.cash_actual || 0), 0);
              return (
                <div key={b.id} className="p-4 bg-zinc-50 rounded-2xl border border-zinc-150 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-sm text-zinc-900">{b.name}</p>
                    <p className="text-[10px] text-zinc-400 font-mono">CODE: {b.code}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-extrabold text-sm text-zinc-900">UGX {(localCash + localBanked).toLocaleString()}</p>
                    <p className="text-[9px] text-zinc-500">Unbanked: {localCash.toLocaleString()} | Banked: {localBanked.toLocaleString()}</p>
                  </div>
                </div>
              );
            })}
            {branches.length === 0 && (
              <div className="text-center py-6 text-zinc-400 text-xs italic">No active branch coordinates declared.</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm p-6 lg:col-span-2 space-y-4">
          <div className="flex border-b border-zinc-200 gap-4">
            <button
              onClick={() => setOversightTab('physical_cash')}
              className={cn(
                "pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2",
                oversightTab === 'physical_cash' ? "border-emerald-500 text-emerald-600" : "border-transparent text-zinc-400 hover:text-zinc-600"
              )}
            >
              Physical Cash Ledger (Counter)
            </button>
            <button
              onClick={() => setOversightTab('bank_transfers')}
              className={cn(
                "pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2",
                oversightTab === 'bank_transfers' ? "border-emerald-500 text-emerald-600" : "border-transparent text-zinc-400 hover:text-zinc-600"
              )}
            >
              Bank Wire & Digital Books
            </button>
          </div>

          <div>
            {oversightTab === 'physical_cash' ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-zinc-500 uppercase tracking-wider">Physical Cash Journal Entries</span>
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-600 rounded font-bold text-[10px] uppercase">Cash Counter Transactions Only</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-black text-zinc-400 uppercase tracking-wider border-b border-zinc-100 pb-3">
                        <th className="pb-3">Reference & Date</th>
                        <th className="pb-3">Cash Point / Payee</th>
                        <th className="pb-3 text-right">Amount</th>
                        <th className="pb-3 text-right">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredBLogs
                        .filter(log => log.source_channel === 'Cash Counter' || !log.source_channel || log.source_channel === 'Cash')
                        .map((log) => (
                          <tr key={log.id} className="text-xs hover:bg-zinc-50/50 transition-colors">
                            <td className="py-3">
                              <p className="font-bold text-zinc-900">{log.reference}</p>
                              <p className="text-[10px] text-zinc-400 font-mono">{log.date ? new Date(log.date).toLocaleDateString() : 'Today'}</p>
                            </td>
                            <td className="py-3 text-zinc-650 font-medium">{log.recipient || 'Main Vault / Register'}</td>
                            <td className="py-3 text-right font-bold text-zinc-900">UGX {(log.amount || 0).toLocaleString()}</td>
                            <td className="py-3 text-right">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                log.type === 'deposit' ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                              )}>
                                {log.type}
                              </span>
                            </td>
                          </tr>
                        ))}
                      {filteredBLogs.filter(log => log.source_channel === 'Cash Counter' || !log.source_channel || log.source_channel === 'Cash').length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-zinc-400 italic text-xs">No physical cash counter journal entries match this filter range.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-zinc-500 uppercase tracking-wider">Bank Wire & Digital Books Positions</span>
                  <span className="px-2 py-0.5 bg-zinc-100 text-zinc-700 rounded font-bold text-[10px] uppercase">EFT, MM & Wire Settlements</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-black text-zinc-400 uppercase tracking-wider border-b border-zinc-100 pb-3">
                        <th className="pb-3">Reference & Date</th>
                        <th className="pb-3">Settlement Route</th>
                        <th className="pb-3 text-right">Amount</th>
                        <th className="pb-3 text-right">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredBLogs
                        .filter(log => log.source_channel && log.source_channel !== 'Cash Counter' && log.source_channel !== 'Cash')
                        .map((log) => (
                          <tr key={log.id} className="text-xs hover:bg-zinc-50/50 transition-colors">
                            <td className="py-3">
                              <p className="font-bold text-zinc-900">{log.reference}</p>
                              <p className="text-[10px] text-zinc-400 font-mono">{log.date ? new Date(log.date).toLocaleDateString() : 'Today'}</p>
                            </td>
                            <td className="py-3 text-zinc-650 font-medium">{log.source_channel} ({log.recipient || 'Main Bank Account'})</td>
                            <td className="py-3 text-right font-bold text-zinc-900">UGX {(log.amount || 0).toLocaleString()}</td>
                            <td className="py-3 text-right">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                log.type === 'deposit' ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                              )}>
                                {log.type}
                              </span>
                            </td>
                          </tr>
                        ))}
                      {filteredBLogs.filter(log => log.source_channel && log.source_channel !== 'Cash Counter' && log.source_channel !== 'Cash').length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-zinc-400 italic text-xs">No bank transfer wire records logged for this selected duration.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MANUAL BANKING MODAL */}
      {bankingFormOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-8">
              <h2 className="text-2xl font-black text-zinc-900 mb-2">Log HQ Cash/Bank Trans</h2>
              <p className="text-xs text-zinc-500 mb-6 font-medium">Record external corporate bank deposits, withdrawals, or interest logs.</p>
              
              <form onSubmit={handleBankingSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Transaction Type</label>
                  <select 
                    value={formData.type}
                    onChange={(e) => setFormData({...formData, type: e.target.value as any})}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                  >
                    <option value="deposit">Deposit (Inflow To Bank)</option>
                    <option value="withdrawal">Withdrawal (Outflow From Bank)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Amount (UGX)</label>
                  <input 
                    type="number" required placeholder="e.g. 1500000"
                    value={formData.amount}
                    onChange={(e) => setFormData({...formData, amount: e.target.value})}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Method</label>
                    <select 
                      value={formData.source_channel}
                      onChange={(e) => setFormData({...formData, source_channel: e.target.value})}
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                    >
                      <option value="Bank Transfer">Bank Wire</option>
                      <option value="Cheque">Cheque Deposit</option>
                      <option value="Mobile Money Transfer">Mobile Money</option>
                      <option value="Cash Counter">Cash Counter</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Reference Code</label>
                    <input 
                      type="text" placeholder="TX-18402"
                      value={formData.reference}
                      onChange={(e) => setFormData({...formData, reference: e.target.value})}
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Recipient / Payee</label>
                  <input 
                    type="text" placeholder="e.g. Stanbic HQ Kampala"
                    value={formData.recipient}
                    onChange={(e) => setFormData({...formData, recipient: e.target.value})}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Auditor Notes</label>
                  <textarea 
                    value={formData.notes} placeholder="Mandated description of corporate funds transfer..."
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none min-h-[60px]"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button" onClick={() => setBankingFormOpen(false)}
                    className="flex-1 py-3 text-zinc-500 font-bold hover:bg-zinc-100 rounded-2xl"
                  >
                    Dismiss
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 bg-zinc-900 hover:bg-zinc-800 text-white font-bold rounded-2xl"
                  >
                    Confirm Log
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ReconciliationInbox: React.FC = () => {
  return <NewEodReconciliationBox />;
};

const LegacyReconciliationInbox: React.FC = () => {
  const { profile } = useAuth();
  const isFinanceHead = profile?.role === 'Finance Head';
  const [reconciliations, setReconciliations] = useState<EODReconciliation[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [editingRec, setEditingRec] = useState<EODReconciliation | null>(null);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<EODReconciliation>('eod_reconciliations', profile.tenantId, setReconciliations);
      firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, setBranches);
    }
  }, [profile?.tenantId]);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
            <th className="px-6 py-4">Date</th>
            <th className="px-6 py-4">Branch</th>
            <th className="px-6 py-4">Declared</th>
            <th className="px-6 py-4">Expected</th>
            <th className="px-6 py-4">Variance</th>
            <th className="px-6 py-4">Status</th>
            <th className="px-6 py-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {reconciliations.map((rec) => {
            const declaredTotal = 
              (rec.cash_actual || 0) + 
              (rec.momo_actual || 0) + 
              (rec.airtel_actual || 0) + 
              (rec.card_actual || 0) +
              (rec.insurance_actual || 0) +
              (rec.institutional_credit_actual || 0) +
              (rec.staff_welfare_actual || 0);

            const expectedTotal = 
              (rec.cash_expected || 0) + 
              (rec.momo_expected || 0) + 
              (rec.airtel_expected || 0) + 
              (rec.card_expected || 0) +
              (rec.insurance_expected || 0) +
              (rec.institutional_credit_expected || 0) +
              (rec.staff_welfare_expected || 0);

            const variance = declaredTotal - expectedTotal;
            
            return (
              <tr key={rec.id} className="hover:bg-zinc-50/50 transition-colors">
                <td className="px-6 py-4">
                  <p className="text-sm text-zinc-600">{new Date(rec.reconciliation_date).toLocaleDateString()}</p>
                  {(rec as any).updated_by_name && (
                    <p className="text-[10px] text-zinc-400 font-medium">Updated by: {(rec as any).updated_by_name}</p>
                  )}
                </td>
                <td className="px-6 py-4 text-sm font-bold text-zinc-900">
                  {branches.find(b => b.id === rec.branch_id)?.name || rec.branch_id}
                </td>
                <td className="px-6 py-4 text-sm text-zinc-600 font-mono">UGX {(declaredTotal || 0).toLocaleString()}</td>
                <td className="px-6 py-4 text-sm text-zinc-600 font-mono">UGX {(expectedTotal || 0).toLocaleString()}</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "font-bold font-mono text-sm",
                    variance === 0 ? "text-emerald-500" : "text-red-500"
                  )}>
                    {variance > 0 ? '+' : ''}{(variance || 0).toLocaleString()}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                    rec.status === 'Verified' ? "bg-emerald-50 text-emerald-600" : 
                    rec.status === 'Flagged' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                  )}>
                    {rec.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  {isFinanceHead && (
                    <button 
                      onClick={() => setEditingRec(rec)}
                      className="p-2 text-zinc-400 hover:text-zinc-900 transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {reconciliations.length === 0 && (
            <tr>
              <td colSpan={7} className="px-6 py-12 text-center text-zinc-400 italic">
                No reconciliations in inbox.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {editingRec && (
        <EditReconciliationModal 
          reconciliation={editingRec} 
          onClose={() => setEditingRec(null)} 
        />
      )}
    </div>
  );
};

const EditReconciliationModal: React.FC<{ reconciliation: EODReconciliation, onClose: () => void }> = ({ reconciliation, onClose }) => {
  const { profile } = useAuth();
  const [formData, setFormData] = useState({
    cash: reconciliation.cash_actual || 0,
    momo: reconciliation.momo_actual || 0,
    airtel: reconciliation.airtel_actual || 0,
    card: reconciliation.card_actual || 0,
    insurance: reconciliation.insurance_actual || 0,
    institutional_credit: reconciliation.institutional_credit_actual || 0,
    staff_welfare: reconciliation.staff_welfare_actual || 0,
    date: reconciliation.reconciliation_date,
    status: reconciliation.status,
    is_banked: (reconciliation as any).is_banked || false,
    banked_amount: (reconciliation as any).banked_amount || reconciliation.cash_actual || 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      const actualSum = 
        formData.cash + 
        formData.momo + 
        formData.airtel + 
        formData.card + 
        formData.insurance + 
        formData.institutional_credit + 
        formData.staff_welfare;
        
      const expSum = reconciliation.total_expected || (
        (reconciliation.cash_expected || 0) + 
        (reconciliation.momo_expected || 0) + 
        (reconciliation.airtel_expected || 0) + 
        (reconciliation.card_expected || 0) +
        (reconciliation.insurance_expected || 0) +
        (reconciliation.institutional_credit_expected || 0) +
        (reconciliation.staff_welfare_expected || 0)
      );

      await firestoreService.updateDocument('eod_reconciliations', reconciliation.id, {
        reconciliation_date: formData.date,
        
        cash_actual: formData.cash,
        cash_variance: formData.cash - (reconciliation.cash_expected || 0),
        
        momo_actual: formData.momo,
        momo_variance: formData.momo - (reconciliation.momo_expected || 0),
        
        airtel_actual: formData.airtel,
        airtel_variance: formData.airtel - (reconciliation.airtel_expected || 0),
        
        card_actual: formData.card,
        card_variance: formData.card - (reconciliation.card_expected || 0),

        insurance_actual: formData.insurance,
        insurance_variance: formData.insurance - (reconciliation.insurance_expected || 0),

        institutional_credit_actual: formData.institutional_credit,
        institutional_credit_variance: formData.institutional_credit - (reconciliation.institutional_credit_expected || 0),

        staff_welfare_actual: formData.staff_welfare,
        staff_welfare_variance: formData.staff_welfare - (reconciliation.staff_welfare_expected || 0),

        total_actual: actualSum,
        total_variance: actualSum - expSum,
        
        status: formData.status,
        is_banked: formData.is_banked,
        banked_amount: formData.banked_amount,
        updated_at: new Date().toISOString(),
        updated_by: profile.uid,
        updated_by_name: profile.full_name
      });
      
      // Log the update in audit trails
      await firestoreService.addDocument('audit_logs', {
        tenantId: profile.tenantId,
        userId: profile.uid,
        userName: profile.full_name || 'System',
        userRole: profile.role || 'Unknown',
        module: 'FINANCE',
        actionType: 'UPDATE',
        objectAffected: 'EOD_RECONCILIATION',
        objectId: reconciliation.id,
        timestamp: new Date().toISOString(),
        details: `EOD Reconciliation for ${reconciliation.reconciliation_date} updated by ${profile.full_name}`
      });

      toast.success('Reconciliation updated');
      onClose();
    } catch (error) {
      toast.error('Failed to update reconciliation');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[32px] w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
          <h2 className="text-2xl font-black text-zinc-900 mb-6">Review Reconciliation Audit</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Date</label>
              <input 
                type="date" required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none"
                value={formData.date}
                onChange={(e) => setFormData({...formData, date: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-1">Cash Actual</label>
                <input 
                  type="number" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-bold font-mono"
                  value={formData.cash}
                  onChange={(e) => setFormData({...formData, cash: parseInt(e.target.value) || 0})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">MTN MoMo Actual</label>
                <input 
                  type="number" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-bold font-mono"
                  value={formData.momo}
                  onChange={(e) => setFormData({...formData, momo: parseInt(e.target.value) || 0})}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Airtel Actual</label>
                <input 
                  type="number" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-bold font-mono"
                  value={formData.airtel}
                  onChange={(e) => setFormData({...formData, airtel: parseInt(e.target.value) || 0})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Card Actual</label>
                <input 
                  type="number" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-bold font-mono"
                  value={formData.card}
                  onChange={(e) => setFormData({...formData, card: parseInt(e.target.value) || 0})}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Insurance Actual</label>
                <input 
                  type="number" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-bold font-mono"
                  value={formData.insurance}
                  onChange={(e) => setFormData({...formData, insurance: parseInt(e.target.value) || 0})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase">Inst. Credit Actual</label>
                <input 
                  type="number" required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-bold font-mono"
                  value={formData.institutional_credit}
                  onChange={(e) => setFormData({...formData, institutional_credit: parseInt(e.target.value) || 0})}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Staff Welfare Actual</label>
              <input 
                type="number" required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-bold font-mono"
                value={formData.staff_welfare}
                onChange={(e) => setFormData({...formData, staff_welfare: parseInt(e.target.value) || 0})}
              />
            </div>

            {reconciliation.variance_reason && (
              <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                <p className="text-[10px] font-extrabold text-amber-800 uppercase tracking-wider mb-1">Discrepancy Justification Given:</p>
                <p className="text-xs text-amber-900 italic">"{reconciliation.variance_reason}"</p>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Status</label>
              <select 
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl outline-none font-bold"
                value={formData.status}
                onChange={(e) => setFormData({...formData, status: e.target.value as any})}
              >
                <option value="Pending">Pending</option>
                <option value="Verified">Verified</option>
                <option value="Flagged">Flagged</option>
              </select>
            </div>

            {/* BRANCH OPERATIONS DEPOSIT / BANKING FUNCTION TRACE */}
            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl space-y-3">
              <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded uppercase tracking-wider">EOD Banking Reconciliation</span>
              <label className="flex items-center gap-2 text-xs font-bold text-zinc-800 cursor-pointer">
                <input 
                  type="checkbox"
                  checked={formData.is_banked}
                  onChange={(e) => setFormData({...formData, is_banked: e.target.checked, banked_amount: e.target.checked ? formData.cash : 0})}
                  className="rounded text-zinc-900 focus:ring-0"
                />
                Mark as Deposited / Banked at EOD
              </label>

              {formData.is_banked && (
                <div className="space-y-1 animate-in slide-in-from-top-1 duration-150">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase">Banked Amount (UGX)</label>
                  <input 
                    type="number" required
                    className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl outline-none text-xs font-bold font-mono"
                    value={formData.banked_amount}
                    onChange={(e) => setFormData({...formData, banked_amount: parseInt(e.target.value) || 0})}
                  />
                  <p className="text-[9px] text-zinc-400">Specify exactly what was deposited at Stanbic/Centenary agent.</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-4 border-t border-zinc-100">
              <button 
                type="button" onClick={onClose}
                className="flex-1 px-6 py-3 border border-zinc-200 text-zinc-600 font-bold rounded-2xl hover:bg-zinc-50 transition-all text-sm"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="flex-1 px-6 py-3 bg-zinc-900 text-white font-bold rounded-2xl hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-900/20 text-sm"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

const CreditLedgerPanel: React.FC = () => {
  return <NewCreditLedger />;
};

const LegacyCreditLedgerPanel: React.FC = () => {
  const { profile, activeBranchId } = useAuth();
  const [activeTab, setActiveTab] = useState<'receivables' | 'payables'>('receivables');
  
  // Real data state
  const [receivables, setReceivables] = useState<CreditReceivable[]>([]);
  const [payables, setPayables] = useState<SupplierPayable[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  
  // Date selection states
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showAllDates, setShowAllDates] = useState<boolean>(false);

  // Modals
  const [recModalOpen, setRecModalOpen] = useState(false);
  const [editingRec, setEditingRec] = useState<CreditReceivable | null>(null);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [editingPay, setEditingPay] = useState<SupplierPayable | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Form states
  const [recForm, setRecForm] = useState({
    client_name: '',
    creditor_type: 'Client' as 'Client' | 'Institution',
    amount_ugx: 0,
    outstanding_ugx: 0,
    status: 'outstanding' as 'outstanding' | 'paid' | 'defaulted',
    due_date: new Date().toISOString().split('T')[0],
    notes: ''
  });

  const [payForm, setPayForm] = useState({
    supplier_name: '',
    amount_ugx: 0,
    outstanding_ugx: 0,
    status: 'pending' as 'pending' | 'paid',
    due_date: new Date().toISOString().split('T')[0],
    notes: ''
  });

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubRecs = firestoreService.subscribeToCollection<CreditReceivable>(
        'credit_receivables',
        profile.tenantId,
        setReceivables
      );
      const unsubPays = firestoreService.subscribeToCollection<SupplierPayable>(
        'supplier_payables',
        profile.tenantId,
        setPayables
      );
      const unsubSales = firestoreService.subscribeToCollection<Sale>(
        'sales',
        profile.tenantId,
        setSales
      );
      const unsubInvoices = firestoreService.subscribeToCollection<any>(
        'procurement_invoices',
        profile.tenantId,
        setInvoices
      );
      return () => {
        unsubRecs();
        unsubPays();
        unsubSales();
        unsubInvoices();
      };
    }
  }, [profile?.tenantId]);

  // Filter raw collections by the active branch to ensure per-branch segregation
  const branchFilteredManualRecs = receivables.filter(r => !activeBranchId || r.branch_id === activeBranchId);
  const branchFilteredManualPays = payables.filter(p => !activeBranchId || !p.branch_id || p.branch_id === activeBranchId);
  const branchFilteredSales = sales.filter(s => !activeBranchId || s.branchId === activeBranchId);
  const branchFilteredInvoices = invoices.filter(i => !activeBranchId || i.branch_id === activeBranchId);

  // Dynamically map Credit Sales from POS (Sales with method 'institutional_credit' or 'insurance')
  const dynamicReceivables: CreditReceivable[] = branchFilteredSales
    .filter(s => s.paymentMethod === 'institutional_credit' || s.paymentMethod === 'insurance')
    .map(s => ({
      id: 'pos_' + s.id,
      tenantId: s.tenantId,
      branch_id: s.branchId,
      client_name: s.institutionName || s.patientName || 'Walk-In Prescriptions',
      creditor_type: s.paymentMethod === 'institutional_credit' ? 'Institution' : 'Client',
      amount_ugx: s.total || s.totalAmount || 0,
      outstanding_ugx: s.total || s.totalAmount || 0,
      status: 'outstanding',
      due_date: new Date(new Date(s.timestamp).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      notes: `Receipt #: ${s.receiptNumber || s.id.slice(0, 8).toUpperCase()}`,
      created_at: s.timestamp
    }));

  // Dynamically map Credit Procurement Invoices from GRNs / Procurement (Invoices with status 'Credit')
  const dynamicPayables: SupplierPayable[] = branchFilteredInvoices
    .filter(i => i.status?.toLowerCase() === 'credit')
    .map(i => ({
      id: 'proc_' + i.id,
      tenantId: i.tenantId,
      branch_id: i.branch_id,
      supplier_name: i.supplier_name,
      amount_ugx: i.amount || i.total_amount_ugx || 0,
      outstanding_ugx: (i.amount || i.total_amount_ugx || 0) - (i.paid_amount_ugx || 0),
      status: 'pending',
      due_date: i.due_date,
      notes: `Invoice: ${i.invoice_number}, GRN: ${i.grn_number || 'N/A'}`,
      created_at: i.created_at || i.invoice_date || i.receivedAt
    }));

  // Combine manual logs and auto-recorded live entries
  const allReceivables = [...branchFilteredManualRecs, ...dynamicReceivables];
  const allPayables = [...branchFilteredManualPays, ...dynamicPayables];

  // Aggregate stats
  const totalReceivableOwed = allReceivables
    .filter(r => r.status !== 'paid')
    .reduce((sum, r) => sum + (r.outstanding_ugx ?? r.amount_ugx ?? 0), 0);

  const totalPayableOwed = allPayables
    .filter(p => p.status === 'pending')
    .reduce((sum, p) => sum + (p.outstanding_ugx ?? p.amount_ugx ?? 0), 0);

  // Handlers for Receivables
  const openAddRec = () => {
    setEditingRec(null);
    setRecForm({
      client_name: '',
      creditor_type: 'Client',
      amount_ugx: 0,
      outstanding_ugx: 0,
      status: 'outstanding',
      due_date: new Date().toISOString().split('T')[0],
      notes: ''
    });
    setRecModalOpen(true);
  };

  const openEditRec = (r: CreditReceivable) => {
    setEditingRec(r);
    setRecForm({
      client_name: r.client_name || '',
      creditor_type: (r as any).creditor_type || 'Client',
      amount_ugx: r.amount_ugx,
      outstanding_ugx: r.outstanding_ugx ?? r.amount_ugx,
      status: r.status,
      due_date: r.due_date || new Date().toISOString().split('T')[0],
      notes: (r as any).notes || ''
    });
    setRecModalOpen(true);
  };

  const saveRec = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      if (editingRec) {
        await firestoreService.updateDocument('credit_receivables', editingRec.id, recForm);
        toast.success('Receivable credit updated successfully!');
      } else {
        await firestoreService.addDocument('credit_receivables', {
          ...recForm,
          tenantId: profile.tenantId,
          receipt_id: 'MAN-' + Date.now(),
          branch_id: activeBranchId || 'main',
          client_id: 'cl_' + Date.now(),
          created_at: new Date().toISOString()
        });
        toast.success('Receivable credit entry logged!');
      }
      setRecModalOpen(false);
    } catch (err) {
      toast.error('Failed to save credit entry');
    }
  };

  const deleteRec = async (id: string) => {
    if (window.confirm('Delete this credit receivable record?')) {
      try {
        await firestoreService.deleteDocument('credit_receivables', id);
        toast.success('Record deleted');
      } catch (err) {
        toast.error('Failed to delete');
      }
    }
  };

  // Handlers for Payables
  const openAddPay = () => {
    setEditingPay(null);
    setPayForm({
      supplier_name: '',
      amount_ugx: 0,
      outstanding_ugx: 0,
      status: 'pending',
      due_date: new Date().toISOString().split('T')[0],
      notes: ''
    });
    setPayModalOpen(true);
  };

  const openEditPay = (p: SupplierPayable) => {
    setEditingPay(p);
    setPayForm({
      supplier_name: p.supplier_name || '',
      amount_ugx: p.amount_ugx,
      outstanding_ugx: p.outstanding_ugx ?? p.amount_ugx,
      status: p.status,
      due_date: p.due_date || new Date().toISOString().split('T')[0],
      notes: p.notes || ''
    });
    setPayModalOpen(true);
  };

  const savePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      if (editingPay) {
        await firestoreService.updateDocument('supplier_payables', editingPay.id, payForm);
        toast.success('Supplier payable credit updated!');
      } else {
        await firestoreService.addDocument('supplier_payables', {
          ...payForm,
          tenantId: profile.tenantId,
          branch_id: activeBranchId || 'main',
          supplier_id: 'sup_' + Date.now(),
          created_at: new Date().toISOString()
        });
        toast.success('Supplier credit payable logged!');
      }
      setPayModalOpen(false);
    } catch (err) {
      toast.error('Failed to save supplier payable');
    }
  };

  const deletePay = async (id: string) => {
    if (window.confirm('Delete this supplier payable record?')) {
      try {
        await firestoreService.deleteDocument('supplier_payables', id);
        toast.success('Record deleted');
      } catch (err) {
        toast.error('Failed to delete');
      }
    }
  };

  // Filtering helper incorporating search queries and date conditions
  const filterBySearchAndDate = (items: any[], dateField: string, isMatchSearch: (item: any) => boolean) => {
    return items.filter(item => {
      // 1. Search Query Match
      if (!isMatchSearch(item)) return false;

      // 2. Date Selector Filter
      if (!showAllDates) {
        const timestamp = item[dateField] || '';
        const datePart = timestamp.includes('T') ? timestamp.split('T')[0] : timestamp;
        if (datePart !== selectedDate) return false;
      }

      return true;
    });
  };

  const filteredRecs = filterBySearchAndDate(
    allReceivables,
    'created_at',
    (r) =>
      (r.client_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      ((r as any).notes || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredPays = filterBySearchAndDate(
    allPayables,
    'created_at',
    (p) =>
      (p.supplier_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      ((p as any).notes || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-emerald-50 border border-emerald-150 p-6 rounded-3xl relative overflow-hidden shadow-sm">
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Debts Owed To Us</p>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 text-emerald-700">Client & Institutional Credits</p>
          <h3 className="text-3xl font-black text-emerald-950">UGX {totalReceivableOwed.toLocaleString()}</h3>
          <p className="text-xs text-emerald-600/80 mt-1 font-medium">Accumulated client receivables currently active</p>
        </div>
        
        <div className="bg-red-50 border border-red-150 p-6 rounded-3xl relative overflow-hidden shadow-sm">
          <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-1">Debts We Owe</p>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 text-red-700">Supplier Credit Payables</p>
          <h3 className="text-3xl font-black text-red-950">UGX {totalPayableOwed.toLocaleString()}</h3>
          <p className="text-xs text-red-600/80 mt-1 font-medium">Consolidated payments pending supplier accounts</p>
        </div>
      </div>

      {/* Tabs list & Date Filters */}
      <div className="flex flex-col md:flex-row items-center justify-between border-b border-zinc-200 gap-4 pb-2">
        <div className="flex gap-4">
          <button
            onClick={() => { setActiveTab('receivables'); setSearchQuery(''); }}
            className={cn(
              "px-4 py-2 font-bold text-sm border-b-2 transition-all",
              activeTab === 'receivables' 
                ? "border-emerald-600 text-emerald-600" 
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            )}
          >
            Credit Owed Us (Receivables)
          </button>
          <button
            onClick={() => { setActiveTab('payables'); setSearchQuery(''); }}
            className={cn(
              "px-4 py-2 font-bold text-sm border-b-2 transition-all",
              activeTab === 'payables' 
                ? "border-emerald-600 text-emerald-600" 
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            )}
          >
            Credit We Owe (Supplier Payables)
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          {/* Default view today's transactions selector */}
          <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-xl px-3 py-1.5 shadow-sm">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Date Log:</span>
            <input 
              type="date" 
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setShowAllDates(false);
              }}
              className="text-xs font-bold text-zinc-700 outline-none bg-transparent"
              disabled={showAllDates}
            />
            <label className="flex items-center gap-1.5 border-l border-zinc-200 pl-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={showAllDates}
                onChange={(e) => setShowAllDates(e.target.checked)}
                className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5"
              />
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest whitespace-nowrap select-none">All Dates</span>
            </label>
          </div>

          <div className="bg-zinc-100 px-3 py-1.5 rounded-xl border border-zinc-200 flex items-center gap-2 w-full md:w-48">
            <Search size={14} className="text-zinc-400" />
            <input 
              type="text" 
              placeholder="Search credit entry..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-xs outline-none w-full text-zinc-800"
            />
          </div>

          <button
            onClick={activeTab === 'receivables' ? openAddRec : openAddPay}
            className="px-4 py-2 bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap flex items-center gap-1.5"
          >
            <Plus size={14} /> Log Entry
          </button>
        </div>
      </div>

      {/* Table section */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        {activeTab === 'receivables' ? (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Creditor Name</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Original Amount</th>
                <th className="px-6 py-4">Outstanding Amount</th>
                <th className="px-6 py-4">Due Date</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredRecs.map((r) => {
                const isAuto = r.id.startsWith('pos_');
                return (
                  <tr key={r.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-zinc-900">{r.client_name}</p>
                      {((r as any).notes || '') && (
                        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{(r as any).notes}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                        r.creditor_type === 'Institution' 
                          ? "bg-blue-50 text-blue-600 border border-blue-100" 
                          : "bg-purple-50 text-purple-600 border border-purple-100"
                      )}>
                        {r.creditor_type || 'Client'}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-semibold text-xs text-zinc-550">UGX {(r.amount_ugx || 0).toLocaleString()}</td>
                    <td className="px-6 py-4 font-extrabold text-sm text-zinc-900">UGX {(r.outstanding_ugx ?? r.amount_ugx ?? 0).toLocaleString()}</td>
                    <td className="px-6 py-4 text-xs font-medium text-zinc-500">{r.due_date ? new Date(r.due_date).toLocaleDateString() : 'N/A'}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                        r.status === 'paid' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                        r.status === 'defaulted' ? "bg-red-50 text-red-600 border border-red-100" :
                        "bg-amber-50 text-amber-600 border border-amber-100"
                      )}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!isAuto ? (
                          <>
                            <button 
                              onClick={() => openEditRec(r)}
                              className="p-1 px-2.5 bg-zinc-50 hover:bg-zinc-100 text-zinc-600 rounded-lg text-xs font-bold transition-all border border-zinc-200"
                            >
                              Edit
                            </button>
                            <button 
                              onClick={() => deleteRec(r.id)}
                              className="p-1 px-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-bold transition-all border border-red-100"
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <span className="text-[10px] text-emerald-650 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100 font-bold uppercase tracking-wider select-none">
                            POS Auto-Synced
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRecs.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-zinc-400 text-xs font-bold uppercase tracking-wider">
                    No credit receivables logged for this date
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                <th className="px-6 py-4">Supplier Name</th>
                <th className="px-6 py-4">Original sum</th>
                <th className="px-6 py-4">Outstanding balance</th>
                <th className="px-6 py-4">Due Date</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredPays.map((p) => {
                const isAuto = p.id.startsWith('proc_');
                return (
                  <tr key={p.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-zinc-900">{p.supplier_name || 'Generic Supplier'}</p>
                      {p.notes && (
                        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{p.notes}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 font-semibold text-xs text-zinc-550">UGX {(p.amount_ugx || 0).toLocaleString()}</td>
                    <td className="px-6 py-4 font-extrabold text-sm text-zinc-900">UGX {(p.outstanding_ugx ?? p.amount_ugx ?? 0).toLocaleString()}</td>
                    <td className="px-6 py-4 text-xs font-medium text-zinc-500">{p.due_date ? new Date(p.due_date).toLocaleDateString() : 'N/A'}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                        p.status === 'paid' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : 
                        "bg-amber-50 text-amber-600 border border-amber-100"
                      )}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!isAuto ? (
                          <>
                            <button 
                              onClick={() => openEditPay(p)}
                              className="p-1 px-2.5 bg-zinc-50 hover:bg-zinc-100 text-zinc-600 rounded-lg text-xs font-bold transition-all border border-zinc-200"
                            >
                              Edit
                            </button>
                            <button 
                              onClick={() => deletePay(p.id)}
                              className="p-1 px-2.5 bg-red-50 hover:bg-red-100 text-red-650 rounded-lg text-xs font-bold transition-all border border-red-100"
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <span className="text-[10px] text-blue-650 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100 font-bold uppercase tracking-wider select-none">
                            GRN Auto-Synced
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredPays.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-zinc-400 text-xs font-bold uppercase tracking-wider">
                    No supplier credit payables logged for this date
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Credit Receivables Modal Form */}
      {recModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 p-8">
            <h2 className="text-xl font-bold text-zinc-900 mb-6">{editingRec ? 'Edit Receivable Credit' : 'Log Credit Receivable'}</h2>
            <form onSubmit={saveRec} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Creditor Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRecForm({...recForm, creditor_type: 'Client'})}
                    className={cn(
                      "py-2 font-bold text-xs rounded-xl border transition-all",
                      recForm.creditor_type === 'Client' ? "bg-purple-50 border-purple-300 text-purple-700" : "bg-white border-zinc-200 text-zinc-500"
                    )}
                  >
                    Client
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecForm({...recForm, creditor_type: 'Institution'})}
                    className={cn(
                      "py-2 font-bold text-xs rounded-xl border transition-all",
                      recForm.creditor_type === 'Institution' ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-zinc-200 text-zinc-500"
                    )}
                  >
                    Institution
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Debtor / Name</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Jubilee Insurance or Alex Mukasa"
                  className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                  value={recForm.client_name}
                  onChange={(e) => setRecForm({...recForm, client_name: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Total Amount (UGX)</label>
                  <input 
                    type="number"
                    required
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                    value={recForm.amount_ugx || ''}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRecForm({...recForm, amount_ugx: val, outstanding_ugx: val});
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Remaining Balance</label>
                  <input 
                    type="number"
                    required
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                    value={recForm.outstanding_ugx || ''}
                    onChange={(e) => setRecForm({...recForm, outstanding_ugx: parseInt(e.target.value) || 0})}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Payment Due Date</label>
                <input 
                  type="date"
                  required
                  className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-xs font-bold text-zinc-800"
                  value={recForm.due_date}
                  onChange={(e) => setRecForm({...recForm, due_date: e.target.value})}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Status</label>
                <select
                  className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-xs font-bold text-zinc-800"
                  value={recForm.status}
                  onChange={(e) => setRecForm({...recForm, status: e.target.value as any})}
                >
                  <option value="outstanding">Outstanding</option>
                  <option value="paid">Paid</option>
                  <option value="defaulted">Defaulted</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Reference / Notes</label>
                <textarea 
                  rows={2}
                  className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-xs text-zinc-700"
                  placeholder="Invoice references, limits, or contact detail details..."
                  value={recForm.notes}
                  onChange={(e) => setRecForm({...recForm, notes: e.target.value})}
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button" 
                  onClick={() => setRecModalOpen(false)}
                  className="flex-1 px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-bold rounded-xl transition-all text-xs uppercase"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-white font-bold rounded-xl transition-all text-xs uppercase"
                >
                  Save Credit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Payables Modal Form */}
      {payModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 p-8">
            <h2 className="text-xl font-bold text-zinc-900 mb-6">{editingPay ? 'Edit Supplier Payable' : 'Log Supplier Credit Owed'}</h2>
            <form onSubmit={savePay} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Supplier / Vendor Name</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Joint Medical Store, Abacus Pharma"
                  className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                  value={payForm.supplier_name}
                  onChange={(e) => setPayForm({...payForm, supplier_name: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Original sum (UGX)</label>
                  <input 
                    type="number"
                    required
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                    value={payForm.amount_ugx || ''}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setPayForm({...payForm, amount_ugx: val, outstanding_ugx: val});
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Remaining balance</label>
                  <input 
                    type="number"
                    required
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                    value={payForm.outstanding_ugx || ''}
                    onChange={(e) => setPayForm({...payForm, outstanding_ugx: parseInt(e.target.value) || 0})}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Payment Due Date</label>
                <input 
                  type="date"
                  required
                  className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-xs font-bold text-zinc-800"
                  value={payForm.due_date}
                  onChange={(e) => setPayForm({...payForm, due_date: e.target.value})}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-zinc-500 uppercase">Status</label>
                <select
                  className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-xs font-bold text-zinc-800"
                  value={payForm.status}
                  onChange={(e) => setPayForm({...payForm, status: e.target.value as any})}
                >
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-zinc-500 uppercase">References / Contact Detail</label>
                <textarea 
                  rows={2}
                  className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-xs text-zinc-700"
                  placeholder="Invoice number, payment options, bank details..."
                  value={payForm.notes}
                  onChange={(e) => setPayForm({...payForm, notes: e.target.value})}
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button" 
                  onClick={() => setPayModalOpen(false)}
                  className="flex-1 px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-bold rounded-xl transition-all text-xs uppercase"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-white font-bold rounded-xl transition-all text-xs uppercase"
                >
                  Save Payable
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const ProfitabilityDashboard: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-emerald-500 p-6 rounded-2xl text-white shadow-lg shadow-emerald-500/20">
          <p className="text-xs font-bold opacity-80 uppercase tracking-widest mb-1">Gross Profit (MTD)</p>
          <h3 className="text-3xl font-black">UGX 45.2M</h3>
          <p className="text-[10px] mt-2 font-bold bg-white/20 inline-block px-2 py-1 rounded">Margin: 32.4%</p>
        </div>
        <div className="bg-zinc-900 p-6 rounded-2xl text-white shadow-lg shadow-zinc-900/20">
          <p className="text-xs font-bold opacity-80 uppercase tracking-widest mb-1">Total COGS (MTD)</p>
          <h3 className="text-3xl font-black">UGX 94.8M</h3>
          <p className="text-[10px] mt-2 font-bold bg-white/20 inline-block px-2 py-1 rounded">Inventory Value: 240M</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Net Operating Income</p>
          <h3 className="text-3xl font-black text-zinc-900">UGX 28.1M</h3>
          <p className="text-[10px] mt-2 font-bold text-emerald-500">+8% vs last month</p>
        </div>
      </div>

      <div className="bg-white p-8 rounded-2xl border border-zinc-200 shadow-sm">
        <h3 className="font-bold text-zinc-900 mb-6">Revenue vs Expenses (Last 6 Months)</h3>
        <div className="h-[300px] flex items-end gap-4">
          {[
            { month: 'Oct', rev: 120, exp: 80 },
            { month: 'Nov', rev: 140, exp: 85 },
            { month: 'Dec', rev: 180, exp: 110 },
            { month: 'Jan', rev: 150, exp: 90 },
            { month: 'Feb', rev: 165, exp: 95 },
            { month: 'Mar', rev: 190, exp: 105 },
          ].map((data) => (
            <div key={data.month} className="flex-1 flex flex-col items-center gap-2">
              <div className="w-full flex items-end justify-center gap-1 h-[240px]">
                <div 
                  className="w-4 bg-emerald-500 rounded-t-sm transition-all hover:opacity-80"
                  style={{ height: `${(data.rev / 200) * 100}%` }}
                ></div>
                <div 
                  className="w-4 bg-zinc-200 rounded-t-sm transition-all hover:bg-zinc-300"
                  style={{ height: `${(data.exp / 200) * 100}%` }}
                ></div>
              </div>
              <span className="text-[10px] font-bold text-zinc-400 uppercase">{data.month}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-emerald-500 rounded-sm"></div>
            <span className="text-xs text-zinc-500">Revenue</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-zinc-200 rounded-sm"></div>
            <span className="text-xs text-zinc-500">Expenses</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Finance;
