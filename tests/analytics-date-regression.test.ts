import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase/firestore';
import { normalizeDateValue } from '../src/utils/dateValue';
import { analyticsDateText } from '../src/components/analytics/analyticsDateText';
import { buildQuotationAnalytics } from '../src/components/analytics/quotationAnalytics';

test('date normalization accepts SDK timestamps, ISO strings, Date and legacy timestamp shapes', () => {
  const iso = '2026-11-10T20:30:00.125Z';
  const date = new Date(iso);
  const { seconds, nanoseconds } = Timestamp.fromDate(date);
  const values = [
    Timestamp.fromDate(date), iso, '2026-11-10T23:30:00.125+03:00', date, date.getTime(),
    { seconds, nanoseconds }, { _seconds: seconds, _nanoseconds: nanoseconds },
  ];
  for (const value of values) assert.equal(normalizeDateValue(value)?.toISOString(), iso);
  assert.equal(normalizeDateValue({ seconds: 0 })?.getTime(), 0);
});

test('date normalization ignores missing, invalid and malformed values', () => {
  const invalid = [
    null, undefined, '', ' ', 'not-a-date', '0', '2026-02-30', '2026-02-30T08:00:00Z',
    new Date(NaN), NaN, Infinity, true, {}, { toDate: 42 }, { toDate: () => 'invalid' },
    { seconds: '1' }, { seconds: Infinity }, { seconds: 1.1 }, { seconds: 1, nanoseconds: '1' },
    { seconds: 1, nanoseconds: null }, { seconds: 1, nanoseconds: -1 }, { seconds: 1, nanoseconds: 1e9 },
  ];
  for (const value of invalid) assert.equal(normalizeDateValue(value), null);
});

test('existing report calendar dates and written times survive normalization', () => {
  assert.equal(analyticsDateText('2026-11-11'), '2026-11-11');
  assert.equal(analyticsDateText('2026-11-11T00:30:00+03:00'), '2026-11-11T00:30:00+03:00');
  assert.equal(analyticsDateText(Timestamp.fromMillis(0)), '1970-01-01T00:00:00.000Z');
  assert.equal(analyticsDateText({ toDate: true }), '');
});

test('quote deadlines preserve timestamp precision and date-only local calendar days', () => {
  const now = new Date(2026, 10, 11, 12);
  const quotes = [
    { status: 'Draft', validityDate: Timestamp.fromMillis(now.getTime() - 1), grandTotal: 10 },
    { status: 'Draft', validityDate: new Date(now.getTime() + 1), grandTotal: 20 },
    { status: 'Draft', validityDate: now.toISOString(), grandTotal: 40 },
    { status: 'Draft', validityDate: '2026-11-10', grandTotal: 80 },
    { status: 'Draft', validityDate: '2026-11-11', grandTotal: 160 },
    { status: 'Draft', validityDate: null, grandTotal: 320 },
    { status: 'Draft', grandTotal: 640 },
    { status: 'Draft', validityDate: '2026-02-30', grandTotal: 1280 },
    { status: 'Draft', validityDate: { toDate: false }, grandTotal: 2560 },
    { status: 'Expired', grandTotal: 5 },
  ];
  assert.equal(buildQuotationAnalytics(quotes, now).totalExpiredValue, 95);
  assert.equal(buildQuotationAnalytics([quotes[4]], new Date(2026, 10, 11, 23, 59, 59, 999)).totalExpiredValue, 0);
  assert.equal(buildQuotationAnalytics([quotes[4]], new Date(2026, 10, 12)).totalExpiredValue, 160);
});

test('mixed historical quotation dates preserve rates, valid conversion times and quoted amounts', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const start = new Date('2026-11-01T12:00:00Z');
  const converted = { status: 'Converted', createdBy: 'a', createdByName: 'Staff A' };
  const stats = buildQuotationAnalytics([
    { ...converted, createdAt: Timestamp.fromDate(start), convertedAt: '2026-11-02T12:00:00Z', grandTotal: 200, convertedValue: 220 },
    { ...converted, createdAt: start, convertedAt: { _seconds: Date.parse('2026-11-04T12:00:00Z') / 1000 }, grandTotal: 100 },
    { ...converted, createdAt: new Date(NaN), convertedAt: null, grandTotal: 50 },
    { status: 'Draft', createdBy: 'a', validityDate: '2026-11-05T00:00:00Z', grandTotal: 80 },
    { status: 'Draft', createdBy: 'a', validityDate: null, grandTotal: 90 },
    { status: 'Expired', createdBy: 'b', createdByName: 'Staff B', grandTotal: 20 },
  ], now);
  assert.deepEqual(stats, {
    quotesCount: 6, conversionRate: 60, avgTimeToConvert: '2.0',
    totalQuotedValue: 350, totalConvertedValue: 370, totalExpiredValue: 100,
    staffRankings: [
      { name: 'Staff A', total: 4, converted: 3, rate: 75 },
      { name: 'Staff B', total: 1, converted: 0, rate: 0 },
    ],
  });
  assert.equal(buildQuotationAnalytics([converted], now).avgTimeToConvert, 'N/A');
});
