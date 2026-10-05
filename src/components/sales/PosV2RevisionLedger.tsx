import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { Staff } from '../../types';
import type { PosV2RevisionLedgerEntry } from '../../services/pos-v2/posSaleRevisionV2Ledger';
import { loadPosV2RevisionLedger } from '../../services/pos-v2/posSaleRevisionV2LedgerRepository';
import { buildPosV2BranchRevisionAnalytics } from '../../services/pos-v2/posSaleRevisionV2Analytics';
import { formatDateValue, normalizeDateValue } from '../../utils/dateValue';

interface PosV2RevisionLedgerProps {
  tenantId: string;
  branchId: string;
  actorUid: string;
  staff: Staff[];
}

const money = (value: number) => `UGX ${Number(value || 0).toLocaleString()}`;
const date = (value: unknown) => formatDateValue(value, 'dd MMM yyyy, HH:mm', 'Not recorded');

const directionClass: Record<PosV2RevisionLedgerEntry['adjustmentDirection'], string> = {
  INCREASE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DECREASE: 'bg-rose-50 text-rose-700 border-rose-200',
  NO_VALUE_CHANGE: 'bg-zinc-50 text-zinc-700 border-zinc-200'
};

export const PosV2RevisionLedger: React.FC<PosV2RevisionLedgerProps> = ({
  tenantId,
  branchId,
  actorUid,
  staff
}) => {
  const [entries, setEntries] = useState<PosV2RevisionLedgerEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadPosV2RevisionLedger({ kind: 'BRANCH', tenantId, branchId, actorUid }, staff)
      .then(result => {
        if (active) setEntries(result);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load the revision ledger.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [tenantId, branchId, actorUid, staff, refreshKey]);

  const statuses = useMemo(() => Array.from(new Set(entries.map(entry => entry.lifecycleStatus))).sort(), [entries]);
  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;

    return entries.filter(entry => {
      const occurredAt = normalizeDateValue(
        entry.timestamps.completedAt
        || entry.timestamps.updatedAt
        || entry.timestamps.firstAttemptAt
        || entry.timestamps.originalSaleAt
      );
      const searchable = [
        entry.originalReceiptNumber,
        entry.replacementReceiptNumber,
        entry.revisionId,
        entry.reason,
        entry.originalSeller.name,
        entry.revisionEditor.name
      ].join(' ').toLowerCase();
      return (!term || searchable.includes(term))
        && (status === 'ALL' || entry.lifecycleStatus === status)
        && (!from || (occurredAt !== null && occurredAt >= from))
        && (!to || (occurredAt !== null && occurredAt <= to));
    });
  }, [dateFrom, dateTo, entries, search, status]);

  const analytics = useMemo(
    () => buildPosV2BranchRevisionAnalytics(filteredEntries, { tenantId, branchId }),
    [filteredEntries, tenantId, branchId]
  );

  return (
    <section className="flex-1 min-h-0 overflow-y-auto rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <header className="sticky top-0 z-10 flex flex-col gap-4 border-b border-zinc-100 bg-white/95 p-5 backdrop-blur md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-black text-zinc-900">Immutable Revision Ledger</h2>
          </div>
          <p className="mt-1 text-xs text-zinc-500">Permanent branch evidence. Completed transactions cannot be edited or deleted here.</p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey(value => value + 1)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 py-2 text-xs font-black uppercase tracking-wider text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
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
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
            <p className="text-[9px] font-black uppercase tracking-wider text-zinc-400">{label}</p>
            <p className="mt-1 text-sm font-black text-zinc-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="mx-5 mb-5 grid gap-3 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <label className="relative">
          <span className="sr-only">Search revision report</span>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Receipt, editor, seller, reason or revision"
            className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-xs font-semibold text-zinc-700 outline-none focus:border-indigo-400"
          />
        </label>
        <label>
          <span className="sr-only">Lifecycle status</span>
          <select value={status} onChange={event => setStatus(event.target.value)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-bold text-zinc-700">
            <option value="ALL">All lifecycle states</option>
            {statuses.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[9px] font-black uppercase text-zinc-400">From</span>
          <input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[9px] font-black uppercase text-zinc-400">To</span>
          <input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700" />
        </label>
      </div>

      {error && (
        <div className="mx-5 mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-sm font-semibold text-zinc-400">Loading immutable revision evidence…</div>
      ) : entries.length === 0 ? (
        <div className="p-12 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-zinc-300" />
          <p className="mt-3 text-sm font-bold text-zinc-600">No revision records exist for this branch.</p>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="p-12 text-center">
          <Search className="mx-auto h-8 w-8 text-zinc-300" />
          <p className="mt-3 text-sm font-bold text-zinc-600">No revision records match these report filters.</p>
        </div>
      ) : (
        <div className="space-y-3 px-5 pb-6">
          {filteredEntries.map(entry => {
            const isOpen = expanded === entry.requestId;
            return (
              <article key={entry.requestId} className="overflow-hidden rounded-2xl border border-zinc-200">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : entry.requestId)}
                  className="grid w-full grid-cols-1 gap-3 p-4 text-left hover:bg-zinc-50 md:grid-cols-[1.3fr_1fr_1fr_auto] md:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-black text-zinc-900">{entry.originalReceiptNumber}</span>
                      <span className="text-zinc-300">→</span>
                      <span className="font-black text-indigo-700">{entry.replacementReceiptNumber || 'Replacement pending'}</span>
                    </div>
                    <p className="mt-1 text-[10px] font-mono text-zinc-400">Revision {entry.revisionId}</p>
                    <p className="mt-1 text-[10px] font-semibold text-zinc-500">{date(entry.timestamps.completedAt || entry.timestamps.updatedAt || entry.timestamps.firstAttemptAt || entry.timestamps.originalSaleAt)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-zinc-400">Lifecycle</p>
                    <p className="mt-1 text-xs font-black text-zinc-700">{entry.lifecycleStatus.replaceAll('_', ' ')}</p>
                  </div>
                  <div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${directionClass[entry.adjustmentDirection]}`}>
                      {entry.adjustmentDirection.replaceAll('_', ' ')} · {entry.monetaryDelta > 0 ? '+' : ''}{money(entry.monetaryDelta)}
                    </span>
                  </div>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
                </button>

                {isOpen && (
                  <div className="border-t border-zinc-100 bg-zinc-50/60 p-5">
                    <div className="grid gap-4 text-xs md:grid-cols-3">
                      <div><p className="font-black uppercase text-zinc-400">Original seller</p><p className="mt-1 font-bold text-zinc-800">{entry.originalSeller.name || entry.originalSeller.id || 'Not recorded'}</p></div>
                      <div><p className="font-black uppercase text-zinc-400">Revision editor</p><p className="mt-1 font-bold text-zinc-800">{entry.revisionEditor.name}{entry.revisionEditor.role ? ` · ${entry.revisionEditor.role}` : ''}</p></div>
                      <div><p className="font-black uppercase text-zinc-400">Replacement executor</p><p className="mt-1 font-bold text-zinc-800">{entry.replacementExecutor.name || entry.replacementExecutor.id || 'Not yet available'}</p></div>
                      <div><p className="font-black uppercase text-zinc-400">Original value</p><p className="mt-1 font-bold text-zinc-800">{money(entry.originalTotal)}</p></div>
                      <div><p className="font-black uppercase text-zinc-400">Corrected value</p><p className="mt-1 font-bold text-zinc-800">{money(entry.correctedTotal)}</p></div>
                      <div><p className="font-black uppercase text-zinc-400">Completed</p><p className="mt-1 font-bold text-zinc-800">{date(entry.timestamps.completedAt)}</p></div>
                    </div>

                    <div className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
                      <p className="text-[9px] font-black uppercase tracking-wider text-zinc-400">Mandatory reason</p>
                      <p className="mt-1 text-sm font-semibold text-zinc-800">{entry.reason}</p>
                    </div>

                    <div className="mt-5 grid gap-5 md:grid-cols-2">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-wider text-zinc-400">Item changes</p>
                        <div className="mt-2 space-y-2">
                          {entry.itemChanges.length === 0 ? <p className="text-xs text-zinc-500">No item-line changes.</p> : entry.itemChanges.map((change, index) => (
                            <div key={`${change.productId}-${change.type}-${index}`} className="rounded-xl border border-zinc-200 bg-white p-3 text-xs">
                              <p className="font-black text-zinc-800">{change.productName}</p>
                              <p className="mt-1 text-zinc-500">{change.type.replaceAll('_', ' ')} · Qty {change.beforeQuantity ?? '—'} → {change.afterQuantity ?? '—'} · Price {change.beforeUnitPrice ?? '—'} → {change.afterUnitPrice ?? '—'}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-wider text-zinc-400">Contextual changes</p>
                        <div className="mt-2 space-y-2">
                          {entry.contextualChanges.length === 0 ? <p className="text-xs text-zinc-500">No contextual changes.</p> : entry.contextualChanges.map(change => (
                            <div key={change.field} className="rounded-xl border border-zinc-200 bg-white p-3 text-xs">
                              <p className="font-black text-zinc-800">{change.field}</p>
                              <p className="mt-1 text-zinc-500">{String(change.before ?? '—')} → {String(change.after ?? '—')}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {entry.failure && (
                      <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
                        <p className="font-black uppercase">{entry.failure.requiresManualReview ? 'Manual review required' : 'Lifecycle failure'}</p>
                        <p className="mt-1">{entry.failure.message}</p>
                      </div>
                    )}

                    <div className="mt-5 grid gap-2 font-mono text-[9px] text-zinc-400 md:grid-cols-2">
                      <p>Request: {entry.requestId}</p><p>Revision: {entry.revisionId}</p>
                      <p>Original sale: {entry.originalSaleId}</p><p>Replacement sale: {entry.replacementSaleId || 'Pending'}</p>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
