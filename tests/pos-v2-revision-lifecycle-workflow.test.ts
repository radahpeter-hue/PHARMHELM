import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/pos-v2-revision-lifecycle.yml', 'utf8');

test('revision lifecycle workflow runs on the established five-minute durable cadence', () => {
  assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('revision lifecycle workflow targets the production project and named database', () => {
  assert.match(workflow, /FIREBASE_PROJECT_ID: gen-lang-client-0911422817/);
  assert.match(workflow, /FIRESTORE_DATABASE_ID: ai-studio-f7d8654b-e089-425a-a506-38159afe1e75/);
  assert.match(workflow, /FIREBASE_SERVICE_ACCOUNT/);
});

test('revision lifecycle worker executes reversal, replacement linkage and completion in order', () => {
  const reversal = workflow.indexOf('node scripts/process-pos-v2-revisions.mjs');
  const replacement = workflow.indexOf('node scripts/process-pos-v2-revision-replacements.mjs');
  const completion = workflow.indexOf('node scripts/process-pos-v2-revision-completions.mjs');
  assert.ok(reversal >= 0);
  assert.ok(replacement > reversal);
  assert.ok(completion > replacement);
});

test('revision lifecycle workflow is processing-only and never deploys or merges application code', () => {
  assert.doesNotMatch(workflow, /firebase deploy/);
  assert.doesNotMatch(workflow, /git push/);
  assert.doesNotMatch(workflow, /gh pr merge/);
});
