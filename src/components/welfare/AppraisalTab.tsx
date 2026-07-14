import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  FileText,
  Calendar,
  History,
  Target,
  Award
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { AppraisalScore } from '../../types';
import { format } from 'date-fns';

const AppraisalTab: React.FC = () => {
  const { profile } = useAuth();
  const [scores, setScores] = useState<AppraisalScore[]>([]);

  useEffect(() => {
    if (profile?.uid && profile?.tenantId) {
      const unsubscribe = firestoreService.subscribeToCollection<AppraisalScore>(
        'appraisal_scores',
        profile.tenantId,
        (data) => {
          const userScores = data.filter(s => s.staffId === profile.uid);
          setScores(userScores.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        }
      );
      return () => unsubscribe();
    }
  }, [profile?.uid, profile?.tenantId]);

  const latestScore = scores[0];

  return (
    <div className="space-y-6">
      {/* Latest Appraisal Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <BarChart3 size={120} />
          </div>
          
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-2xl font-black text-zinc-900 uppercase tracking-tight">Performance Appraisal</h3>
                <p className="text-zinc-500 text-sm font-medium">Latest Assessment: {latestScore?.period || 'N/A'}</p>
              </div>
              {latestScore && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 size={18} />
                  <span className="text-xs font-black uppercase tracking-widest">Completed</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Theory Test Score</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-zinc-900">{latestScore?.theoryTestScore || 0}</span>
                  <span className="text-lg font-bold text-zinc-400">%</span>
                </div>
                <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-blue-500 h-full transition-all duration-1000" 
                    style={{ width: `${latestScore?.theoryTestScore || 0}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Practical Score</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-zinc-900">{latestScore?.practicalScore || 0}</span>
                  <span className="text-lg font-bold text-zinc-400">%</span>
                </div>
                <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-emerald-500 h-full transition-all duration-1000" 
                    style={{ width: `${latestScore?.practicalScore || 0}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Overall Rating</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-zinc-900">{latestScore?.overallRating || 0}</span>
                  <span className="text-lg font-bold text-zinc-400">/ 5.0</span>
                </div>
                <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-zinc-900 h-full transition-all duration-1000" 
                    style={{ width: `${((latestScore?.overallRating || 0) / 5) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 p-8 rounded-[32px] shadow-xl shadow-zinc-900/20 text-white flex flex-col justify-between">
          <div className="space-y-4">
            <div className="p-4 bg-white/10 rounded-2xl w-fit">
              <Target size={32} />
            </div>
            <div>
              <h4 className="text-xl font-black uppercase tracking-tight">Performance Goals</h4>
              <p className="text-zinc-400 text-xs font-medium leading-relaxed">
                Your appraisal scores are based on theory tests, practical evaluations, and overall performance.
              </p>
            </div>
          </div>
          <button className="w-full py-4 bg-white text-zinc-900 rounded-2xl font-black uppercase text-xs tracking-[0.2em] hover:bg-zinc-100 transition-all flex items-center justify-center gap-2 mt-8">
            <FileText size={18} />
            View Full Report
          </button>
        </div>
      </div>

      {/* Appraisal History */}
      <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History className="text-zinc-400" size={20} />
            <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">Appraisal History</h3>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Period</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Theory</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Practical</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Rating</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {scores.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 font-medium">
                    No appraisal records found.
                  </td>
                </tr>
              ) : (
                scores.map((score) => (
                  <tr key={score.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-bold text-zinc-900 uppercase text-xs">{score.period}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-black text-zinc-900">{score.theoryTestScore}%</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-black text-zinc-900">{score.practicalScore}%</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <Award size={14} className="text-amber-500" />
                        <span className="font-black text-zinc-900">{score.overallRating.toFixed(1)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-zinc-400" />
                        <span className="text-[10px] font-bold text-zinc-700 uppercase tracking-tight">
                          {format(new Date(score.date), 'MMM dd, yyyy')}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AppraisalTab;
