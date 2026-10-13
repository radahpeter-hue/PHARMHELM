import test from 'node:test';
import assert from 'node:assert/strict';
import { completeOperationalIdentityRelease } from '../scripts/operational-identity-release-core.mjs';
const fixture = (options: any = {}) => {
  let status = options.ready ? 'READY' : null;
  let settings = {enabled:options.enabled ?? true,version:options.resume ? 'frozen' : 'original'};
  const calls: unknown[] = [];
  return { calls, get settings(){return settings;}, dependencies: {
    getState: async () => ({status,...(options.resume ? {enabledBeforeBackfill:true,settingsFrozenVersion:'frozen'} : {})}), getSettings: async () => settings,
    setEnabled: async (enabled: boolean, version: string) => {
      assert.equal(version,settings.version); calls.push(enabled);
      settings = {enabled,version:enabled?'restored':'frozen'}; return settings;
    },
    runBackfill: async () => {
      assert.equal(settings.enabled,false); calls.push('backfill');
      if(options.adminChange) settings={enabled:false,version:'admin-change'};
      if(options.fail) throw new Error('conflicting identities');
      status='READY';
    }
  }};
};
test('release freezes Operational writes, applies backfill and restores the prior toggle', async () => {
  const f=fixture(); assert.deepEqual(await completeOperationalIdentityRelease(f.dependencies),{alreadyReady:false,restored:true});
  assert.deepEqual(f.calls,[false,'backfill',true]);
});
test('failed backfill restores the frozen settings without claiming success', async () => {
  const f=fixture({fail:true}); await assert.rejects(completeOperationalIdentityRelease(f.dependencies),/conflicting identities/);
  assert.equal(f.settings.enabled,true);
});
test('a completed release is idempotent and does not toggle the tenant again', async () => {
  const f=fixture({ready:true}); assert.equal((await completeOperationalIdentityRelease(f.dependencies)).alreadyReady,true);
  assert.deepEqual(f.calls,[]);
});
test('release never overwrites a concurrent administrator setting change', async () => {
  const f=fixture({adminChange:true}); assert.equal((await completeOperationalIdentityRelease(f.dependencies)).restored,false);
  assert.equal(f.settings.version,'admin-change'); assert.deepEqual(f.calls,[false,'backfill']);
});
test('a disabled feature remains disabled after backfill', async () => {
  const f=fixture({enabled:false}); await completeOperationalIdentityRelease(f.dependencies);
  assert.equal(f.settings.enabled,false); assert.deepEqual(f.calls,['backfill']);
});
test('an interrupted toggle restoration resumes only the exact frozen settings version', async () => {
  const f=fixture({ready:true,enabled:false,resume:true});
  assert.deepEqual(await completeOperationalIdentityRelease(f.dependencies),{alreadyReady:true,restored:true});
  assert.deepEqual(f.calls,[true]);
});
