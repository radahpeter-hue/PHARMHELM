import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { loadCreditRegister, creditReadScope } from '../../services/creditRegisterLoader';
import { financialDate } from '../../services/financeRecordNormalization';
import { exportRecordsToExcel } from '../../utils/excelExport';

const money = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) ? n.toLocaleString() : 'Unverified';
export function ReceivablesRegister({ branchOnly = false }: { branchOnly?: boolean }) {
  const { profile, activeBranchId } = useAuth();
  const [rows, setRows] = useState<any[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [search, setSearch] = useState(''), [type, setType] = useState('all'), [branch, setBranch] = useState('all');
  const [status, setStatus] = useState('all'), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [selected, setSelected] = useState<any>(null), [page, setPage] = useState(0), [revision, refresh] = useState(0);
  const scope = useMemo(() => {
    if (branchOnly) return activeBranchId ? [activeBranchId] : [];
    return creditReadScope(profile || {});
  }, [profile, branchOnly, activeBranchId]);
  useEffect(() => {
    let current = true;
    setRows([]); setError(''); setLoading(true);
    if (!profile?.tenantId) { setLoading(false); return; }
    loadCreditRegister(profile.tenantId, scope).then(data => { if (current) setRows(data); })
      .catch(e => { if (current) setError(`Receivables could not be verified: ${e.message}`); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [profile?.tenantId, scope, revision]);
  const filtered = rows.filter(r => (type === 'all' || r.debtorType === type)
    && (branch === 'all' || r.branch_id === branch) && (status === 'all' || (status === 'unverified' ? !r.verified : r.status === status))
    && (!from || String(r.created_at || '').slice(0, 10) >= from) && (!to || String(r.created_at || '').slice(0, 10) <= to)
    && [r.client_name, r.debtorId, r.invoice_number, r.receipt_id, r.branch_name, r.contact].join(' ').toLowerCase().includes(search.toLowerCase()));
  const verified = filtered.filter(r => r.verified && r.status !== 'reversed');
  const total = verified.reduce((sum, r) => sum + r.outstanding_ugx, 0);
  const collected = verified.reduce((sum, r) => sum + r.collectedUGX, 0);
  useEffect(() => { setPage(0); }, [search, type, branch, status, from, to, rows]);
  const exportRows = () => exportRecordsToExcel(filtered.map(r => ({
    Invoice: r.invoice_number, Debtor: r.client_name, 'Debtor type': r.debtorType || 'Unverified', Branch: r.branch_name,
    'Invoice UGX': r.invoice_amount_ugx, 'Initial credit UGX': r.amount_ugx, 'Collected UGX': r.collectedUGX,
    'Outstanding UGX': r.outstanding_ugx, Status: r.status, 'Due date': r.due_date || 'Unverified',
    Verification: r.verified ? 'Verified recognition' : 'Reconciliation required', Exception: r.exception || ''
  })), 'Receivables', 'CreditReceivables.xlsx');
  return <section className="space-y-4" aria-label="Receivables register">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-xl font-bold">Credit Receivables</h3>
      <p className="text-sm text-zinc-600">Customers and institutions. Historical exceptions are excluded from verified totals.</p></div>
      <div className="flex gap-3"><button onClick={() => refresh(n => n + 1)} className="border rounded-xl px-3 py-2">Refresh</button>
      <button disabled={loading || !!error} onClick={exportRows} className="border rounded-xl px-3 py-2">Export</button></div></div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="p-4 bg-emerald-50 rounded-xl">Outstanding <strong className="block">UGX {money(total)}</strong></div>
      <div className="p-4 bg-blue-50 rounded-xl">Collected <strong className="block">UGX {money(collected)}</strong></div>
      <div className="p-4 bg-amber-50 rounded-xl">Reconciliation exceptions <strong className="block">{filtered.filter(r => r.exception).length}</strong></div>
    </div>
    <div className="flex flex-wrap gap-2 [&_input]:border [&_input]:rounded-lg [&_input]:p-2 [&_select]:border [&_select]:rounded-lg [&_select]:p-2">
      <input aria-label="Search receivables" placeholder="Debtor, contact, invoice or branch" value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label="Debtor type" value={type} onChange={e => setType(e.target.value)}><option value="all">All debtor types</option><option value="client">Customers</option><option value="institution">Institutions</option></select>
      <select aria-label="Receivable branch" value={branch} onChange={e => setBranch(e.target.value)}><option value="all">All authorized branches</option>{[...new Map(rows.map(r => [r.branch_id, r.branch_name])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <select aria-label="Receivable status" value={status} onChange={e => setStatus(e.target.value)}>{['all', 'outstanding', 'partial', 'paid', 'reversed', 'unverified'].map(s => <option key={s} value={s}>{s}</option>)}</select>
      <input aria-label="Credit date from" type="date" value={from} onChange={e => setFrom(e.target.value)} /><input aria-label="Credit date to" type="date" value={to} onChange={e => setTo(e.target.value)} />
    </div>
    {loading ? <p role="status">Loading receivables...</p> : error ? <p role="alert" className="text-red-700">{error}</p> : <>
      <div className="overflow-x-auto border rounded-xl"><table className="w-full text-sm text-left"><thead><tr className="bg-zinc-50">{['Source invoice', 'Debtor / contact', 'Branch', 'Invoice UGX', 'Initial credit UGX', 'Collected UGX', 'Outstanding UGX', 'Status / due / age'].map(t => <th key={t} className="p-3 whitespace-nowrap">{t}</th>)}</tr></thead>
        <tbody>{filtered.slice(page * 50, page * 50 + 50).map(r => <tr key={r.id} className="border-t align-top">
          <td className="p-3"><button className="text-emerald-700 underline" onClick={() => setSelected(r)}>{r.invoice_number || r.receipt_id || r.id}</button><small className="block">{financialDate(r.created_at)?.toLocaleDateString('en-GB') || 'Unverified date'}</small></td>
          <td className="p-3">{r.client_name}<small className="block">{r.debtorType || 'Unverified type'}: {r.debtorId || r.client_id || 'Unverified identity'}<br />{r.contact}</small></td>
          <td className="p-3">{r.branch_name}</td><td className="p-3">{money(r.invoice_amount_ugx)}</td><td className="p-3">{money(r.amount_ugx)}</td>
          <td className="p-3">{money(r.collectedUGX)}</td><td className="p-3">{money(r.outstanding_ugx)}{!r.verified && <small className="block text-amber-800">Unverified balance</small>}</td>
          <td className="p-3">{r.status}<small className="block">Due: {r.due_date || 'Unverified'}<br />Age: {r.created_at && financialDate(r.created_at) ? `${Math.max(0, Math.floor((Date.now() - financialDate(r.created_at)!.getTime()) / 86400000))} days` : 'Unverified'}</small>{r.exception && <small className="block text-amber-800">{r.exception}</small>}</td>
        </tr>)}</tbody></table>{filtered.length === 0 && <p className="p-5">No receivables in the selected scope.</p>}</div>
      <div className="flex justify-between"><button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 50))}</span><button disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(p => p + 1)}>Next</button></div>
    </>}
    {selected && <div role="dialog" aria-modal="true" aria-label="Receivable history" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3"><div className="bg-white p-5 rounded-2xl max-w-2xl max-h-[85vh] overflow-auto w-full space-y-3"><button className="float-right border px-3 py-1 rounded" onClick={() => setSelected(null)}>Close</button>
      <h4 className="font-bold">{selected.invoice_number || selected.id}</h4><p>Source sale: {selected.receipt_id}<br />Canonical payment: {selected.paymentId || 'Unverified'}<br />Recognized by: {selected.recognizedBy || 'Unverified'}</p>
      <p>Recognition: UGX {money(selected.amount_ugx)} on {selected.created_at || 'Unverified date'}. Approved terms: {selected.credit_terms || 'Unverified'}.</p>
      <p>Later collections: UGX {money(selected.collectedUGX)}. Outstanding: UGX {money(selected.outstanding_ugx)}.</p>
      {selected.status === 'reversed' && <p>Receipt correction: {selected.reversalId}. Reason: {selected.reversalReason}</p>}
      {selected.exception && <p className="text-amber-800">{selected.exception}</p>}
    </div></div>}
  </section>;
}
