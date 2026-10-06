import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Globe2, RefreshCw, Search } from 'lucide-react';
import type { Branch, Staff } from '../../types';
import type { PosV2RevisionLedgerEntry } from '../../services/pos-v2/posSaleRevisionV2Ledger';
import { loadPosV2RevisionLedger } from '../../services/pos-v2/posSaleRevisionV2LedgerRepository';
import { buildPosV2GlobalRevisionAnalytics } from '../../services/pos-v2/posSaleRevisionV2Analytics';
import { firestoreService } from '../../services/firestore';
import { formatDateValue, normalizeDateValue } from '../../utils/dateValue';

interface Props {
  tenantId: string;
  actorUid: string;
}

const money = (value: number) => `UGX ${Number(value || 0).toLocaleString()}`;
const occurredAt = (entry: PosV2RevisionLedgerEntry): unknown => entry.timestamps.completedAt
  || entry.timestamps.updatedAt
  || entry.timestamps.firstAttemptAt
  || entry.timestamps.originalSaleAt;

export const PosV2GlobalRevisionAnalytics: React.FC<Props> = ({ tenantId, actorUid }) => {
  const [entries, setEntries] = useState<PosV2RevisionLedgerEntry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const branchNames = useMemo(() => new Map(branches.map(branch => [branch.id, branch.name])), [branches]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      firestoreService.getCollection<Staff>('staff', tenantId),
      firestoreService.getCollection<Branch>('branches', tenantId)
    ]).then(async ([staff, tenantBranches]) => {
      const ledger = await loadPosV2RevisionLedger({ kind: 'GLOBAL', tenantId, actorUid }, staff);
      if (active) {
        setBranches(tenantBranches);
        setEntries(ledger);
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load global revision analytics.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [actorUid, refreshKey, tenantId]);

  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;
    return entries.filter(entry => {
      const timestamp = normalizeDateValue(occurredAt(entry));
      const text = [entry.originalReceiptNumber, entry.replacementReceiptNumber, entry.reason,
        entry.originalSeller.name, entry.revisionEditor.name, entry.branchId, branchNames.get(entry.branchId)].join(' ').toLowerCase();
      return (!term || text.includes(term))
        && (!from || (timestamp !== null && timestamp >= from))
        && (!to || (timestamp !== null && timestamp <= to));
    });
  }, [branchNames, dateFrom, dateTo, entries, search]);

  const analytics = useMemo(
    () => buildPosV2GlobalRevisionAnalytics(filteredEntries, { tenantId }, branches),
    [branches, filteredEntries, tenantId]
  );

  return (
    <section className="overflow-hidden rounded-3xl border border-indigo-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-indigo-100 bg-indigo-50/50 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-indigo-600" /><h2 className="text-lg font-black text-zinc-900">Global POS V2 Revision Analytics</h2></div>
          <p className="mt-1 text-xs text-zinc-500">Tenant-wide, read-only correction activity grouped by branch.</p>
        </div>
        <button type="button" disabled={loading} onClick={() => setRefreshKey(value => value + 1)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-2 text-xs font-black uppercase text-indigo-700 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Revisions', analytics.revisedReceiptCount.toLocaleString()],
          ['Original value', money(analytics.originalValue)],
          ['Corrected value', money(analytics.correctedValue)],
          ['Additions', `+${money(analytics.additions)}`],
          ['Deductions', `-${money(analytics.deductions)}`],
          ['Net change', `${analytics.netChange > 0 ? '+' : ''}${money(analytics.netChange)}`]
        ].map(([label, value]) => <div key={label} className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4"><p className="text-[9px] font-black uppercase tracking-wider text-zinc-400">{label}</p><p className="mt-1 text-sm font-black text-zinc-900">{value}</p></div>)}
      </div>

      <div className="mx-5 mb-5 grid gap-3 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="relative"><span className="sr-only">Search global revision report</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Branch, receipt, editor, seller or reason" className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-xs font-semibold" /></label>
        <label className="flex items-center gap-2"><span className="text-[9px] font-black uppercase text-zinc-400">From</span><input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs" /></label>
        <label className="flex items-center gap-2"><span className="text-[9px] font-black uppercase text-zinc-400">To</span><input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs" /></label>
      </div>

      {error && <div className="mx-5 mb-5 flex gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
      {loading ? <p className="p-10 text-center text-sm font-semibold text-zinc-400">Loading tenant-wide revision evidence…</p> : (
        <div className="space-y-6 px-5 pb-6">
          <div className="overflow-x-auto rounded-2xl border border-zinc-200">
            <table className="min-w-full text-left text-xs"><thead className="bg-zinc-50 text-[9px] font-black uppercase text-zinc-400"><tr><th className="p-3">Branch</th><th className="p-3">Revisions</th><th className="p-3">Original</th><th className="p-3">Corrected</th><th className="p-3">Additions</th><th className="p-3">Deductions</th><th className="p-3">Net</th></tr></thead><tbody>
              {analytics.branches.map(branch => <tr key={branch.branchId} className="border-t border-zinc-100"><td className="p-3 font-black text-zinc-800">{branch.branchName}</td><td className="p-3">{branch.revisedReceiptCount}</td><td className="p-3">{money(branch.originalValue)}</td><td className="p-3">{money(branch.correctedValue)}</td><td className="p-3 text-emerald-700">+{money(branch.additions)}</td><td className="p-3 text-rose-700">-{money(branch.deductions)}</td><td className="p-3 font-black">{branch.netChange > 0 ? '+' : ''}{money(branch.netChange)}</td></tr>)}
            </tbody></table>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-zinc-200">
            <table className="min-w-full text-left text-xs"><thead className="bg-zinc-50 text-[9px] font-black uppercase text-zinc-400"><tr><th className="p-3">Branch / date</th><th className="p-3">Receipt linkage</th><th className="p-3">Original seller</th><th className="p-3">Revision editor</th><th className="p-3">Reason</th><th className="p-3">Lifecycle</th><th className="p-3">Delta</th></tr></thead><tbody>
              {filteredEntries.map(entry => <tr key={entry.requestId} className="border-t border-zinc-100 align-top"><td className="p-3"><p className="font-black text-zinc-800">{branchNames.get(entry.branchId) || entry.branchId}</p><p className="mt-1 text-[10px] text-zinc-400">{formatDateValue(occurredAt(entry), 'dd MMM yyyy, HH:mm', 'Not recorded')}</p></td><td className="p-3 font-bold">{entry.originalReceiptNumber} → {entry.replacementReceiptNumber || 'Pending'}</td><td className="p-3">{entry.originalSeller.name || entry.originalSeller.id || 'Not recorded'}</td><td className="p-3">{entry.revisionEditor.name || entry.revisionEditor.id}</td><td className="max-w-xs p-3">{entry.reason}</td><td className="p-3 font-bold">{entry.lifecycleStatus.replaceAll('_', ' ')}</td><td className={`p-3 font-black ${entry.monetaryDelta < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{entry.monetaryDelta > 0 ? '+' : ''}{money(entry.monetaryDelta)}</td></tr>)}
            </tbody></table>
          </div>
          {filteredEntries.length === 0 && <p className="py-6 text-center text-sm font-semibold text-zinc-400">No revision activity matches these global report filters.</p>}
        </div>
      )}
    </section>
  );
};
