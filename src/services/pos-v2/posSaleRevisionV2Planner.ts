import type { Sale, SaleItem } from '../../types';
import { assertRevisionReason, evaluatePosV2RevisionEligibility, revisionMonetaryDelta } from './posSaleRevisionV2Policy';

export type PosV2RevisionChangeType =
  | 'ITEM_ADDED'
  | 'ITEM_REMOVED'
  | 'QUANTITY_CHANGED'
  | 'PRICE_CHANGED'
  | 'PAYMENT_METHOD_CHANGED'
  | 'CONTEXT_CHANGED'
  | 'PATIENT_CHANGED'
  | 'INSTITUTION_CHANGED'
  | 'PRESCRIBER_CHANGED'
  | 'DISCOUNT_CHANGED';

export interface PosV2RevisionItemChange {
  type: 'ITEM_ADDED' | 'ITEM_REMOVED' | 'QUANTITY_CHANGED' | 'PRICE_CHANGED';
  productId: string;
  productName: string;
  tierCode?: string;
  beforeQuantity?: number;
  afterQuantity?: number;
  beforeUnitPrice?: number;
  afterUnitPrice?: number;
}

export interface PosV2RevisionPlan {
  eligible: true;
  originalSaleId: string;
  originalReceiptNumber: string;
  tenantId: string;
  branchId: string;
  originalSellerId: string | null;
  originalTimestamp: string;
  revisionReason: string;
  originalTotal: number;
  revisedTotal: number;
  monetaryDelta: number;
  adjustmentDirection: 'INCREASE' | 'DECREASE' | 'NO_VALUE_CHANGE';
  changeTypes: PosV2RevisionChangeType[];
  itemChanges: PosV2RevisionItemChange[];
  before: {
    paymentMethod: string;
    context: string | null;
    patientId: string | null;
    institutionId: string | null;
    prescriberId: string | null;
    discountPercentage: number;
  };
  after: {
    paymentMethod: string;
    context: string | null;
    patientId: string | null;
    institutionId: string | null;
    prescriberId: string | null;
    discountPercentage: number;
  };
}

export interface BuildPosV2RevisionPlanInput {
  originalSale: Sale & Partial<{
    engineVersion: number;
    status: string;
    supersededBySaleId: string;
    revisionId: string;
    cashierId: string;
    cashier_id: string;
    staffId: string;
    context: string;
    patientId: string;
    institutionId: string;
    prescriberId: string;
  }>;
  revisedItems: SaleItem[];
  revisedTotal: number;
  paymentMethod?: string;
  context?: string | null;
  patientId?: string | null;
  institutionId?: string | null;
  prescriberId?: string | null;
  discountPercentage?: number;
  reason: string;
  now?: Date;
}

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cleanId = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text || null;
};

const saleTotal = (sale: Sale): number => {
  const explicit = numberValue((sale as any).totalAmount, NaN);
  if (Number.isFinite(explicit)) return explicit;
  return numberValue((sale as any).total, 0);
};

const itemKey = (item: SaleItem): string => {
  const tier = String((item as any).tierCode || 'BASE');
  return `${item.productId}::${tier}`;
};

const itemQuantity = (item: SaleItem): number => numberValue((item as any).quantity, 0);
const itemUnitPrice = (item: SaleItem): number => numberValue((item as any).actualUnitPrice ?? (item as any).unitPrice, 0);
const itemName = (item: SaleItem): string => String((item as any).productName || item.productId || 'Unknown product');

function compareItems(originalItems: SaleItem[], revisedItems: SaleItem[]) {
  const original = new Map(originalItems.map(item => [itemKey(item), item]));
  const revised = new Map(revisedItems.map(item => [itemKey(item), item]));
  const changes: PosV2RevisionItemChange[] = [];

  for (const [key, before] of original) {
    const after = revised.get(key);
    if (!after) {
      changes.push({
        type: 'ITEM_REMOVED',
        productId: before.productId,
        productName: itemName(before),
        tierCode: (before as any).tierCode,
        beforeQuantity: itemQuantity(before),
        beforeUnitPrice: itemUnitPrice(before)
      });
      continue;
    }

    const beforeQty = itemQuantity(before);
    const afterQty = itemQuantity(after);
    if (Math.abs(beforeQty - afterQty) > 0.0001) {
      changes.push({
        type: 'QUANTITY_CHANGED',
        productId: before.productId,
        productName: itemName(before),
        tierCode: (before as any).tierCode,
        beforeQuantity: beforeQty,
        afterQuantity: afterQty,
        beforeUnitPrice: itemUnitPrice(before),
        afterUnitPrice: itemUnitPrice(after)
      });
    }

    const beforePrice = itemUnitPrice(before);
    const afterPrice = itemUnitPrice(after);
    if (Math.abs(beforePrice - afterPrice) > 0.0001) {
      changes.push({
        type: 'PRICE_CHANGED',
        productId: before.productId,
        productName: itemName(before),
        tierCode: (before as any).tierCode,
        beforeQuantity: beforeQty,
        afterQuantity: afterQty,
        beforeUnitPrice: beforePrice,
        afterUnitPrice: afterPrice
      });
    }
  }

  for (const [key, after] of revised) {
    if (original.has(key)) continue;
    changes.push({
      type: 'ITEM_ADDED',
      productId: after.productId,
      productName: itemName(after),
      tierCode: (after as any).tierCode,
      afterQuantity: itemQuantity(after),
      afterUnitPrice: itemUnitPrice(after)
    });
  }

  return changes;
}

export function buildPosV2RevisionPlan(input: BuildPosV2RevisionPlanInput): PosV2RevisionPlan {
  const eligibility = evaluatePosV2RevisionEligibility(input.originalSale as any, input.now || new Date());
  if (!eligibility.allowed) {
    throw new Error(`POS V2 revision is not allowed: ${eligibility.code}.`);
  }

  const reason = assertRevisionReason(input.reason);
  const originalTotal = saleTotal(input.originalSale);
  const revisedTotal = numberValue(input.revisedTotal, NaN);
  if (!Number.isFinite(revisedTotal) || revisedTotal < 0) {
    throw new Error('Revised total must be a valid non-negative number.');
  }

  if (!Array.isArray(input.revisedItems) || input.revisedItems.length === 0) {
    throw new Error('A revised sale must contain at least one line item.');
  }

  const itemChanges = compareItems(input.originalSale.items || [], input.revisedItems);
  const before = {
    paymentMethod: String(input.originalSale.paymentMethod || ''),
    context: cleanId((input.originalSale as any).context),
    patientId: cleanId((input.originalSale as any).patientId),
    institutionId: cleanId((input.originalSale as any).institutionId),
    prescriberId: cleanId((input.originalSale as any).prescriberId),
    discountPercentage: numberValue(input.originalSale.discountPercentage, 0)
  };
  const after = {
    paymentMethod: String(input.paymentMethod ?? input.originalSale.paymentMethod ?? ''),
    context: input.context === undefined ? before.context : cleanId(input.context),
    patientId: input.patientId === undefined ? before.patientId : cleanId(input.patientId),
    institutionId: input.institutionId === undefined ? before.institutionId : cleanId(input.institutionId),
    prescriberId: input.prescriberId === undefined ? before.prescriberId : cleanId(input.prescriberId),
    discountPercentage: numberValue(input.discountPercentage ?? input.originalSale.discountPercentage, 0)
  };

  const changeTypes = new Set<PosV2RevisionChangeType>(itemChanges.map(change => change.type));
  if (before.paymentMethod !== after.paymentMethod) changeTypes.add('PAYMENT_METHOD_CHANGED');
  if (before.context !== after.context) changeTypes.add('CONTEXT_CHANGED');
  if (before.patientId !== after.patientId) changeTypes.add('PATIENT_CHANGED');
  if (before.institutionId !== after.institutionId) changeTypes.add('INSTITUTION_CHANGED');
  if (before.prescriberId !== after.prescriberId) changeTypes.add('PRESCRIBER_CHANGED');
  if (Math.abs(before.discountPercentage - after.discountPercentage) > 0.0001) changeTypes.add('DISCOUNT_CHANGED');

  if (changeTypes.size === 0 && Math.abs(originalTotal - revisedTotal) <= 0.0001) {
    throw new Error('The revised sale does not contain any changes.');
  }

  const monetary = revisionMonetaryDelta(originalTotal, revisedTotal);
  const originalSellerId = cleanId(
    (input.originalSale as any).cashierId
    ?? (input.originalSale as any).cashier_id
    ?? (input.originalSale as any).staffId
    ?? (input.originalSale as any).operatorUid
  );

  return {
    eligible: true,
    originalSaleId: input.originalSale.id,
    originalReceiptNumber: input.originalSale.receiptNumber,
    tenantId: input.originalSale.tenantId,
    branchId: input.originalSale.branchId,
    originalSellerId,
    originalTimestamp: input.originalSale.timestamp,
    revisionReason: reason,
    originalTotal,
    revisedTotal,
    monetaryDelta: monetary.delta,
    adjustmentDirection: monetary.direction,
    changeTypes: [...changeTypes],
    itemChanges,
    before,
    after
  };
}
