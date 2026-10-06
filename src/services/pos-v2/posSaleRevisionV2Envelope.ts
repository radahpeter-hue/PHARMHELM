import type { Sale, SaleItem } from '../../types';
import type { PosV2RevisionPlan } from './posSaleRevisionV2Planner';
import { checkoutV2SaleDocumentId } from './posCheckoutV2Identity';
import {
  posCheckoutV2OutboxEventDocumentId,
  posCheckoutV2PaymentDocumentId
} from './posCheckoutV2PaymentOutbox';

export const POS_V2_REVISION_EVENT_TYPE = 'POS_SALE_REVISION_REQUESTED' as const;
export const POS_V2_REVERSAL_EVENT_TYPE = 'POS_SALE_REVERSAL_REQUESTED' as const;

export interface PosV2RevisionActor {
  uid: string;
  name: string;
  role?: string;
}

export interface PosV2RevisionIdentifiers {
  revisionId: string;
  replacementAttemptId: string;
  replacementSaleId: string;
  replacementPaymentId: string;
  replacementOutboxEventId: string;
  reversalEventId: string;
  auditId: string;
}

export interface PosV2RevisionEnvelopeInput {
  originalSale: Sale;
  plan: PosV2RevisionPlan;
  revisedItems: SaleItem[];
  actor: PosV2RevisionActor;
  sequence?: number;
}

export interface PosV2RevisionEnvelope {
  identifiers: PosV2RevisionIdentifiers;
  revision: {
    revisionId: string;
    tenantId: string;
    branchId: string;
    originalSaleId: string;
    originalReceiptNumber: string;
    originalSellerId: string | null;
    originalTimestamp: string;
    revisedById: string;
    revisedByName: string;
    revisedByRole: string | null;
    reason: string;
    originalTotal: number;
    revisedTotal: number;
    monetaryDelta: number;
    adjustmentDirection: 'INCREASE' | 'DECREASE' | 'NO_VALUE_CHANGE';
    changeTypes: string[];
    itemChanges: PosV2RevisionPlan['itemChanges'];
    before: PosV2RevisionPlan['before'];
    after: PosV2RevisionPlan['after'];
    status: 'PLANNED';
    sequence: number;
  };
  originalSalePatch: {
    revisionLifecycle: 'REVERSAL_PENDING';
    revisionLocked: true;
    revisionId: string;
    pendingReplacementSaleId: string;
  };
  replacementSaleSeed: {
    tenantId: string;
    branchId: string;
    engineVersion: 2;
    revisionOfSaleId: string;
    revisionId: string;
    originalReceiptNumber: string;
    items: SaleItem[];
    paymentMethod: string;
    context: string | null;
    patientId: string | null;
    institutionId: string | null;
    prescriberId: string | null;
    discountPercentage: number;
    totalAmount: number;
  };
  reversalOutbox: {
    eventId: string;
    eventType: typeof POS_V2_REVERSAL_EVENT_TYPE;
    tenantId: string;
    branchId: string;
    saleId: string;
    revisionId: string;
    engineVersion: 2;
    status: 'PENDING';
  };
  audit: {
    id: string;
    tenantId: string;
    branchId: string;
    module: 'SALES';
    actionType: 'POS_V2_REVISION';
    objectAffected: 'SALE';
    objectId: string;
    receiptId: string;
    userId: string;
    userName: string;
    userRole: string | null;
    reason: string;
  };
}

function safePart(value: unknown, max = 120): string {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, max);
}

function checksum(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  return (hash >>> 0).toString(16);
}

function deterministicId(prefix: string, ...parts: unknown[]): string {
  const raw = parts.map(part => String(part ?? '')).join('__');
  const body = safePart(raw, 170);
  return `${prefix}_${body}_${checksum(raw)}`.slice(0, 240);
}

export function buildPosV2RevisionIdentifiers(params: {
  tenantId: string;
  originalSaleId: string;
  sequence?: number;
}): PosV2RevisionIdentifiers {
  const sequence = Math.max(1, Math.trunc(Number(params.sequence || 1)));
  const key = `${params.tenantId}__${params.originalSaleId}__rev${sequence}`;
  const revisionId = deterministicId('pos_revision', key);
  const replacementAttemptId = deterministicId('pos_revision_attempt', key);
  const replacementSaleId = checkoutV2SaleDocumentId(params.tenantId, replacementAttemptId);
  const replacementPaymentId = posCheckoutV2PaymentDocumentId(replacementSaleId);
  const replacementOutboxEventId = posCheckoutV2OutboxEventDocumentId(replacementSaleId);
  const reversalEventId = deterministicId('pos_reversal_outbox', params.originalSaleId, revisionId);
  const auditId = deterministicId('audit_pos_revision', params.originalSaleId, revisionId);
  return {
    revisionId,
    replacementAttemptId,
    replacementSaleId,
    replacementPaymentId,
    replacementOutboxEventId,
    reversalEventId,
    auditId
  };
}

export function buildPosV2RevisionEnvelope(input: PosV2RevisionEnvelopeInput): PosV2RevisionEnvelope {
  const { originalSale, plan, actor } = input;
  const sequence = Math.max(1, Math.trunc(Number(input.sequence || 1)));

  if (plan.originalSaleId !== originalSale.id) throw new Error('Revision plan does not belong to the supplied original sale.');
  if (plan.tenantId !== originalSale.tenantId) throw new Error('Revision plan tenant mismatch.');
  if (plan.branchId !== originalSale.branchId) throw new Error('Revision plan branch mismatch.');
  if (!actor.uid || !actor.name) throw new Error('A revision actor with uid and name is required.');
  if (!Array.isArray(input.revisedItems) || input.revisedItems.length === 0) throw new Error('Replacement sale requires at least one item.');

  const identifiers = buildPosV2RevisionIdentifiers({
    tenantId: originalSale.tenantId,
    originalSaleId: originalSale.id,
    sequence
  });

  return {
    identifiers,
    revision: {
      revisionId: identifiers.revisionId,
      tenantId: originalSale.tenantId,
      branchId: originalSale.branchId,
      originalSaleId: originalSale.id,
      originalReceiptNumber: originalSale.receiptNumber,
      originalSellerId: plan.originalSellerId,
      originalTimestamp: originalSale.timestamp,
      revisedById: actor.uid,
      revisedByName: actor.name,
      revisedByRole: actor.role ? String(actor.role) : null,
      reason: plan.revisionReason,
      originalTotal: plan.originalTotal,
      revisedTotal: plan.revisedTotal,
      monetaryDelta: plan.monetaryDelta,
      adjustmentDirection: plan.adjustmentDirection,
      changeTypes: [...plan.changeTypes],
      itemChanges: [...plan.itemChanges],
      before: { ...plan.before },
      after: { ...plan.after },
      status: 'PLANNED',
      sequence
    },
    originalSalePatch: {
      revisionLifecycle: 'REVERSAL_PENDING',
      revisionLocked: true,
      revisionId: identifiers.revisionId,
      pendingReplacementSaleId: identifiers.replacementSaleId
    },
    replacementSaleSeed: {
      tenantId: originalSale.tenantId,
      branchId: originalSale.branchId,
      engineVersion: 2,
      revisionOfSaleId: originalSale.id,
      revisionId: identifiers.revisionId,
      originalReceiptNumber: originalSale.receiptNumber,
      items: input.revisedItems,
      paymentMethod: plan.after.paymentMethod,
      context: plan.after.context,
      patientId: plan.after.patientId,
      institutionId: plan.after.institutionId,
      prescriberId: plan.after.prescriberId,
      discountPercentage: plan.after.discountPercentage,
      totalAmount: plan.revisedTotal
    },
    reversalOutbox: {
      eventId: identifiers.reversalEventId,
      eventType: POS_V2_REVERSAL_EVENT_TYPE,
      tenantId: originalSale.tenantId,
      branchId: originalSale.branchId,
      saleId: originalSale.id,
      revisionId: identifiers.revisionId,
      engineVersion: 2,
      status: 'PENDING'
    },
    audit: {
      id: identifiers.auditId,
      tenantId: originalSale.tenantId,
      branchId: originalSale.branchId,
      module: 'SALES',
      actionType: 'POS_V2_REVISION',
      objectAffected: 'SALE',
      objectId: originalSale.id,
      receiptId: originalSale.receiptNumber,
      userId: actor.uid,
      userName: actor.name,
      userRole: actor.role ? String(actor.role) : null,
      reason: plan.revisionReason
    }
  };
}
