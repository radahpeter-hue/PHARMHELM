import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart3, 
  Plus, 
  History, 
  Search, 
  Download,
  User,
  Calendar,
  Award,
  TrendingUp,
  Target,
  CheckCircle2,
  AlertCircle,
  Star,
  FileText,
  ChevronRight,
  PieChart,
  ShieldAlert,
  Edit3,
  CheckCircle,
  Zap,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { Appraisal, Staff, CMESession } from '../../types';
import { toast } from 'sonner';
import { format } from 'date-fns';

const RATING_BANDS = [
  { min: 90, label: 'Outstanding', color: 'text-purple-600 bg-purple-50 border-purple-100', description: 'Exceptional performance far exceeding standards.' },
  { min: 80, label: 'Good / Exceeds', color: 'text-blue-600 bg-blue-50 border-blue-100', description: 'Strong, consistent performance above position expectations.' },
  { min: 70, label: 'Satisfactory / Meets', color: 'text-green-600 bg-green-50 border-green-100', description: 'Capable performance meeting all core job standards.' },
  { min: 0, label: 'Needs Improvement', color: 'text-red-600 bg-red-50 border-red-100', description: 'Below safety/professional expectations. Requires structured support.' }
];

export const Appraisals = () => {
  const { user, activeBranch, tenantId } = useAuth();
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [sessions, setSessions] = useState<CMESession[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingAppraisal, setEditingAppraisal] = useState<Appraisal | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPeriodFilter, setSelectedPeriodFilter] = useState<string>('all');
  const [viewingReport, setViewingReport] = useState<Appraisal | null>(null);

  // Active perspective: 'all' | 'manager' | 'qa'
  const [activeTab, setActiveTab] = useState<'overview' | 'run' | 'history'>('overview');

  // Form states
  const [staffId, setStaffId] = useState('');
  const [appraisalPeriod, setAppraisalPeriod] = useState<'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Annual'>('Q1');
  const [appraisalYear, setAppraisalYear] = useState<string>('2026');
  const [theoreticalScore, setTheoreticalScore] = useState('');
  const [practiceScore, setPracticeScore] = useState('');
  
  // Custom CME points override state (defaults to auto calculations)
  const [manualCmeOverride, setManualCmeOverride] = useState(false);
  const [manualCmePoints, setManualCmePoints] = useState('');

  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [goals, setGoals] = useState('');
  const [hrRecommendedAction, setHrRecommendedAction] = useState('');

  useEffect(() => {
    if (!tenantId || !activeBranch) return;

    const unsubscribeAppraisals = firestoreService.subscribeToCollection<Appraisal>(
      'appraisals',
      tenantId,
      (entries) => {
        const branchEntries = entries.filter(e => e.branchId === activeBranch.id);
        setAppraisals(branchEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      }
    );

    const unsubscribeStaff = firestoreService.subscribeToCollection<Staff>(
      'staff',
      tenantId,
      (entries) => {
        const branchStaff = entries.filter(s => s.branch_id === activeBranch.id);
        setStaff(branchStaff);
      }
    );

    const unsubscribeSessions = firestoreService.subscribeToCollection<CMESession>(
      'cme_sessions',
      tenantId,
      (entries) => {
        const branchEntries = entries.filter(e => e.branchId === activeBranch.id);
        setSessions(branchEntries);
      }
    );

    setLoading(false);

    return () => {
      unsubscribeAppraisals();
      unsubscribeStaff();
      unsubscribeSessions();
    };
  }, [tenantId, activeBranch]);

  // Dynamic CME point retriever matching either fullName or full_name (case-insensitive)
  const getStaffCmePoints = (targetStaffId: string) => {
    const staffMember = staff.find(s => s.id === targetStaffId);
    if (!staffMember) return 0;
    
    const namesToMatch = [
      staffMember.fullName,
      staffMember.full_name,
      staffMember.displayName
    ].filter(Boolean).map(n => n!.toLowerCase());

    const staffSessions = sessions.filter(session => {
      const isPresenter = session.presenter && namesToMatch.some(n => session.presenter!.toLowerCase().includes(n));
      const isAttendee = session.attendees && session.attendees.some(att => namesToMatch.some(n => att.toLowerCase().includes(n)));
      return isPresenter || isAttendee;
    });

    return staffSessions.reduce((sum, session) => {
      const isPresenter = session.presenter && namesToMatch.some(n => session.presenter!.toLowerCase().includes(n));
      if (isPresenter) {
        return sum + (session.presenterPoints || 10.0);
      }
      
      // Look for individual attendee score in detailed roster
      if (session.attendeeScores) {
        const scoreRecord = session.attendeeScores.find(score => 
          score.staffId === targetStaffId || namesToMatch.some(n => score.staffName.toLowerCase().includes(n))
        );
        if (scoreRecord) {
          return sum + (scoreRecord.totalPoints || 0);
        }
      }

      return sum + (session.attendancePoints || 5.0);
    }, 0);
  };

  // Safe renderer for array or string text areas
  const renderValueList = (val: string | string[] | undefined) => {
    if (!val) return 'None recorded';
    if (Array.isArray(val)) {
      return (
        <ul className="list-disc list-inside space-y-1 text-slate-700 text-sm">
          {val.map((item, idx) => <li key={idx}>{item}</li>)}
        </ul>
      );
    }
    return <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-line">{val}</p>;
  };

  // Scoring engine utilizing user's precise Ugandan weighted system & safety cap rules:
  // Overall Score% = (0.5 * Practice%) + (0.3 * Theoretical%) + (0.2 * CME%)
  // Capped at 'Needs Improvement' if any single metric < 70%
  const evaluateAppraisalMetrics = (
    sId: string, 
    theoreticalInput: string | number, 
    practiceInput: string | number,
    period: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Annual',
    overrideCme: boolean,
    overridePoints: string | number
  ) => {
    const defaultRes = {
      isComplete: false,
      practicePct: 0,
      theoreticalPct: 0,
      cmePoints: 0,
      cmePct: 0,
      overallScore: 0,
      ratingLabel: 'Needs Improvement',
      isCapped: false,
      recommendedAction: '',
      colorClass: RATING_BANDS[3].color,
      cmeMax: period === 'Annual' ? 390 : 98
    };

    if (!sId) return defaultRes;

    const pPct = practiceInput !== '' ? parseFloat(practiceInput.toString()) : NaN;
    const tPct = theoreticalInput !== '' ? parseFloat(theoreticalInput.toString()) : NaN;

    const cPoints = overrideCme 
      ? parseFloat(overridePoints.toString() || '0') 
      : getStaffCmePoints(sId);

    const cmeMax = period === 'Annual' ? 390 : 98;
    // Normalize CME Points to Percentage Capped at 100%
    const cmePct = cmeMax > 0 ? Math.min((cPoints / cmeMax) * 100, 100) : 0;

    const isComplete = !isNaN(pPct) && !isNaN(tPct);
    if (!isComplete) {
      // Partial calculation display (e.g. CME points accumulated)
      return {
        ...defaultRes,
        practicePct: isNaN(pPct) ? 0 : pPct,
        theoreticalPct: isNaN(tPct) ? 0 : tPct,
        cmePoints: cPoints,
        cmePct: Math.round(cmePct * 10) / 10,
        cmeMax
      };
    }

    // Precise formula
    const rawOverall = (pPct * 0.5) + (tPct * 0.3) + (cmePct * 0.2);
    const roundedOverall = Math.round(rawOverall * 10) / 10;

    // Safety Threshold Rule: Must score >= 70% in each individual metric
    const hasUnderThreshold = pPct < 70 || tPct < 70 || cmePct < 70;
    
    let finalRatingLabel = 'Needs Improvement';
    let isCapped = false;

    if (hasUnderThreshold) {
      finalRatingLabel = 'Needs Improvement';
      isCapped = true;
    } else {
      // Regular lookup
      const matchingBand = RATING_BANDS.find(band => roundedOverall >= band.min) || RATING_BANDS[RATING_BANDS.length - 1];
      finalRatingLabel = matchingBand.label;
    }

    const bandInfo = RATING_BANDS.find(b => b.label === finalRatingLabel) || RATING_BANDS[3];

    // Standard action responses based on Uganda public service specs
    let recAction = '';
    if (finalRatingLabel === 'Outstanding') {
      recAction = 'Bonus / promotion / recognition';
    } else if (finalRatingLabel === 'Good / Exceeds') {
      recAction = 'Standard increment + development plan';
    } else if (finalRatingLabel === 'Satisfactory / Meets') {
      recAction = 'Minor development focus';
    } else {
      recAction = 'Performance Improvement Plan (PIP) + re-appraisal in 3–6 months';
    }

    return {
      isComplete: true,
      practicePct: pPct,
      theoreticalPct: tPct,
      cmePoints: Math.round(cPoints * 10) / 10,
      cmePct: Math.round(cmePct * 10) / 10,
      overallScore: roundedOverall,
      ratingLabel: finalRatingLabel,
      isCapped,
      recommendedAction: recAction,
      colorClass: bandInfo.color,
      cmeMax
    };
  };

  // Computes instantaneous calculations on current form fields
  const currentEvaluation = useMemo(() => {
    return evaluateAppraisalMetrics(
      staffId, 
      theoreticalScore, 
      practiceScore, 
      appraisalPeriod,
      manualCmeOverride,
      manualCmePoints
    );
  }, [staffId, theoreticalScore, practiceScore, appraisalPeriod, manualCmeOverride, manualCmePoints, sessions, staff]);

  // Form setup for adding
  const handleOpenAdd = () => {
    setEditingAppraisal(null);
    setStaffId('');
    setAppraisalPeriod('Q1');
    setAppraisalYear('2026');
    setTheoreticalScore('');
    setPracticeScore('');
    setManualCmeOverride(false);
    setManualCmePoints('');
    setStrengths('');
    setImprovements('');
    setGoals('');
    setHrRecommendedAction('');
    setIsAdding(true);
  };

  // Trigger editing perspective
  const handleOpenEdit = (app: Appraisal) => {
    setEditingAppraisal(app);
    setStaffId(app.staffId);
    setAppraisalPeriod((app.period as any) || 'Q1');
    setAppraisalYear(app.year || '2026');
    setTheoreticalScore(app.theoreticalScore !== undefined ? app.theoreticalScore.toString() : '');
    setPracticeScore(app.practiceScore !== undefined ? app.practiceScore.toString() : '');
    setManualCmeOverride(app.cmePoints !== undefined);
    setManualCmePoints(app.cmePoints !== undefined ? app.cmePoints.toString() : '');
    setStrengths(Array.isArray(app.strengths) ? app.strengths.join('\n') : (app.strengths || ''));
    setImprovements(Array.isArray(app.improvements) ? app.improvements.join('\n') : (app.improvements || ''));
    setGoals(Array.isArray(app.goals) ? app.goals.join('\n') : (app.goals || ''));
    setHrRecommendedAction(app.hrRecommendedAction || '');
    setIsAdding(true);
  };

  // Form submission directly supporting draft updates and completed values
  const handleSaveAppraisal = async (e: React.FormEvent, submitStatus: 'Draft' | 'Completed') => {
    e.preventDefault();
    if (!tenantId || !activeBranch || !user || !staffId) {
      toast.warning('Please select a valid staff member.');
      return;
    }

    const staffMember = staff.find(s => s.id === staffId);
    if (!staffMember) return;

    const staffName = staffMember.full_name || staffMember.fullName || 'Unknown Staff';

    const pScore = practiceScore !== '' ? parseFloat(practiceScore) : undefined;
    const tScore = theoreticalScore !== '' ? parseFloat(theoreticalScore) : undefined;

    // Evaluate metrics using the calculation unit
    const calculations = evaluateAppraisalMetrics(
      staffId,
      practiceScore !== '' ? practiceScore : '',
      theoreticalScore !== '' ? theoreticalScore : '',
      appraisalPeriod,
      manualCmeOverride,
      manualCmePoints
    );

    try {
      const dataPayload: Partial<Appraisal> = {
        tenantId,
        branchId: activeBranch.id,
        staffId,
        staffName,
        date: new Date().toISOString(),
        period: appraisalPeriod,
        year: appraisalYear,
        practiceScore: pScore,
        theoreticalScore: tScore,
        cmePoints: calculations.cmePoints,
        cmePercentage: calculations.cmePct,
        cmeMaxPoints: calculations.cmeMax,
        status: submitStatus,
        strengths: strengths.split('\n').filter(s => s.trim()),
        improvements: improvements.split('\n').filter(s => s.trim()),
        goals: goals.split('\n').filter(s => s.trim()),
        appraiserName: user.fullName || user.displayName || 'Authorized QA/Manager',
      };

      if (submitStatus === 'Completed') {
        dataPayload.overallScore = calculations.overallScore;
        dataPayload.ratingBand = calculations.ratingLabel;
        dataPayload.cappedThresholdAlert = calculations.isCapped;
        dataPayload.hrRecommendedAction = hrRecommendedAction || calculations.recommendedAction;
        
        // Audit roles loggers
        if (pScore !== undefined) {
          dataPayload.managerLoggedBy = user.fullName;
          dataPayload.managerLoggedAt = new Date().toISOString();
        }
        if (tScore !== undefined) {
          dataPayload.qaLoggedBy = user.fullName;
          dataPayload.qaLoggedAt = new Date().toISOString();
        }
      }

      if (editingAppraisal?.id) {
        await firestoreService.updateDocument('appraisals', editingAppraisal.id, dataPayload);
        toast.success(`Appraisal updated successfully as ${submitStatus}.`);
      } else {
        await firestoreService.addDocument('appraisals', {
          ...dataPayload,
          created_at: new Date().toISOString()
        });
        toast.success(`Appraisal logged successfully as ${submitStatus}.`);
      }

      setIsAdding(false);
      setEditingAppraisal(null);
    } catch (err) {
      toast.error('Could not save the staff appraisal sheet. Verify Firestore connectivity.');
    }
  };

  const filteredAppraisals = appraisals.filter(a => {
    const matchesSearch = (a.staffName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (a.appraiserName || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPeriod = selectedPeriodFilter === 'all' || a.period === selectedPeriodFilter;
    return matchesSearch && matchesPeriod;
  });

  // Calculate executive KPI insights
  const stats = useMemo(() => {
    const completed = appraisals.filter(a => a.status === 'Completed');
    if (completed.length === 0) return { avgOverall: 0, complianceRate: 0, pipCount: 0, totalRuns: appraisals.length };

    const sumOverall = completed.reduce((sum, a) => sum + (a.overallScore || 0), 0);
    const avgOverall = Math.round((sumOverall / completed.length) * 10) / 10;

    // PIP or capped score count
    const pipCount = completed.filter(a => (a.overallScore || 0) < 70 || a.cappedThresholdAlert).length;
    
    // Safety score compliance: (Count of employees with all metric scores >= 70%) / total
    const safeEmployeesCount = completed.filter(a => !a.cappedThresholdAlert).length;
    const complianceRate = Math.round((safeEmployeesCount / completed.length) * 100);

    return {
      avgOverall,
      complianceRate,
      pipCount,
      totalRuns: appraisals.length
    };
  }, [appraisals]);

  return (
    <div id="pharmacy-appraisals-module" className="space-y-6">
      {/* Dynamic Professional Tab Navigation */}
      <div className="flex border-b border-gray-100 bg-white p-2 rounded-xl shadow-sm gap-2">
        <button
          id="btn-tab-overview"
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'overview' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <PieChart className="w-4 h-4" />
          <span>Executive Dashboard</span>
        </button>
        <button
          id="btn-tab-runs"
          onClick={() => setActiveTab('run')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'run' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>Active Appraisal Register</span>
          {appraisals.filter(a => a.status !== 'Completed').length > 0 && (
            <span className="bg-amber-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold">
              {appraisals.filter(a => a.status !== 'Completed').length}
            </span>
          )}
        </button>
        <button
          id="btn-tab-history"
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'history' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <History className="w-4 h-4" />
          <span>Archive of Decided Audits</span>
        </button>
      </div>

      {/* PERSPECTIVE 1: Executive Insights */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm flex items-center gap-4">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                <BarChart3 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Average Grade</p>
                <h3 className="text-2xl font-black text-slate-800">{stats.avgOverall}%</h3>
                <p className="text-[10px] text-slate-500">Completed cycles</p>
              </div>
            </div>

            <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm flex items-center gap-4">
              <div className="p-3 bg-green-50 text-green-600 rounded-xl">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Safety Compliance</p>
                <h3 className="text-2xl font-black text-slate-800">{stats.complianceRate}%</h3>
                <p className="text-[10px] text-slate-500">Metrics ≥ 70% threshold</p>
              </div>
            </div>

            <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm flex items-center gap-4">
              <div className="p-3 bg-red-50 text-red-600 rounded-xl">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Severe Risk (PIP)</p>
                <h3 className="text-2xl font-black text-slate-800">{stats.pipCount} staff</h3>
                <p className="text-[10px] text-orange-600">Pending performance focus</p>
              </div>
            </div>

            <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm flex items-center gap-4">
              <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
                <Award className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Total Evaluated</p>
                <h3 className="text-2xl font-black text-slate-800">{stats.totalRuns} total</h3>
                <p className="text-[10px] text-slate-500">Draft + Finalized logs</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2 text-md">
                <Zap className="w-5 h-5 text-indigo-500" />
                Uganda Public Service & Patient Safety Rules overview
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Pharmacy team operations incorporate a strict double-ledger appraisal strategy. Supervisors/managers log practice performance reviews directly from physical site appraisals, while Quality Assurance (QA) personnel log specific theoretical assessment test marks following professional CME sessions.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="space-y-1">
                  <span className="text-xs text-indigo-600 font-black tracking-wider uppercase">Practice Weight</span>
                  <p className="text-2xl font-black text-slate-800">50%</p>
                  <p className="text-[10px] text-slate-400">Supervisor/Manager Guide</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-amber-600 font-black tracking-wider uppercase">Theoretical Weight</span>
                  <p className="text-2xl font-black text-slate-800">30%</p>
                  <p className="text-[10px] text-slate-400">QA Exam Marks</p>
                </div>
                <div className="space-y-1 font-sans">
                  <span className="text-xs text-emerald-600 font-black tracking-wider uppercase">CME Attendance</span>
                  <p className="text-2xl font-black text-slate-800">20%</p>
                  <p className="text-[10px] text-slate-400">Normalized (98/390 pts)</p>
                </div>
              </div>

              <div className="p-4 border-l-4 border-amber-500 bg-amber-50 rounded-r-xl space-y-1">
                <h4 className="text-xs font-black text-amber-800 uppercase flex items-center gap-1">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  Mandatory Non-Negotiable Gate
                </h4>
                <p className="text-xs text-amber-700 leading-relaxed">
                  To safeguard patients from critical dispensing errors, **any individual metrics scoring below 70%** (i.e. either practice, theoretical, or normalized CME percentage) will automatically trigger an overall rating cap of **"Needs Improvement"** and mandate a PIP and standard re-appraisal in 3-6 months, regardless of how high the mathematical overall weighted average is.
                </p>
              </div>
            </div>

            <div className="p-6 bg-white rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-800 text-sm">Rating Standards & Actions</h3>
              <div className="space-y-3">
                {RATING_BANDS.map(b => (
                  <div key={b.label} className="p-3 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-100/60 transition-colors">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-slate-800 uppercase">{b.label}</span>
                      <span className="text-[10px] font-extrabold text-[#3a0ca3]">{b.min}%+</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-normal">{b.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PERSPECTIVE 2: Active Run Operations (Split Ledger logs for Manager / QA) */}
      {activeTab === 'run' && (
        <div className="space-y-4 bg-white border border-slate-100 rounded-2xl shadow-sm p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-800">Branch Appraisal Feed</h3>
              <p className="text-xs text-slate-400 leading-normal mt-1">
                Initiate, update, and manage ongoing appraisal sheets. Managers log practice evaluations and QA logs theoretical marks.
              </p>
            </div>
            <button
              id="btn-initiate-appraisal"
              onClick={handleOpenAdd}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-sm text-sm font-bold"
            >
              <Plus className="w-4 h-4" />
              <span>New Appraisal Sheet</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Find staff members in active logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-slate-800"
              />
            </div>
            <select
              value={selectedPeriodFilter}
              onChange={(e) => setSelectedPeriodFilter(e.target.value)}
              className="px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700"
            >
              <option value="all">All Periods (Quarterly & Annual)</option>
              <option value="Q1">Q1 (Quarter 1)</option>
              <option value="Q2">Q2 (Quarter 2)</option>
              <option value="Q3">Q3 (Quarter 3)</option>
              <option value="Q4">Q4 (Quarter 4)</option>
              <option value="Annual">Annual Cycle</option>
            </select>
          </div>

          <div className="overflow-x-auto mt-4 rounded-xl border border-slate-100">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-500 uppercase">
                  <th className="p-3">Staff Profile</th>
                  <th className="p-3">Appraisal Period</th>
                  <th className="p-3">Manager Practice Log</th>
                  <th className="p-3">QA Theoretical Log</th>
                  <th className="p-3">CME points Sync</th>
                  <th className="p-3">Workflow State</th>
                  <th className="p-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredAppraisals.map((app) => {
                  const hasPractice = app.practiceScore !== undefined;
                  const hasTheoretical = app.theoreticalScore !== undefined;
                  
                  return (
                    <tr key={app.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-700 font-extrabold flex items-center justify-center text-xs">
                            {(app.staffName || 'S').charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-700">{app.staffName}</p>
                            <p className="text-[10px] text-slate-400">Assigned Branch member</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="inline-flex px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-semibold uppercase">
                          {app.period} {app.year || '2026'}
                        </span>
                      </td>
                      <td className="p-3">
                        {hasPractice ? (
                          <div className="space-y-0.5">
                            <span className="text-sm font-black text-slate-800">{app.practiceScore}%</span>
                            <p className="text-[9px] text-indigo-500">Supervisor logged</p>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Pending supervisor review</span>
                        )}
                      </td>
                      <td className="p-3">
                        {hasTheoretical ? (
                          <div className="space-y-0.5">
                            <span className="text-sm font-black text-slate-800">{app.theoreticalScore}%</span>
                            <p className="text-[9px] text-amber-500">QA exam logged</p>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Pending post-CME exam</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="space-y-0.5">
                          <span className="font-bold text-emerald-600">{app.cmePoints || 0} pts</span>
                          <span className="text-[9px] text-slate-400 block font-normal">
                            Normalized: {app.cmePercentage || 0}%
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${app.status === 'Completed' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${app.status === 'Completed' ? 'bg-indigo-600' : 'bg-amber-500 animate-pulse'}`} />
                          {app.status}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleOpenEdit(app)}
                            className="p-1 px-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg flex items-center gap-1 border border-slate-100 text-xs font-semibold transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Modify Score Sheet</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredAppraisals.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-slate-400">
                      <BarChart3 className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                      <p className="text-xs">No matching appraisal feeds found for the selected filter.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PERSPECTIVE 3: Full Decided Archives (Completed evaluations and actions) */}
      {activeTab === 'history' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-100 shadow-sm rounded-2xl p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-50 pb-4">
              <div>
                <h3 className="font-bold text-slate-800 text-md">Finalized Audits & HR Decisions</h3>
                <p className="text-xs text-slate-400 mt-0.5">Fully aggregate scores & safety decisions for verified personnel</p>
              </div>
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
                {appraisals.filter(a => a.status === 'Completed').length} records archived
              </span>
            </div>

            <div className="divide-y divide-slate-100 whitespace-nowrap overflow-x-auto lg:overflow-x-visible">
              {appraisals.filter(a => a.status === 'Completed').map((appraisal) => {
                const band = RATING_BANDS.find(b => b.label === appraisal.ratingBand) || RATING_BANDS[3];
                const hasPractice = appraisal.practiceScore !== undefined;
                const hasTheoretical = appraisal.theoreticalScore !== undefined;
                
                return (
                  <div key={appraisal.id} className="p-4 hover:bg-slate-50/60 rounded-xl transition-all flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-700 font-black flex items-center justify-center text-sm">
                        {(appraisal.staffName || 'U').charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-slate-800 text-sm">{appraisal.staffName}</h4>
                          <span className="px-1.5 py-0.5 bg-slate-100 rounded text-[9px] text-slate-500 font-bold uppercase">
                            {appraisal.period}
                          </span>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-[11px] text-slate-400 mt-1">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {format(new Date(appraisal.date), 'MMM d, yyyy')}
                          </span>
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            Certifier: {appraisal.appraiserName}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {appraisal.cappedThresholdAlert && (
                            <span className="p-0.5 bg-red-100 text-red-600 rounded-md" title="Patient Safety Threshold Cap Active">
                              <ShieldAlert className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <span className="text-xl font-black text-slate-800 leading-none">{appraisal.overallScore}%</span>
                        </div>
                        <span className={`mt-1 inline-flex items-center px-2 py-0.5 rounded text-[9px] font-extrabold uppercase border ${band.color}`}>
                          {appraisal.ratingBand}
                        </span>
                      </div>

                      <button
                        onClick={() => setViewingReport(appraisal)}
                        className="px-3 py-1.5 bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-1"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Inspect Draft</span>
                      </button>
                    </div>
                  </div>
                );
              })}
              {appraisals.filter(a => a.status === 'Completed').length === 0 && (
                <div className="p-12 text-center text-slate-400">
                  <BarChart3 className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                  <p className="text-xs">No finalized appraisals registered in this branch.</p>
                </div>
              )}
            </div>
          </div>

          <div className="p-6 bg-white border border-slate-100 shadow-sm rounded-2xl h-fit space-y-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
              <ShieldAlert className="w-4 h-4 text-indigo-500" />
              HR Decision Panel Instructions
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              When an appraisal achieves **Outstanding (90%+)** with all individual metrics exceeding 70%, HR is prompted to certify the recommended action from a dedicated roster:
            </p>
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-extrabold">●</span>
                <span><strong>Bonus:</strong> Financial merit allowance.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-extrabold">●</span>
                <span><strong>Promotion:</strong> Fast-track position raise.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-extrabold">●</span>
                <span><strong>Recognition:</strong> Formal certification award.</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* COMPONENT MODAL: Initiate/Update Appraisal Entry */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-100 my-4"
            >
              <div className="p-6 border-b border-gray-100 bg-slate-50 flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-indigo-600" />
                    {editingAppraisal ? 'Modify Score Sheet' : 'Initiate New Staff Appraisal Period'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Fill the metrics guidelines below to compile an authorized scorecard.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="p-1 px-3 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 text-xs font-bold transition-colors"
                >
                  ✕ Close
                </button>
              </div>

              <form onSubmit={(e) => handleSaveAppraisal(e, 'Completed')} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto custom-scrollbar">
                {/* SECTION 1: Core Period Definitions */}
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-4">
                  <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    Cycle Configuration
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Select Staff Member</label>
                      <select
                        required
                        disabled={!!editingAppraisal}
                        value={staffId}
                        onChange={(e) => setStaffId(e.target.value)}
                        className="w-full px-3 py-2 bg-white rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 text-sm transition-all"
                      >
                        <option value="">Select recipient...</option>
                        {staff.map(s => (
                          <option key={s.id} value={s.id}>{s.fullName || s.full_name} ({s.role || 'Staff'})</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Appraisal Interval</label>
                      <select
                        required
                        value={appraisalPeriod}
                        onChange={(e) => setAppraisalPeriod(e.target.value as any)}
                        className="w-full px-3 py-2 bg-white rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 text-sm transition-all"
                      >
                        <option value="Q1">Q1 (1st Quarter)</option>
                        <option value="Q2">Q2 (2nd Quarter)</option>
                        <option value="Q3">Q3 (3rd Quarter)</option>
                        <option value="Q4">Q4 (4th Quarter)</option>
                        <option value="Annual">Annual Cycle (Standard 390 pt target)</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Evaluation Year</label>
                      <select
                        required
                        value={appraisalYear}
                        onChange={(e) => setAppraisalYear(e.target.value)}
                        className="w-full px-3 py-2 bg-white rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 text-sm transition-all"
                      >
                        <option value="2026">2026</option>
                        <option value="2025">2025</option>
                        <option value="2024">2024</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* SEC 2: Splitted logs for Manager / QA Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Manager Block - PRACTICE */}
                  <div className="p-4 bg-indigo-50/40 border border-indigo-100 rounded-xl space-y-3">
                    <div className="flex justify-between items-center bg-indigo-50 px-2 py-1 rounded-md">
                      <h4 className="text-xs font-black text-indigo-800 uppercase tracking-widest">Manager's Practice Log</h4>
                      <span className="text-[10px] font-bold text-indigo-600 bg-white px-1 py-0.5 rounded">Weight: 50%</span>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-indigo-700">Practice score from appraisal form (%)</label>
                      <input
                        type="number"
                        max="100"
                        min="0"
                        value={practiceScore}
                        onChange={(e) => setPracticeScore(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white rounded-lg border border-slate-200 text-slate-700 text-sm placeholder:text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="Expected (0-100)"
                      />
                    </div>
                  </div>

                  {/* QA Personnel Block - THEORETICAL */}
                  <div className="p-4 bg-amber-50/40 border border-amber-100 rounded-xl space-y-3">
                    <div className="flex justify-between items-center bg-amber-50 px-2 py-1 rounded-md">
                      <h4 className="text-xs font-black text-amber-800 uppercase tracking-widest">QA Theoretical Log</h4>
                      <span className="text-[10px] font-bold text-amber-600 bg-white px-1 py-0.5 rounded">Weight: 30%</span>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-amber-700">Theoretical Score post-CME Exam (%)</label>
                      <input
                        type="number"
                        max="100"
                        min="0"
                        value={theoreticalScore}
                        onChange={(e) => setTheoreticalScore(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white rounded-lg border border-slate-200 text-slate-700 text-sm placeholder:text-slate-300 focus:ring-2 focus:ring-amber-500 outline-none"
                        placeholder="Expected (0-100)"
                      />
                    </div>
                  </div>
                </div>

                {/* SECTION 3: CME Engine Sync details */}
                <div className="p-4 bg-emerald-50/35 border border-emerald-100 rounded-xl space-y-3">
                  <div className="flex justify-between items-center bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100/40">
                    <h4 className="text-xs font-black text-emerald-800 uppercase tracking-wider">CME Engine Point Normalized Data</h4>
                    <span className="text-[10px] font-black text-emerald-700 uppercase">Weight: 20%</span>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <p className="text-xs text-slate-600 leading-normal">
                        Accumulated Points out of **{currentEvaluation.cmeMax}**. Automatically queries attendees & presenters registers:
                      </p>
                      <div className="flex items-center gap-4 mt-2">
                        <span className="text-sm font-extrabold text-[#3a0ca3] flex items-center gap-1">
                          <CheckCircle className="w-4 h-4 text-emerald-600" />
                          {getStaffCmePoints(staffId)} points calculated
                        </span>
                        <span className="text-xs text-slate-500">
                          {currentEvaluation.cmePct}% Achievement Normalized
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setManualCmeOverride(!manualCmeOverride)}
                      className="px-2.5 py-1 text-xs text-slate-500 hover:text-indigo-600 font-extrabold border border-slate-200 bg-white rounded-lg shadow-sm hover:shadow transition-all uppercase tracking-wider"
                    >
                      {manualCmeOverride ? "✕ Auto Fetch" : "✎ Override points"}
                    </button>
                  </div>

                  {manualCmeOverride && (
                    <div className="mt-3 p-3 bg-white rounded-lg border border-slate-150 space-y-1">
                      <label className="text-xs font-semibold text-slate-600 block">Enter Custom CME Points</label>
                      <input
                        type="number"
                        value={manualCmePoints}
                        onChange={(e) => setManualCmePoints(e.target.value)}
                        className="w-32 px-2 py-1 border border-slate-200 rounded text-xs outline-none"
                        placeholder="E.g., 90"
                      />
                    </div>
                  )}
                </div>

                {/* DYNAMIC CALCULATION CARD (Real-time update) */}
                {staffId && (
                  <div className="p-4 bg-slate-900 text-slate-100 rounded-2xl relative overflow-hidden border border-slate-800">
                    <h4 className="text-[11px] font-black tracking-wider text-indigo-400 uppercase">Scores Projection</h4>
                    
                    <div className="grid grid-cols-3 gap-2 mt-3 division-slate-800 divide-x">
                      <div className="px-2">
                        <p className="text-[9px] text-slate-400 font-bold uppercase">Practice (50%)</p>
                        <h4 className="text-md font-bold text-white">
                          {currentEvaluation.practicePct}%
                        </h4>
                      </div>
                      <div className="px-2">
                        <p className="text-[9px] text-slate-400 font-bold uppercase">Theoretical (30%)</p>
                        <h4 className="text-md font-bold text-white">
                          {currentEvaluation.theoreticalPct}%
                        </h4>
                      </div>
                      <div className="px-2">
                        <p className="text-[9px] text-slate-400 font-bold uppercase">CME normalized (20%)</p>
                        <h4 className="text-md font-bold text-white">
                          {currentEvaluation.cmePct}%
                        </h4>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4 pt-3 border-t border-slate-800 gap-4">
                      <div>
                        {currentEvaluation.isCapped ? (
                          <div className="flex items-center gap-1.5 text-xs text-amber-400 font-extrabold bg-amber-500/10 px-2 py-1 rounded-lg">
                            <ShieldAlert className="w-4 h-4 shrink-0" />
                            <span>Safety threshold cap applied: Metric {`< 70%`}</span>
                          </div>
                        ) : (
                          <p className="text-xs text-indigo-300 font-medium">Weighted grade computes meets safety criteria</p>
                        )}
                        <h3 className="text-2xl font-black text-white mt-1">
                          {currentEvaluation.isComplete ? `${currentEvaluation.overallScore}%` : 'Pending Input'}
                        </h3>
                      </div>

                      <div className="text-right">
                        <p className="text-[10px] text-slate-400">Projected Designation</p>
                        <span className={`inline-flex px-2 rounded font-extrabold uppercase text-xs mt-1 ${currentEvaluation.colorClass}`}>
                          {currentEvaluation.ratingLabel}
                        </span>
                      </div>
                    </div>

                    {/* HR Recommended action dropdown for Outstanding scoring limits */}
                    {currentEvaluation.isComplete && currentEvaluation.ratingLabel === 'Outstanding' && (
                      <div className="mt-4 pt-3 border-t border-slate-800 space-y-1.5">
                        <label className="text-xs font-semibold text-slate-400 block">HR Recommended Action (Mandatory for Outstanding)</label>
                        <select
                          required
                          value={hrRecommendedAction}
                          onChange={(e) => setHrRecommendedAction(e.target.value)}
                          className="px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-white"
                        >
                          <option value="">Choose HR action...</option>
                          <option value="Bonus">Allow Bonus Payment</option>
                          <option value="Promotion">Recommend Promotion</option>
                          <option value="Recognition">Award Recognition Certificate</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* Strengths & Growth Areas */}
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase">Key Strengths (One per line)</label>
                    <textarea
                      value={strengths}
                      onChange={(e) => setStrengths(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 h-16 resize-none transition-all placeholder:text-[11px]"
                      placeholder="Enter outstanding positive skills demonstrated..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase">Areas for Growth / Improvement (One per line)</label>
                    <textarea
                      value={improvements}
                      onChange={(e) => setImprovements(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 h-16 resize-none transition-all placeholder:text-[11px]"
                      placeholder="Enter gaps detected or minor development focuses..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase">Development Goals (One per line)</label>
                    <textarea
                      value={goals}
                      onChange={(e) => setGoals(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 h-16 resize-none transition-all placeholder:text-[11px]"
                      placeholder="Enter strategic goals for the next quarterly session..."
                    />
                  </div>
                </div>

                {/* MODAL BOTTOM BUTTONS */}
                <div className="flex gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdding(false);
                      setEditingAppraisal(null);
                    }}
                    className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors font-bold text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleSaveAppraisal(e, 'Draft')}
                    className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors font-bold text-sm border border-slate-200"
                  >
                    Save as Draft
                  </button>
                  <button
                    type="submit"
                    disabled={!currentEvaluation.isComplete}
                    className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed font-bold text-sm"
                  >
                    Finalize appraisal
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* COMPONENT MODAL: Viewing Final Report Detailing */}
      <AnimatePresence>
        {viewingReport && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-100 text-slate-800"
            >
              <div className="p-6 bg-slate-900 text-white flex justify-between items-start">
                <div>
                  <span className="inline-flex px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded text-[9px] font-bold uppercase tracking-widest border border-indigo-500/10 mb-2">
                    {viewingReport.period} Cycle Audit Report
                  </span>
                  <h3 className="text-xl font-black text-white">{viewingReport.staffName}</h3>
                  <p className="text-xs text-slate-400 mt-1">Certified By Appraiser: {viewingReport.appraiserName}</p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black text-white">{viewingReport.overallScore}%</div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wide tracking-wider bg-indigo-600 px-2 py-0.5 rounded text-white mt-1 inline-block">
                    {viewingReport.ratingBand}
                  </span>
                </div>
              </div>

              <div className="p-6 space-y-6 max-h-[65vh] overflow-y-auto">
                {/* Score indicators card */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-150/40">
                    <p className="text-[9px] text-indigo-700 font-bold uppercase">Supervisor Practice</p>
                    <h4 className="text-lg font-black text-indigo-900">{viewingReport.practiceScore}%</h4>
                    <p className="text-[9px] text-slate-400">Evaluated on site</p>
                  </div>
                  <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-150/40">
                    <p className="text-[9px] text-amber-700 font-bold uppercase">QA Post-CME Exam</p>
                    <h4 className="text-lg font-black text-amber-900">{viewingReport.theoreticalScore}%</h4>
                    <p className="text-[9px] text-slate-400">Class assessment</p>
                  </div>
                  <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-150/40">
                    <p className="text-[9px] text-emerald-700 font-bold uppercase">CME points Sync</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <h4 className="text-lg font-black text-emerald-900">{viewingReport.cmePoints}</h4>
                      <span className="text-[10px] text-emerald-600 font-bold">({viewingReport.cmePercentage}%)</span>
                    </div>
                    <p className="text-[9px] text-slate-400">Normal target {viewingReport.cmeMaxPoints} pts</p>
                  </div>
                </div>

                {viewingReport.cappedThresholdAlert && (
                  <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-2.5">
                    <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <h5 className="text-xs font-black text-rose-800 uppercase tracking-wide">Patient Safety Cap Triggered</h5>
                      <p className="text-xs text-rose-700 mt-0.5 leading-normal">
                        One or more individual metrics of this technician did not meet the minimal 70% threshold. The designation is restricted to "Needs Improvement" to schedule corrective supervision actions.
                      </p>
                    </div>
                  </div>
                )}

                <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2.5">
                  <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest">HR Authorized Actions</h4>
                  <div className="flex items-center gap-2">
                    <span className="p-1 bg-indigo-100 text-indigo-600 rounded">
                      <CheckCircle2 className="w-4 h-4" />
                    </span>
                    <span className="text-sm font-semibold text-slate-700">
                      {viewingReport.hrRecommendedAction || 'Standard evaluation trajectory'}
                    </span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Key Strengths Logged</h5>
                    {renderValueList(viewingReport.strengths)}
                  </div>
                  <div className="space-y-1">
                    <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Areas for Growth / PIP Focus</h5>
                    {renderValueList(viewingReport.improvements)}
                  </div>
                  <div className="space-y-1">
                    <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Future Goals</h5>
                    {renderValueList(viewingReport.goals)}
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 text-right">
                <button
                  onClick={() => setViewingReport(null)}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
                >
                  Close Report
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
