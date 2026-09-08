import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, value) => fs.writeFileSync(path, value);

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return text.replace(from, to);
}

function replaceRegexOnce(text, regex, to, label) {
  const matches = [...text.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one match, found ${matches.length}`);
  return text.replace(regex, to);
}

// PlatformAdmin: make subscription tier commercial-only, harden branch limits/trials,
// and retain the existing deletion reauthentication pattern for sensitive writes.
{
  const path = 'src/pages/PlatformAdmin.tsx';
  let text = read(path);

  text = replaceOnce(
    text,
    "import { deduplicateStaff } from '../utils/deduplicateStaff';\n",
    "import { deduplicateStaff } from '../utils/deduplicateStaff';\nimport { getDefaultBranchLimit, isTrialExpired, isValidBranchLimit } from '../utils/subscriptionEntitlements';\n",
    'PlatformAdmin helper import'
  );

  text = replaceOnce(
    text,
    "        subscription_status: 'inactive',\n        subscription_start: '',\n        subscription_end: '',\n        modules_enabled: ['inventory', 'sales', 'finance', 'hr', 'logistics'],\n        status: 'active',",
    "        subscription_status: 'inactive',\n        subscription_start: '',\n        subscription_end: '',\n        branchLimit: getDefaultBranchLimit(formData.subscription_tier),\n        branchLimitSource: 'tier_default',\n        branchLimitManuallyOverridden: false,\n        modules_enabled: ['dashboard', 'pos', 'inventory', 'clients', 'procurement', 'finance', 'hr', 'logistics', 'qa', 'predictive', 'marketing', 'settings'],\n        status: 'active',",
    'Tenant creation defaults'
  );

  text = replaceRegexOnce(
    text,
    /      } else if \(reauthAction === 'updateBranchLimit'\) \{[\s\S]*?      } else if \(reauthAction === 'grantTrial'\) \{/,
    `      } else if (reauthAction === 'updateBranchLimit') {
        const payload = reauthPayload || {};
        if (!isValidBranchLimit(payload.newLimit)) {
          throw new Error('Branch limit must be a whole number of zero or greater.');
        }
        const tenantRef = doc(db, 'tenants', reauthTenant.id);
        const oldLimit = typeof reauthTenant.branchLimit === 'number' ? reauthTenant.branchLimit : null;
        const changedAt = new Date().toISOString();
        const actor = auth.currentUser?.uid || 'system';
        await updateDoc(tenantRef, {
          branchLimit: payload.newLimit,
          branchLimitSource: payload.resetToTierDefault ? 'tier_default' : 'manual',
          branchLimitManuallyOverridden: !payload.resetToTierDefault,
          branchLimitUpdatedAt: changedAt,
          branchLimitUpdatedBy: actor
        });
        await addDoc(collection(db, 'global_audit_logs'), {
          action: 'BRANCH_LIMIT_CHANGED',
          category: 'TENANT',
          description: \`Changed branchLimit from \${oldLimit ?? 'unset'} to \${payload.newLimit}\`,
          oldValue: {
            branchLimit: oldLimit,
            branchLimitSource: reauthTenant.branchLimitSource || null,
            branchLimitManuallyOverridden: reauthTenant.branchLimitManuallyOverridden === true
          },
          newValue: {
            branchLimit: payload.newLimit,
            branchLimitSource: payload.resetToTierDefault ? 'tier_default' : 'manual',
            branchLimitManuallyOverridden: !payload.resetToTierDefault
          },
          timestamp: changedAt,
          tenantId: reauthTenant.id,
          actor,
          ipAddress: 'client-side',
          device: window.navigator.userAgent || 'web'
        });
        toast.success(\`Branch limit updated to \${payload.newLimit} for \${reauthTenant.name}\`);
      } else if (reauthAction === 'grantTrial') {`,
    'Branch limit reauth handler'
  );

  text = replaceRegexOnce(
    text,
    /      } else if \(reauthAction === 'grantTrial'\) \{[\s\S]*?      } else if \(reauthAction === 'grantComplimentary'\) \{/,
    `      } else if (reauthAction === 'grantTrial') {
        const payload = reauthPayload || {};
        if (!isValidBranchLimit(payload.trialBranchLimit) || payload.trialBranchLimit < 1) {
          throw new Error('Trial branch limit must be at least 1.');
        }
        const tenantRef = doc(db, 'tenants', reauthTenant.id);
        const actor = auth.currentUser?.uid || 'system';
        const grantedAt = new Date().toISOString();
        const trialStatus = {
          isTrial: true,
          trialBranchLimit: payload.trialBranchLimit,
          trialStartDate: payload.trialStartDate,
          trialEndDate: payload.trialEndDate,
          grantedBy: actor,
          grantedAt,
          notes: payload.notes || '',
          previousBranchLimit: typeof reauthTenant.branchLimit === 'number' ? reauthTenant.branchLimit : null,
          previousBranchLimitSource: reauthTenant.branchLimitSource || null,
          previousBranchLimitManuallyOverridden: reauthTenant.branchLimitManuallyOverridden === true,
          previousSubscriptionStatus: reauthTenant.subscription_status || 'inactive'
        };
        await updateDoc(tenantRef, {
          trialStatus,
          subscription_status: 'trial',
          branchLimit: payload.trialBranchLimit,
          branchLimitSource: 'trial',
          branchLimitManuallyOverridden: false,
          branchLimitUpdatedAt: grantedAt,
          branchLimitUpdatedBy: actor
        });
        await addDoc(collection(db, 'global_audit_logs'), {
          action: 'TRIAL_GRANTED',
          category: 'TENANT',
          description: \`Trial granted: branchLimit=\${payload.trialBranchLimit}, end=\${payload.trialEndDate}\`,
          oldValue: {
            trialStatus: reauthTenant.trialStatus || null,
            branchLimit: typeof reauthTenant.branchLimit === 'number' ? reauthTenant.branchLimit : null,
            subscriptionStatus: reauthTenant.subscription_status || null
          },
          newValue: {
            trialStatus,
            branchLimit: payload.trialBranchLimit,
            subscriptionStatus: 'trial'
          },
          timestamp: grantedAt,
          tenantId: reauthTenant.id,
          actor,
          ipAddress: 'client-side',
          device: window.navigator.userAgent || 'web'
        });
        toast.success(\`Trial access granted for \${reauthTenant.name}\`);
      } else if (reauthAction === 'grantComplimentary') {`,
    'Trial reauth handler'
  );

  text = replaceRegexOnce(
    text,
    /      } else if \(reauthAction === 'grantComplimentary'\) \{[\s\S]*?        toast\.success\(`Complimentary period granted for \$\{reauthTenant\.name}`\);\n      }/,
    `      } else if (reauthAction === 'grantComplimentary') {
        const payload = reauthPayload || {};
        const tenantRef = doc(db, 'tenants', reauthTenant.id);
        const actor = auth.currentUser?.uid || 'system';
        const grantedAt = new Date().toISOString();
        const complimentaryPeriod = {
          isActive: true,
          startDate: payload.startDate,
          endDate: payload.endDate,
          reason: payload.reason || '',
          grantedBy: actor,
          grantedAt
        };
        await updateDoc(tenantRef, { complimentaryPeriod });
        await addDoc(collection(db, 'global_audit_logs'), {
          action: 'COMPLIMENTARY_PERIOD_GRANTED',
          category: 'TENANT',
          description: \`Complimentary period granted: \${payload.startDate} to \${payload.endDate} - \${payload.reason}\`,
          oldValue: reauthTenant.complimentaryPeriod || null,
          newValue: complimentaryPeriod,
          timestamp: grantedAt,
          tenantId: reauthTenant.id,
          actor,
          ipAddress: 'client-side',
          device: window.navigator.userAgent || 'web'
        });
        toast.success(\`Complimentary period granted for \${reauthTenant.name}\`);
      } else if (reauthAction === 'deactivateExpiredTrial') {
        const tenantRef = doc(db, 'tenants', reauthTenant.id);
        const actor = auth.currentUser?.uid || 'system';
        const changedAt = new Date().toISOString();
        await updateDoc(tenantRef, {
          status: 'inactive',
          subscription_status: 'expired',
          trialStatus: {
            ...(reauthTenant.trialStatus || {}),
            isTrial: false,
            deactivatedAt: changedAt,
            deactivatedBy: actor
          }
        });
        await addDoc(collection(db, 'global_audit_logs'), {
          action: 'EXPIRED_TRIAL_TENANT_DEACTIVATED',
          category: 'TENANT',
          description: 'Expired trial tenant manually deactivated by superadmin.',
          oldValue: { status: reauthTenant.status, subscriptionStatus: reauthTenant.subscription_status, trialStatus: reauthTenant.trialStatus || null },
          newValue: { status: 'inactive', subscriptionStatus: 'expired', trialActive: false },
          timestamp: changedAt,
          tenantId: reauthTenant.id,
          actor,
          ipAddress: 'client-side',
          device: window.navigator.userAgent || 'web'
        });
        toast.success(\`\${reauthTenant.name} has been deactivated.\`);
      }`,
    'Complimentary and expired trial handler'
  );

  text = replaceOnce(
    text,
    "        subscription_end: subEndDate,\n        status: 'active'\n      });",
    "        subscription_end: subEndDate,\n        status: 'active',\n        ...(tenantToUpdate.trialStatus?.isTrial ? {\n          trialStatus: {\n            ...tenantToUpdate.trialStatus,\n            isTrial: false,\n            convertedAt: new Date().toISOString(),\n            convertedBy: auth.currentUser?.uid || 'system'\n          },\n          branchLimitSource: tenantToUpdate.branchLimitSource === 'trial' ? 'manual' : tenantToUpdate.branchLimitSource,\n          branchLimitManuallyOverridden: tenantToUpdate.branchLimitSource === 'trial' ? true : tenantToUpdate.branchLimitManuallyOverridden\n        } : {})\n      });",
    'Paid activation trial conversion'
  );

  text = replaceOnce(
    text,
    "        } else if (reauthAction === 'grantComplimentary') {\n          title = 'Confirm Complimentary Period';\n          desc = <span>Please verify your credentials to grant a complimentary period for <strong>{reauthTenant?.name}</strong>.</span>;\n          iconColor = 'bg-emerald-50 text-emerald-600';\n          btnColor = 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20';\n          btnText = reauthSaving ? 'Granting...' : 'Confirm Grant';\n        }",
    "        } else if (reauthAction === 'grantComplimentary') {\n          title = 'Confirm Complimentary Period';\n          desc = <span>Please verify your credentials to grant a complimentary period for <strong>{reauthTenant?.name}</strong>.</span>;\n          iconColor = 'bg-emerald-50 text-emerald-600';\n          btnColor = 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20';\n          btnText = reauthSaving ? 'Granting...' : 'Confirm Grant';\n        } else if (reauthAction === 'deactivateExpiredTrial') {\n          title = 'Confirm Trial Deactivation';\n          desc = <span>Please verify your credentials to deactivate expired trial tenant <strong>{reauthTenant?.name}</strong>.</span>;\n          iconColor = 'bg-red-50 text-red-600';\n          btnColor = 'bg-red-600 hover:bg-red-700 shadow-red-500/20';\n          btnText = reauthSaving ? 'Deactivating...' : 'Confirm Deactivation';\n        }",
    'Expired trial reauth modal label'
  );

  text = replaceOnce(
    text,
    "        <EditTenantModal \n          tenant={editingTenant}\n          platformEmail={platformProfile?.email || ''}",
    "        <EditTenantModal \n          tenant={editingTenant}\n          platformEmail={platformProfile?.email || ''}\n          onOpenSubscription={() => {\n            setSelectedTenantForSub(editingTenant.id);\n            setEditingTenant(null);\n            setActiveTab('subscriptions');\n          }}",
    'EditTenantModal paid conversion callback'
  );

  text = replaceOnce(
    text,
    "const EditTenantModal = ({ tenant, platformEmail, onClose, onSuccess, onRequestReauth }: { tenant: Tenant, platformEmail: string, onClose: () => void, onSuccess: () => void, onRequestReauth: (action: string, payload: any) => void }) => {",
    "const EditTenantModal = ({ tenant, platformEmail, onClose, onSuccess, onRequestReauth, onOpenSubscription }: { tenant: Tenant, platformEmail: string, onClose: () => void, onSuccess: () => void, onRequestReauth: (action: string, payload: any) => void, onOpenSubscription: () => void }) => {",
    'EditTenantModal callback signature'
  );

  text = replaceOnce(
    text,
    "  const [loadingPredictive, setLoadingPredictive] = useState(false);\n",
    "  const [loadingPredictive, setLoadingPredictive] = useState(false);\n  const trialExpired = isTrialExpired(tenant.trialStatus);\n",
    'Trial expiry state'
  );

  text = replaceOnce(
    text,
    "          <form onSubmit={handleSubmit} className=\"p-8 space-y-6 max-h-[70vh] overflow-y-auto\">\n          <div className=\"grid grid-cols-3 gap-6\">",
    "          <form onSubmit={handleSubmit} className=\"p-8 space-y-6 max-h-[70vh] overflow-y-auto\">\n          {trialExpired && (\n            <div className=\"rounded-2xl border border-red-200 bg-red-50 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4\">\n              <div>\n                <p className=\"text-xs font-black tracking-widest text-red-700\">TRIAL EXPIRED</p>\n                <p className=\"text-xs text-red-600 mt-1\">The evaluation period has ended. Access remains unchanged until a superadmin makes a decision.</p>\n              </div>\n              <div className=\"flex gap-2\">\n                <button type=\"button\" onClick={onOpenSubscription} className=\"px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold\">Convert to Paid Subscription</button>\n                <button type=\"button\" onClick={() => onRequestReauth('deactivateExpiredTrial', {})} className=\"px-3 py-2 bg-red-600 text-white rounded-xl text-xs font-bold\">Deactivate Tenant</button>\n              </div>\n            </div>\n          )}\n          <div className=\"grid grid-cols-3 gap-6\">",
    'Trial expired banner'
  );

  text = replaceOnce(
    text,
    "                    const tierDefault = tenant.subscription_tier === 'basic' ? 1 : (tenant.subscription_tier === 'standard' ? 5 : 15);\n                    const newLimit = resetToTierDefault ? tierDefault : branchLimitInput;\n                    onRequestReauth('updateBranchLimit', { oldLimit: tenant.branchLimit ?? null, newLimit });",
    "                    const tierDefault = getDefaultBranchLimit(formData.subscription_tier);\n                    const newLimit = resetToTierDefault ? tierDefault : branchLimitInput;\n                    if (!isValidBranchLimit(newLimit)) { toast.error('Branch limit must be a whole number of zero or greater'); return; }\n                    onRequestReauth('updateBranchLimit', { oldLimit: tenant.branchLimit ?? null, newLimit, resetToTierDefault });",
    'Branch limit save validation'
  );

  text = replaceOnce(
    text,
    "              <p className=\"text-xs text-zinc-400\">Current branches: {branchCount ?? '—'} • Tier default: {tenant.subscription_tier === 'basic' ? 1 : tenant.subscription_tier === 'standard' ? 5 : 15}</p>",
    "              <p className=\"text-xs text-zinc-400\">Current branches: {branchCount ?? '—'} • Tier default: {getDefaultBranchLimit(formData.subscription_tier)} • Source: {tenant.branchLimitSource || 'legacy/default'}</p>",
    'Branch limit detail copy'
  );

  write(path, text);
}

// Tenant schema: subscription tier no longer grants features, branchLimit is the actual cap.
{
  const path = 'src/types.ts';
  let text = read(path);
  text = replaceOnce(
    text,
    "  branchLimit?: number;\n  status: 'active' | 'inactive' | 'suspended' | 'deleted';",
    `  branchLimit?: number;
  branchLimitSource?: 'tier_default' | 'manual' | 'trial';
  branchLimitManuallyOverridden?: boolean;
  branchLimitUpdatedAt?: string;
  branchLimitUpdatedBy?: string;
  trialStatus?: {
    isTrial: boolean;
    trialBranchLimit: number;
    trialStartDate: string;
    trialEndDate: string;
    grantedBy: string;
    grantedAt: string;
    notes?: string;
    previousBranchLimit?: number | null;
    previousBranchLimitSource?: 'tier_default' | 'manual' | 'trial' | null;
    previousBranchLimitManuallyOverridden?: boolean;
    previousSubscriptionStatus?: string;
    convertedAt?: string;
    convertedBy?: string;
    deactivatedAt?: string;
    deactivatedBy?: string;
  };
  complimentaryPeriod?: {
    isActive: boolean;
    startDate: string;
    endDate: string;
    reason: string;
    grantedBy: string;
    grantedAt: string;
  };
  status: 'active' | 'inactive' | 'suspended' | 'deleted';`,
    'Tenant entitlement schema'
  );
  write(path, text);
}

// Branch creation: preserve CEO/owner RBAC and layer current-count vs branchLimit check on top.
{
  const path = 'src/modules/hr/BranchManager.tsx';
  let text = read(path);
  text = replaceOnce(
    text,
    "import { hasAnyRole } from '../../utils/roles';\n",
    "import { hasAnyRole } from '../../utils/roles';\nimport { resolveBranchLimit } from '../../utils/subscriptionEntitlements';\n",
    'BranchManager entitlement import'
  );

  text = replaceOnce(
    text,
    "        // Enforce configurable branch limit: prefer tenant.branchLimit, otherwise fall back to tier defaults (basic=1, standard=5, enterprise/premium=15)\n        const tierDefault = tenant?.subscription_tier === 'basic' ? 1 : (tenant?.subscription_tier === 'standard' ? 5 : 15);\n        const maxBranches = typeof tenant?.branchLimit === 'number' ? tenant.branchLimit : tierDefault;\n        if (branches.length >= maxBranches) {\n          toast.error(`Branch limit reached (${branches.length} of ${maxBranches}). Contact PharmHelm support to increase your limit.`);",
    "        // Additive commercial entitlement check. RBAC above remains unchanged.\n        // Re-read tenant-scoped branch records at submission time instead of trusting a potentially stale UI subscription.\n        const currentBranches = await firestoreService.getCollection<Branch>('branches', profile.tenantId);\n        const currentBranchCount = currentBranches.length;\n        const maxBranches = resolveBranchLimit(tenant?.branchLimit, tenant?.subscription_tier);\n        if (currentBranchCount >= maxBranches) {\n          toast.error(`Branch limit reached (${currentBranchCount} of ${maxBranches}). Contact PharmHelm support to increase your limit.`);",
    'Fresh branch count enforcement'
  );

  text = replaceOnce(
    text,
    "    try {\n      for (const branch of defaults) {\n        const exists = branches.some(b => b.type === branch.type);\n        if (!exists) {",
    "    try {\n      for (const branch of defaults) {\n        const currentBranches = await firestoreService.getCollection<Branch>('branches', profile.tenantId);\n        const maxBranches = resolveBranchLimit(tenant?.branchLimit, tenant?.subscription_tier);\n        if (currentBranches.length >= maxBranches) {\n          toast.error(`Branch limit reached (${currentBranches.length} of ${maxBranches}). Contact PharmHelm support to increase your limit.`);\n          break;\n        }\n        const exists = currentBranches.some(b => b.type === branch.type);\n        if (!exists) {",
    'Default branch seeding entitlement check'
  );
  write(path, text);
}

// Seed data: mark default branch limit provenance explicitly.
{
  const path = 'src/services/seedService.ts';
  let text = read(path);
  text = replaceOnce(
    text,
    "      // Set branchLimit according to tier defaults: enterprise -> 15\n      branchLimit: 15,",
    "      // Enterprise is the canonical stored tier; every tier has the full application.\n      // Tier only seeds the initial branch entitlement.\n      branchLimit: 15,\n      branchLimitSource: 'tier_default' as const,\n      branchLimitManuallyOverridden: false,",
    'Seed branch limit provenance'
  );
  write(path, text);
}

// Remove stale subscription-gating imports left behind after earlier entitlement removal.
for (const [path, extra] of [
  ['src/pages/Marketing.tsx', true],
  ['src/pages/Predictive.tsx', true],
  ['src/pages/Finance.tsx', false]
]) {
  let text = read(path);
  text = text.replace("import { useTenant } from '../contexts/TenantContext';\n", '');
  text = text.replace("import { UpgradeRequiredCard } from '../components/UpgradeRequiredCard';\n", '');
  if (extra) text = text.replace("  const { tenant } = useTenant();\n", '');
  write(path, text);
}

console.log('TMC subscription refactor applied successfully.');
