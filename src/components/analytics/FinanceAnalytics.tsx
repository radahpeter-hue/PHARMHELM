import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PieChart as PieChartIcon, RefreshCw, TrendingUp, Wallet } from 'lucide-react';
import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import type { EODReconciliation } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useProfitabilityData } from '../../hooks/useProfitabilityData';
import { calculateProfitability, operatingExpenseLabels, profitabilityStatement } from '../../domain/finance/profitability';
import type { FinanceDateRange } from '../../utils/financeDateFilters';

const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#0891b2', '#64748b'];
const money = (amount: number | null) => amount === null ? 'Unavailable' : `UGX ${amount.toLocaleString('en-UG', { maximumFractionDigits: 2 })}`;

function ReconciliationSummary({ tenantId, branchId, range }: { tenantId: string; branchId?: string; range: FinanceDateRange }) {
  const [records, setRecords] = useState<EODReconciliation[] | 'unavailable'>();
  useEffect(() => {
    let current = true;
    setRecords(undefined);
    const scope = branchId ? [where('branch_id', '==', branchId)] : [];
    void getDocsFromServer(query(collection(db, 'eod_reconciliations'), where('tenantId', '==', tenantId), ...scope))
      .then(snapshot => { if (current) setRecords(snapshot.docs.map(doc => doc.data() as EODReconciliation)); })
      .catch(() => { if (current) setRecords('unavailable'); });
    return () => { current = false; };
  }, [tenantId, branchId]);
  const summary = Array.isArray(records) ? records.reduce((total, row) => {
    if (row.tenantId !== tenantId || (branchId && row.branch_id !== branchId) || row.reconciliation_date < range.start ||
        row.reconciliation_date > range.end || !Number.isFinite(row.total_expected) || !Number.isFinite(row.total_actual)) return total;
    return { expected: total.expected + row.total_expected, declared: total.declared + row.total_actual, count: total.count + 1 };
  }, { expected: 0, declared: 0, count: 0 }) : records;
  return <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-4 sm:p-8">
    <h3 className="text-lg font-bold text-zinc-900">EOD Reconciliation Summary</h3>
    {summary === 'unavailable' ? <p className="text-sm text-zinc-500">EOD reconciliation records could not be loaded.</p>
      : !summary ? <p className="text-sm text-zinc-500">Loading EOD records…</p>
      : !summary.count ? <p className="text-sm text-zinc-500">No reconciliations recorded in this period.</p>
      : <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-2"><dt>Recorded reconciliations</dt><dd>{summary.count}</dd></div>
        <div className="flex justify-between gap-2"><dt>Expected</dt><dd>{money(summary.expected)}</dd></div>
        <div className="flex justify-between gap-2"><dt>Declared</dt><dd>{money(summary.declared)}</dd></div>
        <div className="flex justify-between gap-2"><dt>Variance</dt><dd>{money(summary.declared - summary.expected)}</dd></div>
      </dl>}
  </div>;
}

export const FinanceAnalytics: React.FC<{ isGlobalView: boolean; range: FinanceDateRange }> = ({ isGlobalView, range }) => {
  const { profile, activeBranch, assignedBranches } = useAuth();
  const tenantId = profile?.tenantId;
  const branchId = isGlobalView ? undefined : assignedBranches.find(branch => branch.id === activeBranch?.id && branch.tenantId === tenantId)?.id;
  const { result, refresh } = useProfitabilityData(tenantId);
  const invalidRange = !range.start || !range.end || range.start > range.end;
  const report = useMemo(() => {
    if (!result || !tenantId || (!isGlobalView && !branchId) || invalidRange) return null;
    return calculateProfitability(result.data, { tenantId, branchId, range });
  }, [result, tenantId, isGlobalView, branchId, range, invalidRange]);

  const revenueTrend = useMemo(() => {
    const dailyRevenue = new Map<string, number>();
    for (const entry of report?.sales ?? []) {
      if (entry.net !== null) dailyRevenue.set(entry.date, (dailyRevenue.get(entry.date) ?? 0) + entry.net);
    }
    return [...dailyRevenue].sort(([left], [right]) => left.localeCompare(right)).map(([day, revenue]) => ({ day, revenue }));
  }, [report]);

  const completeSources = result?.unavailable.length === 0;
  const expenseCategories = report && completeSources ? Object.entries(operatingExpenseLabels)
    .map(([category, name]) => ({ name, value: report.totals[category as keyof typeof operatingExpenseLabels] }))
    .filter(category => category.value > 0) : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-600">
          {isGlobalView ? 'Organisation' : branchId ? activeBranch?.name : 'No assigned branch selected'} · {range.start} to {range.end} · Kampala
        </p>
        <button type="button" onClick={refresh} className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {invalidRange && <p role="alert" className="text-sm text-red-700">Choose a valid start and end date.</p>}
      {!result && <p role="status" className="text-sm text-zinc-500">Loading profitability records…</p>}
      {!!result?.unavailable.length && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        This statement is incomplete. These sources could not be loaded: {result.unavailable.join(', ')}.
      </p>}
      {report && <>
        {report.limitations.length > 0 && <ul role="status" className="space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {report.limitations.map(note => <li key={note}>{note}</li>)}
        </ul>}
        {completeSources && <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            { label: 'Net Profit Margin', value: report.netMargin == null ? 'Unavailable' : `${report.netMargin.toFixed(1)}%`, icon: TrendingUp },
            { label: 'Total Operating Expenses', value: money(report.operatingExpenses), icon: Wallet },
            { label: 'Financial Charges', value: money(report.totals.financialCharges), icon: PieChartIcon },
          ].map(({ label, value, icon: Icon }) => <div key={label} className="space-y-2 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            <Icon className="text-emerald-600" size={20} />
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">{label}</p>
            <p className="text-2xl font-black text-zinc-900">{value}</p>
          </div>)}
        </div>}
        {!result?.unavailable.includes('Sales') && <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="min-w-0 rounded-3xl border border-zinc-200 bg-white p-4 sm:p-8 lg:col-span-2">
            <h3 className="mb-4 font-bold text-zinc-900">Net Sales Revenue by Day</h3>
            {revenueTrend.length === 0 ? <p className="text-sm text-zinc-500">No sales recorded for this period.</p> :
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={day => day.slice(5)} />
                    <YAxis tickFormatter={value => value.toLocaleString('en-UG')} />
                    <Tooltip formatter={value => money(Number(value))} />
                    <Bar name="Net Sales Revenue" dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>}
          </div>
          <div className="min-w-0 rounded-3xl border border-zinc-200 bg-white p-4 sm:p-8">
            <h3 className="mb-4 font-bold text-zinc-900">Expense Category Breakdown</h3>
            {!completeSources ? <p className="text-sm text-zinc-500">Complete expense data is unavailable.</p> : expenseCategories.length === 0 ? <p className="text-sm text-zinc-500">No recognized operating expenses for this period.</p> :
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={expenseCategories} dataKey="value" nameKey="name" innerRadius={42} outerRadius={65}>
                      {expenseCategories.map((entry, index) => <Cell key={entry.name} fill={colors[index % colors.length]} />)}
                    </Pie>
                    <Tooltip formatter={value => money(Number(value))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>}
          </div>
        </div>}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-4 sm:p-8">
          <h3 className="text-lg font-bold text-zinc-900">{isGlobalView ? 'Organisation P&L Summary' : 'Branch P&L Summary'}</h3>
          <dl className="space-y-2">
            {profitabilityStatement(report)
              .filter(row => completeSources || row.sales && !result?.unavailable.includes('Sales'))
              .map(row => <div key={row.label}
              className={`flex flex-wrap justify-between gap-2 rounded-xl p-3 text-sm ${row.total ? 'bg-emerald-50 font-extrabold' : 'bg-zinc-50'}`}>
              <dt>{row.label}</dt><dd className="font-bold">{money(row.amount)}</dd>
            </div>)}
          </dl>
        </div>
        {tenantId && <ReconciliationSummary tenantId={tenantId} branchId={branchId} range={range} />}
        </div>
      </>}
    </div>
  );
};
