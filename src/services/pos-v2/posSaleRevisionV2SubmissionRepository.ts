import { doc, onSnapshot, runTransaction, type Unsubscribe } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import type { Sale, SaleItem } from '../../types';
import type { PosV2RevisionActor } from './posSaleRevisionV2Envelope';
import type { PosV2RevisionPlan } from './posSaleRevisionV2Planner';
import { evaluatePosV2RevisionEligibility } from './posSaleRevisionV2Policy';
import {
  buildPosV2RevisionSubmissionRequest,
  posV2RevisionRequestDocumentId,
  type PosV2RevisionSubmissionRequest
} from './posSaleRevisionV2Submission';

export interface SubmitPosV2RevisionInput {
  originalSale: Sale;
  plan: PosV2RevisionPlan;
  revisedItems: SaleItem[];
  actor: PosV2RevisionActor;
  sequence?: number;
  now?: Date;
}

export interface SubmitPosV2RevisionResult {
  request: PosV2RevisionSubmissionRequest;
  replayed: boolean;
}

export interface PosV2RevisionRequestProgress {
  id: string;
  status: string;
  revisionId?: string;
  replacementSaleId?: string;
  replacementReceiptNumber?: string;
  lastError?: string | null;
  requiresManualReview?: boolean;
  [key: string]: unknown;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export function isSamePosV2RevisionSubmission(
  existing: Record<string, unknown>,
  request: PosV2RevisionSubmissionRequest
): boolean {
  return clean(existing.requestId) === request.requestId
    && clean(existing.revisionId) === request.revisionId
    && clean(existing.tenantId) === request.tenantId
    && clean(existing.branchId) === request.branchId
    && clean(existing.originalSaleId) === request.originalSaleId
    && clean(existing.originalReceiptNumber) === request.originalReceiptNumber
    && clean(existing.requestedBy) === request.requestedBy
    && clean(existing.replacementAttemptId) === request.replacementAttemptId
    && clean(existing.replacementSaleId) === request.replacementSaleId
    && clean(existing.replacementPaymentId) === request.replacementPaymentId
    && clean(existing.replacementOutboxEventId) === request.replacementOutboxEventId;
}

/**
 * Creates the immutable POS V2 revision request exactly once.
 * Existing matching requests are treated as an idempotent replay; conflicting
 * documents fail closed. No original sale, stock, payment or finance record is
 * changed by this client-side repository.
 */
export async function submitPosV2RevisionRequest(
  input: SubmitPosV2RevisionInput
): Promise<SubmitPosV2RevisionResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication is required to submit a POS V2 revision.');
  if (clean(currentUser.uid) !== clean(input.actor.uid)) {
    throw new Error('The authenticated user does not match the revision actor.');
  }

  const eligibility = evaluatePosV2RevisionEligibility(input.originalSale as any, input.now ?? new Date());
  if (!eligibility.allowed) {
    throw new Error(eligibility.code === 'REVISION_WINDOW_EXPIRED'
      ? 'The 72-hour POS V2 revision window has expired.'
      : `This receipt is no longer eligible for revision (${eligibility.code}).`);
  }

  const request = buildPosV2RevisionSubmissionRequest(input);
  const requestId = posV2RevisionRequestDocumentId(request);
  const requestRef = doc(db, 'pos_sale_revision_requests', requestId);

  const replayed = await runTransaction(db, async transaction => {
    const existingSnapshot = await transaction.get(requestRef);
    if (existingSnapshot.exists()) {
      const existing = existingSnapshot.data() as Record<string, unknown>;
      if (!isSamePosV2RevisionSubmission(existing, request)) {
        throw new Error('A conflicting POS V2 revision request already exists for this receipt.');
      }
      return true;
    }

    transaction.set(requestRef, request);
    return false;
  });

  return { request, replayed };
}

export function watchPosV2RevisionRequest(
  requestId: string,
  onChange: (progress: PosV2RevisionRequestProgress) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const normalized = clean(requestId);
  if (!normalized) throw new Error('Revision request ID is required for progress monitoring.');

  return onSnapshot(
    doc(db, 'pos_sale_revision_requests', normalized),
    snapshot => {
      if (!snapshot.exists()) return;
      onChange({ id: snapshot.id, ...(snapshot.data() as Record<string, unknown>) } as PosV2RevisionRequestProgress);
    },
    error => onError?.(error instanceof Error ? error : new Error(String(error)))
  );
}
