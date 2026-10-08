import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { reconcileLegacyReceipt, LEGACY_RECEIPT_REPAIR as scope } from './pos-v2-legacy-receipt-repair-core.mjs';
import { legacyRepairFixture } from '../tests/fixtures/legacy-receipt-repair.mjs';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Recovery test requires the local Firestore emulator.');
const app = initializeApp({ projectId: 'demo-pharmhelm-spark-production' }, 'legacy-receipt-repair-test');
const db = getFirestore(app);
async function seed() {
  const batch = db.batch();
  for (const [path, data] of legacyRepairFixture()) batch.set(db.doc(path), data);
  batch.delete(db.doc(`sale_revisions/${scope.repairId}`));
  batch.delete(db.doc(`audit_logs/${scope.repairId}`));
  await batch.commit();
}
try {
  await seed();
  const args = { db, FieldValue };
  const dry = await reconcileLegacyReceipt(args);
  assert.equal(dry.additionalBaseUnits, 200);
  assert.equal((await db.doc(`product_batches/${scope.batchId}`).get()).data().quantity, 730);
  const results = await Promise.all([reconcileLegacyReceipt({ ...args, apply: true }), reconcileLegacyReceipt({ ...args, apply: true })]);
  assert.equal(results.filter(result => result.repaired).length, 1);
  assert.equal(results.filter(result => result.replayed).length, 1);
  assert.equal((await db.doc(`product_batches/${scope.batchId}`).get()).data().quantity, 530);
  assert.equal((await db.doc('pos_payments/repair-payment').get()).data().amount, 15000);
  const saved = (await db.doc(`sales/${scope.replacementId}`).get()).data();
  assert.equal(saved.items[0].quantity, 30); assert.equal(saved.items[0].baseQuantity, 300);
  assert.equal((await db.doc(`sale_revisions/${scope.repairId}`).get()).data().before.sale.items[0].quantity, 10);
  assert.equal((await db.doc(`sales/${scope.originalId}`).get()).data().totalAmount, 5000);
  console.log('PASS exact legacy correction: concurrent repair commits once, stock -200, payment 15000, immutable before-images');
  await seed();
  await db.doc('pos_payments/repair-payment').update({ amount: 6000 });
  await assert.rejects(reconcileLegacyReceipt({ ...args, apply: true }), /cash payment changed/);
  assert.equal((await db.doc(`product_batches/${scope.batchId}`).get()).data().quantity, 730);
  assert.equal((await db.doc(`sales/${scope.replacementId}`).get()).data().totalAmount, 5000);
  assert.equal((await db.doc(`sale_revisions/${scope.repairId}`).get()).exists, false);
  console.log('PASS changed canonical payment aborts recovery without stock, sale or audit writes');
  await seed();
  await db.doc(`product_batches/${scope.batchId}`).update({ quantity: 100 });
  await assert.rejects(reconcileLegacyReceipt({ ...args, apply: true }), /batch unavailable/);
  assert.equal((await db.doc('pos_payments/repair-payment').get()).data().amount, 5000);
  console.log('PASS insufficient live stock aborts recovery without payment writes');
} finally { await deleteApp(app); }
