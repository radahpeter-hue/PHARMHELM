import { FinancialPortfoliosPanel } from '../../../components/finance/FinancialPortfoliosPanel';
import { useManagementPaymentAccounts } from '../../../components/finance/ManagementPaymentAccounts';
import { createManagementFinanceWriteGroup } from '../../../services/managementCashPosting';
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

  const { accounts: paymentAccounts } = useManagementPaymentAccounts();
  // Aggregate sums
  const memoizedCalculations = useMemo(() => {
    // Reconciliation declarations are audit evidence, never treasury funding.
    // No wallet/current welfare balance is established by this view's existing records.
    // B. Transfer deductions
    const totalTransfersFromWelfare = transfers.filter(t => t.fromPortfolio === 'welfare').reduce((acc, curr) => acc + (curr.amount || 0), 0);

    const totalTransferredToBanked = transfers.filter(t => t.toPortfolio === 'banked').reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const totalTransferredFromBanked = transfers.filter(t => t.fromPortfolio === 'banked').reduce((acc, curr) => acc + (curr.amount || 0), 0);

    // C. Welfare Allocations
    const totalWelfareAllocated = allocations.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    // PORTFOLIO 1: BANKED CASH
    const registeredBank = paymentAccounts.find(account=>account.kind==='bank'&&account.initialized);
    const bankedCash = registeredBank ? registeredBank.balanceUGX : totalTransferredToBanked - totalTransferredFromBanked;

    // PORTFOLIO 2: MTN MOMO
    const momoBalance = 0;

    // PORTFOLIO 3: AIRTEL MONEY
    const airtelBalance = 0;

    // PORTFOLIO 4: CREDITS RECEIVABLE
    const creditsReceivable = receivables.reduce((acc, curr) => acc + (curr.outstanding_ugx || 0), 0);

    // PORTFOLIO 5: STAFF WELFARE FUND
    const welfareBalance = 0;

    return {
      bankedCash,
      momoBalance,
      airtelBalance,
      creditsReceivable,
      welfareBalance,
      welfareAllocated: totalWelfareAllocated,
      welfareTransferred: totalTransfersFromWelfare
    };
  }, [transfers, receivables, allocations, paymentAccounts]);

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
      ...transfers.map(t => {
        if (!t.processedAt) return null;
        return t.processedAt.toDate ? t.processedAt.toDate() : new Date(t.processedAt);
      })
    ];

    // MoMo
    const momoDates = [
      ...transfers.filter(t => t.fromPortfolio === 'momo').map(t => {
        if (!t.processedAt) return null;
        return t.processedAt.toDate ? t.processedAt.toDate() : new Date(t.processedAt);
      })
    ];

    // Airtel
    const airtelDates = [
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
  }, [transfers, receivables, allocations, paymentAccounts]);

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
      const financeMessages: {kind:'success'|'info';message:string}[] = [];
      const financeWrites = createManagementFinanceWriteGroup(profile?.tenantId || '', profile?.uid || '');
      await financeWrites.add('cashTransfers', {
        tenantId: profile?.tenantId,
        fromPortfolio: transferType,
        toPortfolio: 'banked',
        amount: transferAmount,
        processedBy: profile?.fullName || profile?.email || 'Authorized Finance',
        processedAt: Timestamp.now()
      });
      await financeWrites.commit();
      financeMessages.forEach(({kind,message})=>toast[kind](message));

      financeMessages.push({kind:'success',message:`UGX ${transferAmount.toLocaleString()} moved from ${transferType.toUpperCase()} to Banked Cash.`});
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
      const financeMessages: {kind:'success'|'info';message:string}[] = [];
      const financeWrites = createManagementFinanceWriteGroup(profile?.tenantId || '', profile?.uid || '');
      await financeWrites.add('welfareAllocations', {
        tenantId: profile?.tenantId,
        amount: welfareAmount,
        notes: welfareNotes || 'Quarterly operational staff welfare allocation',
        createdAt: Timestamp.now(),
        createdBy: profile?.uid || 'SYSTEM'
      });

      // Also add an outgoing deduction entry to petty_cash_ledger!
      await financeWrites.add('petty_cash_ledger', {
        tenantId: profile?.tenantId,
        date: new Date().toISOString().split('T')[0],
        amount: welfareAmount,
        source: `Welfare Fund Allocation: ${welfareNotes || 'Quarterly staff welfare fund allocation'}`,
        reference_number: `WEL-${Math.random().toString(36).slice(-6).toUpperCase()}`,
        type: 'outgoing',
        logged_by: profile?.fullName || profile?.email || 'Authorized Finance',
        created_at: new Date().toISOString()
      });
      await financeWrites.commit();
      financeMessages.forEach(({kind,message})=>toast[kind](message));

      financeMessages.push({kind:'success',message:`Allocated UGX ${welfareAmount.toLocaleString()} from Petty Cash to Staff Welfare Fund successfully.`});
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



  return (
    <div className="space-y-6">
      <FinancialPortfoliosPanel />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* PORTFOLIO 5: STAFF WELFARE FUND */}
        <div className="bg-[#7C3AED] text-white p-6 rounded-3xl shadow-sm flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
          <div className="absolute top-0 right-0 bg-white/10 p-4 rounded-bl-3xl text-white">
            <Users size={24} />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-black text-purple-200 uppercase tracking-widest block">Portfolio 5</span>
            <h3 className="text-lg font-black text-white">Staff Welfare Fund</h3>
            <p className="text-xs text-purple-100">Recorded funding allocations. A spendable reserve cannot be derived from EOD declarations.</p>
          </div>
          <div className="my-5">
            <span className="text-2xl font-black font-mono block">
              Balance unavailable
            </span>
            <div className="mt-1 flex items-center gap-3 text-[10px] text-purple-200 font-bold">
              <span>Allocated: {memoizedCalculations.welfareAllocated?.toLocaleString()}</span>
              <span>Transferred: {memoizedCalculations.welfareTransferred?.toLocaleString()}</span>
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
