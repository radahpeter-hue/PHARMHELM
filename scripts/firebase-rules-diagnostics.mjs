/** Non-secret diagnostics, bounded retries and explicit state classification for Firebase Rules API checks. */

export const TRANSIENT_RULES_API_STATUSES = Object.freeze([429, 500, 502, 503, 504]);

export const ValidationStatus = Object.freeze({
  PASS: 'PASS',
  FAIL_RULES: 'FAIL_RULES',
  FAIL_SIZE: 'FAIL_SIZE',
  FAIL_CANDIDATE_COMPLEXITY: 'FAIL_CANDIDATE_COMPLEXITY',
  BLOCKED_FIREBASE_SERVICE: 'BLOCKED_FIREBASE_SERVICE',
});

export function isTransientRulesApiStatus(status) {
  return TRANSIENT_RULES_API_STATUSES.includes(Number(status));
}

export function computeRetryDelayMs(
  attempt,
  { baseMs = 5000, maxMs = 45000, jitterRatio = 0.2, randomImpl = Math.random } = {},
) {
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  const spread = exponential * jitterRatio;
  const jitter = (randomImpl() * 2 - 1) * spread;
  return Math.max(250, Math.round(exponential + jitter));
}

export function parseExecutableSizeError(message = '') {
  const text = String(message || '');
  const isSizeError =
    /(executable|compiled|ruleset|release|maximum|max|limit|too\s+large|exceed\w*|256[_,]?000|256\s*kb|\bsize\b)/i.test(
      text,
    ) && /(\bsize\b|\bbytes?\b|256[_,]?000|256\s*kb|too\s+large|exceed\w*)/i.test(text);
  if (!isSizeError) {
    return { isSizeError: false, executableBytes: null, limitBytes: null };
  }
  const rawNumbers = [...text.matchAll(/\b([0-9]{1,3}(?:[,_][0-9]{3})+|[0-9]{4,9})\b/g)]
    .map((m) => Number(m[1].replaceAll(',', '').replaceAll('_', '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  let limitBytes = 256000;
  let executableBytes = null;
  for (const n of rawNumbers) {
    if (n === 256000 || n === 262144) {
      limitBytes = n;
    } else if (executableBytes === null || n > executableBytes) {
      executableBytes = n;
    }
  }
  return { isSizeError: true, executableBytes, limitBytes };
}

export function classifyRulesValidationOutcome({
  candidateHttpStatus = 0,
  errorMessage = '',
  minimalControlStatus = null,
  phase5ControlStatus = null,
  stage = 'release',
} = {}) {
  const statusNum = Number(candidateHttpStatus);
  if (statusNum === 200) {
    return {
      status: ValidationStatus.PASS,
      diagnosticClass: 'CERTIFIED_WITHIN_LIMIT',
      candidateCertified: true,
      stage,
      executableBytes: null,
      limitBytes: 256000,
    };
  }
  if (statusNum === 400) {
    const sizeInfo = parseExecutableSizeError(errorMessage);
    if (sizeInfo.isSizeError) {
      return {
        status: ValidationStatus.FAIL_SIZE,
        diagnosticClass: 'EXECUTABLE_SIZE_LIMIT_EXCEEDED',
        candidateCertified: false,
        stage,
        executableBytes: sizeInfo.executableBytes,
        limitBytes: sizeInfo.limitBytes,
      };
    }
    return {
      status: ValidationStatus.FAIL_RULES,
      diagnosticClass: 'COMPILER_OR_CONTRACT_REJECTION',
      candidateCertified: false,
      stage,
      executableBytes: null,
      limitBytes: null,
    };
  }
  if (isTransientRulesApiStatus(statusNum)) {
    if (phase5ControlStatus === 200) {
      return {
        status: ValidationStatus.FAIL_CANDIDATE_COMPLEXITY,
        diagnosticClass: 'CANDIDATE_SPECIFIC_COMPILER_FAILURE_PHASE5_PASSED',
        candidateCertified: false,
        stage,
        executableBytes: null,
        limitBytes: null,
      };
    }
    if (
      phase5ControlStatus !== null &&
      isTransientRulesApiStatus(phase5ControlStatus) &&
      minimalControlStatus === 200
    ) {
      return {
        status: ValidationStatus.BLOCKED_FIREBASE_SERVICE,
        diagnosticClass: 'LARGE_RULES_COMPILER_OR_RELEASE_WORKER_DEGRADATION',
        candidateCertified: false,
        stage,
        executableBytes: null,
        limitBytes: null,
      };
    }
    if (minimalControlStatus !== null && isTransientRulesApiStatus(minimalControlStatus)) {
      return {
        status: ValidationStatus.BLOCKED_FIREBASE_SERVICE,
        diagnosticClass: 'BROAD_FIREBASE_SERVICE_OUTAGE',
        candidateCertified: false,
        stage,
        executableBytes: null,
        limitBytes: null,
      };
    }
    return {
      status: ValidationStatus.BLOCKED_FIREBASE_SERVICE,
      diagnosticClass:
        minimalControlStatus === 200
          ? 'HOSTED_COMPILER_UNAVAILABLE_MINIMAL_CONTROL_PASSED'
          : 'HOSTED_VERIFIER_TRANSIENT_UNAVAILABLE',
      candidateCertified: false,
      stage,
      executableBytes: null,
      limitBytes: null,
    };
  }
  return {
    status: ValidationStatus.FAIL_RULES,
    diagnosticClass: 'NON_TRANSIENT_VALIDATION_ERROR',
    candidateCertified: false,
    stage,
    executableBytes: null,
    limitBytes: null,
  };
}

export async function deleteRulesResourceWithRetry({
  url,
  token,
  label = 'Temporary rules resource',
  maxAttempts = 4,
  allowInitialNotFound = false,
  fetchImpl = globalThis.fetch,
  log = console.log,
  randomImpl = Math.random,
}) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetchImpl(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60000),
    });
    lastStatus = response.status;
    if (response.ok || (response.status === 404 && (allowInitialNotFound || attempt > 1))) {
      return { ok: true, status: response.status, attempts: attempt };
    }
    if (!isTransientRulesApiStatus(response.status) || attempt === maxAttempts) {
      throw new Error(`${label} failed (${response.status}).`);
    }
    const delayMs = computeRetryDelayMs(attempt, { randomImpl });
    log(
      JSON.stringify({
        mode: 'CLEANUP_DELETE_RETRY',
        label,
        attempt,
        maxAttempts,
        status: response.status,
        delayMs,
        productionReleaseModified: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${label} failed (${lastStatus}).`);
}

export function createRulesDiagnosticFetch({ fetchImpl = globalThis.fetch, log = console.log } = {}) {
  return async (url, options = {}) => {
    const started = Date.now();
    const response = await fetchImpl(url, options);
    const headers = {};
    for (const key of ['x-request-id', 'x-goog-request-id', 'x-cloud-trace-context', 'retry-after', 'server']) {
      if (response.headers.get(key)) headers[key] = response.headers.get(key);
    }
    let error;
    if (!response.ok) {
      try {
        const payload = await response.clone().json();
        error = payload.error;
      } catch {
        error = { message: 'Non-JSON response', body: (await response.clone().text()).slice(0, 2000) };
      }
    }
    log(
      JSON.stringify({
        mode: 'RULES_API_REQUEST',
        method: options.method || 'GET',
        endpoint: new URL(url).pathname,
        status: response.status,
        elapsedMs: Date.now() - started,
        headers,
        ...(error ? { error } : {}),
      }),
    );
    return response;
  };
}

export async function readRulesetInventory({ project, token, fetchImpl = globalThis.fetch, log = console.log }) {
  let count = 0;
  let pageToken = '';
  let pages = 0;
  do {
    const url = new URL(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      log(JSON.stringify({ mode: 'READ_ONLY_RULESET_INVENTORY', status: response.status, complete: false, count }));
      return;
    }
    const result = await response.json();
    count += (result.rulesets || []).length;
    pageToken = result.nextPageToken || '';
    pages++;
  } while (pageToken && pages < 30);
  log(
    JSON.stringify({
      mode: 'READ_ONLY_RULESET_INVENTORY',
      status: 200,
      count,
      complete: !pageToken,
      pages,
      productionReleaseModified: false,
    }),
  );
}

export async function runInactiveCompilerControl({
  project,
  token,
  rules,
  mode,
  maxAttempts = 1,
  fetchImpl = globalThis.fetch,
  log = console.log,
}) {
  let response;
  let payload = {};
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    response = await fetchImpl(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: rules }] } }),
      signal: AbortSignal.timeout(60000),
    });
    payload = await response.json();
    if (response.ok || !isTransientRulesApiStatus(response.status) || attempt === maxAttempts) break;
    const delayMs = computeRetryDelayMs(attempt);
    log(
      JSON.stringify({
        mode: `${mode}_RETRY`,
        attempt,
        maxAttempts,
        status: response.status,
        delayMs,
        productionReleaseModified: false,
        candidateCertified: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  log(
    JSON.stringify({
      mode,
      status: response.status,
      sourceBytes: Buffer.byteLength(rules),
      productionReleaseModified: false,
      candidateCertified: false,
    }),
  );
  if (response.ok) {
    if (!payload.name?.startsWith(`projects/${project}/rulesets/`)) {
      throw new Error('Unexpected inactive control identity.');
    }
    await deleteRulesResourceWithRetry({
      url: `https://firebaserules.googleapis.com/v1/${payload.name}`,
      token,
      label: 'Inactive diagnostic control cleanup',
      fetchImpl,
      log,
    });
  }
  return response.status;
}

export async function runUnboundReleaseControl({
  project,
  token,
  rules,
  mode,
  probeSuffix,
  maxAttempts = 3,
  fetchImpl = globalThis.fetch,
  log = console.log,
}) {
  if (!/^[A-Za-z0-9_]+$/.test(probeSuffix)) {
    throw new Error('Invalid diagnostic release probe suffix.');
  }
  const probeName = `projects/${project}/releases/pharmhelm_size_probe_${probeSuffix}`;
  if (!/^projects\/gen-lang-client-0911422817\/releases\/pharmhelm_size_probe_[A-Za-z0-9_]+$/.test(probeName)) {
    throw new Error('Unsafe diagnostic control release name.');
  }
  let createResp;
  let created = {};
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    createResp = await fetchImpl(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: rules }] } }),
      signal: AbortSignal.timeout(60000),
    });
    created = await createResp.json();
    if (createResp.ok || !isTransientRulesApiStatus(createResp.status) || attempt === maxAttempts) break;
    await new Promise((resolve) => setTimeout(resolve, computeRetryDelayMs(attempt)));
  }
  if (!createResp.ok || !created.name?.startsWith(`projects/${project}/rulesets/`)) {
    log(
      JSON.stringify({
        mode,
        stage: 'ruleset',
        status: createResp.status,
        sourceBytes: Buffer.byteLength(rules),
        productionReleaseModified: false,
        candidateCertified: false,
      }),
    );
    return createResp.status;
  }
  let releaseStatus = 0;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const relResp = await fetchImpl(`https://firebaserules.googleapis.com/v1/projects/${project}/releases`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: probeName, rulesetName: created.name }),
        signal: AbortSignal.timeout(60000),
      });
      releaseStatus = relResp.status;
      if (relResp.ok) break;
      const recovery = await fetchImpl(`https://firebaserules.googleapis.com/v1/${probeName}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60000),
      });
      if (recovery.ok) {
        const recBody = await recovery.json();
        if (recBody.name === probeName && recBody.rulesetName === created.name) {
          releaseStatus = 200;
          break;
        }
      }
      if (!isTransientRulesApiStatus(relResp.status) || attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, computeRetryDelayMs(attempt)));
    }
    log(
      JSON.stringify({
        mode,
        stage: 'release',
        status: releaseStatus,
        sourceBytes: Buffer.byteLength(rules),
        productionReleaseModified: false,
        candidateCertified: false,
      }),
    );
    return releaseStatus;
  } finally {
    await deleteRulesResourceWithRetry({
      url: `https://firebaserules.googleapis.com/v1/${probeName}`,
      token,
      label: `${mode} temporary release cleanup`,
      allowInitialNotFound: true,
      fetchImpl,
      log,
    });
    await deleteRulesResourceWithRetry({
      url: `https://firebaserules.googleapis.com/v1/${created.name}`,
      token,
      label: `${mode} temporary ruleset cleanup`,
      allowInitialNotFound: true,
      fetchImpl,
      log,
    });
  }
}

/** Recover exact immutable source; separately prove ownership before any cleanup. */
export async function recoverOwnedCandidate({
  project,
  token,
  rules,
  fileName,
  fileFingerprint = null,
  runOwnedFileName = false,
  allowSharedExactSource = false,
  startedAt,
  fetchImpl = globalThis.fetch,
  log = console.log,
}) {
  let pageToken = '';
  let pages = 0;
  do {
    const url = new URL(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) return null;
    const result = await response.json();
    for (const record of result.rulesets || []) {
      if (
        !record.name?.startsWith(`projects/${project}/rulesets/`) ||
        Date.parse(record.createTime) < startedAt - 60000 ||
        !Number.isFinite(Date.parse(record.createTime))
      ) {
        continue;
      }
      const detail = await fetchImpl(`https://firebaserules.googleapis.com/v1/${record.name}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60000),
      });
      if (!detail.ok) continue;
      const candidate = await detail.json();
      const files = candidate.source?.files;
      if (
        candidate.name === record.name &&
        files?.length === 1 &&
        files[0].name === fileName &&
        files[0].content === rules
      ) {
        const recoveryOwned = runOwnedFileName || (!!fileFingerprint && files[0].fingerprint === fileFingerprint);
        if (!recoveryOwned && !allowSharedExactSource) {
          log(
            JSON.stringify({
              mode: 'EXACT_SOURCE_OWNERSHIP_UNPROVEN',
              fingerprintPresent: !!files[0].fingerprint,
              candidateCertified: false,
            }),
          );
          continue;
        }
        log(
          JSON.stringify({
            mode: recoveryOwned
              ? 'RECOVERED_EXACT_RUN_OWNED_CANDIDATE'
              : 'RECOVERED_SHARED_EXACT_SOURCE_READ_ONLY',
            ruleset: candidate.name,
            recoveryOwned,
            productionReleaseModified: false,
            candidateCertified: false,
          }),
        );
        return { ...candidate, recoveryOwned };
      }
    }
    pageToken = result.nextPageToken || '';
    pages++;
  } while (pageToken && pages < 30);
  return null;
}
