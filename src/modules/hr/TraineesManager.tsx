import React, { useState, useEffect } from 'react';
import { 
  Briefcase, Search, FileText, CheckCircle2, Award, ClipboardCheck,
  Calendar, Check, UserCheck, Trash2, X, Plus, AlertCircle, TrendingUp, Sparkles, LogIn
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { firestoreService } from '../../services/firestore';
import { HiringApplication } from '../../types';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';

export const TraineesManager: React.FC = () => {
  const { profile } = useAuth();
  const { tenant } = useTenant();
  const [traineeApps, setTraineeApps] = useState<HiringApplication[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Selection
  const [selectedTrainee, setSelectedTrainee] = useState<HiringApplication | null>(null);
  const [isEvaluationModalOpen, setIsEvaluationModalOpen] = useState(false);

  // Appraisal Form States
  const [w4Appraisal, setW4Appraisal] = useState('');
  const [w4Theory, setW4Theory] = useState('');
  
  const [w8Appraisal, setW8Appraisal] = useState('');
  const [w8Theory, setW8Theory] = useState('');
  
  const [w12Appraisal, setW12Appraisal] = useState('');
  const [w12Theory, setW12Theory] = useState('');

  useEffect(() => {
    if (profile?.tenantId) {
      return firestoreService.subscribeToCollection<HiringApplication>(
        'hiring_applications',
        profile.tenantId,
        (data) => {
          // Trainees are either recommended for training or have accepted training
          const trainees = data.filter(item => 
            ['recommended_training', 'training_accepted'].includes(item.status)
          );
          setTraineeApps(trainees);
        }
      );
    }
  }, [profile?.tenantId]);

  // Split into Candidates awaiting admission & active trainees
  const recommendedMatches = traineeApps.filter(app => 
    app.status === 'recommended_training' &&
    app.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeTrainees = traineeApps.filter(app => 
    app.status === 'training_accepted' &&
    app.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAcceptTraining = async (appId: string) => {
    try {
      await firestoreService.updateDocument('hiring_applications', appId, {
        status: 'training_accepted',
        training_accepted_date: new Date().toISOString().split('T')[0]
      });
      toast.success('Trainee officially admitted and started the 12-week program!');
    } catch {
      toast.error('Failed to admit trainee to program.');
    }
  };

  const handleOpenEvaluation = (trainee: HiringApplication) => {
    setSelectedTrainee(trainee);
    setW4Appraisal(trainee.week4_appraisal_score?.toString() || '');
    setW4Theory(trainee.week4_theory_score?.toString() || '');

    setW8Appraisal(trainee.week8_appraisal_score?.toString() || '');
    setW8Theory(trainee.week8_theory_score?.toString() || '');

    setW12Appraisal(trainee.week12_appraisal_score?.toString() || '');
    setW12Theory(trainee.week12_theory_score?.toString() || '');

    setIsEvaluationModalOpen(true);
  };

  const handleSaveEvaluations = async () => {
    if (!selectedTrainee) return;

    try {
      const updates: Partial<HiringApplication> = {
        week4_appraisal_score: w4Appraisal ? parseFloat(w4Appraisal) : null,
        week4_theory_score: w4Theory ? parseFloat(w4Theory) : null,
        
        week8_appraisal_score: w8Appraisal ? parseFloat(w8Appraisal) : null,
        week8_theory_score: w8Theory ? parseFloat(w8Theory) : null,
        
        week12_appraisal_score: w12Appraisal ? parseFloat(w12Appraisal) : null,
        week12_theory_score: w12Theory ? parseFloat(w12Theory) : null,
      };

      // Set timestamp for entries logged
      if (w4Appraisal || w4Theory) updates.week4_assessment_date = new Date().toISOString().split('T')[0];
      if (w8Appraisal || w8Theory) updates.week8_assessment_date = new Date().toISOString().split('T')[0];
      if (w12Appraisal || w12Theory) updates.week12_assessment_date = new Date().toISOString().split('T')[0];

      await firestoreService.updateDocument('hiring_applications', selectedTrainee.id, updates);
      toast.success(`Evaluations updated successfully for ${selectedTrainee.full_name}.`);
      setIsEvaluationModalOpen(false);
      setSelectedTrainee(null);
    } catch {
      toast.error('Failed to save assessment scores.');
    }
  };

  const handleHireGraduate = async (trainee: HiringApplication) => {
    if (!profile?.tenantId) return;

    // Strict validation check: Must have Week 4, Week 8, and Week 12 appraisals and theory scores added
    const scoresComplete = 
      trainee.week4_appraisal_score !== null && trainee.week4_appraisal_score !== undefined &&
      trainee.week4_theory_score !== null && trainee.week4_theory_score !== undefined &&
      trainee.week8_appraisal_score !== null && trainee.week8_appraisal_score !== undefined &&
      trainee.week8_theory_score !== null && trainee.week8_theory_score !== undefined &&
      trainee.week12_appraisal_score !== null && trainee.week12_appraisal_score !== undefined &&
      trainee.week12_theory_score !== null && trainee.week12_theory_score !== undefined;

    if (!scoresComplete) {
      toast.error('Hiring Blocked: Trainee must complete all assessments (Appraisals & Theory) after Week 4, Week 8, and Week 12 before graduation.');
      return;
    }

    if (!window.confirm(`Confirm hiring of Trainee graduate ${trainee.full_name}?`)) return;

    try {
      // 1. Set status to hired
      await firestoreService.updateDocument('hiring_applications', trainee.id, {
        status: 'hired',
        training_completed_date: new Date().toISOString().split('T')[0]
      });

      // 2. Add to actual staff directory
      const cleanName = trainee.full_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const uniqueSuffix = Math.floor(100 + Math.random() * 900);
      const acronym = tenant?.acronym ? tenant.acronym.toLowerCase().trim() : '';
      const baseUsername = `${cleanName}${uniqueSuffix}`;
      const generatedUsername = acronym ? `${baseUsername}@${acronym}` : baseUsername;

      const staffId = await firestoreService.addDocument('staff', {
        tenantId: profile.tenantId,
        full_name: trainee.full_name,
        username: generatedUsername,
        email: trainee.email,
        phone: trainee.phone,
        role: trainee.position_applied || 'Graduate Officer',
        status: 'active',
        active: true,
        uid: '',
        password_set: false,
        remunerationType: 'Salary',
        remunerationRate: 950000, // Augmented salary since they graduated training
        joinedDate: new Date().toISOString().split('T')[0]
      });

      if (staffId) {
        await firestoreService.addDocument('pending_activations', {
          tenantId: profile.tenantId,
          staffId: staffId,
          name: trainee.full_name,
          role: trainee.position_applied || 'Graduate Officer',
          status: 'pending',
          requestedAt: new Date().toISOString()
        });
      }

      toast.success(`Success! Graduate ${trainee.full_name} is hired and set as Active Staff.`);
    } catch {
      toast.error('Failed to conclude graduate hiring.');
    }
  };

  const handleRejectGraduate = async (appId: string) => {
    if (!window.confirm('Are you sure you want to reject this trainee from graduating?')) return;

    try {
      await firestoreService.updateDocument('hiring_applications', appId, {
        status: 'rejected'
      });
      toast.success('Trainee rejected and marked as unsuccessful.');
    } catch {
      toast.error('Failed to update status.');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Banner & Explanation of Rules */}
      <div className="bg-slate-900 text-white p-6 rounded-[32px] border border-slate-800 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <Award size={130} />
        </div>
        <div className="relative z-10 space-y-2">
          <div className="flex items-center gap-2">
            <span className="bg-amber-500/20 text-amber-300 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-amber-500/30">12-Week Program</span>
            <span className="bg-indigo-500/20 text-indigo-300 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-indigo-500/30">Training Dashboard</span>
          </div>
          <h2 className="text-xl font-black uppercase tracking-tight">Trainee Appraisal & Assessment Console</h2>
          <p className="text-xs text-slate-400 font-medium">
            Candidates recommended for training must accept admissions. After weeks 4, 8, and 12, appraisers log performance and tests scores. Final hiring requires 100% of the 12-week metrics.
          </p>
        </div>
      </div>

      {/* Recommended for Training Queue */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Awaiting Admissions Admission</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase">Candidates recommended from recruitment who need training allocation acceptance.</p>
          </div>
          <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded-lg uppercase tracking-wider">{recommendedMatches.length} pending</span>
        </div>

        <div className="bg-white rounded-[24px] border border-slate-200 p-2">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 bg-slate-50/50">
                  <th className="px-4 py-3">Candidate name</th>
                  <th className="px-4 py-3">Allocated Profession</th>
                  <th className="px-4 py-3 text-center">Recommendation Date</th>
                  <th className="px-4 py-3 text-right">Program Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recommendedMatches.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-900 text-xs">{r.full_name}</p>
                      <p className="text-[9px] text-slate-400 font-medium">{r.email}</p>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-700">{r.position_applied}</td>
                    <td className="px-4 py-3 text-center text-xs text-slate-500 font-bold">{r.training_recommended_date || 'N/A'}</td>
                    <td className="px-4 py-3 text-right">
                      <button 
                        onClick={() => handleAcceptTraining(r.id)}
                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1 ml-auto"
                      >
                        <LogIn size={11} /> Admit & Accept Training
                      </button>
                    </td>
                  </tr>
                ))}
                {recommendedMatches.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-xs font-semibold uppercase tracking-wider">
                      No candidates currently awaiting training admissions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Active Trainee Evaluations Block */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Active Trainees (12-Week Appraisal Logs)</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase">Record periodic grades on Week 4, Week 8, and Week 12. Evaluate graduation suitability.</p>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input 
              type="text" 
              placeholder="Search trainees..." 
              className="pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-xl max-w-xs focus:ring-2 focus:ring-indigo-500/20 text-xs font-semibold outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="bg-white rounded-[32px] border border-slate-200 p-2">
          <div className="overflow-x-auto">
            <table className="w-full text-left col-collapse">
              <thead>
                <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 bg-slate-50/50">
                  <th className="px-4 py-4">Trainee Info</th>
                  <th className="px-4 py-4 text-center">Week 4 Marks</th>
                  <th className="px-4 py-4 text-center">Week 8 Marks</th>
                  <th className="px-4 py-4 text-center">Week 12 Marks</th>
                  <th className="px-4 py-4 text-center">Compliance Checks</th>
                  <th className="px-4 py-4 text-right">Appraisal Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeTrainees.map(t => {
                  const hasW4 = t.week4_appraisal_score !== null && t.week4_appraisal_score !== undefined;
                  const hasW8 = t.week8_appraisal_score !== null && t.week8_appraisal_score !== undefined;
                  const hasW12 = t.week12_appraisal_score !== null && t.week12_appraisal_score !== undefined;
                  const scoresComplete = hasW4 && hasW8 && hasW12;

                  return (
                    <tr key={t.id} className="hover:bg-slate-50/30 transition-colors">
                      <td className="px-4 py-4">
                        <p className="font-bold text-slate-900 text-xs">{t.full_name}</p>
                        <span className="text-[10px] text-indigo-600 font-bold">{t.position_applied}</span>
                        <p className="text-[8px] text-slate-400 uppercase font-medium mt-0.5">Admitted: {t.training_accepted_date}</p>
                      </td>
                      <td className="px-4 py-4 text-center">
                        {hasW4 ? (
                          <div className="space-y-0.5">
                            <span className="text-[10px] font-bold text-slate-700 block">Appr: {t.week4_appraisal_score}%</span>
                            <span className="text-[10px] font-bold text-indigo-700 block">Theory: {t.week4_theory_score}%</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-bold">Pending</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        {hasW8 ? (
                          <div className="space-y-0.5">
                            <span className="text-[10px] font-bold text-slate-700 block">Appr: {t.week8_appraisal_score}%</span>
                            <span className="text-[10px] font-bold text-indigo-700 block">Theory: {t.week8_theory_score}%</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-bold">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        {hasW12 ? (
                          <div className="space-y-0.5">
                            <span className="text-[10px] font-bold text-slate-700 block">Appr: {t.week12_appraisal_score}%</span>
                            <span className="text-[10px] font-bold text-indigo-700 block">Theory: {t.week12_theory_score}%</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-bold">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className={cn(
                          "inline-flex px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider border",
                          scoresComplete ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-amber-50 text-amber-700 border-amber-100"
                        )}>
                          {scoresComplete ? "Fully appraised (12w)" : "In training"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button 
                            onClick={() => handleOpenEvaluation(t)}
                            className="px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-700 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg border border-slate-200 hover:border-indigo-100 transition-all"
                          >
                            Update Appraisal
                          </button>

                          {scoresComplete ? (
                            <>
                              <button 
                                onClick={() => handleHireGraduate(t)}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[9px] font-black uppercase tracking-wider transition-all shadow-sm"
                                title="Approve Hire"
                              >
                                Graduate & Hire
                              </button>
                              <button 
                                onClick={() => handleRejectGraduate(t.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded"
                                title="Reject Trainee"
                              >
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <button 
                              onClick={() => handleRejectGraduate(t.id)}
                              className="px-2 py-1 text-slate-300 hover:text-rose-600 text-[9px] font-bold uppercase transition-all"
                              title="Reject trainee prematurely"
                            >
                              Terminate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {activeTrainees.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center text-slate-400">
                      <AlertCircle className="mx-auto text-slate-300 mb-2" size={32} />
                      <p className="font-bold text-xs uppercase tracking-wider text-slate-400">No active trainees admitted.</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Please accept admissions for recommended candidates above.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Evaluation Log Modall */}
      {isEvaluationModalOpen && selectedTrainee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-xl rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in duration-200 text-left">
            <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-[#5c1cbf]">12-week Appraisal Records</span>
                <h3 className="text-base font-black text-slate-900 mt-1 uppercase tracking-tight">Evaluate: {selectedTrainee.full_name}</h3>
              </div>
              <button onClick={() => { setIsEvaluationModalOpen(false); setSelectedTrainee(null); }} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto no-scrollbar">
              <div className="space-y-4">
                {/* WEEK 4 RECORD */}
                <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/60 space-y-3">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-500 block border-b pb-1">Week 4 Evaluation</span>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">Appraisal Rating (0-100)</label>
                      <input 
                        type="number" 
                        min={0} max={100}
                        placeholder="Rating e.g. 80"
                        className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                        value={w4Appraisal}
                        onChange={(e) => setW4Appraisal(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">Theory Exam (0-100)</label>
                      <input 
                        type="number" 
                        min={0} max={100}
                        placeholder="Exam e.g. 78"
                        className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                        value={w4Theory}
                        onChange={(e) => setW4Theory(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* WEEK 8 RECORD */}
                <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/60 space-y-3">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-500 block border-b pb-1">Week 8 Evaluation</span>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">Appraisal Rating (0-100)</label>
                      <input 
                        type="number" 
                        min={0} max={100}
                        placeholder="Rating e.g. 85"
                        className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                        value={w8Appraisal}
                        onChange={(e) => setW8Appraisal(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">Theory Exam (0-100)</label>
                      <input 
                        type="number" 
                        min={0} max={100}
                        placeholder="Exam e.g. 81"
                        className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                        value={w8Theory}
                        onChange={(e) => setW8Theory(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* WEEK 12 RECORD */}
                <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/60 space-y-3">
                  <span className="text-xs font-black uppercase tracking-widest text-[#bf2352] block border-b pb-1">Week 12 Final Evaluation</span>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">Appraisal Rating (0-100)</label>
                      <input 
                        type="number" 
                        min={0} max={100}
                        placeholder="Rating e.g. 90"
                        className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                        value={w12Appraisal}
                        onChange={(e) => setW12Appraisal(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">Theory Exam (0-100)</label>
                      <input 
                        type="number" 
                        min={0} max={100}
                        placeholder="Exam e.g. 88"
                        className="w-full px-4 py-2 bg-white border border-slate-100 rounded-xl text-xs font-bold text-slate-800"
                        value={w12Theory}
                        onChange={(e) => setW12Theory(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 rounded-b-[24px]">
              <button 
                onClick={() => { setIsEvaluationModalOpen(false); setSelectedTrainee(null); }} 
                className="px-5 py-2 border border-slate-200 bg-white text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 uppercase tracking-wider"
              >
                Close Without Saving
              </button>
              <button 
                onClick={handleSaveEvaluations}
                className="px-6 py-2 bg-slate-900 text-white text-xs font-black rounded-xl uppercase tracking-wider flex items-center gap-1.5"
              >
                <ClipboardCheck size={14} /> Lock Appraisal grades
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
