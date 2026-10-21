import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinanceHttpService, type FinanceDispatcher} from '../finance-v2-backend/httpService';
import {financeRuntimeConfig} from '../finance-v2-backend/runtimeConfig';
import {requestFinanceV2} from '../src/services/financeV2Transport';

const origin = 'https://mp.example.test';
async function withServer(dispatch: FinanceDispatcher, run: (base: string) => Promise<void>, enabled = true) {
  const server = createFinanceHttpService({origin, enabled, allowedTenants: ['tenant-a']}, dispatch);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as any).port;
  try { await run(base); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const headers = {'Content-Type': 'application/json', Authorization: 'Bearer authenticated-test-token', Origin: origin};
const body = JSON.stringify({tenantId: 'tenant-a', requestId: 'same-id'});

test('independent host starts inactive; health never invokes credentials or database work', async () => {
  await withServer(async () => { throw Error('Dispatch must remain unreachable'); }, async base => {
    const health = await fetch(base + '/healthz');
    assert.deepEqual(await health.json(), {status: 'ready', apiEnabled: false, databaseVerified: false});
    const disabled = await fetch(base + '/api/finance-v2/transfers', {method: 'POST', headers, body});
    assert.equal(disabled.status, 503);
    assert.equal((await disabled.json()).rejected, false);
  }, false);
});

test('HTTP rejects missing authentication, wrong origin, outside pilot, malformed JSON and oversized bodies before dispatch', async () => {
  let calls = 0;
  await withServer(async () => { calls++; return {}; }, async base => {
    const url = base + '/api/finance-v2/transfers';
    assert.equal((await fetch(url, {method: 'POST', body})).status, 401);
    assert.equal((await fetch(url, {method: 'POST', headers: {...headers, Origin: 'https://other.test'}, body})).status, 403);
    assert.equal((await fetch(url, {method: 'POST', headers, body: JSON.stringify({tenantId: 'tenant-b'})})).status, 403);
    assert.equal((await fetch(url, {method: 'POST', headers, body: 'invalid'})).status, 400);
    assert.equal((await fetch(url, {method: 'POST', headers, body: 'null'})).status, 400);
    assert.equal((await fetch(url, {method: 'POST', headers, body: 'x'.repeat(8193)})).status, 413);
    assert.equal(calls, 0);
  });
});

test('all Phase 1-3 actions share the dispatcher; confirmed retries return 200', async () => {
  const actions: string[] = [];
  await withServer(async action => { actions.push(action); return {replay: action === 'transfers'}; }, async base => {
    for (const action of ['accounts', 'register', 'transfers', 'eod']) {
      const response = await fetch(base + '/api/finance-v2/' + action, {method: 'POST', headers, body});
      assert.equal(response.status, ['accounts', 'transfers'].includes(action) ? 200 : 201);
    }
    assert.deepEqual(actions, ['accounts', 'register', 'transfers', 'eod']);
  });
});

test('unknown error after commit stays unresolved; identical retry confirms one posting', async () => {
  let postings = 0;
  await withServer(async (_action, _token, input) => {
    assert.equal(input.requestId, 'same-id');
    if (postings === 0) { postings++; throw Error('SDK connection lost after commit'); }
    return {transferId: 'existing', replay: true};
  }, async base => {
    const first = await fetch(base + '/api/finance-v2/transfers', {method: 'POST', headers, body});
    assert.equal(first.status, 503);
    assert.equal((await first.json()).rejected, false);
    const second = await fetch(base + '/api/finance-v2/transfers', {method: 'POST', headers, body});
    assert.equal(second.status, 200);
    assert.equal((await second.json()).replay, true);
    assert.equal(postings, 1);
  });
});

test('expired or revoked token is a confirmed pre-posting rejection without leaking internals', async () => {
  await withServer(async () => { throw Object.assign(Error('private details'), {code: 'auth/id-token-revoked'}); }, async base => {
    const response = await fetch(base + '/api/finance-v2/accounts', {method: 'POST', headers, body});
    assert.equal(response.status, 401);
    const result = await response.json();
    assert.equal(result.rejected, true);
    assert.doesNotMatch(JSON.stringify(result), /private details/);
  });
});

const freeEnv = {
  FINANCE_V2_HOST_PROFILE: 'render-free-pilot', FINANCE_V2_API_ENABLED: 'false', FINANCE_V2_CASH_POLL_ENABLED: 'false',
  FINANCE_V2_ALLOWED_TENANTS: 'tenant-a', FIREBASE_PROJECT_ID: 'spark-project', FIRESTORE_DATABASE_ID: 'named-database', ALLOWED_ORIGIN: origin
};
test('free profile requires tenant allowlist and prohibits polling and emulator overrides', () => {
  assert.equal(financeRuntimeConfig(freeEnv).enabled, false);
  assert.throws(() => financeRuntimeConfig({...freeEnv, FINANCE_V2_CASH_POLL_ENABLED: 'true'}), /disabled background/);
  assert.throws(() => financeRuntimeConfig({...freeEnv, FINANCE_V2_ALLOWED_TENANTS: ''}), /explicit tenants/);
  assert.throws(() => financeRuntimeConfig({...freeEnv, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}), /emulator overrides/);
  assert.throws(() => financeRuntimeConfig({...freeEnv, ALLOWED_ORIGIN: 'https://mp.example.test/path'}), /HTTPS frontend origin/);
  assert.throws(() => financeRuntimeConfig({...freeEnv, FINANCE_V2_API_ENABLED: 'yes'}), /Explicit API/);
});

test('client waits for read-only warmup then sends exactly one authenticated financial request', async () => {
  const calls: any[] = [];
  const mockFetch = (async (url: any, options: any) => {
    calls.push({url, options});
    return calls.length === 1 ? Response.json({status: 'ready', apiEnabled: true}) : Response.json({transferId: 'posted'});
  }) as typeof fetch;
  assert.equal((await requestFinanceV2('https://api.example.test', 'transfers', {requestId: 'same-id'}, async () => 'token', mockFetch)).transferId, 'posted');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer token');
  assert.equal(calls[1].options.body, JSON.stringify({requestId: 'same-id'}));
});

test('cold start HTML and disabled health never send a financial POST', async () => {
  for (const health of [new Response('<html>Starting</html>', {status: 503}), Response.json({status: 'ready', apiEnabled: false})]) {
    let calls = 0;
    await assert.rejects(requestFinanceV2('https://api.example.test', 'eod', {}, async () => 'token', (async () => { calls++; return health; }) as typeof fetch), /unavailable|disabled/);
    assert.equal(calls, 1);
  }
});

test('client preserves uncertain outcomes for 503, 429 and proxy HTML instead of claiming rejection', async () => {
  for (const response of [Response.json({error: 'Unavailable', rejected: false}, {status: 503}), Response.json({error: 'Busy', rejected: true}, {status: 429}), new Response('Bad gateway', {status: 502})]) {
    let calls = 0;
    await assert.rejects(requestFinanceV2('https://api.example.test', 'transfers', {requestId: 'same-id'}, async () => 'token', (async () => ++calls === 1 ? Response.json({status: 'ready', apiEnabled: true}) : response) as typeof fetch), (error: any) => error.rejected !== true);
    assert.equal(calls, 2);
  }
});
