import type { CheckoutV2Request } from './posCheckoutV2Types';
import type { PosV2RevisionEnvelope } from './posSaleRevisionV2Envelope';

export interface PosV2ReplacementCheckoutSnapshots {
  customerId?: string;
  patientName?: string;
  institutionName?: string;
  prescriberName?: string;
  secondaryPaymentMethod?: string;
  secondaryAmount?: number;
  welfareAmount?: number;
  welfareBeneficiaryIsStaff?: boolean;
  sourceQuotationId?: string;
  isExceptionalConsumption?: boolean;
  exceptionalConsumptionReason?: string | null;
}

export interface BuildPosV2ReplacementCheckoutRequestInput {
  revisionRequestId: string;
  envelope: PosV2RevisionEnvelope;
  snapshots?: PosV2ReplacementCheckoutSnapshots;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function optionalText(value: unknown): string | undefined {
  const normalized = clean(value);
  return normalized || undefined;
}

function assertEnvelopeIdentity(input: BuildPosV2ReplacementCheckoutRequestInput): void {
  const { envelope } = input;
  const requestId = clean(input.revisionRequestId);
  if (!requestId) throw new Error('Replacement checkout requires the durable revision request ID.');

  const revision = envelope?.revision;
  const seed = envelope?.replacementSaleSeed;
  const ids = envelope?.identifiers;
  if (!revision || !seed || !ids) throw new Error('Replacement checkout requires a complete revision envelope.');
  if (revision.status !== 'PLANNED') throw new Error('Replacement checkout envelope must originate from a planned revision.');
  if (clean(revision.revisionId) !== clean(ids.revisionId) || clean(seed.revisionId) !== clean(ids.revisionId)) {
    throw new Error('Replacement checkout revision identity mismatch.');
  }
  if (clean(revision.originalSaleId) !== clean(seed.revisionOfSaleId)) {
    throw new Error('Replacement checkout original sale identity mismatch.');
  }
  if (clean(revision.originalReceiptNumber) !== clean(seed.originalReceiptNumber)) {
    throw new Error('Replacement checkout original receipt identity mismatch.');
  }
  if (clean(revision.tenantId) !== clean(seed.tenantId) || clean(revision.branchId) !== clean(seed.branchId)) {
    throw new Error('Replacement checkout tenant or branch identity mismatch.');
  }
  if (!Array.isArray(seed.items) || seed.items.length === 0) {
    throw new Error('Replacement checkout requires at least one revised sale line.');
  }
  if (!clean(ids.replacementAttemptId) || !clean(ids.replacementSaleId) || !clean(ids.replacementPaymentId) || !clean(ids.replacementOutboxEventId)) {
    throw new Error('Replacement checkout canonical identities are incomplete.');
  }
}

/**
 * Builds the canonical POS V2 checkout request for a corrected replacement sale.
 *
 * This mapper intentionally does not write Firestore and does not duplicate checkout
 * calculations. The returned request must be passed through executeCheckoutV2 so the
 * existing FEFO, tier, pricing, payment, branch-authority and idempotency guards remain
 * authoritative.
 */
export function buildPosV2ReplacementCheckoutRequest(
  input: BuildPosV2ReplacementCheckoutRequestInput
): CheckoutV2Request {
  assertEnvelopeIdentity(input);

  const { envelope } = input;
  const snapshots = input.snapshots || {};
  const { revision, identifiers, replacementSaleSeed: seed } = envelope;

  return {
    attemptId: identifiers.replacementAttemptId,
    branchId: seed.branchId,
    items: seed.items,
    discountPercentage: seed.discountPercentage,
    paymentMethod: seed.paymentMethod,
    secondaryPaymentMethod: optionalText(snapshots.secondaryPaymentMethod),
    secondaryAmount: snapshots.secondaryAmount,
    welfareAmount: snapshots.welfareAmount,
    welfareBeneficiaryIsStaff: snapshots.welfareBeneficiaryIsStaff,
    context: optionalText(seed.context),
    sourceQuotationId: optionalText(snapshots.sourceQuotationId),
    customerId: optionalText(snapshots.customerId),
    patientId: optionalText(seed.patientId),
    patientName: optionalText(snapshots.patientName),
    institutionId: optionalText(seed.institutionId),
    institutionName: optionalText(snapshots.institutionName),
    prescriberId: optionalText(seed.prescriberId),
    prescriberName: optionalText(snapshots.prescriberName),
    isExceptionalConsumption: Boolean(snapshots.isExceptionalConsumption),
    exceptionalConsumptionReason: snapshots.exceptionalConsumptionReason ?? null,
    revisionReplacement: {
      revisionId: identifiers.revisionId,
      revisionRequestId: clean(input.revisionRequestId),
      sequence: revision.sequence,
      originalSaleId: revision.originalSaleId,
      originalReceiptNumber: revision.originalReceiptNumber,
      replacementSaleId: identifiers.replacementSaleId,
      replacementPaymentId: identifiers.replacementPaymentId,
      replacementOutboxEventId: identifiers.replacementOutboxEventId
    }
  };
}
