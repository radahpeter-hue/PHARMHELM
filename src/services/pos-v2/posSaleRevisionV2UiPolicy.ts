import type { Sale } from '../../types';
import {
  evaluatePosV2RevisionEligibility,
  isPosV2Sale,
  type PosV2RevisionEligibility
} from './posSaleRevisionV2Policy';

export type PosV2ReceiptRevisionUiState =
  | 'NOT_V2'
  | 'ELIGIBLE'
  | 'NO_PERMISSION'
  | 'WINDOW_EXPIRED'
  | 'REVISION_IN_PROGRESS'
  | 'ORIGINAL_REVISED'
  | 'REPLACEMENT_RECEIPT'
  | 'NOT_COMPLETED'
  | 'UNAVAILABLE';

export interface PosV2ReceiptRevisionUiDecision {
  state: PosV2ReceiptRevisionUiState;
  canRevise: boolean;
  showReviseAction: boolean;
  deadline: string | null;
  remainingMs: number | null;
  message: string;
  replacementSaleId?: string;
  originalSaleId?: string;
}

type RevisionAwareSale = Sale & Partial<{
  revisionId: string;
  revisionLifecycle: string;
  revisionLocked: boolean;
  supersededBySaleId: string;
  supersededByReceiptNumber: string;
  pendingReplacementSaleId: string;
  isRevisionReplacement: boolean;
  revisionOfSaleId: string;
  originalReceiptNumber: string;
}>;

const ACTIVE_REVISION_LIFECYCLES = new Set([
  'REVERSAL_PENDING',
  'REVERSAL_COMPLETE',
  'REPLACEMENT_PENDING',
  'REPLACEMENT_CREATED'
]);

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function decisionFromEligibility(
  eligibility: PosV2RevisionEligibility,
  canOperatePos: boolean
): PosV2ReceiptRevisionUiDecision {
  if (!eligibility.allowed) {
    if (eligibility.code === 'REVISION_WINDOW_EXPIRED') {
      return {
        state: 'WINDOW_EXPIRED',
        canRevise: false,
        showReviseAction: true,
        deadline: eligibility.deadline,
        remainingMs: 0,
        message: 'The 72-hour receipt revision window has expired.'
      };
    }
    if (eligibility.code === 'NOT_COMPLETED' || eligibility.code === 'ALREADY_VOIDED') {
      return {
        state: 'NOT_COMPLETED',
        canRevise: false,
        showReviseAction: false,
        deadline: eligibility.deadline,
        remainingMs: eligibility.remainingMs,
        message: 'Only completed POS V2 receipts can be revised.'
      };
    }
    return {
      state: 'UNAVAILABLE',
      canRevise: false,
      showReviseAction: false,
      deadline: eligibility.deadline,
      remainingMs: eligibility.remainingMs,
      message: 'This receipt is not available for revision.'
    };
  }

  if (!canOperatePos) {
    return {
      state: 'NO_PERMISSION',
      canRevise: false,
      showReviseAction: true,
      deadline: eligibility.deadline,
      remainingMs: eligibility.remainingMs,
      message: 'You do not have permission to revise POS receipts.'
    };
  }

  return {
    state: 'ELIGIBLE',
    canRevise: true,
    showReviseAction: true,
    deadline: eligibility.deadline,
    remainingMs: eligibility.remainingMs,
    message: 'This completed POS V2 receipt is eligible for revision.'
  };
}

/**
 * Pure presentation policy for the receipt ledger.
 *
 * It never writes Firestore and never enables the legacy edit path. The backend
 * revision policy and worker remain authoritative when a revision is submitted.
 */
export function getPosV2ReceiptRevisionUiDecision(
  sale: RevisionAwareSale,
  options: { canOperatePos: boolean; now?: Date }
): PosV2ReceiptRevisionUiDecision {
  if (!isPosV2Sale(sale)) {
    return {
      state: 'NOT_V2',
      canRevise: false,
      showReviseAction: false,
      deadline: null,
      remainingMs: null,
      message: 'Legacy receipt editing is handled separately.'
    };
  }

  if (sale.isRevisionReplacement === true || clean(sale.revisionOfSaleId)) {
    return {
      state: 'REPLACEMENT_RECEIPT',
      canRevise: false,
      showReviseAction: true,
      deadline: null,
      remainingMs: null,
      message: 'This is a corrected replacement receipt and cannot be revised again.',
      originalSaleId: clean(sale.revisionOfSaleId) || undefined
    };
  }

  const lifecycle = clean(sale.revisionLifecycle).toUpperCase();
  if (clean(sale.supersededBySaleId) || lifecycle === 'COMPLETED') {
    return {
      state: 'ORIGINAL_REVISED',
      canRevise: false,
      showReviseAction: true,
      deadline: null,
      remainingMs: null,
      message: 'This original receipt has already been revised.',
      replacementSaleId: clean(sale.supersededBySaleId) || undefined
    };
  }

  if (clean(sale.revisionId) || sale.revisionLocked === true || ACTIVE_REVISION_LIFECYCLES.has(lifecycle)) {
    return {
      state: 'REVISION_IN_PROGRESS',
      canRevise: false,
      showReviseAction: true,
      deadline: null,
      remainingMs: null,
      message: 'A revision is already in progress for this receipt.',
      replacementSaleId: clean(sale.pendingReplacementSaleId) || undefined
    };
  }

  const eligibility = evaluatePosV2RevisionEligibility(sale, options.now ?? new Date());
  return decisionFromEligibility(eligibility, options.canOperatePos);
}
