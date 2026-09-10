from pathlib import Path
import re


def replace_exact(text: str, old: str, new: str, label: str, count: int = 1) -> str:
    found = text.count(old)
    if found != count:
        raise SystemExit(f"{label}: expected {count} occurrence(s), found {found}")
    return text.replace(old, new, count)


def replace_regex(text: str, pattern: str, replacement: str, label: str, flags=re.S) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, found {count}")
    return updated


# -----------------------------------------------------------------------------
# RBAC: department heads receive narrow supervisory entry to HR and Appraisals.
# Actual sub-function boundaries are enforced in page components and rules.
# -----------------------------------------------------------------------------
path = Path('src/config/rbac.ts')
text = path.read_text()
text = replace_exact(text, "export const RBAC_SYSTEM_VERSION = '2026-09-08-v1';", "export const RBAC_SYSTEM_VERSION = '2026-09-10-v2';", 'RBAC version')
text = replace_exact(text,
    "sales: view(), inventory: view(), clients: view(), stock: view(), procurement: view(), qa: all(), hr: view(),\n      predictive: operate(), analytics: view(), marketing: view(),",
    "sales: view(), inventory: view(), clients: view(), stock: view(), procurement: view(), qa: all(), hr: operate(),\n      predictive: operate(), analytics: view(), marketing: view(),",
    'QA Head HR supervisor access')
text = replace_exact(text,
    "sales: view(), inventory: view(), clients: view(), stock: view(), procurement: operate(), logistics: view(), finance: all(),\n      predictive: operate(), analytics: view(), marketing: view(),",
    "sales: view(), inventory: view(), clients: view(), stock: view(), procurement: operate(), logistics: view(), finance: all(),\n      qa: operate(), hr: operate(), predictive: operate(), analytics: view(), marketing: view(),",
    'Finance Head supervisor access')
text = replace_exact(text,
    "permissions: makePermissions({ inventory: operate(), clients: operate(), stock: operate(), procurement: all(), logistics: view(), predictive: operate(), analytics: view() }),",
    "permissions: makePermissions({ inventory: operate(), clients: operate(), stock: operate(), procurement: all(), logistics: view(), qa: operate(), hr: operate(), predictive: operate(), analytics: view() }),",
    'Procurement Head supervisor access')
text = replace_exact(text,
    "permissions: makePermissions({ clients: view(), procurement: view(), logistics: all(), analytics: view() }),",
    "permissions: makePermissions({ clients: view(), procurement: view(), logistics: all(), qa: operate(), hr: operate(), analytics: view() }),",
    'Logistics Head supervisor access')
text = replace_exact(text,
    "permissions: makePermissions({ clients: operate(), analytics: view(), marketing: all() }),",
    "permissions: makePermissions({ clients: operate(), qa: operate(), hr: operate(), analytics: view(), marketing: all() }),",
    'Marketing Head supervisor access')
text = replace_exact(text,
    "qa: view(), hr: view(), predictive: view(), analytics: view(), marketing: view(), settings: all(),",
    "qa: operate(), hr: operate(), predictive: view(), analytics: view(), marketing: view(), settings: all(),",
    'IT Head supervisor access')

marker = """export const isITRoleName = (roleName?: string | null): boolean => {
  if (!roleName) return false;
  const normalized = roleName.trim().toLowerCase();
  return ['it head', 'it support staff', 'it support personnel', 'it staff'].includes(normalized);
};
"""
addition = marker + """

export const PEOPLE_SUPERVISOR_SYSTEM_ROLES = [
  'Branch Manager',
  'Finance Head',
  'Procurement Head',
  'Logistics Head',
  'Transport & Logistics Head',
  'Marketing Head',
  'QA Head',
  'HR Head',
  'IT Head',
] as const;

export const isPeopleSupervisorRoleName = (roleName?: string | null): boolean => {
  if (!roleName) return false;
  const normalized = roleName.trim().toLowerCase();
  return PEOPLE_SUPERVISOR_SYSTEM_ROLES.some(role => role.toLowerCase() === normalized);
};
"""
text = replace_exact(text, marker, addition, 'Supervisor helper')
path.write_text(text)


# -----------------------------------------------------------------------------
# Types: explicit immutable actor attribution and supervisor assessment metadata.
# -----------------------------------------------------------------------------
path = Path('src/types.ts')
text = path.read_text()
text = replace_exact(text, "  displayName?: string;\n", "  displayName?: string;\n  fullName?: string;\n", 'Staff fullName')
text = replace_exact(text, "  branch_id: string;\n", "  branch_id: string;\n  branch_name?: string;\n  department?: string;\n", 'Staff department')
text = replace_exact(text, "  appraiserName?: string;\n", """  appraiserName?: string;
  appraisedByUserId?: string;
  appraisedByName?: string;
  appraisedByRole?: string;
  appraisedByBranchId?: string;
  appraisedByDepartment?: string;
  appraisedAt?: string;
  lastUpdatedByUserId?: string;
  lastUpdatedByName?: string;
  lastUpdatedByRole?: string;
  lastUpdatedAt?: string;
""", 'Appraisal attribution')
text = replace_regex(text,
    r"export interface DisciplinaryIncident \{.*?\n\}",
    """export interface DisciplinaryIncident {
  id: string;
  tenantId?: string;
  staffId: string;
  category?: string;
  date: string;
  incident_type?: string;
  description?: string;
  action_taken?: string;
  status?: 'open' | 'resolved' | 'appealed' | string;
  severity?: 'low' | 'medium' | 'high' | 'critical' | string;
  reportedByUserId?: string;
  reportedByName?: string;
  reportedByRole?: string;
  reportedAt?: string;
  reportedFromBranchId?: string;
  reportedFromDepartment?: string;
  followUpStatus?: string;
}""",
    'DisciplinaryIncident interface')
text = replace_exact(text,
    "  practical_score?: number | null;\n  practical_date?: string | null;\n",
    """  practical_score?: number | null;
  practical_date?: string | null;
  practical_assessed_by_user_id?: string;
  practical_assessed_by_name?: string;
  practical_assessed_by_role?: string;
  practical_assessed_at?: string;
  practical_assessed_branch_id?: string;
""",
    'Practical assessment attribution')
text = replace_exact(text,
    "  week4_assessment_date?: string | null;\n",
    """  week4_assessment_date?: string | null;
  week4_assessed_by_user_id?: string;
  week4_assessed_by_name?: string;
  week4_assessed_by_role?: string;
  week4_assessed_at?: string;
""",
    'Week4 attribution')
text = replace_exact(text,
    "  week8_assessment_date?: string | null;\n",
    """  week8_assessment_date?: string | null;
  week8_assessed_by_user_id?: string;
  week8_assessed_by_name?: string;
  week8_assessed_by_role?: string;
  week8_assessed_at?: string;
""",
    'Week8 attribution')
text = replace_exact(text,
    "  week12_assessment_date?: string | null;\n",
    """  week12_assessment_date?: string | null;
  week12_assessed_by_user_id?: string;
  week12_assessed_by_name?: string;
  week12_assessed_by_role?: string;
  week12_assessed_at?: string;
  training_assessment_last_by_user_id?: string;
  training_assessment_last_by_name?: string;
  training_assessment_last_by_role?: string;
  training_assessment_last_at?: string;
""",
    'Week12 attribution')
path.write_text(text)


# -----------------------------------------------------------------------------
# HR shell: supervisors see only Performance, Practical Recruitment and Trainees.
# IT Support remains diagnostic/report-only. HR retains full administration.
# -----------------------------------------------------------------------------
path = Path('src/pages/HRAdmin.tsx')
text = path.read_text()
text = replace_exact(text,
    "import { useTenant } from '../contexts/TenantContext';\n",
    "import { useTenant } from '../contexts/TenantContext';\nimport { isPeopleSupervisorRoleName, isSystemRoleName } from '../config/rbac';\n",
    'HRAdmin RBAC import')
old_logic = """  const hasAnyFixedRole = (roles: string[]) => roles.some(role => normalizedRoles.includes(role));
  const isExecutive = hasAnyFixedRole(['owner', 'ceo', 'ceo / md']);
  const isGeneralAdmin = hasAnyFixedRole(['admin']);
  const isHRHead = hasAnyFixedRole(['hr head']);
  const isHRSupport = hasAnyFixedRole(['hr support personnel']);
  const isIT = hasAnyFixedRole(['it head', 'it support staff', 'it support personnel', 'it staff']);
  const isBranchManager = hasAnyFixedRole(['branch manager']);
  const hasOtherHRAuthority = isExecutive || isGeneralAdmin || isHRHead || isHRSupport;
  const isRestrictedBranchManager = isBranchManager && !hasOtherHRAuthority;

  const canOperateHR = hasPermission('hr', 'operate');
  const canViewHR = hasPermission('hr', 'view');
  const customOrGeneralOperator = canOperateHR && !isRestrictedBranchManager && !isIT;
"""
new_logic = """  const hasAnyFixedRole = (roles: string[]) => roles.some(role => normalizedRoles.includes(role));
  const isExecutive = hasAnyFixedRole(['owner', 'ceo', 'ceo / md']);
  const isGeneralAdmin = hasAnyFixedRole(['admin']);
  const isHRHead = hasAnyFixedRole(['hr head']);
  const isHRSupport = hasAnyFixedRole(['hr support personnel']);
  const isITSupport = hasAnyFixedRole(['it support staff', 'it support personnel', 'it staff']);
  const isPeopleSupervisor = normalizedRoles.some(role => isPeopleSupervisorRoleName(role));

  const canOperateHR = hasPermission('hr', 'operate');
  const canViewHR = hasPermission('hr', 'view');
  const hasCustomRole = normalizedRoles.some(role => role && !isSystemRoleName(role));
  const hasFullHRAuthority = isExecutive || isGeneralAdmin || isHRHead || isHRSupport || (hasCustomRole && canOperateHR && !isPeopleSupervisor);
  const isSupervisorOnly = isPeopleSupervisor && !hasFullHRAuthority;
  const isDiagnosticITSupport = isITSupport && !hasFullHRAuthority;
"""
text = replace_exact(text, old_logic, new_logic, 'HRAdmin role logic')
old_allowed = """  const allowedTabs = useMemo<HRTab[]>(() => {
    const allowed = new Set<HRTab>();

    if (customOrGeneralOperator || isExecutive || isGeneralAdmin || isHRHead || isHRSupport) {
      ['staff', 'attendance', 'payroll', 'leave_advance', 'recruitment', 'trainees', 'performance', 'reports'].forEach(tab => allowed.add(tab as HRTab));
    }

    if (isRestrictedBranchManager) {
      // Branch Managers use HR only to raise and follow branch performance / disciplinary incidents.
      allowed.add('performance');
    }

    if (isIT) {
      // IT has diagnostic HR visibility, not routine HR administration.
      allowed.add('reports');
    }

    if (canViewHR && !canOperateHR && !isIT && !isRestrictedBranchManager) {
      // View-only custom roles are intentionally kept to the report console so they cannot
      // reach transactional HR editors that pre-date capability-level UI guards.
      allowed.add('reports');
    }

    if (isExecutive || isGeneralAdmin) {
      allowed.add('branches');
      allowed.add('settings');
    }

    return Array.from(allowed);
  }, [customOrGeneralOperator, isExecutive, isGeneralAdmin, isHRHead, isHRSupport, isRestrictedBranchManager, isIT, canViewHR, canOperateHR]);
"""
new_allowed = """  const allowedTabs = useMemo<HRTab[]>(() => {
    const allowed = new Set<HRTab>();

    if (hasFullHRAuthority) {
      ['staff', 'attendance', 'payroll', 'leave_advance', 'recruitment', 'trainees', 'performance', 'reports'].forEach(tab => allowed.add(tab as HRTab));
    }

    if (isSupervisorOnly) {
      // Supervisory HR access is deliberately limited to people-management inputs.
      allowed.add('performance');
      allowed.add('recruitment');
      allowed.add('trainees');
    }

    if (isDiagnosticITSupport) {
      allowed.add('reports');
    }

    if (canViewHR && !canOperateHR && !isDiagnosticITSupport && !isSupervisorOnly) {
      allowed.add('reports');
    }

    if (isExecutive || isGeneralAdmin) {
      allowed.add('branches');
      allowed.add('settings');
    }

    return Array.from(allowed);
  }, [hasFullHRAuthority, isSupervisorOnly, isDiagnosticITSupport, canViewHR, canOperateHR, isExecutive, isGeneralAdmin]);
"""
text = replace_exact(text, old_allowed, new_allowed, 'HRAdmin tab policy')
text = replace_exact(text, "{activeTab === 'recruitment' && show('recruitment') && <RecruitmentManager />}", "{activeTab === 'recruitment' && show('recruitment') && <RecruitmentManager supervisorOnly={isSupervisorOnly} />}", 'Recruitment prop')
text = replace_exact(text, "{activeTab === 'trainees' && show('trainees') && <TraineesManager />}", "{activeTab === 'trainees' && show('trainees') && <TraineesManager supervisorOnly={isSupervisorOnly} />}", 'Trainees prop')
text = replace_exact(text, "{activeTab === 'performance' && show('performance') && <PerformanceDiscipline />}", "{activeTab === 'performance' && show('performance') && <PerformanceDiscipline supervisorOnly={isSupervisorOnly} />}", 'Performance prop')
path.write_text(text)


# -----------------------------------------------------------------------------
# Performance incidents: supervisors can report, but HR owns follow-up/closure.
# -----------------------------------------------------------------------------
path = Path('src/modules/hr/PerformanceDiscipline.tsx')
text = path.read_text()
text = replace_exact(text, "import { cn } from '../../utils/cn';\n", "import { cn } from '../../utils/cn';\nimport { where } from 'firebase/firestore';\n", 'Performance where import')
text = replace_exact(text,
    "export const PerformanceDiscipline: React.FC = () => {\n  const { profile } = useAuth();",
    "export const PerformanceDiscipline: React.FC<{ supervisorOnly?: boolean }> = ({ supervisorOnly = false }) => {\n  const { profile, activeBranch } = useAuth();",
    'Performance component props')
old_effect = """  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Staff>('staff', profile.tenantId, setStaff);
      return firestoreService.subscribeToCollection<DisciplinaryIncident>(
        'disciplinary_incidents',
        profile.tenantId,
        setIncidents
      );
    }
  }, [profile?.tenantId]);

  const filteredIncidents = incidents.filter(inc => {
"""
new_effect = """  useEffect(() => {
    if (!profile?.tenantId) return;
    const unsubStaff = firestoreService.subscribeToCollection<Staff>('staff', profile.tenantId, setStaff);
    const unsubIncidents = supervisorOnly
      ? firestoreService.subscribeToCollectionByQuery<DisciplinaryIncident>(
          'disciplinary_incidents',
          profile.tenantId,
          [where('reportedByUserId', '==', profile.uid || profile.id)],
          setIncidents
        )
      : firestoreService.subscribeToCollection<DisciplinaryIncident>('disciplinary_incidents', profile.tenantId, setIncidents);
    return () => {
      unsubStaff();
      unsubIncidents();
    };
  }, [profile?.tenantId, profile?.uid, profile?.id, supervisorOnly]);

  const supervisorStaff = supervisorOnly ? staff.filter(member => {
    const selfIds = [profile?.id, profile?.uid].filter(Boolean);
    if (selfIds.includes(member.id) || selfIds.includes(member.uid)) return false;
    const allowedBranches = new Set([...(profile?.assigned_branches || []), profile?.branch_id, activeBranch?.id].filter(Boolean));
    const memberBranches = [member.branch_id, ...(member.assigned_branches || [])].filter(Boolean);
    if (!memberBranches.some(branchId => allowedBranches.has(branchId))) return false;
    if (profile?.role?.toString().toLowerCase() !== 'branch manager' && profile?.department && member.department && profile.department !== member.department) return false;
    return true;
  }) : staff;

  const filteredIncidents = incidents.filter(inc => {
"""
text = replace_exact(text, old_effect, new_effect, 'Performance subscriptions/scope')
text = replace_exact(text,
    "  const handleDelete = async (id: string) => {\n    if (window.confirm('Are you sure you want to delete this incident record?')) {",
    "  const handleDelete = async (id: string) => {\n    if (supervisorOnly) return;\n    if (window.confirm('Are you sure you want to delete this incident record?')) {",
    'Performance delete guard')
old_actions = """                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => {
                            setEditingIncident(inc);
                            setIsModalOpen(true);
                          }}
                          className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(inc.id)}
                          className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>"""
new_actions = """                      <div className="flex items-center justify-end gap-2">
                        {!supervisorOnly ? (
                          <>
                            <button 
                              onClick={() => {
                                setEditingIncident(inc);
                                setIsModalOpen(true);
                              }}
                              className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button 
                              onClick={() => handleDelete(inc.id)}
                              className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">HR follow-up</span>
                        )}
                      </div>"""
text = replace_exact(text, old_actions, new_actions, 'Performance action restriction')
text = replace_exact(text,
    "          incident={editingIncident}\n          staff={staff}\n",
    "          incident={editingIncident}\n          staff={supervisorStaff}\n          supervisorOnly={supervisorOnly}\n",
    'Performance modal props')
text = replace_exact(text,
    "const IncidentModal: React.FC<{ isOpen: boolean; onClose: () => void; incident: DisciplinaryIncident | null; staff: Staff[] }> = ({ isOpen, onClose, incident, staff }) => {",
    "const IncidentModal: React.FC<{ isOpen: boolean; onClose: () => void; incident: DisciplinaryIncident | null; staff: Staff[]; supervisorOnly?: boolean }> = ({ isOpen, onClose, incident, staff, supervisorOnly = false }) => {",
    'Incident modal signature')
text = replace_exact(text,
    "    try {\n      if (incident?.id) {\n        await firestoreService.updateDocument('disciplinary_incidents', incident.id, formData);",
    "    try {\n      if (incident?.id) {\n        if (supervisorOnly) {\n          toast.error('Submitted incidents are followed up by HR and cannot be edited by the reporting supervisor.');\n          return;\n        }\n        await firestoreService.updateDocument('disciplinary_incidents', incident.id, formData);",
    'Incident update guard')
text = replace_exact(text,
    "        await firestoreService.addDocument('disciplinary_incidents', {\n          ...formData,\n          tenantId: profile.tenantId\n        });",
    """        const now = new Date().toISOString();
        await firestoreService.addDocument('disciplinary_incidents', {
          ...formData,
          tenantId: profile.tenantId,
          status: 'open',
          action_taken: '',
          reportedByUserId: profile.uid || profile.id,
          reportedByName: profile.full_name || profile.displayName || profile.email || 'Supervisor',
          reportedByRole: String(profile.role || 'Staff'),
          reportedAt: now,
          reportedFromBranchId: profile.branch_id || '',
          reportedFromDepartment: profile.department || '',
          followUpStatus: 'pending_hr_review'
        });""",
    'Incident reporter attribution')
old_followup = """          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Action Taken</label>
              <input type="text" placeholder="e.g. Verbal warning" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.action_taken || ''} onChange={(e) => setFormData({ ...formData, action_taken: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Status</label>
              <select className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.status || 'open'} onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="appealed">Appealed</option>
              </select>
            </div>
          </div>"""
new_followup = """          {!supervisorOnly ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Action Taken</label>
                <input type="text" placeholder="e.g. Verbal warning" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.action_taken || ''} onChange={(e) => setFormData({ ...formData, action_taken: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Status</label>
                <select className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.status || 'open'} onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}>
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                  <option value="appealed">Appealed</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs font-medium text-indigo-800">
              This report will be submitted as an open incident. HR owns investigation, action, follow-up and closure after submission.
            </div>
          )}"""
text = replace_exact(text, old_followup, new_followup, 'Incident HR follow-up fields')
path.write_text(text)


# -----------------------------------------------------------------------------
# Recruitment: supervisor view is Practical Assessment only, with assessor audit.
# -----------------------------------------------------------------------------
path = Path('src/modules/hr/RecruitmentManager.tsx')
text = path.read_text()
text = replace_exact(text, "import { cn } from '../../utils/cn';\n", "import { cn } from '../../utils/cn';\nimport { where } from 'firebase/firestore';\n", 'Recruitment where import')
text = replace_exact(text,
    "export const RecruitmentManager: React.FC = () => {",
    "export const RecruitmentManager: React.FC<{ supervisorOnly?: boolean }> = ({ supervisorOnly = false }) => {",
    'Recruitment props')
old_sub = """  useEffect(() => {
    if (profile?.tenantId) {
      return firestoreService.subscribeToCollection<HiringApplication>(
        'hiring_applications',
        profile.tenantId,
        setApplications
      );
    }
  }, [profile?.tenantId]);
"""
new_sub = """  useEffect(() => {
    if (!profile?.tenantId) return;
    return supervisorOnly
      ? firestoreService.subscribeToCollectionByQuery<HiringApplication>(
          'hiring_applications',
          profile.tenantId,
          [where('status', 'in', ['practical_scheduled', 'practical_completed'])],
          setApplications
        )
      : firestoreService.subscribeToCollection<HiringApplication>('hiring_applications', profile.tenantId, setApplications);
  }, [profile?.tenantId, supervisorOnly]);

  useEffect(() => {
    if (supervisorOnly && activeTab !== 'practical') setActiveTab('practical');
  }, [supervisorOnly, activeTab]);
"""
text = replace_exact(text, old_sub, new_sub, 'Recruitment scoped subscription')
text = replace_exact(text, "    if (!profile?.tenantId) return;\n\n    try {\n      await firestoreService.addDocument('hiring_applications',", "    if (!profile?.tenantId || supervisorOnly) return;\n\n    try {\n      await firestoreService.addDocument('hiring_applications',", 'Recruitment create guard')
text = replace_exact(text, "  const handleUpdateStatusAndSchedule = async (appId: string, nextStatus: string, dateField?: string, dateVal?: string) => {\n    try {", "  const handleUpdateStatusAndSchedule = async (appId: string, nextStatus: string, dateField?: string, dateVal?: string) => {\n    if (supervisorOnly) return;\n    try {", 'Recruitment schedule guard')
text = replace_exact(text, "  const handleTransitionToSchedule = (app: HiringApplication, actionName: 'theory' | 'oral' | 'practical') => {\n    setActionApp(app);", "  const handleTransitionToSchedule = (app: HiringApplication, actionName: 'theory' | 'oral' | 'practical') => {\n    if (supervisorOnly) return;\n    setActionApp(app);", 'Recruitment transition guard')
text = replace_exact(text,
    "  const handleSaveMarks = async () => {\n    if (!actionApp) return;\n\n    try {",
    "  const handleSaveMarks = async () => {\n    if (!actionApp || !profile) return;\n    if (supervisorOnly && actionApp.status !== 'practical_scheduled') {\n      toast.error('Supervisors may enter marks only for the Practical Assessment stage.');\n      return;\n    }\n\n    try {",
    'Recruitment marks guard')
text = replace_exact(text,
    "        updates.practical_score = score;\n        updates.status = 'practical_completed';",
    """        updates.practical_score = score;
        updates.status = 'practical_completed';
        updates.practical_assessed_by_user_id = profile.uid || profile.id;
        updates.practical_assessed_by_name = profile.full_name || profile.displayName || profile.email || 'Supervisor';
        updates.practical_assessed_by_role = String(profile.role || 'Staff');
        updates.practical_assessed_at = new Date().toISOString();
        updates.practical_assessed_branch_id = profile.branch_id || '';""",
    'Recruitment practical assessor audit')
text = replace_exact(text, "  const handleRejectCandidate = async (appId: string) => {\n    if (!window.confirm", "  const handleRejectCandidate = async (appId: string) => {\n    if (supervisorOnly) return;\n    if (!window.confirm", 'Recruitment reject guard')
text = replace_exact(text, "  const handleRecommendForTraining = async (appId: string) => {\n    if (!window.confirm", "  const handleRecommendForTraining = async (appId: string) => {\n    if (supervisorOnly) return;\n    if (!window.confirm", 'Recruitment training guard')
text = replace_exact(text, "  const handleHireCandidate = async (app: HiringApplication) => {\n    if (!profile?.tenantId) return;", "  const handleHireCandidate = async (app: HiringApplication) => {\n    if (!profile?.tenantId || supervisorOnly) return;", 'Recruitment hire guard')
old_tabs = """          <SubTabButton active={activeTab === 'applied'} onClick={() => setActiveTab('applied')} label="1. Applied Pool" />
          <SubTabButton active={activeTab === 'theory'} onClick={() => setActiveTab('theory')} label="2. Theoretical Logs" />
          <SubTabButton active={activeTab === 'oral'} onClick={() => setActiveTab('oral')} label="3. Oral Evaluation" />
          <SubTabButton active={activeTab === 'practical'} onClick={() => setActiveTab('practical')} label="4. Practical Stage" />
          <SubTabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} label="History Archive" />"""
new_tabs = """          {!supervisorOnly && <SubTabButton active={activeTab === 'applied'} onClick={() => setActiveTab('applied')} label="1. Applied Pool" />}
          {!supervisorOnly && <SubTabButton active={activeTab === 'theory'} onClick={() => setActiveTab('theory')} label="2. Theoretical Logs" />}
          {!supervisorOnly && <SubTabButton active={activeTab === 'oral'} onClick={() => setActiveTab('oral')} label="3. Oral Evaluation" />}
          <SubTabButton active={activeTab === 'practical'} onClick={() => setActiveTab('practical')} label="Practical Assessment" />
          {!supervisorOnly && <SubTabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} label="History Archive" />}"""
text = replace_exact(text, old_tabs, new_tabs, 'Recruitment tab restriction')
text = replace_exact(text,
    "        <button \n          onClick={() => setIsNewAppModalOpen(true)}",
    "        {!supervisorOnly && <button \n          onClick={() => setIsNewAppModalOpen(true)}",
    'Recruitment new candidate button open')
text = replace_exact(text,
    "          New Candidate Application\n        </button>",
    "          New Candidate Application\n        </button>}",
    'Recruitment new candidate button close')
# Hide every non-practical stage workflow action from supervisors.
text = text.replace("{app.status === 'applied' && (", "{!supervisorOnly && app.status === 'applied' && (", 1)
text = text.replace("{app.status === 'theoretical_scheduled' && (", "{!supervisorOnly && app.status === 'theoretical_scheduled' && (", 1)
text = text.replace("{app.status === 'theoretical_completed' && (", "{!supervisorOnly && app.status === 'theoretical_completed' && (", 1)
text = text.replace("{app.status === 'oral_scheduled' && (", "{!supervisorOnly && app.status === 'oral_scheduled' && (", 1)
text = text.replace("{app.status === 'oral_completed' && (", "{!supervisorOnly && app.status === 'oral_completed' && (", 1)
text = text.replace("{app.status === 'practical_completed' && (", "{!supervisorOnly && app.status === 'practical_completed' && (", 1)
text = text.replace("{!['hired', 'rejected', 'recommended_training', 'training_accepted'].includes(app.status) && (", "{!supervisorOnly && !['hired', 'rejected', 'recommended_training', 'training_accepted'].includes(app.status) && (", 1)
# Dossier decision buttons are HR-only.
text = text.replace("{!['hired', 'rejected'].includes(selectedApp.status) && (", "{!supervisorOnly && !['hired', 'rejected'].includes(selectedApp.status) && (", 1)
text = text.replace("{selectedApp.status === 'practical_completed' && (", "{!supervisorOnly && selectedApp.status === 'practical_completed' && (", 1)
text = replace_exact(text, "      {isNewAppModalOpen && (", "      {!supervisorOnly && isNewAppModalOpen && (", 'Recruitment create modal restriction')
text = replace_exact(text, "      {isScheduleModalOpen && actionApp && (", "      {!supervisorOnly && isScheduleModalOpen && actionApp && (", 'Recruitment schedule modal restriction')
# Show who submitted the practical assessment in the dossier.
text = replace_exact(text,
    "                    {selectedApp.practical_date && <span className=\"text-[8px] text-slate-400 font-medium block mt-1\">{selectedApp.practical_date}</span>}\n",
    """                    {selectedApp.practical_date && <span className=\"text-[8px] text-slate-400 font-medium block mt-1\">{selectedApp.practical_date}</span>}
                    {selectedApp.practical_assessed_by_name && <span className=\"text-[8px] text-slate-500 font-semibold block mt-1\">Assessed by: {selectedApp.practical_assessed_by_name}</span>}
""",
    'Recruitment assessor display')
path.write_text(text)


# -----------------------------------------------------------------------------
# Trainees: supervisors post assessment marks only. HR retains admission/hire/exit.
# -----------------------------------------------------------------------------
path = Path('src/modules/hr/TraineesManager.tsx')
text = path.read_text()
text = replace_exact(text, "import { cn } from '../../utils/cn';\n", "import { cn } from '../../utils/cn';\nimport { where } from 'firebase/firestore';\n", 'Trainees where import')
text = replace_exact(text, "export const TraineesManager: React.FC = () => {", "export const TraineesManager: React.FC<{ supervisorOnly?: boolean }> = ({ supervisorOnly = false }) => {", 'Trainees props')
old_sub = """  useEffect(() => {
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
"""
new_sub = """  useEffect(() => {
    if (!profile?.tenantId) return;
    if (supervisorOnly) {
      return firestoreService.subscribeToCollectionByQuery<HiringApplication>(
        'hiring_applications',
        profile.tenantId,
        [where('status', '==', 'training_accepted')],
        setTraineeApps
      );
    }
    return firestoreService.subscribeToCollection<HiringApplication>(
      'hiring_applications',
      profile.tenantId,
      (data) => setTraineeApps(data.filter(item => ['recommended_training', 'training_accepted'].includes(item.status)))
    );
  }, [profile?.tenantId, supervisorOnly]);
"""
text = replace_exact(text, old_sub, new_sub, 'Trainees scoped subscription')
text = replace_exact(text, "  const handleAcceptTraining = async (appId: string) => {\n    try {", "  const handleAcceptTraining = async (appId: string) => {\n    if (supervisorOnly) return;\n    try {", 'Trainee admission guard')
text = replace_exact(text, "  const handleSaveEvaluations = async () => {\n    if (!selectedTrainee) return;\n\n    try {", "  const handleSaveEvaluations = async () => {\n    if (!selectedTrainee || !profile) return;\n\n    const scoreInputs = [w4Appraisal, w4Theory, w8Appraisal, w8Theory, w12Appraisal, w12Theory].filter(Boolean);\n    if (scoreInputs.some(value => { const score = Number(value); return !Number.isFinite(score) || score < 0 || score > 100; })) {\n      toast.error('Assessment marks must be between 0 and 100.');\n      return;\n    }\n\n    try {", 'Trainee evaluation validation')
old_updates = """      const updates: Partial<HiringApplication> = {
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
"""
new_updates = """      const now = new Date().toISOString();
      const actorId = profile.uid || profile.id;
      const actorName = profile.full_name || profile.displayName || profile.email || 'Supervisor';
      const actorRole = String(profile.role || 'Staff');
      const updates: Partial<HiringApplication> = {};

      const canWrite = (current: number | null | undefined) => !supervisorOnly || current === null || current === undefined;
      if (w4Appraisal && canWrite(selectedTrainee.week4_appraisal_score)) updates.week4_appraisal_score = parseFloat(w4Appraisal);
      if (w4Theory && canWrite(selectedTrainee.week4_theory_score)) updates.week4_theory_score = parseFloat(w4Theory);
      if (w8Appraisal && canWrite(selectedTrainee.week8_appraisal_score)) updates.week8_appraisal_score = parseFloat(w8Appraisal);
      if (w8Theory && canWrite(selectedTrainee.week8_theory_score)) updates.week8_theory_score = parseFloat(w8Theory);
      if (w12Appraisal && canWrite(selectedTrainee.week12_appraisal_score)) updates.week12_appraisal_score = parseFloat(w12Appraisal);
      if (w12Theory && canWrite(selectedTrainee.week12_theory_score)) updates.week12_theory_score = parseFloat(w12Theory);

      const touchedWeek4 = ['week4_appraisal_score', 'week4_theory_score'].some(field => field in updates);
      const touchedWeek8 = ['week8_appraisal_score', 'week8_theory_score'].some(field => field in updates);
      const touchedWeek12 = ['week12_appraisal_score', 'week12_theory_score'].some(field => field in updates);
      if (!touchedWeek4 && !touchedWeek8 && !touchedWeek12) {
        toast.warning(supervisorOnly ? 'No new assessment marks are available to submit. Existing supervisor marks are locked.' : 'Enter at least one assessment mark.');
        return;
      }

      if (touchedWeek4) {
        updates.week4_assessment_date = now.split('T')[0];
        updates.week4_assessed_by_user_id = actorId;
        updates.week4_assessed_by_name = actorName;
        updates.week4_assessed_by_role = actorRole;
        updates.week4_assessed_at = now;
      }
      if (touchedWeek8) {
        updates.week8_assessment_date = now.split('T')[0];
        updates.week8_assessed_by_user_id = actorId;
        updates.week8_assessed_by_name = actorName;
        updates.week8_assessed_by_role = actorRole;
        updates.week8_assessed_at = now;
      }
      if (touchedWeek12) {
        updates.week12_assessment_date = now.split('T')[0];
        updates.week12_assessed_by_user_id = actorId;
        updates.week12_assessed_by_name = actorName;
        updates.week12_assessed_by_role = actorRole;
        updates.week12_assessed_at = now;
      }
      updates.training_assessment_last_by_user_id = actorId;
      updates.training_assessment_last_by_name = actorName;
      updates.training_assessment_last_by_role = actorRole;
      updates.training_assessment_last_at = now;
"""
text = replace_exact(text, old_updates, new_updates, 'Trainee assessment audit')
text = replace_exact(text, "  const handleHireGraduate = async (trainee: HiringApplication) => {\n    if (!profile?.tenantId) return;", "  const handleHireGraduate = async (trainee: HiringApplication) => {\n    if (!profile?.tenantId || supervisorOnly) return;", 'Trainee hire guard')
text = replace_exact(text, "  const handleRejectGraduate = async (appId: string) => {\n    if (!window.confirm", "  const handleRejectGraduate = async (appId: string) => {\n    if (supervisorOnly) return;\n    if (!window.confirm", 'Trainee reject guard')
# Hide admissions from supervisor mode.
text = replace_exact(text, "      {/* Recommended for Training Queue */}\n      <div className=\"space-y-4\">", "      {/* Recommended for Training Queue */}\n      {!supervisorOnly && <div className=\"space-y-4\">", 'Trainee admission section open')
# Close the first section immediately before Active Trainee block.
text = replace_exact(text, "      </div>\n\n      {/* Active Trainee Evaluations Block */}", "      </div>}\n\n      {/* Active Trainee Evaluations Block */}", 'Trainee admission section close')
text = replace_exact(text, "                            Update Appraisal\n", "                            {supervisorOnly ? 'Record Assessment Marks' : 'Update Appraisal'}\n", 'Trainee action label')
# Restrict graduate/reject controls to HR/full users.
text = replace_exact(text, "                          {scoresComplete ? (", "                          {!supervisorOnly && (scoresComplete ? (", 'Trainee decisions open')
# This exact block ends at the conditional before div close.
text = replace_exact(text, "                          )}\n                        </div>\n", "                          ))}\n                        </div>\n", 'Trainee decisions close')
# Lock already-submitted individual fields for supervisors.
for field in ['week4_appraisal_score', 'week4_theory_score', 'week8_appraisal_score', 'week8_theory_score', 'week12_appraisal_score', 'week12_theory_score']:
    # Inject disabled before placeholder for each corresponding field in order using its state value anchor.
    pass
# Specific input anchors to avoid broad JSX rewrites.
locks = [
    ('value={w4Appraisal}', "disabled={supervisorOnly && selectedTrainee.week4_appraisal_score !== null && selectedTrainee.week4_appraisal_score !== undefined}\n                        value={w4Appraisal}"),
    ('value={w4Theory}', "disabled={supervisorOnly && selectedTrainee.week4_theory_score !== null && selectedTrainee.week4_theory_score !== undefined}\n                        value={w4Theory}"),
    ('value={w8Appraisal}', "disabled={supervisorOnly && selectedTrainee.week8_appraisal_score !== null && selectedTrainee.week8_appraisal_score !== undefined}\n                        value={w8Appraisal}"),
    ('value={w8Theory}', "disabled={supervisorOnly && selectedTrainee.week8_theory_score !== null && selectedTrainee.week8_theory_score !== undefined}\n                        value={w8Theory}"),
    ('value={w12Appraisal}', "disabled={supervisorOnly && selectedTrainee.week12_appraisal_score !== null && selectedTrainee.week12_appraisal_score !== undefined}\n                        value={w12Appraisal}"),
    ('value={w12Theory}', "disabled={supervisorOnly && selectedTrainee.week12_theory_score !== null && selectedTrainee.week12_theory_score !== undefined}\n                        value={w12Theory}"),
]
for old, new in locks:
    text = replace_exact(text, old, new, f'Trainee lock {old}')
path.write_text(text)


# -----------------------------------------------------------------------------
# QA shell: cross-functional department heads enter Appraisals only.
# HR Head retains HR-related compliance tabs. Core QA retains full module.
# -----------------------------------------------------------------------------
path = Path('src/modules/qa/QAModule.tsx')
text = path.read_text()
text = replace_exact(text, "import React, { useState } from 'react';", "import React, { useEffect, useState } from 'react';", 'QAModule React import')
text = replace_exact(text, "import { useAuth } from '../../contexts/AuthContext';\n", "import { useAuth } from '../../contexts/AuthContext';\nimport { isPeopleSupervisorRoleName } from '../../config/rbac';\n", 'QAModule supervisor import')
text = replace_exact(text, "  const { profile, activeBranch } = useAuth();", "  const { profile, activeBranch } = useAuth();", 'QAModule auth', count=1)
old_role_logic = """  const userRole = (profile?.role || '').toLowerCase();
  const isAuthorizedRole = 
    userRole === 'owner' || 
    userRole === 'admin' || 
    userRole === 'ceo' ||
    userRole.includes('qa') ||
    userRole.includes('manager') ||
    userRole.includes('head');

  const canAccessHQOps = isHQBranch || isAuthorizedRole;
"""
new_role_logic = """  const normalizedRoles = [profile?.role || '', ...(profile?.secondaryRoles || [])].map(role => role.trim().toLowerCase());
  const hasRole = (role: string) => normalizedRoles.includes(role.toLowerCase());
  const isExecutive = ['owner', 'ceo', 'ceo / md', 'admin'].some(hasRole);
  const isCoreQA = normalizedRoles.some(role => role === 'qa head' || role === 'qa officer' || role === 'qa manager');
  const isHRHead = hasRole('hr head');
  const isBranchManager = hasRole('branch manager');
  const isPeopleSupervisor = normalizedRoles.some(role => isPeopleSupervisorRoleName(role));
  const crossFunctionalAppraisalOnly = isPeopleSupervisor && !isExecutive && !isCoreQA && !isHRHead && !isBranchManager;
  const canAccessHQOps = isHQBranch || isExecutive || isCoreQA || isHRHead || isBranchManager;
"""
text = replace_exact(text, old_role_logic, new_role_logic, 'QAModule role policy')
old_tabs = """  // Filters out HQ operation tabs if the logged-in user is not HQ or in specific QA personnel/manager roles
  const tabs = allTabs.filter(t => !t.isHQOp || canAccessHQOps);

  const renderContent = () => {
"""
new_tabs = """  const tabs = crossFunctionalAppraisalOnly
    ? allTabs.filter(tab => tab.id === 'appraisals')
    : isHRHead && !isExecutive && !isCoreQA
      ? allTabs.filter(tab => ['licenses', 'cme', 'appraisals'].includes(tab.id))
      : allTabs.filter(tab => !tab.isHQOp || canAccessHQOps);

  useEffect(() => {
    if (!tabs.some(tab => tab.id === activeTab) && tabs.length > 0) {
      setActiveTab(tabs[0].id as QATab);
    }
  }, [activeTab, crossFunctionalAppraisalOnly, isHRHead, canAccessHQOps]);

  const renderContent = () => {
"""
text = replace_exact(text, old_tabs, new_tabs, 'QAModule tab boundary')
text = replace_exact(text, "      case 'appraisals': return <Appraisals />;", "      case 'appraisals': return <Appraisals supervisorOnly={crossFunctionalAppraisalOnly || isBranchManager} />;", 'QAModule appraisal mode')
path.write_text(text)


# -----------------------------------------------------------------------------
# Appraisals: authenticated appraiser identity, self-appraisal block, branch scope.
# -----------------------------------------------------------------------------
path = Path('src/modules/qa/Appraisals.tsx')
text = path.read_text()
text = replace_exact(text, "import { format } from 'date-fns';\n", "import { format } from 'date-fns';\nimport { where } from 'firebase/firestore';\n", 'Appraisals where import')
text = replace_exact(text, "export const Appraisals = () => {\n  const { user, activeBranch, tenantId } = useAuth();", "export const Appraisals: React.FC<{ supervisorOnly?: boolean }> = ({ supervisorOnly = false }) => {\n  const { user, profile, activeBranch, tenantId } = useAuth();", 'Appraisals props/auth')
text = replace_exact(text,
    "      (entries) => {\n        const branchEntries = entries.filter(e => e.branchId === activeBranch.id);\n        setAppraisals(branchEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));\n      }\n    );",
    "      (entries) => setAppraisals(entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())),\n      [where('branchId', '==', activeBranch.id)]\n    );",
    'Appraisals branch subscription')
# Previous replacement changes argument order incorrectly for service signature; fix the entire call explicitly.
text = replace_regex(text,
    r"const unsubscribeAppraisals = firestoreService\.subscribeToCollection<Appraisal>\(\n      'appraisals',\n      tenantId,.*?\n    \);",
    """const unsubscribeAppraisals = firestoreService.subscribeToCollectionByQuery<Appraisal>(
      'appraisals',
      tenantId,
      [where('branchId', '==', activeBranch.id)],
      (entries) => setAppraisals(entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()))
    );""",
    'Appraisals correct branch query')
old_staff_cb = """      (entries) => {
        const branchStaff = entries.filter(s => s.branch_id === activeBranch.id);
        setStaff(branchStaff);
      }
    );"""
new_staff_cb = """      (entries) => {
        const selfIds = [profile?.id, profile?.uid].filter(Boolean);
        const branchStaff = entries.filter(s => {
          const inBranch = s.branch_id === activeBranch.id || (s.assigned_branches || []).includes(activeBranch.id);
          if (!inBranch) return false;
          if (supervisorOnly && (selfIds.includes(s.id) || selfIds.includes(s.uid))) return false;
          if (supervisorOnly && profile?.role?.toString().toLowerCase() !== 'branch manager' && profile?.department && s.department && profile.department !== s.department) return false;
          return true;
        });
        setStaff(branchStaff);
      }
    );"""
text = replace_exact(text, old_staff_cb, new_staff_cb, 'Appraisal staff scope')
text = replace_exact(text, "  }, [tenantId, activeBranch]);", "  }, [tenantId, activeBranch, supervisorOnly, profile?.id, profile?.uid, profile?.department, profile?.role]);\n\n  useEffect(() => {\n    if (supervisorOnly && activeTab === 'overview') setActiveTab('run');\n  }, [supervisorOnly, activeTab]);", 'Appraisal effect deps')
text = replace_exact(text, "  const handleOpenEdit = (app: Appraisal) => {\n    setEditingAppraisal(app);", "  const handleOpenEdit = (app: Appraisal) => {\n    const actorId = profile?.uid || profile?.id || user?.uid;\n    if (supervisorOnly && (!app.appraisedByUserId || app.appraisedByUserId !== actorId)) {\n      toast.error('Supervisors may modify only appraisal sheets they originally created.');\n      return;\n    }\n    setEditingAppraisal(app);", 'Appraisal edit ownership')
text = replace_exact(text,
    "    const staffMember = staff.find(s => s.id === staffId);\n    if (!staffMember) return;",
    "    const staffMember = staff.find(s => s.id === staffId);\n    if (!staffMember) return;\n    const actorId = profile?.uid || profile?.id || user.uid;\n    if (supervisorOnly && (staffMember.id === actorId || staffMember.uid === actorId)) {\n      toast.error('A supervisor cannot appraise their own staff record.');\n      return;\n    }\n    const actorName = profile?.full_name || profile?.displayName || user.displayName || user.email || 'Authorized Appraiser';\n    const actorRole = String(profile?.role || 'Staff');\n    const now = new Date().toISOString();",
    'Appraisal actor identity')
text = replace_exact(text,
    "        appraiserName: user.fullName || user.displayName || 'Authorized QA/Manager',\n      };",
    "      };\n\n      if (!editingAppraisal?.id) {\n        dataPayload.appraiserName = actorName;\n        dataPayload.appraisedByUserId = actorId;\n        dataPayload.appraisedByName = actorName;\n        dataPayload.appraisedByRole = actorRole;\n        dataPayload.appraisedByBranchId = activeBranch.id;\n        dataPayload.appraisedByDepartment = profile?.department || '';\n        dataPayload.appraisedAt = now;\n      } else {\n        dataPayload.lastUpdatedByUserId = actorId;\n        dataPayload.lastUpdatedByName = actorName;\n        dataPayload.lastUpdatedByRole = actorRole;\n        dataPayload.lastUpdatedAt = now;\n      }",
    'Appraisal attribution payload')
text = text.replace("dataPayload.managerLoggedBy = user.fullName;", "dataPayload.managerLoggedBy = actorName;", 1)
text = text.replace("dataPayload.qaLoggedBy = user.fullName;", "dataPayload.qaLoggedBy = actorName;", 1)
# Supervisor mode does not show executive aggregate dashboard.
text = replace_exact(text, "        <button\n          id=\"btn-tab-overview\"", "        {!supervisorOnly && <button\n          id=\"btn-tab-overview\"", 'Appraisal overview button open')
text = replace_exact(text, "          <span>Executive Dashboard</span>\n        </button>", "          <span>Executive Dashboard</span>\n        </button>}", 'Appraisal overview button close')
# Show authenticated appraiser in active feed.
text = replace_exact(text,
    "                            <p className=\"text-[10px] text-slate-400\">Assigned Branch member</p>\n",
    "                            <p className=\"text-[10px] text-slate-400\">Appraised by: {app.appraisedByName || app.appraiserName || 'Legacy record'}</p>\n",
    'Appraiser display in feed')
# Only owner of sheet gets modify button in supervisor mode.
old_modify = """                          <button
                            onClick={() => handleOpenEdit(app)}
                            className="p-1 px-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg flex items-center gap-1 border border-slate-100 text-xs font-semibold transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Modify Score Sheet</span>
                          </button>"""
new_modify = """                          {(!supervisorOnly || app.appraisedByUserId === (profile?.uid || profile?.id || user?.uid)) && (
                            <button
                              onClick={() => handleOpenEdit(app)}
                              className="p-1 px-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg flex items-center gap-1 border border-slate-100 text-xs font-semibold transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Modify Score Sheet</span>
                            </button>
                          )}"""
text = replace_exact(text, old_modify, new_modify, 'Appraisal modify ownership UI')
text = replace_exact(text, "Certified By Appraiser: {viewingReport.appraiserName}", "Certified By Appraiser: {viewingReport.appraisedByName || viewingReport.appraiserName || 'Legacy record'}", 'Appraisal report appraiser')
path.write_text(text)


# -----------------------------------------------------------------------------
# Firestore rules: enforce narrow supervisor capabilities server-side and remove
# sensitive HR/QA collections from the broad generic write/read fallback.
# -----------------------------------------------------------------------------
path = Path('firestore.rules')
text = path.read_text()
insert_after = """    function hasBranchManagerRole() {
      return isAuthenticated() && (
        hasRole('Branch Manager') || hasRole('branch manager') || hasRole('admin')
      );
    }
"""
helpers = insert_after + """

    function isDepartmentHead() {
      return isAuthenticated() && (
        hasRole('Finance Head') ||
        hasRole('Procurement Head') ||
        hasRole('Logistics Head') || hasRole('Transport & Logistics Head') ||
        hasRole('Marketing Head') ||
        hasRole('QA Head') ||
        hasRole('HR Head') ||
        hasRole('IT Head')
      );
    }

    function isPeopleSupervisor() {
      return isAuthenticated() && (isBranchManager() || isDepartmentHead() || isAdmin());
    }

    function isAssignedToBranch(branchId) {
      return isAuthenticated() && (
        (("assigned_branches" in getUserData()) && getUserData().assigned_branches.hasAny([branchId])) ||
        (("branch_id" in getUserData()) && getUserData().branch_id == branchId) ||
        (("default_branch_id" in getUserData()) && getUserData().default_branch_id == branchId) ||
        isAdmin()
      );
    }

    function isSupervisorPracticalAssessmentUpdate() {
      return isPeopleSupervisor()
        && isTenantMember(resource.data.tenantId)
        && isTenantMember(request.resource.data.tenantId)
        && request.resource.data.tenantId == resource.data.tenantId
        && resource.data.status == 'practical_scheduled'
        && request.resource.data.status == 'practical_completed'
        && request.resource.data.practical_score is number
        && request.resource.data.practical_score >= 0
        && request.resource.data.practical_score <= 100
        && request.resource.data.practical_assessed_by_user_id == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          'practical_score', 'status',
          'practical_assessed_by_user_id', 'practical_assessed_by_name', 'practical_assessed_by_role',
          'practical_assessed_at', 'practical_assessed_branch_id', 'updatedAt'
        ]);
    }

    function isSupervisorTraineeAssessmentUpdate() {
      return isPeopleSupervisor()
        && isTenantMember(resource.data.tenantId)
        && isTenantMember(request.resource.data.tenantId)
        && request.resource.data.tenantId == resource.data.tenantId
        && resource.data.status == 'training_accepted'
        && request.resource.data.status == 'training_accepted'
        && request.resource.data.training_assessment_last_by_user_id == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          'week4_appraisal_score', 'week4_theory_score', 'week4_assessment_date',
          'week4_assessed_by_user_id', 'week4_assessed_by_name', 'week4_assessed_by_role', 'week4_assessed_at',
          'week8_appraisal_score', 'week8_theory_score', 'week8_assessment_date',
          'week8_assessed_by_user_id', 'week8_assessed_by_name', 'week8_assessed_by_role', 'week8_assessed_at',
          'week12_appraisal_score', 'week12_theory_score', 'week12_assessment_date',
          'week12_assessed_by_user_id', 'week12_assessed_by_name', 'week12_assessed_by_role', 'week12_assessed_at',
          'training_assessment_last_by_user_id', 'training_assessment_last_by_name',
          'training_assessment_last_by_role', 'training_assessment_last_at', 'updatedAt'
        ])
        && request.resource.data.diff(resource.data).affectedKeys().hasAny([
          'week4_appraisal_score', 'week4_theory_score',
          'week8_appraisal_score', 'week8_theory_score',
          'week12_appraisal_score', 'week12_theory_score'
        ])
        && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['week4_appraisal_score']) || (request.resource.data.week4_appraisal_score is number && request.resource.data.week4_appraisal_score >= 0 && request.resource.data.week4_appraisal_score <= 100))
        && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['week4_theory_score']) || (request.resource.data.week4_theory_score is number && request.resource.data.week4_theory_score >= 0 && request.resource.data.week4_theory_score <= 100))
        && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['week8_appraisal_score']) || (request.resource.data.week8_appraisal_score is number && request.resource.data.week8_appraisal_score >= 0 && request.resource.data.week8_appraisal_score <= 100))
        && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['week8_theory_score']) || (request.resource.data.week8_theory_score is number && request.resource.data.week8_theory_score >= 0 && request.resource.data.week8_theory_score <= 100))
        && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['week12_appraisal_score']) || (request.resource.data.week12_appraisal_score is number && request.resource.data.week12_appraisal_score >= 0 && request.resource.data.week12_appraisal_score <= 100))
        && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['week12_theory_score']) || (request.resource.data.week12_theory_score is number && request.resource.data.week12_theory_score >= 0 && request.resource.data.week12_theory_score <= 100));
    }
"""
text = replace_exact(text, insert_after, helpers, 'Firestore supervisor helpers')
old_hiring = """    match /hiring_applications/{applicationId} {
      allow read, write: if isHR();
    }
"""
new_hiring = """    match /hiring_applications/{applicationId} {
      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && (
        isHR() ||
        (isPeopleSupervisor() && resource.data.status in ['practical_scheduled', 'practical_completed', 'training_accepted'])
      );
      allow create, delete: if isHR();
      allow update: if isHR() || isSupervisorPracticalAssessmentUpdate() || isSupervisorTraineeAssessmentUpdate();
    }
"""
text = replace_exact(text, old_hiring, new_hiring, 'Firestore hiring application policy')
old_practical = """    match /practical_assessments/{assessmentId} {
      allow read: if isHR() || isOwner(resource.data.supervisorId);
      allow write: if isHR() || isOwner(request.resource.data.supervisorId);
    }
"""
new_practical = """    match /practical_assessments/{assessmentId} {
      allow read: if isHR() || (isPeopleSupervisor() && isTenantMember(resource.data.tenantId));
      allow create: if isHR() || (isPeopleSupervisor() && isTenantMember(request.resource.data.tenantId) && request.resource.data.supervisorId == request.auth.uid);
      allow update: if isHR() || (isPeopleSupervisor() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId) && resource.data.supervisorId == request.auth.uid && request.resource.data.supervisorId == request.auth.uid);
      allow delete: if isHR();
    }
"""
text = replace_exact(text, old_practical, new_practical, 'Firestore practical policy')
old_incidents = """    match /disciplinary_incidents/{incidentId} {
      allow read: if isAuthenticated() && (isHR() || isBranchManager() || isOwner(resource.data.staffId) || isTenantMember(resource.data.tenantId));
      allow create: if isHR() || isBranchManager() || isQA() || isAdmin();
      allow update: if isHR() || isAdmin();
    }
"""
new_incidents = """    match /disciplinary_incidents/{incidentId} {
      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && (
        isHR() || isAdmin() || isOwner(resource.data.staffId) || resource.data.reportedByUserId == request.auth.uid
      );
      allow create: if isAuthenticated() && isTenantMember(request.resource.data.tenantId) && (
        isHR() || isAdmin() ||
        ((isPeopleSupervisor() || isQA())
          && request.resource.data.reportedByUserId == request.auth.uid
          && request.resource.data.status == 'open')
      );
      allow update: if isHR() || isAdmin();
      allow delete: if isAdmin();
    }
"""
text = replace_exact(text, old_incidents, new_incidents, 'Firestore incidents policy')
old_appraisals = """    match /appraisals/{appraisalId} {
      allow read: if isAuthenticated() && (isOwner(resource.data.staffId) || isQA() || isHR() || isTenantMember(resource.data.tenantId));
      allow write: if isQA() || isHR() || isAdmin();
    }
"""
new_appraisals = """    match /appraisals/{appraisalId} {
      allow read: if isAuthenticated() && isTenantMember(resource.data.tenantId) && (
        isOwner(resource.data.staffId) || isQA() || isHR() || isAdmin() ||
        (isPeopleSupervisor() && isAssignedToBranch(resource.data.branchId))
      );
      allow create: if isAuthenticated() && isTenantMember(request.resource.data.tenantId) && (
        isQA() || isHR() || isAdmin() ||
        (isPeopleSupervisor()
          && isAssignedToBranch(request.resource.data.branchId)
          && request.resource.data.staffId != request.auth.uid
          && request.resource.data.appraisedByUserId == request.auth.uid)
      );
      allow update: if isAuthenticated() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId) && (
        isQA() || isHR() || isAdmin() ||
        (isPeopleSupervisor()
          && resource.data.appraisedByUserId == request.auth.uid
          && request.resource.data.appraisedByUserId == resource.data.appraisedByUserId
          && request.resource.data.appraisedByName == resource.data.appraisedByName
          && request.resource.data.appraisedByRole == resource.data.appraisedByRole
          && request.resource.data.appraisedAt == resource.data.appraisedAt
          && request.resource.data.staffId == resource.data.staffId
          && request.resource.data.branchId == resource.data.branchId
          && request.resource.data.staffId != request.auth.uid
          && request.resource.data.lastUpdatedByUserId == request.auth.uid)
      );
      allow delete: if isQA() || isHR() || isAdmin();
    }
"""
text = replace_exact(text, old_appraisals, new_appraisals, 'Firestore appraisal policy')
# Exclude sensitive collections from generic fallback so explicit policies cannot be bypassed.
old_read_prefix = "allow read: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && isAuthenticated()"
new_read_prefix = "allow read: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && collectionName != 'hiring_applications' && collectionName != 'practical_assessments' && collectionName != 'disciplinary_incidents' && collectionName != 'appraisals' && isAuthenticated()"
text = replace_exact(text, old_read_prefix, new_read_prefix, 'Generic sensitive read exclusion')
for verb in ['create', 'update']:
    old = f"allow {verb}: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && collectionName != 'product_batches' && collectionName != 'products' && collectionName != 'sales' && collectionName != 'role_realms_of_operation' && collectionName != 'hr_roles'"
    new = f"allow {verb}: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && collectionName != 'product_batches' && collectionName != 'products' && collectionName != 'sales' && collectionName != 'role_realms_of_operation' && collectionName != 'hr_roles' && collectionName != 'hiring_applications' && collectionName != 'practical_assessments' && collectionName != 'disciplinary_incidents' && collectionName != 'appraisals'"
    text = replace_exact(text, old, new, f'Generic sensitive {verb} exclusion')
old_delete = "allow delete: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && collectionName != 'product_batches' && collectionName != 'products' && collectionName != 'sales' && collectionName != 'role_realms_of_operation' && collectionName != 'hr_roles'"
new_delete = "allow delete: if collectionName != 'opening_stock_sessions' && collectionName != 'transfer_invoices' && collectionName != 'transfer_invoice_lines' && collectionName != 'product_batches' && collectionName != 'products' && collectionName != 'sales' && collectionName != 'role_realms_of_operation' && collectionName != 'hr_roles' && collectionName != 'hiring_applications' && collectionName != 'practical_assessments' && collectionName != 'disciplinary_incidents' && collectionName != 'appraisals'"
text = replace_exact(text, old_delete, new_delete, 'Generic sensitive delete exclusion')
path.write_text(text)

print('Supervisor capability update applied successfully.')
