import {createServer} from 'node:http';

type Action = 'eod' | 'accounts' | 'register' | 'transfers';
export type FinanceDispatcher = (action: Action, token: string, input: Record<string, unknown>) => Promise<any>;
class RequestRejection extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** The same transport serves all three phases. No local financial state. */
export function createFinanceHttpService(config: {origin: string; enabled: boolean; allowedTenants: string[]}, dispatch: FinanceDispatcher) {
  let active = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.origin && req.headers.origin !== config.origin) {
      res.writeHead(403); res.end(); return;
    }
    res.setHeader('Access-Control-Allow-Origin', config.origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body));
    };
    // Liveness only: no credentials, database queries, balance reads or activation.
    if (req.method === 'GET' && req.url === '/healthz') {
      json(200, {status: 'ready', apiEnabled: config.enabled, databaseVerified: false}); return;
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const action = req.url?.match(/^\/api\/finance-v2\/(eod|accounts|register|transfers)$/)?.[1] as Action | undefined;
    if (!action || req.method !== 'POST') { json(404, {error: 'Unknown route', rejected: true}); return; }
    if (!config.enabled) { json(503, {error: 'Finance service is disabled.', rejected: false}); return; }
    const bearer = req.headers.authorization || '';
    if (!bearer.startsWith('Bearer ') || bearer.length <= 7 || bearer.length > 8192) {
      json(401, {error: 'Authentication required.', rejected: true}); return;
    }
    // Bound simultaneous work on the small free instance. This is admission
    // control, not a replacement for identity checks or provider quota limits.
    if (active >= 8) { res.setHeader('Retry-After', '5'); json(503, {error: 'Service busy. Retry the same request.', rejected: false}); return; }
    active++;
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new RequestRejection(415, 'JSON required.');
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) throw new RequestRejection(413, 'Payload exceeds maximum size.');
        chunks.push(chunk);
      }
      let input: any;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new RequestRejection(400, 'Invalid JSON.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.tenantId !== 'string') throw new RequestRejection(400, 'Tenant identity required.');
      if (config.allowedTenants.length && !config.allowedTenants.includes(input.tenantId)) throw new RequestRejection(403, 'Tenant is outside the pilot.');
      const result = await dispatch(action, bearer.slice(7), input);
      json(result.replay || result.replayed ? 200 : action === 'accounts' ? 200 : 201, result);
    } catch (error) {
      if (error instanceof RequestRejection) json(error.status, {error: error.message, rejected: true});
      else if (['auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token', 'auth/argument-error', 'auth/user-disabled', 'auth/user-not-found'].includes((error as any)?.code)) {
        json(401, {error: 'Authentication rejected. Sign in again.', rejected: true});
      } else {
        // A transaction may have committed before an SDK/network error reached
        // us. Never label an unknown outcome a rejection or invite a new ID.
        json(503, {error: 'Posting not confirmed. Retry the same request to verify permissions, activation and posting outcome.', rejected: false});
      }
    } finally { active--; }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
