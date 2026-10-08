import type { PosV2RevisionLedgerEntry } from './posSaleRevisionV2Ledger';
import type { Branch } from '../../types';

export interface PosV2BranchRevisionAnalyticsRow {
  revisionId: string;
  requestId: string;
  originalReceiptNumber: string;
  replacementReceiptNumber: string | null;
  originalSeller: PosV2RevisionLedgerEntry['originalSeller'];
  revisionEditor: PosV2RevisionLedgerEntry['revisionEditor'];
  reason: string;
  occurredAt: unknown;
  originalTotal: number;
  correctedTotal: number;
  monetaryDelta: number;
  adjustmentDirection: PosV2RevisionLedgerEntry['adjustmentDirection'];
  lifecycleStatus: string;
}

export interface PosV2BranchRevisionAnalytics {
  tenantId: string;
  branchId: string;
  revisedReceiptCount: number;
  completedRevisionCount: number;
  failedRevisionCount: number;
  originalValue: number;
  correctedValue: number;
  additions: number;
  deductions: number;
  netChange: number;
  rows: PosV2BranchRevisionAnalyticsRow[];
}

export interface PosV2GlobalRevisionAnalytics {
  tenantId: string;
  revisedReceiptCount: number;
  completedRevisionCount: number;
  failedRevisionCount: number;
  originalValue: number;
  correctedValue: number;
  additions: number;
  deductions: number;
  netChange: number;
  branches: Array<PosV2BranchRevisionAnalytics & { branchName: string }>;
}

const clean = (value: unknown): string => String(value ?? '').trim();

export function buildPosV2BranchRevisionAnalytics(
  entries: PosV2RevisionLedgerEntry[],
  scope: { tenantId: string; branchId: string }
): PosV2BranchRevisionAnalytics {
  const tenantId = clean(scope.tenantId);
  const branchId = clean(scope.branchId);
  if (!tenantId || !branchId) throw new Error('Branch revision analytics require tenant and branch scope.');

  for (const entry of entries) {
    if (clean(entry.tenantId) !== tenantId || clean(entry.branchId) !== branchId) {
      throw new Error('Branch revision analytics cannot combine cross-tenant or cross-branch evidence.');
    }
  }

  const rows = entries.map(entry => ({
    revisionId: entry.revisionId,
    requestId: entry.requestId,
    originalReceiptNumber: entry.originalReceiptNumber,
    replacementReceiptNumber: entry.replacementReceiptNumber,
    originalSeller: { ...entry.originalSeller },
    revisionEditor: { ...entry.revisionEditor },
    reason: entry.reason,
    occurredAt: entry.timestamps.completedAt
      || entry.timestamps.updatedAt
      || entry.timestamps.firstAttemptAt
      || entry.timestamps.originalSaleAt,
    originalTotal: entry.originalTotal,
    correctedTotal: entry.correctedTotal,
    monetaryDelta: entry.monetaryDelta,
    adjustmentDirection: entry.adjustmentDirection,
    lifecycleStatus: entry.lifecycleStatus
  }));

  return rows.reduce<PosV2BranchRevisionAnalytics>((analytics, row) => {
    analytics.revisedReceiptCount += 1;
    analytics.completedRevisionCount += row.lifecycleStatus === 'COMPLETED' ? 1 : 0;
    analytics.failedRevisionCount += row.lifecycleStatus === 'FAILED' ? 1 : 0;
    if (row.lifecycleStatus === 'RECONCILIATION_REQUIRED') {
      analytics.rows.push(row);
      return analytics;
    }
    analytics.originalValue += row.originalTotal;
    analytics.correctedValue += row.correctedTotal;
    analytics.additions += row.monetaryDelta > 0 ? row.monetaryDelta : 0;
    analytics.deductions += row.monetaryDelta < 0 ? Math.abs(row.monetaryDelta) : 0;
    analytics.netChange += row.monetaryDelta;
    analytics.rows.push(row);
    return analytics;
  }, {
    tenantId,
    branchId,
    revisedReceiptCount: 0,
    completedRevisionCount: 0,
    failedRevisionCount: 0,
    originalValue: 0,
    correctedValue: 0,
    additions: 0,
    deductions: 0,
    netChange: 0,
    rows: []
  });
}

export function buildPosV2GlobalRevisionAnalytics(
  entries: PosV2RevisionLedgerEntry[],
  scope: { tenantId: string },
  branches: Pick<Branch, 'id' | 'tenantId' | 'name'>[] = []
): PosV2GlobalRevisionAnalytics {
  const tenantId = clean(scope.tenantId);
  if (!tenantId) throw new Error('Global revision analytics require tenant scope.');
  if (entries.some(entry => clean(entry.tenantId) !== tenantId)) {
    throw new Error('Global revision analytics cannot combine cross-tenant evidence.');
  }
  if (branches.some(branch => clean(branch.tenantId) !== tenantId)) {
    throw new Error('Global revision analytics cannot resolve cross-tenant branches.');
  }

  const branchNames = new Map(branches.map(branch => [clean(branch.id), clean(branch.name)]));
  const grouped = new Map<string, PosV2RevisionLedgerEntry[]>();
  for (const entry of entries) {
    const branchId = clean(entry.branchId);
    const current = grouped.get(branchId) || [];
    current.push(entry);
    grouped.set(branchId, current);
  }

  const branchAnalytics = Array.from(grouped.entries()).map(([branchId, branchEntries]) => ({
    ...buildPosV2BranchRevisionAnalytics(branchEntries, { tenantId, branchId }),
    branchName: branchNames.get(branchId) || branchId
  })).sort((left, right) => left.branchName.localeCompare(right.branchName));

  return branchAnalytics.reduce<PosV2GlobalRevisionAnalytics>((analytics, branch) => {
    analytics.revisedReceiptCount += branch.revisedReceiptCount;
    analytics.completedRevisionCount += branch.completedRevisionCount;
    analytics.failedRevisionCount += branch.failedRevisionCount;
    analytics.originalValue += branch.originalValue;
    analytics.correctedValue += branch.correctedValue;
    analytics.additions += branch.additions;
    analytics.deductions += branch.deductions;
    analytics.netChange += branch.netChange;
    analytics.branches.push(branch);
    return analytics;
  }, {
    tenantId,
    revisedReceiptCount: 0,
    completedRevisionCount: 0,
    failedRevisionCount: 0,
    originalValue: 0,
    correctedValue: 0,
    additions: 0,
    deductions: 0,
    netChange: 0,
    branches: []
  });
}
