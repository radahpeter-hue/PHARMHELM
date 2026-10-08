import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileLegacyReceipt, LEGACY_RECEIPT_REPAIR as s } from '../scripts/pos-v2-legacy-receipt-repair-core.mjs';
import { legacyRepairFixture } from './fixtures/legacy-receipt-repair.mjs';
function database() {
  let records = legacyRepairFixture();
  const ref = (path: string) => ({ path });
  const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`),
    where: (field: string, op: string, value: unknown) => ({ name, field, value }) }),
    runTransaction: async (callback: any) => {
      const staged = new Map([...records].map(([key, value]) => [key, structuredClone(value)]));
      const tx = { get: async (target: any) => {
        if (target.name) return { docs: [...staged].filter(([key, value]: any) => key.startsWith(`${target.name}/`) && value[target.field] === target.value)
          .map(([path, data]: any) => ({ id: path.split('/')[1], ref: ref(path), data: () => data })) };
        return { exists: staged.has(target.path), data: () => staged.get(target.path) };
      }, update: (target: any, patch: any) => { assert.ok(staged.has(target.path)); staged.set(target.path, { ...staged.get(target.path), ...patch }); },
      create: (target: any, data: any) => { assert.ok(!staged.has(target.path)); staged.set(target.path, data); } };
      const result = await callback(tx); records = staged; return result;
    } };
  return { db, records: () => records };
}
const FieldValue = { serverTimestamp: () => 'server-time' };
test('legacy recovery repairs all related values atomically, preserves before images and replays without another deduction', async () => {
  const fixture = database(); const before = structuredClone(fixture.records());
  const args = { db: fixture.db, FieldValue };
  const dry = await reconcileLegacyReceipt(args);
  assert.equal(dry.additionalBaseUnits, 200); assert.deepEqual(fixture.records(), before);
  const result = await reconcileLegacyReceipt({ ...args, apply: true }); assert.equal(result.repaired, true);
  const records = fixture.records();
  assert.equal((records.get(`sales/${s.replacementId}`) as any).items[0].quantity, 30);
  assert.equal((records.get(`sales/${s.replacementId}`) as any).items[0].baseQuantity, 300);
  assert.equal((records.get(`sales/${s.replacementId}`) as any).actualSaleCost, 9000);
  assert.equal((records.get('pos_payments/repair-payment') as any).amount, 15000);
  assert.equal((records.get(`product_batches/${s.batchId}`) as any).quantity, 530);
  assert.equal((records.get(`products/${s.productId}`) as any).stock, 530);
  const summary = [...records].find(([key]) => key.startsWith('branchConsumptionDaily/'))![1] as any;
  assert.equal(summary.validConsumptionUnits, 470); assert.equal(summary.transactionCount, 3);
  assert.deepEqual(records.get(`sales/${s.originalId}`), before.get(`sales/${s.originalId}`));
  assert.deepEqual((records.get(`sale_revisions/${s.repairId}`) as any).before.sale, before.get(`sales/${s.replacementId}`));
  const completed = structuredClone(records);
  assert.equal((await reconcileLegacyReceipt({ ...args, apply: true })).replayed, true);
  assert.deepEqual(fixture.records(), completed);
});
test('scoped recovery refuses changed intent, payment, tenant, reversal, stock and partial evidence without writes', async () => {
  const changes: Array<[string, any]> = [
    [`sales/${s.replacementId}`, { branchId: 'other' }],
    [`pos_sale_revision_requests/pos_revision_request_${s.revisionId}`, { revisedTotal: 20000 }],
    ['pos_payments/repair-payment', { amount: 6000 }],
    ['pos_payment_reversals/repair-payment-reversal', { amountDelta: -4000 }],
    [`products/${s.productId}`, { stock: 700 }],
    [`product_batches/${s.batchId}`, { quantity: 100 }],
    [`product_batches/${s.batchId}`, { batch_status: 'quarantined' }],
    [`product_batches/${s.batchId}`, { expiryDate: '2020-01-01' }]
  ];
  for (const [path, patch] of changes) {
    const fixture = database(); fixture.records().set(path, { ...fixture.records().get(path), ...patch });
    const before = structuredClone(fixture.records());
    await assert.rejects(reconcileLegacyReceipt({ db: fixture.db, FieldValue, apply: true }), /repair refused/);
    assert.deepEqual(fixture.records(), before);
  }
});
