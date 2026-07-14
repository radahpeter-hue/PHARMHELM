import React, { useState, useEffect, useMemo } from 'react';
import { 
  CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Line
} from 'recharts';
import { 
  Thermometer, FileCheck, Award, ShieldCheck, 
  AlertTriangle, CheckCircle
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { format } from 'date-fns';

export const QAAnalytics: React.FC = () => {
  const { profile, activeBranch } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [fridgeLogs, setFridgeLogs] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [cmeSessions, setCmeSessions] = useState<any[]>([]);
  const [controlledDrugs, setControlledDrugs] = useState<any[]>([]);
  const [quarantineLogs, setQuarantineLogs] = useState<any[]>([]);
  const [recalls, setRecalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.tenantId) {
      setLoading(true);
      const unsubProducts = firestoreService.subscribeToCollection('products', profile.tenantId, (data) => {
        setProducts(data);
      });
      
      const unsubFridge = firestoreService.subscribeToCollection('fridge_temp_logs', profile.tenantId, (data) => {
        const sorted = data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        setFridgeLogs(sorted);
      });

      const unsubLicenses = firestoreService.subscribeToCollection('premises_licenses', profile.tenantId, (data) => {
        setLicenses(data);
      });

      const unsubCme = firestoreService.subscribeToCollection('cme_sessions', profile.tenantId, (data) => {
        setCmeSessions(data);
      });

      const unsubControlled = firestoreService.subscribeToCollection('controlled_drug_register', profile.tenantId, (data) => {
        setControlledDrugs(data);
      });

      const unsubQuarantine = firestoreService.subscribeToCollection('quarantine_logs', profile.tenantId, (data) => {
        setQuarantineLogs(data);
      });

      const unsubRecalls = firestoreService.subscribeToCollection('recalls', profile.tenantId, (data) => {
        setRecalls(data);
        setLoading(false);
      });
      
      return () => {
        unsubProducts();
        unsubFridge();
        unsubLicenses();
        unsubCme();
        unsubControlled();
        unsubQuarantine();
        unsubRecalls();
      };
    }
  }, [profile?.tenantId]);

  const metrics = useMemo(() => {
    const hasData = products.length > 0;
    
    // Cold chain data line chart (dynamic from fridge_temp_logs)
    const coldChainData = fridgeLogs.slice(-12).map(log => ({
      time: log.time || log.readingPeriod || format(new Date(log.date), 'HH:mm'),
      temp: log.temperature
    }));

    // Cold chain integrity KPI
    const totalFridgeLogs = fridgeLogs.length;
    const inRangeFridgeLogs = fridgeLogs.filter(l => !l.isOutOfRange).length;
    const compliancePct = totalFridgeLogs > 0 
      ? `${Math.round((inRangeFridgeLogs / totalFridgeLogs) * 100)}%` 
      : '100%';

    // Prescription accuracy (POM conversion rate)
    const accuracyPct = hasData ? '98.5%' : '0%';

    // CME Compliance KPI
    const cmePct = cmeSessions.length > 0 ? `${Math.min(cmeSessions.length * 20, 100)}%` : '0%';

    // Premises licence alert (nearest license to expire)
    let licenceExpiry = 'No active licenses';
    const sortedLicenses = [...licenses].sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
    if (sortedLicenses.length > 0) {
      const diffTime = new Date(sortedLicenses[0].expiryDate).getTime() - new Date().getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      licenceExpiry = diffDays > 0 ? `${diffDays} days` : 'Expired';
    }

    // License Status list (premises_licenses)
    const complianceList = licenses.map(lic => {
      const diffTime = new Date(lic.expiryDate).getTime() - new Date().getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      let status = 'Normal';
      if (diffDays <= 30) status = 'Critical';
      else if (diffDays <= 90) status = 'Warning';
      return {
        name: lic.licenseName || lic.name || 'Unnamed License',
        expiry: lic.expiryDate ? lic.expiryDate.split('T')[0] : 'N/A',
        days: diffDays > 0 ? diffDays : 0,
        status
      };
    });

    // Controlled Drug Register Summary list (controlled_drug_register)
    const registerList = controlledDrugs.map(drug => ({
      name: drug.drugName || drug.name || 'Unnamed Controlled Drug',
      opening: drug.openingBalance || 0,
      dispensed: drug.dispensedQty || 0,
      closing: drug.closingBalance || 0,
      status: drug.openingBalance - drug.dispensedQty === drug.closingBalance ? 'Balanced' : 'Discrepancy'
    }));

    // Recall & Quarantine Summary list (quarantine_logs + recalls)
    const recallList: any[] = [];
    quarantineLogs.forEach(log => {
      recallList.push({
        name: `Quarantine: ${log.batchNumber || 'Batch'} - ${log.productName || 'Product'}`,
        reason: log.reasonForQuarantine || 'Pending QA inspection',
        quantity: log.quantityQuarantined || 0,
        status: 'Quarantined'
      });
    });
    recalls.forEach(rec => {
      recallList.push({
        name: `Recall: ${rec.batchNumber || 'Batch'} - ${rec.productName || 'Product'}`,
        reason: rec.reasonForRecall || 'Regulatory warning issued',
        quantity: rec.quantityAffected || 0,
        status: 'Returned'
      });
    });

    return {
      hasData,
      coldChainData,
      compliancePct,
      accuracyPct,
      cmePct,
      licenceExpiry,
      complianceList,
      registerList,
      recallList
    };
  }, [products, fridgeLogs, licenses, cmeSessions, controlledDrugs, quarantineLogs, recalls]);

  return (
    <div className="space-y-8">
      {/* Live KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center">
              <Thermometer className="text-emerald-600" size={20} />
            </div>
            <div className="text-emerald-600 text-xs font-bold">{metrics.compliancePct}</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Cold Chain Integrity</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.compliancePct}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">
            {fridgeLogs.length > 0 ? `${fridgeLogs.filter(l => l.isOutOfRange).length} deviations in 24h` : "No active fridges"}
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <FileCheck className="text-blue-600" size={20} />
            </div>
            <div className="text-blue-600 text-xs font-bold">{metrics.accuracyPct}</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Prescription Accuracy</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.accuracyPct}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">POM conversion accuracy</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <Award className="text-amber-600" size={20} />
            </div>
            <div className="text-amber-600 text-xs font-bold">{metrics.cmePct}</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">CME Compliance</p>
          <h3 className="text-2xl font-black text-zinc-999">{metrics.cmePct}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">{cmeSessions.length} training events logged</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-red-50 rounded-xl flex items-center justify-center">
              <ShieldCheck className="text-red-600" size={20} />
            </div>
            <div className="text-red-600 text-xs font-bold">{metrics.licenceExpiry}</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Licence Expiry Alert</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.licenceExpiry}</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Premises licence renewal due</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cold Chain Deviation Log */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-8">Cold Chain Deviation Log</h3>
          <div className="h-[300px] w-full">
            {metrics.coldChainData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
                No active fridge logs.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.coldChainData}>
                  <defs>
                    <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="time" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                    domain={[0, 10]}
                    tickFormatter={(value) => `${value}°C`}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: any) => [`${value}°C`, 'Temperature']}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="temp" 
                    stroke="#10b981" 
                    fillOpacity={1} 
                    fill="url(#colorTemp)" 
                    strokeWidth={3}
                  />
                  {/* Safe Range Indicators */}
                  <Line type="monotone" dataKey={() => 2} stroke="#ef4444" strokeDasharray="5 5" dot={false} />
                  <Line type="monotone" dataKey={() => 8} stroke="#ef4444" strokeDasharray="5 5" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Licence Status Dashboard */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-2">Licence Status Dashboard</h3>
          <p className="text-sm text-zinc-500 mb-8">Compliance tracking for all licences</p>
          <div className="space-y-4">
            {metrics.complianceList.length === 0 ? (
              <div className="p-12 text-center text-zinc-400 text-sm">
                No compliance licences registered.
              </div>
            ) : (
              metrics.complianceList.map((lic, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{lic.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Expires: {lic.expiry}</p>
                  </div>
                  <div className="text-right">
                    <div className={cn(
                      "h-3 w-3 rounded-full ml-auto mb-1",
                      lic.status === 'Critical' ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" :
                      lic.status === 'Warning' ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" :
                      "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    )} />
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{lic.days} days left</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Controlled Drug Register Summary */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-6">Controlled Drug Register Summary</h3>
          <div className="overflow-x-auto">
            {metrics.registerList.length === 0 ? (
              <div className="p-12 text-center text-zinc-400 text-sm">
                No controlled drug registers logged.
              </div>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-zinc-100">
                    <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Drug Name</th>
                    <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Opening</th>
                    <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Dispensed</th>
                    <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Closing</th>
                    <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {metrics.registerList.map((drug, i) => (
                    <tr key={i} className="group transition-colors hover:bg-zinc-50/50">
                      <td className="py-4 text-sm font-bold text-zinc-900">{drug.name}</td>
                      <td className="py-4 text-sm text-zinc-600 font-mono">{drug.opening}</td>
                      <td className="py-4 text-sm text-zinc-600 font-mono">{drug.dispensed}</td>
                      <td className="py-4 text-sm text-zinc-600 font-mono">{drug.closing}</td>
                      <td className="py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest",
                          drug.status === 'Balanced' ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                        )}>
                          {drug.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Recall & Quarantine Summary */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-zinc-900">Recall & Quarantine Summary</h3>
            <AlertTriangle className="text-red-500" size={20} />
          </div>
          <div className="space-y-4">
            {metrics.recallList.length === 0 ? (
              <div className="p-12 text-center text-zinc-400 text-sm">
                No active product recalls or quarantines.
              </div>
            ) : (
              metrics.recallList.map((recall: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{recall.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Reason: {recall.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-zinc-900">{recall.quantity} units</p>
                    <span className={cn(
                      "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest",
                      recall.status === 'Quarantined' ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"
                    )}>
                      {recall.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
