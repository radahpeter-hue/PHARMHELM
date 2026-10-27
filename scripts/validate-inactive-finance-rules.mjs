import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ValidationStatus,
  classifyRulesValidationOutcome,
  computeRetryDelayMs,
  createRulesDiagnosticFetch,
  deleteRulesResourceWithRetry,
  isTransientRulesApiStatus,
  readRulesetInventory,
  recoverOwnedCandidate,
  runInactiveCompilerControl,
  runUnboundReleaseControl,
} from './firebase-rules-diagnostics.mjs';

const fetch = createRulesDiagnosticFetch();
const project = 'gen-lang-client-0911422817';
const MAX_CANDIDATE_ATTEMPTS = 4;
const MINIMAL_DENY_ALL_RULES =
  "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }";

let token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
if (!token) {
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  token = await auth.getAccessToken();
}
if (!token) throw new Error('Missing Google access token for inactive ruleset validation.');

const rulesPath = process.argv[2] || 'firestore.rules';
const rules = readFileSync(rulesPath, 'utf8');
const sourceSHA256 = createHash('sha256').update(rules).digest('hex');
const sourceBytes = Buffer.byteLength(rules);
const operation = `${process.env.GITHUB_RUN_ID || Date.now()}_${process.env.GITHUB_RUN_ATTEMPT || 1}`;
if (!/^[0-9]+_[0-9]+$/.test(operation)) throw new Error('Invalid validation operation identity.');

// Match the production source name. Keep run ownership in the API's separate
// File.fingerprint field instead of changing compilation/debug source metadata.
const fileNameMode = process.env.PHARMHELM_COMPILER_FILE_NAME_MODE || 'canonical';
if (!['canonical', 'unique'].includes(fileNameMode)) throw new Error('Invalid compiler filename diagnostic mode.');
const nonce = randomUUID().replaceAll('-', '');
const fileName = fileNameMode === 'canonical' ? 'firestore.rules' : `phase5_candidate_${operation}_${nonce}.rules`;
const fileFingerprint = Buffer.from(`pharmhelm:${operation}:${nonce}`).toString('base64');
const startedAt = Date.now();

function emitVerdict(verdict) {
  const record = {
    mode: 'VALIDATION_VERDICT',
    ...verdict,
    sourceSHA256,
    sourceBytes,
    productionReleaseModified: false,
  };
  console.log(JSON.stringify(record));
  if (process.env.PHARMHELM_VERDICT_OUTPUT_FILE) {
    writeFileSync(process.env.PHARMHELM_VERDICT_OUTPUT_FILE, JSON.stringify(record, null, 2) + '\n');
  }
  if (process.env.GITHUB_ACTIONS === 'true') {
    const summaryParts = [
      `status=${record.status}`,
      `class=${record.diagnosticClass}`,
      `stage=${record.stage}`,
      `httpStatus=${record.candidateHttpStatus}`,
      `sourceBytes=${record.sourceBytes}`,
      ...(record.executableBytes !== null ? [`executableBytes=${record.executableBytes}`] : []),
      ...(record.controls
        ? [
            `phase5Control=${record.controls.phase5ControlStatus ?? 'n/a'}`,
            `minimalControl=${record.controls.minimalControlStatus ?? 'n/a'}`,
          ]
        : []),
    ];
    if (record.status === ValidationStatus.PASS) {
      console.log(`::notice title=PASS::Authoritative unbound Firestore release probe passed (${summaryParts.join(', ')}).`);
    } else {
      console.log(
        `::error title=${record.status}::Firestore rules certification blocked (${summaryParts.join(', ')}).${record.errorMessage ? ' ' + String(record.errorMessage).replace(/[\r\n]+/g, ' ').slice(0, 400) : ''}`,
      );
    }
  }
  return record;
}

console.log(
  JSON.stringify({
    mode: 'CANDIDATE_FINGERPRINT',
    fileName,
    fileFingerprint,
    sourceSHA256,
    sourceBytes,
    commit: process.env.GITHUB_SHA || null,
  }),
);

let result;
let ownedCandidate = true;
const controlRetries = process.env.PHARMHELM_ENABLE_RELEASE_CONTROLS === '1' ? 3 : 1;

for (let attempt = 1; attempt <= MAX_CANDIDATE_ATTEMPTS; attempt++) {
  const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { files: [{ name: fileName, content: rules, fingerprint: fileFingerprint }] } }),
    signal: AbortSignal.timeout(60000),
  });
  result = await response.json();
  if (response.ok) break;
  if ([500, 502, 503, 504].includes(response.status)) {
    const recovered = await recoverOwnedCandidate({
      project,
      token,
      rules,
      fileName,
      fileFingerprint,
      runOwnedFileName: fileNameMode === 'unique',
      allowSharedExactSource: fileNameMode === 'canonical',
      startedAt,
      fetchImpl: fetch,
    });
    if (recovered) {
      result = recovered;
      ownedCandidate = recovered.recoveryOwned !== false;
      break;
    }
  }
  if (!isTransientRulesApiStatus(response.status) || attempt === MAX_CANDIDATE_ATTEMPTS) {
    let minimalControlStatus = null;
    let phase5ControlStatus = null;
    if (isTransientRulesApiStatus(response.status)) {
      try {
        await readRulesetInventory({ project, token, fetchImpl: fetch });
      } catch (error) {
        console.log(JSON.stringify({ mode: 'READ_ONLY_RULESET_INVENTORY', complete: false, error: String(error) }));
      }
      minimalControlStatus = await runInactiveCompilerControl({
        project,
        token,
        rules: MINIMAL_DENY_ALL_RULES,
        mode: 'MINIMAL_INACTIVE_RULESET_CONTROL',
        maxAttempts: controlRetries,
        fetchImpl: fetch,
      });
      const padded =
        MINIMAL_DENY_ALL_RULES + '/*' + 'x'.repeat(Math.max(0, sourceBytes - Buffer.byteLength(MINIMAL_DENY_ALL_RULES) - 4)) + '*/';
      await runInactiveCompilerControl({
        project,
        token,
        rules: padded,
        mode: 'SIZE_MATCHED_DENY_ALL_CONTROL',
        maxAttempts: 1,
        fetchImpl: fetch,
      });
      if (process.env.PHARMHELM_COMPILER_AUTHORED_RULES) {
        await runInactiveCompilerControl({
          project,
          token,
          rules: readFileSync(process.env.PHARMHELM_COMPILER_AUTHORED_RULES, 'utf8'),
          mode: 'UNTRANSFORMED_AUTHORED_CONTROL',
          maxAttempts: 1,
          fetchImpl: fetch,
        });
      }
      if (process.env.PHARMHELM_COMPILER_CONTROLS) {
        for (const name of readdirSync(process.env.PHARMHELM_COMPILER_CONTROLS).filter((n) => n.endsWith('.rules')).sort()) {
          await runInactiveCompilerControl({
            project,
            token,
            rules: readFileSync(join(process.env.PHARMHELM_COMPILER_CONTROLS, name), 'utf8'),
            mode: 'COMPACTION_STAGE_' + name,
            maxAttempts: 1,
            fetchImpl: fetch,
          });
        }
      }
      if (process.env.PHARMHELM_COMPILER_BASELINE_RULES) {
        const baseline = readFileSync(process.env.PHARMHELM_COMPILER_BASELINE_RULES, 'utf8');
        phase5ControlStatus = await runInactiveCompilerControl({
          project,
          token,
          rules: baseline,
          mode: 'CERTIFIED_INACTIVE_RULESET_CONTROL',
          maxAttempts: controlRetries,
          fetchImpl: fetch,
          log: (line) => {
            const parsed = JSON.parse(line);
            if (parsed.mode === 'CERTIFIED_INACTIVE_RULESET_CONTROL') {
              console.log(
                JSON.stringify({
                  ...parsed,
                  sourceSHA256: createHash('sha256').update(baseline).digest('hex'),
                }),
              );
            } else {
              console.log(line);
            }
          },
        });
      }
    }
    const errorMessage = result.error?.message || 'Unknown compiler error';
    const classification = classifyRulesValidationOutcome({
      candidateHttpStatus: response.status,
      errorMessage,
      minimalControlStatus,
      phase5ControlStatus,
      stage: 'ruleset',
    });
    emitVerdict({
      ...classification,
      candidateHttpStatus: response.status,
      errorMessage,
      controls: { minimalControlStatus, phase5ControlStatus },
    });
    throw new Error(`[${classification.status}] Inactive ruleset validation failed (${response.status}): ${errorMessage}`);
  }
  const delayMs = computeRetryDelayMs(attempt);
  console.log(`Rules API transient HTTP ${response.status}; retry ${attempt}/${MAX_CANDIDATE_ATTEMPTS} in ${delayMs}ms without activating any release.`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

if (!result.name?.startsWith(`projects/${project}/rulesets/`)) {
  throw new Error('Unexpected inactive ruleset response.');
}

const probeName = `projects/${project}/releases/pharmhelm_size_probe_${operation}`;
if (!/^projects\/gen-lang-client-0911422817\/releases\/pharmhelm_size_probe_[0-9]+_[0-9]+$/.test(probeName)) {
  throw new Error('Unsafe validation release name.');
}

let validationFailure;
try {
  let release;
  for (let attempt = 1; attempt <= MAX_CANDIDATE_ATTEMPTS; attempt++) {
    const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}/releases`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: probeName, rulesetName: result.name }),
      signal: AbortSignal.timeout(60000),
    });
    release = await response.json();
    if (response.ok) break;
    if (![409, ...[429, 500, 502, 503, 504]].includes(response.status)) {
      const errorMessage = release.error?.message || 'Unknown activation error';
      const classification = classifyRulesValidationOutcome({
        candidateHttpStatus: response.status,
        errorMessage,
        stage: 'release',
      });
      emitVerdict({
        ...classification,
        candidateHttpStatus: response.status,
        errorMessage,
        controls: { minimalControlStatus: null, phase5ControlStatus: null },
      });
      throw new Error(
        `[${classification.status}] Compiled executable activation-size validation failed (${response.status}): ${errorMessage}`,
      );
    }
    const recovery = await fetch(`https://firebaserules.googleapis.com/v1/${probeName}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60000),
    });
    if (recovery.ok) {
      release = await recovery.json();
      if (release.name !== probeName || release.rulesetName !== result.name) {
        emitVerdict({
          status: ValidationStatus.FAIL_RULES,
          diagnosticClass: 'CONFLICTING_PROBE_RELEASE',
          candidateCertified: false,
          stage: 'release',
          candidateHttpStatus: 409,
          executableBytes: null,
          limitBytes: null,
          errorMessage: 'Conflicting size probe release',
          controls: { minimalControlStatus: null, phase5ControlStatus: null },
        });
        throw new Error('Conflicting size probe release');
      }
      break;
    }
    if (attempt === MAX_CANDIDATE_ATTEMPTS && [500, 502, 503, 504].includes(response.status) && recovery.status === 404) {
      let recovered = false;
      for (let poll = 1; poll <= 12; poll++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const late = await fetch(`https://firebaserules.googleapis.com/v1/${probeName}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(60000),
        });
        if (late.ok) {
          release = await late.json();
          if (release.name !== probeName || release.rulesetName !== result.name) {
            emitVerdict({
              status: ValidationStatus.FAIL_RULES,
              diagnosticClass: 'CONFLICTING_LATE_PROBE_RELEASE',
              candidateCertified: false,
              stage: 'release',
              candidateHttpStatus: 409,
              executableBytes: null,
              limitBytes: null,
              errorMessage: 'Conflicting late size probe release',
              controls: { minimalControlStatus: null, phase5ControlStatus: null },
            });
            throw new Error('Conflicting late size probe release');
          }
          console.log(JSON.stringify({ mode: 'RECOVERED_EXACT_LATE_UNBOUND_RELEASE', poll, productionReleaseModified: false }));
          recovered = true;
          break;
        }
        if (![404, 429, 500, 502, 503, 504].includes(late.status)) {
          throw new Error(`Late unbound probe recovery failed (${late.status})`);
        }
      }
      if (recovered) break;
    }
    if (attempt === MAX_CANDIDATE_ATTEMPTS || ![404, 429, 500, 502, 503, 504].includes(recovery.status)) {
      let minimalControlStatus = null;
      let phase5ControlStatus = null;
      if (process.env.PHARMHELM_ENABLE_RELEASE_CONTROLS === '1' && isTransientRulesApiStatus(response.status)) {
        minimalControlStatus = await runUnboundReleaseControl({
          project,
          token,
          rules: MINIMAL_DENY_ALL_RULES,
          mode: 'MINIMAL_UNBOUND_RELEASE_CONTROL',
          probeSuffix: `${operation}_ctrl_minimal`,
          maxAttempts: 3,
          fetchImpl: fetch,
        });
        if (process.env.PHARMHELM_COMPILER_BASELINE_RULES) {
          const baseline = readFileSync(process.env.PHARMHELM_COMPILER_BASELINE_RULES, 'utf8');
          phase5ControlStatus = await runUnboundReleaseControl({
            project,
            token,
            rules: baseline,
            mode: 'PHASE5_CERTIFIED_UNBOUND_RELEASE_CONTROL',
            probeSuffix: `${operation}_ctrl_phase5`,
            maxAttempts: 3,
            fetchImpl: fetch,
          });
        }
      }
      const errorMessage = `Compiled executable activation-size validation unavailable (${response.status}); probe recovery HTTP ${recovery.status}`;
      const classification = classifyRulesValidationOutcome({
        candidateHttpStatus: response.status,
        errorMessage,
        minimalControlStatus,
        phase5ControlStatus,
        stage: 'release',
      });
      emitVerdict({
        ...classification,
        candidateHttpStatus: response.status,
        errorMessage,
        controls: { minimalControlStatus, phase5ControlStatus },
      });
      throw new Error(`[${classification.status}] ${errorMessage}`);
    }
    const delayMs = computeRetryDelayMs(attempt);
    console.log(`Unbound release probe transient HTTP ${response.status}; retry ${attempt}/${MAX_CANDIDATE_ATTEMPTS} in ${delayMs}ms. No production release modified.`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  try {
    if (release.name !== probeName || release.rulesetName !== result.name) {
      throw new Error('Unexpected size-validation release.');
    }
    console.log(
      JSON.stringify({
        mode: 'UNBOUND_RELEASE_SIZE_VALIDATION',
        ruleset: result.name,
        ownedCandidate,
        sourceSHA256,
        sourceBytes,
        productionReleaseModified: false,
      }),
    );
    emitVerdict({
      status: ValidationStatus.PASS,
      diagnosticClass: 'CERTIFIED_WITHIN_LIMIT',
      candidateCertified: true,
      stage: 'release',
      candidateHttpStatus: 200,
      executableBytes: null,
      limitBytes: 256000,
      ruleset: result.name,
      controls: { minimalControlStatus: null, phase5ControlStatus: null },
    });
  } finally {
    await deleteRulesResourceWithRetry({
      url: `https://firebaserules.googleapis.com/v1/${probeName}`,
      token,
      label: 'Temporary validation release cleanup',
      fetchImpl: fetch,
    });
  }
} catch (error) {
  validationFailure = error;
  throw error;
} finally {
  const probe = await fetch(`https://firebaserules.googleapis.com/v1/${probeName}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  });
  let absent = probe.status === 404;
  if (probe.ok) {
    const existing = await probe.json();
    if (existing.name === probeName && existing.rulesetName === result.name) {
      const removed = await deleteRulesResourceWithRetry({
        url: `https://firebaserules.googleapis.com/v1/${probeName}`,
        token,
        label: 'Deferred temporary validation release cleanup',
        allowInitialNotFound: true,
        fetchImpl: fetch,
      });
      absent = removed.ok;
    }
  }
  if (!absent) {
    if (!validationFailure) {
      throw new Error('Candidate cleanup deferred: exact temporary probe absence could not be verified.');
    }
    console.log(JSON.stringify({ mode: 'OWNED_CANDIDATE_CLEANUP_DEFERRED', productionReleaseModified: false }));
  } else if (!ownedCandidate) {
    console.log(JSON.stringify({ mode: 'SHARED_EXACT_SOURCE_RETAINED', ruleset: result.name, productionReleaseModified: false }));
  } else {
    await deleteRulesResourceWithRetry({
      url: `https://firebaserules.googleapis.com/v1/${result.name}`,
      token,
      label: 'Owned inactive candidate cleanup',
      fetchImpl: fetch,
    });
    console.log(JSON.stringify({ mode: 'OWNED_CANDIDATE_CLEANUP', productionReleaseModified: false }));
  }
}
