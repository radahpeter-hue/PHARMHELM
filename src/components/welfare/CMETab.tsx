import React, { useState, useEffect } from 'react';
import { 
  Award, 
  BookOpen, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Download,
  Calendar,
  History,
  TrendingUp,
  FileText
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { CMERecord } from '../../types';
import { format } from 'date-fns';

const CMETab: React.FC = () => {
  const { profile } = useAuth();
  const [records, setRecords] = useState<CMERecord[]>([]);
  const target = (profile as any)?.cme_target_ytd || 50;
  const earned = records.reduce((sum, r) => sum + r.creditsEarned, 0);
  const progress = Math.min(100, (earned / target) * 100);

  useEffect(() => {
    if (profile?.uid && profile?.tenantId) {
      const unsubscribe = firestoreService.subscribeToCollection<CMERecord>(
        'cme_records',
        profile.tenantId,
        (data) => {
          const userRecords = data.filter(r => r.staffId === profile.uid);
          setRecords(userRecords.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        }
      );
      return () => unsubscribe();
    }
  }, [profile?.uid, profile?.tenantId]);

  const getComplianceStatus = () => {
    if (progress >= 100) return { label: 'Compliant', color: 'text-emerald-600 bg-emerald-50', icon: CheckCircle2 };
    if (progress >= 70) return { label: 'Nearing Deadline', color: 'text-amber-600 bg-amber-50', icon: Clock };
    return { label: 'Non-Compliant', color: 'text-red-600 bg-red-50', icon: AlertCircle };
  };

  const status = getComplianceStatus();

  return (
    <div className="space-y-6">
      {/* CME Progress Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <TrendingUp size={120} />
          </div>
          
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-2xl font-black text-zinc-900 uppercase tracking-tight">CME Tracking YTD</h3>
                <p className="text-zinc-500 text-sm font-medium">Continuing Medical Education Credits</p>
              </div>
              <div className={`flex items-center gap-2 px-4 py-2 rounded-2xl ${status.color}`}>
                <status.icon size={18} />
                <span className="text-xs font-black uppercase tracking-widest">{status.label}</span>
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Total Credits Earned</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black text-zinc-900">{earned}</span>
                    <span className="text-xl font-bold text-zinc-400">/ {target} CPD</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Completion</p>
                  <span className="text-2xl font-black text-zinc-900">{Math.round(progress)}%</span>
                </div>
              </div>

              <div className="w-full bg-zinc-100 h-4 rounded-full overflow-hidden p-1">
                <div 
                  className={`h-full rounded-full transition-all duration-1000 ${
                    progress >= 100 ? 'bg-emerald-500' : progress >= 70 ? 'bg-amber-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 p-8 rounded-[32px] shadow-xl shadow-zinc-900/20 text-white flex flex-col justify-between">
          <div className="space-y-4">
            <div className="p-4 bg-white/10 rounded-2xl w-fit">
              <Award size={32} />
            </div>
            <div>
              <h4 className="text-xl font-black uppercase tracking-tight">CME Compliance</h4>
              <p className="text-zinc-400 text-xs font-medium leading-relaxed">
                Maintain your professional license by completing the required CME credits annually.
              </p>
            </div>
          </div>
          <button className="w-full py-4 bg-white text-zinc-900 rounded-2xl font-black uppercase text-xs tracking-[0.2em] hover:bg-zinc-100 transition-all flex items-center justify-center gap-2 mt-8">
            <BookOpen size={18} />
            Browse Courses
          </button>
        </div>
      </div>

      {/* Attendance History */}
      <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History className="text-zinc-400" size={20} />
            <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">Attendance History</h3>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Topic & Provider</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Date</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Credits</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] text-right">Certificate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-zinc-400 font-medium">
                    No CME records found.
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-bold text-zinc-900">{record.topic}</p>
                        <p className="text-[10px] text-zinc-400 uppercase font-black tracking-wider">{record.provider}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-zinc-400" />
                        <span className="text-[10px] font-bold text-zinc-700 uppercase tracking-tight">
                          {format(new Date(record.date), 'MMM dd, yyyy')}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <span className="font-black text-zinc-900">{record.creditsEarned}</span>
                        <span className="text-[10px] text-zinc-400 font-black uppercase tracking-widest">CPD</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {record.certificateUrl ? (
                        <button className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all" title="Download Certificate">
                          <Download size={18} />
                        </button>
                      ) : (
                        <div className="flex items-center justify-end gap-1 text-zinc-300">
                          <FileText size={14} />
                          <span className="text-[8px] font-black uppercase tracking-widest">Verified</span>
                        </div>
                      )}
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

export default CMETab;
