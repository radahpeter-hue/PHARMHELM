import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateUgandaResidentPaye, calculateUgandaNssf } from '../src/services/ugandaPayrollTaxPolicy';
test('URA July 2026 threshold and transition', () => {
  assert.equal(calculateUgandaResidentPaye(335000, '2026-07-31'), 0);
  assert.equal(calculateUgandaResidentPaye(410000, '2026-07-31'), 15000);
  assert.equal(calculateUgandaResidentPaye(485000, '2026-07-31'), 33750);
  assert.equal(calculateUgandaResidentPaye(500000, '2026-07-31'), 38250);
  assert.equal(calculateUgandaResidentPaye(500000, '2026-06-30'), 52000);
});
test('Uganda resident higher-band surcharge', () => {
  assert.equal(calculateUgandaResidentPaye(10000000, '2026-10-31'), 2888250);
  assert.equal(calculateUgandaResidentPaye(11000000, '2026-10-31'), 3288250);
});
test('NSSF 5% employee and 10% employer based on gross', () => {
  assert.deepEqual(calculateUgandaNssf(600000, true), { employee: 30000, employer: 60000 });
  assert.deepEqual(calculateUgandaNssf(600000, false), { employee: 0, employer: 0 });
});
test('tax calculations reject invalid amount or period', () => {
  assert.throws(() => calculateUgandaResidentPaye(2.25, '2026-10-31'));
  assert.throws(() => calculateUgandaResidentPaye(-1, '2026-10-31'));
  assert.throws(() => calculateUgandaResidentPaye(100000, '2026-31-10'));
});
