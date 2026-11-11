import React, { useEffect, useRef, useState } from 'react';
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { canSettleSupplierInvoices, eligibleSupplierFunding } from '../../domain/finance/supplierPaymentPolicy';
import type { FinancialPortfolio } from '../../domain/finance/financialPortfolio';
import { settleCashGrnDraft } from '../../services/cashGrnSettlementService';
import { settleSupplierCreditDraft } from '../../services/creditGrnSettlementService';
import { useManagementPaymentAccounts } from './ManagementPaymentAccounts';

type Payable = {
  invoiceId: string; invoiceRef: string; grnRef: string; supplierName: string; total: number; paid: number; remaining: number;
  limit: number; kind: 'cash' | 'credit'; draftStatus: string;
};
type PaymentHistory = {
  id: string; reference: string; amount: number; charge: number; debit: number; remaining: number;
  accountId: string; accountName: string; branchName: string; processor: string; date: Date | null; status: string;
};
const ugx = (value: number) => `UGX ${value.toLocaleString()}`;
const field = 'mt-1 min-h-11 w-full min-w-0 rounded-xl border border-zinc-400 bg-white p-2 text-zinc-900';

export function SupplierInvoicePaymentPanel({ draftId, onSettled, onRejected }: {
  draftId: string; onSettled: () => void; onRejected?: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const tenantId = profile?.tenantId || '';
  const canPay = canSettleSupplierInvoices(profile, tenantId);
  const { accounts, loading: accountsLoading, error: accountsError } = useManagementPaymentAccounts(true);
  const [payable, setPayable] = useState<Payable | null>(null);
  const [history, setHistory] = useState<PaymentHistory[]>([]);
  const [registry, setRegistry] = useState<FinancialPortfolio[] | null>(null);
  const [branches, setBranches] = useState<Map<string, string>>(new Map());
  const [accountId, setAccountId] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [amount, setAmount] = useState('');
  const [charge, setCharge] = useState('0');
  const [error, setError] = useState('');
  const [fundingError, setFundingError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    if (!tenantId || !canPay) return;
    const tenantDocuments = (name: string) => getDocs(query(collection(db, name), where('tenantId', '==', tenantId)));
    void Promise.all([tenantDocuments('finance_portfolios_v1'), tenantDocuments('branches')]).then(([portfolios, branchDocs]) => {
      if (disposed) return;
      setRegistry(portfolios.docs.map(row => row.data() as FinancialPortfolio));
      setBranches(new Map(branchDocs.docs.filter(row => !['Inactive', 'Closed'].includes(row.data().status))
        .map(row => [row.id, String(row.data().name || row.data().branch_name || row.id)])));
    }).catch(() => { if (!disposed) setFundingError('Unable to verify eligible financial accounts.'); });
    return () => { disposed = true; };
  }, [tenantId, canPay]);

  useEffect(() => {
    let disposed = false;
    setPayable(null);
    setHistory([]);
    setError('');
    setConfirm(false);
    if (!tenantId) return;
    void (async () => {
      const draft = (await getDoc(doc(db, 'management_expenses', draftId))).data();
      if (!draft || draft.tenantId !== tenantId || !['procurement_cash_grn', 'credit_payment'].includes(draft.source)) {
        throw new Error('Linked supplier payment draft is unavailable.');
      }
      const kind = draft.source === 'credit_payment' ? 'credit' : 'cash';
      if (kind === 'cash') {
        const settings = (await getDoc(doc(db, 'system_settings', tenantId))).data();
        if (settings?.managementCashSettlementV1 !== true) throw new Error('Supplier settlement is awaiting Finance release activation.');
      }
      const invoice = (await getDoc(doc(db, 'invoices', draft.invoiceId))).data();
      if (!invoice || invoice.tenantId !== tenantId || (kind === 'cash' && invoice.grnId !== draft.grnId)) {
        throw new Error('Supplier invoice linkage requires reconciliation.');
      }
      const paymentHistory = await getDocs(query(collection(db, kind === 'cash' ? 'cash_grn_payments' : 'creditPayments'),
        where('tenantId', '==', tenantId), where('invoiceId', '==', draft.invoiceId)));
      const total = Number(invoice.invoiceValue);
      const remaining = kind === 'credit' ? Number(invoice.creditBalance) : total - Number(invoice.paidAmountUGX ?? 0);
      const paid = total - remaining;
      const limit = kind === 'cash' ? remaining : Math.min(remaining, Number(draft.amount) - Number(draft.paidAmountUGX ?? 0));
      if (![total, paid, remaining, limit].every(Number.isSafeInteger) || paid < 0 || remaining < 0 || limit < 0) {
        throw new Error('Invoice balances require reconciliation.');
      }
      const legacyProcessors = new Set(paymentHistory.docs.map(row => row.data())
        .filter(row => !row.processedByName && row.processedBy).map(row => String(row.processedBy)));
      const names = new Map(await Promise.all([...legacyProcessors].map(async uid => {
        const staff = (await getDoc(doc(db, 'staff', uid)).catch(() => null))?.data();
        return [uid, String(staff?.full_name || staff?.fullName || 'Name unavailable')] as const;
      })));
      if (disposed) return;
      setHistory(paymentHistory.docs.map(row => {
        const data = row.data();
        const amount = Number(data.amountUGX ?? data.amount);
        const charge = Number(data.chargeUGX ?? 0);
        const date = typeof data.processedAt?.toDate === 'function' ? data.processedAt.toDate() : null;
        return {
          id: row.id, reference: data.externalReference || data.reference || data.paymentReference || 'Reference unavailable',
          amount, charge, debit: Number(data.totalDebitUGX ?? amount + charge), remaining: Number(data.remainingUGX ?? data.balanceAfter),
          accountId: data.paymentAccountId || data.paymentSource || '', accountName: data.fundingAccountName || '',
          branchName: data.fundingBranchName || data.fundingBranchId || '', processor: data.processedByName || names.get(data.processedBy) || 'Name unavailable',
          date, status: data.status || 'posted',
        };
      }).sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)));
      setPayable({
        invoiceId: draft.invoiceId,
        invoiceRef: invoice.supplierInvoiceNumber || invoice.invoiceRef || draft.invoiceRef || 'Reference unavailable',
        grnRef: invoice.grnRef || invoice.grnId || 'Reference unavailable', supplierName: invoice.supplierName || 'Supplier',
        total, paid, remaining, limit, kind, draftStatus: draft.status,
      });
      setAmount(String(limit));
    })().catch(e => { if (!disposed) setError(e instanceof Error ? e.message : 'Unable to load supplier invoice.'); });
    return () => { disposed = true; };
  }, [draftId, tenantId]);

  const availableAccounts = registry ? accounts.filter(account =>
    account.id === tenantId + '_' + account.accountId &&
    eligibleSupplierFunding(account, tenantId, registry.find(portfolio => portfolio.id === account.accountId)) &&
    (account.scope?.kind !== 'branch' || branches.has(account.scope.branchId))) : [];
  const account = availableAccounts.find(a => a.accountId === accountId);
  const value = Number(amount);
  const chargeUGX = Number(charge);
  const debit = value + chargeUGX;
  const showForm = canPay && !!payable && payable.limit > 0 && ['draft', 'pending', 'partial'].includes(payable.draftStatus);
  const valid = showForm && !!payable && !!account && Number.isSafeInteger(value) && value > 0 && value <= payable.limit &&
    Number.isSafeInteger(chargeUGX) && chargeUGX >= 0 && Number.isSafeInteger(debit) && debit <= account.balanceUGX &&
    externalReference.trim().length >= 3 && externalReference.trim().length <= 150;
  const pay = async () => {
    if (!valid || !payable || !account || !profile || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      // An external voucher stays bound to the invoice even when a later
      // credit installment is authorized through a different draft.
      const identity = JSON.stringify([tenantId, payable.invoiceId, externalReference.trim().toUpperCase()]);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
      const requestId = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
      const settle = payable.kind === 'cash' ? settleCashGrnDraft : settleSupplierCreditDraft;
      await settle({ tenantId, draftId, requestId, amountUGX: value, chargeUGX, externalReference, paymentAccountId: accountId,
        actor: { uid: profile.uid, name: profile.fullName || profile.full_name || profile.uid } });
      onSettled();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to record the supplier payment.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const accountScope = (branchId?: string) => branchId ? branches.get(branchId) || branchId : 'HQ';
  const invoiceStatus = payable?.remaining === 0 ? 'Paid' : payable?.paid ? 'Partially paid' : 'Awaiting payment';

  return <section className="min-w-0 space-y-4 text-zinc-900">
    <h4 className="text-lg font-bold text-zinc-950">Supplier invoice payment</h4>
    {payable ? <dl className="grid grid-cols-1 gap-3 rounded-xl bg-zinc-50 p-3 text-sm sm:grid-cols-2">
      {[
        ['Supplier', payable.supplierName], ['Invoice', payable.invoiceRef], ['GRN', payable.grnRef],
        ['Invoice total', ugx(payable.total)], ['Already paid', ugx(payable.paid)], ['Outstanding', ugx(payable.remaining)],
        ['Invoice status', invoiceStatus], ...(payable.kind === 'credit' && showForm ? [['Approved draft available', ugx(payable.limit)]] : []),
      ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="font-medium text-zinc-700">{label}</dt><dd className="break-words font-bold">{value}</dd></div>)}
    </dl> : !error && <p className="text-sm text-zinc-700">Loading linked invoice…</p>}
    {showForm && payable && <>
      <p className="text-sm text-zinc-700">Record the payment after you have paid the supplier.</p>
      <label className="block text-sm font-semibold">Payment account
        <select aria-label="Supplier payment account" disabled={busy || confirm} value={accountId} onChange={e => setAccountId(e.target.value)} className={field}>
          <option value="">Select an eligible financial account</option>
          {availableAccounts.map(a => <option key={a.id} value={a.accountId}>{a.name} · {accountScope(a.scope?.branchId)} · {ugx(a.balanceUGX)}</option>)}
        </select>
      </label>
      {account && <p className="break-words rounded-xl bg-zinc-50 p-3 text-sm">
        <span className="block font-semibold">{account.name} · {accountScope(account.scope?.branchId)}</span>
        <span className="block">Available balance: {ugx(account.balanceUGX)}</span>
      </p>}
      {!accountsLoading && registry && !availableAccounts.length && <p className="text-sm font-semibold text-amber-900">Reconcile an eligible financial account before recording payment.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">Amount to pay (UGX)
          <input aria-label="Supplier payment amount" type="number" min="1" step="1" max={payable.limit} disabled={busy || confirm} value={amount} onChange={e => setAmount(e.target.value)} className={field}/>
        </label>
        <label className="block text-sm font-semibold">Transaction charge (UGX)
          <input aria-label="Supplier payment charge" type="number" min="0" step="1" disabled={busy || confirm} value={charge} onChange={e => setCharge(e.target.value)} className={field}/>
        </label>
      </div>
      <label className="block text-sm font-semibold">Bank transaction / cash voucher reference
        <input aria-label="Supplier payment reference" minLength={3} maxLength={150} disabled={busy || confirm} value={externalReference} onChange={e => setExternalReference(e.target.value)} className={field}/>
      </label>
      <p className="text-sm font-bold">Total account debit {Number.isSafeInteger(debit) && debit > 0 ? ugx(debit) : 'pending valid amounts'}</p>
      {account && debit > account.balanceUGX && <p role="alert" className="text-sm font-semibold text-red-800">Insufficient funds for the supplier payment and charge.</p>}
      {confirm ? <div className="space-y-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
        <p className="break-words text-sm font-semibold text-emerald-950">Record {ugx(value)} and a {ugx(chargeUGX)} charge from {account?.name}. Reference: {externalReference}. Outstanding after payment: {ugx(payable.remaining - value)}.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button disabled={busy} onClick={() => setConfirm(false)} className="min-h-11 rounded-xl border border-zinc-400 bg-white px-4 py-2 font-bold">Back</button>
          <button disabled={busy || !valid} onClick={() => void pay()} className="min-h-11 rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? 'Recording payment…' : 'Record supplier payment'}</button>
        </div>
      </div> : <div className="flex flex-col gap-2 sm:flex-row">
        <button disabled={!valid || accountsLoading} onClick={() => setConfirm(true)} className="min-h-11 flex-1 rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white disabled:opacity-50">Review supplier payment</button>
        {onRejected && <button disabled={busy} onClick={() => void onRejected()} className="min-h-11 rounded-xl border border-zinc-400 bg-white px-4 py-2 font-bold">Reject draft</button>}
      </div>}
    </>}
    {history.length > 0 && <section className="space-y-2 border-t border-zinc-200 pt-3">
      <h5 className="text-sm font-bold">Recorded payments</h5>
      {history.map(payment => <div key={payment.id} className="min-w-0 break-words rounded-xl border border-zinc-200 p-3 text-sm">
        <p className="font-semibold">{payment.reference} · {payment.status === 'posted' ? 'Recorded' : payment.status}</p>
        <p>{payment.date?.toLocaleString('en-UG', { timeZone: 'Africa/Kampala' }) || 'Date unavailable'} · {payment.processor}</p>
        <p>{payment.accountName || accounts.find(account => account.accountId === payment.accountId)?.name ||
          (payment.accountId === 'management_petty_cash' ? 'Management Petty Cash' : 'Account name unavailable')} · {payment.branchName || 'HQ'}</p>
        <p>Supplier {ugx(payment.amount)} · Charge {ugx(payment.charge)} · Account debit {ugx(payment.debit)}</p>
        <p>Invoice balance after payment {ugx(payment.remaining)}</p>
      </div>)}
    </section>}
    {(error || fundingError || (showForm && accountsError)) && <p role="alert" className="break-words text-sm font-semibold text-red-800">{error || fundingError || accountsError}</p>}
  </section>;
}
