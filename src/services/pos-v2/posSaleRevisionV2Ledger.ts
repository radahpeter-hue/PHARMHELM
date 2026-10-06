import type { Sale, Staff } from '../../types';
import type { PosV2RevisionItemChange } from './posSaleRevisionV2Planner';

export const POS_V2_REVISION_LEDGER_VERSION = 1 as const;

export type PosV2RevisionLedgerDirection = 'INCREASE' | 'DECREASE' | 'NO_VALUE_CHANGE';

export interface PosV2RevisionContextChange {
  field: 'paymentMethod' | 'context' | 'patientId' | 'institutionId' | 'prescriberId' | 'discountPercentage';
  before: string | number | null;
  after: string | number | null;
}

export interface PosV2RevisionLedgerEntry {
  ledgerVersion: typeof POS_V2_REVISION_LEDGER_VERSION;
  revisionId: string;
  requestId: string;
  tenantId: string;
  branchId: string;
  originalSaleId: string;
  originalReceiptNumber: string;
  replacementSaleId: string | null;
  replacementReceiptNumber: string | null;
  originalSeller: { id: string | null; name: string | null };
  revisionEditor: { id: string; name: string; role: string | null };
  replacementExecutor: { id: string | null; name: string | null };
  reason: string;
  timestamps: {
    originalSaleAt: unknown;
    requestedAt: unknown | null;
    firstAttemptAt: unknown | null;
    replacementCreatedAt: unknown | null;
    completedAt: unknown | null;
    updatedAt: unknown | null;
    manualReviewAt: unknown | null;
  };
  originalTotal: number;
  correctedTotal: number;
  monetaryDelta: number;
  adjustmentDirection: PosV2RevisionLedgerDirection;
  itemChanges: PosV2RevisionItemChange[];
  contextualChanges: PosV2RevisionContextChange[];
  lifecycleStatus: string;
  failure: {
    message: string;
    requiresManualReview: boolean;
  } | null;
}

export interface BuildPosV2RevisionLedgerEntryInput {
  requestId?: string;
  request: Record<string, unknown>;
  originalSale?: Sale | null;
  replacementSale?: Sale | null;
  staff?: Staff[];
}

const clean = (value: unknown): string => String(value ?? '').trim();
const optional = (value: unknown): string | null => clean(value) || null;

function required(value: unknown, label: string): string {
  const normalized = clean(value);
  if (!normalized) throw new Error(`Revision ledger requires ${label}.`);
  return normalized;
}

function finite(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new Error(`Revision ledger requires a valid ${label}.`);
  return normalized;
}

function operatorId(sale?: Sale | null): string | null {
  if (!sale) return null;
  return optional(sale.servedBy || (sale as Sale & { operatorUid?: string }).operatorUid || sale.cashierId);
}

function staffName(id: string | null, staff: Staff[] = []): string | null {
  if (!id) return null;
  const match = staff.find(member => [member.uid, member.id, member.legacyStaffId]
    .filter(Boolean)
    .some(identifier => clean(identifier) === id));
  if (!match) return null;
  return [match.displayName, match.full_name, match.fullName, match.username]
    .map(optional)
    .find(Boolean) || null;
}

function contextChanges(request: Record<string, unknown>): PosV2RevisionContextChange[] {
  const before = request.before && typeof request.before === 'object'
    ? request.before as Record<string, unknown>
    : {};
  const after = request.after && typeof request.after === 'object'
    ? request.after as Record<string, unknown>
    : {};
  const fields: PosV2RevisionContextChange['field'][] = [
    'paymentMethod',
    'context',
    'patientId',
    'institutionId',
    'prescriberId',
    'discountPercentage'
  ];

  return fields.flatMap(field => {
    const prior = before[field] === undefined ? null : before[field] as string | number | null;
    const corrected = after[field] === undefined ? null : after[field] as string | number | null;
    return prior === corrected ? [] : [{ field, before: prior, after: corrected }];
  });
}

function lifecycleStatus(request: Record<string, unknown>): string {
  return clean(request.replacementLifecycle)
    || clean(request.status)
    || 'UNKNOWN';
}

/**
 * Builds a read-only ledger projection from the durable revision request.
 * The request remains the canonical lifecycle record; linked sales and staff
 * only add readable identities and never replace the immutable request data.
 */
export function buildPosV2RevisionLedgerEntry(
  input: BuildPosV2RevisionLedgerEntryInput
): PosV2RevisionLedgerEntry {
  const request = input.request;
  const requestId = required(request.requestId || input.requestId, 'request identity');
  const revisionId = required(request.revisionId, 'revision identity');
  const originalSaleId = required(request.originalSaleId, 'original sale identity');
  const originalReceiptNumber = required(request.originalReceiptNumber, 'original receipt number');
  const tenantId = required(request.tenantId, 'tenant identity');
  const branchId = required(request.branchId, 'branch identity');
  const requestedBy = required(request.requestedBy, 'revision editor identity');
  const requestedByName = required(request.requestedByName, 'revision editor name');
  const reason = required(request.reason, 'revision reason');
  const originalTotal = finite(request.originalTotal, 'original total');
  const correctedTotal = finite(request.revisedTotal, 'corrected total');
  const monetaryDelta = finite(request.monetaryDelta, 'monetary delta');
  const direction = clean(request.adjustmentDirection) as PosV2RevisionLedgerDirection;

  if (!['INCREASE', 'DECREASE', 'NO_VALUE_CHANGE'].includes(direction)) {
    throw new Error('Revision ledger requires a valid adjustment direction.');
  }
  if (Math.abs((correctedTotal - originalTotal) - monetaryDelta) > 0.0001) {
    throw new Error('Revision ledger monetary evidence is inconsistent.');
  }
  if (input.originalSale && (
    clean(input.originalSale.id) !== originalSaleId
    || clean(input.originalSale.tenantId) !== tenantId
    || clean(input.originalSale.branchId) !== branchId
  )) {
    throw new Error('Revision ledger original sale crossed its canonical boundary.');
  }

  const replacementSaleId = optional(request.replacementSaleId || request.pendingReplacementSaleId);
  if (input.replacementSale && (
    clean(input.replacementSale.id) !== replacementSaleId
    || clean(input.replacementSale.tenantId) !== tenantId
    || clean(input.replacementSale.branchId) !== branchId
    || clean(input.replacementSale.revisionId) !== revisionId
    || clean(input.replacementSale.revisionOfSaleId) !== originalSaleId
  )) {
    throw new Error('Revision ledger replacement sale linkage is inconsistent.');
  }

  const originalSellerId = optional(request.originalSellerId) || operatorId(input.originalSale);
  const replacementExecutorId = operatorId(input.replacementSale);
  const itemChanges = Array.isArray(request.itemChanges)
    ? request.itemChanges as PosV2RevisionItemChange[]
    : [];
  const errorMessage = optional(request.lastError);
  const requiresManualReview = request.requiresManualReview === true;

  return {
    ledgerVersion: POS_V2_REVISION_LEDGER_VERSION,
    revisionId,
    requestId,
    tenantId,
    branchId,
    originalSaleId,
    originalReceiptNumber,
    replacementSaleId,
    replacementReceiptNumber: optional(request.replacementReceiptNumber || input.replacementSale?.receiptNumber),
    originalSeller: {
      id: originalSellerId,
      name: staffName(originalSellerId, input.staff)
    },
    revisionEditor: {
      id: requestedBy,
      name: requestedByName,
      role: optional(request.requestedByRole)
    },
    replacementExecutor: {
      id: replacementExecutorId,
      name: staffName(replacementExecutorId, input.staff)
    },
    reason,
    timestamps: {
      originalSaleAt: request.originalTimestamp,
      requestedAt: request.requestedAt || request.createdAt || null,
      firstAttemptAt: request.lastAttemptAt || null,
      replacementCreatedAt: request.replacementCreatedAt || null,
      completedAt: request.revisionCompletedAt || request.completedAt || null,
      updatedAt: request.updatedAt || null,
      manualReviewAt: request.manualReviewAt || null
    },
    originalTotal,
    correctedTotal,
    monetaryDelta,
    adjustmentDirection: direction,
    itemChanges: [...itemChanges],
    contextualChanges: contextChanges(request),
    lifecycleStatus: lifecycleStatus(request),
    failure: errorMessage || requiresManualReview
      ? { message: errorMessage || 'Manual review required.', requiresManualReview }
      : null
  };
}
