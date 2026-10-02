import React from 'react';
import { RotateCcw } from 'lucide-react';
import type { Sale } from '../../types';
import {
  getPosV2ReceiptRevisionUiDecision,
  type PosV2ReceiptRevisionUiDecision
} from '../../services/pos-v2/posSaleRevisionV2UiPolicy';

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

/**
 * Dedicated POS V2 ledger action. This component is intentionally presentation-only:
 * it does not mutate a sale, write Firestore, or call the legacy receipt edit path.
 */
export const PosV2ReceiptRevisionAction: React.FC<PosV2ReceiptRevisionActionProps> = ({
  sale,
  canOperatePos,
  onRevise,
  compact = false,
  now
}) => {
  const decision = getPosV2ReceiptRevisionUiDecision(sale as any, { canOperatePos, now });
  if (!decision.showReviseAction) return null;

  const label = actionLabel(decision);
  const remaining = remainingWindowLabel(decision.remainingMs);
  const title = remaining ? `${decision.message} ${remaining}.` : decision.message;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => decision.canRevise && onRevise(sale)}
        disabled={!decision.canRevise}
        aria-label={label}
        title={title}
        className={decision.canRevise
          ? 'p-2 rounded-lg transition-colors text-amber-700 hover:bg-amber-100 cursor-pointer'
          : 'p-2 rounded-lg text-zinc-300 opacity-60 cursor-not-allowed'}
      >
        <RotateCcw className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => decision.canRevise && onRevise(sale)}
        disabled={!decision.canRevise}
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
  );
};

export { actionLabel as getPosV2ReceiptRevisionActionLabel, remainingWindowLabel as getPosV2ReceiptRevisionRemainingLabel };
