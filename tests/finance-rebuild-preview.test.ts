import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Finance acceptance deploys only a dedicated PR preview of the validated head build', () => {
  const workflow = fs.readFileSync('.github/workflows/finance-rebuild-preview.yml', 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /^  push:/m);
  assert.match(workflow, /needs: validate/);
  assert.match(workflow, /channelId: finance-rebuild-pr\$\{\{ github.event.pull_request.number \}\}/);
  assert.doesNotMatch(workflow, /channelId: live|firebase-tools deploy|--only firestore|--only storage/);
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /VITE_BUILD_SHA: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /name: finance-rebuild-hosting-\$\{\{ github.event.pull_request.head.sha \}\}/);
});
