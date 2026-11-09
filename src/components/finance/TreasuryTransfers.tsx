import React, {useEffect, useMemo, useRef, useState} from 'react';
import {collection, getDocs, query, where} from 'firebase/firestore';
import {db} from '../../firebase';
import {kampalaBusinessDate} from '../../utils/eodBusinessDate';
import type {FinancialPortfolio} from '../../domain/finance/financialPortfolio';
import type {PortfolioTransfer, TransferEndpoint} from '../../domain/finance/portfolioTransfer';
import type {ManagementPaymentAccount} from '../../services/managementCashPosting';
import {allowsPortfolioTransfer, resolveTransferEndpoint, submitPortfolioTransfer} from '../../domain/finance/portfolioTransferService';
import {treasuryButton, treasuryField} from './TreasuryAccountControls';

const money = (amount: number) => 'UGX ' + amount.toLocaleString();

export function TreasuryTransfers({tenantId, actorId, canOperate, allowedBranches, accounts, portfolios, onChanged}: {
  tenantId: string; actorId: string; canOperate: boolean; allowedBranches: string[] | null;
  accounts: ManagementPaymentAccount[]; portfolios: FinancialPortfolio[]; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [charge, setCharge] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<PortfolioTransfer[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [from, setFrom] = useState(kampalaBusinessDate);
  const [to, setTo] = useState(kampalaBusinessDate);
  const [classFilter, setClassFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [destinationFilter, setDestinationFilter] = useState('');

  const eligible = (outgoing: boolean): TransferEndpoint[] => accounts.flatMap(account => {
    try {
      const endpoint = resolveTransferEndpoint(account, portfolios.find(item => item.id === account.accountId), tenantId, outgoing);
      return endpoint.branchId && allowedBranches && !allowedBranches.includes(endpoint.branchId) ? [] : [endpoint];
    } catch { return []; }
  });
  const sources = eligible(true);
  const source = sources.find(endpoint => endpoint.accountId === sourceId);
  const destinations = source ? eligible(false).filter(endpoint => allowsPortfolioTransfer(source, endpoint)) : [];
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setHistoryError('');
    getDocs(query(collection(db, 'finance_transfers_v1'), where('tenantId', '==', tenantId)))
      .then(snapshot => {
        if (live) setRows(snapshot.docs.map(item => {
          const data = item.data();
          return {...data, initiatedAt: data.postedAt.toDate().toISOString()} as PortfolioTransfer;
        }));
      })
      .catch(() => {
        if (live) { setRows([]); setHistoryError('Transfer history is unavailable. Refresh to retry.'); }
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [tenantId, open, refresh]);
  const visible = useMemo(() => rows.filter(row => {
    const date = kampalaBusinessDate(new Date(row.initiatedAt));
    return (!from || date >= from) && (!to || date <= to)
      && (!classFilter || row.transferClass === classFilter)
      && (!sourceFilter || row.source.portfolioId === sourceFilter)
      && (!destinationFilter || row.destination.portfolioId === destinationFilter);
  }).sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt)), [rows, from, to, classFilter, sourceFilter, destinationFilter]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !canOperate || !source || !destinations.some(endpoint => endpoint.accountId === destinationId)) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await submitPortfolioTransfer({tenantId, actorId, sourceAccountId: sourceId, destinationAccountId: destinationId,
        principalUGX: Number(principal), chargeUGX: Number(charge || 0), reference});
      setMessage(result.replayed ? 'This transfer was already recorded.' : 'Transfer posted to both ledgers.');
      setPrincipal('');
      setCharge('');
      setReference('');
      setRefresh(value => value + 1);
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Transfer could not be confirmed. Retry with the same reference.');
    } finally { lock.current = false; setBusy(false); }
  }

  const portfolioName = (id: string) => id === 'system_bank' ? 'Bank' : portfolios.find(item => item.id === id)?.name
    || accounts.find(account => account.accountId === id)?.name || id;
  const options = [...new Set<string>(rows.flatMap(row => [row.source.portfolioId, row.destination.portfolioId]))];
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="rounded-2xl border border-zinc-200 bg-white p-4">
    <summary className="cursor-pointer font-semibold">Portfolio transfers and history</summary>
    {open && <div className="mt-4 space-y-4">
      {canOperate && <form onSubmit={submit} className="space-y-3">
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
          <label>Source account<select required className={treasuryField} value={sourceId} onChange={event => { setSourceId(event.target.value); setDestinationId(''); }}>
            <option value="">Select source</option>{sources.map(endpoint => <option key={endpoint.accountId} value={endpoint.accountId}>{endpoint.name}</option>)}
          </select></label>
          <label>Destination account<select required className={treasuryField} value={destinationId} onChange={event => setDestinationId(event.target.value)}>
            <option value="">Select destination</option>{destinations.map(endpoint => <option key={endpoint.accountId} value={endpoint.accountId}>{endpoint.name}</option>)}
          </select></label>
          <label>Principal (UGX)<input required type="number" min="1" step="1" className={treasuryField} value={principal} onChange={event => setPrincipal(event.target.value)}/></label>
          <label>Charge (UGX, optional)<input type="number" min="0" step="1" className={treasuryField} value={charge} onChange={event => setCharge(event.target.value)}/></label>
          <label>Transaction reference<input required minLength={5} maxLength={100} className={treasuryField} value={reference} onChange={event => setReference(event.target.value)}/></label>
          <button type="submit" disabled={!source || !destinationId} className={treasuryButton+' self-end'}>{busy ? 'Posting transfer…' : 'Post transfer'}</button>
        </fieldset>
        <p className="text-sm text-zinc-600">The destination receives the full principal. Any charge is debited separately from the source.</p>
        {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
      </form>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label>From date<input type="date" value={from} onChange={event => setFrom(event.target.value)} className={treasuryField}/></label>
        <label>To date<input type="date" value={to} onChange={event => setTo(event.target.value)} className={treasuryField}/></label>
        <label>Source portfolio<select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} className={treasuryField}><option value="">All</option>{options.map(id => <option key={id} value={id}>{portfolioName(id)}</option>)}</select></label>
        <label>Destination portfolio<select value={destinationFilter} onChange={event => setDestinationFilter(event.target.value)} className={treasuryField}><option value="">All</option>{options.map(id => <option key={id} value={id}>{portfolioName(id)}</option>)}</select></label>
        <label>Transfer class<select value={classFilter} onChange={event => setClassFilter(event.target.value)} className={treasuryField}><option value="">All</option><option value="intra_portfolio">Within portfolio</option><option value="inter_portfolio">Between portfolios</option></select></label>
      </div>
      <button type="button" onClick={() => setRefresh(value => value + 1)} className="text-sm font-semibold text-emerald-800">Refresh transfer history</button>
      {historyError && <p role="alert">{historyError}</p>}
      {loading ? <p role="status">Loading transfers…</p> : !historyError && (visible.length ? <ul className="divide-y divide-zinc-200">
        {visible.map(row => <li key={row.id} className="space-y-1 py-3 text-sm">
          <p className="font-semibold">{row.source.name} → {row.destination.name}</p>
          <p>{portfolioName(row.source.portfolioId)} → {portfolioName(row.destination.portfolioId)} · {row.transferClass === 'intra_portfolio' ? 'Within portfolio' : 'Between portfolios'}</p>
          <p>{money(row.principalUGX)} principal · {money(row.chargeUGX)} charge · {row.status}</p>
          <p className="break-words text-zinc-600">{row.reference} · {new Date(row.initiatedAt).toLocaleString('en-UG', {timeZone:'Africa/Kampala'})} · Actor {row.initiatedBy}</p>
        </li>)}
      </ul> : <p>No transfers match these filters.</p>)}
    </div>}
  </details>;
}
