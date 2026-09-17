import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const WORKER_ID = process.env.POS_OUTBOX_WORKER_ID || `github-actions-${process.env.GITHUB_RUN_ID || 'manual'}`;
const LIMIT = Number(process.env.POS_OUTBOX_LIMIT || 100);
const LEASE_SECONDS = Number(process.env.POS_OUTBOX_LEASE_SECONDS || 300);
const MAX_ATTEMPTS = Number(process.env.POS_OUTBOX_MAX_ATTEMPTS || 10);

const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID });
const db = DATABASE_ID && DATABASE_ID !== '(default)' ? getFirestore(app, DATABASE_ID) : getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const CONSUMERS = ['consumption', 'welfare', 'institutionalCredit', 'quotation'];
const TERMINAL = new Set(['COMPLETED', 'NOT_APPLICABLE']);

function nowTimestamp() {
  return Timestamp.now();
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function paymentComponent(payment, method) {
  return (payment.components || []).find(row => String(row.method || '').toLowerCase() === method);
}

function applicableConsumers(sale, payment) {
  const methods = new Set((payment.components || []).map(row => String(row.method || '').toLowerCase()));
  return {
    consumption: Array.isArray(sale.items) && sale.items.some(item => !item.isService),
    welfare: methods.has('staff_welfare') || String(sale.paymentMethod || '').toLowerCase() === 'staff_welfare',
    institutionalCredit: methods.has('institutional_credit') || String(sale.paymentMethod || '').toLowerCase() === 'institutional_credit' || String(sale.secondaryPaymentMethod || '').toLowerCase() === 'institutional_credit',
    quotation: Boolean(sale.sourceQuotationId)
  };
}

function initialConsumerState(applicable) {
  return applicable ? {
    status: 'PENDING',
    attemptCount: 0,
    lastError: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    completedAt: null,
    updatedAt: nowTimestamp()
  } : {
    status: 'NOT_APPLICABLE',
    attemptCount: 0,
    lastError: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    completedAt: nowTimestamp(),
    updatedAt: nowTimestamp()
  };
}

async function validateAuthority(eventId, event) {
  const saleRef = db.collection('sales').doc(event.saleId);
  const paymentRef = db.collection('pos_payments').doc(event.paymentId);
  const [saleSnap, paymentSnap] = await Promise.all([saleRef.get(), paymentRef.get()]);
  if (!saleSnap.exists) throw new Error(`Missing authoritative sale ${event.saleId}`);
  if (!paymentSnap.exists) throw new Error(`Missing canonical payment ${event.paymentId}`);
  const sale = saleSnap.data();
  const payment = paymentSnap.data();

  const checks = [
    [sale.engineVersion === 2, 'sale engineVersion must be 2'],
    [payment.engineVersion === 2, 'payment engineVersion must be 2'],
    [sale.tenantId === event.tenantId, 'sale tenant mismatch'],
    [payment.tenantId === event.tenantId, 'payment tenant mismatch'],
    [sale.branchId === event.branchId, 'sale branch mismatch'],
    [payment.branchId === event.branchId, 'payment branch mismatch'],
    [payment.saleId === event.saleId, 'payment saleId mismatch'],
    [sale.canonicalPaymentId === event.paymentId, 'sale canonicalPaymentId mismatch'],
    [sale.transactionOutboxEventId === eventId, 'sale outbox event mismatch'],
    [asNumber(sale.totalAmount ?? sale.total) === asNumber(payment.amount), 'sale/payment amount mismatch'],
    [String(sale.receiptNumber || '') === String(event.receiptNumber || ''), 'receipt mismatch']
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(`Authority validation failed: ${failed[1]}`);
  return { sale, payment };
}

async function ensureConsumerEnvelope(eventRef, sale, payment) {
  const applicable = applicableConsumers(sale, payment);
  await db.runTransaction(async tx => {
    const snap = await tx.get(eventRef);
    if (!snap.exists) throw new Error('Outbox event disappeared');
    const current = snap.data();
    const consumers = { ...(current.consumers || {}) };
    let changed = false;
    for (const name of CONSUMERS) {
      if (!consumers[name]) {
        consumers[name] = initialConsumerState(applicable[name]);
        changed = true;
      }
    }
    if (changed) tx.update(eventRef, { consumers, updatedAt: FieldValue.serverTimestamp() });
  });
}

async function acquireConsumerLease(eventRef, consumerName) {
  const leaseUntil = Timestamp.fromMillis(Date.now() + LEASE_SECONDS * 1000);
  return db.runTransaction(async tx => {
    const snap = await tx.get(eventRef);
    if (!snap.exists) return false;
    const data = snap.data();
    const state = data.consumers?.[consumerName];
    if (!state || TERMINAL.has(state.status)) return false;
    if (asNumber(state.attemptCount) >= MAX_ATTEMPTS) return false;
    const activeLease = state.status === 'PROCESSING' && state.leaseExpiresAt?.toMillis?.() > Date.now();
    if (activeLease) return false;
    tx.update(eventRef, {
      [`consumers.${consumerName}.status`]: 'PROCESSING',
      [`consumers.${consumerName}.attemptCount`]: FieldValue.increment(1),
      [`consumers.${consumerName}.leaseOwner`]: WORKER_ID,
      [`consumers.${consumerName}.leaseExpiresAt`]: leaseUntil,
      [`consumers.${consumerName}.lastError`]: null,
      [`consumers.${consumerName}.updatedAt`]: FieldValue.serverTimestamp(),
      status: 'PROCESSING',
      updatedAt: FieldValue.serverTimestamp()
    });
    return true;
  });
}

async function completeConsumer(eventRef, consumerName, details = {}) {
  await eventRef.update({
    [`consumers.${consumerName}.status`]: 'COMPLETED',
    [`consumers.${consumerName}.leaseOwner`]: null,
    [`consumers.${consumerName}.leaseExpiresAt`]: null,
    [`consumers.${consumerName}.lastError`]: null,
    [`consumers.${consumerName}.completedAt`]: FieldValue.serverTimestamp(),
    [`consumers.${consumerName}.updatedAt`]: FieldValue.serverTimestamp(),
    [`consumers.${consumerName}.result`]: details,
    updatedAt: FieldValue.serverTimestamp()
  });
}

async function failConsumer(eventRef, consumerName, error) {
  const message = error instanceof Error ? error.message : String(error);
  await eventRef.update({
    [`consumers.${consumerName}.status`]: 'FAILED',
    [`consumers.${consumerName}.leaseOwner`]: null,
    [`consumers.${consumerName}.leaseExpiresAt`]: null,
    [`consumers.${consumerName}.lastError`]: { message, at: nowTimestamp(), workerId: WORKER_ID },
    [`consumers.${consumerName}.updatedAt`]: FieldValue.serverTimestamp(),
    status: 'FAILED',
    lastError: { consumer: consumerName, message, at: nowTimestamp(), workerId: WORKER_ID },
    updatedAt: FieldValue.serverTimestamp()
  });
}

function saleEffectiveDate(sale) {
  const d = new Date(sale.timestamp || sale.createdAt || Date.now());
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function kampalaDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

async function processConsumption(sale) {
  const stockItems = (sale.items || []).filter(item => !item.isService);
  const byProduct = new Map();
  for (const item of stockItems) {
    const rows = byProduct.get(item.productId) || [];
    rows.push(item);
    byProduct.set(item.productId, rows);
  }
  const effectiveAt = saleEffectiveDate(sale);
  const dateKey = kampalaDateKey(effectiveAt);

  for (const [productId, items] of byProduct.entries()) {
    const eventId = `sales_${sale.id}_${productId}_${productId}`;
    const movementRef = db.collection('inventoryMovementEvents').doc(eventId);
    const summaryRef = db.collection('branchConsumptionDaily').doc(`${sale.tenantId}_${sale.branchId}_${productId}_${dateKey}`);
    const productRef = db.collection('products').doc(productId);
    const batchesQuery = db.collection('product_batches').where('tenantId', '==', sale.tenantId).where('branchId', '==', sale.branchId).where('productId', '==', productId);
    const [productSnap, batchSnap] = await Promise.all([productRef.get(), batchesQuery.get()]);
    let baseUnits = 0;
    for (const item of items) {
      const explicit = asNumber(item.baseQuantity, NaN);
      if (Number.isFinite(explicit) && explicit > 0) baseUnits += explicit;
      else if (item.tierCode && asNumber(item.tierMultiplier) > 0) baseUnits += asNumber(item.commercialQuantity ?? item.quantity) * asNumber(item.tierMultiplier);
      else {
        const product = productSnap.data() || {};
        const unit = String(product.unitOfSell || product.unit || '').toLowerCase();
        const multiplier = unit === 'pack' ? asNumber(product.unitsPerPack, 1) : unit === 'strip' ? asNumber(product.unitsPerStrip, 1) : 1;
        baseUnits += asNumber(item.quantity) * multiplier;
      }
    }

    await db.runTransaction(async tx => {
      const [movementSnap, summarySnap] = await Promise.all([tx.get(movementRef), tx.get(summaryRef)]);
      if (movementSnap.exists) return;
      let usableStock = 0;
      for (const batchDoc of batchSnap.docs) {
        const batch = batchDoc.data();
        const expiry = batch.expiryDate ? new Date(batch.expiryDate) : null;
        const unexpired = !expiry || Number.isNaN(expiry.getTime()) || expiry.getTime() >= effectiveAt.getTime();
        if (String(batch.batch_status || '').toLowerCase() === 'active' && unexpired) usableStock += asNumber(batch.quantity);
      }
      const isExceptional = Boolean(sale.isExceptionalConsumption);
      const summary = summarySnap.exists ? { ...summarySnap.data() } : {
        tenantId: sale.tenantId,
        branchId: sale.branchId,
        productId,
        dateKey,
        baseUnitId: productId,
        baseUnitName: productSnap.data()?.baseUnit || productSnap.data()?.unit || 'unit',
        openingUsableStock: usableStock + baseUnits,
        closingUsableStock: usableStock,
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
        transactionCount: 0,
        consumptionTransactionCount: 0,
        operatingMinutes: null,
        inStockMinutes: null,
        stockoutMinutes: null,
        wasStockedAllDay: usableStock > 0,
        firstStockoutAt: usableStock === 0 ? Timestamp.fromDate(effectiveAt) : null,
        lastRestockedAt: null,
        createdAt: FieldValue.serverTimestamp(),
        aggregationVersion: 0
      };
      summary.closingUsableStock = usableStock;
      summary.transactionCount = asNumber(summary.transactionCount) + 1;
      summary.aggregationVersion = asNumber(summary.aggregationVersion) + 1;
      if (isExceptional) summary.exceptionalUnits = asNumber(summary.exceptionalUnits) + baseUnits;
      else {
        summary.ordinaryUnitsSold = asNumber(summary.ordinaryUnitsSold) + baseUnits;
        summary.validConsumptionUnits = asNumber(summary.validConsumptionUnits) + baseUnits;
        summary.consumptionTransactionCount = asNumber(summary.consumptionTransactionCount) + 1;
      }
      summary.updatedAt = FieldValue.serverTimestamp();
      tx.set(movementRef, {
        tenantId: sale.tenantId,
        branchId: sale.branchId,
        productId,
        eventId,
        eventType: 'SALE',
        quantityDeltaBaseUnits: -baseUnits,
        consumptionDeltaBaseUnits: baseUnits,
        isExceptional,
        exceptionalReason: isExceptional ? (sale.exceptionalConsumptionReason || 'Exceptional sale') : null,
        sourceCollection: 'sales',
        sourceDocumentId: sale.id,
        sourceLineId: productId,
        reversalOfEventId: null,
        effectiveAt: Timestamp.fromDate(effectiveAt),
        dateKey,
        createdBy: 'pos-v2-outbox-worker',
        createdAt: FieldValue.serverTimestamp()
      });
      tx.set(summaryRef, summary, { merge: true });
    });
  }
  return { productsProcessed: byProduct.size };
}

async function processWelfare(sale, payment) {
  const component = paymentComponent(payment, 'staff_welfare');
  const amount = asNumber(component?.amount ?? sale.welfareAmount);
  if (amount <= 0) throw new Error('Applicable welfare posting has no positive welfare amount');
  const beneficiaryId = sale.patientId;
  if (!beneficiaryId) throw new Error('Welfare sale has no beneficiary patient/staff id');

  const welfareRef = db.collection('welfare').doc(`pos_welfare_${sale.id}`);
  const expenseRef = db.collection('branch_expenses').doc(`pos_welfare_expense_${sale.id}`);
  const transferRef = db.collection('cashTransfers').doc(`pos_welfare_transfer_${sale.id}`);
  const staffRef = db.collection('staff').doc(beneficiaryId);
  const clientRef = db.collection('clients').doc(beneficiaryId);

  await db.runTransaction(async tx => {
    const [welfareSnap, staffSnap, clientSnap] = await Promise.all([tx.get(welfareRef), tx.get(staffRef), tx.get(clientRef)]);
    if (welfareSnap.exists) return;
    const beneficiarySnap = staffSnap.exists ? staffSnap : clientSnap;
    if (!beneficiarySnap.exists) throw new Error(`Welfare beneficiary ${beneficiaryId} not found`);
    const beneficiaryRef = staffSnap.exists ? staffRef : clientRef;
    const data = beneficiarySnap.data();
    const used = asNumber(data.welfare_used_ytd ?? data.welfare_spent);
    tx.update(beneficiaryRef, { welfare_used_ytd: used + amount, welfare_spent: used + amount, updatedAt: FieldValue.serverTimestamp() });
    tx.set(welfareRef, { tenantId: sale.tenantId, branchId: sale.branchId, saleId: sale.id, receiptNumber: sale.receiptNumber, beneficiaryId, amount, source: 'POS_V2', status: 'posted', createdAt: FieldValue.serverTimestamp() });
    tx.set(expenseRef, { tenantId: sale.tenantId, branch_id: sale.branchId, expense_date: String(sale.timestamp || '').slice(0, 10), category: 'Staff Welfare', description: `POS welfare ${sale.receiptNumber || sale.id}`, amount_ugx: amount, payment_method: 'Staff Welfare', logged_by: 'pos-v2-outbox-worker', status: 'Approved', source: 'POS_V2', sourceRef: sale.id, created_at: sale.timestamp || new Date().toISOString() });
    tx.set(transferRef, { tenantId: sale.tenantId, branchId: sale.branchId, saleId: sale.id, fromPortfolio: 'staff_welfare', toPortfolio: 'pos_sale', amount, processedBy: 'pos-v2-outbox-worker', processedAt: FieldValue.serverTimestamp(), notes: `POS V2 welfare posting ${sale.receiptNumber || sale.id}` });
  });
  return { welfareId: welfareRef.id, amount };
}

async function processInstitutionalCredit(sale, payment) {
  const component = paymentComponent(payment, 'institutional_credit');
  const amount = asNumber(component?.outstandingAmount ?? component?.amount ?? payment.outstandingAmount);
  if (amount <= 0) throw new Error('Applicable institutional credit posting has no positive outstanding amount');
  const ref = db.collection('credit_receivables').doc(sale.id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const existing = snap.data();
      const compatible = existing.tenantId === sale.tenantId && String(existing.receipt_id || '') === String(sale.id) && asNumber(existing.amount_ugx) === amount;
      if (!compatible) throw new Error(`Existing receivable ${sale.id} conflicts with authoritative POS V2 sale`);
      return;
    }
    tx.set(ref, {
      tenantId: sale.tenantId,
      branch_id: sale.branchId,
      receipt_id: sale.id,
      payment_id: payment.paymentId || payment.id || null,
      client_id: sale.institutionId || sale.patientId || '',
      client_name: sale.institutionName || sale.patientName || 'Institutional client',
      amount_ugx: amount,
      outstanding_ugx: amount,
      status: 'outstanding',
      due_date: sale.timestamp || new Date().toISOString(),
      invoice_number: sale.receiptNumber || sale.id,
      source: 'POS_V2',
      engineVersion: 2,
      created_at: sale.timestamp || new Date().toISOString(),
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return { receivableId: sale.id, amount };
}

async function processQuotation(sale) {
  const quotationId = sale.sourceQuotationId;
  if (!quotationId) return { skipped: true };
  const ref = db.collection('quotations').doc(quotationId);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`Quotation ${quotationId} not found`);
    const q = snap.data();
    if (q.convertedSaleId && q.convertedSaleId !== sale.id) throw new Error(`Quotation ${quotationId} is already linked to another sale`);
    tx.update(ref, {
      status: 'converted',
      convertedSaleId: sale.id,
      convertedReceiptNumber: sale.receiptNumber || null,
      convertedValue: asNumber(sale.totalAmount ?? sale.total),
      convertedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  return { quotationId };
}

const processors = {
  consumption: (sale, payment) => processConsumption(sale, payment),
  welfare: (sale, payment) => processWelfare(sale, payment),
  institutionalCredit: (sale, payment) => processInstitutionalCredit(sale, payment),
  quotation: (sale, payment) => processQuotation(sale, payment)
};

async function finalizeEvent(eventRef) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(eventRef);
    if (!snap.exists) return;
    const event = snap.data();
    const states = CONSUMERS.map(name => event.consumers?.[name]?.status || 'PENDING');
    const allDone = states.every(status => TERMINAL.has(status));
    const anyFailed = states.includes('FAILED');
    const anyProcessing = states.includes('PROCESSING');
    tx.update(eventRef, {
      status: allDone ? 'PROCESSED' : anyFailed ? 'FAILED' : anyProcessing ? 'PROCESSING' : 'PENDING',
      processedAt: allDone ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function processEvent(docSnap) {
  const eventRef = docSnap.ref;
  const eventId = docSnap.id;
  let authoritative;
  try {
    authoritative = await validateAuthority(eventId, docSnap.data());
  } catch (error) {
    await eventRef.update({ status: 'FAILED', lastError: { consumer: 'authority', message: error.message, at: nowTimestamp(), workerId: WORKER_ID }, updatedAt: FieldValue.serverTimestamp() });
    return { eventId, status: 'FAILED_AUTHORITY' };
  }
  const sale = { id: eventId ? docSnap.data().saleId : '', ...authoritative.sale };
  const payment = { id: docSnap.data().paymentId, ...authoritative.payment };
  await ensureConsumerEnvelope(eventRef, sale, payment);

  for (const name of CONSUMERS) {
    const fresh = await eventRef.get();
    const state = fresh.data()?.consumers?.[name];
    if (!state || TERMINAL.has(state.status)) continue;
    const acquired = await acquireConsumerLease(eventRef, name);
    if (!acquired) continue;
    try {
      const result = await processors[name](sale, payment);
      await completeConsumer(eventRef, name, result || {});
    } catch (error) {
      await failConsumer(eventRef, name, error);
    }
  }
  await finalizeEvent(eventRef);
  const finalSnap = await eventRef.get();
  return { eventId, status: finalSnap.data()?.status || 'UNKNOWN' };
}

async function main() {
  console.log(`[pos-v2-outbox] worker=${WORKER_ID} project=${PROJECT_ID} database=${DATABASE_ID}`);
  const snapshot = await db.collection('pos_transaction_outbox')
    .where('eventType', '==', 'POS_SALE_COMMITTED')
    .limit(LIMIT)
    .get();

  const candidates = snapshot.docs.filter(doc => {
    const status = String(doc.data().status || 'PENDING');
    if (status === 'PROCESSED') return false;
    return true;
  });

  const results = [];
  for (const docSnap of candidates) results.push(await processEvent(docSnap));
  console.log(JSON.stringify({ scanned: snapshot.size, candidates: candidates.length, results }, null, 2));
}

main().catch(error => {
  console.error('[pos-v2-outbox] fatal', error);
  process.exitCode = 1;
});
