import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { firestoreService } from '../../../services/firestore';
import { 
  Building2, 
  Wallet, 
  Smartphone, 
  CreditCard, 
  Users, 
  ArrowRight, 
  Plus, 
  Check, 
  Clock, 
  X 
} from 'lucide-react';
import { collection, query, where, getDocs, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { toast } from 'sonner';

interface EODReconciliation {
  id: string;
  tenantId: string;
  reconciliation_date: string;
  cash_actual: number;
  card_actual: number;
  momo_actual: number;
  airtel_actual: number;
  staff_welfare_actual: number;
  created_at?: string;
  updatedAt?: any;
}

interface CashTransfer {
  id: string;
  tenantId: string;
  fromPortfolio: 'momo' | 'airtel' | 'welfare';
  toPortfolio: 'banked';
  amount: number;
  processedBy: string;
  processedAt: any;
}

interface CreditReceivable {
  id: string;
  tenantId: string;
  outstanding_ugx: number;
  created_at?: string;
}

interface WelfareAllocation {
  id: string;
  tenantId: string;
  amount: number;
  notes: string;
  createdAt: any;
  createdBy: string;
}

export const CashAndBanking: React.FC = () => {
  const { profile } = useAuth();
  const [eodList, setEodList] = useState<EODReconciliation[]>([]);
  const [transfers, setTransfers] = useState<CashTransfer[]>([]);
  const [receivables, setReceivables] = useState<CreditReceivable[]>([]);
  const [allocations, setAllocations] = useState<WelfareAllocation[]>([]);
  const [loading, setLoading] = useState(true);

  // Transfer Panel States
  const [transferType, setTransferType] = useState<'momo' | 'airtel' | 'welfare' | null>(null);
  const [transferAmount, setTransferAmount] = useState<number>(0);
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);

  // Welfare Allocation States
  const [isAllocatingWelfare, setIsAllocatingWelfare] = useState(false);
  const [welfareAmount, setWelfareAmount] = useState<number>(0);
  const [welfareNotes, setWelfareNotes] = useState<string>('');
  const [isSubmittingAllocation, setIsSubmittingAllocation] = useState(false);

  const fetchTreasuryData = async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    try {
      // 1. Fetch all EOD Reconciliations
      const eodSnap = await getDocs(query(
        collection(db, 'eod_reconciliations'),
        where('tenantId', '==', profile.tenantId)
      ));
      const eodData = eodSnap.docs.map(doc => ({ ...(doc.data() as any), id: doc.id })) as EODReconciliation[];
      setEodList(eodData);

      // 2. Fetch all Cash Transfers
      const transferSnap = await getDocs(query(
        collection(db, 'cashTransfers'),
        where('tenantId', '==', profile.tenantId)
      ));
      const transferData = transferSnap.docs.map(doc => ({ ...(doc.data() as any), id: doc.id })) as CashTransfer[];
      setTransfers(transferData);

      // 3. Fetch all Credit Receivables
      const recSnap = await getDocs(query(
        collection(db, 'credit_receivables'),
        where('tenantId', '==', profile.tenantId)
      ));
      const recData = recSnap.docs.map(doc => ({ ...(doc.data() as any), id: doc.id })) as CreditReceivable[];
      setReceivables(recData);

      // 4. Fetch all Welfare Allocations
      const allocSnap = await getDocs(query(
        collection(db, 'welfareAllocations'),
        where('tenantId', '==', profile.tenantId)
      ));
      const allocData = allocSnap.docs.map(doc => ({ ...(doc.data() as any), id: doc.id })) as WelfareAllocation[];
      setAllocations(allocData);

    } catch (e: any) {
      console.error("Error fetching Cash & Banking data:", e);
      toast.error("Failed to fetch treasury portfolios.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTreasuryData();
  }, [profile?.tenantId]);

  // Aggregate sums
  const memoizedCalculations = useMemo(() => {
    // A. Direct EOD totals
    const totalEodCash = eodList.reduce((acc, curr) => acc + (curr.cash_actual || 0), 0);
    const totalEodCard = eodList.reduce((acc, curr) => acc + (curr.card_actual || 0), 0);
    const totalEodMomo = eodList.reduce((acc, curr) => acc + (curr.momo_actual || 0), 0);
    const totalEodAirtel = eodList.reduce((acc, curr) => acc + (curr.airtel_actual || 0), 0);
    const totalEodWelfareUsed = eodList.reduce((acc, curr) => acc + (curr.staff_welfare_actual || 0), 0);

    // B. Transfer deductions
    const totalTransfersFromMomo = transfers.filter(t => t.fromPortfolio === 'momo').reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const totalTransfersFromAirtel = transfers.filter(t => t.fromPortfolio === 'airtel').reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const totalTransfersFromWelfare = transfers.filter(t => t.fromPortfolio === 'welfare').reduce((acc, curr) => acc + (curr.amount || 0), 0);

    const totalTransferredToBanked = transfers.filter(t => t.toPortfolio === 'banked').reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const totalTransferredFromBanked = transfers.filter(t => t.fromPortfolio === 'banked').reduce((acc, curr) => acc + (curr.amount || 0), 0);

    // C. Welfare Allocations
    const totalWelfareAllocated = allocations.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    // PORTFOLIO 1: BANKED CASH
    const bankedCash = totalEodCash + totalEodCard + totalTransferredToBanked - totalTransferredFromBanked;

    // PORTFOLIO 2: MTN MOMO
    const momoBalance = Math.max(0, totalEodMomo - totalTransfersFromMomo);

    // PORTFOLIO 3: AIRTEL MONEY
    const airtelBalance = Math.max(0, totalEodAirtel - totalTransfersFromAirtel);

    // PORTFOLIO 4: CREDITS RECEIVABLE
    const creditsReceivable = receivables.reduce((acc, curr) => acc + (curr.outstanding_ugx || 0), 0);

    // PORTFOLIO 5: STAFF WELFARE FUND
    const welfareBalance = Math.max(0, totalWelfareAllocated - totalEodWelfareUsed - totalTransfersFromWelfare);

    return {
      bankedCash,
      momoBalance,
      airtelBalance,
      creditsReceivable,
      welfareBalance,
      welfareAllocated: totalWelfareAllocated,
      welfareUsed: totalEodWelfareUsed
    };
  }, [eodList, transfers, receivables, allocations]);

  // Last update timers
  const lastUpdatedTimestamps = useMemo(() => {
    const defaultText = "No recent transactions";

    const getLatestDate = (dates: (Date | null | undefined)[]) => {
      const valid = dates.filter((d): d is Date => d instanceof Date && !isNaN(d.getTime()));
      if (valid.length === 0) return defaultText;
      const latest = new Date(Math.max(...valid.map(v => v.getTime())));
      return `Updated: ${latest.toLocaleString('en-GB')}`;
    };

    // Banked
    const bankedDates = [
      ...eodList.map(e => e.created_at ? new Date(e.created_at) : null),
      ...transfers.map(t => {
        if (!t.processedAt) return null;
        return t.processedAt.toDate ? t.processedAt.toDate() : new Date(t.processedAt);
      })
    ];

    // MoMo
    const momoDates = [
      ...eodList.filter(e => (e.momo_actual || 0) > 0).map(e => e.created_at ? new Date(e.created_at) : null),
      ...transfers.filter(t => t.fromPortfolio === 'momo').map(t => {
        if (!t.processedAt) return null;
        return t.processedAt.toDate ? t.processedAt.toDate() : new Date(t.processedAt);
      })
    ];

    // Airtel
    const airtelDates = [
      ...eodList.filter(e => (e.airtel_actual || 0) > 0).map(e => e.created_at ? new Date(e.created_at) : null),
      ...transfers.filter(t => t.fromPortfolio === 'airtel').map(t => {
        if (!t.processedAt) return null;
        return t.processedAt.toDate ? t.processedAt.toDate() : new Date(t.processedAt);
      })
    ];

    // Receivables
    const recDates = receivables.map(r => r.created_at ? new Date(r.created_at) : null);

    // Welfare
    const welfareDates = [
      ...allocations.map(a => {
        if (!a.createdAt) return null;
        return a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
      }),
      ...eodList.filter(e => (e.staff_welfare_actual || 0) > 0).map(e => e.created_at ? new Date(e.created_at) : null),
      ...transfers.filter(t => t.fromPortfolio === 'welfare').map(t => {
        if (!t.processedAt) return null;
        return t.processedAt.toDate ? t.processedAt.toDate() : new Date(t.processedAt);
      })
    ];

    return {
      banked: getLatestDate(bankedDates),
      momo: getLatestDate(momoDates),
      airtel: getLatestDate(airtelDates),
      receivables: getLatestDate(recDates),
      welfare: getLatestDate(welfareDates)
    };
  }, [eodList, transfers, receivables, allocations]);

  // Execute processing portfolio balance to Banked Cash
  const handleProcessToBank = async () => {
    if (!transferType) return;
    const currentBalance = transferType === 'momo' 
      ? memoizedCalculations.momoBalance 
      : transferType === 'airtel' 
        ? memoizedCalculations.airtelBalance 
        : memoizedCalculations.welfareBalance;

    if (transferAmount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    if (transferAmount > currentBalance) {
      toast.error("Transfer amount exceeds portfolio balance");
      return;
    }

    setIsSubmittingTransfer(true);
    try {
      await addDoc(collection(db, 'cashTransfers'), {
        tenantId: profile?.tenantId,
        fromPortfolio: transferType,
        toPortfolio: 'banked',
        amount: transferAmount,
        processedBy: profile?.fullName || profile?.email || 'Authorized Finance',
        processedAt: Timestamp.now()
      });

      toast.success(`UGX ${transferAmount.toLocaleString()} moved from ${transferType.toUpperCase()} to Banked Cash.`);
      setTransferType(null);
      setTransferAmount(0);
      fetchTreasuryData(); // refresh
    } catch (e: any) {
      console.error("Error transferring money:", e);
      toast.error("Failed to complete bank transfer.");
    } finally {
      setIsSubmittingTransfer(false);
    }
  };

  // Execute staff welfare allocation
  const handleAllocateWelfare = async () => {
    if (welfareAmount <= 0) {
      toast.error("Allocation amount must be greater than zero");
      return;
    }

    setIsSubmittingAllocation(true);
    try {
      await addDoc(collection(db, 'welfareAllocations'), {
        tenantId: profile?.tenantId,
        amount: welfareAmount,
        notes: welfareNotes || 'Quarterly operational staff welfare allocation',
        createdAt: Timestamp.now(),
        createdBy: profile?.uid || 'SYSTEM'
      });

      // Also add an outgoing deduction entry to petty_cash_ledger!
      await addDoc(collection(db, 'petty_cash_ledger'), {
        tenantId: profile?.tenantId,
        date: new Date().toISOString().split('T')[0],
        amount: welfareAmount,
        source: `Welfare Fund Allocation: ${welfareNotes || 'Quarterly staff welfare fund allocation'}`,
        reference_number: `WEL-${Math.random().toString(36).slice(-6).toUpperCase()}`,
        type: 'outgoing',
        logged_by: profile?.fullName || profile?.email || 'Authorized Finance',
        created_at: new Date().toISOString()
      });

      toast.success(`Allocated UGX ${welfareAmount.toLocaleString()} from Petty Cash to Staff Welfare Fund successfully.`);
      setIsAllocatingWelfare(false);
      setWelfareAmount(0);
      setWelfareNotes('');
      fetchTreasuryData(); // refresh
    } catch (e: any) {
      console.error("Error creating welfare allocation:", e);
      toast.error("Failed to allocate welfare funds.");
    } finally {
      setIsSubmittingAllocation(false);
    }
  };

  // Portfolios total bar
  const totalUnderManagement = 
    memoizedCalculations.bankedCash + 
    memoizedCalculations.momoBalance + 
    memoizedCalculations.airtelBalance + 
    memoizedCalculations.creditsReceivable + 
    memoizedCalculations.welfareBalance;

  const pendingProcessingTotal = 
    memoizedCalculations.momoBalance + 
    memoizedCalculations.airtelBalance + 
    memoizedCalculations.welfareBalance;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-black text-zinc-900 tracking-tight">Global Treasury View</h2>
        <p className="text-sm text-zinc-500">Track aggregate wallets, banked balances, and process transfers to main treasury bank.</p>
      </div>

      {/* PORTFOLIO TOTALS BAR */}
      <div className="bg-zinc-900 text-white p-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm border border-zinc-800">
        <div>
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Total Cash Under Management</span>
          <h2 className="text-3xl font-black font-mono mt-0.5">UGX {totalUnderManagement.toLocaleString()}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div className="bg-zinc-800/60 px-4 py-2.5 rounded-xl border border-zinc-700/50">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">Banked / Settled</span>
            <span className="font-bold font-mono text-emerald-400">UGX {memoizedCalculations.bankedCash.toLocaleString()}</span>
          </div>
          <div className="bg-zinc-800/60 px-4 py-2.5 rounded-xl border border-zinc-700/50">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">Pending Processing</span>
            <span className="font-bold font-mono text-amber-400">UGX {pendingProcessingTotal.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* 5 Portfolio Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* PORTFOLIO 1: BANKED CASH */}
        <div className="bg-white border-2 border-emerald-500/25 p-6 rounded-3xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
          <div className="absolute top-0 right-0 bg-emerald-500/10 p-4 rounded-bl-3xl text-emerald-600">
            <Building2 size={24} />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest block">Portfolio 1</span>
            <h3 className="text-lg font-black text-zinc-950">Banked Cash</h3>
            <p className="text-xs text-zinc-400 font-medium">Total confirmed deposits & settled transactions.</p>
          </div>
          <div className="my-6">
            <span className="text-3xl font-black font-mono text-zinc-950">
              UGX {memoizedCalculations.bankedCash.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-zinc-400 font-semibold border-t border-zinc-100 pt-3">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {lastUpdatedTimestamps.banked}
            </span>
            <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md font-bold">Liquid</span>
          </div>
        </div>

        {/* PORTFOLIO 2: MTN MOMO */}
        <div className="bg-white border border-zinc-200 p-6 rounded-3xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
          <div className="absolute top-0 right-0 bg-amber-500/10 p-4 rounded-bl-3xl text-amber-600">
            <Smartphone size={24} />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest block">Portfolio 2</span>
            <h3 className="text-lg font-black text-zinc-950">MTN MoMo</h3>
            <p className="text-xs text-zinc-400 font-medium">Current unprocessed branch mobile money collections.</p>
          </div>
          <div className="my-6">
            <span className="text-2xl font-black font-mono text-zinc-950">
              UGX {memoizedCalculations.momoBalance.toLocaleString()}
            </span>
          </div>
          <div className="space-y-3 border-t border-zinc-100 pt-3">
            {memoizedCalculations.momoBalance > 0 && (
              <button
                onClick={() => {
                  setTransferType('momo');
                  setTransferAmount(memoizedCalculations.momoBalance);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold bg-amber-50 text-amber-700 hover:bg-amber-100/80 rounded-xl transition-all"
              >
                Process to Bank
                <ArrowRight size={14} />
              </button>
            )}
            <div className="flex items-center gap-1 text-[11px] text-zinc-400 font-semibold">
              <Clock size={12} />
              <span>{lastUpdatedTimestamps.momo}</span>
            </div>
          </div>
        </div>

        {/* PORTFOLIO 3: AIRTEL MONEY */}
        <div className="bg-white border border-zinc-200 p-6 rounded-3xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
          <div className="absolute top-0 right-0 bg-red-500/10 p-4 rounded-bl-3xl text-red-600">
            <Smartphone size={24} />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-black text-red-700 uppercase tracking-widest block">Portfolio 3</span>
            <h3 className="text-lg font-black text-zinc-950">Airtel Money</h3>
            <p className="text-xs text-zinc-400 font-medium">Unprocessed Airtel money collections.</p>
          </div>
          <div className="my-6">
            <span className="text-2xl font-black font-mono text-zinc-950">
              UGX {memoizedCalculations.airtelBalance.toLocaleString()}
            </span>
          </div>
          <div className="space-y-3 border-t border-zinc-100 pt-3">
            {memoizedCalculations.airtelBalance > 0 && (
              <button
                onClick={() => {
                  setTransferType('airtel');
                  setTransferAmount(memoizedCalculations.airtelBalance);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold bg-red-50 text-red-700 hover:bg-red-100/80 rounded-xl transition-all"
              >
                Process to Bank
                <ArrowRight size={14} />
              </button>
            )}
            <div className="flex items-center gap-1 text-[11px] text-zinc-400 font-semibold">
              <Clock size={12} />
              <span>{lastUpdatedTimestamps.airtel}</span>
            </div>
          </div>
        </div>

        {/* PORTFOLIO 4: CREDITS RECEIVABLE */}
        <div className="bg-white border border-zinc-200 p-6 rounded-3xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
          <div className="absolute top-0 right-0 bg-blue-500/10 p-4 rounded-bl-3xl text-blue-600">
            <CreditCard size={24} />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest block">Portfolio 4</span>
            <h3 className="text-lg font-black text-zinc-950">Credits Receivable</h3>
            <p className="text-xs text-zinc-400 font-medium">Outstanding institution and corporate client balances.</p>
          </div>
          <div className="my-6">
            <span className="text-2xl font-black font-mono text-zinc-950">
              UGX {memoizedCalculations.creditsReceivable.toLocaleString()}
            </span>
          </div>
          <div className="space-y-2 border-t border-zinc-100 pt-3 text-[11px] font-semibold text-zinc-400">
            <span className="block text-zinc-500">Read-only (Managed in Credit Ledger)</span>
            <div className="flex items-center gap-1">
              <Clock size={12} />
              <span>{lastUpdatedTimestamps.receivables}</span>
            </div>
          </div>
        </div>

        {/* PORTFOLIO 5: STAFF WELFARE FUND */}
        <div className="bg-[#7C3AED] text-white p-6 rounded-3xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
          <div className="absolute top-0 right-0 bg-white/10 p-4 rounded-bl-3xl text-white">
            <Users size={24} />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-black text-purple-200 uppercase tracking-widest block">Portfolio 5</span>
            <h3 className="text-lg font-black text-white">Staff Welfare Fund</h3>
            <p className="text-xs text-purple-100">Welfare pool allocations, disbursements, and reserves.</p>
          </div>
          <div className="my-5">
            <span className="text-2xl font-black font-mono block">
              UGX {memoizedCalculations.welfareBalance.toLocaleString()}
            </span>
            <div className="mt-1 flex items-center gap-3 text-[10px] text-purple-200 font-bold">
              <span>Allocated: {memoizedCalculations.welfareAllocated?.toLocaleString()}</span>
              <span>Disbursed: {memoizedCalculations.welfareUsed?.toLocaleString()}</span>
            </div>
          </div>
          <div className="space-y-3 border-t border-purple-400/30 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setIsAllocatingWelfare(true);
                  setWelfareAmount(100000);
                }}
                className="flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-bold bg-white text-purple-700 hover:bg-purple-50 rounded-xl transition-all"
              >
                <Plus size={14} />
                Allocate Funds
              </button>
              {memoizedCalculations.welfareBalance > 0 && (
                <button
                  onClick={() => {
                    setTransferType('welfare');
                    setTransferAmount(memoizedCalculations.welfareBalance);
                  }}
                  className="flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-bold bg-purple-800 text-purple-100 hover:bg-purple-900 rounded-xl border border-purple-600 transition-all"
                >
                  <Building2 size={14} />
                  Bank Remaining
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-purple-200 font-semibold">
              <Clock size={12} className="text-purple-300" />
              <span>{lastUpdatedTimestamps.welfare}</span>
            </div>
          </div>
        </div>

      </div>

      {/* Slide-in Process to Bank Panel */}
      {transferType && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-end z-50 transition-all">
          <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col justify-between border-l border-zinc-200 p-6 animate-slide-in">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
                <div className="flex items-center gap-2 text-zinc-900">
                  <Building2 className="text-[#1A5E38]" size={22} />
                  <h3 className="text-lg font-black tracking-tight">Process to Bank Treasury</h3>
                </div>
                <button
                  onClick={() => setTransferType(null)}
                  className="p-1 text-zinc-400 hover:text-zinc-600 rounded-full hover:bg-zinc-100"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200/60">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Source Portfolio</span>
                  <span className="text-sm font-extrabold text-zinc-800 block mt-0.5">{transferType.toUpperCase()} balance</span>
                  <span className="text-xl font-black font-mono text-zinc-950 block mt-1">
                    UGX {transferType === 'momo' 
                      ? memoizedCalculations.momoBalance.toLocaleString() 
                      : transferType === 'airtel' 
                        ? memoizedCalculations.airtelBalance.toLocaleString() 
                        : memoizedCalculations.welfareBalance.toLocaleString()}
                  </span>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Amount to bank (UGX)</label>
                  <input
                    type="number"
                    max={transferType === 'momo' 
                      ? memoizedCalculations.momoBalance 
                      : transferType === 'airtel' 
                        ? memoizedCalculations.airtelBalance 
                        : memoizedCalculations.welfareBalance}
                    value={transferAmount || ''}
                    onChange={(e) => setTransferAmount(Math.min(parseInt(e.target.value) || 0, transferType === 'momo' ? memoizedCalculations.momoBalance : transferType === 'airtel' ? memoizedCalculations.airtelBalance : memoizedCalculations.welfareBalance))}
                    placeholder="Enter amount to deposit..."
                    className="w-full border border-zinc-200 px-4 py-3 rounded-2xl font-mono font-bold text-lg outline-none text-zinc-800 focus:border-[#1A5E38] focus:ring-1 focus:ring-[#1A5E38]"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-zinc-100 pt-4 flex gap-3">
              <button
                onClick={handleProcessToBank}
                disabled={isSubmittingTransfer || transferAmount <= 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#1A5E38] hover:bg-[#154b2d] disabled:opacity-50 text-white rounded-xl text-sm font-bold shadow-md shadow-emerald-900/10 transition-all"
              >
                {isSubmittingTransfer ? 'Processing...' : 'Confirm Banking'}
                <Check size={16} />
              </button>
              <button
                onClick={() => setTransferType(null)}
                className="px-4 py-3 border border-zinc-200 text-zinc-600 rounded-xl text-sm font-bold hover:bg-zinc-50 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Welfare Allocation Form Panel */}
      {isAllocatingWelfare && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-xl border border-zinc-200 flex flex-col">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
              <div className="flex items-center gap-2">
                <Users className="text-[#1A5E38]" size={20} />
                <h3 className="text-base font-black text-zinc-950 tracking-tight">Allocate Staff Welfare Funds</h3>
              </div>
              <button
                onClick={() => setIsAllocatingWelfare(false)}
                className="text-zinc-400 hover:text-zinc-600 p-1 hover:bg-zinc-100 rounded-full transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider block">Allocation Amount (UGX)</label>
                <input
                  type="number"
                  value={welfareAmount || ''}
                  onChange={(e) => setWelfareAmount(parseInt(e.target.value) || 0)}
                  placeholder="Enter funding amount..."
                  className="w-full border border-zinc-200 px-4 py-2.5 rounded-2xl font-mono font-bold text-base outline-none focus:border-[#1A5E38]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider block">Reference Notes</label>
                <textarea
                  value={welfareNotes}
                  onChange={(e) => setWelfareNotes(e.target.value)}
                  placeholder="Specify notes (e.g. Q3 bonus allocation, medical allowance pool)..."
                  className="w-full border border-zinc-200 px-4 py-2.5 rounded-2xl text-sm font-medium h-24 outline-none focus:border-[#1A5E38] resize-none"
                />
              </div>
            </div>

            <div className="p-6 border-t border-zinc-100 bg-zinc-50 flex gap-3 justify-end">
              <button
                onClick={() => setIsAllocatingWelfare(false)}
                className="px-4 py-2 text-xs font-bold border border-zinc-200 rounded-xl hover:bg-white text-zinc-600 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAllocateWelfare}
                disabled={isSubmittingAllocation || welfareAmount <= 0}
                className="px-5 py-2 text-xs font-bold bg-[#1A5E38] hover:bg-[#154b2d] text-white rounded-xl disabled:opacity-50 transition-all shadow-sm"
              >
                {isSubmittingAllocation ? 'Allocating...' : 'Confirm & Issue Allocation'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
