#!/usr/bin/env node
// Read-only verifier. Public logs intentionally emit only generic PASS/FAIL status.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const EXPECTED_TENANT_ID = process.env.EXPECTED_TENANT_ID;
const EXPECTED_BRANCH_ID = process.env.EXPECTED_BRANCH_ID;
const MAX_AGE_MINUTES = Math.max(5, Number(process.env.MAX_AGE_MINUTES || 120));

if (!EXPECTED_TENANT_ID || !EXPECTED_BRANCH_ID) {
  console.error('FAIL verifier configuration');
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore(undefined, DATABASE_ID);

function millis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function fail(label) {
  console.error(`FAIL ${label}`);
  process.exitCode = 1;
}

function pass(label) {
  console.log(`PASS ${label}`);
}

const saleSnapshot = await db.collection('sales').where('branchId', '==', EXPECTED_BRANCH_ID).get();
const cutoff = Date.now() - MAX_AGE_MINUTES * 60_000;
const candidates = saleSnapshot.docs
  .map(doc => ({ id: doc.id, ...doc.data() }))
  .filter(sale => sale.tenantId === EXPECTED_TENANT_ID && Number(sale.engineVersion) === 2)
  .map(sale => ({ sale, time: Math.max(millis(sale.createdAt), millis(sale.timestamp), millis(sale.updatedAt)) }))
  .filter(row => row.time >= cutoff)
  .sort((a, b) => b.time - a.time);

if (candidates.length === 0) {
  fail('recent Masaka V2 sale found');
  process.exit(1);
}

const sale = candidates[0].sale;
pass('recent Masaka V2 sale found');

const [paymentsSnap, outboxSnap, attemptsSnap] = await Promise.all([
  db.collection('pos_payments').where('saleId', '==', sale.id).get(),
  db.collection('pos_transaction_outbox').where('saleId', '==', sale.id).get(),
  db.collection('pos_checkout_attempts').where('saleId', '==', sale.id).get()
]);

const payments = paymentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(row => row.tenantId === EXPECTED_TENANT_ID && row.branchId === EXPECTED_BRANCH_ID);
const outboxes = outboxSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(row => row.tenantId === EXPECTED_TENANT_ID && row.branchId === EXPECTED_BRANCH_ID);
const attempts = attemptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(row => row.tenantId === EXPECTED_TENANT_ID && row.branchId === EXPECTED_BRANCH_ID);

if (payments.length === 1) pass('exactly one canonical payment'); else fail('exactly one canonical payment');
if (outboxes.length === 1) pass('exactly one canonical outbox event'); else fail('exactly one canonical outbox event');
if (attempts.length === 1) pass('exactly one checkout attempt'); else fail('exactly one checkout attempt');

if (payments.length === 1 && outboxes.length === 1 && attempts.length === 1) {
  const payment = payments[0];
  const outbox = outboxes[0];
  const attempt = attempts[0];
  const linked = outbox.paymentId === payment.id
    && attempt.paymentId === payment.id
    && attempt.outboxEventId === outbox.id
    && attempt.saleId === sale.id
    && attempt.status === 'completed'
    && outbox.engineVersion === 2;
  if (linked) pass('canonical sale-payment-outbox-attempt linkage'); else fail('canonical sale-payment-outbox-attempt linkage');

  const status = String(outbox.status || '').toUpperCase();
  if (status === 'PROCESSED') pass('durable outbox fully processed');
  else if (['PENDING', 'PROCESSING', 'FAILED', 'PARTIAL'].includes(status)) console.log('INFO durable outbox not yet fully processed');
  else console.log('INFO durable outbox status nonterminal');
}

const items = Array.isArray(sale.items) ? sale.items.filter(item => !item?.isService && item?.productId) : [];
const productIds = [...new Set(items.map(item => String(item.productId)))];
let aggregatesOk = productIds.length > 0;
let batchesNonNegative = true;
for (const productId of productIds) {
  const [productSnap, batchesSnap] = await Promise.all([
    db.collection('products').doc(productId).get(),
    db.collection('product_batches').where('productId', '==', productId).get()
  ]);
  if (!productSnap.exists) {
    aggregatesOk = false;
    continue;
  }
  const product = productSnap.data();
  const tenantBatches = batchesSnap.docs.map(doc => doc.data()).filter(batch => batch.tenantId === EXPECTED_TENANT_ID);
  const batchTotal = tenantBatches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
  if (tenantBatches.some(batch => !Number.isFinite(Number(batch.quantity)) || Number(batch.quantity) < -0.0001)) batchesNonNegative = false;
  if (!Number.isFinite(Number(product.stock)) || !Number.isFinite(Number(product.quantityInStock))
      || Math.abs(Number(product.stock) - batchTotal) > 0.0001
      || Math.abs(Number(product.quantityInStock) - batchTotal) > 0.0001
      || product.stockAggregateSource !== 'product_batches') {
    aggregatesOk = false;
  }
}

if (aggregatesOk) pass('catalog aggregates healed from tenant batch authority'); else fail('catalog aggregates healed from tenant batch authority');
if (batchesNonNegative) pass('no negative batch quantity on sold products'); else fail('no negative batch quantity on sold products');

if (!process.exitCode) pass('Masaka POS V2 live canonical chain verification complete');
