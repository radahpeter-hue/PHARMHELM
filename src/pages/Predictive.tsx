import React, { useState, useEffect, useMemo } from 'react';
import { 
  query, 
  collection, 
  where, 
  getDocs, 
  updateDoc, 
  addDoc, 
  doc 
} from 'firebase/firestore';
import { db } from '../firebase';
import { toast } from 'sonner';
import { 
  TrendingUp, 
  Target, 
  Zap, 
  BarChart, 
  AlertTriangle, 
  ArrowUpRight, 
  ArrowDownRight,
  RefreshCw,
  Info,
  Calculator,
  Activity,
  ChevronRight,
  Settings2,
  PieChart,
  Download,
  FileText,
  CheckCircle2
} from 'lucide-react';
import { 
  BarChart as ReBarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  ReferenceLine
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { UpgradeRequiredCard } from '../components/UpgradeRequiredCard';
import { firestoreService } from '../services/firestore';
import { Product, Branch } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PredictiveState {
  inventoryValue: number; // I
  totalSales: number; // S
  turnover: number; // T
  markup: number; // M (decimal, e.g. 0.33 for 33%)
  fixedCosts: number; // F
  desiredProfit: number; // pi
}

const Predictive: React.FC = () => {
  const { profile, activeBranch } = useAuth();
  const { tenant } = useTenant();

  if (tenant?.subscription_tier === 'basic' || tenant?.subscription_tier === 'standard') {
    return (
      <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8">
        <UpgradeRequiredCard moduleName="Predictive Engine" />
      </div>
    );
  }

  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [isManualMode, setIsManualMode] = useState(false);
  const [activePanel, setActivePanel] = useState<'diagnostic' | 'planning' | 'scenario'>('diagnostic');
  const [saving, setSaving] = useState(false);

  // Live collections state
  const [batches, setBatches] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  // Panel 1: Diagnostic State
  const [state, setState] = useState<PredictiveState>({
    inventoryValue: 0,
    totalSales: 0,
    turnover: 0,
    markup: 0,
    fixedCosts: 0,
    desiredProfit: 0
  });

  // Panel 3: Scenario Overrides
  const [scenario, setScenario] = useState<Partial<PredictiveState>>({});

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, (data) => {
        setBranches(data);
        if (activeBranch) setSelectedBranchId(activeBranch.id);
        else if (data.length > 0) setSelectedBranchId(data[0].id);
      });
    }
  }, [profile?.tenantId, activeBranch]);

  // Subscribe to live collections for calculations
  useEffect(() => {
    if (profile?.tenantId && selectedBranchId) {
      const unsubBatches = firestoreService.subscribeToCollectionGroup('product_batches', profile.tenantId, selectedBranchId, setBatches);
      const unsubSales = firestoreService.subscribeToCollection('sales', profile.tenantId, (data) => {
        setSales(data.filter(s => s.branchId === selectedBranchId));
      });
      const unsubExpenses = firestoreService.subscribeToCollection('branch_expenses', profile.tenantId, (data) => {
        setExpenses(data.filter(e => e.branchId === selectedBranchId));
      });
      const unsubProducts = firestoreService.subscribeToCollection('products', profile.tenantId, setProducts);

      return () => {
        unsubBatches();
        unsubSales();
        unsubExpenses();
        unsubProducts();
      };
    }
  }, [profile?.tenantId, selectedBranchId]);

  // Calculate live metrics based on database contents
  const liveMetrics = useMemo(() => {
    const inventoryValue = batches.reduce((sum, b) => sum + (b.quantity || 0) * (b.purchasePrice || 0), 0);
    const totalSales = sales.reduce((sum, s) => sum + (s.total || s.totalAmount || 0), 0);
    const fixedCosts = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    const totalCogs = sales.reduce((sum, s) => {
      if (s.items) {
        return sum + s.items.reduce((itemSum: number, item: any) => {
          const prod = products.find(p => p.id === item.productId || p.id === item.id);
          const cost = prod?.purchase_price || item.price * 0.75;
          return itemSum + cost * (item.quantity || 1);
        }, 0);
      }
      return sum + (s.total || s.totalAmount || 0) * 0.75;
    }, 0);

    const markup = totalCogs > 0 ? (totalSales - totalCogs) / totalCogs : 0.33;
    const turnover = inventoryValue > 0 ? totalCogs / inventoryValue : 0.8;

    return {
      inventoryValue,
      totalSales,
      fixedCosts,
      markup,
      turnover
    };
  }, [batches, sales, expenses, products]);

  useEffect(() => {
    if (selectedBranchId && profile?.tenantId) {
      // Fetch predictive settings for this branch
      const fetchSettings = async () => {
        try {
          const q = query(
            collection(db, 'predictive_settings'), 
            where('tenantId', '==', profile.tenantId),
            where('branchId', '==', selectedBranchId)
          );
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            const data = snapshot.docs[0].data() as PredictiveState;
            setState(data);
          } else {
            // Default values generated from live database metrics
            setState({
              inventoryValue: liveMetrics.inventoryValue || 15000000,
              totalSales: liveMetrics.totalSales || 5000000,
              turnover: liveMetrics.turnover || 0.8,
              markup: liveMetrics.markup || 0.33,
              fixedCosts: liveMetrics.fixedCosts || 1200000,
              desiredProfit: 800000
            });
          }
        } catch (error) {
          console.error('Error fetching predictive settings:', error);
        }
      };
      fetchSettings();
    }
  }, [selectedBranchId, profile?.tenantId, liveMetrics]);

  const handleUpdateModel = async () => {
    if (!selectedBranchId || !profile?.tenantId) return;
    setSaving(true);
    try {
      const q = query(
        collection(db, 'predictive_settings'), 
        where('tenantId', '==', profile.tenantId),
        where('branchId', '==', selectedBranchId)
      );
      const snapshot = await getDocs(q);
      
      const data = {
        ...state,
        tenantId: profile.tenantId,
        branchId: selectedBranchId,
        updatedAt: new Date().toISOString()
      };

      if (!snapshot.empty) {
        await updateDoc(doc(db, 'predictive_settings', snapshot.docs[0].id), data);
      } else {
        await addDoc(collection(db, 'predictive_settings'), data);
      }
      toast.success('Predictive model updated successfully');
    } catch (error) {
      console.error('Error updating predictive model:', error);
      toast.error('Failed to update model');
    } finally {
      setSaving(false);
    }
  };

  // Calculations
  const calculations = useMemo(() => {
    const s = scenario.totalSales ?? state.totalSales;
    const m = scenario.markup ?? state.markup;
    const f = scenario.fixedCosts ?? state.fixedCosts;
    const pi = scenario.desiredProfit ?? state.desiredProfit;
    const i = scenario.inventoryValue ?? state.inventoryValue;
    const t = scenario.turnover ?? state.turnover;

    const grossMargin = m / (1 + m);
    const gp = s * grossMargin;
    const netProfit = gp - f;
    const cogs = s - gp;
    const dioh = t > 0 ? 365 / t : 0;
    const s_be = f / grossMargin;
    const s_sus = (f + pi) / grossMargin;
    const i_max = s_sus / (t * (1 + m));
    const sustainabilityScore = ((gp / (f + pi)) * 100);

    let zone: 'loss' | 'survival' | 'sustainable' = 'loss';
    if (gp < f) zone = 'loss';
    else if (gp >= f && gp < (f + pi)) zone = 'survival';
    else zone = 'sustainable';

    return {
      gp, netProfit, dioh, s_be, s_sus, i_max, sustainabilityScore, zone, grossMargin, cogs
    };
  }, [state, scenario]);

  // Diagnostic Flags
  const diagnosticFlags = useMemo(() => {
    const flags: { type: string; message: string; action: string }[] = [];
    const { turnover, inventoryValue, totalSales, fixedCosts, desiredProfit } = state;
    const { i_max, s_sus, gp, dioh } = calculations;

    if (turnover < 0.5) {
      flags.push({
        type: 'Low Turnover',
        message: 'Inventory is moving too slowly.',
        action: 'Tighten inventory. Reduce purchase orders until existing stock converts.'
      });
    }

    if (inventoryValue > i_max) {
      flags.push({
        type: 'Overstocked',
        message: 'Inventory exceeds what current turnover justifies.',
        action: `Reduce purchasing by UGX ${(inventoryValue - i_max).toLocaleString()} to align with sustainable capacity.`
      });
    }

    if (gp < (fixedCosts + desiredProfit) && turnover >= 0.8) {
      flags.push({
        type: 'Margin Erosion',
        message: 'Sales volume is adequate but markup is too low.',
        action: 'Review pricing discipline and discount authorisations.'
      });
    }

    if (gp < (fixedCosts + desiredProfit) && totalSales > s_sus) {
      flags.push({
        type: 'Cost Misalignment',
        message: 'Selling enough but fixed costs are too high.',
        action: 'Review operating expenses and overheads.'
      });
    }

    if (dioh > 90) {
      flags.push({
        type: 'Capital Trapped',
        message: 'Stock is sitting for over 90 days on average.',
        action: 'Identify slow and dead movers and accelerate liquidation.'
      });
    }

    return flags;
  }, [state, calculations]);

  const chartData = [
    { name: 'Actual Sales', value: state.totalSales, fill: '#18181b' },
    { name: 'Break-Even', value: calculations.s_be, fill: '#f59e0b' },
    { name: 'Sustainable', value: calculations.s_sus, fill: '#10b981' }
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FA] pb-20">
      {/* Top Navigation Bar */}
      <div className="bg-white border-b border-zinc-200 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 bg-zinc-900 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-zinc-200">
              <Calculator size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black text-zinc-900 tracking-tight">Predictive & Diagnostic Engine</h1>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Deterministic Stock-Sales-Profit Model v1.0</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <select 
              className="bg-zinc-100 border-none rounded-xl px-4 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-zinc-200"
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
            >
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button 
              onClick={() => setIsManualMode(!isManualMode)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all",
                isManualMode ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              )}
            >
              <Settings2 size={14} />
              {isManualMode ? 'Manual Override ON' : 'Live Data Mode'}
            </button>
            <div className="h-8 w-px bg-zinc-200 mx-2" />
            <button className="p-2 text-zinc-400 hover:text-zinc-900 transition-colors">
              <Download size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 py-8">
        {/* Panel Switcher */}
        <div className="flex gap-2 mb-8 bg-zinc-200/50 p-1.5 rounded-2xl w-fit">
          {[
            { id: 'diagnostic', label: 'Panel 1: Current State (Diagnostic)', icon: Activity },
            { id: 'planning', label: 'Panel 2: Target Planning (Forward)', icon: Target },
            { id: 'scenario', label: 'Panel 3: Scenario Testing (What-If)', icon: Zap }
          ].map(p => (
            <button
              key={p.id}
              onClick={() => setActivePanel(p.id as any)}
              className={cn(
                "flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold transition-all",
                activePanel === p.id 
                  ? "bg-white text-zinc-900 shadow-sm" 
                  : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              <p.icon size={14} />
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Inputs & Controls */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm space-y-8">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-widest text-zinc-400">Model Variables</h3>
                <RefreshCw size={14} className="text-zinc-300" />
              </div>

              <div className="space-y-6">
                {[
                  { id: 'inventoryValue', label: 'Average Inventory (I)', unit: 'UGX', icon: Calculator },
                  { id: 'totalSales', label: 'Total Sales (S)', unit: 'UGX', icon: TrendingUp },
                  { id: 'fixedCosts', label: 'Fixed Operating Costs (F)', unit: 'UGX', icon: PieChart },
                  { id: 'desiredProfit', label: 'Desired Net Profit (π)', unit: 'UGX', icon: Target },
                  { id: 'turnover', label: 'Inventory Turnover (T)', unit: 'x', icon: Activity },
                  { id: 'markup', label: 'Weighted Average Markup (M)', unit: '%', icon: BarChart }
                ].map((input) => (
                  <div key={input.id} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                        <input.icon size={12} className="text-zinc-300" />
                        {input.label}
                      </label>
                      {isManualMode && (
                        <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Manual</span>
                      )}
                    </div>
                    <div className="relative group">
                      <input 
                        type="number"
                        disabled={!isManualMode && activePanel !== 'scenario'}
                        className={cn(
                          "w-full bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-4 text-sm font-bold outline-none transition-all",
                          (isManualMode || activePanel === 'scenario') ? "focus:ring-2 focus:ring-zinc-900 focus:bg-white" : "opacity-60 cursor-not-allowed"
                        )}
                        value={input.id === 'markup' ? (state as any)[input.id] * 100 : (state as any)[input.id]}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setState(prev => ({
                            ...prev,
                            [input.id]: input.id === 'markup' ? val / 100 : val
                          }));
                        }}
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-300 uppercase tracking-widest">
                        {input.unit}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-zinc-100">
                <button 
                  onClick={handleUpdateModel}
                  disabled={saving || !isManualMode}
                  className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-zinc-800 disabled:bg-zinc-400 transition-all flex items-center justify-center gap-2"
                >
                  {saving ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Update Global Model
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Dynamic Content based on Panel */}
          <div className="lg:col-span-8 space-y-8">
            <AnimatePresence mode="wait">
              {activePanel === 'diagnostic' && (
                <motion.div 
                  key="diagnostic"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  {/* Economic Status Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm space-y-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black uppercase tracking-widest text-zinc-400">Zone Classification</h3>
                        <div className={cn(
                          "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest",
                          calculations.zone === 'sustainable' ? "bg-emerald-100 text-emerald-700" :
                          calculations.zone === 'survival' ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                        )}>
                          {calculations.zone} Zone
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-6">
                        <div className={cn(
                          "h-24 w-24 rounded-full border-[8px] flex items-center justify-center",
                          calculations.zone === 'sustainable' ? "border-emerald-500" :
                          calculations.zone === 'survival' ? "border-amber-500" : "border-red-500"
                        )}>
                          <span className="text-2xl font-black">{Math.round(calculations.sustainabilityScore)}%</span>
                        </div>
                        <div className="space-y-1">
                          <p className="text-lg font-black text-zinc-900">Sustainability Score</p>
                          <p className="text-xs text-zinc-500 leading-relaxed">
                            {calculations.zone === 'sustainable' ? 'Branch is profitable and meeting all targets.' :
                             calculations.zone === 'survival' ? 'Covering costs but not generating target profit.' :
                             'Operating at a loss. Immediate attention required.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm space-y-6">
                      <h3 className="text-sm font-black uppercase tracking-widest text-zinc-400">Key Performance Indicators</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Gross Profit (GP)</p>
                          <p className="text-lg font-black text-zinc-900">UGX {calculations.gp.toLocaleString()}</p>
                        </div>
                        <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Net Profit/Loss</p>
                          <p className={cn("text-lg font-black", calculations.netProfit >= 0 ? "text-emerald-600" : "text-red-600")}>
                            UGX {calculations.netProfit.toLocaleString()}
                          </p>
                        </div>
                        <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Days Inventory (DIOH)</p>
                          <p className="text-lg font-black text-zinc-900">{Math.round(calculations.dioh)} Days</p>
                        </div>
                        <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Break-Even Sales</p>
                          <p className="text-lg font-black text-zinc-900">UGX {calculations.s_be.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Diagnostics Panel */}
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-black uppercase tracking-widest text-zinc-400">Diagnostic Flags</h3>
                      <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{diagnosticFlags.length} Issues Detected</span>
                    </div>

                    <div className="space-y-4">
                      {diagnosticFlags.map((flag, i) => (
                        <div key={i} className="flex gap-4 p-6 bg-zinc-50 rounded-3xl border border-zinc-100 group hover:border-zinc-300 transition-all">
                          <div className="h-12 w-12 bg-white rounded-2xl flex items-center justify-center text-amber-500 shadow-sm shrink-0">
                            <AlertTriangle size={24} />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black uppercase tracking-widest text-zinc-900">{flag.type}</span>
                              <div className="h-1 w-1 rounded-full bg-zinc-300" />
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Recommended Action</span>
                            </div>
                            <p className="text-sm font-bold text-zinc-600">{flag.message}</p>
                            <p className="text-xs text-zinc-400 italic leading-relaxed">{flag.action}</p>
                          </div>
                        </div>
                      ))}
                      {diagnosticFlags.length === 0 && (
                        <div className="p-12 text-center space-y-4 opacity-40">
                          <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
                          <p className="text-sm font-bold">No diagnostic issues detected. System is running optimally.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {activePanel === 'planning' && (
                <motion.div 
                  key="planning"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm space-y-8">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-black uppercase tracking-widest text-zinc-400">Target Planning (Forward Model)</h3>
                      <button className="text-[10px] font-black text-zinc-900 uppercase tracking-widest flex items-center gap-1">
                        <Download size={12} />
                        Export Targets
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div className="p-6 bg-zinc-900 rounded-[24px] text-white space-y-4">
                          <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Required Monthly Sales (S_SUS)</p>
                          <p className="text-3xl font-black">UGX {calculations.s_sus.toLocaleString()}</p>
                          <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-400">
                            <ArrowUpRight size={14} />
                            Target to hit UGX {state.desiredProfit.toLocaleString()} profit
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Daily Run-Rate Required</p>
                            <p className="text-lg font-black text-zinc-900">UGX {(calculations.s_sus / 30).toLocaleString()}</p>
                          </div>
                          <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Required Inventory</p>
                            <p className="text-lg font-black text-zinc-900">UGX {calculations.i_max.toLocaleString()}</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <h4 className="text-xs font-black uppercase tracking-widest text-zinc-900">Sales Gap Analysis</h4>
                        <div className="h-48 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <ReBarChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 900, fill: '#a1a1aa' }} />
                              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 900, fill: '#a1a1aa' }} />
                              <Tooltip cursor={{ fill: 'transparent' }} />
                              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                                {chartData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.fill} />
                                ))}
                              </Bar>
                            </ReBarChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="p-4 bg-red-50 rounded-2xl border border-red-100 flex items-center justify-between">
                          <p className="text-xs font-bold text-red-700">Current Sales Gap</p>
                          <p className="text-lg font-black text-red-700">UGX {(calculations.s_sus - state.totalSales).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activePanel === 'scenario' && (
                <motion.div 
                  key="scenario"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm space-y-8">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-black uppercase tracking-widest text-zinc-400">Scenario Testing (What-If)</h3>
                      <button 
                        onClick={() => setScenario({})}
                        className="text-[10px] font-black text-zinc-900 uppercase tracking-widest flex items-center gap-1"
                      >
                        <RefreshCw size={12} />
                        Reset Scenario
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <h4 className="text-xs font-black uppercase tracking-widest text-zinc-900">Hypothetical Adjustments</h4>
                        <div className="space-y-4">
                          <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-4">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Reduce Inventory by %</span>
                              <span className="text-xs font-black text-zinc-900">{(scenario.inventoryValue ? (1 - scenario.inventoryValue / state.inventoryValue) * 100 : 0).toFixed(0)}%</span>
                            </div>
                            <input 
                              type="range" 
                              min="0" 
                              max="50" 
                              step="5"
                              className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-zinc-900"
                              onChange={(e) => {
                                const percent = parseInt(e.target.value);
                                setScenario(prev => ({ ...prev, inventoryValue: state.inventoryValue * (1 - percent / 100) }));
                              }}
                            />
                          </div>

                          <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-4">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Improve Markup to %</span>
                              <span className="text-xs font-black text-zinc-900">{(scenario.markup ? scenario.markup * 100 : state.markup * 100).toFixed(1)}%</span>
                            </div>
                            <input 
                              type="range" 
                              min="20" 
                              max="50" 
                              step="1"
                              className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-zinc-900"
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                setScenario(prev => ({ ...prev, markup: val / 100 }));
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="bg-zinc-900 rounded-[32px] p-8 text-white space-y-6">
                        <h4 className="text-xs font-black uppercase tracking-widest text-white/40">Scenario Impact</h4>
                        <div className="space-y-6">
                          <div className="flex justify-between items-end border-b border-white/10 pb-4">
                            <div>
                              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">New Net Profit</p>
                              <p className="text-2xl font-black">UGX {calculations.netProfit.toLocaleString()}</p>
                            </div>
                            <div className={cn(
                              "text-xs font-bold flex items-center gap-1",
                              calculations.netProfit > (state.gp - state.fixedCosts) ? "text-emerald-400" : "text-red-400"
                            )}>
                              {calculations.netProfit > (state.gp - state.fixedCosts) ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                              UGX {Math.abs(calculations.netProfit - (state.gp - state.fixedCosts)).toLocaleString()}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-6">
                            <div>
                              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">New DIOH</p>
                              <p className="text-lg font-black">{Math.round(calculations.dioh)} Days</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">New S_BE</p>
                              <p className="text-lg font-black">UGX {calculations.s_be.toLocaleString()}</p>
                            </div>
                          </div>

                          <div className="pt-4">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">New Sustainability Score</span>
                              <span className="text-xs font-black">{Math.round(calculations.sustainabilityScore)}%</span>
                            </div>
                            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                              <div 
                                className={cn(
                                  "h-full transition-all duration-500",
                                  calculations.zone === 'sustainable' ? "bg-emerald-500" :
                                  calculations.zone === 'survival' ? "bg-amber-500" : "bg-red-500"
                                )}
                                style={{ width: `${Math.min(calculations.sustainabilityScore, 100)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Predictive;
