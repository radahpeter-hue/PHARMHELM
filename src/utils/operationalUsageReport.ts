import type { OperationalInventoryUsage } from '../types';

export type UsageDateRange = { start: string; end: string };

export function localUsageDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function defaultUsageDateRange(now = new Date()): UsageDateRange {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  return { start: localUsageDate(start), end: localUsageDate(now) };
}

export function validUsageDateRange(range: UsageDateRange): boolean {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  return pattern.test(range.start) && pattern.test(range.end)
    && !Number.isNaN(new Date(range.start).getTime())
    && !Number.isNaN(new Date(range.end).getTime())
    && range.start <= range.end;
}

export function usageTimestampDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const result = new Date(value);
    return Number.isNaN(result.getTime()) ? null : result;
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const result = value.toDate();
    return result instanceof Date && !Number.isNaN(result.getTime()) ? result : null;
  }
  return null;
}

export function filterOperationalUsageByDate<T extends Pick<OperationalInventoryUsage, 'timestamp'>>(logs: T[], range: UsageDateRange): T[] {
  if (!validUsageDateRange(range)) return [];
  return logs.filter(log => {
    const date = usageTimestampDate(log.timestamp);
    if (!date) return false;
    const day = localUsageDate(date);
    return day >= range.start && day <= range.end;
  }).sort((a, b) => (usageTimestampDate(b.timestamp)?.getTime() || 0) - (usageTimestampDate(a.timestamp)?.getTime() || 0));
}

export type UsageReportRow = {
  timestamp: string;
  item: string;
  department: string;
  recipient: string;
  purpose: string;
  reference: string;
  issued: number;
  unit: string;
  cost: number;
  recordedBy: string;
};

export function operationalUsageReportRows(logs: OperationalInventoryUsage[], itemNames: Record<string,string>): UsageReportRow[] {
  return logs.map(log => ({
    timestamp: usageTimestampDate(log.timestamp)?.toLocaleString('en-GB') || 'Unknown',
    item: log.itemName || itemNames[log.inventoryId] || 'Unknown item',
    department: log.department || '',
    recipient: log.recipient || '',
    purpose: log.purpose || '',
    reference: log.reference || '',
    issued: Number(log.issuedAmount || 0),
    unit: log.unitOfIssue || 'Unit not specified',
    cost: Number(log.cost || 0),
    recordedBy: log.staffName || ''
  }));
}

function csvValue(value: string | number): string {
  let text = String(value ?? '');
  // Keep spreadsheet applications from evaluating user-provided values as formulas.
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function operationalUsageCSV(rows: UsageReportRow[]): string {
  const headings = ['Date & Time', 'Item', 'Department', 'Recipient', 'Purpose', 'Reference', 'Quantity Issued', 'Unit', 'Usage Value (UGX)', 'Recorded By'];
  return '\uFEFF' + [headings, ...rows.map(row => [
    row.timestamp, row.item, row.department, row.recipient, row.purpose, row.reference,
    row.issued, row.unit, row.cost, row.recordedBy
  ])].map(fields => fields.map(csvValue).join(',')).join('\r\n');
}
