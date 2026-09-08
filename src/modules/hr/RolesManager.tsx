import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Eye,
  Lock,
  Plus,
  Save,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Staff } from '../../types';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';
import {
  customRoleBaselinePermissions,
  isITRoleName,
  isSystemRoleName,
  RBAC_MODULES,
  RBAC_SCHEMA_VERSION,
  RBAC_SYSTEM_VERSION,
  RealmAccessLevel,
  RealmPermissionRecord,
  RbacModuleKey,
  roleRealmId,
  SYSTEM_ROLES,
  systemRoleRealmPermissions,
} from '../../config/rbac';

export interface CustomRole {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  isCustom: true;
  created_at: string;
  created_by: string;
  updated_at?: string;
  updated_by?: string;
}

type RealmPermissions = Record<RbacModuleKey, RealmPermissionRecord>;

type RoleCard = {
  id: string;
  name: string;
  label: string;
  description: string;
  isCustom: boolean;
  customRole?: CustomRole;
};

const ACCESS_LABELS: Record<RealmAccessLevel, string> = {
  none: 'No access',
  view_only: 'View only',
  view_functional: 'Functional',
  all: 'Functional',
};

const normalizeCustomPermissions = (input: any): RealmPermissions => {
  const baseline = customRoleBaselinePermissions();
  RBAC_MODULES.forEach(module => {
    const incoming = input?.[module.id];
    if (!incoming) return;
    const accessLevel: RealmAccessLevel =
      incoming.accessLevel === 'view' || incoming.accessLevel === 'view_only'
        ? 'view_only'
        : incoming.accessLevel === 'operate' || incoming.accessLevel === 'view_functional' || incoming.accessLevel === 'all'
          ? 'view_functional'
          : 'none';

    baseline[module.id] = {
      accessLevel,
      scope: 'assigned_branches',
      submodules: incoming.submodules || '',
    };
  });

  // These two are constitutional baseline permissions for every tenant account.
  baseline.dashboard.accessLevel = 'view_only';
  baseline.welfare.accessLevel = 'view_functional';
  return baseline;
};

export const RolesManager: React.FC = () => {
  const { profile } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleCard | null>(null);
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [realmPermissions, setRealmPermissions] = useState<RealmPermissions>(customRoleBaselinePermissions());
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const assignedRoles = [profile?.role || '', ...(profile?.secondaryRoles || [])];
  const canManageRoles = assignedRoles.some(isITRoleName);

  useEffect(() => {
    if (!profile?.tenantId) return;

    const staffQuery = query(collection(db, 'staff'), where('tenantId', '==', profile.tenantId));
    const rolesQuery = query(collection(db, 'hr_roles'), where('tenantId', '==', profile.tenantId));

    const unsubStaff = onSnapshot(staffQuery, snap => {
      setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() } as Staff)));
    });
    const unsubRoles = onSnapshot(rolesQuery, snap => {
      setCustomRoles(snap.docs.map(d => ({ id: d.id, ...d.data() } as CustomRole)));
    });

    return () => {
      unsubStaff();
      unsubRoles();
    };
  }, [profile?.tenantId]);

  const syncSystemRoles = async () => {
    if (!profile?.tenantId || !canManageRoles || syncing) return;
    setSyncing(true);
    try {
      const checks = await Promise.all(
        SYSTEM_ROLES.map(async role => {
          const ref = doc(db, 'role_realms_of_operation', roleRealmId(profile.tenantId, role.name));
          const snap = await getDoc(ref);
          const permissions = systemRoleRealmPermissions(role);
          const current = snap.exists() ? snap.data() : null;
          const needsWrite = !current
            || current.systemVersion !== RBAC_SYSTEM_VERSION
            || current.schemaVersion !== RBAC_SCHEMA_VERSION
            || JSON.stringify(current.permissions || {}) !== JSON.stringify(permissions);
          return { role, ref, permissions, needsWrite };
        })
      );

      const changed = checks.filter(item => item.needsWrite);
      if (changed.length > 0) {
        const batch = writeBatch(db);
        changed.forEach(({ role, ref, permissions }) => {
          batch.set(ref, {
            tenantId: profile.tenantId,
            roleName: role.name,
            roleLabel: role.label,
            roleType: 'system',
            isSystemRole: true,
            immutable: true,
            schemaVersion: RBAC_SCHEMA_VERSION,
            systemVersion: RBAC_SYSTEM_VERSION,
            permissions,
            updatedAt: new Date().toISOString(),
            updatedBy: profile.full_name || profile.email || profile.id,
          });
        });
        await batch.commit();
      }
    } catch (error) {
      console.error('Failed to synchronize system RBAC realms', error);
      toast.error('System role registry could not be synchronized.');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    // System roles are code-defined and immutable. IT synchronizes a tenant-side
    // mirror for inspection/audit, but runtime authorization uses the code registry.
    void syncSystemRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenantId, canManageRoles]);

  const allRoles = useMemo<RoleCard[]>(() => {
    const systemCards: RoleCard[] = SYSTEM_ROLES.map(role => ({
      id: `system-${role.name}`,
      name: role.name,
      label: role.label,
      description: role.description,
      isCustom: false,
    }));

    const customCards: RoleCard[] = customRoles.map(role => ({
      id: role.id,
      name: role.name,
      label: role.name,
      description: role.description,
      isCustom: true,
      customRole: role,
    }));

    return [...systemCards, ...customCards];
  }, [customRoles]);

  const filteredRoles = allRoles.filter(role => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return true;
    return role.label.toLowerCase().includes(needle) || role.description.toLowerCase().includes(needle);
  });

  const countAssigned = (roleName: string) => staff.filter(member => {
    const primary = member.role?.toLowerCase() === roleName.toLowerCase();
    const secondary = (member.secondaryRoles || []).some(role => role.toLowerCase() === roleName.toLowerCase());
    return primary || secondary;
  }).length;

  const openRole = async (role: RoleCard) => {
    setSelectedRole(role);
    if (!profile?.tenantId) return;

    if (!role.isCustom) {
      const definition = SYSTEM_ROLES.find(item => item.name.toLowerCase() === role.name.toLowerCase());
      if (definition) setRealmPermissions(systemRoleRealmPermissions(definition));
      return;
    }

    try {
      const snap = await getDoc(doc(db, 'role_realms_of_operation', roleRealmId(profile.tenantId, role.name)));
      setRealmPermissions(normalizeCustomPermissions(snap.exists() ? snap.data().permissions : null));
    } catch (error) {
      console.error('Failed to load custom role realm', error);
      setRealmPermissions(customRoleBaselinePermissions());
      toast.error('Could not load the custom role permissions.');
    }
  };

  const handleCreateRole = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile?.tenantId || !canManageRoles || saving) return;

    const name = roleName.trim();
    if (!name) {
      toast.error('Role name is required.');
      return;
    }
    if (isSystemRoleName(name) || customRoles.some(role => role.name.toLowerCase() === name.toLowerCase())) {
      toast.error('A system or custom role with that name already exists.');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const created = await addDoc(collection(db, 'hr_roles'), {
        tenantId: profile.tenantId,
        name,
        description: roleDescription.trim(),
        isCustom: true,
        created_at: now,
        created_by: profile.full_name || profile.email || profile.id,
        updated_at: now,
        updated_by: profile.full_name || profile.email || profile.id,
      });

      const permissions = customRoleBaselinePermissions();
      await setDoc(doc(db, 'role_realms_of_operation', roleRealmId(profile.tenantId, name)), {
        tenantId: profile.tenantId,
        roleName: name,
        roleLabel: name,
        roleType: 'custom',
        isSystemRole: false,
        immutable: false,
        schemaVersion: RBAC_SCHEMA_VERSION,
        permissions,
        updatedAt: now,
        updatedBy: profile.full_name || profile.email || profile.id,
      });

      await addDoc(collection(db, 'global_audit_logs'), {
        tenantId: profile.tenantId,
        action: 'RBAC_CUSTOM_ROLE_CREATED',
        category: 'SECURITY',
        description: `Custom role ${name} created by IT personnel.`,
        timestamp: now,
        actor: profile.email || profile.full_name || profile.id,
        objectId: created.id,
      });

      setCreateOpen(false);
      setRoleName('');
      setRoleDescription('');
      toast.success(`Custom role "${name}" created. Configure its realm of operation next.`);
    } catch (error) {
      console.error('Failed to create custom role', error);
      toast.error('Failed to create the custom role.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRealm = async () => {
    if (!profile?.tenantId || !selectedRole?.isCustom || !canManageRoles || saving) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const safePermissions = normalizeCustomPermissions(realmPermissions);
      await setDoc(doc(db, 'role_realms_of_operation', roleRealmId(profile.tenantId, selectedRole.name)), {
        tenantId: profile.tenantId,
        roleName: selectedRole.name,
        roleLabel: selectedRole.label,
        roleType: 'custom',
        isSystemRole: false,
        immutable: false,
        schemaVersion: RBAC_SCHEMA_VERSION,
        permissions: safePermissions,
        updatedAt: now,
        updatedBy: profile.full_name || profile.email || profile.id,
      }, { merge: true });

      if (selectedRole.customRole) {
        await setDoc(doc(db, 'hr_roles', selectedRole.customRole.id), {
          updated_at: now,
          updated_by: profile.full_name || profile.email || profile.id,
        }, { merge: true });
      }

      await addDoc(collection(db, 'global_audit_logs'), {
        tenantId: profile.tenantId,
        action: 'RBAC_CUSTOM_ROLE_PERMISSIONS_UPDATED',
        category: 'SECURITY',
        description: `Realm of operation updated for custom role ${selectedRole.name}.`,
        timestamp: now,
        actor: profile.email || profile.full_name || profile.id,
        objectId: selectedRole.id,
      });

      setRealmPermissions(safePermissions);
      toast.success(`Realm of operation for "${selectedRole.name}" saved.`);
    } catch (error) {
      console.error('Failed to save custom role permissions', error);
      toast.error('Failed to save the custom role permissions.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async (role: RoleCard) => {
    if (!profile?.tenantId || !role.isCustom || !role.customRole || !canManageRoles) return;
    const assigned = countAssigned(role.name);
    if (assigned > 0) {
      toast.error(`Cannot delete "${role.name}" because ${assigned} staff account(s) use it as a primary or secondary role.`);
      return;
    }
    if (!window.confirm(`Delete the custom role "${role.name}" and its realm of operation?`)) return;

    try {
      const now = new Date().toISOString();
      await deleteDoc(doc(db, 'role_realms_of_operation', roleRealmId(profile.tenantId, role.name)));
      await deleteDoc(doc(db, 'hr_roles', role.customRole.id));
      await addDoc(collection(db, 'global_audit_logs'), {
        tenantId: profile.tenantId,
        action: 'RBAC_CUSTOM_ROLE_DELETED',
        category: 'SECURITY',
        description: `Custom role ${role.name} deleted by IT personnel.`,
        timestamp: now,
        actor: profile.email || profile.full_name || profile.id,
        objectId: role.customRole.id,
      });
      if (selectedRole?.id === role.id) setSelectedRole(null);
      toast.success(`Custom role "${role.name}" deleted.`);
    } catch (error) {
      console.error('Failed to delete custom role', error);
      toast.error('Failed to delete the custom role.');
    }
  };

  const setModuleAccess = (moduleId: RbacModuleKey, accessLevel: RealmAccessLevel) => {
    if (!selectedRole?.isCustom || !canManageRoles) return;
    if (moduleId === 'dashboard' || moduleId === 'welfare') return;
    setRealmPermissions(previous => ({
      ...previous,
      [moduleId]: {
        ...(previous[moduleId] || customRoleBaselinePermissions()[moduleId]),
        accessLevel,
        scope: 'assigned_branches',
      },
    }));
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-indigo-100 bg-indigo-50/60 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 text-indigo-600" size={20} />
          <div>
            <h3 className="font-black text-slate-900">Constitutional access baseline</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Every authenticated tenant account receives the Opening Dashboard and Welfare Portal. System roles are generated by PharmHelm and cannot be edited by a tenant. IT personnel may create custom operational roles and define every other module as Functional, View only, or No access. Branch visibility continues to follow the staff member's assigned branches.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard label="System-generated roles" value={SYSTEM_ROLES.length} icon={Shield} />
        <SummaryCard label="Custom roles" value={customRoles.length} icon={Users} />
        <SummaryCard label="Active role assignments" value={staff.length} icon={ShieldCheck} />
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900">Roles Registry</h2>
          <p className="text-sm text-slate-500">System roles are immutable. Custom roles are tenant-specific and managed by IT personnel only.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
            <input
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder="Search roles..."
              className="w-64 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          {canManageRoles && (
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
            >
              <Plus size={17} />
              New custom role
            </button>
          )}
        </div>
      </div>

      {!canManageRoles && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Lock size={17} className="mt-0.5" />
          <span>You can inspect the Roles Registry, but only IT Head or IT Support Personnel may create, change or delete custom role definitions.</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {filteredRoles.map(role => (
          <div key={role.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-black text-slate-900">{role.label}</h3>
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider',
                    role.isCustom ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'
                  )}>
                    {role.isCustom ? 'Custom' : 'System generated'}
                  </span>
                  {!role.isCustom && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      <Lock size={10} /> Immutable
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-5 text-slate-500">{role.description || 'Tenant-defined operational role.'}</p>
                <p className="mt-3 text-xs font-bold text-slate-400">{countAssigned(role.name)} staff assignment(s)</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => void openRole(role)}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Eye size={14} />
                  {role.isCustom && canManageRoles ? 'Configure' : 'View'}
                </button>
                {role.isCustom && canManageRoles && (
                  <button
                    onClick={() => void handleDeleteRole(role)}
                    className="rounded-xl p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="Delete custom role"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <form onSubmit={handleCreateRole} className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h3 className="text-xl font-black text-slate-900">Create custom role</h3>
                <p className="mt-1 text-sm text-slate-500">The role name becomes immutable after creation so existing staff assignments cannot silently break.</p>
              </div>
              <button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-500">Role name</label>
                <input required value={roleName} onChange={event => setRoleName(event.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-500">Description</label>
                <textarea value={roleDescription} onChange={event => setRoleDescription(event.target.value)} rows={3} className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setCreateOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button disabled={saving} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Creating...' : 'Create role'}</button>
            </div>
          </form>
        </div>
      )}

      {selectedRole && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-7 py-6">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-black text-slate-900">{selectedRole.label}</h3>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black uppercase', selectedRole.isCustom ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600')}>
                    {selectedRole.isCustom ? 'Custom role' : 'System role'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedRole.isCustom ? 'Realm of operation. Dashboard and Welfare are universal and cannot be removed.' : 'Read-only system-generated permission profile.'}
                </p>
              </div>
              <button onClick={() => setSelectedRole(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={19} /></button>
            </div>

            <div className="overflow-y-auto px-7 py-5">
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="grid grid-cols-[1.4fr_1fr] bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <span>Module</span>
                  <span>Realm of operation</span>
                </div>
                {RBAC_MODULES.map(module => {
                  const lockedBaseline = module.id === 'dashboard' || module.id === 'welfare';
                  const permission = realmPermissions[module.id] || customRoleBaselinePermissions()[module.id];
                  const displayedLevel = permission.accessLevel === 'all' ? 'view_functional' : permission.accessLevel;
                  return (
                    <div key={module.id} className="grid grid-cols-[1.4fr_1fr] items-center gap-4 border-t border-slate-100 px-4 py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-slate-800">{module.name}</p>
                          {lockedBaseline && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-black uppercase text-indigo-700">Universal</span>}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400">{module.description}</p>
                      </div>
                      {selectedRole.isCustom && canManageRoles ? (
                        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                          {(['none', 'view_only', 'view_functional'] as RealmAccessLevel[]).map(level => {
                            const disabled = lockedBaseline && level !== displayedLevel;
                            return (
                              <button
                                key={level}
                                type="button"
                                disabled={disabled}
                                onClick={() => setModuleAccess(module.id, level)}
                                className={cn(
                                  'flex-1 rounded-lg px-2 py-1.5 text-[10px] font-black transition-all',
                                  displayedLevel === level ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-700',
                                  disabled && 'cursor-not-allowed opacity-30'
                                )}
                              >
                                {ACCESS_LABELS[level]}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                          {displayedLevel === 'none' ? <X className="text-slate-400" size={15} /> : displayedLevel === 'view_only' ? <Eye className="text-blue-500" size={15} /> : <Check className="text-emerald-600" size={15} />}
                          {ACCESS_LABELS[displayedLevel]}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {selectedRole.isCustom && (
                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-slate-500" />
                  Functional access permits normal operations inside that module but does not automatically grant reserved approvals, executive overrides, cross-tenant access, or branches not assigned to the staff account. Existing transaction-specific approval checks continue to apply.
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 px-7 py-5">
              <button onClick={() => setSelectedRole(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600">Close</button>
              {selectedRole.isCustom && canManageRoles && (
                <button onClick={() => void handleSaveRealm()} disabled={saving} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  <Save size={16} />
                  {saving ? 'Saving...' : 'Save realm'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: number; icon: React.ComponentType<{ size?: number; className?: string }> }> = ({ label, value, icon: Icon }) => (
  <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
    </div>
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-slate-500">
      <Icon size={19} />
    </div>
  </div>
);
