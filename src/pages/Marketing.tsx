import React, { useState, useEffect } from 'react';
import { 
  Megaphone, 
  Award, 
  Coins, 
  Calendar, 
  Plus, 
  Search, 
  Filter, 
  Edit2, 
  Trash2, 
  X,
  TrendingUp,
  MessageSquare,
  Star,
  Users,
  ShieldAlert,
  Sliders,
  DollarSign,
  Briefcase,
  AlertCircle,
  MapPin
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { UpgradeRequiredCard } from '../components/UpgradeRequiredCard';
import { firestoreService } from '../services/firestore';
import { MarketingCampaign, CustomerFeedback } from '../types';
import { toast } from 'sonner';

// Import subcomponents (M14 Eight Pillars)
import { ConsentNudgesPillar } from '../components/marketing/ConsentNudgesPillar';
import { LoyaltyPillar } from '../components/marketing/LoyaltyPillar';
import { PrescribersPillar } from '../components/marketing/PrescribersPillar';
import { BrandLedgerPillar } from '../components/marketing/BrandLedgerPillar';
import { ReputationPillar } from '../components/marketing/ReputationPillar';
import { AnalyticsPillar } from '../components/marketing/AnalyticsPillar';
import { CostLedgerPillar } from '../components/marketing/CostLedgerPillar';

const Marketing: React.FC = () => {
  const { profile } = useAuth();
  const { tenant } = useTenant();
  
  const activeRole = profile?.role || 'Marketing Head';
  const sessionRole = activeRole;

  // Active Tab representing each module pillar
  const [activeTab, setActiveTab] = useState<string>('campaigns');

  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
  const [feedback, setFeedback] = useState<CustomerFeedback[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  // Date range filters for Campaign report
  const [campaignStartDate, setCampaignStartDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return d.toISOString().split('T')[0];
  });
  const [campaignEndDate, setCampaignEndDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  const handleDownloadCampaignsReport = () => {
    const completedInPeriod = campaigns.filter(c => {
      const cStart = c.start_date || c.startDate || '';
      const cStatus = c.status;
      if (cStatus !== 'completed') return false;
      return (!campaignStartDate || cStart >= campaignStartDate) && (!campaignEndDate || cStart <= campaignEndDate);
    });

    if (completedInPeriod.length === 0) {
      toast.error('No completed campaigns found in this period.');
      return;
    }

    const headers = [
      'Campaign Name',
      'Category',
      'Status',
      'Start Date',
      'End Date',
      'Budget (UGX)',
      'Actual Cost Spent (UGX)',
      'ROI Multiplier',
      'Responsible Staff',
      'Description'
    ];

    const rows = completedInPeriod.map(c => [
      c.name,
      c.category || c.type || '',
      c.status,
      c.start_date || c.startDate || '',
      c.end_date || c.endDate || '',
      c.budget || 0,
      c.actual_cost || c.actualCost || 0,
      c.roi || 0,
      c.responsible_staff || '',
      c.description || ''
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
    link.setAttribute('download', `Campaigns_Done_Report_${campaignStartDate}_to_${campaignEndDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Excel-compatible campaigns report downloaded!');
  };

  // Subscription-based gating removed: all role-permitted users can access Marketing features

  // Initial Seeding Logic to ensure rich, beautiful workspace charts immediately
  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<MarketingCampaign>('campaigns', profile.tenantId, (data) => {
        if (data.length === 0) {
          // Seed initial campaigns
          const initialCampSpecs: any[] = [
            {
              tenantId: profile.tenantId,
              name: 'Mulago Pediatric Wellness Camp',
              type: 'outreach',
              category: 'Community Outreach',
              description: 'Free pediatric consultation and deworming medicine dispensing camp.',
              startDate: '2026-05-10',
              endDate: '2026-05-12',
              status: 'completed',
              responsible_staff: 'Sarah Atwine',
              budget: 750000,
              actual_cost: 820000,
              roi: 3.2,
              community_area: 'Kawempe',
              impact_metrics: { estimated_audience: 350, attendance: 290, new_clients: 45 }
            },
            {
              tenantId: profile.tenantId,
              name: 'World Hypertension Week Broadcast',
              type: 'digital',
              category: 'Digital Content',
              description: 'SMS blast campaign targeting patients > 45 with blood pressure tracking reminders.',
              startDate: '2026-05-15',
              endDate: '2026-05-20',
              status: 'active',
              responsible_staff: 'John Mugisha',
              budget: 150000,
              actual_cost: 150000,
              roi: 4.8,
              impact_metrics: { social_reach: 12000, new_clients: 32 }
            },
            {
              tenantId: profile.tenantId,
              name: 'Antenatal Vitamins Program',
              type: 'prescriber',
              category: 'Prescriber Engagement',
              description: 'Rewards program to increase antenatal vitamin supply adherence in local health centers.',
              startDate: '2026-06-01',
              endDate: '2026-06-30',
              status: 'planned',
              responsible_staff: 'Sarah Atwine',
              budget: 500000,
              roi: 2.1,
              impact_metrics: { estimated_audience: 500 }
            }
          ];
          initialCampSpecs.forEach(c => firestoreService.addDocument('campaigns', c));
        } else {
          setCampaigns(data);
        }
      });

      firestoreService.subscribeToCollection<CustomerFeedback>('feedback', profile.tenantId, (data) => {
        if (data.length === 0) {
          // Seed initial reviews
          const initialFeedbackSpecs: any[] = [
            {
              tenantId: profile.tenantId,
              patientName: 'Semakula Henry',
              patient_name: 'Semakula Henry',
              rating: 5,
              comment: 'The pharmacist took their time to explain potential side effects of hypertension tablets. Professional counseling!',
              comments: 'The pharmacist took their time to explain potential side effects of hypertension tablets. Professional counseling!',
              feedbackSource: 'Internal POS',
              date: '2026-05-22'
            },
            {
              tenantId: profile.tenantId,
              patientName: 'Nakitende Prossy',
              patient_name: 'Nakitende Prossy',
              rating: 4,
              comment: 'Fast medication pickup and convenient pharmacy location. Clean waiting chairs.',
              comments: 'Fast medication pickup and convenient pharmacy location. Clean waiting chairs.',
              feedbackSource: 'External Google',
              reviewResponse: 'Thank you Prossy! We are dedicated to maintaining premium pharmacy spaces.',
              date: '2026-05-25'
            },
            {
              tenantId: profile.tenantId,
              patientName: 'Kato Syrus',
              patient_name: 'Kato Syrus',
              rating: 5,
              comment: 'Enjoyed point discounts using the PharmPoints program. Encouraging!',
              comments: 'Enjoyed point discounts using the PharmPoints program. Encouraging!',
              feedbackSource: 'External Facebook',
              date: '2026-05-28'
            }
          ];
          initialFeedbackSpecs.forEach(f => firestoreService.addDocument('feedback', f));
        } else {
          setFeedback(data);
        }
      });
    }
  }, [profile?.tenantId]);

  const handleDelete = async (collection: string, id: string) => {
    if (sessionRole === 'Marketing Personnel') {
      toast.error('Marketing Personnel are not authorized to delete direct logs.');
      return;
    }
    if (window.confirm('Are you sure you want to delete this campaign permanently?')) {
      try {
        await firestoreService.deleteDocument(collection, id);
        toast.success('Campaign record deleted.');
      } catch {
        toast.error('Failed to delete campaign');
      }
    }
  };

  const getRoleBadgeColor = () => {
    switch (sessionRole) {
      case 'Marketing Head': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'Marketing Personnel': return 'bg-zinc-100 text-zinc-800 border-zinc-200';
      case 'CEO': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'Finance Head': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'IT Head': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-zinc-150 text-zinc-850';
    }
  };

  const getRoleDescription = () => {
    switch (sessionRole) {
      case 'Marketing Head': return 'Full capability access. Configures specifications, approves text campaigns and medical reward payouts, reviews reports.';
      case 'Marketing Personnel': return 'Logs operational field activities, conducts diagnostic feedback checkouts, drafts templates. Actions require Head sign-off.';
      case 'CEO': return 'Strategic supervisor access. Review audits, approve reward allocations, analyze brand YTD CAC values.';
      case 'Finance Head': return 'Audit ledger access. Restrained to Marketing Cost Ledger & Liability metrics. Read specialty limits.';
      case 'IT Head': return 'System maintainer access. Limited strictly to PharmPoints configuration sliders and specifications constraints.';
      default: return '';
    }
  };

  // Helper function to check tab security limits!
  const isTabBlockedForRole = (tabName: string) => {
    if (sessionRole === 'IT Head') {
      return tabName !== 'loyalty'; // IT Head can only do Loyalty settings tab
    }
    if (sessionRole === 'Finance Head') {
      return tabName !== 'ledger' && tabName !== 'analytics'; // Finance Head can only view Ledger & Analytics
    }
    return false;
  };

  // Render descriptive locks screen if role is restricted from certain tabs
  const renderTabLockscreen = () => (
    <div className="p-12 border border-dashed border-zinc-300 rounded-3xl bg-zinc-50/50 flex flex-col items-center text-center space-y-4 max-w-xl mx-auto">
      <div className="h-12 w-12 bg-red-50 text-red-700 rounded-xl flex items-center justify-center">
        <ShieldAlert size={24} />
      </div>
      <div>
        <h3 className="font-extrabold text-zinc-950 text-base uppercase tracking-wider">Access Locked for this Role</h3>
        <p className="text-zinc-500 text-xs mt-2">
          Your current persona <strong>({sessionRole})</strong> does not have permission scopes matching this Marketing pillar. 
          Modify your active persona at the top-level Switcher to explore this area!
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 pb-12">
      {/* Header & Active Role Info Panel */}
      <div className="bg-zinc-50 rounded-3xl border border-zinc-200 p-6 space-y-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="text-[9px] font-black tracking-[0.25em] text-zinc-400 uppercase">M14 Unified Marketing & CRM Module</span>
            <h1 className="text-3xl font-black text-zinc-950 tracking-tight">Marketing & CRM</h1>
            <p className="text-zinc-500 text-xs mt-1">E2E suite for campaign logistics, customer point loyalty networks, medical prescriber awards, and reputation metrics.</p>
          </div>
        </div>

        {/* Active capabilities info bar */}
        <div className="flex items-start gap-3 p-3 bg-white border border-zinc-150 rounded-2xl">
          <span className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-md border flex items-center gap-1 flex-shrink-0 ${getRoleBadgeColor()}`}>
            <Briefcase size={12} /> {sessionRole}
          </span>
          <p className="text-[11px] text-zinc-500 font-medium leading-relaxed">
            {getRoleDescription()}
          </p>
        </div>
      </div>

      {/* Main Pillars Navigation Grid */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-zinc-100 rounded-3xl w-full">
        <button 
          onClick={() => setActiveTab('campaigns')}
          disabled={sessionRole === 'IT Head' || sessionRole === 'Finance Head'}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl transition-all font-bold text-xs uppercase tracking-wider ${
            activeTab === 'campaigns' ? 'bg-white text-zinc-950 shadow-xs' : 'text-zinc-500 hover:text-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          <Megaphone size={16} /> Campaigns Activity Log
        </button>

        <button 
          onClick={() => setActiveTab('loyalty')}
          disabled={sessionRole === 'Finance Head'}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl transition-all font-bold text-xs uppercase tracking-wider ${
            activeTab === 'loyalty' ? 'bg-white text-zinc-950 shadow-xs' : 'text-zinc-500 hover:text-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          <Coins size={16} /> PharmPoints Loyalty
        </button>

        <button 
          onClick={() => setActiveTab('prescribers')}
          disabled={sessionRole === 'IT Head' || sessionRole === 'Finance Head'}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl transition-all font-bold text-xs uppercase tracking-wider ${
            activeTab === 'prescribers' ? 'bg-white text-zinc-950 shadow-xs' : 'text-zinc-500 hover:text-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          <Award size={16} /> Prescriber rewards
        </button>

        <button 
          onClick={() => setActiveTab('brand')}
          disabled={sessionRole === 'IT Head' || sessionRole === 'Finance Head'}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl transition-all font-bold text-xs uppercase tracking-wider ${
            activeTab === 'brand' ? 'bg-white text-zinc-950 shadow-xs' : 'text-zinc-500 hover:text-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          <MapPin size={16} className="text-zinc-500" /> Outreach Brand Ledger
        </button>

        <button 
          onClick={() => setActiveTab('ledger')}
          disabled={sessionRole === 'IT Head'}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl transition-all font-bold text-xs uppercase tracking-wider ${
            activeTab === 'ledger' ? 'bg-white text-zinc-950 shadow-xs' : 'text-zinc-500 hover:text-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          <DollarSign size={16} /> Cost Ledger
        </button>

        <button 
          onClick={() => setActiveTab('analytics')}
          disabled={sessionRole === 'IT Head'}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl transition-all font-bold text-xs uppercase tracking-wider ${
            activeTab === 'analytics' ? 'bg-white text-zinc-950 shadow-xs' : 'text-zinc-500 hover:text-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          <TrendingUp size={16} /> ROI Analytics
        </button>
      </div>

      {/* Tab Contents renderer with Secure locks checking */}
      <div className="space-y-6">
        {isTabBlockedForRole(activeTab) ? renderTabLockscreen() : (
          <>
            {/* PILLAR 1: DIRECT CAMPAIGNS ACTIVITY LOG TABLE VIEW */}
            {activeTab === 'campaigns' && (
              <div className="space-y-6 animate-in fade-in">
                {/* Campaigns Dashboard Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-xs">
                    <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-1">Active campaigns</p>
                    <h3 className="text-2xl font-black text-zinc-950">{campaigns.filter(c => c.status === 'active').length}</h3>
                  </div>
                  <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-xs">
                    <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-1">Planned campaigns</p>
                    <h3 className="text-2xl font-black text-zinc-950 font-semibold">{campaigns.filter(c => c.status === 'planned').length}</h3>
                  </div>
                  <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-xs">
                    <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-1">Estimated reach views</p>
                    <h3 className="text-2xl font-black text-zinc-950 font-mono">15,400</h3>
                  </div>
                  <div className="flex justify-end items-center">
                    <button
                      onClick={() => {
                        setEditingItem(null);
                        setIsModalOpen(true);
                      }}
                      className="bg-zinc-950 hover:bg-zinc-850 text-white px-5 py-3 rounded-2xl font-black text-xs tracking-wider transition-all flex items-center gap-1.5 shadow-xs uppercase w-full justify-center md:w-auto"
                    >
                      <Plus size={16} /> Create Campaign Specification
                    </button>
                  </div>
                </div>

                {/* Campaigns Filter and Excel download panel */}
                <div className="bg-zinc-50 border border-zinc-200 p-5 rounded-[24px] flex flex-col md:flex-row items-center justify-between gap-4 shadow-xs">
                  <div>
                    <h4 className="font-extrabold text-zinc-950 text-xs">Campaigns Period Report Filter</h4>
                    <p className="text-[10px] text-zinc-400 font-black uppercase tracking-wider">Specify start and end dates to filter active campaign logs</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-zinc-500 uppercase">From</span>
                      <input 
                        type="date"
                        value={campaignStartDate}
                        onChange={(e) => setCampaignStartDate(e.target.value)}
                        className="bg-white border border-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-xl outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-zinc-500 uppercase">To</span>
                      <input 
                        type="date"
                        value={campaignEndDate}
                        onChange={(e) => setCampaignEndDate(e.target.value)}
                        className="bg-white border border-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-xl outline-none"
                      />
                    </div>
                    <button
                      onClick={handleDownloadCampaignsReport}
                      className="bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-1.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all"
                    >
                      Download Excel Report
                    </button>
                  </div>
                </div>

                {/* Main Table log */}
                <div className="bg-white rounded-[32px] border border-zinc-200 shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-zinc-600">
                      <thead>
                        <tr className="bg-zinc-50/50 border-b border-zinc-150 font-bold uppercase text-zinc-500">
                          <th className="px-6 py-4">Campaign specifications / dates</th>
                          <th className="px-6 py-4">Group category</th>
                          <th className="px-6 py-4 text-right">Fund Allocation budget</th>
                          <th className="px-6 py-4 text-right">Actual cost spend</th>
                          <th className="px-6 py-4">Status</th>
                          <th className="px-6 py-4 text-right">Log Operations</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 font-medium">
                        {campaigns
                          .filter(item => {
                            const cStart = item.start_date || item.startDate || '';
                            return (!campaignStartDate || cStart >= campaignStartDate) && (!campaignEndDate || cStart <= campaignEndDate);
                          })
                          .map((item) => (
                            <tr key={item.id} className="hover:bg-zinc-50/55 transition-colors">
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="h-9 w-9 bg-zinc-100 text-zinc-700 rounded-xl flex items-center justify-center">
                                    <Megaphone size={16} />
                                  </div>
                                  <div>
                                    <p className="font-extrabold text-zinc-950">{item.name}</p>
                                    <p className="text-[10px] text-zinc-400 font-mono">
                                      {(item.start_date || item.startDate)} to {(item.end_date || item.endDate)}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span className="bg-zinc-100/80 text-zinc-700 px-2.5 py-0.5 rounded-lg text-[10px] font-bold uppercase">
                                  {item.category || item.type || 'Digital'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right font-mono font-bold text-zinc-800">
                                UGX {(item.budget || 0).toLocaleString()}
                              </td>
                              <td className="px-6 py-4 text-right font-mono font-bold text-zinc-850">
                                UGX {((item.actual_cost || item.actualCost) || item.budget || 0).toLocaleString()}
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${
                                  item.status === 'active' ? 'bg-emerald-50 text-emerald-700' :
                                  item.status === 'planned' ? 'bg-amber-50 text-amber-700' :
                                  'bg-zinc-100 text-zinc-600'
                                }`}>
                                  {item.status}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button 
                                    onClick={() => { setEditingItem(item); setIsModalOpen(true); }} 
                                    className="p-1.5 text-zinc-400 hover:text-zinc-950 hover:bg-zinc-100 rounded-lg transition-all"
                                  >
                                    <Edit2 size={13} />
                                  </button>
                                  <button 
                                    disabled={sessionRole === 'Marketing Personnel'}
                                    onClick={() => handleDelete('campaigns', item.id)} 
                                    className="p-1.5 text-zinc-400 hover:text-red-600 disabled:text-zinc-200 rounded-lg transition-all"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* PILLAR 3: PHARMPOINTS LOYALTY SPECIFICATION ENGINE & CHECKOUT SIMULATOR */}
            {activeTab === 'loyalty' && (
              <LoyaltyPillar tenantId={profile?.tenantId || ''} role={sessionRole} />
            )}

            {/* PILLAR 4: PRESCRIBER REWARD PROGRAMME AND INCENTIVES CYCLES */}
            {activeTab === 'prescribers' && (
              <PrescribersPillar tenantId={profile?.tenantId || ''} role={sessionRole} />
            )}

            {/* PILLAR 5: GEOGRAPHIC OUTREACH AND SOCIAL BRAND LEDGER */}
            {activeTab === 'brand' && (
              <BrandLedgerPillar tenantId={profile?.tenantId || ''} role={sessionRole} />
            )}

            {/* PILLAR 7: COMPREHENSIVE COST LEDGER & PHARMPOINTS FINANCIAL LIABILITY TRACKER */}
            {activeTab === 'ledger' && (
              <CostLedgerPillar tenantId={profile?.tenantId || ''} role={sessionRole} />
            )}

            {/* PILLAR 8: MARKETING INTELLIGENCE, CORRELATION BASICS & PRODUCT PAIRINGS SPEED VELOCITIES */}
            {activeTab === 'analytics' && (
              <AnalyticsPillar tenantId={profile?.tenantId || ''} role={sessionRole} />
            )}
          </>
        )}
      </div>

      {/* RENDER DRAFT SPECIFICATIONS CREATOR / MODIFIER MODAL FOR DIRECT ENTRIES */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xs">
          <div className="bg-white w-full max-w-lg rounded-[28px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <h2 className="text-sm font-black text-zinc-950 uppercase tracking-widest">
                {editingItem ? 'Edit Spec' : 'Create New Campaign Spec'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
                <X size={20} />
              </button>
            </div>

            {editingItem?.status === 'completed' && (
              <div className="bg-amber-50 border-y border-amber-200 px-6 py-3 text-[11px] text-amber-800 font-bold uppercase tracking-wider flex items-center gap-2">
                <AlertCircle size={14} />
                Campaign completed and locked. Actual cost spend is logged and closed.
              </div>
            )}
            
            <form 
              onSubmit={async (e) => {
                e.preventDefault();
                if (!profile?.tenantId) return;

                // If locked, just close modal on submit
                if (editingItem?.status === 'completed') {
                  setIsModalOpen(false);
                  return;
                }

                const form = e.currentTarget;
                const fd = new FormData(form);
                
                const cData: any = {
                  tenantId: profile.tenantId,
                  name: fd.get('name') as string,
                  category: fd.get('category') as string,
                  type: (fd.get('category') as string).toLowerCase().replace(' ', '_'),
                  budget: Number(fd.get('budget')),
                  actual_cost: Number(fd.get('actual_cost') || fd.get('budget')),
                  roi: Number(fd.get('roi') || 1.6),
                  status: fd.get('status') as string,
                  start_date: fd.get('start_date') as string,
                  end_date: fd.get('end_date') as string,
                  startDate: fd.get('start_date') as string,
                  endDate: fd.get('end_date') as string,
                  responsible_staff: fd.get('staff') as string,
                  description: fd.get('desc') as string
                };

                const isCompleting = cData.status === 'completed';

                try {
                  if (editingItem?.id) {
                    await firestoreService.updateDocument('campaigns', editingItem.id, cData);
                    
                    // Post campaign cost to marketing expenses ledger upon completion
                    if (isCompleting) {
                      await firestoreService.addDocument('marketing_expenses', {
                        tenantId: profile.tenantId,
                        category: 'Campaign Activity',
                        subCategory: 'Completed Campaign Spend',
                        amount: Number(cData.actual_cost || cData.budget),
                        description: `Actual spend of completed campaign: ${cData.name}`,
                        date: new Date().toISOString().split('T')[0],
                        loggedBy: sessionRole,
                        status: 'approved'
                      });
                    }
                    toast.success('Campaign specifications updated');
                  } else {
                    await firestoreService.addDocument('campaigns', cData);
                    
                    if (isCompleting) {
                      await firestoreService.addDocument('marketing_expenses', {
                        tenantId: profile.tenantId,
                        category: 'Campaign Activity',
                        subCategory: 'Completed Campaign Spend',
                        amount: Number(cData.actual_cost || cData.budget),
                        description: `Actual spend of completed campaign: ${cData.name}`,
                        date: new Date().toISOString().split('T')[0],
                        loggedBy: sessionRole,
                        status: 'approved'
                      });
                    }
                    toast.success('Campaign specifications created and logged');
                  }
                  setIsModalOpen(false);
                } catch {
                  toast.error('Failed to register specifications');
                }
              }} 
              className="p-6 space-y-4 text-xs font-semibold text-zinc-700"
            >
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Campaign Spec Name *</label>
                <input 
                  required 
                  name="name" 
                  type="text" 
                  disabled={editingItem?.status === 'completed'}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl disabled:opacity-60" 
                  defaultValue={editingItem?.name || ''} 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1 col-span-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Campaign Group Category</label>
                  <select 
                    name="category" 
                    disabled={editingItem?.status === 'completed'}
                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl disabled:opacity-60" 
                    defaultValue={editingItem?.category || 'Digital Content'}
                  >
                    <option value="Digital Content">Digital Content (SMS, Newsletters)</option>
                    <option value="Media">Media (Radio Spot, Television)</option>
                    <option value="Events and Partnerships">Events and Partnerships</option>
                    <option value="Prescriber Engagement">Prescriber Engagement (Doctors reward)</option>
                    <option value="Client Programme">Client Programme (Points boost)</option>
                    <option value="Seminars">Seminars (Continuous Education)</option>
                    <option value="Print">Print (Banners, Flyers)</option>
                    <option value="Community Outreach">Community Outreach (Free clinics)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider font-sans">Budget Funds (UGX) *</label>
                  <input 
                    required 
                    name="budget" 
                    type="number" 
                    disabled={editingItem?.status === 'completed'}
                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl font-mono disabled:opacity-60" 
                    defaultValue={editingItem?.budget || 250000} 
                  />
                </div>

                <div className="space-y-1 font-mono">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider font-sans">Actual Cost Spent (UGX)</label>
                  <input 
                    name="actual_cost" 
                    type="number" 
                    disabled={editingItem?.status === 'completed'}
                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl disabled:opacity-60" 
                    defaultValue={editingItem?.actual_cost || 250000} 
                  />
                </div>

                <div className="space-y-1 font-sans">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Planned Start Date</label>
                  <input 
                    name="start_date" 
                    type="date" 
                    disabled={editingItem?.status === 'completed'}
                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl font-mono disabled:opacity-60" 
                    defaultValue={editingItem?.start_date || editingItem?.startDate || ''} 
                  />
                </div>

                <div className="space-y-1 font-sans">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Planned End Date</label>
                  <input 
                    name="end_date" 
                    type="date" 
                    disabled={editingItem?.status === 'completed'}
                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl font-mono disabled:opacity-60" 
                    defaultValue={editingItem?.end_date || editingItem?.endDate || ''} 
                  />
                </div>

                <div className="space-y-1 col-span-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Responsible personnel</label>
                  <input 
                    name="staff" 
                    type="text" 
                    disabled={editingItem?.status === 'completed'}
                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl disabled:opacity-60" 
                    placeholder="Pharmacist Sarah" 
                    defaultValue={editingItem?.responsible_staff || ''} 
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Baseline ROI Multiplier</label>
                  <input 
                    name="roi" 
                    type="number" 
                    step="0.1" 
                    disabled={editingItem?.status === 'completed'}
                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl font-mono disabled:opacity-60" 
                    defaultValue={editingItem?.roi || 1.8} 
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Status</label>
                  <select 
                    name="status" 
                    disabled={editingItem?.status === 'completed'}
                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-semibold disabled:opacity-60" 
                    defaultValue={editingItem?.status || 'planned'}
                  >
                    <option value="planned">Planned (Draft)</option>
                    <option value="active">Active (Dispatched)</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Campaign descriptions</label>
                <textarea 
                  rows={3} 
                  name="desc" 
                  disabled={editingItem?.status === 'completed'}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl resize-none text-xs font-normal disabled:opacity-60" 
                  placeholder="Outreach banners and logistical costs for Kawempe deworming drives." 
                  defaultValue={editingItem?.description || ''} 
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-zinc-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2 border border-zinc-200 rounded-xl font-extrabold uppercase text-[10px] tracking-wider text-zinc-500">
                  {editingItem?.status === 'completed' ? 'Close' : 'Cancel'}
                </button>
                {editingItem?.status !== 'completed' && (
                  <button type="submit" className="px-6 py-2 bg-zinc-950 text-white rounded-xl font-extrabold uppercase text-[10px] tracking-wider">
                    {editingItem ? 'Update specifications' : 'Post campaign specification'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Marketing;
