import type { Branch } from '../../types';
import { normalizeDateValue } from '../../utils/dateValue';
import type { PosV2RevisionLedgerEntry } from './posSaleRevisionV2Ledger';

export type PosV2RevisionReportScope =
  | { kind: 'BRANCH'; tenantId: string; branchId: string }
  | { kind: 'GLOBAL'; tenantId: string };

const clean = (value: unknown): string => String(value ?? '').trim();
const iso = (value: unknown): string => normalizeDateValue(value)?.toISOString() || '';
const spreadsheetSafe = (value: string): string => /^[=+\-@]/.test(value) ? `'${value}` : value;
const csv = (value: unknown): string => `"${spreadsheetSafe(String(value ?? '')).replaceAll('"', '""')}"`;

const HEADERS = [
  'Revision ID', 'Request ID', 'Tenant ID', 'Branch ID', 'Branch Name',
  'Original Sale ID', 'Original Receipt Number', 'Replacement Sale ID', 'Replacement Receipt Number',
  'Original Seller ID', 'Original Seller Name', 'Revision Editor ID', 'Revision Editor Name', 'Revision Editor Role',
  'Replacement Executor ID', 'Replacement Executor Name', 'Reason', 'Lifecycle Status',
  'Original Total', 'Corrected Total', 'Monetary Delta', 'Adjustment Direction',
  'Original Sale At', 'Requested At', 'First Attempt At', 'Replacement Created At', 'Completed At', 'Updated At', 'Manual Review At',
  'Item Changes', 'Contextual Changes', 'Failure Message', 'Manual Review Required', 'Actual Corrected Total', 'Evidence Issues'
] as const;

export function buildPosV2RevisionReportCsv(
  entries: PosV2RevisionLedgerEntry[],
  scope: PosV2RevisionReportScope,
  branches: Pick<Branch, 'id' | 'tenantId' | 'name'>[] = []
): string {
  const tenantId = clean(scope.tenantId);
  if (!tenantId) throw new Error('Revision report export requires tenant scope.');
  if (scope.kind === 'BRANCH' && !clean(scope.branchId)) {
    throw new Error('Branch revision report export requires branch scope.');
  }
  if (entries.some(entry => clean(entry.tenantId) !== tenantId)) {
    throw new Error('Revision report export cannot include cross-tenant evidence.');
  }
  if (scope.kind === 'BRANCH' && entries.some(entry => clean(entry.branchId) !== clean(scope.branchId))) {
    throw new Error('Branch revision report export cannot include cross-branch evidence.');
  }
  if (branches.some(branch => clean(branch.tenantId) !== tenantId)) {
    throw new Error('Revision report export cannot resolve cross-tenant branches.');
  }

  const branchNames = new Map(branches.map(branch => [clean(branch.id), clean(branch.name)]));
  const rows = entries.map(entry => [
    entry.revisionId, entry.requestId, entry.tenantId, entry.branchId, branchNames.get(entry.branchId) || entry.branchId,
    entry.originalSaleId, entry.originalReceiptNumber, entry.replacementSaleId, entry.replacementReceiptNumber,
    entry.originalSeller.id, entry.originalSeller.name, entry.revisionEditor.id, entry.revisionEditor.name, entry.revisionEditor.role,
    entry.replacementExecutor.id, entry.replacementExecutor.name, entry.reason, entry.lifecycleStatus,
    entry.originalTotal, entry.correctedTotal, entry.monetaryDelta, entry.adjustmentDirection,
    iso(entry.timestamps.originalSaleAt), iso(entry.timestamps.requestedAt), iso(entry.timestamps.firstAttemptAt),
    iso(entry.timestamps.replacementCreatedAt), iso(entry.timestamps.completedAt), iso(entry.timestamps.updatedAt), iso(entry.timestamps.manualReviewAt),
    JSON.stringify(entry.itemChanges), JSON.stringify(entry.contextualChanges), entry.failure?.message || '',
    entry.failure?.requiresManualReview ? 'YES' : 'NO', entry.actualCorrectedTotal ?? '', (entry.evidenceIssues || []).join(' ')
  ]);

  return `\uFEFF${[HEADERS, ...rows].map(row => row.map(csv).join(',')).join('\r\n')}`;
}

export function buildPosV2RevisionReportFilename(scope: PosV2RevisionReportScope, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const scopeName = scope.kind === 'BRANCH' ? `branch-${clean(scope.branchId)}` : 'global';
  return `pos-v2-revision-report-${scopeName}-${day}.csv`;
}
