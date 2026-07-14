import React, { useState, useEffect } from 'react';
import { 
  Coins, 
  Settings, 
  Users, 
  Calculator, 
  Check, 
  AlertTriangle, 
  Trash2, 
  TrendingUp, 
  ShoppingBag,
  Building2
} from 'lucide-react';
import { firestoreService } from '../../services/firestore';
import { Client, PharmPointsSettings, PharmPointsTransaction, Sale } from '../../types';
import { toast } from 'sonner';

interface LoyaltyPillarProps {
  tenantId: string;
  role: string;
}

export const LoyaltyPillar: React.FC<LoyaltyPillarProps> = ({ tenantId, role }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [institutions, setInstitutions] = useState<any[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [settings, setSettings] = useState<PharmPointsSettings | null>(null);
  const [transactions, setTransactions] = useState<PharmPointsTransaction[]>([]);
  
  // Tab states
  const [activeLoyaltySubTab, setActiveLoyaltySubTab] = useState<'config' | 'points' | 'pos'>('points');
  const [directoryTab, setDirectoryTab] = useState<'patient' | 'institution'>('patient');

  // Loyalty rewards period filters
  const [loyaltyStartDate, setLoyaltyStartDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return d.toISOString().split('T')[0];
  });
  const [loyaltyEndDate, setLoyaltyEndDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [pointsSearchQuery, setPointsSearchQuery] = useState<string>('');

  // Config fields
  const [ratio, setRatio] = useState(1000); // 1000 UGX = 1 Pt
  const [val, setVal] = useState(10); // 1 Pt = 10 UGX
  const [minThreshold, setMinThreshold] = useState(50); // Min pts to redeem
  const [capPct, setCapPct] = useState(20); // Cap per buy

  // POS Checkout Widget states
  const [posAccountType, setPosAccountType] = useState<'patient' | 'institution'>('patient');
  const [posSelectedClient, setPosSelectedClient] = useState<string>('');
  const [posStandardGoods, setPosStandardGoods] = useState<number>(50000);
  const [posPOMGoods, setPosPOMGoods] = useState<number>(30000);
  const [posRedeemPointsAttempt, setPosRedeemPointsAttempt] = useState<number>(0);
  const [isSimulating, setIsSimulating] = useState(false);

  // Calculates points earned specifically in the filtered period
  const getPointsEarnedInPeriod = (clientId: string, isInst: boolean) => {
    const txPts = transactions
      .filter(t => t.clientId === clientId && t.type === 'earn' && (!loyaltyStartDate || t.date >= loyaltyStartDate) && (!loyaltyEndDate || t.date <= loyaltyEndDate))
      .reduce((sum, t) => sum + (t.points || 0), 0);
      
    const salesPts = sales
      .filter(s => {
        const matchesId = isInst ? s.institutionId === clientId : (s.patientId === clientId || s.clientId === clientId);
        if (!matchesId) return false;
        const date = s.timestamp ? s.timestamp.split('T')[0] : '';
        return (!loyaltyStartDate || date >= loyaltyStartDate) && (!loyaltyEndDate || date <= loyaltyEndDate);
      })
      .reduce((sum, s) => sum + Math.floor(s.total / (settings?.earningRatio || 1000)), 0);

    return txPts + salesPts;
  };

  const handleDownloadLoyaltyReport = () => {
    const records = directoryTab === 'patient' 
      ? clients.map(c => {
          const pts = getPointsEarnedInPeriod(c.id, false);
          return {
            name: c.full_name || c.name || 'Unknown Patient',
            phone: c.phone_number || c.phone || '',
            type: 'Patient/Client',
            pointsEarned: pts,
            cashEquivalent: pts * (settings?.redemptionValue || 10)
          };
        })
      : institutions.map(i => {
          const pts = getPointsEarnedInPeriod(i.id, true);
          return {
            name: i.supplier_name || i.name || 'Unknown Institution',
            phone: i.phone_number || i.phone || i.institution_phone || '',
            type: 'Institution',
            pointsEarned: pts,
            cashEquivalent: pts * (settings?.redemptionValue || 10)
          };
        });

    const headers = ['Account Name', 'Phone', 'Account Type', `Points Earned (${loyaltyStartDate} to ${loyaltyEndDate})`, 'Cash Equivalent (UGX)'];
    const rows = records.map(r => [
      r.name,
      r.phone,
      r.type,
      r.pointsEarned,
      r.cashEquivalent
    ]);

    const content = [
      headers.join(','),
      ...rows.map(row => row.map(val => {
        const str = (val === null || val === undefined) ? '' : String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(','))
    ].join('\n');

    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Loyalty_Points_Report_${loyaltyStartDate}_to_${loyaltyEndDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Loyalty reward report downloaded!');
  };

  const handleCheckoutReward = async (accountId: string, isInst: boolean) => {
    const pts = getPointsEarnedInPeriod(accountId, isInst);
    if (pts <= 0) {
      toast.error('No points earned during this period to checkout.');
      return;
    }
    
    const account = isInst 
      ? institutions.find(i => i.id === accountId)
      : clients.find(c => c.id === accountId);
    
    const accountName = isInst 
      ? (account?.supplier_name || account?.name || 'Institution')
      : (account?.full_name || account?.name || 'Customer');
    const cashEquivalent = pts * (settings?.redemptionValue || 10);

    if (!window.confirm(`Confirm checking out ${pts} points (Value: UGX ${cashEquivalent.toLocaleString()}) as a cash reward for ${accountName}?`)) {
      return;
    }

    try {
      // 1. Add redemption transaction
      await firestoreService.addDocument('pharmpoints_transactions', {
        tenantId,
        clientId: accountId,
        clientName: accountName,
        type: 'redeem',
        points: pts,
        equivalentUgx: cashEquivalent,
        receiptNumber: `RWD-${Date.now().toString().slice(-6)}`,
        date: new Date().toISOString().split('T')[0]
      });

      // 2. Subtract points from their current loyalty balance
      const currentPts = isInst ? getInstitutionPoints(account) : getClientPoints(account);
      const newPts = Math.max(0, currentPts - pts);
      const targetCollection = isInst ? 'institutions' : 'clients';
      await firestoreService.updateDocument(targetCollection, accountId, {
        loyalty_points: newPts
      });

      // 3. Subtract from available amount in cost ledger (record as direct reward marketing expense)
      await firestoreService.addDocument('marketing_expenses', {
        tenantId,
        category: 'PharmPoints Loyalty',
        subCategory: 'Direct Reward Checkout',
        amount: cashEquivalent,
        description: `Direct loyalty cash reward payout checked out for ${accountName} (Redeemed: ${pts} pts)`,
        date: new Date().toISOString().split('T')[0],
        loggedBy: role,
        status: 'approved'
      });

      toast.success(`Disbursed cash reward of UGX ${cashEquivalent.toLocaleString()} and logged to cost ledger expenses.`);
    } catch {
      toast.error('Failed to checkout reward.');
    }
  };

  useEffect(() => {
    if (tenantId) {
      firestoreService.subscribeToCollection<Client>('clients', tenantId, setClients);
      firestoreService.subscribeToCollection<any>('institutions', tenantId, setInstitutions);
      firestoreService.subscribeToCollection<Sale>('sales', tenantId, setSales);
      firestoreService.subscribeToCollection<PharmPointsTransaction>('pharmpoints_transactions', tenantId, setTransactions);
      
      // Fetch settings or create
      firestoreService.getDocumentsByField<PharmPointsSettings>('pharmpoints_settings', 'tenantId', tenantId).then(docs => {
        if (docs.length > 0) {
          const s = docs[0];
          setSettings(s);
          setRatio(s.earningRatio);
          setVal(s.redemptionValue);
          setMinThreshold(s.minimumRedemptionThreshold);
          setCapPct(s.maximumRedemptionCapPercent);
        } else {
          // Add default config
          const defaultSpec: any = {
            tenantId,
            earningRatio: 1000,
            redemptionValue: 10,
            minimumRedemptionThreshold: 50,
            maximumRedemptionCapPercent: 20,
            pointsExpiryPeriodMonths: 24,
            refillReminderBufferDays: 3
          };
          firestoreService.addDocument('pharmpoints_settings', defaultSpec).then(id => {
            setSettings({ id, ...defaultSpec });
          });
        }
      });
    }
  }, [tenantId]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    try {
      await firestoreService.updateDocument('pharmpoints_settings', settings.id, {
        earningRatio: Number(ratio),
        redemptionValue: Number(val),
        minimumRedemptionThreshold: Number(minThreshold),
        maximumRedemptionCapPercent: Number(capPct)
      });
      // reload
      setSettings({
        ...settings,
        earningRatio: Number(ratio),
        redemptionValue: Number(val),
        minimumRedemptionThreshold: Number(minThreshold),
        maximumRedemptionCapPercent: Number(capPct)
      });
      toast.success('PharmPoints configuration updated');
    } catch {
      toast.error('Failed to update config');
    }
  };

  // Helper to compute points based on document loyalty_points and historical sales
  const getClientPoints = (c: Client) => {
    const basePoints = c.loyalty_points || 0;
    const salesPoints = sales
      .filter(s => (s.patientId === c.id || s.clientId === c.id))
      .reduce((sum, s) => sum + Math.floor(s.total / earningRatio), 0);
    return basePoints + salesPoints;
  };

  const getInstitutionPoints = (inst: any) => {
    const basePoints = inst.loyalty_points || 0;
    const salesPoints = sales
      .filter(s => s.institutionId === inst.id)
      .reduce((sum, s) => sum + Math.floor(s.total / earningRatio), 0);
    return basePoints + salesPoints;
  };

  // Simulated calculations
  const earningRatio = settings?.earningRatio || 1000;
  const redemptionValue = settings?.redemptionValue || 10;
  const minimumRedemptionThreshold = settings?.minimumRedemptionThreshold || 50;
  const maximumRedemptionCapPercent = settings?.maximumRedemptionCapPercent || 20;

  const currentAccount = posAccountType === 'patient'
    ? clients.find(c => c.id === posSelectedClient)
    : institutions.find(i => i.id === posSelectedClient);

  const clientPoints = currentAccount ? (
    posAccountType === 'patient'
      ? getClientPoints(currentAccount)
      : getInstitutionPoints(currentAccount)
  ) : 0;

  // POM Exclusion rules!
  // Points are earned ONLY standard goods
  const pointsEarnedSimulated = Math.floor(posStandardGoods / earningRatio);
  
  // Redemption restriction check:
  // Cannot redeem points value larger than standard goods value or 20% cap
  const maxRedeemablePointsByCapAndStandard = Math.min(
    clientPoints,
    // total standard goods limit in points value
    Math.floor(posStandardGoods / redemptionValue),
    // cap percentage limit (20% of standard goods or total basket? Standard goods to be safe!)
    Math.floor((posStandardGoods * (maximumRedemptionCapPercent / 100)) / redemptionValue)
  );

  const checkoutSimulate = async () => {
    if (!posSelectedClient) {
      toast.error('Please select a client or institution to simulate the loyalty transaction');
      return;
    }
    if (posRedeemPointsAttempt > clientPoints) {
      toast.error(`Account only has ${clientPoints} points.`);
      return;
    }
    if (posRedeemPointsAttempt > 0 && posRedeemPointsAttempt < minimumRedemptionThreshold) {
      toast.error(`Minimum points redemption threshold is ${minimumRedemptionThreshold} keys.`);
      return;
    }
    if (posRedeemPointsAttempt > maxRedeemablePointsByCapAndStandard) {
      toast.error(`Max allowed pts for this basket size and capping is ${maxRedeemablePointsByCapAndStandard} points.`);
      return;
    }

    setIsSimulating(true);

    try {
      const discountUgx = posRedeemPointsAttempt * redemptionValue;
      const totalOriginalBill = posStandardGoods + posPOMGoods;
      const finalPaidBill = totalOriginalBill - discountUgx;
      const receiptId = `SIM-${Date.now().toString().slice(-6)}`;
      const accountName = posAccountType === 'institution'
        ? (currentAccount?.supplier_name || currentAccount?.name || 'Institution')
        : (currentAccount?.full_name || currentAccount?.name || 'Customer');

      // 1. Earn transaction
      if (pointsEarnedSimulated > 0) {
        await firestoreService.addDocument('pharmpoints_transactions', {
          tenantId,
          clientId: posSelectedClient,
          clientName: accountName,
          type: 'earn',
          points: pointsEarnedSimulated,
          equivalentUgx: pointsEarnedSimulated * redemptionValue,
          receiptNumber: receiptId,
          date: new Date().toISOString().split('T')[0]
        });
      }

      // 2. Redemption transaction
      if (posRedeemPointsAttempt > 0) {
        await firestoreService.addDocument('pharmpoints_transactions', {
          tenantId,
          clientId: posSelectedClient,
          clientName: accountName,
          type: 'redeem',
          points: posRedeemPointsAttempt,
          equivalentUgx: discountUgx,
          receiptNumber: receiptId,
          date: new Date().toISOString().split('T')[0]
        });

        // Write simulated marketing discount expense to Cost Ledger
        await firestoreService.addDocument('marketing_expenses', {
          tenantId,
          category: 'PharmPoints Loyalty',
          subCategory: 'Client Redemption Discount',
          amount: discountUgx,
          description: `Loyalty point discount redeemed by ${accountName} on invoice ${receiptId}`,
          date: new Date().toISOString().split('T')[0],
          loggedBy: role,
          status: 'approved'
        });
      }

      // 3. Update points balance on Firestore document
      const newPointsBalance = clientPoints + pointsEarnedSimulated - posRedeemPointsAttempt;
      const targetCollection = posAccountType === 'institution' ? 'institutions' : 'clients';
      await firestoreService.updateDocument(targetCollection, posSelectedClient, {
        loyalty_points: newPointsBalance
      });

      toast.success(`Checkout Successful! Points earned: +${pointsEarnedSimulated}. Redeemed points value: UGX ${discountUgx.toLocaleString()}`);
      
      // Reset POS form
      setPosRedeemPointsAttempt(0);
      setPosSelectedClient('');
    } catch {
      toast.error('Simulated transaction failed.');
    } finally {
      setIsSimulating(false);
    }
  };

  const isHeadOrIT = role === 'Marketing Head' || role === 'IT Head' || role === 'admin' || role === 'owner' || role === 'CEO' || role === 'CEO / MD';

  return (
    <div className="space-y-6">
      {/* Sub tabs */}
      <div className="flex border-b border-zinc-200">
        <button
          onClick={() => setActiveLoyaltySubTab('points')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
            activeLoyaltySubTab === 'points' ? 'border-zinc-900 text-zinc-950 bg-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Users size={16} /> Points Balances & Ledger
        </button>
        <button
          onClick={() => setActiveLoyaltySubTab('pos')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
            activeLoyaltySubTab === 'pos' ? 'border-zinc-900 text-zinc-950 bg-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <ShoppingBag size={16} /> Checkout Earning/Redeem Simulator
        </button>
        <button
          onClick={() => setActiveLoyaltySubTab('config')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
            activeLoyaltySubTab === 'config' ? 'border-zinc-900 text-zinc-950 bg-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Settings size={16} /> Specifications Settings
        </button>
      </div>

      {activeLoyaltySubTab === 'points' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Customer Balances */}
          <div className="lg:col-span-2 bg-white rounded-3xl border border-zinc-200 shadow-sm p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight">Active loyalty points directory</h3>
                <p className="text-zinc-500 text-xs">Track client points balances and cash-redeemable potential value.</p>
              </div>
              <div className="flex bg-zinc-100 p-1 rounded-xl text-[10px] font-bold uppercase tracking-wider self-start sm:self-center">
                <button
                  onClick={() => setDirectoryTab('patient')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    directoryTab === 'patient' ? 'bg-white text-zinc-950 shadow-xs font-black' : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  Patients/Clients ({clients.length})
                </button>
                <button
                  onClick={() => setDirectoryTab('institution')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    directoryTab === 'institution' ? 'bg-white text-zinc-950 shadow-xs font-black' : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  Institutions ({institutions.length})
                </button>
              </div>
            </div>

            {/* Date range filter card with download report action */}
            <div className="bg-zinc-50 border border-zinc-150 p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-zinc-500 uppercase">From</span>
                  <input 
                    type="date"
                    value={loyaltyStartDate}
                    onChange={(e) => setLoyaltyStartDate(e.target.value)}
                    className="bg-white border border-zinc-200 text-xs font-semibold px-2.5 py-1.5 rounded-xl outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-zinc-500 uppercase">To</span>
                  <input 
                    type="date"
                    value={loyaltyEndDate}
                    onChange={(e) => setLoyaltyEndDate(e.target.value)}
                    className="bg-white border border-zinc-200 text-xs font-semibold px-2.5 py-1.5 rounded-xl outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-zinc-500 uppercase">Search</span>
                  <input 
                    type="text"
                    placeholder="Search name or phone..."
                    value={pointsSearchQuery}
                    onChange={(e) => setPointsSearchQuery(e.target.value)}
                    className="bg-white border border-zinc-200 text-xs font-semibold px-2.5 py-1.5 rounded-xl outline-none text-zinc-900 w-44"
                  />
                </div>
              </div>
              <button
                onClick={handleDownloadLoyaltyReport}
                className="bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-1.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-xs"
              >
                Download Excel Report
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500 font-bold uppercase border-b border-zinc-200">
                    <th className="px-4 py-3">{directoryTab === 'patient' ? 'Client' : 'Institution'}</th>
                    <th className="px-4 py-3 text-center">Lifetime Points</th>
                    <th className="px-4 py-3 text-center">Points In Period</th>
                    <th className="px-4 py-3 text-right">Cash Value (UGX)</th>
                    <th className="px-4 py-3 text-right">Reward Operations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 font-medium">
                  {directoryTab === 'patient' ? (
                    clients
                      .filter(c => {
                        if (!pointsSearchQuery) return true;
                        const q = pointsSearchQuery.toLowerCase();
                        const name = c.full_name || c.name || '';
                        const phone = c.phone_number || c.phone || '';
                        return name.toLowerCase().includes(q) || phone.includes(q);
                      })
                      .map(c => {
                        const totalPts = getClientPoints(c);
                        const periodPts = getPointsEarnedInPeriod(c.id, false);
                        const cashVal = periodPts * redemptionValue;
                        return (
                          <tr key={c.id} className="hover:bg-zinc-50/50 transition-colors">
                            <td className="px-4 py-3">
                              <span className="font-bold text-zinc-950">{c.full_name || c.name || 'Unknown Patient'}</span>
                              <div className="text-[10px] text-zinc-400">{c.phone_number || c.phone || 'N/A'}</div>
                            </td>
                            <td className="px-4 py-3 text-center font-mono text-zinc-500 font-semibold">
                              {totalPts} pts
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-xs font-black text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full font-mono">
                                {periodPts} pts
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-emerald-600 font-extrabold font-mono">
                              UGX {cashVal.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleCheckoutReward(c.id, false)}
                                disabled={periodPts <= 0}
                                className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed font-bold uppercase text-[9px] tracking-wider px-3 py-1.5 rounded-xl transition-all"
                              >
                                Disburse Cash
                              </button>
                            </td>
                          </tr>
                        );
                      })
                  ) : (
                    institutions
                      .filter(inst => {
                        if (!pointsSearchQuery) return true;
                        const q = pointsSearchQuery.toLowerCase();
                        const name = inst.supplier_name || inst.name || '';
                        const phone = inst.phone_number || inst.phone || inst.institution_phone || '';
                        return name.toLowerCase().includes(q) || phone.includes(q);
                      })
                      .map(inst => {
                        const totalPts = getInstitutionPoints(inst);
                        const periodPts = getPointsEarnedInPeriod(inst.id, true);
                        const cashVal = periodPts * redemptionValue;
                        return (
                          <tr key={inst.id} className="hover:bg-zinc-50/50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Building2 size={14} className="text-zinc-400" />
                                <span className="font-bold text-zinc-950">{inst.supplier_name || inst.name || 'Unknown Institution'}</span>
                              </div>
                              <div className="text-[10px] text-zinc-400">{inst.phone_number || inst.phone || inst.institution_phone || 'N/A'}</div>
                            </td>
                            <td className="px-4 py-3 text-center font-mono text-zinc-500 font-semibold">
                              {totalPts} pts
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-xs font-black text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full font-mono">
                                {periodPts} pts
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-emerald-600 font-extrabold font-mono">
                              UGX {cashVal.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleCheckoutReward(inst.id, true)}
                                disabled={periodPts <= 0}
                                className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed font-bold uppercase text-[9px] tracking-wider px-3 py-1.5 rounded-xl transition-all"
                              >
                                Disburse Cash
                              </button>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Points Transactions log */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-3xl p-6 space-y-4">
            <div>
              <h4 className="font-bold text-zinc-900 text-sm uppercase tracking-tight flex items-center gap-2">
                <Coins size={16} /> Points Ledger Activity
              </h4>
              <p className="text-zinc-500 text-xs mt-1">Audit trail of points accumulation and deductions (including real sales).</p>
            </div>

            <div className="space-y-3 max-h-[350px] overflow-y-auto">
              {(() => {
                const combinedLedger = [
                  ...transactions.map(t => ({
                    id: t.id,
                    clientName: t.clientName,
                    date: t.date,
                    receiptNumber: t.receiptNumber,
                    points: t.points,
                    type: t.type
                  })),
                  ...sales
                    .filter(s => s.patientId || s.clientId || s.institutionId)
                    .map(s => {
                      const clientName = s.patientName || s.institutionName || 'Client';
                      const date = s.timestamp ? s.timestamp.split('T')[0] : '';
                      const pts = Math.floor(s.total / earningRatio);
                      return {
                        id: s.id,
                        clientName,
                        date,
                        receiptNumber: s.receiptNumber,
                        points: pts,
                        type: 'earn' as const
                      };
                    })
                ].sort((a, b) => b.date.localeCompare(a.date));

                const filteredLedger = combinedLedger.filter(t => {
                  if (loyaltyStartDate && t.date < loyaltyStartDate) return false;
                  if (loyaltyEndDate && t.date > loyaltyEndDate) return false;
                  if (pointsSearchQuery) {
                    const q = pointsSearchQuery.toLowerCase();
                    return t.clientName.toLowerCase().includes(q);
                  }
                  return true;
                });

                if (filteredLedger.length === 0) {
                  return <div className="text-zinc-400 text-center py-12 text-xs">No points events matching filters.</div>;
                }

                return filteredLedger.map((t, i) => (
                  <div key={t.id || i} className="p-3 bg-white border border-zinc-100 rounded-2xl flex items-center justify-between shadow-xs">
                    <div>
                      <p className="font-bold text-zinc-900 text-xs">{t.clientName}</p>
                      <p className="text-[10px] text-zinc-400 font-mono">{t.date} | Invoice: {t.receiptNumber}</p>
                    </div>
                    <span className={`text-[11px] font-black font-mono ${
                      t.type === 'earn' ? 'text-emerald-700' : 'text-red-700'
                    }`}>
                      {t.type === 'earn' ? '+' : '-'}{t.points} pts
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {activeLoyaltySubTab === 'pos' && (
        <div className="bg-white rounded-3xl border border-zinc-200 p-6 space-y-6 shadow-sm">
          <div>
            <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight flex items-center gap-2">
              <Calculator size={20} /> Point of Sale checkout and points Simulator
            </h3>
            <p className="text-zinc-500 text-xs">Test and demonstrate point calculations. Real-life POM exclusions are strictly enforced!</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Account Type</label>
                  <div className="flex bg-zinc-100 p-1 rounded-xl text-[10px] font-bold uppercase tracking-wider">
                    <button
                      type="button"
                      onClick={() => {
                        setPosAccountType('patient');
                        setPosSelectedClient('');
                        setPosRedeemPointsAttempt(0);
                      }}
                      className={`flex-1 py-1.5 rounded-lg transition-all ${
                        posAccountType === 'patient' ? 'bg-white text-zinc-950 shadow-xs font-black' : 'text-zinc-500 hover:text-zinc-800'
                      }`}
                    >
                      Patient/Client
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPosAccountType('institution');
                        setPosSelectedClient('');
                        setPosRedeemPointsAttempt(0);
                      }}
                      className={`flex-1 py-1.5 rounded-lg transition-all ${
                        posAccountType === 'institution' ? 'bg-white text-zinc-950 shadow-xs font-black' : 'text-zinc-500 hover:text-zinc-800'
                      }`}
                    >
                      Institution
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Select Account Profile</label>
                  <select
                    value={posSelectedClient}
                    onChange={e => {
                      setPosSelectedClient(e.target.value);
                      setPosRedeemPointsAttempt(0);
                    }}
                    className="w-full px-3 py-2 bg-white text-zinc-900 border border-zinc-200 rounded-xl text-xs font-semibold"
                  >
                    <option value="" className="text-zinc-900 bg-white">-- Choose Account --</option>
                    {posAccountType === 'patient' ? (
                      clients.map(c => (
                        <option key={c.id} value={c.id} className="text-zinc-900 bg-white">
                          {c.full_name || c.name || 'Unknown Patient'} ({getClientPoints(c)} pts)
                        </option>
                      ))
                    ) : (
                      institutions.map(i => (
                        <option key={i.id} value={i.id} className="text-zinc-900 bg-white">
                          {i.supplier_name || i.name || 'Unknown Institution'} ({getInstitutionPoints(i)} pts)
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Basket Standard Goods value (UGX)</label>
                  <input
                    type="number"
                    value={posStandardGoods}
                    onChange={e => {
                      setPosStandardGoods(Number(e.target.value));
                      setPosRedeemPointsAttempt(0);
                    }}
                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-semibold font-mono"
                  />
                  <span className="text-[9px] text-zinc-400">Earns points. Accepts redemption discount.</span>
                </div>

                <div className="space-y-1 col-span-1 md:col-span-2">
                  <div className="flex justify-between items-center bg-red-50/50 p-3 rounded-2xl border border-red-100/70">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-red-600 uppercase tracking-wider flex items-center gap-1">
                        <AlertTriangle size={12} /> POM / Controlled Medicine amount (UGX)
                      </label>
                      <input
                        type="number"
                        value={posPOMGoods}
                        onChange={e => {
                          setPosPOMGoods(Number(e.target.value));
                          setPosRedeemPointsAttempt(0);
                        }}
                        className="px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-xs font-semibold font-mono"
                      />
                    </div>
                    <span className="text-[10px] text-red-700 max-w-sm font-medium">
                      Excluded by regulation from earning PharmPoints. Point discount cannot apply to this subtotal fraction.
                    </span>
                  </div>
                </div>
              </div>

              {posSelectedClient && (
                <div className="bg-zinc-50 p-4 rounded-3xl border border-zinc-200 space-y-3">
                  <h4 className="text-xs font-black uppercase text-zinc-500 tracking-wider">Configure Points Redemption</h4>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-semibold">
                      <span>Available Points Balance:</span>
                      <span className="font-bold text-amber-600">{clientPoints} pts</span>
                    </div>
                    <div className="flex justify-between text-xs font-semibold">
                      <span>Cap Limit Points redeemable:</span>
                      <span className="font-bold text-zinc-700">{maxRedeemablePointsByCapAndStandard} pts</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={maxRedeemablePointsByCapAndStandard}
                        value={posRedeemPointsAttempt}
                        onChange={e => setPosRedeemPointsAttempt(Number(e.target.value))}
                        className="flex-1 focus:ring-0"
                      />
                      <span className="text-sm font-bold font-mono min-w-[60px] text-zinc-900">
                        {posRedeemPointsAttempt} pts
                      </span>
                    </div>

                    <div className="flex justify-between text-xs pt-1 border-t border-zinc-200/50">
                      <span>Redemption Savings:</span>
                      <span className="text-red-700 font-bold">-UGX {(posRedeemPointsAttempt * redemptionValue).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Calculations right panel */}
            <div className="bg-zinc-950 text-white rounded-3xl p-6 space-y-4">
              <h4 className="font-bold text-sm uppercase tracking-widest text-zinc-400">Checkout Bill Summary</h4>
              
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Standard Goods subtotal:</span>
                  <span className="font-mono font-bold">UGX {posStandardGoods.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">POM Medicine subtotal:</span>
                  <span className="font-mono font-bold">UGX {posPOMGoods.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-b border-zinc-800 pb-2">
                  <span className="text-zinc-400">Total Original Bill:</span>
                  <span className="font-mono font-bold">UGX {(posStandardGoods + posPOMGoods).toLocaleString()}</span>
                </div>
                {posRedeemPointsAttempt > 0 && (
                  <div className="flex justify-between text-red-400">
                    <span>Points Redemptions saving:</span>
                    <span className="font-mono font-bold">-UGX {(posRedeemPointsAttempt * redemptionValue).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm py-2 font-black tracking-tight border-b border-zinc-800">
                  <span>Simulated Net Paid:</span>
                  <span className="text-emerald-500 font-mono">UGX {(posStandardGoods + posPOMGoods - (posRedeemPointsAttempt * redemptionValue)).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-emerald-400 font-medium py-1">
                  <span>Loyalty Points Earning:</span>
                  <span className="font-bold font-mono">+{pointsEarnedSimulated} Pts</span>
                </div>
              </div>

              <button
                onClick={checkoutSimulate}
                disabled={isSimulating}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-800 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-1.5"
              >
                {isSimulating ? 'Processing...' : 'Post Simulated Checkout Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeLoyaltySubTab === 'config' && (
        <div className="bg-white rounded-3xl border border-zinc-200 p-6 space-y-4 shadow-sm max-w-2xl">
          <div>
            <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight">PharmPoints spec engine setup</h3>
            <p className="text-zinc-500 text-xs">Configure conversion parameters. Custom adjustments require suitable roles constraint.</p>
          </div>

          <form onSubmit={handleSaveConfig} className="space-y-4 text-xs font-semibold">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Earning Ratio (UGX spent per point)</label>
                <input
                  disabled={!isHeadOrIT}
                  type="number"
                  value={ratio}
                  onChange={e => setRatio(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl"
                />
                <span className="text-[9px] text-zinc-400 font-normal">Standard 1000 means 1 point earned per 1,000 UGX.</span>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Redemption Value (UGX saving per point)</label>
                <input
                  disabled={!isHeadOrIT}
                  type="number"
                  value={val}
                  onChange={e => setVal(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl"
                />
                <span className="text-[9px] text-zinc-400 font-normal">Standard 10 means each point reduces bill by 10 UGX.</span>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Minimum points Threshold to redeem</label>
                <input
                  disabled={!isHeadOrIT}
                  type="number"
                  value={minThreshold}
                  onChange={e => setMinThreshold(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl"
                />
                <span className="text-[9px] text-zinc-400 font-normal">Prevents micro-redemptions. Customer must hold at least this total.</span>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Maximum Redemption Capping Percent (%)</label>
                <input
                  disabled={!isHeadOrIT}
                  type="number"
                  value={capPct}
                  onChange={e => setCapPct(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl"
                />
                <span className="text-[9px] text-zinc-400 font-normal">Limits the total points share contribution to basket transaction (e.g. 20%).</span>
              </div>
            </div>

            {isHeadOrIT ? (
              <button
                type="submit"
                className="px-6 py-2 bg-zinc-950 text-white hover:bg-zinc-850 font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-xs"
              >
                Update Specifications
              </button>
            ) : (
              <div className="p-3 bg-red-50 text-red-700 rounded-xl border border-red-100 flex items-center gap-2 text-xs">
                <AlertTriangle size={16} /> Specifications modifications is reserved for Marketing Head or IT Head.
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
};
