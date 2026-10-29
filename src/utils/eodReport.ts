import { EOD_PAYMENT_CHANNELS } from './eodExpected';
import { eodVariance, sumEodAmounts } from './eodMoney';
/** Normalize report fields without rewriting legacy documents or treating declarations as revenue. */
export function eodReportRecord(record: Record<string, any>) {
  const expected = record.total_expected ?? record.sales_expected ?? sumEodAmounts(EOD_PAYMENT_CHANNELS.map(c=>record[`${c}_expected`] ?? 0));
  const declared = record.total_actual ?? sumEodAmounts(EOD_PAYMENT_CHANNELS.map(c=>record[`${c}_actual`] ?? 0));
  return { businessDate: record.reconciliation_date || record.date || '',
    shift: record.shift_name || record.shift_id || record.shift || 'Historical whole-day — shift not recorded',
    expected, declared, variance: eodVariance(declared, expected) };
}
