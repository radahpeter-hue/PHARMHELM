import {
  assertExistingWelfareReversalMatches,
  buildWelfareReversal,
  validateWelfareOriginals
} from './pos-v2-revision-welfare-core.mjs';

function clean(value) {
  return String(value ?? '').trim();
}

function stablePart(value, max = 180) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, max);
}

function originalPostingIds(tenantId, saleId) {
  const key = stablePart(`${tenantId}_${saleId}`);
  return {
    welfareId: `pos_welfare_${key}`,
    expenseId: `pos_welfare_expense_${key}`,
    transferId: `pos_welfare_transfer_${key}`
  };
}

export async function executeWelfareReversal({
  db,
  sale,
  payment,
  revisionId,
  requestedBy,
  requestedByName,
  reason,
  FieldValue
}) {
  if (!db || typeof db.runTransaction !== 'function') {
    throw new Error('Welfare reversal requires a Firestore database.');
  }
  if (!FieldValue || typeof FieldValue.serverTimestamp !== 'function') {
    throw new Error('Welfare reversal requires server timestamps.');
  }

  const expected = buildWelfareReversal({
    sale,
    payment,
    revisionId,
    requestedBy,
    requestedByName,
    reason
  });
  const originals = originalPostingIds(expected.tenantId, expected.originalSaleId);

  const reversalRef = db.collection('pos_welfare_reversals').doc(expected.reversalId);
  const originalWelfareRef = db.collection('welfare').doc(originals.welfareId);
  const originalExpenseRef = db.collection('branch_expenses').doc(originals.expenseId);
  const originalTransferRef = db.collection('cashTransfers').doc(originals.transferId);
  const reversalWelfareRef = db.collection('welfare').doc(expected.welfareId);
  const reversalExpenseRef = db.collection('branch_expenses').doc(expected.expenseId);
  const reversalTransferRef = db.collection('cashTransfers').doc(expected.transferId);

  return db.runTransaction(async tx => {
    const [
      existingReversalSnap,
      originalWelfareSnap,
      originalExpenseSnap,
      originalTransferSnap,
      reversalWelfareSnap,
      reversalExpenseSnap,
      reversalTransferSnap
    ] = await Promise.all([
      tx.get(reversalRef),
      tx.get(originalWelfareRef),
      tx.get(originalExpenseRef),
      tx.get(originalTransferRef),
      tx.get(reversalWelfareRef),
      tx.get(reversalExpenseRef),
      tx.get(reversalTransferRef)
    ]);

    if (existingReversalSnap.exists) {
      const existing = existingReversalSnap.data();
      assertExistingWelfareReversalMatches({ existing, expected });
      if (!reversalWelfareSnap.exists || !reversalExpenseSnap.exists || !reversalTransferSnap.exists) {
        throw new Error('Welfare reversal history is partial. Manual review required.');
      }
      return {
        replayed: true,
        reversalId: expected.reversalId,
        welfareId: expected.welfareId,
        expenseId: expected.expenseId,
        transferId: expected.transferId,
        amountDelta: expected.amountDelta
      };
    }

    if (reversalWelfareSnap.exists || reversalExpenseSnap.exists || reversalTransferSnap.exists) {
      throw new Error('Welfare reversal history exists without its canonical reversal record. Manual review required.');
    }
    if (!originalWelfareSnap.exists || !originalExpenseSnap.exists || !originalTransferSnap.exists) {
      throw new Error('Original welfare financial postings are incomplete.');
    }

    const originalWelfare = originalWelfareSnap.data();
    const originalExpense = originalExpenseSnap.data();
    const originalTransfer = originalTransferSnap.data();
    const beneficiaryId = clean(originalWelfare.staffId);
    const beneficiaryCollection = originalWelfare.isStaff === true ? 'staff' : 'clients';
    if (!beneficiaryId) throw new Error('Original welfare posting has no beneficiary.');
    const beneficiaryRef = db.collection(beneficiaryCollection).doc(beneficiaryId);
    const beneficiarySnap = await tx.get(beneficiaryRef);
    if (!beneficiarySnap.exists) throw new Error('Welfare beneficiary no longer exists.');
    const beneficiary = beneficiarySnap.data();

    validateWelfareOriginals({
      sale,
      payment,
      welfare: originalWelfare,
      expense: originalExpense,
      transfer: originalTransfer,
      beneficiary,
      expectedAmount: expected.amount
    });

    const nextSpent = Number(beneficiary.welfare_spent || 0) - expected.amount;
    const nextYtd = Number(beneficiary.welfare_used_ytd || 0) - expected.amount;
    if (!Number.isFinite(nextSpent) || !Number.isFinite(nextYtd) || nextSpent < -0.0001 || nextYtd < -0.0001) {
      throw new Error('Welfare reversal would create a negative beneficiary balance.');
    }

    const timestamp = FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();

    tx.update(beneficiaryRef, {
      welfare_spent: Math.max(0, nextSpent),
      welfare_used_ytd: Math.max(0, nextYtd),
      updatedAt: timestamp
    });

    tx.create(reversalRef, {
      ...expected,
      originalWelfareId: originals.welfareId,
      originalExpenseId: originals.expenseId,
      originalTransferId: originals.transferId,
      beneficiaryId,
      beneficiaryCollection,
      status: 'COMPLETED',
      createdAt: timestamp,
      completedAt: timestamp
    });

    tx.create(reversalWelfareRef, {
      tenantId: expected.tenantId,
      branchId: expected.branchId,
      saleId: expected.originalSaleId,
      revisionId: expected.revisionId,
      reversalId: expected.reversalId,
      reversesWelfareId: originals.welfareId,
      staffId: beneficiaryId,
      isStaff: originalWelfare.isStaff === true,
      type: originalWelfare.type || 'medical',
      amount: expected.amountDelta,
      amountDelta: expected.amountDelta,
      date: nowIso,
      status: 'reversed',
      receiptNumber: expected.originalReceiptNumber || null,
      notes: `POS revision welfare reversal: ${expected.originalReceiptNumber || expected.originalSaleId}`,
      processedBy: expected.requestedBy,
      processedByName: expected.requestedByName,
      reason: expected.reason,
      source: expected.source,
      engineVersion: 2,
      createdAt: timestamp,
      completedAt: timestamp
    });

    tx.create(reversalExpenseRef, {
      tenantId: expected.tenantId,
      saleId: expected.originalSaleId,
      revisionId: expected.revisionId,
      reversalId: expected.reversalId,
      reversesExpenseId: originals.expenseId,
      branchId: expected.branchId,
      branch_id: expected.branchId,
      category: originalExpense.category || 'Staff Welfare',
      amount: expected.amountDelta,
      amountDelta: expected.amountDelta,
      date: nowIso,
      expense_date: nowIso.slice(0, 10),
      description: `POS revision reversal - ${expected.originalReceiptNumber || expected.originalSaleId}`,
      payment_method: 'System Adjustment',
      status: 'reversed',
      logged_by: expected.requestedByName,
      reason: expected.reason,
      source: expected.source,
      engineVersion: 2,
      createdAt: timestamp,
      completedAt: timestamp
    });

    tx.create(reversalTransferRef, {
      tenantId: expected.tenantId,
      saleId: expected.originalSaleId,
      revisionId: expected.revisionId,
      reversalId: expected.reversalId,
      reversesTransferId: originals.transferId,
      fromPortfolio: 'banked',
      toPortfolio: 'welfare',
      amount: expected.amount,
      amountDelta: expected.amountDelta,
      status: 'reversed',
      processedBy: expected.requestedByName,
      reason: expected.reason,
      notes: `POS revision welfare transfer reversal: ${expected.originalReceiptNumber || expected.originalSaleId}`,
      source: expected.source,
      engineVersion: 2,
      createdAt: timestamp,
      completedAt: timestamp
    });

    return {
      replayed: false,
      reversalId: expected.reversalId,
      welfareId: expected.welfareId,
      expenseId: expected.expenseId,
      transferId: expected.transferId,
      amountDelta: expected.amountDelta
    };
  });
}
