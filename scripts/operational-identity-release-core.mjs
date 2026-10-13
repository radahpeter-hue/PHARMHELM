/** Restore only the settings version frozen by this release; never overwrite a later admin change. */
export async function completeOperationalIdentityRelease({ getState, getSettings, setEnabled, runBackfill }) {
  const existing = await getState();
  if (existing?.status === 'READY') {
    const current = await getSettings();
    const canResume = existing.enabledBeforeBackfill === true && existing.settingsFrozenVersion === current.version && current.enabled === false;
    if (canResume) await setEnabled(true, current.version);
    return { alreadyReady: true, restored: canResume };
  }
  const original = await getSettings();
  if (typeof original.enabled !== 'boolean') throw new Error('Operational feature toggle is missing or malformed.');
  const frozen = original.enabled ? await setEnabled(false, original.version) : original;
  let restored = false;
  try {
    await runBackfill({ enabledBeforeBackfill: original.enabled, settingsFrozenVersion: frozen.version });
    if ((await getState())?.status !== 'READY') throw new Error('Identity readiness was not established.');
  } finally {
    if (original.enabled) {
      const current = await getSettings();
      if (current.version === frozen.version && current.enabled === false) {
        await setEnabled(true, current.version);
        restored = true;
      }
    }
  }
  return { alreadyReady: false, restored };
}
