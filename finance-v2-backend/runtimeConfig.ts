/** Hosting-neutral configuration. This module provisions no cloud resources. */
export function financeRuntimeConfig(env: NodeJS.ProcessEnv) {
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
  if (!['true', 'false'].includes(env.FINANCE_V2_API_ENABLED || '')) throw Error('Explicit API enablement required');
  const origin = env.ALLOWED_ORIGIN || '';
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.protocol !== 'https:') throw Error('A single HTTPS frontend origin is required');
  const projectId = env.FIREBASE_PROJECT_ID || '';
  const databaseId = env.FIRESTORE_DATABASE_ID || '';
  if (!/^[a-z0-9-]+$/.test(projectId) || !/^[(a-zA-Z0-9)_-]+$/.test(databaseId)) throw Error('Explicit Firebase project and database required');
  const freePilot = env.FINANCE_V2_HOST_PROFILE === 'render-free-pilot';
  const allowedTenants = (env.FINANCE_V2_ALLOWED_TENANTS || '').split(',').filter(Boolean);
  if (allowedTenants.some(id => !/^[A-Za-z0-9_-]{1,150}$/.test(id))) throw Error('Invalid pilot tenant allowlist');
  if (freePilot && (allowedTenants.length === 0 || env.FINANCE_V2_CASH_POLL_ENABLED !== 'false')) {
    throw Error('Free pilot requires explicit tenants and disabled background polling');
  }
  if (freePilot && (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST)) throw Error('Hosted pilot cannot use emulator overrides');
  return { port, origin, projectId, databaseId, enabled: env.FINANCE_V2_API_ENABLED === 'true', allowedTenants };
}
