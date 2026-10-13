import { spawnSync } from 'node:child_process';
import { api, commit, firestoreBase, documentsRoot } from './firebase-rest-utils.mjs';
import { completeOperationalIdentityRelease } from './operational-identity-release-core.mjs';

// This one-time release is scoped to the Martin Pharma test tenant verified by preview.
const tenantId = 'zehqTDcKyrDAOHKK3stJ';
const actorId = `github-actions-operational-identity-${process.env.GITHUB_RUN_ID || 'manual'}`;
const settingsPath = `${documentsRoot}/system_settings/${tenantId}`;
const getState = async () => {
  try {
    const row = await api(`${firestoreBase}/operational_inventory_identity_state/${tenantId}`);
    if (row.fields?.tenantId?.stringValue !== tenantId) throw new Error('Identity state tenant mismatch.');
    return { status: row.fields?.status?.stringValue, enabledBeforeBackfill: row.fields?.enabledBeforeBackfill?.booleanValue, settingsFrozenVersion: row.fields?.settingsFrozenVersion?.stringValue };
  } catch (error) {
    if (String(error).startsWith('Error: 404 ')) return null;
    throw error;
  }
};
const getSettings = async () => {
  const row = await api(`${firestoreBase}/system_settings/${tenantId}`);
  if (row.fields?.tenantId?.stringValue !== tenantId) throw new Error('Settings tenant mismatch.');
  return { version: row.updateTime, enabled: row.fields?.featureToggles?.mapValue?.fields?.enableOperationalInventory?.booleanValue };
};
const setEnabled = async (enabled, version) => {
  const response = await commit([{ update: { name: settingsPath, fields: {
    featureToggles: { mapValue: { fields: { enableOperationalInventory: { booleanValue: enabled } } } },
    updatedBy: { stringValue: actorId }, updatedAt: { stringValue: new Date().toISOString() }
  } }, updateMask: { fieldPaths: ['featureToggles.enableOperationalInventory', 'updatedBy', 'updatedAt'] }, currentDocument: { updateTime: version } }]);
  return { enabled, version: response.writeResults[0].updateTime };
};
const runBackfill = async context => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backfill-operational-identities.mjs', `--tenant=${tenantId}`, `--actor=${actorId}`, '--apply', `--enabled-before=${context.enabledBeforeBackfill}`, `--frozen-version=${context.settingsFrozenVersion}`], { stdio: 'inherit', env: process.env });
  if (child.error || child.status !== 0) throw new Error('Operational identity backfill failed; no readiness marker was applied.');
};
console.log(JSON.stringify(await completeOperationalIdentityRelease({getState,getSettings,setEnabled,runBackfill})));
