import React from 'react';
import type { OperationalDeliveryRoute } from '../../services/operationalDeliveryRoute';

export function OperationalGrnRouteSelector({ value, onChange, branchName, hqOrder, locked }: {
  value: OperationalDeliveryRoute;
  onChange: (route: OperationalDeliveryRoute) => void;
  branchName: string;
  hqOrder: boolean;
  locked: boolean;
}) {
  return <section className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-zinc-900">
    <label htmlFor="operational-delivery-route" className="block text-sm font-bold text-zinc-900">Operational delivery route</label>
    <select id="operational-delivery-route" value={value} disabled={locked || hqOrder}
      onChange={event => onChange(event.target.value as OperationalDeliveryRoute)}
      className="mt-2 min-h-12 w-full rounded-lg border border-emerald-300 bg-white px-3 py-3 text-sm text-zinc-900 disabled:opacity-80">
      {!hqOrder && <option value="DIRECT_BRANCH">Direct to ordering branch: {branchName}</option>}
      <option value="VIA_HQ">Via HQ Operational Store</option>
    </select>
    <p className="mt-2 text-sm text-emerald-950">{value === 'DIRECT_BRANCH'
      ? `Prepare this supplier delivery for dispatch to ${branchName}. HQ stock stays unchanged. Only accepted branch receipt quantities increase branch stock.`
      : 'Post received quantities into HQ Operational stock. A later branch dispatch deducts HQ stock; branch stock increases only on receipt.'}</p>
    <p className="mt-2 text-xs font-medium text-emerald-900">{locked
      ? 'This order already has a posted GRN. Its route is locked.'
      : hqOrder ? 'HQ buffer orders are received into HQ Operational Store.' : 'The route is locked when the first GRN posts, including partial deliveries.'}</p>
  </section>;
}
