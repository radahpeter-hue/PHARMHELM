#!/usr/bin/env node
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  BATCH4_CONSUMERS,
  DEFAULT_LEASE_SECONDS,
  MAX_CONSUMER_ATTEMPTS,
  consumptionSummaryId,
  dateKeyForTimezone,
  deriveGlobalStatus,
  groupedSaleProducts,
  initializeConsumers,
  movementEventId,
  numberValue,
  paymentComponentAmount,
  snapshotBaseQuantityForItem,
  structuredError,
  validateEnvelope,
  welfarePostingIds
} from './pos-v2-batch4-core.mjs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const WORKER_ID = process.env.POS_V2_WORKER_ID || `github-actions-${process.env.GITHUB_RUN_ID || Date.now()}`;
const LEASE_SECONDS = Math.max(60, Number(process.env.POS_V2_LEASE_SECONDS || DEFAULT_LEASE_SECONDS));
const MAX_EVENTS = Math.max(1, Math.min(100, Number(process.env.POS_V2_MAX_EVENTS || 25)));
const MODE = process.argv.includes('--reconcile') ? 'reconcile' : 'process';

function initializeAdmin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    return initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
  }
  return initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}

const app = initializeAdmin();
const db = getFirestore(app, DATABASE_ID);
const nowIso = () => new Date().toISOString();

function isLeaseExpired(value) {
  if (!value) return true;
  const millis = typeof value?.toMillis === 'function' ? value.toMillis() : new Date(value).getTime();
  return !Number.isFinite(millis) || millis <= Date.now();
}

function consumerCanRun(state) {
  if (!state) return true;
  if (state.status === 'COMPLETED' || state.status === 'NOT_APPLICABLE') return false;
  if (state.status === 'PROCESSING' && !isLeaseExpired(state.leaseExpiresAt)) return false;
  return Number(state.attemptCount || 0) < MAX_CONSUMER_ATTEMPTS;
}

async function loadCanonical(event) {
  const [saleSnap, paymentSnap] = await Promise.all([
    db.collection('sales').doc(event.saleId).get(),
    db.collection('pos_payments').doc(event.paymentId).get()
  ]);
  const sale = saleSnap.exists ? { id: saleSnap.id, ...saleSnap.data() } : null;
  const payment = paymentSnap.exists ? { id: paymentSnap.id, ...paymentSnap.data() } : null;
  validateEnvelope({ event, sale, payment });
  return { sale, payment };
}

async function claimEvent(ref) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const event = { id: snap.id, ...snap.data() };
    if (event.eventType !== 'POS_SALE_COMMITTED' || event.engineVersion !== 2) return null;
    if (event.status === 'PROCESSED') return null;
    if (event.status === 'PROCESSING' && !isLeaseExpired(event.leaseExpiresAt)) return null;

    const leaseExpiresAt = Timestamp.fromMillis(Date.now() + LEASE_SECONDS * 1000);
    tx.update(ref, {
      status: 'PROCESSING',
      leaseOwner: WORKER_ID,
      leaseExpiresAt,
      lastAttemptAt: FieldValue.serverTimestamp(),
      attemptCount: Number(event.attemptCount || 0) + 1,
      updatedAt: FieldValue.serverTimestamp()
    });
    return { ...event, attemptCount: Number(event.attemptCount || 0) + 1 };
  });
}

async function ensureConsumers(ref, sale, payment) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Outbox event disappeared while initializing consumers.');
    const event = snap.data();
    if (event.leaseOwner !== WORKER_ID) throw new Error('Outbox lease was lost before consumer initialization.');
    const consumers = initializeConsumers({
      sale,
      payment,
      existingConsumers: event.consumers || {},
      nowIso: nowIso()
    });
    const status = deriveGlobalStatus(consumers);
    tx.update(ref, { consumers, status, updatedAt: FieldValue.serverTimestamp() });
    return consumers;
  });
}

async function markConsumerProcessing(ref, name) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const event = snap.data();
    if (event.leaseOwner !== WORKER_ID || isLeaseExpired(event.leaseExpiresAt)) return false;
    const state = event.consumers?.[name];
    if (!consumerCanRun(state)) return false;
    const attemptCount = Number(state?.attemptCount || 0) + 1;
    tx.update(ref, {
      [`consumers.${name}.status`]: 'PROCESSING',
      [`consumers.${name}.attemptCount`]: attemptCount,
      [`consumers.${name}.leaseOwner`]: WORKER_ID,
      [`consumers.${name}.leaseExpiresAt`]: event.leaseExpiresAt,
      [`consumers.${name}.lastAttemptAt`]: FieldValue.serverTimestamp(),
      [`consumers.${name}.updatedAt`]: FieldValue.serverTimestamp(),
      [`consumers.${name}.lastError`]: null,
      status: 'PROCESSING',
      updatedAt: FieldValue.serverTimestamp()
    });
    return true;
  });
}

async function markConsumerResult(ref, name, error = null) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const event = snap.data();
    const previous = event.consumers?.[name] || {};
    const failed = Boolean(error);
    const terminal = failed && Number(previous.attemptCount || 0) >= MAX_CONSUMER_ATTEMPTS;
    const nextState = {
      ...previous,
      status: failed ? 'FAILED' : 'COMPLETED',
      lastError: failed ? structuredError(error) : null,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: failed ? null : nowIso(),
      updatedAt: nowIso(),
      requiresManualReview: terminal
    };
    const consumers = { ...(event.consumers || {}), [name]: nextState };
    const status = deriveGlobalStatus(consumers);
    const requiresManualReview = Object.values(consumers).some(state => Boolean(state?.requiresManualReview));
    tx.update(ref, {
      [`consumers.${name}`]: nextState,
      status,
      requiresManualReview,
      manualReviewAt: requiresManualReview ? (event.manualReviewAt || FieldValue.serverTimestamp()) : null,
      lastError: failed ? structuredError(error).message : null,
      processedAt: status === 'PROCESSED' ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function releaseEvent(ref) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const event = snap.data();
    if (event.leaseOwner !== WORKER_ID) return;
    const status = deriveGlobalStatus(event.consumers || {});
    tx.update(ref, {
      status,
      leaseOwner: null,
      leaseExpiresAt: null,
      processedAt: status === 'PROCESSED' ? FieldValue.serverTimestamp() : event.processedAt || null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

function isBatchUnexpired(expiryDate, now = new Date()) {
  if (!expiryDate) return true;
  const raw = String(expiryDate).trim();
  if (!raw) return true;
  let expiry;
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split('-').map(Number);
    expiry = new Date(year, month, 0, 23, 59, 59, 999);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    expiry = new Date(year, month - 1, day, 23, 59, 59, 999);
  } else {
    expiry = new Date(raw);
    if (Number.isNaN(expiry.getTime())) return false;
  }
  return expiry.getTime() >= now.getTime();
}

function productMultiplier(product) {
  const unit = String(product?.unitOfSell || product?.unit || '').toLowerCase();
  if (unit === 'pack') return Number(product?.unitsPerPack || 1);
  if (unit === 'strip') return Number(product?.unitsPerStrip || 1);
  return 1;
}

async function postConsumption(sale) {
  const groups = groupedSaleProducts(sale);
  for (const [productId, items] of groups) {
    const batchSnapshot = await db.collection('product_batches').where('productId', '==', productId).get();
    const batchRefs = batchSnapshot.docs
      .filter(snap => snap.data().tenantId === sale.tenantId && snap.data().branchId === sale.branchId)
      .map(snap => snap.ref);

    await db.runTransaction(async tx => {
      const eventId = movementEventId({ saleId: sale.id, productId });
      const eventRef = db.collection('inventoryMovementEvents').doc(eventId);
      const eventSnap = await tx.get(eventRef);
      if (eventSnap.exists) return;

      const productRef = db.collection('products').doc(productId);
      const productSnap = await tx.get(productRef);
      const product = productSnap.exists ? productSnap.data() : null;

      let baseUnits = 0;
      for (const item of items) {
        const snapshotted = snapshotBaseQuantityForItem(item);
        if (snapshotted !== null) baseUnits += snapshotted;
        else baseUnits += Number(item.quantity || 0) * productMultiplier(product);
      }
      if (!(baseUnits >= 0) || !Number.isFinite(baseUnits)) throw new Error(`Invalid base-unit consumption for ${productId}.`);

      let currentUsableStock = 0;
      for (const batchRef of batchRefs) {
        const batchSnap = await tx.get(batchRef);
        if (!batchSnap.exists) continue;
        const batch = batchSnap.data();
        if (batch.batch_status === 'active' && isBatchUnexpired(batch.expiryDate)) currentUsableStock += Number(batch.quantity || 0);
      }

      const effectiveAt = new Date(sale.timestamp || sale.createdAt?.toDate?.() || Date.now());
      const dateKey = dateKeyForTimezone(effectiveAt);
      const summaryId = consumptionSummaryId(sale.tenantId, sale.branchId, productId, dateKey);
      const summaryRef = db.collection('branchConsumptionDaily').doc(summaryId);
      const summarySnap = await tx.get(summaryRef);
      const closingUsableStock = currentUsableStock;
      const openingUsableStock = currentUsableStock + baseUnits;
      const exceptional = Boolean(sale.isExceptionalConsumption);

      let summary;
      if (summarySnap.exists) {
        summary = { ...summarySnap.data() };
        summary.closingUsableStock = closingUsableStock;
        summary.aggregationVersion = Number(summary.aggregationVersion || 0) + 1;
        summary.transactionCount = Number(summary.transactionCount || 0) + 1;
      } else {
        summary = {
          tenantId: sale.tenantId,
          branchId: sale.branchId,
          productId,
          dateKey,
          baseUnitId: productId,
          baseUnitName: product?.baseUnit || product?.unit || 'unit',
          openingUsableStock,
          closingUsableStock,
          ordinaryUnitsSold: 0,
          ordinaryUnitsDispensed: 0,
          unitsReturnedToStock: 0,
          unitsTransferredIn: 0,
          unitsTransferredOut: 0,
          unitsWrittenOff: 0,
          positiveAdjustments: 0,
          negativeAdjustments: 0,
          exceptionalUnits: 0,
          validConsumptionUnits: 0,
          transactionCount: 1,
          consumptionTransactionCount: 0,
          operatingMinutes: null,
          inStockMinutes: null,
          stockoutMinutes: null,
          wasStockedAllDay: currentUsableStock > 0,
          firstStockoutAt: currentUsableStock === 0 ? Timestamp.fromDate(effectiveAt) : null,
          lastRestockedAt: null,
          createdAt: FieldValue.serverTimestamp(),
          aggregationVersion: 1
        };
      }

      if (exceptional) summary.exceptionalUnits = Number(summary.exceptionalUnits || 0) + baseUnits;
      else {
        summary.ordinaryUnitsSold = Number(summary.ordinaryUnitsSold || 0) + baseUnits;
        summary.validConsumptionUnits = Number(summary.validConsumptionUnits || 0) + baseUnits;
        summary.consumptionTransactionCount = Number(summary.consumptionTransactionCount || 0) + 1;
      }
      summary.updatedAt = FieldValue.serverTimestamp();

      tx.set(eventRef, {
        tenantId: sale.tenantId,
        branchId: sale.branchId,
        productId,
        eventId,
        eventType: 'SALE',
        quantityDeltaBaseUnits: -baseUnits,
        consumptionDeltaBaseUnits: baseUnits,
        isExceptional: exceptional,
        exceptionalReason: exceptional ? (sale.exceptionalConsumptionReason || 'Exceptional sale') : null,
        sourceCollection: 'sales',
        sourceDocumentId: sale.id,
        sourceLineId: productId,
        reversalOfEventId: null,
        effectiveAt: Timestamp.fromDate(effectiveAt),
        dateKey,
        createdBy: 'pos-v2-batch4-worker',
        createdAt: FieldValue.serverTimestamp()
      });
      tx.set(summaryRef, summary);
    });
  }
}

async function postWelfare(sale, payment) {
  const desiredAmount = paymentComponentAmount(payment, 'staff_welfare');
  if (desiredAmount <= 0) return;
  const ids = welfarePostingIds(sale.tenantId, sale.id);
  const saleRef = db.collection('sales').doc(sale.id);
  const welfareRef = db.collection('welfare').doc(ids.welfareId);
  const expenseRef = db.collection('branch_expenses').doc(ids.expenseId);
  const transferRef = db.collection('cashTransfers').doc(ids.transferId);

  await db.runTransaction(async tx => {
    const [saleSnap, welfareSnap] = await Promise.all([tx.get(saleRef), tx.get(welfareRef)]);
    if (!saleSnap.exists) throw new Error('The completed sale could not be found for welfare posting.');
    const liveSale = saleSnap.data();
    if (liveSale.tenantId !== sale.tenantId) throw new Error('Sale tenant mismatch during welfare posting.');
    const previous = welfareSnap.exists ? welfareSnap.data() : null;
    if (previous && previous.tenantId !== sale.tenantId) throw new Error('Welfare posting ID collision across tenants.');

    const beneficiaryId = String(liveSale.patientId || '').trim();
    const isStaff = Boolean(liveSale.welfareBeneficiaryIsStaff);
    if (!beneficiaryId) throw new Error('Staff welfare payment has no linked beneficiary.');
    const beneficiaryRef = db.collection(isStaff ? 'staff' : 'clients').doc(beneficiaryId);
    const beneficiarySnap = await tx.get(beneficiaryRef);
    if (!beneficiarySnap.exists) throw new Error('Welfare beneficiary no longer exists.');
    const beneficiary = beneficiarySnap.data();
    if (beneficiary.tenantId !== sale.tenantId) throw new Error('Welfare beneficiary tenant mismatch.');

    const previousAmount = Math.max(0, numberValue(previous?.amount));
    const previousBeneficiaryId = String(previous?.staffId || '').trim();
    const previousIsStaff = Boolean(previous?.isStaff);
    if (previousAmount > 0 && (previousBeneficiaryId !== beneficiaryId || previousIsStaff !== isStaff)) {
      throw new Error('Existing welfare posting conflicts with the canonical POS beneficiary. Manual review required.');
    }
    const delta = desiredAmount - previousAmount;
    const nextSpent = numberValue(beneficiary.welfare_spent) + delta;
    const nextYtd = numberValue(beneficiary.welfare_used_ytd) + delta;
    if (nextSpent < 0 || nextYtd < 0) throw new Error('Welfare posting would create a negative welfare balance.');
    if (delta !== 0) tx.update(beneficiaryRef, { welfare_spent: nextSpent, welfare_used_ytd: nextYtd, updatedAt: FieldValue.serverTimestamp() });

    const date = new Date().toISOString();
    tx.set(welfareRef, {
      tenantId: sale.tenantId,
      saleId: sale.id,
      staffId: beneficiaryId,
      isStaff,
      type: 'medical',
      amount: desiredAmount,
      date,
      status: 'approved',
      branchId: sale.branchId,
      receiptNumber: sale.receiptNumber || null,
      notes: `POS Purchase: ${sale.receiptNumber || sale.id}`,
      processedBy: WORKER_ID,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: previous?.createdAt || FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(expenseRef, {
      tenantId: sale.tenantId,
      saleId: sale.id,
      branchId: sale.branchId,
      branch_id: sale.branchId,
      category: 'Staff Welfare',
      amount: desiredAmount,
      date,
      expense_date: date.slice(0, 10),
      description: `Staff Welfare Benefit - Receipt ${sale.receiptNumber || sale.id}`,
      payment_method: 'System Adjustment',
      status: 'approved',
      logged_by: 'POS V2 durable worker',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(transferRef, {
      tenantId: sale.tenantId,
      saleId: sale.id,
      fromPortfolio: 'welfare',
      toPortfolio: 'banked',
      amount: desiredAmount,
      status: 'posted',
      processedBy: 'POS V2 durable worker',
      notes: `POS Purchase Staff Welfare: ${sale.receiptNumber || sale.id}`,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.update(saleRef, {
      welfarePostingStatus: 'posted',
      welfarePostingId: ids.welfareId,
      welfarePostingAmount: desiredAmount,
      welfarePostingUpdatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function postInstitutionalCredit(sale, payment) {
  const amount = paymentComponentAmount(payment, 'institutional_credit');
  if (amount <= 0) return;
  const ref = db.collection('credit_receivables').doc(sale.id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const existing = snap.data();
      if (existing.tenantId !== sale.tenantId || String(existing.receipt_id || sale.id) !== sale.id) {
        throw new Error('Institutional credit receivable ID collision. Manual review required.');
      }
      const original = numberValue(existing.amount_ugx);
      if (original > 0 && Math.abs(original - amount) > 0.0001) {
        throw new Error('Existing institutional credit amount conflicts with canonical POS payment. Manual review required.');
      }
      tx.set(ref, {
        paymentId: payment.paymentId,
        source: 'POS',
        engineVersion: 2,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return;
    }
    const created = sale.timestamp || nowIso();
    tx.create(ref, {
      tenantId: sale.tenantId,
      receipt_id: sale.id,
      client_id: sale.institutionId || sale.patientId || '',
      client_name: sale.institutionName || sale.patientName || 'Institutional client',
      amount_ugx: amount,
      outstanding_ugx: amount,
      status: 'outstanding',
      branch_id: sale.branchId || 'HQ',
      due_date: created,
      invoice_number: sale.receiptNumber || 'N/A',
      created_at: created,
      paymentId: payment.paymentId,
      source: 'POS',
      engineVersion: 2,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function postQuotation(sale) {
  const quotationId = String(sale.sourceQuotationId || '').trim();
  if (!quotationId) return;
  const quotationRef = db.collection('pos_quotations').doc(quotationId);
  const saleRef = db.collection('sales').doc(sale.id);
  await db.runTransaction(async tx => {
    const [quotationSnap, saleSnap] = await Promise.all([tx.get(quotationRef), tx.get(saleRef)]);
    if (!quotationSnap.exists) throw new Error('The source quotation no longer exists.');
    if (!saleSnap.exists) throw new Error('The completed sale no longer exists.');
    const quotation = quotationSnap.data();
    const liveSale = saleSnap.data();
    if (quotation.tenantId !== sale.tenantId || liveSale.tenantId !== sale.tenantId) throw new Error('Quotation or sale tenant mismatch.');
    if (quotation.status === 'Converted' && quotation.convertedReceiptId && quotation.convertedReceiptId !== sale.id) {
      throw new Error('This quotation has already been converted to another sale.');
    }
    const convertedAt = quotation.convertedAt || nowIso();
    const convertedValue = numberValue(sale.totalAmount ?? sale.total);
    tx.update(quotationRef, {
      status: 'Converted',
      convertedReceiptId: sale.id,
      convertedAt,
      convertedValue,
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.update(saleRef, {
      sourceQuotationId: quotationId,
      quotationConversionStatus: 'converted',
      quotationConvertedAt: convertedAt,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

const processors = {
  consumption: ({ sale }) => postConsumption(sale),
  welfare: ({ sale, payment }) => postWelfare(sale, payment),
  institutionalCredit: ({ sale, payment }) => postInstitutionalCredit(sale, payment),
  quotation: ({ sale }) => postQuotation(sale)
};

async function processEvent(ref) {
  const claimed = await claimEvent(ref);
  if (!claimed) return { skipped: true };
  let canonical;
  try {
    canonical = await loadCanonical(claimed);
    await ensureConsumers(ref, canonical.sale, canonical.payment);
  } catch (error) {
    const terminal = Number(claimed.attemptCount || 0) >= MAX_CONSUMER_ATTEMPTS;
    await db.collection('pos_transaction_outbox').doc(ref.id).set({
      status: 'FAILED',
      lastError: structuredError(error).message,
      requiresManualReview: terminal,
      manualReviewAt: terminal ? FieldValue.serverTimestamp() : null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { failed: true, error };
  }

  for (const name of BATCH4_CONSUMERS) {
    const canRun = await markConsumerProcessing(ref, name);
    if (!canRun) continue;
    try {
      await processors[name](canonical);
      await markConsumerResult(ref, name, null);
    } catch (error) {
      console.error(`[Batch4] ${ref.id} consumer ${name} failed:`, error);
      await markConsumerResult(ref, name, error);
    }
  }
  await releaseEvent(ref);
  return { processed: true };
}

async function candidateRefs() {
  const snapshot = await db.collection('pos_transaction_outbox')
    .where('status', 'in', ['PENDING', 'FAILED', 'PROCESSING'])
    .limit(MAX_EVENTS * 3)
    .get();
  return snapshot.docs
    .filter(doc => {
      const data = doc.data();
      if (data.eventType !== 'POS_SALE_COMMITTED' || data.engineVersion !== 2) return false;
      if (data.requiresManualReview === true) return false;
      if (data.status === 'PROCESSING' && !isLeaseExpired(data.leaseExpiresAt)) return false;
      return true;
    })
    .slice(0, MAX_EVENTS)
    .map(doc => doc.ref);
}

async function reconciliationReport() {
  const snapshot = await db.collection('pos_transaction_outbox')
    .where('eventType', '==', 'POS_SALE_COMMITTED')
    .get();
  const report = {
    checked: 0,
    healthy: 0,
    requiresProcessing: 0,
    inconsistent: 0,
    pending: 0,
    processing: 0,
    failed: 0,
    manualReview: 0,
    expiredLeases: 0,
    consumers: Object.fromEntries(BATCH4_CONSUMERS.map(name => [name, {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      notApplicable: 0,
      manualReview: 0
    }])),
    problemEvents: []
  };
  for (const snap of snapshot.docs) {
    const event = { id: snap.id, ...snap.data() };
    if (event.engineVersion !== 2) continue;
    report.checked += 1;
    const globalStatus = String(event.status || 'PENDING').toUpperCase();
    if (globalStatus === 'PENDING') report.pending += 1;
    else if (globalStatus === 'PROCESSING') report.processing += 1;
    else if (globalStatus === 'FAILED') report.failed += 1;
    if (event.requiresManualReview === true) report.manualReview += 1;
    if (globalStatus === 'PROCESSING' && isLeaseExpired(event.leaseExpiresAt)) report.expiredLeases += 1;
    for (const name of BATCH4_CONSUMERS) {
      const state = event.consumers?.[name];
      const status = String(state?.status || 'PENDING').toUpperCase();
      const bucket = status === 'NOT_APPLICABLE' ? 'notApplicable' : status.toLowerCase();
      if (bucket in report.consumers[name]) report.consumers[name][bucket] += 1;
      if (state?.requiresManualReview === true) report.consumers[name].manualReview += 1;
    }
    try {
      const { sale, payment } = await loadCanonical(event);
      const expected = initializeConsumers({ sale, payment, existingConsumers: event.consumers || {}, nowIso: nowIso() });
      const status = deriveGlobalStatus(expected);
      if (status === 'PROCESSED') report.healthy += 1;
      else report.requiresProcessing += 1;
      if (
        (status !== 'PROCESSED' || event.requiresManualReview === true)
        && report.problemEvents.length < 25
      ) {
        report.problemEvents.push({
          eventId: event.id,
          status: globalStatus,
          derivedStatus: status,
          requiresManualReview: event.requiresManualReview === true,
          error: event.lastError || null
        });
      }
    } catch (error) {
      report.inconsistent += 1;
      if (report.problemEvents.length < 25) {
        report.problemEvents.push({
          eventId: event.id,
          status: globalStatus,
          requiresManualReview: event.requiresManualReview === true,
          error: structuredError(error).message
        });
      }
      console.error(`[Batch4 reconcile] ${event.id}:`, error);
    }
  }
  console.log(JSON.stringify({ mode: 'reconcile', ...report }, null, 2));
  if (
    report.inconsistent > 0
    || report.requiresProcessing > 0
    || report.manualReview > 0
    || report.expiredLeases > 0
  ) process.exitCode = 2;
}

async function main() {
  if (MODE === 'reconcile') return reconciliationReport();
  const refs = await candidateRefs();
  const summary = { candidates: refs.length, processed: 0, skipped: 0, failed: 0 };
  for (const ref of refs) {
    const result = await processEvent(ref);
    if (result.processed) summary.processed += 1;
    else if (result.failed) summary.failed += 1;
    else summary.skipped += 1;
  }
  console.log(JSON.stringify({ mode: 'process', workerId: WORKER_ID, ...summary }, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error('[Batch4 fatal]', error);
  process.exitCode = 1;
});
