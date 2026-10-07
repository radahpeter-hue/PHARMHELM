import type { SaleItem } from '../../types';

/** Keep the editor's visible quantity/price and canonical checkout fields aligned. */
export function updatePosV2RevisionDraftLine(item: SaleItem, quantity = item.quantity,
  price = Number(item.actualUnitPrice ?? item.unitPrice)): SaleItem {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) throw new Error('Enter a positive whole quantity.');
  if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid non-negative price.');
  const total = quantity * price;
  const multiplier = Number(item.tierMultiplier || 1);
  return { ...item, quantity, commercialQuantity: quantity, unitPrice: price, actualUnitPrice: price,
    ...(item.tierCode && !item.isService ? { baseQuantity: quantity * multiplier } : {}),
    subtotal: total, total, lineTotal: total };
}
