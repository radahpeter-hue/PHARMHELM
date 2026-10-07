import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw, RotateCcw, X } from 'lucide-react';
import type { PosV2RevisionRequestProgress } from '../../services/pos-v2/posSaleRevisionV2SubmissionRepository';

interface PosV2ReceiptRevisionProgressProps {
  progress: PosV2RevisionRequestProgress | null;
  localError?: string | null;
  replacementCheckoutRunning?: boolean;
  onRetryReplacement?: () => void;
  onClose?: () => void;
}

function statusCopy(status: string): { title: string; detail: string; complete: boolean; failed: boolean } {
  switch (status) {
    case 'PENDING':
      return { title: 'Revision queued', detail: 'The correction request is waiting for the secure revision worker.', complete: false, failed: false };
    case 'PROCESSING':
      return { title: 'Reversing original transaction', detail: 'Inventory, payment and applicable downstream postings are being reversed safely.', complete: false, failed: false };
    case 'REVERSAL_COMPLETE':
      return { title: 'Original reversal complete', detail: 'The original transaction has been compensated and is moving to replacement preparation.', complete: false, failed: false };
    case 'REPLACEMENT_PENDING':
      return { title: 'Creating corrected receipt', detail: 'The canonical POS V2 engine is preparing the corrected replacement transaction.', complete: false, failed: false };
    case 'REPLACEMENT_CREATED':
      return { title: 'Corrected receipt created', detail: 'The corrected transaction exists and downstream posting is being finalized.', complete: false, failed: false };
    case 'COMPLETED':
      return { title: 'Revision complete', detail: 'The original receipt and corrected receipt are now permanently linked.', complete: true, failed: false };
    case 'FAILED':
      return { title: 'Revision requires attention', detail: 'The lifecycle stopped safely. Review the error before retrying or escalating.', complete: false, failed: true };
    default:
      return { title: 'Revision in progress', detail: 'The durable revision lifecycle is being monitored.', complete: false, failed: false };
  }
}

export const PosV2ReceiptRevisionProgress: React.FC<PosV2ReceiptRevisionProgressProps> = ({
  progress,
  localError,
  replacementCheckoutRunning = false,
  onRetryReplacement,
  onClose
}) => {
  const status = String(progress?.status || 'PENDING').toUpperCase();
  const copy = statusCopy(status);
  const error = localError || (progress?.lastError ? String(progress.lastError) : null);
  const manualReview = progress?.requiresManualReview === true;
  const replacementReceipt = String(progress?.replacementReceiptNumber || '').trim();
  const showRetry = status === 'REPLACEMENT_PENDING' && Boolean(error) && Boolean(onRetryReplacement);

  return (
    <div className="fixed inset-0 z-[127] bg-zinc-950/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div className="px-5 sm:px-7 py-5 border-b border-zinc-100 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-amber-700 mb-1">
              <RotateCcw className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-[0.16em]">POS V2 Revision Lifecycle</span>
            </div>
            <h2 className="text-xl font-black text-zinc-900">{copy.title}</h2>
            <p className="text-xs text-zinc-500 mt-1">{copy.detail}</p>
          </div>
          {onClose && (copy.complete || copy.failed || manualReview) ? (
            <button type="button" onClick={onClose} className="p-2 rounded-xl text-zinc-500 hover:bg-zinc-100" aria-label="Close revision progress">
              <X className="w-5 h-5" />
            </button>
          ) : null}
        </div>

        <div className="p-5 sm:p-7 space-y-5">
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 p-4">
            {copy.complete ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            ) : copy.failed || manualReview || error ? (
              <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
            ) : (
              <Loader2 className="w-6 h-6 text-amber-600 animate-spin shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wider text-zinc-400">Current state</p>
              <p className="font-bold text-zinc-800 break-words">{status.replaceAll('_', ' ')}</p>
            </div>
          </div>

          {replacementCheckoutRunning ? (
            <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              Canonical replacement checkout is running. Do not submit another correction.
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Attention required</p>
              <p className="text-sm font-semibold text-amber-900 mt-1 whitespace-pre-wrap">{error}</p>
            </div>
          ) : null}

          {manualReview ? (
            <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm font-semibold text-rose-800">
              This revision has been stopped for manual review. Do not create a second revision request for this receipt.
            </div>
          ) : null}

          {copy.complete && replacementReceipt ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Corrected receipt</p>
              <p className="text-lg font-black text-emerald-900 mt-1">{replacementReceipt}</p>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            {showRetry ? (
              <button type="button" onClick={onRetryReplacement} className="px-4 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-sm font-black flex items-center gap-2">
                <RefreshCcw className="w-4 h-4" /> Retry corrected checkout
              </button>
            ) : null}
            {onClose && (copy.complete || copy.failed || manualReview) ? (
              <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700">Close</button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export { statusCopy as getPosV2RevisionProgressCopy };
