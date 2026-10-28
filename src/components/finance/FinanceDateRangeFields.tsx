import React from 'react';
import type { FinanceDateRange } from '../../utils/financeDateFilters';

export function FinanceDateRangeFields({ label, value, onChange }: {
  label: string; value: FinanceDateRange; onChange: (range: FinanceDateRange) => void;
}) {
  return <fieldset aria-label={label} className="flex min-w-0 flex-wrap items-end gap-2 mt-3 text-xs text-zinc-700">
    <label className="min-w-0 flex-1">From
      <input aria-label={`${label} from`} type="date" value={value.start}
        onChange={e => onChange({ ...value, start: e.target.value })}
        className="block w-full min-w-0 rounded-lg border border-zinc-200 bg-white text-zinc-900 p-2" />
    </label>
    <label className="min-w-0 flex-1">To
      <input aria-label={`${label} to`} type="date" value={value.end}
        onChange={e => onChange({ ...value, end: e.target.value })}
        className="block w-full min-w-0 rounded-lg border border-zinc-200 bg-white text-zinc-900 p-2" />
    </label>
    {value.start && value.end && value.start > value.end && <p role="alert" className="w-full text-red-600">From date must be on or before To date.</p>}
  </fieldset>;
}
