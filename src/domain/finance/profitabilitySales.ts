import { isActiveSale } from '../../utils/activeSales';
import { normalizeDateValue } from '../../utils/dateValue';
import { isBusinessDate, kampalaBusinessDate, timestampBusinessDate } from '../../utils/eodBusinessDate';

export type ProfitabilityRecord = Record<string, unknown> & { id: string; tenantId?: string; branchId?: string; branch_id?: string };

export const textValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export const code = (value: unknown) => textValue(value).toLowerCase();
export function amountValue(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function profitabilityDate(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') {
      const date = value.trim();
      if (isBusinessDate(date)) return date;
      if (isBusinessDate(date.slice(0, 10))) {
        const businessDate = timestampBusinessDate(date);
        if (businessDate) return businessDate;
      }
    } else {
      const date = normalizeDateValue(value);
      if (date) return kampalaBusinessDate(date);
    }
  }
  return '';
}

export type SaleCost = { amount: number | null; evidence: 'checkout' | 'historical' | 'unavailable' };

export function historicalSaleLineCost(item: Record<string, unknown>): number | null {
  if (item.isService === true) return 0;
  const quantity = amountValue(item.commercialQuantity ?? item.quantity);
  if (!quantity) return null;
  if (Array.isArray(item.batchAllocations) && item.batchAllocations.length > 0) {
    const expected = amountValue(item.baseQuantity) ?? quantity * (amountValue(item.tierMultiplier) ?? 1);
    let allocated = 0;
    let cost = 0;
    for (const batch of item.batchAllocations) {
      const units = amountValue(batch?.baseQuantity);
      const unitCost = amountValue(batch?.costPerBaseUnit);
      // Older checkout code could default an absent batch purchase price to zero.
      if (!textValue(batch?.batchId) || !units || !unitCost) return null;
      allocated += units;
      cost += units * unitCost;
    }
    return Math.abs(allocated - expected) < 0.000001 ? cost : null;
  }
  const lineCost = amountValue(item.actualLineCost);
  if (lineCost) return lineCost;
  const unitCost = amountValue(item.costPrice);
  // Legacy checkout stores the cost per commercial unit, already converted from packs or base units.
  return unitCost && (textValue(item.batchId) || textValue(item.batchNumber)) ? unitCost * quantity : null;
}

export function saleCostEvidence(sale: Record<string, unknown>): SaleCost {
  const checkout = amountValue(sale.actualSaleCost);
  const items = Array.isArray(sale.items) ? sale.items : [];
  const hasAllocations = items.some(item => item && Array.isArray(item.batchAllocations) && item.batchAllocations.length);
  const costs = items.map(item => item && historicalSaleLineCost(item));
  const completeLines = costs.length > 0 && costs.every(cost => typeof cost === 'number');
  const lineTotal = completeLines ? costs.reduce((sum, cost) => sum + cost, 0) : null;

  if (checkout !== null && (!hasAllocations || (lineTotal !== null && Math.abs(lineTotal - checkout) < 0.000001)) &&
      (checkout > 0 || !items.length || items.every(item => item?.isService === true))) {
    return { amount: checkout, evidence: 'checkout' };
  }
  if (checkout === null && lineTotal !== null) return { amount: lineTotal, evidence: 'historical' };
  const legacyTotal = amountValue(sale.total_cost);
  if (checkout === null && !hasAllocations && legacyTotal) return { amount: legacyTotal, evidence: 'historical' };
  return { amount: null, evidence: 'unavailable' };
}

export type SaleProfitabilityEntry = {
  date: string;
  reference: string;
  gross: number | null;
  discount: number | null;
  net: number | null;
  returns: number;
  cost: SaleCost;
  adjustment?: boolean;
  adjustmentDateMissing?: boolean;
};

export function receiptProfitabilityEntries(sale: ProfitabilityRecord): SaleProfitabilityEntry[] {
  const status = code(sale.status);
  const returned = status === 'returned' || status === 'refunded';
  if (!isActiveSale({ ...sale, status: returned ? 'completed' : status }) ||
      (status && !['completed', 'active', 'returned', 'refunded', 'partially_refunded', 'partially_returned'].includes(status))) return [];

  const date = profitabilityDate(sale.businessDate, sale.accountingDate, sale.timestamp, sale.date, sale.created_at, sale.createdAt);
  const reference = textValue(sale.receiptNumber);
  const recordedNet = amountValue(sale.totalAmount ?? sale.total ?? sale.total_amount ?? sale.amount);
  const subtotal = amountValue(sale.subtotal ?? sale.grossTotal);
  const recordedDiscount = amountValue(sale.discountAmount ?? sale.discount_amount);
  const percentage = amountValue(sale.discountPercentage);
  const percentageDiscount = subtotal !== null && percentage !== null && percentage <= 100 ? subtotal * percentage / 100 : null;
  const net = recordedNet ?? (subtotal !== null && (recordedDiscount ?? percentageDiscount) !== null
    ? Math.max(0, subtotal - (recordedDiscount ?? percentageDiscount)!) : null);
  const discount = recordedDiscount ?? percentageDiscount ??
    (subtotal !== null && net !== null && subtotal >= net ? subtotal - net : null);
  const gross = subtotal ?? (net !== null && discount !== null ? net + discount : null);
  const cost = saleCostEvidence(sale);
  const entries: SaleProfitabilityEntry[] = [{ date, reference, gross, discount, net, returns: 0, cost }];

  // These are receipt-level adjustments. Cash settlements, revision compensations and voids never enter here.
  const explicitRefund = amountValue(sale.refundAmount ?? sale.refund_amount ?? sale.returnAmount);
  const refund = explicitRefund ?? (returned ? net : null);
  if (!returned && !refund && !['partially_refunded', 'partially_returned'].includes(status)) return entries;
  const refundDate = profitabilityDate(sale.refundDate, sale.refundedAt, sale.returnDate, sale.returnedAt);
  const validRefund = refund !== null && net !== null && refund <= net;
  const restored = sale.inventoryRestored === true || sale.returnedToStock === true;
  const recordedCost = amountValue(sale.returnedCost ?? sale.refundedCostOfGoods);
  const stockReturn = status === 'returned' || status === 'partially_returned';
  const noRestock = sale.inventoryRestored === false || sale.returnedToStock === false;
  const returnCost = recordedCost !== null
    ? (cost.amount !== null && recordedCost > cost.amount ? null : recordedCost)
    : restored ? (refund === net ? cost.amount : null)
    : stockReturn && !noRestock ? null : 0;
  entries.push({
    date: refundDate || date, reference, gross: 0, discount: 0,
    net: validRefund ? -refund : null, returns: validRefund ? refund : 0,
    cost: { amount: returnCost === null ? null : -returnCost, evidence: returnCost === null ? 'unavailable' : cost.evidence === 'checkout' ? 'checkout' : 'historical' },
    adjustment: true, adjustmentDateMissing: !refundDate,
  });
  return entries;
}
