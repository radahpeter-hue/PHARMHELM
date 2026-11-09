import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import type { CashOutflow } from '../../domain/finance/cashOutflows';
import { loadCashOutflows } from '../../services/cashOutflowReportService';
import { kampalaBusinessDate } from '../../utils/eodBusinessDate';
import { exportRecordsToExcel } from '../../utils/excelExport';

export function CashOutflowReport({ management = false, refresh = 0 }: { management?: boolean; refresh?: number }) {
  const { profile } = useAuth();
  const tenantId = profile?.tenantId || '';
  const [result, setResult] = useState<{ tenantId: string; refresh: number; reload: number; rows?: CashOutflow[]; error?: string }>();
  const [reload, setReload] = useState(0);
  const [from, setFrom] = useState(() => kampalaBusinessDate().slice(0, 8) + '01');
  const [to, setTo] = useState(() => kampalaBusinessDate());
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [scope, setScope] = useState('');
  const [showUnverified, setShowUnverified] = useState(false);
  const [exportError, setExportError] = useState('');
  const current = result?.tenantId === tenantId && result.refresh === refresh && result.reload === reload ? result : undefined;

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    loadCashOutflows(tenantId).then(rows => {
      if (active) setResult({ tenantId, refresh, reload, rows });
    }).catch(() => {
      if (active) setResult({ tenantId, refresh, reload, error: 'Cash outflows could not be verified. Refresh to retry.' });
    });
    return () => { active = false; };
  }, [tenantId, refresh, reload]);

  const all = (current?.rows || []).filter(row => !management || !row.branchId);
  const branches = [...new Set(all.map(row => row.branchId).filter(Boolean))].sort();
  const categories = [...new Set(all.filter(row => row.status === 'posted').map(row => row.category))].sort();
  const term = search.trim().toLowerCase();
  const periodValid = !from || !to || from <= to;
  const matching = periodValid ? all.filter(row =>
    (!row.date || ((!from || row.date >= from) && (!to || row.date <= to))) &&
    (!category || row.category === category) &&
    (!scope || (scope === 'hq' ? !row.branchId : row.branchId === scope)) &&
    (!term || [row.description, row.category, row.accountName, row.reference, row.sourceId, row.actorId]
      .some(value => value.toLowerCase().includes(term)))) : [];
  const verified = matching.filter(row => row.status === 'posted');
  const unverified = matching.filter(row => row.status === 'unverified');
  const displayed = showUnverified ? unverified : verified;
  const total = verified.reduce((sum, row) => sum + row.amount, 0);

  const download = async () => {
    setExportError('');
    try {
      await exportRecordsToExcel(verified.map(row => ({
        Date: row.date, Scope: row.branchId || 'HQ', Category: row.category, Description: row.description,
        'Amount (UGX)': row.amount, Account: row.accountName, 'Account ID': row.accountId, Portfolio: row.portfolioId,
        Reference: row.reference, 'Source collection': row.sourceCollection, 'Source ID': row.sourceId,
        'Posted by': row.actorId, Status: row.status,
      })), 'Verified Cash Outflows', (management ? 'Management' : 'Global') + '_Verified_Cash_Outflows.xlsx');
    } catch {
      setExportError('The report could not be downloaded.');
    }
  };

  return (
    <section className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 text-zinc-900 sm:p-6">
      <header>
        <h2 className="text-xl font-bold">{management ? 'Verified management payments' : 'Global Cash Outflows'}</h2>
        <p className="mt-1 text-sm text-zinc-600">External payments with a verified account debit and linked source.</p>
      </header>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">From<input className="rounded-lg border p-2" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="grid gap-1">To<input className="rounded-lg border p-2" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        {!management && <label className="grid gap-1">Scope<select className="rounded-lg border p-2" value={scope} onChange={e => setScope(e.target.value)}>
          <option value="">All accounts</option><option value="hq">HQ accounts</option>
          {branches.map(branch => <option key={branch} value={branch}>{branch}</option>)}
        </select></label>}
        <label className="grid gap-1">Category<select className="max-w-52 rounded-lg border p-2" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map(item => <option key={item} value={item}>{item}</option>)}
        </select></label>
        <label className="grid min-w-0 gap-1">Search payments<input className="max-w-full rounded-lg border p-2" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <button type="button" className="min-h-10 rounded-lg border px-3 font-semibold" onClick={() => setReload(value => value + 1)}>Refresh</button>
        <button type="button" className="min-h-10 rounded-lg bg-emerald-800 px-3 font-semibold text-white disabled:opacity-50" disabled={!verified.length} onClick={() => void download()}>Download verified payments</button>
      </div>
      <p className="text-sm text-zinc-600">
        Coverage depends on payment evidence. Pending expenses and payroll finalization do not establish payment. Marketing and other departmental spend without a verified account debit are outside this total.
      </p>
      {exportError && <p role="alert" className="text-sm text-red-800">{exportError}</p>}
      {!periodValid && <p role="alert" className="text-sm text-red-800">Choose an end date on or after the start date.</p>}
      {current?.error ? <p role="alert" className="text-sm text-red-800">{current.error}</p> : !current?.rows ? (
        <p role="status" className="text-sm text-zinc-600">Loading cash outflows…</p>
      ) : periodValid && <>
        <p className="text-lg font-bold">Verified total · UGX {total.toLocaleString()}</p>
        <button type="button" aria-pressed={showUnverified} className="rounded-lg border px-3 py-2 text-sm font-semibold"
          onClick={() => setShowUnverified(value => !value)}>
          {showUnverified ? 'Show verified payments' : 'Review unverified debits (' + unverified.length + ')'}
        </button>
        {showUnverified && <p className="text-sm text-amber-800">These debits lack enough evidence for the verified total. Undated records remain visible for review.</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="bg-zinc-100"><tr>{['Payment date', 'Scope', 'Category and description', 'Source account', 'Reference and source', 'Amount (UGX)'].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {displayed.map(row => <tr key={row.id}>
                <td className="p-3">{row.date || 'Unknown'}</td>
                <td className="p-3">{row.branchId || (row.accountId ? 'HQ' : 'Unresolved')}</td>
                <td className="p-3"><strong>{row.category}</strong><div>{row.description}</div></td>
                <td className="p-3"><strong>{row.accountName || 'Unresolved'}</strong><div className="break-all">{row.portfolioId}</div></td>
                <td className="p-3 break-all"><strong>{row.reference}</strong><div>{row.sourceCollection}/{row.sourceId}</div>{row.actorId && <div>Posted by {row.actorId}</div>}</td>
                <td className="p-3 font-semibold">{row.amount ? row.amount.toLocaleString() : 'Unknown'}</td>
              </tr>)}
              {!displayed.length && <tr><td colSpan={6} className="p-4 text-zinc-600">{showUnverified ? 'No unverified debits match this filter.' : 'No verified payments match this filter.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </>}
    </section>
  );
}
