import fs from 'node:fs';

const path = 'src/pages/PlatformAdmin.tsx';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  text = text.replace(from, to);
}

replaceOnce(
  "import { collection, query, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, orderBy, limit, where, setDoc, onSnapshot } from 'firebase/firestore';",
  "import { collection, query, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, orderBy, limit, where, setDoc, onSnapshot, Timestamp } from 'firebase/firestore';",
  'Timestamp import'
);

replaceOnce(
  "      } else if (reauthAction === 'grantTrial') {\n        const payload = reauthPayload || {};\n        if (!isValidBranchLimit(payload.trialBranchLimit) || payload.trialBranchLimit < 1) {",
  "      } else if (reauthAction === 'grantTrial') {\n        const payload = reauthPayload || {};\n        if (!['inactive', 'unsubscribed'].includes(reauthTenant.subscription_status)) {\n          throw new Error('Trial access is only available to new or unbilled tenants.');\n        }\n        if (!isValidBranchLimit(payload.trialBranchLimit) || payload.trialBranchLimit < 1) {",
  'Trial eligibility guard'
);

replaceOnce(
  "        const grantedAt = new Date().toISOString();\n        const trialStatus = {\n          isTrial: true,\n          trialBranchLimit: payload.trialBranchLimit,\n          trialStartDate: payload.trialStartDate,\n          trialEndDate: payload.trialEndDate,\n          grantedBy: actor,\n          grantedAt,",
  "        const grantedAt = Timestamp.now();\n        const trialStatus = {\n          isTrial: true,\n          trialBranchLimit: payload.trialBranchLimit,\n          trialStartDate: Timestamp.fromDate(new Date(payload.trialStartDate)),\n          trialEndDate: Timestamp.fromDate(new Date(`${payload.trialEndDate}T23:59:59`)),\n          grantedBy: actor,\n          grantedAt,",
  'Trial Firestore timestamps'
);

replaceOnce(
  "      } else if (reauthAction === 'grantComplimentary') {\n        const payload = reauthPayload || {};\n        const tenantRef = doc(db, 'tenants', reauthTenant.id);",
  "      } else if (reauthAction === 'grantComplimentary') {\n        const payload = reauthPayload || {};\n        if (reauthTenant.subscription_status !== 'active') {\n          throw new Error('Complimentary periods are only available to active paid tenants.');\n        }\n        const tenantRef = doc(db, 'tenants', reauthTenant.id);",
  'Complimentary eligibility guard'
);

replaceOnce(
  "        const grantedAt = new Date().toISOString();\n        const complimentaryPeriod = {\n          isActive: true,\n          startDate: payload.startDate,\n          endDate: payload.endDate,\n          reason: payload.reason || '',\n          grantedBy: actor,\n          grantedAt\n        };",
  "        const grantedAt = Timestamp.now();\n        const complimentaryPeriod = {\n          isActive: true,\n          startDate: Timestamp.fromDate(new Date(`${payload.startDate}T00:00:00`)),\n          endDate: Timestamp.fromDate(new Date(`${payload.endDate}T23:59:59`)),\n          reason: payload.reason || '',\n          grantedBy: actor,\n          grantedAt\n        };",
  'Complimentary Firestore timestamps'
);

replaceOnce(
  "      await updateDoc(tenantRef, {\n        subscription_status: 'active',\n        subscription_tier: subPackage,\n        subscription_cycle: subCycle,\n        subscription_start: subStartDate,\n        subscription_end: subEndDate,\n        status: 'active',\n        ...(tenantToUpdate.trialStatus?.isTrial ? {\n          trialStatus: {\n            ...tenantToUpdate.trialStatus,\n            isTrial: false,\n            convertedAt: new Date().toISOString(),\n            convertedBy: auth.currentUser?.uid || 'system'\n          },\n          branchLimitSource: tenantToUpdate.branchLimitSource === 'trial' ? 'manual' : tenantToUpdate.branchLimitSource,\n          branchLimitManuallyOverridden: tenantToUpdate.branchLimitSource === 'trial' ? true : tenantToUpdate.branchLimitManuallyOverridden\n        } : {})\n      });",
  "      const convertingTrial = tenantToUpdate.trialStatus?.isTrial === true;\n      const conversionTimestamp = new Date().toISOString();\n      const restoredBranchLimit = convertingTrial\n        ? (typeof tenantToUpdate.trialStatus?.previousBranchLimit === 'number'\n          ? tenantToUpdate.trialStatus.previousBranchLimit\n          : getDefaultBranchLimit(subPackage))\n        : tenantToUpdate.branchLimit;\n      const restoredBranchLimitSource = convertingTrial\n        ? (tenantToUpdate.trialStatus?.previousBranchLimitSource || 'tier_default')\n        : tenantToUpdate.branchLimitSource;\n      const restoredManualOverride = convertingTrial\n        ? (tenantToUpdate.trialStatus?.previousBranchLimitManuallyOverridden === true)\n        : tenantToUpdate.branchLimitManuallyOverridden;\n\n      await updateDoc(tenantRef, {\n        subscription_status: 'active',\n        subscription_tier: subPackage,\n        subscription_cycle: subCycle,\n        subscription_start: subStartDate,\n        subscription_end: subEndDate,\n        status: 'active',\n        ...(convertingTrial ? {\n          trialStatus: {\n            ...tenantToUpdate.trialStatus,\n            isTrial: false,\n            convertedAt: conversionTimestamp,\n            convertedBy: auth.currentUser?.uid || 'system'\n          },\n          branchLimit: restoredBranchLimit,\n          branchLimitSource: restoredBranchLimitSource,\n          branchLimitManuallyOverridden: restoredManualOverride,\n          branchLimitUpdatedAt: conversionTimestamp,\n          branchLimitUpdatedBy: auth.currentUser?.uid || 'system'\n        } : {})\n      });\n\n      if (convertingTrial) {\n        await addDoc(collection(db, 'global_audit_logs'), {\n          action: 'TRIAL_CONVERTED_TO_PAID',\n          category: 'TENANT',\n          description: `Trial converted to paid ${subPackage} subscription.`,\n          oldValue: {\n            subscriptionStatus: tenantToUpdate.subscription_status,\n            trialStatus: tenantToUpdate.trialStatus,\n            branchLimit: tenantToUpdate.branchLimit\n          },\n          newValue: {\n            subscriptionStatus: 'active',\n            subscriptionTier: subPackage,\n            trialActive: false,\n            branchLimit: restoredBranchLimit,\n            branchLimitSource: restoredBranchLimitSource\n          },\n          tenantId: tenantToUpdate.id,\n          actor: auth.currentUser?.uid || 'system',\n          timestamp: conversionTimestamp,\n          ipAddress: 'client-side',\n          device: window.navigator.userAgent || 'web'\n        });\n      }",
  'Trial conversion restoration'
);

replaceOnce(
  "              {!showTrialForm ? (\n                <div className=\"flex gap-2\">\n                  <button type=\"button\" onClick={() => setShowTrialForm(true)} className=\"px-3 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold\">Grant Trial Access</button>\n                </div>\n              ) : (",
  "              {!['inactive', 'unsubscribed'].includes(tenant.subscription_status) ? (\n                <p className=\"text-xs text-zinc-400\">Available only for new or unbilled tenants.</p>\n              ) : !showTrialForm ? (\n                <div className=\"flex gap-2\">\n                  <button type=\"button\" onClick={() => setShowTrialForm(true)} className=\"px-3 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold\">Grant Trial Access</button>\n                </div>\n              ) : (",
  'Trial UI eligibility'
);

replaceOnce(
  "              {!showComplimentaryForm ? (\n                <div className=\"flex gap-2\">\n                  <button type=\"button\" onClick={() => setShowComplimentaryForm(true)} className=\"px-3 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold\">Grant Complimentary Period</button>\n                </div>\n              ) : (",
  "              {tenant.subscription_status !== 'active' ? (\n                <p className=\"text-xs text-zinc-400\">Available only for active paid tenants.</p>\n              ) : !showComplimentaryForm ? (\n                <div className=\"flex gap-2\">\n                  <button type=\"button\" onClick={() => setShowComplimentaryForm(true)} className=\"px-3 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold\">Grant Complimentary Period</button>\n                </div>\n              ) : (",
  'Complimentary UI eligibility'
);

fs.writeFileSync(path, text);

const typesPath = 'src/types.ts';
let types = fs.readFileSync(typesPath, 'utf8');
const dateFieldReplacements = [
  ['    trialStartDate: string;', '    trialStartDate: string | { toDate: () => Date };'],
  ['    trialEndDate: string;', '    trialEndDate: string | { toDate: () => Date };'],
  ['    grantedAt: string;', '    grantedAt: string | { toDate: () => Date };'],
  ['    startDate: string;', '    startDate: string | { toDate: () => Date };'],
  ['    endDate: string;', '    endDate: string | { toDate: () => Date };']
];
for (const [from, to] of dateFieldReplacements) {
  if (!types.includes(from)) throw new Error(`types: missing ${from}`);
  types = types.replace(from, to);
}
fs.writeFileSync(typesPath, types);

console.log('Final TMC subscription hardening applied.');
