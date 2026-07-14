import React, { useState, useEffect } from 'react';
import { 
  Star, 
  MessageSquare, 
  ThumbsUp, 
  CheckCircle, 
  Sliders, 
  Plus, 
  Filter, 
  TrendingUp,
  Award
} from 'lucide-react';
import { firestoreService } from '../../services/firestore';
import { CustomerFeedback, Prescriber } from '../../types';
import { toast } from 'sonner';

interface ReputationPillarProps {
  tenantId: string;
  role: string;
}

export const ReputationPillar: React.FC<ReputationPillarProps> = ({ tenantId, role }) => {
  const [feedback, setFeedback] = useState<CustomerFeedback[]>([]);
  const [prescribers, setPrescribers] = useState<Prescriber[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'reviews' | 'kols'>('reviews');

  // Custom weights state for Sentiment Score
  const [internalWeight, setInternalWeight] = useState<number>(60); // 60% internal verbal checkouts, 40% external platform reviews
  
  // New review form
  const [patName, setPatName] = useState('');
  const [rating, setRating] = useState(5);
  const [commentText, setCommentText] = useState('');
  const [source, setSource] = useState<'Internal POS' | 'External Google' | 'External Facebook' | 'External Other'>('Internal POS');
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    if (tenantId) {
      firestoreService.subscribeToCollection<CustomerFeedback>('feedback', tenantId, setFeedback);
      firestoreService.subscribeToCollection<Prescriber>('prescribers', tenantId, setPrescribers);
    }
  }, [tenantId]);

  const kols = prescribers.filter(p => p.isKOL);

  const handlePostReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patName) return;

    try {
      await firestoreService.addDocument('feedback', {
        tenantId,
        patientName: patName,
        patient_name: patName,
        rating: Number(rating),
        comments: commentText,
        comment: commentText,
        feedbackSource: source,
        reviewResponse: replyText || null,
        date: new Date().toISOString().split('T')[0]
      });

      toast.success('Reputation feedback logged successfully');
      setPatName('');
      setCommentText('');
      setReplyText('');
    } catch {
      toast.error('Failed to log review.');
    }
  };

  const handleReplyReview = async (item: CustomerFeedback, text: string) => {
    try {
      await firestoreService.updateDocument('feedback', item.id, {
        reviewResponse: text
      });
      toast.success('External review reply logged and updated');
    } catch {
      toast.error('Reply update failed.');
    }
  };

  // Math for Sentiment & Reputation indexes
  const internalReviews = feedback.filter(f => f.feedbackSource === 'Internal POS' || !f.feedbackSource);
  const externalReviews = feedback.filter(f => f.feedbackSource && f.feedbackSource !== 'Internal POS');

  const avgInternal = internalReviews.length > 0
    ? internalReviews.reduce((acc, curr) => acc + curr.rating, 0) / internalReviews.length
    : 4.5; // fallback default

  const avgExternal = externalReviews.length > 0
    ? externalReviews.reduce((acc, curr) => acc + curr.rating, 0) / externalReviews.length
    : 4.2;

  // Composite Sentiment Score computed
  const extWeight = 100 - internalWeight;
  const compositeStars = parseFloat(((avgInternal * (internalWeight / 100)) + (avgExternal * (extWeight / 100))).toFixed(2));
  const compositePercentage = Math.round((compositeStars / 5) * 100);

  return (
    <div className="space-y-6">
      {/* COMPOSITE REPUTATION & SENTIMENT DASHBOARD */}
      <div className="bg-white rounded-[32px] border border-zinc-200 p-8 shadow-sm grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="space-y-4">
          <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight flex items-center gap-1.5">
            <TrendingUp size={20} /> Composite Brand Sentiment Score
          </h3>
          <p className="text-zinc-500 text-xs">Weighted index from checkout satisfaction and external platform star reviews.</p>
          
          <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 flex items-center gap-4">
            <div className="h-16 w-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center font-black text-2xl font-mono">
              {compositePercentage}%
            </div>
            <div>
              <p className="font-extrabold text-zinc-950 text-sm">Averaging {compositeStars} / 5.0 Stars</p>
              <p className="text-zinc-400 text-[10px] uppercase font-bold tracking-wider">Reputation Level: Strong</p>
            </div>
          </div>
        </div>

        {/* Custom Weight slider adjuster */}
        <div className="bg-zinc-50/50 border border-zinc-150 p-6 rounded-3xl space-y-3">
          <h4 className="font-bold text-zinc-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
            <Sliders size={14} /> Adjust Formula weights
          </h4>
          <p className="text-[11px] text-zinc-500">Configure focus bias between internal checkouts and external public reviews.</p>
          
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] font-bold">
              <span>Internal POS CSAT: {internalWeight}%</span>
              <span>External Platforms: {extWeight}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={90}
              value={internalWeight}
              onChange={e => setInternalWeight(Number(e.target.value))}
              className="w-full focus:ring-0"
            />
          </div>
        </div>

        {/* Sub index breakdown */}
        <div className="space-y-2 font-semibold text-xs text-zinc-700">
          <h4 className="font-bold text-[10px] text-zinc-400 uppercase tracking-widest">Sub-Index breakdown</h4>
          <div className="flex justify-between py-1 border-b border-zinc-100">
            <span>Checkout Checklist (CSAT):</span>
            <span className="font-bold font-mono text-emerald-700">{avgInternal.toFixed(1)} / 5.0 ({internalReviews.length} logs)</span>
          </div>
          <div className="flex justify-between py-1 border-b border-zinc-100">
            <span>External Platforms (Google/FB):</span>
            <span className="font-bold font-mono text-indigo-600">{avgExternal.toFixed(1)} / 5.0 ({externalReviews.length} logs)</span>
          </div>
          <div className="flex justify-between py-1">
            <span>Enlisted KOL Influencers:</span>
            <span className="font-bold text-zinc-950">{kols.length} profiles</span>
          </div>
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex border-b border-zinc-200">
        <button
          onClick={() => setActiveSubTab('reviews')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
            activeSubTab === 'reviews' ? 'border-zinc-900 text-zinc-950 bg-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <MessageSquare size={16} /> Satisfaction Feedback & Platform Reviews (Manual logs)
        </button>
        <button
          onClick={() => setActiveSubTab('kols')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
            activeSubTab === 'kols' ? 'border-zinc-900 text-zinc-950 bg-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Award size={16} /> Key Opinion Leaders (KOLs) Database
        </button>
      </div>

      {activeSubTab === 'reviews' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List of Reviews */}
          <div className="lg:col-span-2 bg-white rounded-3xl border border-zinc-200 shadow-sm p-6 space-y-4">
            <div>
              <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight">Reputation reviews log</h3>
              <p className="text-zinc-500 text-xs">Verify patient reviews and record customer support replies.</p>
            </div>

            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
              {feedback.map((f, i) => (
                <div key={f.id || i} className="p-4 bg-zinc-50 rounded-2xl border border-zinc-150 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-zinc-950">{f.patientName || f.patient_name || 'Anonymous Patient'}</span>
                      <span className="text-zinc-400 text-[10px] ml-2 font-mono">{f.date}</span>
                    </div>
                    <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">
                      {f.feedbackSource || 'Internal POS'}
                    </span>
                  </div>

                  <div className="flex items-center gap-0.5">
                    {[...Array(5)].map((_, idx) => (
                      <Star key={idx} size={11} className={idx < f.rating ? 'fill-amber-400 text-amber-400' : 'text-zinc-200'} />
                    ))}
                  </div>

                  <p className="text-zinc-700 font-medium">{f.comments || f.comment || 'CSAT Checklist passed with no additional comments.'}</p>

                  {/* Reply block */}
                  {f.reviewResponse ? (
                    <div className="p-2 bg-white border border-zinc-150 rounded-xl mt-2 text-zinc-500 font-medium">
                      <p className="font-bold text-zinc-900 text-[9px] uppercase tracking-wider text-emerald-700">Official Brand Response:</p>
                      <p>{f.reviewResponse}</p>
                    </div>
                  ) : (
                    <div className="pt-2 animate-in fade-in">
                      <input
                        type="text"
                        placeholder="Log response to this review..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleReplyReview(f, e.currentTarget.value);
                            e.currentTarget.value = '';
                          }
                        }}
                        className="w-full px-3 py-1 bg-white border border-zinc-200 rounded-lg text-[11px]"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Form to manual log */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-3xl p-6 h-fit space-y-4">
            <div>
              <h4 className="font-bold text-zinc-900 text-sm uppercase tracking-tight flex items-center gap-2">
                <Plus size={16} /> Log Review or Satisfaction
              </h4>
              <p className="text-zinc-500 text-xs mt-1">Manual intake of verbal comments from point of dispensing or online social feeds.</p>
            </div>

            <form onSubmit={handlePostReview} className="space-y-4 font-semibold text-xs text-zinc-700">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Patient / Reviewer Name</label>
                <input required type="text" value={patName} onChange={e => setPatName(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs" placeholder="Kato Syrus" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Rating Score</label>
                <select value={rating} onChange={e => setRating(Number(e.target.value))} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl">
                  <option value={5}>5 Stars (Excellent)</option>
                  <option value={4}>4 Stars (Good)</option>
                  <option value={3}>3 Stars (Neutral)</option>
                  <option value={2}>2 Stars (Poor)</option>
                  <option value={1}>1 Star (Critical)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Feedback Origin Source</label>
                <select value={source} onChange={e => setSource(e.target.value as any)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl">
                  <option value="Internal POS">Internal POS Checklist</option>
                  <option value="External Google">Google review feed</option>
                  <option value="External Facebook">Facebook page</option>
                  <option value="External Other">Other social media</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Review comments</label>
                <textarea rows={3} value={commentText} onChange={e => setCommentText(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl resize-none text-xs" placeholder="Excellent clinical counseling, pharmacists spent generous time explaining dosage directions." />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Optional Immediate Reply</label>
                <input type="text" value={replyText} onChange={e => setReplyText(e.target.value)} className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs" placeholder="Thank you Kato! We appreciate your feedback." />
              </div>

              <button type="submit" className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all">
                Register Review entry
              </button>
            </form>
          </div>
        </div>
      )}

      {activeSubTab === 'kols' && (
        <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm p-6 space-y-4">
          <div>
            <h3 className="font-black text-zinc-900 text-lg uppercase tracking-tight">REP_KOL: Key Opinion Leader Directory</h3>
            <p className="text-zinc-500 text-xs">Profiles of active medical influencers and institutional partners tagged through prescriber logs.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-600">
              <thead>
                <tr className="bg-zinc-50 text-zinc-500 font-bold uppercase border-b border-zinc-200">
                  <th className="px-4 py-3">Prescriber (KOL) Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Enrolled Facility</th>
                  <th className="px-4 py-3">Referrals Volume</th>
                  <th className="px-4 py-3">Est. Reputation yield</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {kols.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center p-8 text-zinc-400">
                      No prescribers are currently tagged as KOLs. Go to Prescribers tab to assign reputation tags!
                    </td>
                  </tr>
                ) : (
                  kols.map(k => {
                    const count = k.monthlyPrescriptions || 0;
                    return (
                      <tr key={k.id} className="hover:bg-zinc-50/50 transition-colors font-medium">
                        <td className="px-4 py-3 font-bold text-zinc-950">Dr. {k.name}</td>
                        <td className="px-4 py-3">
                          <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">
                            {k.keyOpinionLeaderCategory || 'Expert'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold">{k.facility}</td>
                        <td className="px-4 py-3 font-bold font-mono text-zinc-800">{count} referrals</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                            count >= 40 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-700'
                          }`}>
                            {count >= 40 ? 'High Influence' : 'Steady partner'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
