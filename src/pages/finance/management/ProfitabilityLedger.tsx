import React, { useMemo, useState } from 'react';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfitabilityData } from '../../../hooks/useProfitabilityData';
import { calculateProfitability, profitabilityExportRows, profitabilityStatement } from '../../../domain/finance/profitability';
import { profitabilityPeriodRange, type ProfitabilityPeriod } from '../../../utils/profitabilityPeriod';
import { kampalaBusinessDate } from '../../../utils/eodBusinessDate';
import { FinanceDateRangeFields } from '../../../components/finance/FinanceDateRangeFields';
import { exportRecordsToExcel } from '../../../utils/excelExport';

const ugx = (amount: number | null) => amount === null ? 'Unavailable' : `UGX ${amount.toLocaleString('en-UG', { maximumFractionDigits: 2 })}`;

export const ProfitabilityLedger: React.FC<{ branchOnly?: boolean }> = ({ branchOnly = false }) => {
  const { profile, activeBranchId, assignedBranches } = useAuth();
  const tenantId = profile?.tenantId;
  const branchChoices = assignedBranches.filter(branch => branch.tenantId === tenantId);
  const [selectedBranchId, setSelectedBranchId] = useState(activeBranchId || '');
  const selectedBranch = branchChoices.find(branch => branch.id === selectedBranchId) || branchChoices[0];
  const reportBranchId = selectedBranch?.id || '';
  const { result, refresh } = useProfitabilityData(tenantId);
  const [isDateFilterActive, setIsDateFilterActive] = useState(true);
  const [period, setPeriod] = useState<ProfitabilityPeriod | 'custom'>('today');
  const [periodAnchor, setPeriodAnchor] = useState(kampalaBusinessDate);
  const [dateRange, setDateRange] = useState(() => profitabilityPeriodRange('today'));
  const invalidRange = isDateFilterActive && !!dateRange.start && !!dateRange.end && dateRange.start > dateRange.end;
  const report = useMemo(() => result && tenantId && (!branchOnly || reportBranchId) && !invalidRange
    ? calculateProfitability(result.data, {
      tenantId, branchId: branchOnly ? reportBranchId : undefined, range: isDateFilterActive ? dateRange : undefined,
    }) : null, [result, tenantId, branchOnly, reportBranchId, dateRange, isDateFilterActive, invalidRange]);
  const completeSources = result?.unavailable.length === 0;

  const selectPeriod = (value: ProfitabilityPeriod | 'custom') => {
    setPeriod(value);
    setIsDateFilterActive(true);
    if (value !== 'custom') {
      const anchor = value === 'today' ? kampalaBusinessDate() : periodAnchor;
      setPeriodAnchor(anchor);
      setDateRange(profitabilityPeriodRange(value, anchor));
    }
  };

  const title = branchOnly ? 'Branch P&L' : 'Consolidated Organisation P&L';
  const periodLabel = isDateFilterActive ? `${dateRange.start || 'Earliest'} to ${dateRange.end || 'Latest'}` : 'All dates';
  const handleExport = async () => {
    if (!report || !completeSources) return;
    const rows = profitabilityExportRows(report);
    rows.push({ Metric: 'Reporting scope', 'Value (UGX)': '', Margin: '', Notes: selectedBranch && branchOnly ? selectedBranch.name : 'Organisation' });
    rows.push({ Metric: 'Reporting period (Kampala)', 'Value (UGX)': '', Margin: '', Notes: periodLabel });
    try {
      const periodSuffix = isDateFilterActive ? `${dateRange.start || 'earliest'}_to_${dateRange.end || 'latest'}` : 'all_dates';
      await exportRecordsToExcel(rows, title, `${branchOnly ? 'Branch_PnL' : 'Consolidated_Organisation_PnL'}_${periodSuffix}.xlsx`);
      toast.success('Profitability statement downloaded.');
    } catch (error) {
      console.error('Unable to export profitability statement', error);
      toast.error('Unable to download the profitability statement.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-2xl font-bold text-zinc-900">{title}</h2>
        {branchOnly && <label className="block text-sm text-zinc-700">Branch
          <select aria-label="P&L branch" value={reportBranchId} onChange={e => setSelectedBranchId(e.target.value)}
            className="block w-full sm:w-auto max-w-full bg-white text-zinc-900 border border-zinc-200 rounded-xl p-2">
            {!branchChoices.length && <option value="">No assigned branch</option>}
            {branchChoices.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>}
        <p className="text-xs text-zinc-500">{branchOnly
          ? 'Includes transactions attributable to the selected branch.'
          : 'Includes all branches, HQ and expenses without a branch allocation.'} Sales use recorded net receipt values.</p>
      </div>
      <div className="bg-zinc-50 border border-zinc-200 p-4 sm:p-6 rounded-3xl flex flex-col gap-4 shadow-sm">
        <div>
          <h4 className="font-extrabold text-zinc-950 text-sm">P&L Reporting Period</h4>
          <p className="text-xs text-zinc-500">Month is month to date. Monthly, Quarterly and Bi-Annual use full calendar periods. Weeks start on Monday.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-zinc-700">Period
            <select aria-label="P&L period" value={period} onChange={e => selectPeriod(e.target.value as ProfitabilityPeriod | 'custom')}
              className="block rounded-xl border border-zinc-200 bg-white text-zinc-900 p-2">
              <option value="today">Today</option><option value="week">Week</option>
              <option value="month">Month (to date)</option><option value="custom">Custom</option>
              <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="biannual">Bi-Annual</option><option value="annual">Annual</option>
            </select>
          </label>
          {period !== 'custom' && period !== 'today' && <label className="text-xs text-zinc-700">Date within period
            <input aria-label="P&L period anchor" type="date" value={periodAnchor}
              onChange={e => { if (!e.target.value) return; setPeriodAnchor(e.target.value); setDateRange(profitabilityPeriodRange(period, e.target.value)); setIsDateFilterActive(true); }}
              className="block max-w-full rounded-xl border border-zinc-200 bg-white text-zinc-900 p-2" />
          </label>}
          <label className="flex items-center gap-2 text-xs text-zinc-700 p-2">
            <input type="checkbox" checked={isDateFilterActive} onChange={e => setIsDateFilterActive(e.target.checked)} /> Filter Ledger Date
          </label>
        </div>
        {isDateFilterActive && <FinanceDateRangeFields label="P&L dates" value={dateRange}
          onChange={range => { setPeriod('custom'); setDateRange(range); }} />}
      </div>


      {invalidRange && <p role="alert" className="text-sm text-red-700">Choose an end date on or after the start date.</p>}
      {!result && <p role="status" className="text-sm text-zinc-500">Loading profitability records…</p>}
      {result && !completeSources && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        This statement is incomplete. These sources could not be loaded: {result.unavailable.join(', ')}.
      </p>}
      {report && completeSources && <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {([
          ['Gross Profit', report.grossProfit, 'bg-emerald-600'],
          ['Total Recognized Expenses', report.totalExpenses, 'bg-zinc-900'],
          ['Net Profit Before Tax', report.netProfit, report.netProfit !== null && report.netProfit < 0 ? 'bg-red-600' : 'bg-blue-600'],
          ['Confirmed Inventory Losses', report.totals.inventoryLoss, 'bg-zinc-700'],
        ] as const).map(([label, amount, color]) => <div key={label} className={`rounded-3xl p-5 text-white ${color}`}>
          <p className="text-xs font-bold uppercase tracking-wider">{label}</p>
          <p className="mt-1 break-words text-2xl font-black">{ugx(amount)}</p>
        </div>)}
      </div>}

      <div className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-extrabold text-zinc-900">Profitability Breakdown Statement</h3>
          <div className="flex flex-wrap gap-2">
            <button onClick={refresh} className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-xs font-bold">
              <RefreshCw size={14} /> Refresh
            </button>
            <button onClick={handleExport} disabled={!report || !completeSources}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1A5E38] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              <Download size={14} /> Download Excel Statement
            </button>
          </div>
        </div>
        {report && <>
          {report.limitations.length > 0 && <div role="status" className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <ul className="space-y-1">{report.limitations.map(note => <li key={note}>{note}</li>)}</ul>
          </div>}
          <dl className="space-y-2">
            {profitabilityStatement(report)
              .filter(row => completeSources || row.sales && !result?.unavailable.includes('Sales'))
              .map(row => <div key={row.label}
              className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl p-3 text-sm ${row.total ? 'bg-emerald-50 font-extrabold text-zinc-900' : 'bg-zinc-50 text-zinc-700'}`}>
              <dt>{row.label}</dt>
              <dd className="text-right font-bold">{ugx(row.amount)}
                {row.percentage != null && <span className="ml-2 whitespace-nowrap text-xs text-zinc-600">({row.percentage.toFixed(1)}% margin)</span>}
              </dd>
            </div>)}
          </dl>
          <details className="rounded-xl border border-zinc-200 p-3 text-sm">
            <summary className="cursor-pointer font-bold">Recorded cost and expense evidence</summary>
            <p className="mt-2 text-zinc-600">Checkout COGS {ugx(report.verifiedCogs)} · Recovered historical COGS {ugx(report.recoveredCogs)}</p>
            <ul className="mt-2 max-h-72 divide-y divide-zinc-100 overflow-y-auto">
              {report.expenses.map(entry => <li key={entry.key} className="flex flex-wrap justify-between gap-x-3 py-2">
                <span>{entry.date || 'Date unavailable'} · {entry.description}{entry.reference ? ` · ${entry.reference}` : ''}</span>
                <span className="font-bold">{ugx(entry.amount)}</span>
              </li>)}
            </ul>
            <h4 className="mt-3 font-bold">Sales and returns</h4>
            <ul className="mt-2 max-h-72 divide-y divide-zinc-100 overflow-y-auto">
              {report.sales.slice(0, 100).map((entry, index) => <li key={index} className="flex flex-wrap justify-between gap-x-3 py-2">
                <span>{entry.date || 'Date unavailable'} · {entry.adjustment ? 'Return or refund' : 'Sale'} · {entry.reference || 'Receipt reference unavailable'}</span>
                <span>Net {ugx(entry.net)} · COGS {ugx(entry.cost.amount)}</span>
              </li>)}
            </ul>
            {report.sales.length > 100 && <p className="mt-2 text-xs text-zinc-500">Showing 100 of {report.sales.length} sales and returns. Narrow the reporting period to review more receipts.</p>}
          </details>
          <p className="text-xs text-zinc-500">Payroll is recognized at the recorded period end. Legacy payroll uses the recorded month end.</p>
        </>}
      </div>
    </div>
  );
};
