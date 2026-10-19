export type OperationalDeliveryRoute = 'DIRECT_BRANCH' | 'VIA_HQ';

/** Route-less historical receipts were always posted to HQ. Never reinterpret them. */
export function operationalDeliveryRoute(order: { operational_delivery_route?: OperationalDeliveryRoute }): OperationalDeliveryRoute {
  return order.operational_delivery_route || 'VIA_HQ';
}

export function validateOperationalDeliveryRoute(route: OperationalDeliveryRoute, branchId: string): void {
  if (!['DIRECT_BRANCH', 'VIA_HQ'].includes(route)) throw new Error('Choose a valid Operational delivery route.');
  if (!branchId || (route === 'DIRECT_BRANCH' && branchId === 'HQ')) throw new Error('HQ buffer orders must be received into HQ Operational Store.');
}
