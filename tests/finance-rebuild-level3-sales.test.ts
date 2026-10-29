import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePosShift } from '../src/utils/posShiftAttribution';
import { eodVariance } from '../src/utils/eodMoney';
import { expectedEodSales } from '../src/utils/eodExpected';
const branch = { shifts: { dayShift: { enabled: true, startTime: '08:00', endTime: '16:00' }, eveningShift: { enabled: true, startTime: '16:00', endTime: '22:00' }, nightShift: { enabled: true, startTime: '22:00', endTime: '08:00' } } };
const sale = (amount: number, timestamp: string, extra: any = {}) => ({ id: timestamp, tenantId: 'mp', branchId: 'masaka', status: 'completed', timestamp, totalAmount: amount, paymentMethod: 'cash', eodShift: capturePosShift(branch, timestamp), ...extra }) as any;
test('026 separates 400,000 and 600,000 by saved shift; empty, other date/branch/tenant excluded', () => {
  const sales = [sale(400000,'2026-10-28T10:00:00Z'), sale(600000,'2026-10-28T15:00:00Z'), sale(90,'2026-10-28T10:00:00Z',{tenantId:'other'}), sale(80,'2026-10-28T10:00:00Z',{branchId:'other'}), sale(70,'2026-10-27T10:00:00Z'), sale(60,'2026-10-28T10:00:00Z',{status:'voided'}), sale(50,'2026-10-28T10:00:00Z',{supersededBySaleId:'replacement'})];
  const expected = (shift: string, date='2026-10-28') => expectedEodSales(sales,'mp','masaka',date,shift);
  assert.equal(expected('dayShift').computedExpected.total,400000);
  assert.equal(expected('eveningShift').computedExpected.total,600000);
  assert.equal(expected('nightShift').computedExpected.total,0);
  assert.equal(expected('dayShift','2026-10-27').computedExpected.total,70);
});
test('026 overnight shift uses starting business day; end boundary is exclusive', () => {
  assert.equal(capturePosShift(branch,'2026-10-28T21:00:00Z')?.businessDate,'2026-10-28');
  assert.equal(capturePosShift(branch,'2026-10-29T04:59:00Z')?.businessDate,'2026-10-28');
  assert.equal(capturePosShift(branch,'2026-10-29T05:00:00Z')?.shiftId,'dayShift');
  assert.equal(expectedEodSales([sale(42,'2026-10-29T04:00:00Z')],'mp','masaka','2026-10-28','nightShift').computedExpected.cash,42);
});
test('026 no shift guessing for historical, missing, ambiguous or overlapping configurations', () => {
  const legacy = sale(100,'2026-10-28T10:00:00Z',{eodShift:undefined});
  const result = expectedEodSales([legacy],'mp','masaka','2026-10-28','dayShift');
  assert.equal(result.computedExpected.total,0); assert.equal(result.unattributedSalesCount,1);
  assert.equal(capturePosShift({},legacy.timestamp),undefined);
  assert.equal(capturePosShift(branch,'2026-10-28T10:00:00'),undefined);
  const overlap=structuredClone(branch); overlap.shifts.eveningShift.startTime='12:00';
  assert.equal(capturePosShift(overlap,legacy.timestamp),undefined);
  const gap=structuredClone(branch); gap.shifts.dayShift.enabled=false;
  assert.equal(capturePosShift(gap,legacy.timestamp),undefined);
});
test('026 later Settings changes do not reclassify a captured sale; split/credit totals retain precision', () => {
  const saved=sale(500000,'2026-10-28T10:00:00Z',{paymentMethod:'staff_welfare',welfareAmount:100000,secondaryPaymentMethod:'cash',secondaryAmount:400000});
  const r=expectedEodSales([saved,sale(0.1,'2026-10-28T10:00:00Z',{paymentMethod:'credit'}),sale(0.2,'2026-10-28T10:00:00Z',{paymentMethod:'credit'})],'mp','masaka','2026-10-28','dayShift');
  assert.equal(r.computedExpected.cash,400000);assert.equal(r.computedExpected.staff_welfare,100000);assert.equal(eodVariance(r.computedExpected.institutional_credit,0.3),0);
  assert.equal(saved.eodShift.shiftId,'dayShift');assert.equal(saved.eodShift.startTime,'08:00');
});
