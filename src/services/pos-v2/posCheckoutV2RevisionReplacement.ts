import { PosCheckoutV2Error } from './posCheckoutV2Errors';
import { checkoutV2SaleDocumentId } from './posCheckoutV2Identity';
import {
  posCheckoutV2OutboxEventDocumentId,
  posCheckoutV2PaymentDocumentId
} from './posCheckoutV2PaymentOutbox';
import type { PosCheckoutV2RevisionReplacementContext } from './posCheckoutV2Types';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export interface ValidatedPosCheckoutV2RevisionReplacementContext {
  revisionId: string;
  revisionRequestId: string;
  sequence: number;
  originalSaleId: string;
  originalReceiptNumber: string;
  replacementSaleId: string;
  replacementPaymentId: string;
  replacementOutboxEventId: string;
}

export function validatePosCheckoutV2RevisionReplacementContract(params: {
  tenantId: string;
  attemptId: string;
  preparedSaleId: string;
  preparedPaymentId: string;
  preparedOutboxEventId: string;
  context?: PosCheckoutV2RevisionReplacementContext;
}): ValidatedPosCheckoutV2RevisionReplacementContext | null {
  if (!params.context) return null;

  const tenantId = clean(params.tenantId);
  const attemptId = clean(params.attemptId);
  const preparedSaleId = clean(params.preparedSaleId);
  const preparedPaymentId = clean(params.preparedPaymentId);
  const preparedOutboxEventId = clean(params.preparedOutboxEventId);
  const context = params.context;

  const revisionId = clean(context.revisionId);
  const revisionRequestId = clean(context.revisionRequestId);
  const originalSaleId = clean(context.originalSaleId);
  const originalReceiptNumber = clean(context.originalReceiptNumber);
  const replacementSaleId = clean(context.replacementSaleId);
  const replacementPaymentId = clean(context.replacementPaymentId);
  const replacementOutboxEventId = clean(context.replacementOutboxEventId);
  const sequence = Number(context.sequence);

  if (!tenantId || !attemptId || !preparedSaleId || !preparedPaymentId || !preparedOutboxEventId) {
    throw new PosCheckoutV2Error('IDEMPOTENCY_CONFLICT', 'Canonical replacement checkout identity is incomplete.');
  }
  if (!revisionId || !revisionRequestId || !originalSaleId || !originalReceiptNumber) {
    throw new PosCheckoutV2Error('IDEMPOTENCY_CONFLICT', 'Revision replacement linkage is incomplete.');
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new PosCheckoutV2Error('IDEMPOTENCY_CONFLICT', 'Revision replacement sequence must be a positive whole number.');
  }
  if (!replacementSaleId || !replacementPaymentId || !replacementOutboxEventId) {
    throw new PosCheckoutV2Error('IDEMPOTENCY_CONFLICT', 'Revision replacement canonical document identities are incomplete.');
  }
  if (originalSaleId === replacementSaleId) {
    throw new PosCheckoutV2Error('IDEMPOTENCY_CONFLICT', 'A revision replacement sale cannot reuse the original sale identity.');
  }

  const canonicalSaleId = checkoutV2SaleDocumentId(tenantId, attemptId);
  const canonicalPaymentId = posCheckoutV2PaymentDocumentId(canonicalSaleId);
  const canonicalOutboxEventId = posCheckoutV2OutboxEventDocumentId(canonicalSaleId);

  if (
    preparedSaleId !== canonicalSaleId
    || preparedPaymentId !== canonicalPaymentId
    || preparedOutboxEventId !== canonicalOutboxEventId
  ) {
    throw new PosCheckoutV2Error('IDEMPOTENCY_CONFLICT', 'Prepared replacement checkout identities do not match the canonical POS V2 identity contract.');
  }

  if (
    replacementSaleId !== canonicalSaleId
    || replacementPaymentId !== canonicalPaymentId
    || replacementOutboxEventId !== canonicalOutboxEventId
  ) {
    throw new PosCheckoutV2Error('IDEMPOTENCY_CONFLICT', 'Revision replacement identities do not match the canonical POS V2 checkout identities.');
  }

  return {
    revisionId,
    revisionRequestId,
    sequence,
    originalSaleId,
    originalReceiptNumber,
    replacementSaleId,
    replacementPaymentId,
    replacementOutboxEventId
  };
}
