import React, { useState, useEffect } from 'react';
import { 
  GraduationCap, 
  Plus, 
  History, 
  Search, 
  Download,
  Users,
  Award,
  Calendar,
  Clock,
  BookOpen,
  CheckCircle2,
  XCircle,
  User,
  Star,
  Filter,
  FileDown,
  ChevronRight,
  Info,
  ArrowLeft,
  FileText,
  UploadCloud,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { CMESession, Staff, CMERecord } from '../../types';
import { toast } from 'sonner';
import { format, addMonths, startOfDay, endOfDay, isWithinInterval } from 'date-fns';

export const CME = () => {
  const { user, activeBranch, tenantId } = useAuth();
  const [sessions, setSessions] = useState<CMESession[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [settings, setSettings] = useState<any>(null);
  
  // Selection states
  const [selectedSession, setSelectedSession] = useState<CMESession | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [dateRange, setDateRange] = useState({
    start: format(addMonths(new Date(), -6), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });

  // Creation Form states
  const [topic, setTopic] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [venue, setVenue] = useState('');
  const [presenterType, setPresenterType] = useState<'Internal' | 'External'>('Internal');
  const [internalPresenterId, setInternalPresenterId] = useState('');
  const [externalPresenterName, setExternalPresenterName] = useState('');
  const [uploadedMaterials, setUploadedMaterials] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [manualMaterialName, setManualMaterialName] = useState('');

  // Attendance logging form states (for selected session)
  const [selectedAttendeeId, setSelectedAttendeeId] = useState('');
  const [punctualityTier, setPunctualityTier] = useState<'early' | 'mid' | 'late' | 'none'>('early');
  const [engagementBonus, setEngagementBonus] = useState(false);

  useEffect(() => {
    if (!tenantId || !activeBranch) return;

    const unsubscribeSessions = firestoreService.subscribeToCollection<CMESession>(
      'cme_sessions',
      tenantId,
      (entries) => {
        const branchEntries = entries.filter(e => e.branchId === activeBranch.id);
        const sorted = branchEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setSessions(sorted);
        
        // Sync selected session if open
        if (selectedSession) {
          const updated = sorted.find(s => s.id === selectedSession.id);
          if (updated) {
            setSelectedSession(updated);
          }
        }
      }
    );

    const unsubscribeStaff = firestoreService.subscribeToCollection<Staff>(
      'staff',
      tenantId,
      (entries) => {
        // Clinical staff usually has dispensing/clinical roles, fallback to all branch staff
        const branchStaff = entries.filter(s => s.branch_id === activeBranch.id);
        setStaff(branchStaff);
      }
    );

    const unsubscribeSettings = firestoreService.subscribeToCollection<any>(
      'system_settings',
      tenantId,
      (docs) => {
        if (docs.length > 0) {
          setSettings(docs[0]);
        }
      }
    );

    setLoading(false);

    return () => {
      unsubscribeSessions();
      unsubscribeStaff();
      unsubscribeSettings();
    };
  }, [tenantId, activeBranch, selectedSession?.id]);

  // Generate real CME ID: CME-YYYY-XXXX (padded sequentials)
  const generateCmeId = () => {
    const year = new Date(date).getFullYear();
    const prefix = `CME-${year}`;
    const sessionsThisYear = sessions.filter(s => s.cmeId?.startsWith(prefix));
    const nextNum = sessionsThisYear.length + 1;
    return `${prefix}-${String(nextNum).padStart(4, '0')}`;
  };

  // Base Attendance component calculations
  const calculatePoints = (tier: string, engBonus: boolean) => {
    const basePoints = 5.0;
    
    let punctBonus = 0.0;
    if (tier === 'early') punctBonus = 2.5;         // Within 10 mins
    else if (tier === 'mid') punctBonus = 2.0;     // Between 11 and 15 mins
    else if (tier === 'late') punctBonus = 1.0;    // Between 16 and 30 mins
    
    const engPoints = engBonus ? 2.5 : 0.0;
    
    // Total capped at 10.0 max
    const total = Math.min(10.0, basePoints + punctBonus + engPoints);
    return { basePoints, punctBonus, engPoints, total };
  };

  const handleAddSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !activeBranch || !user) return;

    let presenterName = '';
    let staffPresenter: Staff | undefined = undefined;

    if (presenterType === 'Internal') {
      staffPresenter = staff.find(s => s.id === internalPresenterId);
      if (!staffPresenter) {
        toast.error('Please select an internal staff presenter.');
        return;
      }
      presenterName = staffPresenter.full_name || staffPresenter.displayName || '';
    } else {
      presenterName = externalPresenterName;
      if (!presenterName.trim()) {
        toast.error('Please enter external presenter name.');
        return;
      }
    }

    try {
      const targetCmeId = generateCmeId();
      const sessionDocRef: Omit<CMESession, 'id'> = {
        tenantId,
        cmeId: targetCmeId,
        branchId: activeBranch.id,
        topic,
        presenter: presenterName,
        presenterType,
        date,
        durationMinutes: parseInt(durationMinutes),
        sessionType: presenterType, // alignment with appraisals.tsx
        attendees: [], // name arrays for backward compatibility
        attendancePoints: 5.0, // default base for legacy matching fallback
        presenterPoints: 10.0, // full points 
        notes,
        status: 'Completed',
        venue: venue || 'Main Conference Hall'
      };

      // Add actual document
      const newDocId = await firestoreService.addDocument('cme_sessions', sessionDocRef);
      
      // If presenter is a staff member, automatically add them to attendeeScores & cme_records
      if (presenterType === 'Internal' && staffPresenter) {
        const presenterRecord: CMERecord = {
          id: `${newDocId}_${staffPresenter.id}`,
          staffId: staffPresenter.id,
          topic: `Presenter - ${topic}`,
          date,
          creditsEarned: 10.0, // Full attendance points
          provider: presenterName,
          sessionId: newDocId
        } as any;

        // Save individual credit
        await firestoreService.updateDocument('cme_records', presenterRecord.id, presenterRecord);

        // Update session's attendeeScores
        const scoreItem = {
          staffId: staffPresenter.id,
          staffName: presenterName,
          role: staffPresenter.role || 'Staff Member',
          basePoints: 5.0,
          punctualityPoints: 2.5,
          engagementPoints: 2.5,
          totalPoints: 10.0,
          punctualityTier: 'early',
          engagement: true,
          isPresenter: true
        };

        await firestoreService.updateDocument('cme_sessions', newDocId, {
          attendees: [presenterName],
          attendeeScores: [scoreItem],
          uploadedMaterials: uploadedMaterials
        });
      } else {
        await firestoreService.updateDocument('cme_sessions', newDocId, {
          attendeeScores: [],
          uploadedMaterials: uploadedMaterials
        });
      }

      toast.success(`CME Session: ${targetCmeId} created successfully.`);
      setIsAdding(false);
      resetForm();
    } catch (error) {
      toast.error('Failed to log CME session');
    }
  };

  const handleAddAttendee = async () => {
    if (!selectedSession || !selectedAttendeeId) return;

    const chosenStaff = staff.find(s => s.id === selectedAttendeeId);
    if (!chosenStaff) {
      toast.error('Selected staff not found.');
      return;
    }

    const currentScores = selectedSession.attendeeScores || [];
    const chosenName = chosenStaff.full_name || chosenStaff.displayName || 'Staff Member';

    // Prevent duplicate logging
    if (currentScores.some(s => s.staffId === chosenStaff.id)) {
      toast.error(`${chosenName} is already logged as an attendee.`);
      return;
    }

    try {
      const pts = calculatePoints(punctualityTier, engagementBonus);
      const scoreItem = {
        staffId: chosenStaff.id,
        staffName: chosenName,
        role: chosenStaff.role || 'Clinical Staff',
        basePoints: pts.basePoints,
        punctualityPoints: pts.punctBonus,
        engagementPoints: pts.engPoints,
        totalPoints: pts.total,
        punctualityTier,
        engagement: engagementBonus,
        isPresenter: false
      };

      const updatedAttendeeScores = [...currentScores, scoreItem];
      const updatedAttendees = [...(selectedSession.attendees || []), chosenName];

      // Step 1: Update cme_sessions doc
      await firestoreService.updateDocument('cme_sessions', selectedSession.id, {
        attendees: updatedAttendees,
        attendeeScores: updatedAttendeeScores
      });

      // Step 2: Write/Sync to cme_records for welfare portal tracking
      const cmeRec: CMERecord = {
        id: `${selectedSession.id}_${chosenStaff.id}`,
        staffId: chosenStaff.id,
        topic,
        date: selectedSession.date,
        creditsEarned: pts.total,
        provider: selectedSession.presenter || 'CME Session',
        sessionId: selectedSession.id
      } as any;

      await firestoreService.updateDocument('cme_records', cmeRec.id, cmeRec);

      toast.success(`Logged attendance for ${chosenName} (${pts.total} points).`);
      
      // Reset logging form
      setSelectedAttendeeId('');
      setPunctualityTier('early');
      setEngagementBonus(false);
    } catch (error) {
      toast.error('Failed to log attendee attendance.');
    }
  };

  const handleRemoveAttendee = async (staffId: string, staffName: string) => {
    if (!selectedSession) return;
    
    // Prevent removing internal presenter if they are presenter
    const currentScores = selectedSession.attendeeScores || [];
    const targetItem = currentScores.find(s => s.staffId === staffId);
    if (targetItem?.isPresenter && selectedSession.presenterType === 'Internal') {
      toast.error('Cannot remove the internal presenter from the sessions list.');
      return;
    }

    try {
      const updatedScores = currentScores.filter(s => s.staffId !== staffId);
      const updatedAttendees = (selectedSession.attendees || []).filter(name => name !== staffName);

      // Step 1: Update session document
      await firestoreService.updateDocument('cme_sessions', selectedSession.id, {
        attendees: updatedAttendees,
        attendeeScores: updatedScores
      });

      // Step 2: Delete mapped cme_record
      const recordDocId = `${selectedSession.id}_${staffId}`;
      await firestoreService.deleteDocument('cme_records', recordDocId);

      toast.success(`Removed ${staffName} from logs.`);
    } catch (error) {
      toast.error('Failed to delete attendee logs.');
    }
  };

  const resetForm = () => {
    setTopic('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setDurationMinutes('60');
    setVenue('');
    setPresenterType('Internal');
    setInternalPresenterId('');
    setExternalPresenterName('');
    setNotes('');
    setUploadedMaterials([]);
    setManualMaterialName('');
  };

  const handleAddMaterial = () => {
    if (!manualMaterialName.trim()) return;
    setUploadedMaterials([...uploadedMaterials, manualMaterialName.trim()]);
    setManualMaterialName('');
    toast.success('Material file reference added.');
  };

  const filteredSessions = sessions.filter(s => {
    const matchesSearch = s.topic.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         s.presenter.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (s.cmeId && s.cmeId.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesDate = isWithinInterval(new Date(s.date), {
      start: startOfDay(new Date(dateRange.start)),
      end: endOfDay(new Date(dateRange.end))
    });
    return matchesSearch && matchesDate;
  });

  // Calculate stats of selected session
  const getSelectedSessionStats = () => {
    if (!selectedSession) return { count: 0, average: 0, attendanceRate: 0 };
    const attendeesList = selectedSession.attendeeScores || [];
    const count = attendeesList.length;
    const totalPointsSum = attendeesList.reduce((sum, item) => sum + (item.totalPoints || 0), 0);
    const average = count > 0 ? (totalPointsSum / count) : 0;
    
    // total clinical staff at this branch config
    const totalStaffCount = staff.length || 1;
    const attendanceRate = Math.round((count / totalStaffCount) * 100);

    return {
      count,
      average: parseFloat(average.toFixed(2)),
      attendanceRate: Math.min(100, attendanceRate)
    };
  };

  const activeStats = getSelectedSessionStats();

  // Export to CSV
  const handleExportCSV = (session: CMESession) => {
    const scores = session.attendeeScores || [];
    if (scores.length === 0) {
      toast.error('No logged attendees to export.');
      return;
    }

    const headers = ['Staff Name', 'Designation', 'Punctuality Tier', 'Engagement Bonus', 'Presenter Mode', 'Total Points Earned'];
    const rows = scores.map(item => [
      item.staffName,
      item.role,
      item.punctualityTier,
      item.engagement ? 'YES (+2.5 pt)' : 'NO (+0 pt)',
      item.isPresenter ? 'Presenter (10.0 pt)' : 'Attendee',
      item.totalPoints
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `CME_Roster_${session.cmeId || session.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Attendee roster exported as CSV.');
  };

  const configTargets = settings?.operationalConfig?.qa?.cmeTargets || {
    annualPoints: 24,
    bonusThreshold: 30,
    deductionThreshold: 18,
    bonusAmount: 50000,
    deductionAmount: 20000
  };

  return (
    <div className="space-y-6">
      {/* Upper Info Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-zinc-900 text-white p-6 rounded-[24px] border border-zinc-800 shadow-sm relative overflow-hidden flex flex-col justify-between h-[150px]">
          <div>
            <span className="text-[10px] font-black tracking-wider uppercase text-zinc-400">Governance Portal</span>
            <h4 className="text-xl font-black mt-1 uppercase tracking-tight">CME Clinical Standards</h4>
          </div>
          <p className="text-[11px] text-zinc-300">Annual Point Target is set to <strong className="text-emerald-400">{configTargets.annualPoints} CPD</strong> points. Track clinical governance dynamically.</p>
        </div>

        <div className="bg-white p-6 rounded-[24px] border border-zinc-200 shadow-sm flex flex-col justify-between h-[150px]">
          <div>
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Active Session Record counts</span>
            <span className="text-3xl font-black text-zinc-900 mt-2 block">{sessions.length} sessions held</span>
          </div>
          <p className="text-[10px] text-zinc-500 uppercase font-black tracking-wider">Across branch registry history</p>
        </div>

        <div className="bg-white p-6 rounded-[24px] border border-zinc-200 shadow-sm flex flex-col justify-between h-[150px]">
          <div>
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Clinical Staff registered</span>
            <span className="text-3xl font-black text-[#5113ae] mt-2 block">{staff.length} staff members</span>
          </div>
          <p className="text-[10px] text-zinc-400 font-bold uppercase">Ready for Point award logs</p>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row gap-2 flex-1 w-full max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search by topic, provider, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none font-bold uppercase text-zinc-800 tracking-wider placeholder:text-zinc-400"
            />
          </div>
          <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-zinc-600 shrink-0">
            <Calendar className="w-4 h-4 text-zinc-400 shrink-0" />
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="text-xs outline-none border-none bg-transparent"
            />
            <span className="text-zinc-400">to</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="text-xs outline-none border-none bg-transparent"
            />
          </div>
        </div>

        <button
          onClick={() => {
            resetForm();
            setIsAdding(true);
            setSelectedSession(null);
          }}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Create CME Session</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Log history list */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="font-black text-zinc-900 uppercase tracking-tight flex items-center gap-2 text-sm">
                <History className="w-4 h-4 text-zinc-400" />
                CME Sessions Ledger
              </h3>
              <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Showing {filteredSessions.length} active sessions</span>
            </div>

            <div className="divide-y divide-zinc-100">
              {filteredSessions.map((session) => (
                <div 
                  key={session.id} 
                  onClick={() => setSelectedSession(session)}
                  className={`p-6 hover:bg-zinc-50/50 transition-all cursor-pointer relative ${
                    selectedSession?.id === session.id ? 'bg-zinc-50 border-l-4 border-emerald-500 pl-5' : ''
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex gap-4">
                      <div className="p-3 bg-zinc-100 rounded-2xl text-zinc-600 shrink-0 h-11 w-11 flex items-center justify-center">
                        <BookOpen className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 bg-zinc-150 p-1 border border-zinc-200 rounded">
                            {session.cmeId || 'CME-LOG'}
                          </span>
                          <span className="text-xs text-zinc-500 font-bold">
                            {format(new Date(session.date), 'MMM d, yyyy')}
                          </span>
                        </div>
                        <h4 className="font-extrabold text-zinc-900 mt-1">{session.topic}</h4>
                        
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px] text-zinc-500 font-bold uppercase tracking-wide">
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-zinc-400" />
                            By: {session.presenter} ({session.presenterType || 'Internal'})
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-zinc-400" />
                            {session.durationMinutes} mins
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end md:text-right gap-6 pt-3 md:pt-0 border-t md:border-t-0 border-zinc-100">
                      <div>
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Attendees roster</p>
                        <p className="text-xs font-bold text-zinc-800 mt-0.5">{session.attendeeScores?.length || 0} clinicians logged</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-zinc-400 shrink-0 hidden md:block" />
                    </div>
                  </div>
                </div>
              ))}
              {filteredSessions.length === 0 && (
                <div className="p-16 text-center text-zinc-500">
                  <GraduationCap className="w-16 h-16 text-zinc-200 mx-auto mb-4" />
                  <p className="text-sm font-bold uppercase tracking-widest text-zinc-400">No CME sessions recorded.</p>
                  <p className="text-xs text-zinc-400 mt-1">Change selected date range filters or create a new session above.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Manage Details of Selected Session OR Scoring Rule Card */}
        <div className="space-y-4">
          <AnimatePresence mode="wait">
            {selectedSession ? (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
                className="bg-white rounded-[32px] border border-zinc-200 shadow-lg overflow-hidden p-6 space-y-6"
              >
                <div className="flex items-center justify-between border-b border-zinc-150 pb-4">
                  <div>
                    <span className="text-[9px] font-black uppercase text-zinc-400">{selectedSession.cmeId || 'CME-LOG'}</span>
                    <h3 className="font-black text-zinc-900 uppercase tracking-tight leading-none mt-0.5">Session Details</h3>
                  </div>
                  <button 
                    onClick={() => setSelectedSession(null)}
                    className="p-1 px-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-500 hover:text-zinc-800 text-xs font-bold rounded-lg uppercase tracking-wider"
                  >
                    Hide
                  </button>
                </div>

                {/* Session Params and Summary Stats */}
                <div className="space-y-3 bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Selected Topic</p>
                    <p className="text-sm font-extrabold text-zinc-900 leading-normal">{selectedSession.topic}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                    <div>
                      <span className="text-zinc-400 uppercase font-black text-[9px]">Venue / Room</span>
                      <p className="font-extrabold text-zinc-800">{selectedSession.venue || 'Boardroom Room'}</p>
                    </div>
                    <div>
                      <span className="text-zinc-400 uppercase font-black text-[9px]">Presenter Role</span>
                      <p className="font-extrabold text-zinc-800">{selectedSession.presenterType} Speaker</p>
                    </div>
                  </div>

                  {selectedSession.notes && (
                    <div className="pt-2">
                      <span className="text-zinc-400 uppercase font-black text-[9px]">CME Session Notes</span>
                      <p className="text-[11px] text-zinc-600 font-medium italic mt-0.5 leading-relaxed bg-white p-2 rounded-lg border border-zinc-150">
                        "{selectedSession.notes}"
                      </p>
                    </div>
                  )}

                  {selectedSession.uploadedMaterials && selectedSession.uploadedMaterials.length > 0 && (
                    <div className="pt-2">
                      <span className="text-zinc-400 uppercase font-black text-[9px]">Governance Shared Materials</span>
                      <div className="space-y-1 mt-1">
                        {selectedSession.uploadedMaterials.map((mat, idx) => (
                          <div key={idx} className="flex items-center gap-1.5 p-1 bg-white border border-zinc-150 rounded text-[10px] font-bold text-zinc-600 uppercase">
                            <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            <span className="truncate">{mat}</span>
                            <span className="text-[8px] px-1 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded ml-auto">Uploaded</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Roster Live Stats Block */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-emerald-50/50 border border-emerald-100 p-3 rounded-2xl text-center">
                    <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest block">Average Score</span>
                    <span className="text-base font-black text-emerald-700 block mt-1">{activeStats.average}</span>
                    <span className="text-[8px] text-emerald-600 font-bold">Max 10.0</span>
                  </div>
                  <div className="bg-blue-50/50 border border-blue-100 p-3 rounded-2xl text-center">
                    <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest block">Logged Attend.</span>
                    <span className="text-base font-black text-blue-700 block mt-1">{activeStats.count}</span>
                    <span className="text-[8px] text-zinc-400 font-bold uppercase">Staff</span>
                  </div>
                  <div className="bg-[#f3efff] border border-[#d6c7ff] p-3 rounded-2xl text-center">
                    <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest block">Branch Rate</span>
                    <span className="text-base font-black text-[#6d41ff] block mt-1">{activeStats.attendanceRate}%</span>
                    <span className="text-[8px] text-zinc-400 font-bold uppercase">Clinicians</span>
                  </div>
                </div>

                {/* ADD ATTENDEE LIVE FORM */}
                <div className="space-y-4 border-t border-zinc-150 pt-4 p-4 bg-zinc-50 rounded-2xl border border-zinc-200">
                  <h4 className="text-xs font-black uppercase text-zinc-750 flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-600" />
                    Log Attendee & Calculate Points
                  </h4>
                  
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-black text-zinc-400 uppercase block mb-1">Select Staff Attendee</label>
                      <select
                        value={selectedAttendeeId}
                        onChange={(e) => setSelectedAttendeeId(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-xs font-bold uppercase focus:outline-none"
                      >
                        <option value="">-- Choose clinician member --</option>
                        {staff
                          .filter(s => {
                            // Don't show staff already in attendeeScores
                            const loggedIds = (selectedSession.attendeeScores || []).map(score => score.staffId);
                            return !loggedIds.includes(s.id);
                          })
                          .map(s => (
                            <option key={s.id} value={s.id}>
                              {s.full_name || s.displayName} ({s.role || 'Unspecified'})
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-black text-zinc-400 uppercase block mb-1">Punctuality Tier</label>
                        <select
                          value={punctualityTier}
                          onChange={(e) => setPunctualityTier(e.target.value as any)}
                          className="w-full px-2 py-1.5 bg-white border border-zinc-200 rounded-xl text-[10px] font-bold uppercase focus:outline-none"
                        >
                          <option value="early">Early &lt;10 mins (+2.5 pt)</option>
                          <option value="mid">Mid 11-15 mins (+2.0 pt)</option>
                          <option value="late">Late 16-30 mins (+1.0 pt)</option>
                          <option value="none">Late &gt;30 mins (+0.0 pt)</option>
                        </select>
                      </div>

                      <div className="flex flex-col justify-end">
                        <label className="flex items-center gap-1.5 px-3 py-2 bg-white border border-zinc-200 rounded-xl cursor-pointer select-none text-[10px] font-black uppercase hover:bg-zinc-50 h-9 shrink-0">
                          <input
                            type="checkbox"
                            checked={engagementBonus}
                            onChange={(e) => setEngagementBonus(e.target.checked)}
                            className="rounded text-emerald-600 focus:ring-emerald-500/20"
                          />
                          <span>Engagement (+2.5)</span>
                        </label>
                      </div>
                    </div>

                    {/* Points Live Calculations Display */}
                    <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 p-2.5 rounded-xl">
                      <div>
                        <p className="text-[9px] font-black text-emerald-800 uppercase tracking-wider">Line Calculations</p>
                        <p className="text-[10px] text-zinc-500 font-bold mt-0.5">Base 5.0 + Punct ({punctualityTier === 'early' ? '+2.5' : punctualityTier === 'mid' ? '+2.0' : punctualityTier === 'late' ? '+1.0' : '+0.0'}) + Eng ({engagementBonus ? '+2.5' : '+0.0'})</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs text-zinc-400 font-bold uppercase uppercase tracking-wider block">Award Points</span>
                        <span className="text-sm font-black text-emerald-700 block">{calculatePoints(punctualityTier, engagementBonus).total} pts</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddAttendee}
                      disabled={!selectedAttendeeId}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed text-white rounded-xl font-black uppercase text-[10px] tracking-widest transition-all mt-1"
                    >
                      Award & Log Attendance
                    </button>
                  </div>
                </div>

                {/* ATTENDEE LIST LOG FOR THE DISCLOSED SELECTED SESSION */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-zinc-150 pb-2">
                    <h4 className="text-xs font-black uppercase text-zinc-900 tracking-tight">CME Attendee Scores Log</h4>
                    <button 
                      onClick={() => handleExportCSV(selectedSession)}
                      className="text-[9px] font-black hover:text-emerald-700 flex items-center gap-1 uppercase tracking-wider transition-all"
                    >
                      <Download className="w-3.5 h-3.5" /> CSV Roster
                    </button>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto no-scrollbar pr-1">
                    {(selectedSession.attendeeScores || []).map((attendee, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-zinc-50 hover:bg-zinc-100 border border-zinc-150 rounded-2xl transition-all">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-zinc-900 text-xs truncate block">{attendee.staffName}</span>
                            {attendee.isPresenter && (
                              <span className="text-[7px] font-black bg-[#faf5ff] text-purple-700 border border-purple-100 px-1 py-0.5 rounded uppercase tracking-widest shrink-0">Speaker</span>
                            )}
                          </div>
                          <p className="text-[9px] font-semibold text-zinc-400 uppercase tracking-widest block truncate mt-0.5">
                            {attendee.role} • Punctuality: {attendee.punctualityTier} • Eng: {attendee.engagement ? 'YES' : 'NO'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-2">
                          <span className="text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-lg shrink-0">
                            {attendee.totalPoints} pts
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttendee(attendee.staffId, attendee.staffName)}
                            className="text-zinc-300 hover:text-rose-600 transition-colors"
                            title="Delete Attendee Log"
                          >
                            <XCircle className="w-4.5 h-4.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {(selectedSession.attendeeScores || []).length === 0 && (
                      <p className="text-center py-8 text-zinc-400 italic text-[11px]">No attendees logged yet. Use the log form above to add clinician scores.</p>
                    )}
                  </div>
                </div>

              </motion.div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-[32px] p-6 space-y-4">
                <h4 className="text-sm font-black text-amber-900 flex items-center gap-2 uppercase tracking-wide">
                  <Award className="w-4 h-4" />
                  CME Structured Points Rules
                </h4>
                <div className="text-xs text-amber-800 space-y-3 leading-relaxed">
                  <p>In <strong>PharmHelm Pro ERP</strong>, CME scoring guidelines are clinical governance rules meant to encourage competence and engagement:</p>
                  
                  <ul className="space-y-2 pl-3 list-disc">
                    <li><strong>Base Attendance Score:</strong> Flat <strong>5.0 points</strong> awarded to standard sessions attendees who simply show up.</li>
                    
                    <li><strong>Punctuality Bonuses:</strong> Tiered based on when they arrive to foster accountability:
                      <ul className="pl-3 list-circle font-semibold text-[11px] text-amber-950 mt-1">
                        <li>Arrive within first 10 minutes: <strong>+2.5 points</strong></li>
                        <li>Arrive 11 to 15 minutes: <strong>+2.0 points</strong></li>
                        <li>Arrive 16 to 30 minutes: <strong>+1.0 points</strong></li>
                        <li>Arrive late (after 30 mins): <strong>+0 points</strong></li>
                      </ul>
                    </li>

                    <li><strong>Engagement Rewards:</strong> Discretionary <strong>+2.5 points</strong> awarded for asking relevant queries, answering questions, or displaying visible group-learning participation.</li>

                    <li><strong>Presenter Incentive:</strong> Staff presenters are automatically added directly with full attendance points of <strong>10.0 pts</strong> for delivering the session.</li>
                  </ul>
                  <p className="text-[10px] font-bold border-t border-amber-200/50 pt-2 block text-amber-950 uppercase">Every session score caps out at 10.0 points max.</p>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* SESSION CREATION DIALOG MODAL */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl overflow-hidden text-left"
            >
              <div className="p-6 border-b border-zinc-100 bg-zinc-50 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-black uppercase text-emerald-600 tracking-widest">Compliance & Governance</span>
                  <h3 className="text-lg font-black text-zinc-900 mt-0.5 uppercase tracking-tight flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-emerald-600" />
                    Launch CME Session
                  </h3>
                </div>
                <button onClick={() => setIsAdding(false)} className="text-zinc-400 hover:text-zinc-600">
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleAddSession} className="p-8 space-y-5 max-h-[75vh] overflow-y-auto no-scrollbar">
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">CME Theme Topic Title</label>
                    <input
                      type="text"
                      required
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-xs font-bold uppercase text-zinc-700 bg-zinc-50 border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                      placeholder="e.g. Dispensing Error Mitigations"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Venue / Platform Floor</label>
                    <input
                      type="text"
                      required
                      value={venue}
                      onChange={(e) => setVenue(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-xs font-bold uppercase text-zinc-700 bg-zinc-50 border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                      placeholder="e.g. Conference Room A or Zoom Cloud"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Session Date</label>
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-xs font-bold text-zinc-700 bg-zinc-50 border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Duration (Minutes)</label>
                    <input
                      type="number"
                      required
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-xs font-bold text-zinc-700 bg-zinc-50 border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Presenter Source</label>
                    <select
                      value={presenterType}
                      onChange={(e) => setPresenterType(e.target.value as any)}
                      className="w-full px-4 py-2.5 rounded-xl text-xs font-bold text-zinc-700 bg-zinc-50 border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <option value="Internal">Internal (Staff registry)</option>
                      <option value="External">External Speaker</option>
                    </select>
                  </div>
                </div>

                {/* Conditionally Select/Type Presenter */}
                <div className="space-y-1 p-4 bg-zinc-50 rounded-2xl border border-zinc-150">
                  {presenterType === 'Internal' ? (
                    <div>
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-1">Select Staff Presenter member</label>
                      <select
                        required
                        value={internalPresenterId}
                        onChange={(e) => setInternalPresenterId(e.target.value)}
                        className="w-full bg-white px-4 py-2 rounded-xl text-xs font-bold uppercase border border-zinc-200"
                      >
                        <option value="">-- Choose Presenting clinician --</option>
                        {staff.map(s => (
                          <option key={s.id} value={s.id}>{s.full_name || s.displayName} ({s.role || 'Senior Clinician'})</option>
                        ))}
                      </select>
                      <span className="text-[9px] text-indigo-700 bg-indigo-50 border border-indigo-100 p-1.5 rounded font-black mt-2 inline-block uppercase tracking-wider">
                        ★ Note: Staff presenters are automatically added directly to roster with full attendance points of 10.0 pts.
                      </span>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-1">Enter External Presenter Name</label>
                      <input
                        type="text"
                        required
                        value={externalPresenterName}
                        onChange={(e) => setExternalPresenterName(e.target.value)}
                        className="w-full bg-white px-4 py-2 rounded-xl text-xs font-extrabold uppercase text-zinc-700 border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        placeholder="e.g. Dr. Arthur Kabuye, Ministry of Health"
                      />
                    </div>
                  )}
                </div>

                {/* MATERIALS MOCK UPLOADER DRAG-AND-DROP SIMULATOR */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Class Materials Upload references (PDF, PPT, Word)</label>
                  
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualMaterialName}
                      onChange={(e) => setManualMaterialName(e.target.value)}
                      className="flex-1 px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-bold uppercase focus:outline-none"
                      placeholder="e.g. antibiotic_guidelines_2026.pdf"
                    />
                    <button
                      type="button"
                      onClick={handleAddMaterial}
                      className="px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-zinc-800 transition-colors"
                    >
                      Attach
                    </button>
                  </div>

                  {uploadedMaterials.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {uploadedMaterials.map((mat, idx) => (
                        <div key={idx} className="flex items-center gap-1 p-1 px-2.5 bg-zinc-150 border border-zinc-200 rounded-lg text-[9px] font-bold text-zinc-600 uppercase tracking-wider">
                          <span>{mat}</span>
                          <button
                            type="button"
                            onClick={() => setUploadedMaterials(uploadedMaterials.filter((_, i) => i !== idx))}
                            className="text-zinc-400 hover:text-rose-600 font-extrabold pl-1 text-[11px]"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="border border-dashed border-zinc-200 p-4 rounded-2xl flex flex-col items-center justify-center text-center mt-2 bg-zinc-50/50">
                    <UploadCloud className="w-8 h-8 text-zinc-400 mb-1 shrink-0" />
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Or Drag and drop curriculum files here</span>
                    <span className="text-[8px] text-zinc-400 font-bold uppercase mt-0.5">PDF, PowerPoint, Word, up to 10MB</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Optional Session Summary notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-4 py-3 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all h-20 resize-none font-medium placeholder:text-zinc-400"
                    placeholder="Key takeaways, consensus, feedback, policy implications..."
                  />
                </div>

                <div className="flex gap-3 pt-4 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="flex-1 px-4 py-2.5 border border-zinc-200 text-zinc-600 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-zinc-50 transition-colors"
                  >
                    Discard Draft
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm"
                  >
                    Confirm & Save Session
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
