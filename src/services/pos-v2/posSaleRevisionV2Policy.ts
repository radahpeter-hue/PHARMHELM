import type { Sale } from '../../types';

// Pure policy helpers only: no Firestore writes or checkout mutation side effects.
export const POS_V2_REVISION_WINDOW_HOURS = 72;
export const POS_V2_REVISION_WINDOW_MS = POS_V2_REVISION_WINDOW_HOURS * 60 * 60 * 1000;

export type PosV2RevisionAdjustmentDirection = 'INCREASE' | 'DECREASE' | 'NO_VALUE_CHANGE';

export interface PosV2RevisionEligibility {
  allowed: boolean;
  code:
    | 'ELIGIBLE'
    | 'NOT_POS_V2'
    | 'NOT_COMPLETED'
    | 'INVALID_TIMESTAMP'
    | 'REVISION_WINDOW_EXPIRED'
    | 'ALREADY_VOIDED'
    | 'ALREADY_REVISED';
  deadline: string | null;
  remainingMs: number | null;
}

export function isPosV2Sale(sale: Pick<Sale, 'engineVersion'> | null | undefined): boolean {
  return Number(sale?.engineVersion || 0) === 2;
}

export function getPosV2RevisionDeadline(timestamp: string): Date | null {
  const original = new Date(timestamp);
  if (!Number.isFinite(original.getTime())) return null;
  return new Date(original.getTime() + POS_V2_REVISION_WINDOW_MS);
}

export function evaluatePosV2RevisionEligibility(
  sale: Pick<Sale, 'engineVersion' | 'status' | 'timestamp'> & Partial<{
    supersededBySaleId: string;
    revisionId: string;
  }>,
  now: Date = new Date()
): PosV2RevisionEligibility {
  if (!isPosV2Sale(sale)) {
    return { allowed: false, code: 'NOT_POS_V2', deadline: null, remainingMs: null };
  }

  if (sale.status === 'voided') {
    return { allowed: false, code: 'ALREADY_VOIDED', deadline: null, remainingMs: null };
  }

  if (sale.supersededBySaleId || sale.revisionId) {
    return { allowed: false, code: 'ALREADY_REVISED', deadline: null, remainingMs: null };
  }

  if (sale.status !== 'completed') {
    return { allowed: false, code: 'NOT_COMPLETED', deadline: null, remainingMs: null };
  }

  const deadline = getPosV2RevisionDeadline(sale.timestamp);
  if (!deadline) {
    return { allowed: false, code: 'INVALID_TIMESTAMP', deadline: null, remainingMs: null };
  }

  const remainingMs = deadline.getTime() - now.getTime();
  if (remainingMs < 0) {
    return {
      allowed: false,
      code: 'REVISION_WINDOW_EXPIRED',
      deadline: deadline.toISOString(),
      remainingMs: 0
    };
  }

  return {
    allowed: true,
    code: 'ELIGIBLE',
    deadline: deadline.toISOString(),
    remainingMs
  };
}

export function normalizeRevisionReason(reason: string): string {
  return String(reason || '').trim().replace(/\s+/g, ' ');
}

export function assertRevisionReason(reason: string): string {
  const normalized = normalizeRevisionReason(reason);
  if (normalized.length < 8) {
    throw new Error('A specific revision reason of at least 8 characters is required.');
  }
  if (normalized.length > 500) {
    throw new Error('Revision reason must not exceed 500 characters.');
  }
  return normalized;
}

export function revisionMonetaryDelta(originalTotal: number, revisedTotal: number): {
  delta: number;
  direction: PosV2RevisionAdjustmentDirection;
} {
  const original = Number(originalTotal);
  const revised = Number(revisedTotal);
  if (!Number.isFinite(original) || !Number.isFinite(revised)) {
    throw new Error('Original and revised totals must be valid numbers.');
  }
  const delta = revised - original;
  return {
    delta,
    direction: delta > 0 ? 'INCREASE' : delta < 0 ? 'DECREASE' : 'NO_VALUE_CHANGE'
  };
}
