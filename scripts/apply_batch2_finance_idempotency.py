from pathlib import Path


def rep(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise RuntimeError(f'Patch target not found: {label}')
    p.write_text(text.replace(old, new, 1))
    print('patched:', label)

sales = 'src/pages/Sales.tsx'
rep(sales,
    "import { reviseSaleInventoryAtomically, voidSaleInventoryAtomically } from '../services/saleInventoryIntegrityService';",
    "import { reviseSaleInventoryAtomically, voidSaleInventoryAtomically } from '../services/saleInventoryIntegrityService';\nimport { convertQuotationToSale, reconcilePendingPosFinancials, reconcilePosWelfarePosting } from '../services/posFinancialPostingService';",
    'POS finance imports')

rep(sales,
    "  useEffect(() => {\n    if (selectedPatient?.discountRate) {",
    "  useEffect(() => {\n    if (!profile?.tenantId || !activeBranchId) return;\n    reconcilePendingPosFinancials({\n      tenantId: profile.tenantId, branchId: activeBranchId, actorId: profile.uid,\n      actorName: profile.full_name || profile.displayName || 'POS Staff'\n    }).catch(error => console.warn('Pending POS finance reconciliation could not complete:', error));\n  }, [profile?.tenantId, profile?.uid, activeBranchId]);\n\n  useEffect(() => {\n    if (selectedPatient?.discountRate) {",
    'pending welfare reconciliation')

rep(sales,
    "          welfareAmount: paymentMethod === 'staff_welfare' ? (isWelfareSplit ? welfareBalance : totalAmount) : undefined,\n          secondaryAmount: isWelfareSplit ? (totalAmount - welfareBalance) : undefined,\n          context,",
    "          welfareAmount: paymentMethod === 'staff_welfare' ? (isWelfareSplit ? welfareBalance : totalAmount) : undefined,\n          welfareBeneficiaryIsStaff: paymentMethod === 'staff_welfare' ? Boolean(selectedPatient?.isStaff) : undefined,\n          welfarePostingStatus: paymentMethod === 'staff_welfare' ? 'pending' : 'not_applicable',\n          secondaryAmount: isWelfareSplit ? (totalAmount - welfareBalance) : undefined,\n          context,",
    'edited sale welfare metadata')

rep(sales,
    "          welfareAmount: paymentMethod === 'staff_welfare' ? (isWelfareSplit ? welfareBalance : totalAmount) : undefined,\n          secondaryAmount: isWelfareSplit ? (totalAmount - welfareBalance) : undefined,\n          timestamp: new Date().toISOString(),",
    "          welfareAmount: paymentMethod === 'staff_welfare' ? (isWelfareSplit ? welfareBalance : totalAmount) : undefined,\n          welfareBeneficiaryIsStaff: paymentMethod === 'staff_welfare' ? Boolean(selectedPatient?.isStaff) : undefined,\n          welfarePostingStatus: paymentMethod === 'staff_welfare' ? 'pending' : 'not_applicable',\n          secondaryAmount: isWelfareSplit ? (totalAmount - welfareBalance) : undefined,\n          sourceQuotationId: resumedQuotationId || undefined,\n          quotationConversionStatus: resumedQuotationId ? 'pending' : 'not_applicable',\n          timestamp: new Date().toISOString(),",
    'new sale finance metadata')

old = '''      // Handle Welfare Payment posting
      if (paymentMethod === 'staff_welfare' && selectedPatient) {
        const welfareUsed = isWelfareSplit ? welfareBalance : totalAmount;
        const collection = selectedPatient.isStaff ? 'staff' : 'clients';
        
        await firestoreService.updateDocument(collection, selectedPatient.id, {
          welfare_spent: (selectedPatient.welfare_spent || 0) + welfareUsed,
          welfare_used_ytd: (selectedPatient.welfare_used_ytd || 0) + welfareUsed
        });

        await firestoreService.addDocument('welfare', {
          tenantId: profile.tenantId,
          staffId: selectedPatient.id,
          isStaff: selectedPatient.isStaff,
          type: 'medical',
          amount: welfareUsed,
          date: new Date().toISOString(),
          status: 'approved',
          notes: `${editingSaleId ? 'Edit' : 'POS'} Purchase: ${receiptNumber}`
        });

        await firestoreService.addDocument('branch_expenses', {
          tenantId: profile.tenantId,
          branchId: activeBranchId || 'main',
          category: 'Staff Welfare',
          amount: welfareUsed,
          date: new Date().toISOString(),
          description: `Staff Welfare Benefit - Receipt ${receiptNumber}`,
          payment_method: 'System Adjustment',
          status: 'approved',
          logged_by: profile.full_name || 'Unknown'
        });

        // Add a Cash Transfer from 'welfare' to 'banked' portfolio so that Cash & Banking updates instantly
        await firestoreService.addDocument('cashTransfers', {
          tenantId: profile.tenantId,
          fromPortfolio: 'welfare',
          toPortfolio: 'banked',
          amount: welfareUsed,
          processedBy: profile.full_name || 'POS Staff',
          notes: `POS Purchase Staff Welfare: ${receiptNumber}`
        });
      }
'''
new = '''      if (finalReceiptId) {
        try {
          await reconcilePosWelfarePosting({
            tenantId: profile.tenantId, saleId: finalReceiptId, actorId: profile.uid,
            actorName: profile.full_name || profile.displayName || 'POS Staff'
          });
        } catch (welfareError) {
          console.warn('Sale completed, but welfare finance posting remains pending:', welfareError);
          if (paymentMethod === 'staff_welfare') toast.warning('Sale completed. Staff welfare finance posting is pending automatic reconciliation.');
        }
      }
'''
rep(sales, old, new, 'idempotent welfare posting')

old = '''      // Link with resumed quotation if applicable
      if (resumedQuotationId) {
        try {
          await firestoreService.updateDocument('pos_quotations', resumedQuotationId, {
            status: 'Converted',
            convertedReceiptId: finalReceiptId || receiptNumber,
            convertedAt: new Date().toISOString(),
            convertedValue: finalTotal
          });
        } catch (e) {
          console.warn('Failed to update resumed quotation status:', e);
        }
        setResumedQuotationId(null);
      }
'''
new = '''      if (resumedQuotationId && finalReceiptId) {
        try {
          await convertQuotationToSale({ tenantId: profile.tenantId, quotationId: resumedQuotationId, saleId: finalReceiptId, convertedValue: finalTotal });
        } catch (quotationError) {
          console.warn('Sale completed, but quotation conversion remains pending:', quotationError);
          toast.warning('Sale completed. The quotation link needs reconciliation, but no second sale was created.');
        }
        setResumedQuotationId(null);
      }
'''
rep(sales, old, new, 'idempotent quotation conversion')

rep(sales,
    "                    { id: 'staff_welfare', label: 'Staff Welfare', icon: User, disabled: !isEmployee || totalAmount > welfareBalance }",
    "                    { id: 'staff_welfare', label: 'Staff Welfare', icon: User, disabled: !isEmployee }",
    'welfare split payment')

proc = 'src/services/procurementFinanceService.ts'
anchor = '''const toTimestamp = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error('A valid invoice date is required.');
  return Timestamp.fromDate(parsed);
};
'''
helpers = anchor + '''

const pettyCashLeaseRef = (tenantId: string) => doc(db, 'petty_cash_posting_locks', stablePart(tenantId));

async function acquirePettyCashLease(tenantId: string, postingId: string, userId: string) {
  const lockRef = pettyCashLeaseRef(tenantId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(lockRef);
    const nowMs = Date.now();
    if (snapshot.exists()) {
      const lock = snapshot.data();
      if (lock.postingId !== postingId && Number(lock.expiresAtMs || 0) > nowMs) {
        throw new Error('Another Management Petty Cash posting is currently being processed. Please retry in a moment.');
      }
    }
    transaction.set(lockRef, { tenantId, postingId, userId, acquiredAt: Timestamp.now(), expiresAtMs: nowMs + 120000 }, { merge: true });
  });
}

async function releasePettyCashLease(tenantId: string, postingId: string) {
  const lockRef = pettyCashLeaseRef(tenantId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(lockRef);
    if (!snapshot.exists() || snapshot.data().postingId !== postingId) return;
    transaction.set(lockRef, { tenantId, postingId: null, userId: null, releasedAt: Timestamp.now(), expiresAtMs: 0 }, { merge: true });
  });
}
'''
rep(proc, anchor, helpers, 'petty cash lease helpers')

old = '''  if (paymentType === 'cash' && financeValue > 0) {
    const ledger = await getDocs(query(collection(db, 'petty_cash_ledger'), where('tenantId', '==', tenantId)));
    const available = ledger.docs.reduce((sum, snap) => {
      const data = snap.data();
      return sum + (data.type === 'incoming' ? Number(data.amount || 0) : -Number(data.amount || 0));
    }, 0);
    if (available < financeValue) {
      throw new Error(`Insufficient Management Petty Cash. Available: UGX ${available.toLocaleString()}, required: UGX ${financeValue.toLocaleString()}.`);
    }
  }

  const result = await runTransaction(db, async transaction => {
'''
new = '''  let pettyCashLeaseAcquired = false;
  if (paymentType === 'cash' && financeValue > 0) {
    await acquirePettyCashLease(tenantId, ids.pettyCashId, user.uid);
    pettyCashLeaseAcquired = true;
    const ledger = await getDocs(query(collection(db, 'petty_cash_ledger'), where('tenantId', '==', tenantId)));
    const available = ledger.docs.reduce((sum, snap) => {
      const data = snap.data();
      const type = String(data.type || '').toLowerCase();
      return sum + (['incoming', 'deposit', 'topup'].includes(type) ? Number(data.amount || 0) : -Number(data.amount || 0));
    }, 0);
    if (available < financeValue) {
      await releasePettyCashLease(tenantId, ids.pettyCashId);
      pettyCashLeaseAcquired = false;
      throw new Error(`Insufficient Management Petty Cash. Available: UGX ${available.toLocaleString()}, required: UGX ${financeValue.toLocaleString()}.`);
    }
  }

  let result: { alreadyProcessed: boolean };
  try {
    result = await runTransaction(db, async transaction => {
'''
rep(proc, old, new, 'serialized petty cash check')

rep(proc,
    "      paymentStatus: existingInvoice?.paymentStatus || paymentType,",
    "      paymentStatus: paymentType === 'cash' ? 'Paid' : (existingCredit && Number(existingCredit.remainingCreditBalance ?? existingCredit.balance ?? financeValue) <= 0 ? 'Paid' : (existingCredit && Number(existingCredit.remainingCreditBalance ?? existingCredit.balance ?? financeValue) < financeValue ? 'Partially Paid' : 'Outstanding')) ,",
    'canonical payment status')

rep(proc,
    '''    return { alreadyProcessed: false };
  });

  return {
''',
    '''    return { alreadyProcessed: false };
    });
  } finally {
    if (pettyCashLeaseAcquired) {
      await releasePettyCashLease(tenantId, ids.pettyCashId).catch(error => console.error('Failed to release petty cash posting lease:', error));
    }
  }

  return {
''',
    'petty cash lease release')

orders = 'src/services/orderSubmissionService.ts'
rep(orders, "  addDoc,\n  updateDoc", "  updateDoc", 'remove random audit import')
rep(orders,
    "      if (!prodSnap.exists()) continue;",
    "      if (!prodSnap.exists()) {\n        result.hasChanges = true;\n        result.warnings.push({ productId: line.productId, productName: line.productName, type: 'STOCK_DROP', message: 'This product no longer exists and must be removed from the order before submission.', details: {} });\n        continue;\n      }",
    'missing product validation')

rep(orders,
'''      const isHqAggregate = run.configuration.demandScope === 'all_branches';
      const stableOrderPart = `${runId}_${groupKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
      const orderRef = isHqAggregate
        ? doc(db, 'stock_orders', getHqAutoOrderId(runId, groupKey))
        : doc(collection(db, 'stock_orders'));
      const orderNumber = isHqAggregate
        ? `HQR-${runId.slice(-6)}-${supplierId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'GEN'}`
        : `ORD-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
''',
'''      const isHqAggregate = run.configuration.demandScope === 'all_branches';
      const stableOrderPart = `${runId}_${groupKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
      const orderRef = doc(db, 'stock_orders', getHqAutoOrderId(runId, groupKey));
      const supplierSuffix = supplierId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'GEN';
      const orderNumber = isHqAggregate ? `HQR-${runId.slice(-6)}-${supplierSuffix}` : `ORD-${runId.slice(-6)}-${supplierSuffix}`;
''', 'deterministic PO IDs')

rep(orders,
'''        const lineRefs = items.map(item => isHqAggregate
            ? doc(db, 'stock_order_lines', `auto_line_${stableOrderPart}_${item.productId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`)
            : doc(collection(db, 'stock_order_lines'))
        );
''',
'''        const lineRefs = items.map(item =>
          doc(db, 'stock_order_lines', `auto_line_${stableOrderPart}_${item.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`)
        );
''', 'deterministic PO lines')

rep(orders,
'''      const transferRef = doc(collection(db, 'transfer_invoices'));
      const transferNumber = `TRF-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
''',
'''      const stableTransferPart = `${runId}_${donorId}_${destinationBranchId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
      const transferRef = doc(db, 'transfer_invoices', `auto_transfer_${stableTransferPart}`);
      const transferNumber = `TRF-${runId.slice(-6)}-${donorId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'SRC'}`;
''', 'deterministic transfer IDs')

old = '''      await runTransaction(db, async (tx) => {
        tx.set(transferRef, transferData);
        for (const item of items) {
          const lineRef = doc(collection(db, 'transfer_invoice_lines'));
          const cost = (item.calculationInputs as any)?.costPricePerPack || 0;
          tx.set(lineRef, {
            tenantId,
            transfer_id: transferRef.id,
            product_id: item.productId,
            product_name: item.productName,
            qty_requested: item.qtyToTransferBaseUnits, // base units
            qty_dispatched: 0,
            qty_received: 0,
            unit_cost_ugx: cost,
            createdAt: new Date().toISOString()
          });
        }
      });

      // 3. Mark active reservations as CONVERTED
      try {
        const reservationsSnap = await getDocs(
          query(
            collection(db, 'inventoryTransferReservations'),
            where('tenantId', '==', tenantId),
            where('autoGenerateRunId', '==', runId),
            where('sourceBranchId', '==', donorId),
            where('status', '==', 'ACTIVE')
          )
        );

        for (const resDoc of reservationsSnap.docs) {
          await updateDoc(doc(db, 'inventoryTransferReservations', resDoc.id), {
            status: 'CONVERTED',
            convertedTransferRequestId: transferRef.id,
            updatedAt: new Date().toISOString()
          });
        }
      } catch (e) {
        console.warn('Failed to convert reservations:', e);
      }
'''
new = '''      const lineRefs = items.map(item => doc(db, 'transfer_invoice_lines', `auto_transfer_line_${stableTransferPart}_${String(item.id || item.productId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`));
      const reservationsSnap = await getDocs(query(
        collection(db, 'inventoryTransferReservations'),
        where('tenantId', '==', tenantId), where('autoGenerateRunId', '==', runId), where('sourceBranchId', '==', donorId)
      ));
      const reservationRefs = reservationsSnap.docs.map(snapshot => snapshot.ref);

      await runTransaction(db, async tx => {
        const snapshots = await Promise.all([tx.get(transferRef), ...lineRefs.map(ref => tx.get(ref)), ...reservationRefs.map(ref => tx.get(ref))]);
        if (!snapshots[0].exists()) tx.set(transferRef, transferData);
        items.forEach((item, index) => {
          if (snapshots[index + 1].exists()) return;
          const cost = (item.calculationInputs as any)?.costPricePerPack || 0;
          tx.set(lineRefs[index], { tenantId, transfer_id: transferRef.id, product_id: item.productId, product_name: item.productName, qty_requested: item.qtyToTransferBaseUnits, qty_dispatched: 0, qty_received: 0, unit_cost_ugx: cost, createdAt: new Date().toISOString() });
        });
        reservationRefs.forEach((ref, index) => {
          const snapshot = snapshots[1 + lineRefs.length + index];
          if (!snapshot.exists()) return;
          const reservation = snapshot.data();
          if (reservation.status === 'CONVERTED' && reservation.convertedTransferRequestId && reservation.convertedTransferRequestId !== transferRef.id) throw new Error('A stock reservation was already converted into a different transfer request.');
          if (['ACTIVE', 'PENDING', 'CONVERTED'].includes(reservation.status)) tx.update(ref, { status: 'CONVERTED', convertedTransferRequestId: transferRef.id, updatedAt: new Date().toISOString() });
        });
      });
'''
rep(orders, old, new, 'atomic transfer conversion')

old = '''    // 4. Update Run Status
    await updateDoc(runRef, {
      status: 'SUBMITTED',
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // 5. Create Audit Log
    try {
      await addDoc(collection(db, 'global_audit_logs'), {
        tenantId,
        action: 'AUTO_GENERATE_ORDER_SUBMITTED',
        category: 'PROCUREMENT',
        description: `Auto-generated order run ${runId} submitted. Created ${orderIds.length} purchase orders and ${transferIds.length} interbranch transfers.`,
        actor: userEmail,
        timestamp: new Date().toISOString(),
        ipAddress: 'client-side',
        device: 'PharmHelm Pro ERP Console'
      });
    } catch (e) {
      console.warn('Audit logger failed:', e);
    }
'''
new = '''    const submittedAt = new Date().toISOString();
    await runTransaction(db, async tx => {
      const latestRun = await tx.get(runRef);
      if (!latestRun.exists()) throw new Error('Run snapshot disappeared during submission.');
      tx.update(runRef, { status: 'SUBMITTED', submittedAt, updatedAt: submittedAt, submittedOrderIds: orderIds, submittedTransferIds: transferIds });
      tx.set(doc(db, 'global_audit_logs', `auto_order_submit_${runId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180)}`), {
        tenantId, action: 'AUTO_GENERATE_ORDER_SUBMITTED', category: 'PROCUREMENT',
        description: `Auto-generated order run ${runId} submitted. Created ${orderIds.length} purchase orders and ${transferIds.length} interbranch transfers.`,
        actor: userEmail, timestamp: submittedAt, ipAddress: 'client-side', device: 'PharmHelm Pro ERP Console'
      }, { merge: true });
    });
'''
rep(orders, old, new, 'idempotent run finalization')

print('Batch 2 patch complete')
