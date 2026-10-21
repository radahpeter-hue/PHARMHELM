/** Cold-start handling is read-only. Financial requests are never auto-retried. */
export async function requestFinanceV2(
  baseUrl: string, action: string, input: unknown, getToken: () => Promise<string>,
  fetcher: typeof fetch = fetch
) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw Error('Finance API requires an HTTPS service origin.');
  if (!['accounts', 'register', 'transfers', 'eod'].includes(action)) throw Error('Unsupported Finance action.');
  const origin = base.origin;
  const call = async (url: string, options: RequestInit, timeout: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try { return await fetcher(url, {...options, signal: controller.signal}); }
    finally { clearTimeout(timer); }
  };
  // Free hosts may take about a minute to wake. Wait before sending a posting,
  // rather than repeatedly POSTing while a host returns an HTML startup page.
  const health = await call(origin + '/healthz', {method: 'GET', cache: 'no-store'}, 90000);
  let readiness: any;
  try { readiness = await health.json(); } catch { throw Error('Finance service is starting or unavailable. Retry the same request.'); }
  if (!health.ok || readiness.status !== 'ready' || readiness.apiEnabled !== true) throw Error('Finance service is unavailable or disabled. No posting was submitted.');
  const response = await call(`${origin}/api/finance-v2/${action}`, {
    method: 'POST', headers: {Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json'}, body: JSON.stringify(input)
  }, 30000);
  let result: any;
  try { result = await response.json(); } catch { throw Error('Posting not confirmed. Retry the same request to verify its outcome.'); }
  if (!response.ok) {
    const error = new Error(result.error || 'Posting not confirmed. Retry the same request.') as Error & {rejected?: boolean};
    error.rejected = result.rejected === true && [400, 401, 403, 404, 409, 413, 415, 422].includes(response.status);
    throw error;
  }
  return result;
}
