// Stable line IDs let a retried save reuse the same requisition.
export function manualStockOrderWrites(orderId: string, order: Record<string, any>, lines: Record<string, any>[]): { id: string; data: Record<string, any> }[] {
  if (!orderId || !order.tenantId || !['draft', 'submitted'].includes(order.status)) throw new Error('Invalid stock order.');
  if (!lines.length || lines.length > 500) throw new Error('A stock order requires between 1 and 500 products.');
  const seen = new Set<string>();
  return lines.map(line => {
    if (!line.product_id || seen.has(line.product_id)) throw new Error('Order items must be unique.');
    seen.add(line.product_id);
    if (line.inventoryClass !== order.inventoryClass || line.tenantId !== order.tenantId) throw new Error('Order lines must share the order tenant and inventory stream.');
    if (order.inventoryClass === 'OPERATIONAL' && !line.masterItemId) throw new Error('Operational items must have a tenant-wide identity.');
    if (!Number.isFinite(line.qty_ordered) || line.qty_ordered <= 0 || !Number.isFinite(line.unit_cost_ugx) || line.unit_cost_ugx < 0 || !Number.isFinite(line.line_total_ugx) || line.line_total_ugx !== line.qty_ordered * line.unit_cost_ugx) throw new Error('Invalid order quantity or cost.');
    const { id, ...fields } = line;
    const definedFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    return { id: `${orderId}_${encodeURIComponent(line.product_id)}`, data: { ...definedFields, order_id: orderId, line_status: 'ordered' } };
  });
}
