import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where
} from 'firebase/firestore';
import { db } from '../firebase';
import { Sale } from '../types';

const stablePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);

const postingIds = (tenantId: string, saleId: string) => {
  const key = stablePart(`${tenantId}_${saleId}`);
  return {
    welfareId: `pos_welfare_${key}`,
    expenseId: `pos_welfare_expense_${key}`,
    transferId: `pos_welfare_transfer_${key}`
  };
};

const numberValue = (value: unknown) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

export async function reconcilePosWelfarePosting(params: {
  tenantId: string;
  saleId: string;
  actorId: string;
  actorName: string;
}): Promise<'posted' | 'reversed' | 'not_applicable'> {
  const { tenantId, saleId, actorId, actorName } = params;
  const ids = postingIds(tenantId, saleId);
  const saleRef = doc(db, 'sales', saleId);
  const welfareRef = doc(db, 'welfare', ids.welfareId);
  const expenseRef = doc(db, 'branch_expenses', ids.expenseId);
  const transferRef = doc(db, 'cashTransfers', ids.transferId);

  let outcome: 'posted' | 'reversed' | 'not_applicable' = 'not_applicable';

  await runTransaction(db, async transaction => {
    const [saleSnap, welfareSnap] = await Promise.all([
      transaction.get(saleRef),
      transaction.get(welfareRef)
    ]);
    if (!saleSnap.exists()) throw new Error('The completed sale could not be found for welfare posting.');
    const sale = saleSnap.data() as Sale & Record<string, any>;
    if (sale.tenantId !== tenantId) throw new Error('Sale tenant mismatch during welfare posting.');

    const previous = welfareSnap.exists() ? welfareSnap.data() : null;
    if (previous && previous.tenantId !== tenantId) throw new Error('Welfare posting ID collision across tenants.');

    const desiredAmount = sale.paymentMethod === 'staff_welfare'
      ? Math.max(0, numberValue(sale.welfareAmount ?? sale.totalAmount ?? sale.total))
      : 0;
    const desiredBeneficiaryId = desiredAmount > 0 ? String(sale.patientId || '') : '';
    const desiredIsStaff = desiredAmount > 0 ? Boolean(sale.welfareBeneficiaryIsStaff) : false;
    const previousAmount = previous ? Math.max(0, numberValue(previous.amount)) : 0;
    const previousBeneficiaryId = previous ? String(previous.staffId || '') : '';
    const previousIsStaff = previous ? Boolean(previous.isStaff) : false;

    if (desiredAmount > 0 && !desiredBeneficiaryId) {
      throw new Error('Staff welfare payment has no linked beneficiary.');
    }

    const beneficiaryRefs = new Map<string, ReturnType<typeof doc>>();
    const addBeneficiary = (id: string, isStaff: boolean) => {
      if (!id) return;
      beneficiaryRefs.set(`${isStaff ? 'staff' : 'clients'}:${id}`, doc(db, isStaff ? 'staff' : 'clients', id));
    };
    addBeneficiary(previousBeneficiaryId, previousIsStaff);
    addBeneficiary(desiredBeneficiaryId, desiredIsStaff);

    const beneficiarySnapshots = new Map<string, any>();
    for (const [key, ref] of beneficiaryRefs) beneficiarySnapshots.set(key, await transaction.get(ref));

    const applyDelta = (id: string, isStaff: boolean, delta: number) => {
      if (!id || delta === 0) return;
      const key = `${isStaff ? 'staff' : 'clients'}:${id}`;
      const ref = beneficiaryRefs.get(key);
      const snap = beneficiarySnapshots.get(key);
      if (!ref || !snap?.exists()) throw new Error('Welfare beneficiary no longer exists.');
      const data = snap.data();
      if (data.tenantId !== tenantId) throw new Error('Welfare beneficiary tenant mismatch.');
      const currentSpent = numberValue(data.welfare_spent);
      const currentYtd = numberValue(data.welfare_used_ytd);
      const nextSpent = currentSpent + delta;
      const nextYtd = currentYtd + delta;
      if (nextSpent < 0 || nextYtd < 0) throw new Error('Welfare reversal would create a negative employee welfare balance.');
      transaction.update(ref, {
        welfare_spent: nextSpent,
        welfare_used_ytd: nextYtd,
        updatedAt: serverTimestamp()
      });
    };

    const sameBeneficiary = previousBeneficiaryId === desiredBeneficiaryId && previousIsStaff === desiredIsStaff;
    if (sameBeneficiary) {
      applyDelta(desiredBeneficiaryId, desiredIsStaff, desiredAmount - previousAmount);
    } else {
      applyDelta(previousBeneficiaryId, previousIsStaff, -previousAmount);
      applyDelta(desiredBeneficiaryId, desiredIsStaff, desiredAmount);
    }

    const nowIso = new Date().toISOString();
    const branchId = String(sale.branchId || '');
    const status = desiredAmount > 0 ? 'approved' : previousAmount > 0 ? 'reversed' : 'not_applicable';
    outcome = desiredAmount > 0 ? 'posted' : previousAmount > 0 ? 'reversed' : 'not_applicable';

    transaction.set(welfareRef, {
      tenantId,
      saleId,
      staffId: desiredBeneficiaryId || previousBeneficiaryId || null,
      isStaff: desiredAmount > 0 ? desiredIsStaff : previousIsStaff,
      type: 'medical',
      amount: desiredAmount,
      date: nowIso,
      status,
      branchId,
      receiptNumber: sale.receiptNumber || null,
      notes: `POS Purchase: ${sale.receiptNumber || saleId}`,
      processedBy: actorId,
      updatedAt: serverTimestamp(),
      createdAt: previous?.createdAt || serverTimestamp()
    }, { merge: true });

    transaction.set(expenseRef, {
      tenantId,
      saleId,
      branchId,
      branch_id: branchId,
      category: 'Staff Welfare',
      amount: desiredAmount,
      date: nowIso,
      expense_date: nowIso.slice(0, 10),
      description: `Staff Welfare Benefit - Receipt ${sale.receiptNumber || saleId}`,
      payment_method: 'System Adjustment',
      status,
      logged_by: actorName,
      updatedAt: serverTimestamp()
    }, { merge: true });

    transaction.set(transferRef, {
      tenantId,
      saleId,
      fromPortfolio: 'welfare',
      toPortfolio: 'banked',
      amount: desiredAmount,
      status: desiredAmount > 0 ? 'posted' : 'reversed',
      processedBy: actorName,
      notes: `POS Purchase Staff Welfare: ${sale.receiptNumber || saleId}`,
      updatedAt: serverTimestamp()
    }, { merge: true });

    transaction.update(saleRef, {
      welfarePostingStatus: outcome,
      welfarePostingId: ids.welfareId,
      welfarePostingAmount: desiredAmount,
      welfarePostingUpdatedAt: serverTimestamp()
    });
  });

  return outcome;
}

export async function convertQuotationToSale(params: {
  tenantId: string;
  quotationId: string;
  saleId: string;
  convertedValue: number;
}): Promise<void> {
  const { tenantId, quotationId, saleId, convertedValue } = params;
  const quotationRef = doc(db, 'pos_quotations', quotationId);
  const saleRef = doc(db, 'sales', saleId);

  await runTransaction(db, async transaction => {
    const [quotationSnap, saleSnap] = await Promise.all([
      transaction.get(quotationRef),
      transaction.get(saleRef)
    ]);
    if (!quotationSnap.exists()) throw new Error('The source quotation no longer exists.');
    if (!saleSnap.exists()) throw new Error('The completed sale no longer exists.');
    const quotation = quotationSnap.data();
    const sale = saleSnap.data();
    if (quotation.tenantId !== tenantId || sale.tenantId !== tenantId) throw new Error('Quotation or sale tenant mismatch.');

    if (quotation.status === 'Converted' && quotation.convertedReceiptId && quotation.convertedReceiptId !== saleId) {
      throw new Error('This quotation has already been converted to another sale.');
    }

    const convertedAt = quotation.convertedAt || new Date().toISOString();
    transaction.update(quotationRef, {
      status: 'Converted',
      convertedReceiptId: saleId,
      convertedAt,
      convertedValue,
      updatedAt: serverTimestamp()
    });
    transaction.update(saleRef, {
      sourceQuotationId: quotationId,
      quotationConversionStatus: 'converted',
      quotationConvertedAt: convertedAt,
      updatedAt: serverTimestamp()
    });
  });
}

export async function reconcilePendingPosFinancials(params: {
  tenantId: string;
  branchId: string;
  actorId: string;
  actorName: string;
}): Promise<number> {
  const snapshot = await getDocs(query(
    collection(db, 'sales'),
    where('tenantId', '==', params.tenantId),
    where('branchId', '==', params.branchId)
  ));
  const pending = snapshot.docs
    .filter(snap => snap.data().paymentMethod === 'staff_welfare' && snap.data().welfarePostingStatus === 'pending')
    .slice(0, 20);

  let repaired = 0;
  for (const saleSnap of pending) {
    try {
      await reconcilePosWelfarePosting({
        tenantId: params.tenantId,
        saleId: saleSnap.id,
        actorId: params.actorId,
        actorName: params.actorName
      });
      repaired += 1;
    } catch (error) {
      console.warn('Pending POS welfare posting still requires reconciliation:', saleSnap.id, error);
    }
  }
  return repaired;
}
