import React, {useEffect, useMemo, useRef, useState} from 'react';
import {collection, getDocs, query, where} from 'firebase/firestore';
import {db} from '../../firebase';
import {kampalaBusinessDate} from '../../utils/eodBusinessDate';
import type {FinancialPortfolio} from '../../domain/finance/financialPortfolio';
import type {PortfolioTransfer, TransferEndpoint} from '../../domain/finance/portfolioTransfer';
import type {ManagementPaymentAccount} from '../../services/managementCashPosting';
import {allowsPortfolioTransfer, resolveTransferEndpoint, submitPortfolioTransfer} from '../../domain/finance/portfolioTransferService';
import {ArrowLeftRight} from 'lucide-react';
import {treasuryButton, treasuryField} from './TreasuryAccountControls';

const money = (amount: number) => 'UGX ' + amount.toLocaleString();

export function TreasuryTransferHistory({tenantId, accounts, portfolios, revision}: {
  tenantId: string; accounts: ManagementPaymentAccount[]; portfolios: FinancialPortfolio[]; revision: number;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PortfolioTransfer[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [from, setFrom] = useState(kampalaBusinessDate);
  const [to, setTo] = useState(kampalaBusinessDate);
  const [classFilter, setClassFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [destinationFilter, setDestinationFilter] = useState('');

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
  }, [tenantId, open, refresh, revision]);
  const visible = useMemo(() => rows.filter(row => {
    const date = kampalaBusinessDate(new Date(row.initiatedAt));
    return (!from || date >= from) && (!to || date <= to)
      && (!classFilter || row.transferClass === classFilter)
      && (!sourceFilter || row.source.portfolioId === sourceFilter)
      && (!destinationFilter || row.destination.portfolioId === destinationFilter);
  }).sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt)), [rows, from, to, classFilter, sourceFilter, destinationFilter]);

  const portfolioName = (id: string) => id === 'system_bank' ? 'Bank' : portfolios.find(item => item.id === id)?.name
    || accounts.find(account => account.accountId === id)?.name || id;
  const options = [...new Set<string>(rows.flatMap(row => [row.source.portfolioId, row.destination.portfolioId]))];
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="rounded-2xl border border-zinc-200 bg-white p-4">
    <summary className="cursor-pointer font-semibold">Transfer history</summary>
    {open && <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label>From date<input type="date" value={from} onChange={event => setFrom(event.target.value)} className={treasuryField}/></label>
        <label>To date<input type="date" value={to} onChange={event => setTo(event.target.value)} className={treasuryField}/></label>
        <label>Source portfolio<select aria-label="Source portfolio" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} className={treasuryField}><option value="">All</option>{options.map(id => <option key={id} value={id}>{portfolioName(id)}</option>)}</select></label>
        <label>Destination portfolio<select aria-label="Destination portfolio" value={destinationFilter} onChange={event => setDestinationFilter(event.target.value)} className={treasuryField}><option value="">All</option>{options.map(id => <option key={id} value={id}>{portfolioName(id)}</option>)}</select></label>
        <label>Transfer class<select aria-label="Transfer class" value={classFilter} onChange={event => setClassFilter(event.target.value)} className={treasuryField}><option value="">All</option><option value="intra_portfolio">Within portfolio</option><option value="inter_portfolio">Between portfolios</option></select></label>
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

export function TreasuryTransferAction({tenantId, actorId, allowedBranches, accounts, portfolios, sourceAccountIds,
  sourcePortfolioName, bank, onChanged}: {
  tenantId: string; actorId: string; allowedBranches: string[] | null;
  accounts: ManagementPaymentAccount[]; portfolios: FinancialPortfolio[]; sourceAccountIds: string[];
  sourcePortfolioName: string; bank: boolean; onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [sourceChoice, setSourceChoice] = useState('');
  const [destination, setDestination] = useState('');
  const [destinationBank, setDestinationBank] = useState('');
  const [principal, setPrincipal] = useState('');
  const [charge, setCharge] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function eligible(outgoing: boolean): TransferEndpoint[] {
    return accounts.flatMap(account => {
      try {
        const endpoint = resolveTransferEndpoint(account, portfolios.find(item => item.id === account.accountId), tenantId, outgoing);
        return endpoint.branchId && allowedBranches && !allowedBranches.includes(endpoint.branchId) ? [] : [endpoint];
      } catch { return []; }
    });
  }

  const receivers = eligible(false);
  const sources = eligible(true).filter(endpoint => sourceAccountIds.includes(endpoint.accountId)
    && receivers.some(receiver => allowsPortfolioTransfer(endpoint, receiver)));
  const chooseSource = bank || sources.length > 1;
  const source = chooseSource ? sources.find(endpoint => endpoint.accountId === sourceChoice) : sources[0];
  const destinations = source ? receivers.filter(endpoint => allowsPortfolioTransfer(source, endpoint)) : [];
  const bankDestinations = destinations.filter(endpoint => endpoint.portfolioId === 'system_bank');
  const destinationId = destination === 'system_bank' ? destinationBank : destination;
  const target = destinations.find(endpoint => endpoint.accountId === destinationId);

  function open() {
    setSourceChoice('');
    setDestination('');
    setDestinationBank('');
    setPrincipal('');
    setCharge('');
    setReference('');
    setMessage('');
    setError('');
    dialog.current?.showModal();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !source || !target) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await submitPortfolioTransfer({tenantId, actorId, sourceAccountId: source.accountId,
        destinationAccountId: target.accountId, principalUGX: Number(principal), chargeUGX: Number(charge || 0), reference});
      setMessage(result.replayed ? 'This transfer was already recorded.' : 'Transfer posted to both ledgers.');
      setPrincipal('');
      setCharge('');
      setReference('');
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Transfer could not be confirmed. Retry with the same reference.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <>
    <button type="button" onClick={open} className={treasuryButton+' inline-flex items-center gap-2'}><ArrowLeftRight size={16}/>Initiate Transfer</button>
    <dialog ref={dialog} aria-label="Initiate Transfer" onCancel={event => {if (lock.current) event.preventDefault();}}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl bg-white p-4 text-zinc-900 shadow-xl backdrop:bg-black/50 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-xl font-bold">Initiate Transfer</h3>
        <button type="button" disabled={busy} onClick={() => dialog.current?.close()} className="min-h-11 px-3 text-sm font-semibold text-emerald-800">Close</button>
      </div>
      <p className="mb-4 break-words text-sm"><span className="font-semibold">Source portfolio</span> · {sourcePortfolioName}</p>
      {sources.length ? <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
          {chooseSource && <label className="text-sm sm:col-span-2">{bank ? 'Source bank account' : 'Source branch account'}
            <select aria-label={bank ? 'Source bank account' : 'Source branch account'} required className={treasuryField} value={sourceChoice}
              onChange={event => {setSourceChoice(event.target.value); setDestination(''); setDestinationBank('');}}>
              <option value="">Select source account</option>{sources.map(endpoint => <option key={endpoint.accountId} value={endpoint.accountId}>{endpoint.name}</option>)}
            </select>
          </label>}
          <label className="text-sm sm:col-span-2">Destination portfolio
            <select aria-label="Destination portfolio" required disabled={!source} className={treasuryField} value={destination}
              onChange={event => {setDestination(event.target.value); setDestinationBank('');}}>
              <option value="">Select destination</option>
              {!!bankDestinations.length && <option value="system_bank">Bank</option>}
              {destinations.filter(endpoint => endpoint.portfolioId !== 'system_bank').map(endpoint =>
                <option key={endpoint.accountId} value={endpoint.accountId}>{endpoint.name}</option>)}
            </select>
          </label>
          {destination === 'system_bank' && <label className="text-sm sm:col-span-2">Destination bank account
            <select aria-label="Destination bank account" required className={treasuryField} value={destinationBank} onChange={event => setDestinationBank(event.target.value)}>
              <option value="">Select bank account</option>{bankDestinations.map(endpoint => <option key={endpoint.accountId} value={endpoint.accountId}>{endpoint.name}</option>)}
            </select>
          </label>}
          <label className="text-sm">Principal (UGX)<input required type="number" min="1" step="1" className={treasuryField} value={principal} onChange={event => setPrincipal(event.target.value)}/></label>
          <label className="text-sm">Charge (UGX, optional)<input type="number" min="0" step="1" className={treasuryField} value={charge} onChange={event => setCharge(event.target.value)}/></label>
          <label className="text-sm sm:col-span-2">Transaction reference<input required minLength={5} maxLength={100} className={treasuryField} value={reference} onChange={event => setReference(event.target.value)}/></label>
          {Number(principal) > 0 && <div className="rounded-xl bg-emerald-50 p-3 text-sm sm:col-span-2">
            <p>Source debit <strong>{money(Number(principal) + Number(charge))}</strong></p>
            <p>Destination credit <strong>{money(Number(principal))}</strong></p>
          </div>}
          <button type="submit" disabled={!target} className={treasuryButton+' sm:col-span-2'}>{busy ? 'Posting transfer…' : 'Post transfer'}</button>
        </fieldset>
      </form> : <p className="text-sm text-zinc-600">This portfolio has no eligible reconciled source account with an available transfer destination.</p>}
      {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="mt-3 break-words text-sm text-red-800">{error}</p>}
    </dialog>
  </>;
}
