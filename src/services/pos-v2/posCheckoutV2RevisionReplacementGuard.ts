import { PosCheckoutV2Error } from './posCheckoutV2Errors';
import type { PosCheckoutV2RevisionReplacementContext } from './posCheckoutV2Types';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export interface PosCheckoutV2ReplacementOriginalSaleSnapshot {
  id: string;
  tenantId?: string;
  branchId?: string;
  receiptNumber?: string;
  engineVersion?: number;
  status?: string;
  revisionLocked?: boolean;
  revisionId?: string;
  revisionLifecycle?: string;
  pendingReplacementSaleId?: string;
  supersededBySaleId?: string;
}

export function validatePosCheckoutV2ReplacementOriginalLifecycle(params: {
  context: PosCheckoutV2RevisionReplacementContext;
  originalSale: PosCheckoutV2ReplacementOriginalSaleSnapshot;
  tenantId: string;
  branchId: string;
  preparedSaleId: string;
}): void {
  const { context, originalSale } = params;
  const tenantId = clean(params.tenantId);
  const branchId = clean(params.branchId);
  const preparedSaleId = clean(params.preparedSaleId);

  if (!tenantId || !branchId || !preparedSaleId) {
    throw new PosCheckoutV2Error('IDEMPOTENCY_CONFLICT', 'Replacement checkout authority is incomplete.');
  }
  if (clean(originalSale.id) !== clean(context.originalSaleId)) {
    throw new PosCheckoutV2Error('TRANSACTION_CONFLICT', 'Replacement checkout original sale identity does not match the revision contract.');
  }
  if (clean(originalSale.tenantId) !== tenantId || clean(originalSale.branchId) !== branchId) {
    throw new PosCheckoutV2Error('TENANT_MISMATCH', 'Replacement checkout cannot cross the original sale tenant or branch boundary.');
  }
  if (Number(originalSale.engineVersion || 0) !== 2 || clean(originalSale.status) !== 'completed') {
    throw new PosCheckoutV2Error('TRANSACTION_CONFLICT', 'Only a completed POS V2 sale can be replaced by a revision checkout.');
  }
  if (clean(originalSale.receiptNumber) !== clean(context.originalReceiptNumber)) {
    throw new PosCheckoutV2Error('TRANSACTION_CONFLICT', 'Replacement checkout original receipt identity does not match the revision contract.');
  }
  if (originalSale.revisionLocked !== true || clean(originalSale.revisionId) !== clean(context.revisionId)) {
    throw new PosCheckoutV2Error('TRANSACTION_CONFLICT', 'Original sale revision lock does not belong to this replacement checkout.');
  }
  if (clean(originalSale.revisionLifecycle) !== 'REPLACEMENT_PENDING') {
    throw new PosCheckoutV2Error('TRANSACTION_CONFLICT', 'Original sale has not completed reversal and is not ready for replacement.');
  }
  if (clean(originalSale.pendingReplacementSaleId) !== preparedSaleId || clean(context.replacementSaleId) !== preparedSaleId) {
    throw new PosCheckoutV2Error('IDEMPOTENCY_CONFLICT', 'Original sale replacement identity does not match the canonical replacement sale.');
  }
  if (clean(originalSale.supersededBySaleId)) {
    throw new PosCheckoutV2Error('TRANSACTION_CONFLICT', 'Original sale has already been superseded and cannot create another replacement.');
  }
}
