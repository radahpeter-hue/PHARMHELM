import type { PosCheckoutEngineMode } from './posCheckoutV2Types';

export type PosCheckoutExecutionEngine = 'legacy' | 'v2';

export interface PosCheckoutAttemptSelection {
  attemptId: string;
  engine?: PosCheckoutExecutionEngine;
}

export interface PendingPosCheckoutV2Attempt {
  version: 1;
  attemptId: string;
  tenantId: string;
  branchId: string;
  operatorUid: string;
  engine: 'v2';
  createdAt: string;
}

interface CheckoutAttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PENDING_ATTEMPT_PREFIX = 'pharmhelm:pos-v2:pending-attempt:';

export function pendingPosCheckoutV2StorageKey(operatorUid: string): string {
  return `${PENDING_ATTEMPT_PREFIX}${String(operatorUid || '').trim()}`;
}

function isPendingAttempt(value: unknown): value is PendingPosCheckoutV2Attempt {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const createdAt = new Date(String(row.createdAt || '')).getTime();
  return row.version === 1
    && row.engine === 'v2'
    && ['attemptId', 'tenantId', 'branchId', 'operatorUid'].every(key => typeof row[key] === 'string' && String(row[key]).trim().length > 0)
    && Number.isFinite(createdAt);
}

export function savePendingPosCheckoutV2Attempt(
  storage: CheckoutAttemptStorage,
  attempt: PendingPosCheckoutV2Attempt
): void {
  if (!isPendingAttempt(attempt)) throw new Error('A valid pending POS V2 attempt is required.');
  storage.setItem(pendingPosCheckoutV2StorageKey(attempt.operatorUid), JSON.stringify(attempt));
}

export function loadPendingPosCheckoutV2Attempt(
  storage: CheckoutAttemptStorage,
  operatorUid: string
): PendingPosCheckoutV2Attempt | null {
  const key = pendingPosCheckoutV2StorageKey(operatorUid);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPendingAttempt(parsed) || parsed.operatorUid !== operatorUid) {
      throw new Error('The stored POS V2 recovery marker is invalid. Contact support before starting another checkout.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The stored POS V2 recovery marker')) throw error;
    throw new Error('The stored POS V2 recovery marker is unreadable. Contact support before starting another checkout.');
  }
}

export function clearPendingPosCheckoutV2Attempt(
  storage: CheckoutAttemptStorage,
  operatorUid: string
): void {
  storage.removeItem(pendingPosCheckoutV2StorageKey(operatorUid));
}

export function executionEngineForMode(mode: PosCheckoutEngineMode): PosCheckoutExecutionEngine {
  // Shadow has no write-safe comparison implementation yet. It deliberately
  // remains legacy-authoritative and never invokes the V2 commit path.
  return mode === 'v2' ? 'v2' : 'legacy';
}

export function pinCheckoutAttemptEngine(
  attempt: PosCheckoutAttemptSelection,
  mode: PosCheckoutEngineMode
): PosCheckoutAttemptSelection & { engine: PosCheckoutExecutionEngine } {
  return {
    ...attempt,
    engine: attempt.engine ?? executionEngineForMode(mode)
  };
}

export async function executeSelectedCheckout<TLegacy, TV2>(params: {
  engine: PosCheckoutExecutionEngine;
  executeLegacy: () => Promise<TLegacy>;
  executeV2: () => Promise<TV2>;
}): Promise<
  | { engine: 'legacy'; result: TLegacy }
  | { engine: 'v2'; result: TV2 }
> {
  if (params.engine === 'v2') {
    return { engine: 'v2', result: await params.executeV2() };
  }
  return { engine: 'legacy', result: await params.executeLegacy() };
}
