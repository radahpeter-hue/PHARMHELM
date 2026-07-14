import React, { useState, useEffect } from 'react';
import { 
  Users, Search, Plus, Filter, FileText, CheckCircle2, XCircle, X,
  UserPlus, Calendar, Mail, Phone, Briefcase, GraduationCap, 
  ClipboardCheck, MessageSquare, Activity, Award, ChevronRight, Ban, Eye
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { firestoreService } from '../../services/firestore';
import { HiringApplication, Staff } from '../../types';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';

export const RecruitmentManager: React.FC = () => {
  const { profile } = useAuth();
  const { tenant } = useTenant();
  const [applications, setApplications] = useState<HiringApplication[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Tab layout standard: line-item databases for applied, theory, oral, practical, and history
  const [activeTab, setActiveTab] = useState<'applied' | 'theory' | 'oral' | 'practical' | 'history'>('applied');
  
  // Modals state
  const [isNewAppModalOpen, setIsNewAppModalOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState<HiringApplication | null>(null);
  const [isLogMarksModalOpen, setIsLogMarksModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  
  // Operations state
  const [actionApp, setActionApp] = useState<HiringApplication | null>(null);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [theoryScoreInput, setTheoryScoreInput] = useState('');
  const [oralScoreInput, setOralScoreInput] = useState('');
  const [practicalScoreInput, setPracticalScoreInput] = useState('');

  useEffect(() => {
    if (profile?.tenantId) {
      return firestoreService.subscribeToCollection<HiringApplication>(
        'hiring_applications',
        profile.tenantId,
        setApplications
      );
    }
  }, [profile?.tenantId]);

  // Filters by status group
  const getSubList = (tab: typeof activeTab) => {
    return applications.filter(app => {
      const matchSearch = app.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          app.position_applied.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchSearch) return false;

      switch (tab) {
        case 'applied':
          return app.status === 'applied';
        case 'theory':
          return ['theoretical_scheduled', 'theoretical_completed'].includes(app.status);
        case 'oral':
          return ['oral_scheduled', 'oral_completed'].includes(app.status);
        case 'practical':
          return ['practical_scheduled', 'practical_completed'].includes(app.status);
        case 'history':
          return ['hired', 'rejected', 'recommended_training', 'training_accepted'].includes(app.status);
        default:
          return false;
      }
    });
  };

  const handleCreateNewApplication = async (data: {
    fullName: string;
    email: string;
    phone: string;
    positionApplied: string;
    educationLevel: string;
    experienceYears: number;
  }) => {
    if (!profile?.tenantId) return;

    try {
      await firestoreService.addDocument('hiring_applications', {
        tenantId: profile.tenantId,
        full_name: data.fullName,
        fullName: data.fullName, // compatible with older schemas
        email: data.email,
        phone: data.phone,
        position_applied: data.positionApplied,
        position_applied_for: data.positionApplied,
        applied_at: new Date().toISOString().split('T')[0],
        status: 'applied',
        education_level: data.educationLevel,
        experience_years: data.experienceYears,
        theory_score: null,
        theory_date: null,
        oral_score: null,
        oral_date: null,
        practical_score: null,
        practical_date: null,
      });

      toast.success('New recruitment application logged successfully.');
      setIsNewAppModalOpen(false);
    } catch {
      toast.error('Failed to create application.');
    }
  };

  const handleUpdateStatusAndSchedule = async (appId: string, nextStatus: string, dateField?: string, dateVal?: string) => {
    try {
      const updates: Record<string, any> = { status: nextStatus };
      if (dateField && dateVal) {
        updates[dateField] = dateVal;
      }
      await firestoreService.updateDocument('hiring_applications', appId, updates);
      toast.success(`Application updated to: ${nextStatus.replace('_', ' ')}`);
      setIsScheduleModalOpen(false);
      setActionApp(null);
    } catch {
      toast.error('Failed to schedule stage.');
    }
  };

  const handleTransitionToSchedule = (app: HiringApplication, actionName: 'theory' | 'oral' | 'practical') => {
    setActionApp(app);
    setScheduleDate(new Date().toISOString().split('T')[0]);
    setIsScheduleModalOpen(true);
  };

  const handleSaveMarks = async () => {
    if (!actionApp) return;

    try {
      const updates: Record<string, any> = {};
      
      if (actionApp.status === 'theoretical_scheduled') {
        const score = parseFloat(theoryScoreInput);
        if (isNaN(score) || score < 0 || score > 100) {
          toast.error('Please input a valid score between 0 and 100');
          return;
        }
        updates.theory_score = score;
        updates.status = 'theoretical_completed';
      } else if (actionApp.status === 'oral_scheduled') {
        const score = parseFloat(oralScoreInput);
        if (isNaN(score) || score < 0 || score > 100) {
          toast.error('Please input a valid score between 0 and 100');
          return;
        }
        updates.oral_score = score;
        updates.status = 'oral_completed';
      } else if (actionApp.status === 'practical_scheduled') {
        const score = parseFloat(practicalScoreInput);
        if (isNaN(score) || score < 0 || score > 100) {
          toast.error('Please input a valid score between 0 and 100');
          return;
        }
        updates.practical_score = score;
        updates.status = 'practical_completed';
      }

      await firestoreService.updateDocument('hiring_applications', actionApp.id, updates);
      toast.success('Performance marks updated and locked.');
      setIsLogMarksModalOpen(false);
      setActionApp(null);
      setTheoryScoreInput('');
      setOralScoreInput('');
      setPracticalScoreInput('');
    } catch {
      toast.error('Failed to log marks.');
    }
  };

  const handleOpenLogMarksModal = (app: HiringApplication) => {
    setActionApp(app);
    setTheoryScoreInput(app.theory_score?.toString() || '');
    setOralScoreInput(app.oral_score?.toString() || '');
    setPracticalScoreInput(app.practical_score?.toString() || '');
    setIsLogMarksModalOpen(true);
  };

  const handleRejectCandidate = async (appId: string) => {
    if (!window.confirm('Are you sure you want to reject this candidate?')) return;
    try {
      await firestoreService.updateDocument('hiring_applications', appId, { status: 'rejected' });
      toast.success('Candidate status updated to Rejected');
      // If modal is open, close it
      setSelectedApp(null);
    } catch {
      toast.error('Failed to reject candidate');
    }
  };

  const handleRecommendForTraining = async (appId: string) => {
    if (!window.confirm('Are you sure you want to recommend this candidate for training appraisal?')) return;
    try {
      await firestoreService.updateDocument('hiring_applications', appId, { 
        status: 'recommended_training',
        training_recommended_date: new Date().toISOString().split('T')[0]
      });
      toast.success('Candidate recommended for official training program.');
      setSelectedApp(null);
    } catch {
      toast.error('Failed to recommend for training');
    }
  };

  const handleHireCandidate = async (app: HiringApplication) => {
    if (!profile?.tenantId) return;

    // Strict validation: Must have ALL marks logs added before hiring!
    if (app.theory_score === null || app.theory_score === undefined ||
        app.oral_score === null || app.oral_score === undefined ||
        app.practical_score === null || app.practical_score === undefined) {
      toast.error('Safety Hold: Cannot hire candidate. All 3 marks logs (Theoretical, Oral, and Practical) must be recorded first!');
      return;
    }

    if (!window.confirm(`Confirm hiring of candidate ${app.full_name} for the position of ${app.position_applied}?`)) return;

    try {
      // 1. Mark application as Hired
      await firestoreService.updateDocument('hiring_applications', app.id, { 
        status: 'hired'
      });

      // 2. Generate username and register in Staff roster
      const cleanName = app.full_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const uniqueSuffix = Math.floor(100 + Math.random() * 900);
      const acronym = tenant?.acronym ? tenant.acronym.toLowerCase().trim() : '';
      const baseUsername = `${cleanName}${uniqueSuffix}`;
      const generatedUsername = acronym ? `${baseUsername}@${acronym}` : baseUsername;

      const staffId = await firestoreService.addDocument('staff', {
        tenantId: profile.tenantId,
        full_name: app.full_name,
        username: generatedUsername,
        email: app.email,
        phone: app.phone,
        role: app.position_applied,
        department: 'Operations',
        status: 'active',
        active: true,
        uid: '',
        password_set: false,
        remunerationType: 'Salary',
        remunerationRate: 800000, // Uganda standard minimum base
        joinedDate: new Date().toISOString().split('T')[0]
      });

      // 3. Setup activation request for safety
      if (staffId) {
        await firestoreService.addDocument('pending_activations', {
          tenantId: profile.tenantId,
          staffId: staffId,
          name: app.full_name,
          role: app.position_applied,
          status: 'pending',
          requestedAt: new Date().toISOString()
        });
      }

      toast.success(`Successfully hired ${app.full_name}! They are registered in the Staff Roster and pending IT account activation.`);
      setSelectedApp(null);
    } catch {
      toast.error('Failed to conclude hire transaction.');
    }
  };

  const getStageHeader = () => {
    switch (activeTab) {
      case 'applied': return 'Candidates Pool (New Logs)';
      case 'theory': return 'Theoretical Assessments Scheduling & Scores';
      case 'oral': return 'Oral Evaluation Scheduling & Ratings';
      case 'practical': return 'Practical Assessments & On-Field Verification';
      case 'history': return 'Recruitment Historical Register';
    }
  };

  const getStageDescription = () => {
    switch (activeTab) {
      case 'applied': return 'List of candidates who logged application entries into the portal.';
      case 'theory': return 'Schedule exams and lock standard score ratings for candidates.';
      case 'oral': return 'Record interviews and appraisals for selected shortlisted candidates.';
      case 'practical': return 'In-depth competency testing, final check marks loggers.';
      case 'history': return 'Archived outcomes for all candidates hired, rejected, or active in training.';
    }
  };

  const statusLabel = (st: string) => {
    switch (st) {
      case 'applied': return 'New Application';
      case 'theoretical_scheduled': return 'Theory exam Scheduled';
      case 'theoretical_completed': return 'Theory Exam Graded';
      case 'oral_scheduled': return 'Oral Interview Scheduled';
      case 'oral_completed': return 'Oral Interview Graded';
      case 'practical_scheduled': return 'Practical Scheduled';
      case 'practical_completed': return 'Practical Verified';
      case 'recommended_training': return 'Recommended for Train';
      case 'training_accepted': return 'Admitted in Training';
      case 'hired': return 'Hired';
      case 'rejected': return 'Rejected';
      default: return st;
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
          <SubTabButton active={activeTab === 'applied'} onClick={() => setActiveTab('applied')} label="1. Applied Pool" />
          <SubTabButton active={activeTab === 'theory'} onClick={() => setActiveTab('theory')} label="2. Theoretical Logs" />
          <SubTabButton active={activeTab === 'oral'} onClick={() => setActiveTab('oral')} label="3. Oral Evaluation" />
          <SubTabButton active={activeTab === 'practical'} onClick={() => setActiveTab('practical')} label="4. Practical Stage" />
          <SubTabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} label="History Archive" />
        </div>

        <button 
          onClick={() => setIsNewAppModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 self-start lg:self-auto shadow-md"
        >
          <UserPlus size={15} />
          New Candidate Application
        </button>
      </div>

      {/* Info Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">{getStageHeader()}</h3>
          <p className="text-xs text-slate-400 font-semibold uppercase">{getStageDescription()}</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search within stage..." 
            className="pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-xl max-w-xs focus:ring-2 focus:ring-indigo-500/20 text-xs font-semibold outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Line Item Data Tables/List */}
      <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 bg-slate-50/50">
                <th className="px-6 py-4">Candidate Full Name</th>
                <th className="px-6 py-4">Position Requested</th>
                <th className="px-6 py-4">Current Milestone Status</th>
                <th className="px-6 py-4 text-center">Marks Register</th>
                <th className="px-6 py-4 text-right">Applied Date</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {getSubList(activeTab).map(app => {
                const canHire = app.theory_score !== null && app.theory_score !== undefined &&
                                app.oral_score !== null && app.oral_score !== undefined &&
                                app.practical_score !== null && app.practical_score !== undefined;
                return (
                  <tr key={app.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-bold text-slate-950 text-sm">{app.full_name}</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase">{app.email} • {app.phone}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs font-bold text-slate-700">{app.position_applied}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{app.education_level || 'No Certificate'} • {app.experience_years || 0} Yrs experience</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border",
                        app.status.includes('completed') || app.status === 'hired' ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                        app.status === 'rejected' ? "bg-rose-50 text-rose-700 border-rose-100" :
                        app.status.includes('scheduled') ? "bg-indigo-50 text-indigo-700 border-indigo-100" :
                        "bg-slate-50 text-slate-600 border-slate-100"
                      )}>
                        {statusLabel(app.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1.5 text-xs">
                        <span className="font-semibold text-[10px]" title="Theory">
                          T: <b className="text-indigo-600">{app.theory_score !== null && app.theory_score !== undefined ? `${app.theory_score}%` : '—'}</b>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="font-semibold text-[10px]" title="Oral">
                          O: <b className="text-purple-600">{app.oral_score !== null && app.oral_score !== undefined ? `${app.oral_score}%` : '—'}</b>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="font-semibold text-[10px]" title="Practical">
                          P: <b className="text-amber-600">{app.practical_score !== null && app.practical_score !== undefined ? `${app.practical_score}%` : '—'}</b>
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-xs text-slate-600 font-bold">{app.applied_at}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => setSelectedApp(app)}
                          className="p-1 px-2 text-[10px] uppercase font-black tracking-wider text-slate-600 bg-slate-50 border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-100 rounded-lg transition-colors flex items-center gap-1"
                          title="Candidate Dossier"
                        >
                          <Eye size={12} /> View Details
                        </button>

                        {/* PHASE 1: Applied actions */}
                        {app.status === 'applied' && (
                          <button 
                            onClick={() => handleTransitionToSchedule(app, 'theory')}
                            className="p-1 px-2.5 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-indigo-700 transition-colors"
                          >
                            Schedule Theory
                          </button>
                        )}

                        {/* PHASE 2: Theory and marks action */}
                        {app.status === 'theoretical_scheduled' && (
                          <button 
                            onClick={() => handleOpenLogMarksModal(app)}
                            className="p-1 px-2.5 bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-indigo-200 transition-colors"
                          >
                            Add Theory Marks
                          </button>
                        )}
                        {app.status === 'theoretical_completed' && (
                          <button 
                            onClick={() => handleTransitionToSchedule(app, 'oral')}
                            className="p-1 px-2.5 bg-purple-600 text-white rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-purple-700 transition-colors"
                          >
                            Schedule Oral
                          </button>
                        )}

                        {/* PHASE 3: Oral and marks action */}
                        {app.status === 'oral_scheduled' && (
                          <button 
                            onClick={() => handleOpenLogMarksModal(app)}
                            className="p-1 px-2.5 bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-purple-200 transition-colors"
                          >
                            Add Oral Marks
                          </button>
                        )}
                        {app.status === 'oral_completed' && (
                          <button 
                            onClick={() => handleTransitionToSchedule(app, 'practical')}
                            className="p-1 px-2.5 bg-amber-600 text-white rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-amber-700 transition-colors"
                          >
                            Schedule Practical
                          </button>
                        )}

                        {/* PHASE 4: Practical and marks action */}
                        {app.status === 'practical_scheduled' && (
                          <button 
                            onClick={() => handleOpenLogMarksModal(app)}
                            className="p-1 px-2.5 bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-amber-200 transition-colors"
                          >
                            Add Practical Marks
                          </button>
                        )}
                        {app.status === 'practical_completed' && (
                          <div className="flex gap-1.5">
                            <button 
                              onClick={() => handleHireCandidate(app)}
                              className="p-1 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors"
                            >
                              Hire
                            </button>
                            <button 
                              onClick={() => handleRecommendForTraining(app.id)}
                              className="p-1 px-2.5 border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors"
                            >
                              Training
                            </button>
                          </div>
                        )}

                        {/* Fallback actions always present for unverified or custom status */}
                        {!['hired', 'rejected', 'recommended_training', 'training_accepted'].includes(app.status) && (
                          <button 
                            onClick={() => handleRejectCandidate(app.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded"
                            title="Reject Candidate"
                          >
                            <Ban size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {getSubList(activeTab).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-slate-400">
                    <FileText className="mx-auto text-slate-300 mb-2" size={36} />
                    <p className="font-bold text-xs uppercase tracking-wider text-slate-400">No candidates in this stage.</p>
                    <p className="text-[10px] text-slate-400 mt-1 uppercase">Modify search or add new candidate log to start assessment.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: Detail Candidate Dossier */}
      {selectedApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in duration-200 text-left">
            <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Candidate Professional Assessment dossier</span>
                <h3 className="text-base font-black text-slate-900 mt-1 uppercase tracking-tight">{selectedApp.full_name}</h3>
              </div>
              <button onClick={() => setSelectedApp(null)} className="p-1.5 text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto no-scrollbar">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Selected Profession</p>
                  <p className="text-xs font-bold text-slate-800 mt-1">{selectedApp.position_applied}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Status Milestone</p>
                  <p className="text-xs font-bold text-slate-800 mt-1 uppercase">{statusLabel(selectedApp.status)}</p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1">Primary Contacts</p>
                <p className="text-xs text-slate-600 font-semibold uppercase">Email: <span className="text-slate-900 lowercase font-bold">{selectedApp.email}</span></p>
                <p className="text-xs text-slate-600 font-semibold uppercase">Phone: <span className="text-slate-900 font-bold">{selectedApp.phone}</span></p>
                <p className="text-xs text-slate-600 font-semibold uppercase">Applied Date: <span className="text-slate-900 font-bold">{selectedApp.applied_at}</span></p>
                <p className="text-xs text-slate-600 font-semibold uppercase">Educational Profile: <span className="text-indigo-700 font-bold">{selectedApp.education_level || 'N/A'}</span></p>
                <p className="text-xs text-slate-600 font-semibold uppercase">Experience logged: <span className="text-indigo-700 font-bold">{selectedApp.experience_years || 0} Years</span></p>
              </div>

              {/* Assessment Marks checklist card */}
              <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/60 space-y-4">
                <p className="text-[10px] font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                  <ClipboardCheck size={16} className="text-indigo-600" />
                  Locked Phase Grades
                </p>

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-white rounded-xl border border-slate-100">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Theory Exam</span>
                    <span className="text-sm font-black text-indigo-700 mt-1 block">
                      {selectedApp.theory_score !== null && selectedApp.theory_score !== undefined ? `${selectedApp.theory_score}%` : 'Pending'}
                    </span>
                    {selectedApp.theory_date && <span className="text-[8px] text-slate-400 font-medium block mt-1">{selectedApp.theory_date}</span>}
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-100">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Oral Interview</span>
                    <span className="text-sm font-black text-purple-700 mt-1 block">
                      {selectedApp.oral_score !== null && selectedApp.oral_score !== undefined ? `${selectedApp.oral_score}%` : 'Pending'}
                    </span>
                    {selectedApp.oral_date && <span className="text-[8px] text-slate-400 font-medium block mt-1">{selectedApp.oral_date}</span>}
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-100">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Practical</span>
                    <span className="text-sm font-black text-amber-700 mt-1 block">
                      {selectedApp.practical_score !== null && selectedApp.practical_score !== undefined ? `${selectedApp.practical_score}%` : 'Pending'}
                    </span>
                    {selectedApp.practical_date && <span className="text-[8px] text-slate-400 font-medium block mt-1">{selectedApp.practical_date}</span>}
                  </div>
                </div>

                {/* Training parameters if recommended */}
                {selectedApp.training_recommended_date && (
                  <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[8px] font-black text-slate-400 uppercase">Recommended for Training</p>
                      <p className="text-xs font-bold text-slate-800">{selectedApp.training_recommended_date}</p>
                    </div>
                    {selectedApp.training_accepted_date && (
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase">Accepted Date</p>
                        <p className="text-xs font-bold text-slate-800">{selectedApp.training_accepted_date}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Progress and Hiring constraints info */}
              <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-100 text-[10px] font-semibold text-indigo-800 leading-relaxed uppercase">
                👮 HR Hiring Compliance rule: Candidate must pass all 3 stages. Hiring is locked until theoretical test, oral appraisal, and practical examinations score entries are completely documented in the corporate records.
              </div>
            </div>

            <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 rounded-b-[24px]">
              <button 
                onClick={() => setSelectedApp(null)} 
                className="px-5 py-2 border border-slate-200 bg-white text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 uppercase tracking-wider"
              >
                Close Dossier
              </button>

              {!['hired', 'rejected'].includes(selectedApp.status) && (
                <>
                  <button 
                    onClick={() => handleRecommendForTraining(selectedApp.id)}
                    className="px-5 py-2 border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 text-xs font-bold rounded-xl uppercase tracking-wider"
                  >
                    Recommend for Training
                  </button>
                  <button 
                    onClick={() => handleRejectCandidate(selectedApp.id)}
                    className="px-5 py-2 bg-rose-50 border border-rose-200 text-rose-600 text-xs font-bold rounded-xl hover:bg-rose-100 uppercase tracking-wider animate-pulse"
                  >
                    Reject Candidate
                  </button>
                </>
              )}

              {selectedApp.status === 'practical_completed' && (
                <button 
                  onClick={() => handleHireCandidate(selectedApp)}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl uppercase tracking-wider"
                >
                  Conclude & Hire Candidate
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Create New Application Form */}
      {isNewAppModalOpen && (
        <CreateApplicationModal 
          isOpen={isNewAppModalOpen} 
          onClose={() => setIsNewAppModalOpen(false)} 
          onSubmit={handleCreateNewApplication} 
        />
      )}

      {/* MODAL 3: Log Marks Form */}
      {isLogMarksModalOpen && actionApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in duration-200 text-left">
            <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Performance Assessment Entry</span>
                <h3 className="text-base font-black text-slate-900 mt-1 uppercase tracking-tight">Record Phase Marks</h3>
              </div>
              <button onClick={() => { setIsLogMarksModalOpen(false); setActionApp(null); }} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-4">
              <p className="text-xs text-slate-600 font-bold uppercase">Candidate: <span className="text-slate-900">{actionApp.full_name}</span></p>
              <p className="text-xs text-slate-600 font-bold uppercase">Current Stage: <span className="text-indigo-700">{statusLabel(actionApp.status)}</span></p>
              
              <div className="pt-2">
                {actionApp.status === 'theoretical_scheduled' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Theoretical Assessment Mark (0-100%)</label>
                    <input 
                      type="number"
                      min={0}
                      max={100}
                      autoFocus
                      required
                      placeholder="e.g. 75"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 text-xs outline-none"
                      value={theoryScoreInput}
                      onChange={(e) => setTheoryScoreInput(e.target.value)}
                    />
                  </div>
                )}

                {actionApp.status === 'oral_scheduled' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Oral Evaluation Rating (0-100%)</label>
                    <input 
                      type="number"
                      min={0}
                      max={100}
                      autoFocus
                      required
                      placeholder="e.g. 85"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 text-xs outline-none"
                      value={oralScoreInput}
                      onChange={(e) => setOralScoreInput(e.target.value)}
                    />
                  </div>
                )}

                {actionApp.status === 'practical_scheduled' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Practical Assessment Marks (0-100%)</label>
                    <input 
                      type="number"
                      min={0}
                      max={100}
                      autoFocus
                      required
                      placeholder="e.g. 92"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 text-xs outline-none"
                      value={practicalScoreInput}
                      onChange={(e) => setPracticalScoreInput(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 rounded-b-[24px]">
              <button 
                onClick={() => { setIsLogMarksModalOpen(false); setActionApp(null); }} 
                className="px-5 py-2 border border-slate-200 bg-white text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 uppercase tracking-wider"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveMarks}
                className="px-6 py-2 bg-slate-900 text-white text-xs font-black rounded-xl uppercase tracking-wider"
              >
                Lock Marks Logs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Schedule Exam / Interview Form */}
      {isScheduleModalOpen && actionApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in duration-200 text-left">
            <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Corporate Timetabling</span>
                <h3 className="text-base font-black text-slate-900 mt-1 uppercase tracking-tight">Schedule Assessment Phase</h3>
              </div>
              <button onClick={() => { setIsScheduleModalOpen(false); setActionApp(null); }} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-4">
              <p className="text-xs text-slate-600 font-bold uppercase">Candidate: <span className="text-slate-900">{actionApp.full_name}</span></p>
              
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Timetabled Event Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="date"
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 rounded-b-[24px]">
              <button 
                onClick={() => { setIsScheduleModalOpen(false); setActionApp(null); }} 
                className="px-5 py-2 border border-slate-200 bg-white text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 uppercase tracking-wider"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  let nextSt = '';
                  let dateF = '';
                  if (actionApp.status === 'applied') {
                    nextSt = 'theoretical_scheduled';
                    dateF = 'theory_date';
                  } else if (actionApp.status === 'theoretical_completed') {
                    nextSt = 'oral_scheduled';
                    dateF = 'oral_date';
                  } else if (actionApp.status === 'oral_completed') {
                    nextSt = 'practical_scheduled';
                    dateF = 'practical_date';
                  }
                  handleUpdateStatusAndSchedule(actionApp.id, nextSt, dateF, scheduleDate);
                }}
                className="px-6 py-2 bg-slate-900 text-white text-xs font-black rounded-xl uppercase tracking-wider"
              >
                Confirm Exam Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SubTabButton: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button 
    onClick={onClick}
    className={cn(
      "px-3 py-1.5 rounded-lg text-xs font-bold transition-all uppercase tracking-wider whitespace-nowrap",
      active ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200/60 hover:text-slate-900"
    )}
  >
    {label}
  </button>
);

// Helper Sub-Modal Component for Application Creation
interface CreateAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    fullName: string;
    email: string;
    phone: string;
    positionApplied: string;
    educationLevel: string;
    experienceYears: number;
  }) => void;
}

const CreateApplicationModal: React.FC<CreateAppModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [positionApplied, setPositionApplied] = useState('');
  const [educationLevel, setEducationLevel] = useState('Diploma');
  const [experienceYears, setExperienceYears] = useState('2');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !email || !phone || !positionApplied) {
      toast.error('Please fill in all core fields (*).');
      return;
    }
    onSubmit({
      fullName,
      email,
      phone,
      positionApplied,
      educationLevel,
      experienceYears: parseInt(experienceYears) || 0
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in duration-200 text-left">
        <form onSubmit={handleSubmit}>
          <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Register New Candidate</span>
              <h3 className="text-base font-black text-slate-900 mt-1 uppercase tracking-tight">Log Application Entry</h3>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>
          </div>

          <div className="p-8 space-y-4 max-h-[60vh] overflow-y-auto no-scrollbar">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name *</label>
              <input 
                type="text" 
                required
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                placeholder="e.g. Arthur Ssentongo"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email *</label>
                <input 
                  type="email" 
                  required
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  placeholder="name@portal.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Phone Number *</label>
                <input 
                  type="tel" 
                  required
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  placeholder="+256..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Position Applied For *</label>
              <input 
                type="text" 
                required
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                placeholder="e.g. Field Supervisor / Logistics Officer"
                value={positionApplied}
                onChange={(e) => setPositionApplied(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Highest Education Level</label>
                <select 
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  value={educationLevel}
                  onChange={(e) => setEducationLevel(e.target.value)}
                >
                  <option value="Diploma">Diploma / Cert</option>
                  <option value="Bachelors">Bachelors Degree</option>
                  <option value="Masters">Masters / MBA</option>
                  <option value="PhD">PhD / Doctorate</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Years of Experience</label>
                <input 
                  type="number" 
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  value={experienceYears}
                  onChange={(e) => setExperienceYears(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 rounded-b-[24px]">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-5 py-2 border border-slate-200 bg-white text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 uppercase tracking-wider"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="px-6 py-2 bg-slate-900 text-white text-xs font-black rounded-xl uppercase tracking-wider"
            >
              Log Candidates Application
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
