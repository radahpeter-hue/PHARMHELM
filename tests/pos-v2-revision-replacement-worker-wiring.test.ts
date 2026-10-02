import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync('scripts/process-pos-v2-revision-replacements.mjs', 'utf8');

test('replacement linkage worker watches only replacement-pending revision requests', () => {
  assert.match(worker, /pos_sale_revision_requests/);
  assert.match(worker, /where\('status', '==', 'REPLACEMENT_PENDING'\)/);
  assert.doesNotMatch(worker, /REVERSAL_PENDING/);
});

test('worker waits harmlessly until the canonical replacement checkout exists', () => {
  assert.match(worker, /AWAITING_REPLACEMENT_CHECKOUT/);
  assert.match(worker, /db\.collection\('sales'\)\.doc\(replacementSaleId\)\.get\(\)/);

  const readinessCall = worker.indexOf('const readiness = await replacementExists(ref);');
  const finalizeCall = worker.indexOf('const result = await finalizeRevisionReplacementLinkage');
  assert.ok(readinessCall >= 0, 'replacement readiness check must be present in the worker loop');
  assert.ok(finalizeCall >= 0, 'replacement linkage finalizer call must be present in the worker loop');
  assert.ok(readinessCall < finalizeCall, 'replacement readiness must be checked before linkage finalization');
});

test('worker delegates original-replacement mutation to the isolated finalizer', () => {
  assert.match(worker, /finalizeRevisionReplacementLinkage/);
  assert.doesNotMatch(worker, /supersededBySaleId\s*:/);
  assert.doesNotMatch(worker, /revisionLifecycle\s*:\s*['\"]REPLACEMENT_CREATED['\"]/);
  assert.doesNotMatch(worker, /\.update\(/);
  assert.doesNotMatch(worker, /\.set\(/);
});

test('worker preserves named database and production project defaults', () => {
  assert.match(worker, /gen-lang-client-0911422817/);
  assert.match(worker, /ai-studio-f7d8654b-e089-425a-a506-38159afe1e75/);
  assert.match(worker, /getFirestore\(app, DATABASE_ID\)/);
});

test('a conflicting linkage is fail-closed rather than silently skipped', () => {
  assert.match(worker, /summary\.failed \+= 1/);
  assert.match(worker, /process\.exitCode = 1/);
  assert.doesNotMatch(worker, /catch[\s\S]*finalized \+= 1/);
});
