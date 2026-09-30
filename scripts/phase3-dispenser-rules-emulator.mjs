import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';

const projectId = 'pharmhelm-phase3-rules-test';
const tenantId = 'zehqTDcKyrDAOHKK3stJ';
const branchId = '1agW2eYBOGGqKR9w2V31';
const uid = 'phase3-kalebu-fixture';
const productId = 'phase3-product';
const batchId = 'phase3-batch';
const saleId = 'phase3-sale';
const paymentId = 'phase3-payment';
const outboxEventId = 'phase3-outbox';
const attemptDocumentId = 'phase3-attempt-document';
const attemptId = 'phase3-attempt';
const receiptNumber = 'BR-3QLNF-2026-123456';
const fingerprint = 'phase3-fingerprint';

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});

try {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'staff', uid), {
        tenantId,
        role: 'Dispenser',
        secondaryRoles: ['cleaner', 'cashier'],
        assigned_branches: [branchId],
        branch_id: branchId,
        status: 'active',
        active: true
      }),
      setDoc(doc(db, 'branches', branchId), {
        tenantId,
        name: 'Masaka',
        branch_code: 'BR-3QLNF',
        status: 'Active'
      }),
      setDoc(doc(db, 'products', productId), {
        tenantId,
        name: 'Phase 3 Test Product',
        stock: 10,
        quantityInStock: 10,
        stockAggregateSource: 'product_batches'
      }),
      setDoc(doc(db, 'product_batches', batchId), {
        tenantId,
        branchId,
        productId,
        batchNumber: 'PHASE3',
        quantity: 10,
        lastUpdated: '2026-09-30T00:00:00.000Z'
      })
    ]);
  });

  const kalebu = testEnv.authenticatedContext(uid, { tenantId, email: 'k.francis@mp.pharmhelm.com' });
  const db = kalebu.firestore();

  await assertSucceeds(runTransaction(db, async transaction => {
    transaction.update(doc(db, 'product_batches', batchId), {
      quantity: 9,
      lastUpdated: '2026-09-30T12:00:00.000Z'
    });

    transaction.update(doc(db, 'products', productId), {
      stock: 9,
      quantityInStock: 9,
      stockAggregateSource: 'product_batches',
      updatedAt: serverTimestamp()
    });

    transaction.set(doc(db, 'sales', saleId), {
      tenantId,
      branchId,
      engineVersion: 2,
      status: 'completed',
      operatorUid: uid,
      receiptNumber,
      checkoutAttemptId: attemptId,
      checkoutIntentFingerprint: fingerprint,
      canonicalPaymentId: paymentId,
      transactionOutboxEventId: outboxEventId,
      totalAmount: 1000
    });

    transaction.set(doc(db, 'pos_payments', paymentId), {
      paymentId,
      tenantId,
      branchId,
      operatorUid: uid,
      source: 'POS',
      engineVersion: 2,
      currency: 'UGX',
      saleId,
      checkoutAttemptId: attemptId,
      receiptNumber,
      amount: 1000,
      settledAmount: 1000,
      outstandingAmount: 0,
      status: 'completed',
      components: [{ method: 'cash', amount: 1000 }]
    });

    transaction.set(doc(db, 'pos_transaction_outbox', outboxEventId), {
      eventId: outboxEventId,
      tenantId,
      branchId,
      source: 'POS',
      engineVersion: 2,
      payloadVersion: 1,
      eventType: 'POS_SALE_COMMITTED',
      aggregateType: 'POS_SALE',
      aggregateId: saleId,
      saleId,
      paymentId,
      receiptNumber,
      status: 'PENDING',
      attemptCount: 0,
      payload: { saleId, paymentId }
    });

    transaction.set(doc(db, 'pos_checkout_attempts', attemptDocumentId), {
      tenantId,
      branchId,
      operatorUid: uid,
      status: 'completed',
      attemptId,
      fingerprint,
      saleId,
      paymentId,
      outboxEventId
    });
  }));

  console.log('[phase3-rules] PASS: Dispenser + secondary cleaner/cashier + Masaka branch can execute all six POS V2 atomic write shapes under current firestore.rules.');
} finally {
  await testEnv.cleanup();
}
