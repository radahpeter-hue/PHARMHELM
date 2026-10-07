import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { Sale } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import {
  getPosV2ReceiptRevisionUiDecision,
  type PosV2ReceiptRevisionUiDecision
} from '../../services/pos-v2/posSaleRevisionV2UiPolicy';
import type { PosV2RevisionPlan } from '../../services/pos-v2/posSaleRevisionV2Planner';
import { posV2RevisionRequestIdForRevision } from '../../services/pos-v2/posSaleRevisionV2Submission';
import {
  submitPosV2RevisionRequest,
  watchPosV2RevisionRequest,
  type PosV2RevisionRequestProgress
} from '../../services/pos-v2/posSaleRevisionV2SubmissionRepository';
import { executePosV2RevisionReplacement } from '../../services/pos-v2/posSaleRevisionV2ReplacementExecution';
import {
  PosV2ReceiptRevisionEditor,
  type PosV2ReceiptRevisionDraft
} from './PosV2ReceiptRevisionEditor';
import { PosV2ReceiptRevisionReview } from './PosV2ReceiptRevisionReview';
import { PosV2ReceiptRevisionProgress } from './PosV2ReceiptRevisionProgress';
import { usePosV2RevisionCatalogData } from './usePosV2RevisionCatalogData';

interface PosV2ReceiptRevisionActionProps {
  sale: Sale;
  canOperatePos: boolean;
  onRevise: (sale: Sale) => void;
  compact?: boolean;
  now?: Date;
}

function actionLabel(decision: PosV2ReceiptRevisionUiDecision): string {
  switch (decision.state) {
    case 'ELIGIBLE':
      return 'Revise Receipt';
    case 'WINDOW_EXPIRED':
      return 'Revision Window Expired';
    case 'REVISION_IN_PROGRESS':
      return 'Revision In Progress';
    case 'ORIGINAL_REVISED':
      return 'Receipt Revised';
    case 'REPLACEMENT_RECEIPT':
      return 'Corrected Receipt';
    case 'NO_PERMISSION':
      return 'Revision Unavailable';
    default:
      return 'Revision Unavailable';
  }
}

function remainingWindowLabel(remainingMs: number | null): string | null {
  if (remainingMs === null || remainingMs <= 0) return null;
  const totalMinutes = Math.max(0, Math.floor(remainingMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

function actorName(profile: any): string {
  return String(
    profile?.full_name
      || profile?.displayName
      || profile?.fullName
      || profile?.username
      || profile?.email
      || profile?.uid
      || ''
  ).trim();
}

/**
 * Dedicated POS V2 ledger action. It owns the editor, reviewed durable request,
 * lifecycle monitoring and canonical corrected checkout. Legacy receipt mutation
 * paths are never invoked from this component.
 */
export const PosV2ReceiptRevisionAction: React.FC<PosV2ReceiptRevisionActionProps> = ({
  sale,
  canOperatePos,
  onRevise: _onRevise,
  compact = false,
  now
}) => {
  const { profile } = useAuth();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [reviewDraft, setReviewDraft] = useState<PosV2ReceiptRevisionDraft | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [progress, setProgress] = useState<PosV2RevisionRequestProgress | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replacementCheckoutRunning, setReplacementCheckoutRunning] = useState(false);
  const replacementAttemptRef = useRef<string | null>(null);

  const decision = getPosV2ReceiptRevisionUiDecision(sale as any, { canOperatePos, now });
  const authenticatedTenantId = String(profile?.tenantId || '').trim();
  const saleTenantId = String((sale as any).tenantId || '').trim();
  const tenantId = authenticatedTenantId && authenticatedTenantId === saleTenantId ? authenticatedTenantId : null;
  const catalog = usePosV2RevisionCatalogData(tenantId, isEditorOpen && decision.canRevise);

  useEffect(() => {
    const revisionId = String((sale as any).revisionId || '').trim();
    const isReplacement = (sale as any).isRevisionReplacement === true || Boolean(String((sale as any).revisionOfSaleId || '').trim());
    if (isReplacement || !revisionId || decision.state !== 'REVISION_IN_PROGRESS') return;
    try {
      setRequestId(current => current || posV2RevisionRequestIdForRevision(revisionId));
    } catch {
      // Invalid historical identity remains fail-closed and does not create a request.
    }
  }, [sale, decision.state]);

  useEffect(() => {
    if (!requestId) return;
    setSubmissionError(null);
    return watchPosV2RevisionRequest(
      requestId,
      next => setProgress(next),
      error => setSubmissionError(error.message)
    );
  }, [requestId]);

  const runReplacementCheckout = async (currentProgress: PosV2RevisionRequestProgress | null = progress) => {
    if (!currentProgress || String(currentProgress.status || '').toUpperCase() !== 'REPLACEMENT_PENDING') return;
    if (!canOperatePos) {
      setSubmissionError('An authorized POS operator assigned to this branch must resume the corrected checkout.');
      return;
    }
    const attemptKey = `${currentProgress.id}:${String(currentProgress.revisionId || '')}`;
    if (replacementCheckoutRunning || replacementAttemptRef.current === attemptKey) return;

    replacementAttemptRef.current = attemptKey;
    setReplacementCheckoutRunning(true);
    setSubmissionError(null);
    try {
      const result = await executePosV2RevisionReplacement({ progress: currentProgress, originalSale: sale });
      toast.success(`Corrected receipt ${result.receiptNumber} created. Final lifecycle posting is being completed.`);
    } catch (error) {
      replacementAttemptRef.current = null;
      const message = error instanceof Error ? error.message : 'Corrected replacement checkout failed safely.';
      setSubmissionError(message);
      toast.error(message);
    } finally {
      setReplacementCheckoutRunning(false);
    }
  };

  useEffect(() => {
    if (String(progress?.status || '').toUpperCase() !== 'REPLACEMENT_PENDING') return;
    void runReplacementCheckout(progress);
    // The durable request identity and deterministic checkout attempt make replay safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.id, progress?.status, canOperatePos]);

  if (!decision.showReviseAction && !requestId && !progress) return null;

  const label = actionLabel(decision);
  const remaining = remainingWindowLabel(decision.remainingMs);
  const title = remaining ? `${decision.message} ${remaining}.` : decision.message;

  const openEditor = () => {
    if (!decision.canRevise || isSubmitting) return;
    if (!tenantId) {
      const message = 'This receipt does not belong to the authenticated tenant and cannot be revised.';
      setSubmissionError(message);
      toast.error(message);
      return;
    }
    setReviewDraft(null);
    setSubmissionError(null);
    setIsEditorOpen(true);
  };

  const continueToReview = (draft: PosV2ReceiptRevisionDraft) => {
    setReviewDraft(draft);
    setIsEditorOpen(false);
  };

  const backToEditor = () => {
    if (isSubmitting) return;
    setReviewDraft(null);
    setIsEditorOpen(true);
  };

  const cancelRevisionFlow = () => {
    if (isSubmitting) return;
    setIsEditorOpen(false);
    setReviewDraft(null);
    setSubmissionError(null);
  };

  const submitReviewedDraft = async (plan: PosV2RevisionPlan, draft: PosV2ReceiptRevisionDraft) => {
    if (!canOperatePos) {
      const message = 'You no longer have permission to revise POS receipts.';
      setSubmissionError(message);
      toast.error(message);
      return;
    }
    if (!profile?.uid) {
      const message = 'An authenticated staff profile is required to submit this revision.';
      setSubmissionError(message);
      toast.error(message);
      return;
    }
    const name = actorName(profile);
    if (!name) {
      const message = 'The revision actor name is missing from the staff profile.';
      setSubmissionError(message);
      toast.error(message);
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      const result = await submitPosV2RevisionRequest({
        originalSale: sale,
        plan,
        revisedItems: draft.items,
        actor: {
          uid: profile.uid,
          name,
          role: String(profile.role || '').trim() || undefined
        },
        now
      });
      setRequestId(result.request.requestId);
      setProgress({ id: result.request.requestId, ...result.request });
      setReviewDraft(null);
      setIsEditorOpen(false);
      toast.success(result.replayed
        ? 'Revision request recovered. Continuing the existing safe lifecycle.'
        : 'Revision request submitted. The original transaction is now entering controlled reversal.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Revision submission failed safely.';
      setSubmissionError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeProgress = () => {
    const status = String(progress?.status || '').toUpperCase();
    if (status !== 'COMPLETED' && status !== 'FAILED' && progress?.requiresManualReview !== true) return;
    setRequestId(null);
    setProgress(null);
    setSubmissionError(null);
    replacementAttemptRef.current = null;
  };

  const editor = isEditorOpen ? (
    <PosV2ReceiptRevisionEditor
      sale={sale}
      onCancel={cancelRevisionFlow}
      onContinue={continueToReview}
      catalogProducts={catalog.products}
      catalogBatches={catalog.batches}
      catalogSystemSettings={catalog.systemSettings}
      catalogReady={catalog.isReady}
      referenceClients={catalog.clients}
      referenceInstitutions={catalog.institutions}
      referencePrescribers={catalog.prescribers}
      referencesReady={catalog.referencesReady}
    />
  ) : null;

  const review = reviewDraft ? (
    <PosV2ReceiptRevisionReview
      sale={sale}
      draft={reviewDraft}
      onBack={backToEditor}
      onCancel={cancelRevisionFlow}
      onConfirm={submitReviewedDraft}
      now={now}
      isSubmitting={isSubmitting}
      submissionError={submissionError}
    />
  ) : null;

  const progressModal = requestId || progress ? (
    <PosV2ReceiptRevisionProgress
      progress={progress}
      localError={submissionError}
      replacementCheckoutRunning={replacementCheckoutRunning}
      onRetryReplacement={() => {
        replacementAttemptRef.current = null;
        void runReplacementCheckout(progress);
      }}
      onClose={closeProgress}
    />
  ) : null;

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={openEditor}
          disabled={!decision.canRevise || isSubmitting}
          aria-label={label}
          title={title}
          className={decision.canRevise
            ? 'p-2 rounded-lg transition-colors text-amber-700 hover:bg-amber-100 cursor-pointer'
            : 'p-2 rounded-lg text-zinc-300 opacity-60 cursor-not-allowed'}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        {editor}
        {review}
        {progressModal}
      </>
    );
  }

  return (
    <>
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={openEditor}
          disabled={!decision.canRevise || isSubmitting}
          title={title}
          className={decision.canRevise
            ? 'w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-amber-500/10'
            : 'w-full py-3 bg-zinc-100 text-zinc-400 rounded-xl font-bold flex items-center justify-center gap-2 cursor-not-allowed'}
        >
          <RotateCcw className="w-4 h-4" />
          {label}
        </button>
        <p className="text-[10px] text-zinc-400 text-center px-2" title={decision.deadline || undefined}>
          {remaining || decision.message}
        </p>
      </div>
      {editor}
      {review}
      {progressModal}
    </>
  );
};

export { actionLabel as getPosV2ReceiptRevisionActionLabel, remainingWindowLabel as getPosV2ReceiptRevisionRemainingLabel };
