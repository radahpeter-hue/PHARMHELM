import type { Sale, SaleItem } from '../../types';
import {
  buildPosV2RevisionEnvelope,
  POS_V2_REVISION_EVENT_TYPE,
  type PosV2RevisionActor,
  type PosV2RevisionEnvelope
} from './posSaleRevisionV2Envelope';
import type { PosV2RevisionPlan } from './posSaleRevisionV2Planner';

export const POS_V2_REVISION_PAYLOAD_VERSION = 1 as const;

export interface PosV2RevisionSubmissionRequest {
  requestType: typeof POS_V2_REVISION_EVENT_TYPE;
  engineVersion: 2;
  payloadVersion: typeof POS_V2_REVISION_PAYLOAD_VERSION;
  status: 'PENDING';
  requestId: string;
  revisionId: string;
  tenantId: string;
  branchId: string;
  originalSaleId: string;
  originalReceiptNumber: string;
  originalSellerId: string | null;
  originalTimestamp: string;
  requestedBy: string;
  requestedByName: string;
  requestedByRole: string | null;
  reason: string;
  sequence: number;
  replacementAttemptId: string;
  replacementSaleId: string;
  pendingReplacementSaleId: string;
  replacementPaymentId: string;
  replacementOutboxEventId: string;
  reversalEventId: string;
  auditId: string;
  originalTotal: number;
  revisedTotal: number;
  monetaryDelta: number;
  adjustmentDirection: 'INCREASE' | 'DECREASE' | 'NO_VALUE_CHANGE';
  changeTypes: string[];
  itemChanges: PosV2RevisionPlan['itemChanges'];
  before: PosV2RevisionPlan['before'];
  after: PosV2RevisionPlan['after'];
  revisedItems: SaleItem[];
  envelope: PosV2RevisionEnvelope;
}

export interface BuildPosV2RevisionSubmissionInput {
  originalSale: Sale;
  plan: PosV2RevisionPlan;
  revisedItems: SaleItem[];
  actor: PosV2RevisionActor;
  sequence?: number;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export function posV2RevisionRequestIdForRevision(revisionId: string): string {
  const normalized = clean(revisionId);
  if (!normalized) throw new Error('Revision identity is required before submission.');
  return `pos_revision_request_${normalized}`.slice(0, 240);
}

/**
 * Pure builder for the durable POS V2 revision-request contract.
 * This function performs no Firestore writes and starts no reversal or checkout work.
 */
export function buildPosV2RevisionSubmissionRequest(
  input: BuildPosV2RevisionSubmissionInput
): PosV2RevisionSubmissionRequest {
  const envelope = buildPosV2RevisionEnvelope(input);
  const { identifiers, revision } = envelope;
  const requestId = posV2RevisionRequestIdForRevision(identifiers.revisionId);

  if (revision.status !== 'PLANNED') {
    throw new Error('Only a planned POS V2 revision may be submitted.');
  }
  if (clean(revision.revisedById) !== clean(input.actor.uid) || clean(revision.revisedByName) !== clean(input.actor.name)) {
    throw new Error('Revision submission actor does not match the reviewed envelope.');
  }
  if (clean(revision.originalSaleId) !== clean(input.originalSale.id)) {
    throw new Error('Revision submission original sale identity mismatch.');
  }
  if (clean(revision.originalReceiptNumber) !== clean(input.originalSale.receiptNumber)) {
    throw new Error('Revision submission original receipt identity mismatch.');
  }
  if (!Array.isArray(input.revisedItems) || input.revisedItems.length === 0) {
    throw new Error('Revision submission requires at least one corrected sale item.');
  }

  return {
    requestType: POS_V2_REVISION_EVENT_TYPE,
    engineVersion: 2,
    payloadVersion: POS_V2_REVISION_PAYLOAD_VERSION,
    status: 'PENDING',
    requestId,
    revisionId: identifiers.revisionId,
    tenantId: revision.tenantId,
    branchId: revision.branchId,
    originalSaleId: revision.originalSaleId,
    originalReceiptNumber: revision.originalReceiptNumber,
    originalSellerId: revision.originalSellerId,
    originalTimestamp: revision.originalTimestamp,
    requestedBy: revision.revisedById,
    requestedByName: revision.revisedByName,
    requestedByRole: revision.revisedByRole,
    reason: revision.reason,
    sequence: revision.sequence,
    replacementAttemptId: identifiers.replacementAttemptId,
    replacementSaleId: identifiers.replacementSaleId,
    pendingReplacementSaleId: identifiers.replacementSaleId,
    replacementPaymentId: identifiers.replacementPaymentId,
    replacementOutboxEventId: identifiers.replacementOutboxEventId,
    reversalEventId: identifiers.reversalEventId,
    auditId: identifiers.auditId,
    originalTotal: revision.originalTotal,
    revisedTotal: revision.revisedTotal,
    monetaryDelta: revision.monetaryDelta,
    adjustmentDirection: revision.adjustmentDirection,
    changeTypes: [...revision.changeTypes],
    itemChanges: [...revision.itemChanges],
    before: { ...revision.before },
    after: { ...revision.after },
    revisedItems: [...input.revisedItems],
    envelope
  };
}

export function posV2RevisionRequestDocumentId(request: Pick<PosV2RevisionSubmissionRequest, 'requestId'>): string {
  const value = clean(request.requestId);
  if (!value) throw new Error('Revision request document identity is required.');
  return value;
}
