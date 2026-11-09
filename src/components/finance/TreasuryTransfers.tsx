import React, {useRef, useState} from 'react';
import type {FinancialPortfolio} from '../../domain/finance/financialPortfolio';
import type {TransferEndpoint} from '../../domain/finance/portfolioTransfer';
import type {ManagementPaymentAccount} from '../../services/managementCashPosting';
import {allowsPortfolioTransfer, resolveTransferEndpoint, submitPortfolioTransfer} from '../../domain/finance/portfolioTransferService';
import {ArrowLeftRight} from 'lucide-react';
import {treasuryButton, treasuryField} from './TreasuryAccountControls';

const money = (amount: number) => 'UGX ' + amount.toLocaleString();

export function TreasuryTransferAction({tenantId, actorId, allowedBranches, accounts, portfolios, sourceAccountIds,
  sourcePortfolioName, bank, loading, unavailable, supportsTransfers, onChanged}: {
  tenantId: string; actorId: string; allowedBranches: string[] | null;
  accounts: ManagementPaymentAccount[]; portfolios: FinancialPortfolio[]; sourceAccountIds: string[];
  sourcePortfolioName: string; bank: boolean; loading: boolean; unavailable: boolean; supportsTransfers: boolean; onChanged: () => void;
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
  const reconciledSources = eligible(true).filter(endpoint => sourceAccountIds.includes(endpoint.accountId));
  const sources = reconciledSources.filter(endpoint => receivers.some(receiver => allowsPortfolioTransfer(endpoint, receiver)));
  const unavailableReason = !supportsTransfers ? 'This portfolio does not support outgoing transfers.'
    : !reconciledSources.length ? 'No eligible source account. Check that the account is active and its verified opening reconciliation is complete.'
    : 'No eligible destination for this portfolio. Choose a supported route and confirm that the destination account has completed opening reconciliation.';
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
      {unavailable ? <p role="alert" className="text-sm text-red-800">Transfer accounts could not be loaded. Refresh Treasury and try again.</p>
      : loading && !busy && !message ? <p role="status" className="text-sm text-zinc-600">Loading transfer accounts…</p>
      : sources.length ? <form onSubmit={submit} className="space-y-4">
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
      </form> : <p className="text-sm text-zinc-600">{unavailableReason}</p>}
      {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="mt-3 break-words text-sm text-red-800">{error}</p>}
    </dialog>
  </>;
}
