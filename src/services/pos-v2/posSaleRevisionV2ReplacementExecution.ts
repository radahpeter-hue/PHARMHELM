import type { Sale } from '../../types';
import { executeCheckoutV2 } from './posCheckoutV2Service';
import type { PosCheckoutV2CompletedResult } from './posCheckoutV2Types';
import type { PosV2RevisionEnvelope } from './posSaleRevisionV2Envelope';
import {
  buildPosV2ReplacementCheckoutRequest,
  type PosV2ReplacementCheckoutSnapshots
} from './posSaleRevisionV2ReplacementOrchestrator';
import type { PosV2RevisionRequestProgress } from './posSaleRevisionV2SubmissionRepository';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sameId(left: unknown, right: unknown): boolean {
  return clean(left) === clean(right);
}

export function buildPosV2ReplacementSnapshots(
  originalSale: Sale,
  envelope: PosV2RevisionEnvelope
): PosV2ReplacementCheckoutSnapshots {
  const sale = originalSale as any;
  const seed = envelope.replacementSaleSeed;
  const originalPaymentMethod = clean(sale.paymentMethod);
  const revisedPaymentMethod = clean(seed.paymentMethod);
  const samePaymentMethod = originalPaymentMethod === revisedPaymentMethod;
  const secondaryMethod = clean(sale.secondaryPaymentMethod);
  const secondaryAmount = numberValue(sale.secondaryAmount);
  const originalTotal = Number(sale.totalAmount ?? sale.total ?? 0);
  const revisedTotal = Number(seed.totalAmount ?? 0);
  const hasSplitPayment = Boolean(secondaryMethod) && secondaryAmount !== undefined && secondaryAmount > 0;

  if (samePaymentMethod && hasSplitPayment && Math.abs(originalTotal - revisedTotal) > 0.0001) {
    throw new Error('A split-payment receipt cannot change monetary total until the revised split amounts are explicitly supplied.');
  }

  if (!samePaymentMethod && revisedPaymentMethod === 'staff_welfare') {
    throw new Error('Changing a receipt into Staff Welfare payment requires an explicit welfare allocation and is not available in this revision editor yet.');
  }

  const snapshots: PosV2ReplacementCheckoutSnapshots = {
    customerId: sameId(seed.patientId, sale.patientId) ? clean(sale.customerId) || undefined : undefined,
    patientName: sameId(seed.patientId, sale.patientId) ? clean(sale.patientName) || undefined : undefined,
    institutionName: sameId(seed.institutionId, sale.institutionId) ? clean(sale.institutionName) || undefined : undefined,
    prescriberName: sameId(seed.prescriberId, sale.prescriberId) ? clean(sale.prescriberName) || undefined : undefined,
    sourceQuotationId: clean(sale.sourceQuotationId) || undefined,
    isExceptionalConsumption: Boolean(sale.isExceptionalConsumption),
    exceptionalConsumptionReason: sale.exceptionalConsumptionReason ?? null
  };

  if (samePaymentMethod) {
    snapshots.secondaryPaymentMethod = secondaryMethod || undefined;
    snapshots.secondaryAmount = secondaryAmount;
    snapshots.welfareBeneficiaryIsStaff = sale.welfareBeneficiaryIsStaff;
    if (revisedPaymentMethod === 'staff_welfare') {
      snapshots.welfareAmount = hasSplitPayment
        ? numberValue(sale.welfareAmount)
        : revisedTotal;
    } else {
      snapshots.welfareAmount = numberValue(sale.welfareAmount);
    }
  }

  return snapshots;
}

/**
 * Executes only the corrected replacement checkout after the durable revision
 * request has reached REPLACEMENT_PENDING. The canonical POS V2 engine remains
 * authoritative for FEFO, tier validation, stock deduction, payment and outbox.
 */
export async function executePosV2RevisionReplacement(params: {
  progress: PosV2RevisionRequestProgress;
  originalSale: Sale;
}): Promise<PosCheckoutV2CompletedResult> {
  const { progress, originalSale } = params;
  if (clean(progress.status) !== 'REPLACEMENT_PENDING') {
    throw new Error('Replacement checkout may run only after the original revision reversal is complete.');
  }
  if (clean(progress.originalSaleId) !== clean(originalSale.id)) {
    throw new Error('Replacement checkout original sale identity mismatch.');
  }

  const envelope = progress.envelope as PosV2RevisionEnvelope | undefined;
  if (!envelope) throw new Error('Replacement checkout requires the immutable revision envelope.');

  const request = buildPosV2ReplacementCheckoutRequest({
    revisionRequestId: progress.id,
    envelope,
    snapshots: buildPosV2ReplacementSnapshots(originalSale, envelope)
  });

  const result = await executeCheckoutV2(request);
  if (clean(result.saleId) !== clean(envelope.identifiers.replacementSaleId)) {
    throw new Error('Canonical replacement checkout returned an unexpected sale identity.');
  }
  return result;
}
