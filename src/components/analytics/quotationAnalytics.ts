import { normalizeDateValue } from '../../utils/dateValue';

export interface QuotationAnalyticsRecord {
  status?: string;
  validityDate?: unknown;
  createdAt?: unknown;
  convertedAt?: unknown;
  grandTotal?: number | null;
  convertedValue?: number | null;
  createdBy?: string | null;
  createdByName?: string | null;
}

const millisecondsPerDay = 86_400_000;

function quotationStatus(quotation: QuotationAnalyticsRecord, now: Date) {
  if (quotation.status !== 'Draft') return quotation.status;
  const value = typeof quotation.validityDate === 'string'
    ? quotation.validityDate.trim()
    : quotation.validityDate;
  // A date-only deadline is valid through that local calendar day.
  const deadline = normalizeDateValue(
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999` : value
  );
  return deadline && deadline < now ? 'Expired' : 'Draft';
}

export function buildQuotationAnalytics(quotations: readonly QuotationAnalyticsRecord[], now: Date) {
  let converted = 0;
  let expired = 0;
  let totalExpiredValue = 0;
  let totalQuotedValue = 0;
  let totalConvertedValue = 0;
  let totalConvertDays = 0;
  let timedConversions = 0;
  const byStaff = new Map<string, { name: string; total: number; converted: number }>();

  for (const quotation of quotations) {
    const author = quotation.createdBy || 'unknown';
    const staff = byStaff.get(author) ?? { name: quotation.createdByName || 'Staff', total: 0, converted: 0 };
    byStaff.set(author, staff);

    const status = quotationStatus(quotation, now);
    const value = quotation.grandTotal || 0;
    if (status === 'Expired') {
      expired++;
      totalExpiredValue += value;
      staff.total++;
    } else if (status === 'Converted') {
      converted++;
      totalQuotedValue += value;
      totalConvertedValue += quotation.convertedValue || value;
      staff.total++;
      staff.converted++;

      const start = normalizeDateValue(quotation.createdAt);
      const end = normalizeDateValue(quotation.convertedAt);
      if (start && end) {
        totalConvertDays += Math.abs(end.getTime() - start.getTime()) / millisecondsPerDay;
        timedConversions++;
      }
    }
  }

  const resolved = converted + expired;
  const staffRankings = Array.from(byStaff.values(), staff => ({
    ...staff,
    rate: staff.total > 0 ? Math.round((staff.converted / staff.total) * 100) : 0,
  })).sort((a, b) => b.rate - a.rate);

  return {
    quotesCount: quotations.length,
    conversionRate: resolved > 0 ? Math.round((converted / resolved) * 100) : 0,
    avgTimeToConvert: timedConversions > 0 ? (totalConvertDays / timedConversions).toFixed(1) : 'N/A',
    totalQuotedValue,
    totalConvertedValue,
    totalExpiredValue,
    staffRankings,
  };
}
