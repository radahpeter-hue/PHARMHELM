import React, { useMemo } from 'react';
import { ArrowLeft, CheckCircle2, RotateCcw, X } from 'lucide-react';
import type { Sale } from '../../types';
import {
  buildPosV2RevisionPlan,
  type PosV2RevisionItemChange,
  type PosV2RevisionPlan
} from '../../services/pos-v2/posSaleRevisionV2Planner';
import type { PosV2ReceiptRevisionDraft } from './PosV2ReceiptRevisionEditor';
import { posPaymentMethodLabel } from '../../utils/posPaymentMethods';

interface PosV2ReceiptRevisionReviewProps {
  sale: Sale;
  draft: PosV2ReceiptRevisionDraft;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: (plan: PosV2RevisionPlan, draft: PosV2ReceiptRevisionDraft) => void;
  now?: Date;
  isSubmitting?: boolean;
  submissionError?: string | null;
}

const money = (value: number) => `UGX ${Number(value || 0).toLocaleString()}`;
const text = (value: string | null | undefined) => value || 'None';
const contextLabel = (value: string | null | undefined) => ({
  'walk-in': 'Walk-in', telepharmacy: 'Telepharmacy', institutional: 'Institutional'
}[String(value || '')] || text(value));

const identity = (name: string | null | undefined, id: string | null | undefined) => (
  <>
    <p className="font-bold">{text(name)}</p>
    {id && <p className="text-[10px] text-zinc-400 break-all">{id}</p>}
  </>
);

const itemChangeLabel = (change: PosV2RevisionItemChange): string => {
  switch (change.type) {
    case 'ITEM_ADDED': return 'Added';
    case 'ITEM_REMOVED': return 'Removed';
    case 'QUANTITY_CHANGED': return 'Quantity changed';
    case 'PRICE_CHANGED': return 'Price changed';
  }
};

const changeTypeLabel = (changeType: PosV2RevisionPlan['changeTypes'][number]): string =>
  changeType.toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());

export const PosV2ReceiptRevisionReview: React.FC<PosV2ReceiptRevisionReviewProps> = ({
  sale,
  draft,
  onBack,
  onCancel,
  onConfirm,
  now,
  isSubmitting = false,
  submissionError = null
}) => {
  const review = useMemo(() => {
    try {
      return {
        plan: buildPosV2RevisionPlan({
          originalSale: sale as any,
          revisedItems: draft.items,
          revisedTotal: draft.revisedTotal,
          paymentMethod: draft.paymentMethod,
          context: draft.context,
          patientId: draft.patientId,
          patientName: draft.patientName,
          institutionId: draft.institutionId,
          institutionName: draft.institutionName,
          institutionBillingEligible: draft.institutionBillingEligible,
          prescriberId: draft.prescriberId,
          prescriberName: draft.prescriberName,
          discountPercentage: draft.discountPercentage,
          reason: draft.reason,
          now
        }),
        error: null as string | null
      };
    } catch (error) {
      return {
        plan: null,
        error: error instanceof Error ? error.message : 'This revision draft cannot be reviewed safely.'
      };
    }
  }, [sale, draft, now]);

  const plan = review.plan;

  return (
    <div className="fixed inset-0 z-[126] bg-zinc-950/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-6xl max-h-[94vh] overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col">
        <div className="px-5 sm:px-7 py-5 border-b border-zinc-100 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-amber-700 mb-1">
              <RotateCcw className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-[0.16em]">POS V2 Revision Review</span>
            </div>
            <h2 className="text-xl font-black text-zinc-900">Review correction for receipt {sale.receiptNumber}</h2>
            <p className="text-xs text-zinc-500 mt-1">Submitting creates one immutable revision request. The original transaction is reversed only by the controlled revision workers before the corrected receipt is created through POS V2.</p>
          </div>
          <button type="button" onClick={onCancel} className="p-2 rounded-xl text-zinc-500 hover:bg-zinc-100" aria-label="Close revision review">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-6">
          {review.error || !plan ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
              {review.error || 'Revision review failed closed.'}
            </div>
          ) : (
            <>
              <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-zinc-200 p-4">
                  <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Original total</p>
                  <p className="text-lg font-black text-zinc-900 mt-1">{money(plan.originalTotal)}</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 p-4">
                  <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Corrected total</p>
                  <p className="text-lg font-black text-zinc-900 mt-1">{money(plan.revisedTotal)}</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 p-4">
                  <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Monetary adjustment</p>
                  <p className={plan.monetaryDelta > 0 ? 'text-lg font-black text-emerald-700 mt-1' : plan.monetaryDelta < 0 ? 'text-lg font-black text-rose-700 mt-1' : 'text-lg font-black text-zinc-700 mt-1'}>
                    {plan.monetaryDelta > 0 ? '+' : ''}{money(plan.monetaryDelta)}
                  </p>
                  <p className="text-[10px] font-bold text-zinc-400 mt-1">{plan.adjustmentDirection.replaceAll('_', ' ')}</p>
                </div>
              </section>

              <section className="rounded-2xl border border-zinc-200 overflow-hidden">
                <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-zinc-700 mr-auto">Detected changes</h3>
                  {plan.changeTypes.map(changeType => (
                    <span key={changeType} className="px-2 py-1 rounded-lg bg-amber-100 text-amber-800 text-[10px] font-black">{changeTypeLabel(changeType)}</span>
                  ))}
                </div>
                <div className="divide-y divide-zinc-100">
                  {plan.itemChanges.length === 0 ? (
                    <p className="p-4 text-xs text-zinc-500">No item-level changes. The correction affects receipt context or commercial details only.</p>
                  ) : plan.itemChanges.map((change, index) => (
                    <div key={`${change.type}-${change.productId}-${change.tierCode || 'BASE'}-${index}`} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
                      <div className="md:col-span-5">
                        <p className="font-black text-zinc-900">{change.productName}</p>
                        <p className="text-[10px] text-zinc-400 uppercase">{change.tierCode || 'Base unit'} · {itemChangeLabel(change)}</p>
                      </div>
                      <div className="md:col-span-3">
                        <p className="text-[9px] uppercase font-black text-zinc-400">Quantity</p>
                        <p className="font-bold text-zinc-700">{change.beforeQuantity ?? '—'} → {change.afterQuantity ?? '—'}</p>
                      </div>
                      <div className="md:col-span-4">
                        <p className="text-[9px] uppercase font-black text-zinc-400">Unit price</p>
                        <p className="font-bold text-zinc-700">{change.beforeUnitPrice === undefined ? '—' : money(change.beforeUnitPrice)} → {change.afterUnitPrice === undefined ? '—' : money(change.afterUnitPrice)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-zinc-200 p-4 space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-zinc-700">Original receipt context</h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Payment</p><p className="font-bold">{posPaymentMethodLabel(plan.before.paymentMethod)}</p></div>
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Context</p><p className="font-bold">{contextLabel(plan.before.context)}</p></div>
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Client</p>{identity(plan.before.patientName, plan.before.patientId)}</div>
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Institution</p>{identity(plan.before.institutionName, plan.before.institutionId)}</div>
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Prescriber</p>{identity(plan.before.prescriberName, plan.before.prescriberId)}</div>
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Discount</p><p className="font-bold">{plan.before.discountPercentage}%</p></div>
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-amber-800">Corrected receipt context</h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Payment</p><p className="font-bold">{posPaymentMethodLabel(plan.after.paymentMethod)}</p></div>
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Context</p><p className="font-bold">{contextLabel(plan.after.context)}</p></div>
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Client</p>{identity(plan.after.patientName, plan.after.patientId)}</div>
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Institution</p>{identity(plan.after.institutionName, plan.after.institutionId)}</div>
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Prescriber</p>{identity(plan.after.prescriberName, plan.after.prescriberId)}</div>
                    <div><p className="text-[9px] uppercase font-black text-zinc-400">Discount</p><p className="font-bold">{plan.after.discountPercentage}%</p></div>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-zinc-200 p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Mandatory revision reason</p>
                <p className="text-sm font-semibold text-zinc-800 mt-1 whitespace-pre-wrap">{plan.revisionReason}</p>
              </section>
              {submissionError && <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{submissionError}</p>}
            </>
          )}
        </div>

        <div className="px-5 sm:px-7 py-4 border-t border-zinc-100 bg-zinc-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-[10px] text-zinc-500 max-w-xl">Confirming is irreversible once the worker begins reversal. The original receipt is never overwritten; it remains permanently linked to the corrected replacement receipt.</p>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onBack} disabled={isSubmitting} className="px-4 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 flex items-center gap-1.5 disabled:opacity-50"><ArrowLeft className="w-4 h-4" />Back to Edit</button>
            <button
              type="button"
              onClick={() => plan && onConfirm(plan, draft)}
              disabled={!plan || isSubmitting}
              className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-black disabled:bg-zinc-200 disabled:text-zinc-400 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />{isSubmitting ? 'Submitting...' : 'Submit Revision'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
