import { OperationalInventory } from '../types';

export interface OperationalHqBufferOrderInput {
  tenantId: string;
  itemId: string;
  quantityPacks: number;
  requestId: string;
  actor: { uid: string; name?: string };
}

export function operationalHqBufferOrderIds(requestId: string) {
  const safeId = requestId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return { orderId: `op_hq_buffer_${safeId}`, lineId: `op_hq_buffer_line_${safeId}` };
}

export function buildOperationalHqBufferOrder(input: OperationalHqBufferOrderInput, item: OperationalInventory, now: string) {
  const ids = operationalHqBufferOrderIds(input.requestId);
  const total = input.quantityPacks * Number(item.costPerPack || 0);
  const order = {
    tenantId: input.tenantId,
    inventoryClass: 'OPERATIONAL' as const,
    category: 'non_sellable' as const,
    order_number: `HQ-OP-${input.requestId.slice(-8).toUpperCase()}`,
    requesting_branch_id: 'HQ',
    requesting_branch_name: 'HQ Operational Store',
    order_type: 'monthly' as const,
    status: 'submitted' as const,
    submitted_at: now,
    created_at: now,
    createdAt: now,
    created_by: input.actor.uid,
    generation_method: 'manual' as const,
    is_emergency: false,
    total_order_value_ugx: total,
    notes: 'Operational HQ buffer replenishment'
  };
  const line = {
    tenantId: input.tenantId,
    inventoryClass: 'OPERATIONAL' as const,
    isOperational: true,
    masterItemId: item.masterItemId!,
    order_id: ids.orderId,
    product_id: item.id,
    product_name: item.name,
    qty_ordered: input.quantityPacks,
    qty_received: 0,
    unit_cost_ugx: Number(item.costPerPack || 0),
    line_total_ugx: total,
    line_status: 'pending' as const,
    createdAt: now
  };
  return { ...ids, order, line };
}
