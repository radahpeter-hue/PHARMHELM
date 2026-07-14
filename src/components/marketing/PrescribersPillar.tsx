import React, { useState, useEffect } from 'react';
import { 
  Award, 
  UserCheck, 
  UserMinus, 
  Plus, 
  HelpCircle, 
  TrendingUp, 
  Check, 
  AlertCircle 
} from 'lucide-react';
import { firestoreService } from '../../services/firestore';
import { Prescriber } from '../../types';
import { toast } from 'sonner';

interface PrescribersPillarProps {
  tenantId: string;
  role: string;
}

export const PrescribersPillar: React.FC<PrescribersPillarProps> = ({ tenantId, role }) => {
  const [prescribers, setPrescribers] = useState<Prescriber[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'tracker' | 'disburse'>('tracker');
  const [disbursements, setDisbursements] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [institutions, setInstitutions] = useState<any[]>([]);
  const [selectedCrmPrescriberId, setSelectedCrmPrescriberId] = useState<string>('');
  const [enrollMethod, setEnrollMethod] = useState<'crm' | 'manual'>('crm');

  // Date range filters for Prescriber Rewards
  const [prescriberStartDate, setPrescriberStartDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return d.toISOString().split('T')[0];
  });
  const [prescriberEndDate, setPrescriberEndDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Dynamic reward parameters: reward amount per 10,000 UGX sales
  const [rewardRatePerTenThousand, setRewardRatePerTenThousand] = useState<number>(500);

  // Enrollment fields
  const [name, setName] = useState('');
  const [lic, setLic] = useState('');
  const [fac, setFac] = useState('');
  const [isKOL, setIsKOL] = useState(false);
  const [kolCat, setKolCat] = useState<'Doctor' | 'Health Influencer' | 'Community Leader' | 'Corporate HR' | 'Other'>('Doctor');

  useEffect(() => {
    if (tenantId) {
      firestoreService.subscribeToCollection<Prescriber>('prescribers', tenantId, setPrescribers);
      firestoreService.subscribeToCollection<any>('prescriber_disbursements', tenantId, setDisbursements);
      firestoreService.subscribeToCollection<any>('sales', tenantId, setSales);
      firestoreService.subscribeToCollection<any>('institutions', tenantId, setInstitutions);
    }
  }, [tenantId]);

  const getInstitutionName = (id: string) => {
    if (!id) return '';
    const inst = institutions.find(i => i.id === id);
    return inst ? inst.supplier_name : '';
  };

  const getPrescriberName = (p: Prescriber) => {
    return (p as any).full_name || p.name || 'Unknown Doctor';
  };

  const getPrescriberLicense = (p: Prescriber) => {
    return (p as any).professional_licence_number || p.licenseNumber || 'N/A';
  };

  const getPrescriberFacility = (p: Prescriber) => {
    const pAny = p as any;
    if (pAny.institution_id) {
      return getInstitutionName(pAny.institution_id);
    }
    return p.facility || 'N/A';
  };

  const getPrescriberSalesInPeriod = (pId: string, pName: string) => {
    const pNameLower = typeof pName === 'string' ? pName.toLowerCase() : '';
    const salesList = sales || [];
    
    return salesList
      .filter(s => {
        if (!s) return false;
        const matchesPrescriber = (pId && s.prescriberId === pId) || 
          (s.prescriberName && typeof s.prescriberName === 'string' && s.prescriberName.toLowerCase() === pNameLower);
        if (!matchesPrescriber) return false;
        
        // Robust date parsing for Firebase Timestamp or String timestamp or date field
        let date = '';
        const ts = s.timestamp || s.date;
        if (ts) {
          if (typeof ts === 'string') {
            date = ts.split('T')[0];
          } else if (typeof ts === 'object') {
            if (typeof ts.toDate === 'function') {
              try {
                date = ts.toDate().toISOString().split('T')[0];
              } catch (e) {
                // ignore
              }
            } else if (typeof ts.seconds === 'number') {
              try {
                date = new Date(ts.seconds * 1000).toISOString().split('T')[0];
              } catch (e) {
                // ignore
              }
            }
          }
        }
        
        return (!prescriberStartDate || date >= prescriberStartDate) && (!prescriberEndDate || date <= prescriberEndDate);
      })
      .reduce((sum, s) => sum + (s.total || s.totalAmount || 0), 0);
  };

  const getPrescriberScriptsInPeriod = (pId: string, pName: string) => {
    const pNameLower = typeof pName === 'string' ? pName.toLowerCase() : '';
    const salesList = sales || [];
    
    return salesList
      .filter(s => {
        if (!s) return false;
        const matchesPrescriber = (pId && s.prescriberId === pId) || 
          (s.prescriberName && typeof s.prescriberName === 'string' && s.prescriberName.toLowerCase() === pNameLower);
        if (!matchesPrescriber) return false;
        
        let date = '';
        const ts = s.timestamp || s.date;
        if (ts) {
          if (typeof ts === 'string') {
            date = ts.split('T')[0];
          } else if (typeof ts === 'object') {
            if (typeof ts.toDate === 'function') {
              try {
                date = ts.toDate().toISOString().split('T')[0];
              } catch (e) {
                // ignore
              }
            } else if (typeof ts.seconds === 'number') {
              try {
                date = new Date(ts.seconds * 1000).toISOString().split('T')[0];
              } catch (e) {
                // ignore
              }
            }
          }
        }
        
        return (!prescriberStartDate || date >= prescriberStartDate) && (!prescriberEndDate || date <= prescriberEndDate);
      }).length;
  };

  const handleDownloadPrescribersReport = () => {
    const records = prescribers.map(p => {
      const pName = getPrescriberName(p);
      const pLicense = getPrescriberLicense(p);
      const pFacility = getPrescriberFacility(p);
      const totalSales = getPrescriberSalesInPeriod(p.id, pName);
      const reward = Math.floor(totalSales / 10000) * rewardRatePerTenThousand;
      return {
        name: pName,
        license: pLicense,
        facility: pFacility,
        sales: totalSales,
        reward: reward,
        status: p.isEnrolledInRewardProgram ? 'Enrolled' : 'Not Enrolled'
      };
    });

    const headers = ['Doctor Name', 'License Number', 'Facility', `Period Sales (${prescriberStartDate} to ${prescriberEndDate})`, 'Period Reward (UGX)', 'Program Status'];
    const rows = records.map(r => [
      r.name,
      r.license,
      r.facility,
      r.sales,
      r.reward,
      r.status
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
    link.setAttribute('download', `Prescriber_Rewards_Report_${prescriberStartDate}_to_${prescriberEndDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Prescriber rewards report downloaded!');
  };

  const handleDisbursePrescriberReward = async (p: Prescriber) => {
    const pName = getPrescriberName(p);
    const pLicense = getPrescriberLicense(p);
    const totalSales = getPrescriberSalesInPeriod(p.id, pName);
    const reward = Math.floor(totalSales / 10000) * rewardRatePerTenThousand;
    if (reward <= 0) {
      toast.error('No calculated reward for this prescriber in this period.');
      return;
    }

    if (!window.confirm(`Confirm disbursing UGX ${reward.toLocaleString()} to Dr. ${pName}?`)) {
      return;
    }

    try {
      // 1. Add disbursement document
      await firestoreService.addDocument('prescriber_disbursements', {
        tenantId,
        prescriberId: p.id,
        prescriberName: pName,
        licenseNumber: pLicense,
        scriptsCount: Math.floor(totalSales / 10000),
        tierName: 'Referral Tally',
        payoutAmount: reward,
        month: `${prescriberStartDate} to ${prescriberEndDate}`,
        status: 'Approved',
        approvedBy: role,
        approvedAt: new Date().toISOString()
      });

      // 2. Post as marketing expense (reduces available funds in Cost Ledger)
      await firestoreService.addDocument('marketing_expenses', {
        tenantId,
        category: 'Prescriber Reward Programme',
        subCategory: 'Rewards Disbursement',
        amount: reward,
        description: `Verified referral rewards disbursement for Dr. ${pName} based on sales of UGX ${totalSales.toLocaleString()} in period ${prescriberStartDate} to ${prescriberEndDate}.`,
        date: new Date().toISOString().split('T')[0],
        loggedBy: role,
        status: 'approved'
      });

      toast.success(`Disbursement of UGX ${reward.toLocaleString()} approved and posted to Cost Ledger!`);
    } catch {
      toast.error('Failed to process disbursement.');
    }
  };

  const handleEnrollDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enrollMethod === 'crm') {
      if (!selectedCrmPrescriberId) {
        toast.error('Please select a CRM prescriber to enroll.');
        return;
      }
      const selectedDoc = prescribers.find(p => p.id === selectedCrmPrescriberId);
      if (!selectedDoc) return;
      const docName = getPrescriberName(selectedDoc);
      try {
        await firestoreService.updateDocument('prescribers', selectedCrmPrescriberId, {
          isEnrolledInRewardProgram: true,
          isKOL,
          keyOpinionLeaderCategory: isKOL ? kolCat : null
        });
        toast.success(`Enrolled Dr. ${docName} from CRM into Reward Program`);
        setSelectedCrmPrescriberId('');
        setIsKOL(false);
      } catch {
        toast.error('Failed to enroll prescriber');
      }
    } else {
      if (!name || !lic) {
        toast.error('Please provide name and license.');
        return;
      }
      try {
        await firestoreService.addDocument('prescribers', {
          tenantId,
          full_name: name,
          professional_licence_number: lic,
          facility: fac,
          specialty: 'General Practice',
          isEnrolledInRewardProgram: true,
          isKOL,
          keyOpinionLeaderCategory: isKOL ? kolCat : null,
          monthlyPrescriptions: Math.floor(Math.random() * 85) + 5
        });
        toast.success('Prescriber registered and enrolled in Reward Program');
        setName('');
        setLic('');
        setFac('');
        setIsKOL(false);
      } catch {
        toast.error('Enrollment failed');
      }
    }
  };

  const handleToggleRewardsEnrollment = async (doc: Prescriber) => {
    try {
      const current = !!doc.isEnrolledInRewardProgram;
      const docName = getPrescriberName(doc);
      await firestoreService.updateDocument('prescribers', doc.id, {
        isEnrolledInRewardProgram: !current
      });
      toast.success(`Rewards status ${!current ? 'enlisted' : 'withdrawn'} for Dr. ${docName}`);
    } catch {
      toast.error('Failed to change status');
    }
  };

  const handleToggleKOL = async (doc: Prescriber) => {
    try {
      const current = !!doc.isKOL;
      const docName = getPrescriberName(doc);
      await firestoreService.updateDocument('prescribers', doc.id, {
        isKOL: !current,
        keyOpinionLeaderCategory: !current ? 'Doctor' : undefined
      });
      toast.success(`KOL reputation designation ${!current ? 'added' : 'withdrawn'} for Dr. ${docName}`);
    } catch {
      toast.error('Designation failed');
    }
  };

  // Helper payouts tier
  const calculateRewardTier = (count: number) => {
    if (count >= 50) return { tier: 'Platinum Star', payout: count * 15000, rate: 15000 };
    if (count >= 25) return { tier: 'Gold Shield', payout: count * 10000, rate: 10000 };
    if (count >= 10) return { tier: 'Silver Leaf', payout: count * 5000, rate: 5000 };
    return { tier: 'Base Referral', payout: count * 2000, rate: 2000 };
  };

  // Generate Disbursements for approval
  const handleRaiseDisbursementsCycle = async () => {
    const activeDocList = prescribers.filter(p => p.isEnrolledInRewardProgram);
    if (activeDocList.length === 0) {
      toast.error('No doctors are actively enrolled in rewards programs.');
      return;
    }

    let raisedCount = 0;
    for (const doc of activeDocList) {
      const docName = getPrescriberName(doc);
      const docLicense = getPrescriberLicense(doc);
      
      // Calculate from actual POS sales in the period!
      const totalSales = getPrescriberSalesInPeriod(doc.id, docName);
      const scripts = getPrescriberScriptsInPeriod(doc.id, docName);
      
      if (totalSales === 0 && scripts === 0) continue;

      const { tier, payout } = calculateRewardTier(scripts);
      const periodReward = Math.floor(totalSales / 10000) * rewardRatePerTenThousand;
      const finalPayout = periodReward > 0 ? periodReward : payout;
      
      // Check if already raised for this period
      const periodKey = `${prescriberStartDate} to ${prescriberEndDate}`;
      const exists = disbursements.some(d => d.prescriberId === doc.id && d.status === 'Pending' && d.month === periodKey);
      if (!exists) {
        await firestoreService.addDocument('prescriber_disbursements', {
          tenantId,
          prescriberId: doc.id,
          prescriberName: docName,
          licenseNumber: docLicense,
          scriptsCount: scripts,
          tierName: tier,
          payoutAmount: finalPayout,
          month: periodKey,
          status: 'Pending'
        });
        raisedCount++;
      }
    }
    toast.success(`Successfully computed & raised ${raisedCount} rewards disbursements sheets based on POS sales.`);
  };

  const handleApproveDisbursement = async (item: any) => {
    try {
      await firestoreService.updateDocument('prescriber_disbursements', item.id, {
        status: 'Approved',
        approvedBy: role,
        approvedAt: new Date().toISOString()
      });

      // Post of payment to Finance branch expenses collection
      await firestoreService.addDocument('marketing_expenses', {
        tenantId,
        category: 'Prescriber Reward Programme',
        subCategory: 'Rewards Disbursement',
        amount: item.payoutAmount,
        description: `Referral rewards disbursement for Dr. ${item.prescriberName} for ${item.scriptsCount} scripts verified.`,
        date: new Date().toISOString().split('T')[0],
        loggedBy: role,
        status: 'approved'
      });

      toast.success(`Disbursement of UGX ${item.payoutAmount.toLocaleString()} Approved and posted to ledger!`);
    } catch {
      toast.error('Payout approval failed');
    }
  };

  const isHeadOrCEO = role === 'Marketing Head' || role === 'CEO' || role === 'admin';
  const crmPrescribersNotEnrolled = prescribers.filter(p => !p.isEnrolledInRewardProgram);

  return (
    <div className="space-y-6">
      {/* Sub tabs */}
      <div className="flex border-b border-zinc-200">
        <button
          onClick={() => setActiveSubTab('tracker')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
            activeSubTab === 'tracker' ? 'border-zinc-900 text-zinc-950 bg-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Award size={16} /> Enrolled Prescribers & KOL Tracker
        </button>
        <button
          onClick={() => setActiveSubTab('disburse')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
            activeSubTab === 'disburse' ? 'border-zinc-900 text-zinc-950 bg-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <TrendingUp size={16} /> Disbursements & Approvals
        </button>
      </div>

      {activeSubTab === 'tracker' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main List */}
          <div className="lg:col-span-2 bg-white border border-zinc-200 p-6 rounded-3xl shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight">Prescriber Referral Programme Directory</h3>
                <p className="text-zinc-500 text-xs">Manage medical referral incentive campaigns and tag Key Opinion Leaders (KOLs).</p>
              </div>
              <button
                onClick={handleRaiseDisbursementsCycle}
                className="bg-zinc-900 hover:bg-zinc-800 text-white px-3 py-1.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all self-start"
              >
                Compute Monthly Rewards
              </button>
            </div>

            {/* Filter and Settings Panel */}
            <div className="bg-zinc-50 border border-zinc-200 p-4 rounded-2xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-zinc-500 uppercase">From</span>
                    <input 
                      type="date"
                      value={prescriberStartDate}
                      onChange={(e) => setPrescriberStartDate(e.target.value)}
                      className="bg-white text-zinc-900 border border-zinc-200 text-xs font-semibold px-2.5 py-1.5 rounded-xl outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-zinc-500 uppercase">To</span>
                    <input 
                      type="date"
                      value={prescriberEndDate}
                      onChange={(e) => setPrescriberEndDate(e.target.value)}
                      className="bg-white text-zinc-900 border border-zinc-200 text-xs font-semibold px-2.5 py-1.5 rounded-xl outline-none"
                    />
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-zinc-500 uppercase">Payout / 10K UGX Sales</span>
                  <input 
                    type="number"
                    value={rewardRatePerTenThousand}
                    onChange={(e) => setRewardRatePerTenThousand(Number(e.target.value))}
                    className="bg-white text-zinc-900 border border-zinc-200 text-xs font-bold px-2.5 py-1.5 rounded-xl outline-none w-24 font-mono text-center"
                  />
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-zinc-200/50">
                <span className="text-[10px] text-zinc-500 font-medium">Rewards calculation: (Period Sales / 10,000) * Rate</span>
                <button
                  onClick={handleDownloadPrescribersReport}
                  className="bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-1.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-xs"
                >
                  Download Excel Report
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-600">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500 font-bold uppercase border-b border-zinc-200">
                    <th className="px-4 py-3">Prescriber / Clinic</th>
                    <th className="px-4 py-3 text-center">Programs Enrollment</th>
                    <th className="px-4 py-3 text-right">Period Sales (UGX)</th>
                    <th className="px-4 py-3 text-right">Calculated Reward</th>
                    <th className="px-4 py-3 text-right">Reward Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {prescribers.map(p => {
                    const docName = getPrescriberName(p);
                    const docLicense = getPrescriberLicense(p);
                    const docFacility = getPrescriberFacility(p);
                    const periodSales = getPrescriberSalesInPeriod(p.id, docName);
                    const periodReward = Math.floor(periodSales / 10000) * rewardRatePerTenThousand;
                    const prescriberIdKey = p.id || `p-key-${Math.random()}`;
                    return (
                      <tr key={prescriberIdKey} className="hover:bg-zinc-50/50 transition-colors font-medium">
                        <td className="px-4 py-3">
                          <p className="font-bold text-zinc-900">Dr. {docName}</p>
                          <p className="text-[10px] text-zinc-400">
                            Lic: {docLicense} | {docFacility}
                            {p.specialty && <span className="ml-1 text-indigo-600">({p.specialty})</span>}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggleRewardsEnrollment(p)}
                            className={`px-2 py-1 rounded-xl text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1 ${
                              p.isEnrolledInRewardProgram 
                                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' 
                                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                            }`}
                          >
                            {p.isEnrolledInRewardProgram ? 'Enrolled' : 'Not Enrolled'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-zinc-800">
                          UGX {periodSales.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {p.isEnrolledInRewardProgram ? (
                            <div>
                              <p className="font-black text-amber-600 text-[11px] font-mono">UGX {periodReward.toLocaleString()}</p>
                              <p className="text-zinc-400 text-[9px]">Rate: {rewardRatePerTenThousand}/10K</p>
                            </div>
                          ) : (
                            <span className="text-zinc-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDisbursePrescriberReward(p)}
                            disabled={!p.isEnrolledInRewardProgram || periodReward <= 0}
                            className="bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed font-bold uppercase text-[9px] tracking-wider px-3 py-1.5 rounded-xl transition-all"
                          >
                            Disburse
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Enrollment Side Panel */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-3xl p-6 h-fit space-y-4">
            <div>
              <h4 className="font-bold text-zinc-900 text-sm uppercase tracking-tight flex items-center gap-2">
                <UserCheck size={16} /> Enroll Prescriber
              </h4>
              <p className="text-zinc-500 text-xs mt-1">Configure practice rewards accounts for tracking validated clinical scripts.</p>
            </div>

            {/* Selector Tab for Enrollment Mode */}
            <div className="flex bg-zinc-200/60 p-1 rounded-xl text-[10px] font-black uppercase tracking-wider">
              <button 
                type="button"
                onClick={() => setEnrollMethod('crm')} 
                className={`flex-1 py-1.5 rounded-lg text-center transition-all ${enrollMethod === 'crm' ? 'bg-white text-zinc-900 shadow-xs font-bold' : 'text-zinc-500'}`}
              >
                From CRM List
              </button>
              <button 
                type="button"
                onClick={() => setEnrollMethod('manual')} 
                className={`flex-1 py-1.5 rounded-lg text-center transition-all ${enrollMethod === 'manual' ? 'bg-white text-zinc-900 shadow-xs font-bold' : 'text-zinc-500'}`}
              >
                Register & Enroll
              </button>
            </div>

            <form onSubmit={handleEnrollDoc} className="space-y-4 font-semibold text-xs text-zinc-700">
              {enrollMethod === 'crm' ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Select CRM Prescriber</label>
                  <select 
                    value={selectedCrmPrescriberId} 
                    onChange={e => {
                      setSelectedCrmPrescriberId(e.target.value);
                      const selectedDoc = prescribers.find(p => p.id === e.target.value);
                      if (selectedDoc) {
                        setName(getPrescriberName(selectedDoc));
                        setLic(getPrescriberLicense(selectedDoc));
                        setFac(getPrescriberFacility(selectedDoc));
                      } else {
                        setName('');
                        setLic('');
                        setFac('');
                      }
                    }} 
                    className="w-full px-3 py-2 bg-white text-zinc-900 border border-zinc-200 rounded-xl"
                  >
                    <option value="">-- Choose Registered Doctor --</option>
                    {crmPrescribersNotEnrolled.map(p => (
                      <option key={p.id} value={p.id}>
                        {getPrescriberName(p)} ({p.specialty || 'General'})
                      </option>
                    ))}
                  </select>

                  {selectedCrmPrescriberId && (
                    <div className="p-3 bg-white border border-zinc-200 rounded-xl mt-2 space-y-1 text-[11px] text-zinc-600 font-medium">
                      <p><span className="font-bold text-zinc-500 uppercase text-[9px] block">License</span> {lic}</p>
                      <p><span className="font-bold text-zinc-500 uppercase text-[9px] block">Facility/Institution</span> {fac}</p>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Doctor Full Name</label>
                    <input required type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 bg-white text-zinc-900 border border-zinc-200 rounded-xl" placeholder="Dr. Namubiru Joyce" />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">NDA / Professional License ID</label>
                    <input required type="text" value={lic} onChange={e => setLic(e.target.value)} className="w-full px-3 py-2 bg-white text-zinc-900 border border-zinc-200 rounded-xl font-mono" placeholder="NDA-MD-546" />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider font-sans">Primary Facility (Practice)</label>
                    <input required type="text" value={fac} onChange={e => setFac(e.target.value)} className="w-full px-3 py-2 bg-white text-zinc-900 border border-zinc-200 rounded-xl" placeholder="Mulago Referral Hospital" />
                  </div>
                </>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-zinc-200">
                <input type="checkbox" checked={isKOL} onChange={e => setIsKOL(e.target.checked)} className="rounded text-indigo-600 focus:ring-0" />
                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-wider cursor-pointer select-none">Also designate as Reputation KOL</label>
              </div>

              {isKOL && (
                <div className="space-y-1 animate-in slide-in-from-top-1">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">KOL Specialist Category</label>
                  <select value={kolCat} onChange={e => setKolCat(e.target.value as any)} className="w-full px-3 py-2 bg-white text-zinc-900 border border-zinc-200 rounded-xl font-bold text-xs">
                    <option value="Doctor">Doctor (Consultant)</option>
                    <option value="Health Influencer">Health Influencer</option>
                    <option value="Community Leader">Community Leader</option>
                    <option value="Corporate HR">Corporate HR Representative</option>
                  </select>
                </div>
              )}

              <button type="submit" className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all shadow-md">
                {enrollMethod === 'crm' ? 'Enroll CRM Prescriber' : 'Register & Enroll Prescriber'}
              </button>
            </form>
          </div>
        </div>
      )}

      {activeSubTab === 'disburse' && (
        <div className="bg-white border border-zinc-200 p-6 rounded-3xl shadow-sm space-y-4">
          <div>
            <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight">Rewards disbursements cycles and approvals</h3>
            <p className="text-zinc-500 text-xs">Verify prescription log tallies. Note that approval posts reward items to marketing expenses.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-zinc-50 text-zinc-500 font-bold uppercase border-b border-zinc-200">
                  <th className="px-4 py-3">Prescriber ID</th>
                  <th className="px-4 py-3">Month Cycle</th>
                  <th className="px-4 py-3">Scripts Count Verified</th>
                  <th className="px-4 py-3">Calculated Tier Rewards</th>
                  <th className="px-4 py-3">Verification status</th>
                  <th className="px-4 py-3 text-right">Verification Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 font-medium">
                {disbursements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center p-8 text-zinc-400 font-normal">
                      No disbursements raised yet for active cycles. Run "Compute Monthly Rewards" in columns list.
                    </td>
                  </tr>
                ) : (
                  disbursements.map(d => (
                    <tr key={d.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-bold text-zinc-900">Dr. {d.prescriberName || 'Unknown Doctor'}</p>
                        <p className="text-[10px] text-zinc-400 font-mono">Lic: {d.licenseNumber || 'N/A'}</p>
                      </td>
                      <td className="px-4 py-3 font-mono">{d.month}</td>
                      <td className="px-4 py-3 font-semibold text-zinc-800">
                        {d.scriptsCount || 0} prescription sheets
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-extrabold text-indigo-700 text-[11px] uppercase tracking-wide">{d.tierName}</p>
                        <p className="text-zinc-900 font-bold font-mono">UGX {(d.payoutAmount || 0).toLocaleString()}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full font-bold text-[9px] uppercase tracking-wider ${
                          d.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {d.status}
                        </span>
                        {d.status === 'Approved' && d.approvedBy && (
                          <div className="text-[9px] text-zinc-400 mt-0.5">By {d.approvedBy}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {d.status === 'Pending' ? (
                          <button
                            disabled={!isHeadOrCEO}
                            onClick={() => handleApproveDisbursement(d)}
                            className="bg-emerald-50 hover:bg-emerald-100 disabled:bg-zinc-100 disabled:text-zinc-400 text-emerald-800 px-3 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all"
                          >
                            {!isHeadOrCEO ? 'Awaiting Head Approve' : 'Disburse Rewards'}
                          </button>
                        ) : (
                          <span className="text-emerald-700 bg-emerald-50 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider inline-flex items-center gap-1">
                            <Check size={12} /> Disbursed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
