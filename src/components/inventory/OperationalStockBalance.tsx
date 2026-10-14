import React from 'react';
import { operationalIssueUnit, operationalStockQuantity } from '../../utils/operationalStock';

export const OperationalStockBalance: React.FC<{ quantity: unknown; unit: unknown }> = ({ quantity, unit }) => {
  const balance = operationalStockQuantity(quantity);
  const issueUnit = operationalIssueUnit(unit);
  return <div className="inline-flex flex-col gap-1 text-zinc-900">
    <span className="font-bold text-sm">{balance === null ? 'Check balance' : balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
    <span className="text-xs font-medium text-zinc-700">{issueUnit || 'Unit not specified'}</span>
    {balance === 0 && <span className="text-xs font-semibold text-red-700">Out of stock</span>}
    {balance === null && <span className="text-xs font-semibold text-red-700">Invalid stock quantity</span>}
  </div>;
};
