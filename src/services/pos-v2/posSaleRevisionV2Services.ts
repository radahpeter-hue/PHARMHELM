import { updatePosV2RevisionDraftLine } from './posSaleRevisionV2DraftLines';
import type { BillableService, SaleItem } from '../../types';

export function buildPosV2RevisionServiceLine(service: BillableService, tenantId: string): SaleItem {
  if (!service.id || service.tenantId !== tenantId) throw new Error('Select a service from this tenant’s POS catalogue.');
  const fee = Number(service.defaultFee ?? service.price);
  if (!Number.isFinite(fee) || fee < 0) throw new Error('This service has an invalid configured fee.');
  return { productId: service.id, productName: service.name, lineId: `service:${service.id}`,
    quantity: 1, unitPrice: fee, actualUnitPrice: fee, subtotal: fee,
    costPrice: 0, total: fee, batchId: 'N/A', name: service.name, isService: true, batchNumber: 'N/A', expiryDate: 'N/A' };
}

export function addPosV2RevisionService(items: SaleItem[], service: BillableService, tenantId: string): SaleItem[] {
  const line = buildPosV2RevisionServiceLine(service, tenantId);
  const index = items.findIndex(item => item.isService && item.productId === service.id);
  if (index < 0) return [...items, line];
  return items.map((item, i) => i === index ? updatePosV2RevisionDraftLine(item, item.quantity + 1) : item);
}
