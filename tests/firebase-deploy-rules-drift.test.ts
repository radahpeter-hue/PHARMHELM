import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync('.github/workflows/firebase-deploy.yml', 'utf8');
const verifier = readFileSync('scripts/verify-active-firestore-rules.sh', 'utf8');

test('Firebase deployment detects rules drift from the active named-database release', () => {
  assert.doesNotMatch(workflow, /git diff --quiet HEAD\^ HEAD -- firestore\.rules/);
  assert.match(workflow, /Check active Firestore rules fingerprint/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /steps\.firestore_rules_state\.outcome == 'failure'/);
  assert.match(verifier, /releases\/cloud\.firestore\/\$\{FIRESTORE_DATABASE_ID\}/);
  assert.match(verifier, /GET \$\{url\} failed/);
});

test('Firebase deployment verifies exact active rules content before Hosting', () => {
  assert.match(verifier, /source\.files\[\]\? \| select\(\.name == "firestore\.rules"\)/);
  assert.match(verifier, /sha256sum firestore\.rules/);
  assert.match(verifier, /active_hash.*expected_hash/s);
  assert.match(verifier, /Firestore rules drift detected/);

  const verificationPosition = workflow.indexOf('Verify exact active Firestore rules fingerprint');
  const hostingPosition = workflow.indexOf('Deploy Firebase Hosting');
  assert.notEqual(verificationPosition, -1);
  assert.notEqual(hostingPosition, -1);
  assert.ok(verificationPosition < hostingPosition);
});

test('Rules API uncertainty remains fail closed for Hosting', () => {
  assert.match(verifier, /return 10/);
  assert.match(workflow, /Deploy Firestore rules/);
  assert.match(workflow, /Verify exact active Firestore rules fingerprint/);
  assert.doesNotMatch(workflow, /Hosting was not blocked on commits where rules were unchanged/);
});

function runVerifier(activeRules: string) {
  const directory = mkdtempSync(join(tmpdir(), 'pharmhelm-rules-verifier-'));
  const binDirectory = join(directory, 'bin');
  const gcloudPath = join(binDirectory, 'gcloud');
  const curlPath = join(binDirectory, 'curl');
  const releasePath = join(directory, 'release.json');
  const rulesetPath = join(directory, 'ruleset.json');
  const outputPath = join(directory, 'github-output.txt');
  const localRules = 'rules_version = \'2\';\nservice cloud.firestore {}\n';

  try {
    mkdirSync(binDirectory);
    writeFileSync(join(directory, 'firestore.rules'), localRules);
    writeFileSync(releasePath, JSON.stringify({ rulesetName: 'projects/project-1/rulesets/active' }));
    writeFileSync(rulesetPath, JSON.stringify({
      source: { files: [{ name: 'firestore.rules', content: activeRules }] }
    }));
    writeFileSync(outputPath, '');
    writeFileSync(gcloudPath, '#!/usr/bin/env bash\necho test-access-token\n');
    writeFileSync(curlPath, `#!/usr/bin/env bash
set -euo pipefail
output_file=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output_file="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
if [[ "$url" == *"/releases/"* ]]; then
  cp "$MOCK_RELEASE_FILE" "$output_file"
else
  cp "$MOCK_RULESET_FILE" "$output_file"
fi
printf '200'
`);
    chmodSync(gcloudPath, 0o755);
    chmodSync(curlPath, 0o755);

    return spawnSync('bash', [resolve('scripts/verify-active-firestore-rules.sh')], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
        FIREBASE_PROJECT_ID: 'project-1',
        FIRESTORE_DATABASE_ID: 'database-1',
        GITHUB_OUTPUT: outputPath,
        MOCK_RELEASE_FILE: releasePath,
        MOCK_RULESET_FILE: rulesetPath
      }
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('rules fingerprint verifier accepts exact active content', () => {
  const exactRules = 'rules_version = \'2\';\nservice cloud.firestore {}\n';
  const result = runVerifier(exactRules);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /exactly match the deployment commit/);
});

test('rules fingerprint verifier rejects stale active content', () => {
  const staleRules = 'rules_version = \'2\';\nservice cloud.firestore { match \/stale\/{} }\n';
  const result = runVerifier(staleRules);
  assert.equal(result.status, 13, result.stderr || result.stdout);
  assert.match(result.stdout, /Firestore rules drift detected/);
});
