import type { Sale } from '../../types';

export type PosV2RevisionReceiptKind =
  | 'STANDARD'
  | 'REVISION_IN_PROGRESS'
  | 'ORIGINAL_SUPERSEDED'
  | 'CORRECTED_RECEIPT';

export interface PosV2RevisionReceiptPresentation {
  kind: PosV2RevisionReceiptKind;
  isRevisionRelated: boolean;
  badgeLabel: string | null;
  documentTitle: 'RECEIPT' | 'REVISION IN PROGRESS' | 'SUPERSEDED RECEIPT' | 'CORRECTED RECEIPT';
  revisionId: string | null;
  revisionRequestId: string | null;
  lifecycle: string | null;
  reason: string | null;
  editorId: string | null;
  editorName: string | null;
  linkedSaleId: string | null;
  linkedReceiptNumber: string | null;
  linkedReceiptLabel: 'Original receipt' | 'Corrected receipt' | null;
}

const clean = (value: unknown): string | null => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

/**
 * Read-only receipt presentation metadata derived only from immutable sale linkage.
 * It deliberately does not infer or replace the original seller, revision editor,
 * or replacement executor because those are separate audit identities.
 */
export function getPosV2RevisionReceiptPresentation(sale: Sale): PosV2RevisionReceiptPresentation {
  const revisionId = clean(sale.revisionId);
  const lifecycle = clean(sale.revisionLifecycle)?.toUpperCase() || null;
  const isReplacement = sale.isRevisionReplacement === true || Boolean(clean(sale.revisionOfSaleId));

  if (isReplacement) {
    return {
      kind: 'CORRECTED_RECEIPT',
      isRevisionRelated: true,
      badgeLabel: 'CORRECTED RECEIPT',
      documentTitle: 'CORRECTED RECEIPT',
      revisionId,
      revisionRequestId: clean(sale.revisionRequestId),
      lifecycle,
      reason: clean(sale.revisionReason),
      editorId: clean(sale.revisionRequestedBy),
      editorName: clean(sale.revisionRequestedByName),
      linkedSaleId: clean(sale.revisionOfSaleId),
      linkedReceiptNumber: clean(sale.originalReceiptNumber),
      linkedReceiptLabel: 'Original receipt'
    };
  }

  const replacementSaleId = clean(sale.supersededBySaleId);
  const replacementReceiptNumber = clean(sale.supersededByReceiptNumber);
  if (replacementSaleId || lifecycle === 'COMPLETED') {
    return {
      kind: 'ORIGINAL_SUPERSEDED',
      isRevisionRelated: true,
      badgeLabel: 'REVISED · SUPERSEDED',
      documentTitle: 'SUPERSEDED RECEIPT',
      revisionId,
      revisionRequestId: null,
      lifecycle,
      reason: clean(sale.revisionReason),
      editorId: clean(sale.revisionRequestedBy),
      editorName: clean(sale.revisionRequestedByName),
      linkedSaleId: replacementSaleId,
      linkedReceiptNumber: replacementReceiptNumber,
      linkedReceiptLabel: 'Corrected receipt'
    };
  }

  if (revisionId || sale.revisionLocked === true || lifecycle) {
    return {
      kind: 'REVISION_IN_PROGRESS',
      isRevisionRelated: true,
      badgeLabel: 'REVISION IN PROGRESS',
      documentTitle: 'REVISION IN PROGRESS',
      revisionId,
      revisionRequestId: null,
      lifecycle,
      reason: clean(sale.revisionReason),
      editorId: clean(sale.revisionRequestedBy),
      editorName: clean(sale.revisionRequestedByName),
      linkedSaleId: clean(sale.pendingReplacementSaleId),
      linkedReceiptNumber: null,
      linkedReceiptLabel: null
    };
  }

  return {
    kind: 'STANDARD',
    isRevisionRelated: false,
    badgeLabel: null,
    documentTitle: 'RECEIPT',
    revisionId: null,
    revisionRequestId: null,
    lifecycle: null,
    reason: null,
    editorId: null,
    editorName: null,
    linkedSaleId: null,
    linkedReceiptNumber: null,
    linkedReceiptLabel: null
  };
}

export function findLinkedPosV2RevisionSale(sale: Sale, branchSales: Sale[]): Sale | null {
  const presentation = getPosV2RevisionReceiptPresentation(sale);
  if (!presentation.linkedSaleId) return null;

  return branchSales.find(candidate =>
    candidate.id === presentation.linkedSaleId
    && candidate.tenantId === sale.tenantId
    && candidate.branchId === sale.branchId
  ) || null;
}
