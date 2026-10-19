import test from 'node:test';
import assert from 'node:assert/strict';
import { operationalDeliveryRoute, validateOperationalDeliveryRoute } from '../src/services/operationalDeliveryRoute';

test('historical route-less orders keep their existing HQ stock path', () => {
  assert.equal(operationalDeliveryRoute({}), 'VIA_HQ');
  assert.equal(operationalDeliveryRoute({ operational_delivery_route: 'DIRECT_BRANCH' }), 'DIRECT_BRANCH');
});

test('HQ buffer procurement cannot be redirected to a branch transit route', () => {
  assert.throws(() => validateOperationalDeliveryRoute('DIRECT_BRANCH', 'HQ'), /HQ buffer/);
  assert.throws(() => validateOperationalDeliveryRoute('OTHER' as any, 'masaka'), /valid Operational/);
  assert.doesNotThrow(() => validateOperationalDeliveryRoute('DIRECT_BRANCH', 'masaka'));
  assert.doesNotThrow(() => validateOperationalDeliveryRoute('VIA_HQ', 'HQ'));
});
