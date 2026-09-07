const fs = require('fs');

function replaceOne(file, pattern, replacement, label) {
  const source = fs.readFileSync(file, 'utf8');
  const matches = source.match(pattern);
  if (!matches) throw new Error(`Patch target not found: ${label}`);
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Patch made no change: ${label}`);
  fs.writeFileSync(file, next);
  console.log(`patched: ${label}`);
}

const integrityService = `import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where
} from 'firebase/firestore';
import { db } from '../firebase';
import { Product, Sale, SaleItem } from '../types';
import { getBaseUnitMultiplier } from './consumptionService';

interface SaleIntegrityActor {
  uid: string;
  name: string;
  role?: string;
}

interface ReviseSaleInventoryInput {
  tenantId: string;
  branchId: string;
  saleId: string;
  originalSale: Sale;
  updatedItems: SaleItem[];
  saleUpdates: Record<string, any>;
  products: Product[];
  actor: SaleIntegrityActor;
  reason: string;
  actionType: 'EDIT' | 'EDIT_IN_LEDGER';
  revisionId: string;
  auditId: string;
}

interface VoidSaleInventoryInput {
  tenantId: string;
  branchId: string;
  sale: Sale;
  products: Product[];
  actor: SaleIntegrityActor;
  reason: string;
  auditId: string;
}

type StockAdjustment = {
  productId: string;
  batchNumber: string;
  baseDelta: number;
};

const stockKey = (productId: string, batchNumber: string) => \`${'${productId}'}::${'${batchNumber}'}\`;

const itemFingerprint = (items: SaleItem[]) => JSON.stringify(
  items.map(item => ({
    productId: item.productId,
    batchNumber: item.batchNumber || 'N/A',
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unitPrice || 0),
    isService: Boolean(item.isService)
  })).sort((a, b) => \`${'${a.productId}'}::${'${a.batchNumber}'}\`.localeCompare(\`${'${b.productId}'}::${'${b.batchNumber}'}\`))
);

function productMap(products: Product[]) {
  return new Map(products.map(product => [product.id, product]));
}

function baseQuantity(item: SaleItem, product: Product): number {
  const quantity = Number(item.quantity || 0);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Sale item quantity is invalid.');

  const explicitBaseQuantity = Number((item as any).baseQuantity);
  if (Number.isFinite(explicitBaseQuantity) && explicitBaseQuantity >= 0) return explicitBaseQuantity;

  const snapshotMultiplier = Number((item as any).tierMultiplier ?? (item as any).multiplier);
  const multiplier = Number.isFinite(snapshotMultiplier) && snapshotMultiplier > 0
    ? snapshotMultiplier
    : getBaseUnitMultiplier(product);
  return quantity * multiplier;
}

async function resolveBatchRefs(
  tenantId: string,
  branchId: string,
  items: SaleItem[]
): Promise<Map<string, ReturnType<typeof doc>>> {
  const refs = new Map<string, ReturnType<typeof doc>>();
  const unique = new Map<string, SaleItem>();

  for (const item of items) {
    if (item.isService) continue;
    const batchNumber = item.batchNumber || 'N/A';
    if (batchNumber === 'N/A') throw new Error(\`Batch number is missing for ${'${item.productName || item.productId}'}.\`);
    unique.set(stockKey(item.productId, batchNumber), item);
  }

  for (const [key, item] of unique) {
    const batchId = String((item as any).batchId || '').trim();
    if (batchId) {
      refs.set(key, doc(db, 'product_batches', batchId));
      continue;
    }

    const snapshots = await getDocs(query(
      collection(db, 'product_batches'),
      where('tenantId', '==', tenantId),
      where('branchId', '==', branchId),
      where('productId', '==', item.productId),
      where('batchNumber', '==', item.batchNumber)
    ));

    if (snapshots.empty) throw new Error(\`Batch ${'${item.batchNumber}'} for ${'${item.productName || item.productId}'} no longer exists.\`);
    if (snapshots.size > 1) {
      throw new Error(\`Inventory integrity check found duplicate batch records for ${'${item.productName || item.productId}'} batch ${'${item.batchNumber}'}. Reconcile the duplicate batches before editing this receipt.\`);
    }
    refs.set(key, snapshots.docs[0].ref);
  }

  return refs;
}

function buildAdjustments(
  originalItems: SaleItem[],
  updatedItems: SaleItem[],
  productsById: Map<string, Product>
) {
  const byBatch = new Map<string, StockAdjustment>();
  const byProduct = new Map<string, number>();

  const apply = (item: SaleItem, sign: 1 | -1) => {
    if (item.isService) return;
    const product = productsById.get(item.productId);
    if (!product) throw new Error(\`Product ${'${item.productName || item.productId}'} no longer exists in the current tenant catalogue.\`);
    const qty = baseQuantity(item, product) * sign;
    const batchNumber = item.batchNumber || 'N/A';
    const key = stockKey(item.productId, batchNumber);
    const current = byBatch.get(key) || { productId: item.productId, batchNumber, baseDelta: 0 };
    current.baseDelta += qty;
    byBatch.set(key, current);
    byProduct.set(item.productId, (byProduct.get(item.productId) || 0) + qty);
  };

  originalItems.forEach(item => apply(item, -1));
  updatedItems.forEach(item => apply(item, 1));
  return { byBatch, byProduct };
}

export async function reviseSaleInventoryAtomically(input: ReviseSaleInventoryInput): Promise<void> {
  if (!input.tenantId || !input.branchId || !input.saleId) throw new Error('Tenant, branch and sale identifiers are required for receipt revision.');
  if (input.updatedItems.length === 0) throw new Error('A receipt must contain at least one item.');

  const productsById = productMap(input.products);
  const allItems = [...input.originalSale.items, ...input.updatedItems];
  const batchRefs = await resolveBatchRefs(input.tenantId, input.branchId, allItems);
  const { byBatch, byProduct } = buildAdjustments(input.originalSale.items, input.updatedItems, productsById);
  const productRefs = new Map(Array.from(byProduct.keys()).map(productId => [productId, doc(db, 'products', productId)]));
  const saleRef = doc(db, 'sales', input.saleId);
  const revisionRef = doc(db, 'sale_revisions', input.revisionId);
  const auditRef = doc(db, 'audit_logs', input.auditId);
  const nowIso = new Date().toISOString();

  await runTransaction(db, async transaction => {
    const saleSnapshot = await transaction.get(saleRef);
    if (!saleSnapshot.exists()) throw new Error('The receipt no longer exists.');
    const currentSale = saleSnapshot.data() as Sale;
    if (currentSale.tenantId !== input.tenantId) throw new Error('Receipt tenant mismatch.');
    if ((currentSale.branchId || input.branchId) !== input.branchId) throw new Error('Receipt branch mismatch.');
    if (currentSale.status === 'voided') throw new Error('A voided receipt cannot be edited.');
    if (itemFingerprint(currentSale.items || []) !== itemFingerprint(input.originalSale.items || [])) {
      throw new Error('This receipt changed in another session. Reload the Receipt Ledger before editing it again.');
    }

    const batchSnapshots = new Map();
    for (const [key, ref] of batchRefs) batchSnapshots.set(key, await transaction.get(ref));
    const productSnapshots = new Map();
    for (const [productId, ref] of productRefs) productSnapshots.set(productId, await transaction.get(ref));

    for (const [key, adjustment] of byBatch) {
      if (adjustment.baseDelta === 0) continue;
      const snapshot = batchSnapshots.get(key);
      if (!snapshot?.exists()) throw new Error(\`Batch ${'${adjustment.batchNumber}'} no longer exists.\`);
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId || data.branchId !== input.branchId || data.productId !== adjustment.productId) {
        throw new Error(\`Batch ${'${adjustment.batchNumber}'} failed tenant or branch validation.\`);
      }
      const currentQuantity = Number(data.quantity || 0);
      const nextQuantity = currentQuantity - adjustment.baseDelta;
      if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
        throw new Error(\`Receipt edit would make batch ${'${adjustment.batchNumber}'} negative. Available base units: ${'${currentQuantity}'}.\`);
      }
      transaction.update(batchRefs.get(key), { quantity: nextQuantity, updatedAt: serverTimestamp() });
    }

    for (const [productId, baseDelta] of byProduct) {
      if (baseDelta === 0) continue;
      const snapshot = productSnapshots.get(productId);
      if (!snapshot?.exists()) throw new Error(\`Product ${'${productId}'} no longer exists.\`);
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId) throw new Error('Product tenant mismatch.');
      const currentStock = Number(data.stock || 0);
      const nextStock = currentStock - baseDelta;
      if (!Number.isFinite(nextStock) || nextStock < 0) {
        throw new Error('Product aggregate stock is lower than the requested receipt adjustment. Reconcile inventory before retrying.');
      }
      transaction.update(productRefs.get(productId), { stock: nextStock, updatedAt: serverTimestamp() });
    }

    transaction.update(saleRef, {
      ...input.saleUpdates,
      items: input.updatedItems,
      updatedAt: serverTimestamp()
    });

    transaction.set(revisionRef, {
      id: input.revisionId,
      saleId: input.saleId,
      tenantId: input.tenantId,
      timestamp: nowIso,
      revisedBy: input.actor.name,
      reason: input.reason,
      beforeJson: JSON.stringify(input.originalSale),
      afterJson: JSON.stringify({ ...input.saleUpdates, items: input.updatedItems })
    });

    transaction.set(auditRef, {
      id: input.auditId,
      tenantId: input.tenantId,
      userId: input.actor.uid,
      userName: input.actor.name,
      userRole: input.actor.role || 'unknown',
      module: 'SALES',
      actionType: input.actionType,
      objectAffected: 'SALE',
      objectId: input.saleId,
      receipt_id: input.saleId,
      timestamp: nowIso
    });
  });
}

export async function voidSaleInventoryAtomically(input: VoidSaleInventoryInput): Promise<boolean> {
  if (!input.tenantId || !input.branchId || !input.sale.id) throw new Error('Tenant, branch and sale identifiers are required to void a sale.');
  const productsById = productMap(input.products);
  const batchRefs = await resolveBatchRefs(input.tenantId, input.branchId, input.sale.items);
  const productTotals = new Map<string, number>();
  const batchTotals = new Map<string, number>();

  for (const item of input.sale.items) {
    if (item.isService) continue;
    const product = productsById.get(item.productId);
    if (!product) throw new Error(\`Product ${'${item.productName || item.productId}'} no longer exists.\`);
    const quantity = baseQuantity(item, product);
    const key = stockKey(item.productId, item.batchNumber || 'N/A');
    batchTotals.set(key, (batchTotals.get(key) || 0) + quantity);
    productTotals.set(item.productId, (productTotals.get(item.productId) || 0) + quantity);
  }

  const productRefs = new Map(Array.from(productTotals.keys()).map(productId => [productId, doc(db, 'products', productId)]));
  const saleRef = doc(db, 'sales', input.sale.id);
  const auditRef = doc(db, 'audit_logs', input.auditId);
  const nowIso = new Date().toISOString();
  let changed = false;

  await runTransaction(db, async transaction => {
    const saleSnapshot = await transaction.get(saleRef);
    if (!saleSnapshot.exists()) throw new Error('The sale no longer exists.');
    const currentSale = saleSnapshot.data() as Sale;
    if (currentSale.tenantId !== input.tenantId) throw new Error('Sale tenant mismatch.');
    if ((currentSale.branchId || input.branchId) !== input.branchId) throw new Error('Sale branch mismatch.');
    if (currentSale.status === 'voided') return;
    if (itemFingerprint(currentSale.items || []) !== itemFingerprint(input.sale.items || [])) {
      throw new Error('This receipt changed since it was loaded. Reload it before voiding.');
    }

    const batchSnapshots = new Map();
    for (const [key, ref] of batchRefs) batchSnapshots.set(key, await transaction.get(ref));
    const productSnapshots = new Map();
    for (const [productId, ref] of productRefs) productSnapshots.set(productId, await transaction.get(ref));

    for (const [key, quantity] of batchTotals) {
      const snapshot = batchSnapshots.get(key);
      if (!snapshot?.exists()) throw new Error('A batch required for this void no longer exists.');
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId || data.branchId !== input.branchId) throw new Error('Batch tenant or branch mismatch.');
      transaction.update(batchRefs.get(key), {
        quantity: Number(data.quantity || 0) + quantity,
        updatedAt: serverTimestamp()
      });
    }

    for (const [productId, quantity] of productTotals) {
      const snapshot = productSnapshots.get(productId);
      if (!snapshot?.exists()) throw new Error(\`Product ${'${productId}'} no longer exists.\`);
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId) throw new Error('Product tenant mismatch.');
      transaction.update(productRefs.get(productId), {
        stock: Number(data.stock || 0) + quantity,
        updatedAt: serverTimestamp()
      });
    }

    transaction.update(saleRef, {
      status: 'voided',
      voidReason: input.reason,
      voidedAt: nowIso,
      voidedBy: input.actor.uid,
      updatedAt: serverTimestamp()
    });
    transaction.set(auditRef, {
      id: input.auditId,
      tenantId: input.tenantId,
      userId: input.actor.uid,
      userName: input.actor.name,
      userRole: input.actor.role || 'unknown',
      module: 'SALES',
      actionType: 'VOID',
      objectAffected: 'SALE',
      objectId: input.sale.id,
      receipt_id: input.sale.id,
      timestamp: nowIso
    });
    changed = true;
  });

  return changed;
}
`;

fs.writeFileSync('src/services/saleInventoryIntegrityService.ts', integrityService);
console.log('created: saleInventoryIntegrityService.ts');

const salesFile = 'src/pages/Sales.tsx';
replaceOne(
  salesFile,
  "import { canOperatePos, formatPosCheckoutError } from '../utils/posAuthorization';",
  "import { canOperatePos, formatPosCheckoutError } from '../utils/posAuthorization';\nimport { reviseSaleInventoryAtomically, voidSaleInventoryAtomically } from '../services/saleInventoryIntegrityService';",
  'Sales integrity service import'
);

replaceOne(
  salesFile,
  /    if \(cart\.length === 0\) \{\n      toast\.error\('Cart is empty'\);\n      return;\n    \}\n\n    \/\/ Check if any cart item's price is below cost price of that specific batch/,
  `    if (cart.length === 0) {\n      toast.error('Cart is empty');\n      return;\n    }\n\n    if (!activeBranchId) {\n      toast.error('Select an active branch before processing a sale.');\n      return;\n    }\n\n    // Check if any cart item's price is below cost price of that specific batch`,
  'Checkout active branch guard'
);

replaceOne(
  salesFile,
  /    if \(!canProcessSales\) \{\n      receiptWindow\?\.close\(\);\n      toast\.error\('Your account is not authorised to process sales\.'\);\n      return;\n    \}\n\n    \/\/ Check if any cart item's price is below cost price of that specific batch/,
  `    if (!canProcessSales) {\n      receiptWindow?.close();\n      toast.error('Your account is not authorised to process sales.');\n      return;\n    }\n\n    if (!editingSaleId && !activeBranchId) {\n      receiptWindow?.close();\n      toast.error('Select an active branch before processing a sale.');\n      return;\n    }\n\n    // Check if any cart item's price is below cost price of that specific batch`,
  'Complete sale active branch guard'
);

replaceOne(
  salesFile,
  /      if \(editingSaleId\) \{[\s\S]*?\n      \} else \{\n        const saleDocumentId = checkoutAttemptRef\.current!\.saleId;/,
  `      if (editingSaleId) {\n        const originalSale = sales.find(s => s.id === editingSaleId);\n        if (!originalSale) throw new Error('The receipt being edited is no longer available. Reload the Receipt Ledger.');\n        const editBranchId = originalSale.branchId || activeBranchId;\n        if (!editBranchId) throw new Error('The receipt has no branch assignment and cannot be edited safely.');\n\n        const saleUpdates = {\n          subtotal,\n          taxAmount: totalVatAmount,\n          discountAmount,\n          discountPercentage,\n          total: finalTotal,\n          totalAmount: finalTotal,\n          paymentMethod,\n          secondaryPaymentMethod: isWelfareSplit ? secondaryPaymentMethod : undefined,\n          welfareAmount: paymentMethod === 'staff_welfare' ? (isWelfareSplit ? welfareBalance : totalAmount) : undefined,\n          secondaryAmount: isWelfareSplit ? (totalAmount - welfareBalance) : undefined,\n          context,\n          patientId: selectedPatient?.id || null,\n          patientName: selectedPatient?.full_name || null,\n          institutionId: selectedInstitution?.id || null,\n          institutionName: selectedInstitution?.supplier_name || null,\n          prescriberId: selectedPrescriber?.id || null,\n          prescriberName: selectedPrescriber?.full_name || null,\n          lastEditedAt: new Date().toISOString(),\n          lastEditedBy: profile.uid,\n          isExceptionalConsumption,\n          exceptionalConsumptionReason: isExceptionalConsumption ? exceptionalConsumptionReason : null\n        };\n\n        await reviseSaleInventoryAtomically({\n          tenantId: profile.tenantId,\n          branchId: editBranchId,\n          saleId: editingSaleId,\n          originalSale,\n          updatedItems: itemsWithVat,\n          saleUpdates,\n          products,\n          actor: { uid: profile.uid, name: profile.full_name || 'Unknown', role: profile.role },\n          reason: 'Manual Edit',\n          actionType: 'EDIT',\n          revisionId: generateUUID(),\n          auditId: generateUUID()\n        });\n\n        const updatedSaleData: Sale = {\n          ...originalSale,\n          ...saleUpdates,\n          items: itemsWithVat\n        } as Sale;\n        completedSale = updatedSaleData;\n        stockPostedAtomically = true;\n        try {\n          await logSaleMovements(editingSaleId, originalSale, true, \`sales_\${editingSaleId}\`, profile.uid);\n          await logSaleMovements(editingSaleId, updatedSaleData, false, null, profile.uid);\n        } catch (movementError) {\n          console.warn('Receipt edit completed, but consumption analytics logging will need reconciliation:', movementError);\n        }\n      } else {\n        const saleDocumentId = checkoutAttemptRef.current!.saleId;`,
  'Atomic POS receipt editing'
);

replaceOne(
  salesFile,
  /          tenantId: profile\.tenantId,\n          branchId: activeBranchId \|\| 'main',\n          cashierId: profile\.uid,/,
  `          tenantId: profile.tenantId,\n          branchId: activeBranchId!,\n          cashierId: profile.uid,`,
  'Sale branch fallback removal'
);

replaceOne(
  salesFile,
  "            productDeductions.set(line.product.id, (productDeductions.get(line.product.id) || 0) + line.item.quantity);",
  "            productDeductions.set(line.product.id, (productDeductions.get(line.product.id) || 0) + (line.item.quantity * line.multiplier));",
  'Product aggregate base unit deduction'
);

replaceOne(
  salesFile,
  /              const currentStock = Number\(snapshot\.data\(\)\.stock \|\| 0\);\n              const deduction = productDeductions\.get\(line\.product\.id\)!;\n              transaction\.update\(line\.productRef, \{ stock: Math\.max\(0, currentStock - deduction\), updatedAt: serverTimestamp\(\) \}\);/,
  `              const currentStock = Number(snapshot.data().stock || 0);\n              const deduction = productDeductions.get(line.product.id)!;\n              if (deduction > currentStock) {\n                throw new Error(\`Inventory aggregate mismatch for \${line.item.productName}. Product stock has \${currentStock} base units but the sale requires \${deduction}. Reconcile inventory before retrying.\`);\n              }\n              transaction.update(line.productRef, { stock: currentStock - deduction, updatedAt: serverTimestamp() });`,
  'New sale negative aggregate stock guard'
);

replaceOne(
  salesFile,
  /      \/\/ Adjust inventories in Firestore using net differences to prevent race conditions or duplicate writes[\s\S]*?      await firestoreService\.addDocument\('audit_logs', auditLog\);\n/,
  `      const editBranchId = ledgerEditingSale.branchId || activeBranchId;\n      if (!editBranchId) throw new Error('This receipt has no branch assignment and cannot be edited safely.');\n\n      await reviseSaleInventoryAtomically({\n        tenantId: profile.tenantId,\n        branchId: editBranchId,\n        saleId: ledgerEditingSale.id,\n        originalSale: ledgerEditingSale,\n        updatedItems: updatedItemsWithSpecs,\n        saleUpdates: {\n          subtotal: newSubtotal,\n          taxAmount: totalVatAmount,\n          discountAmount: newDiscountAmount,\n          discountPercentage: editedDiscountPercentage,\n          total: newTotalAmount,\n          totalAmount: newTotalAmount,\n          paymentMethod: editedPaymentMethod,\n          context: editedContext,\n          patientId: editedPatientId || null,\n          patientName: editedPatientName || null,\n          lastEditedAt: new Date().toISOString(),\n          lastEditedBy: profile.uid\n        },\n        products,\n        actor: { uid: profile.uid, name: profile.full_name || 'Unknown', role: profile.role },\n        reason: 'Ledger Direct Edit',\n        actionType: 'EDIT_IN_LEDGER',\n        revisionId: generateUUID(),\n        auditId: generateUUID()\n      });\n`,
  'Atomic direct ledger receipt editing'
);

replaceOne(
  salesFile,
  /            try \{\n              \/\/ Log reversal movements[\s\S]*?              toast\.success\('Sale voided successfully'\);/,
  `            try {\n              if (!profile?.tenantId) throw new Error('A tenant profile is required to void this sale.');\n              const voidBranchId = sale.branchId || activeBranchId;\n              if (!voidBranchId) throw new Error('This receipt has no branch assignment and cannot be voided safely.');\n\n              const changed = await voidSaleInventoryAtomically({\n                tenantId: profile.tenantId,\n                branchId: voidBranchId,\n                sale,\n                products,\n                actor: {\n                  uid: profile.uid || 'unknown',\n                  name: profile.full_name || 'unknown',\n                  role: profile.role\n                },\n                reason,\n                auditId: generateUUID()\n              });\n\n              if (changed) {\n                try {\n                  await logSaleMovements(saleId, sale, true, \`sales_\${saleId}\`, profile.uid || 'system');\n                } catch (movementError) {\n                  console.warn('Sale voided, but consumption analytics reversal needs reconciliation:', movementError);\n                }\n              }\n\n              toast.success(changed ? 'Sale voided successfully' : 'Sale was already voided');`,
  'Atomic sale void stock restoration'
);

const hqFile = 'src/services/hqStockReceiptService.ts';
replaceOne(
  hqFile,
  /export async function receiveHqTransfer\(input: ReceiveHqTransferInput\): Promise<void> \{[\s\S]*?\n\}\n$/,
  `export async function receiveHqTransfer(input: ReceiveHqTransferInput): Promise<void> {\n  const { tenantId, transfer, lines, user } = input;\n  if (!transfer.id || transfer.destination_branch_id !== 'HQ') {\n    throw new Error('This shipment is not assigned to the HQ store.');\n  }\n  if (!lines.length) throw new Error('This shipment has no product lines and cannot be received.');\n\n  const transferRef = doc(db, 'transfer_invoices', transfer.id);\n  const claimTimeoutMs = 10 * 60 * 1000;\n  let claimed = false;\n  try {\n    await runTransaction(db, async transaction => {\n      const snapshot = await transaction.get(transferRef);\n      if (!snapshot.exists()) throw new Error('The shipment no longer exists.');\n      const current = snapshot.data();\n      if (current.tenantId !== tenantId) throw new Error('The shipment belongs to another tenant.');\n      if (['fully_accepted', 'received', 'queried'].includes(current.status)) {\n        throw new Error('This shipment has already been received. No stock was added again.');\n      }\n\n      if (current.status === 'receiving') {\n        const claimedAt = Date.parse(String(current.reception_claimed_at || ''));\n        const claimIsFresh = Number.isFinite(claimedAt) && Date.now() - claimedAt < claimTimeoutMs;\n        if (claimIsFresh) throw new Error('This shipment is already being received by another session.');\n      } else if (current.status !== 'dispatched') {\n        throw new Error('Only a dispatched shipment can be received.');\n      }\n\n      if (isHqProcurementDelivery({ id: snapshot.id, ...current } as TransferInvoice) && current.order_id) {\n        const orderSnapshot = await transaction.get(doc(db, 'stock_orders', current.order_id));\n        if (orderSnapshot.exists() && orderSnapshot.data().status === 'fully_received') {\n          throw new Error('This older HQ order is already marked received. Stock was not added again; reconcile the legacy dispatch before closing it.');\n        }\n      }\n      transaction.update(transferRef, {\n        status: 'receiving',\n        reception_claimed_by: user.uid,\n        reception_claimed_at: new Date().toISOString()\n      });\n    });\n    claimed = true;\n\n    const existing = await Promise.all(lines.map(line =>\n      firestoreService.getDocumentsByQuery<ProductBatch>('product_batches', [\n        { field: 'tenantId', operator: '==', value: tenantId },\n        { field: 'branchId', operator: '==', value: 'HQ' },\n        { field: 'productId', operator: '==', value: line.product_id },\n        { field: 'batchNumber', operator: '==', value: line.batch_number || 'UNSPECIFIED' }\n      ])\n    ));\n\n    const uniqueProductIds = Array.from(new Set(lines.filter(line => Number(line.qty_dispatched || 0) > 0).map(line => line.product_id)));\n    const productDocs = await Promise.all(uniqueProductIds.map(productId => firestoreService.getDocument<any>('products', productId)));\n    productDocs.forEach((product, index) => {\n      if (!product) throw new Error(\`Product \${uniqueProductIds[index]} no longer exists.\`);\n      if (product.tenantId !== tenantId) throw new Error('Product tenant mismatch during HQ receipt.');\n    });\n\n    lines.forEach((line, index) => {\n      const existingBatch = existing[index][0];\n      if (!existingBatch) return;\n      const incomingExpiry = String(line.expiry_date || '').trim();\n      const existingExpiry = String(existingBatch.expiryDate || '').trim();\n      if (incomingExpiry && existingExpiry && incomingExpiry !== existingExpiry) {\n        throw new Error(\`Batch identity conflict for \${line.product_name || line.product_id} batch \${line.batch_number}. Existing expiry is \${existingExpiry}, incoming expiry is \${incomingExpiry}.\`);\n      }\n    });\n\n    const now = new Date().toISOString();\n    const batch = writeBatch(db);\n    const productIncrements = new Map<string, number>();\n    const stablePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);\n\n    lines.forEach((line, index) => {\n      const quantity = Number(line.qty_dispatched || 0);\n      if (quantity <= 0) return;\n      const existingBatch = existing[index][0];\n      if (existingBatch) {\n        batch.update(doc(db, 'product_batches', existingBatch.id), {\n          quantity: increment(quantity),\n          lastUpdated: now,\n          updatedAt: now\n        });\n      } else {\n        const deterministicBatchId = stablePart(\`hq_\${tenantId}_\${line.product_id}_\${line.batch_number || 'UNSPECIFIED'}_\${line.expiry_date || 'NOEXP'}\`);\n        batch.set(doc(db, 'product_batches', deterministicBatchId), {\n          tenantId,\n          branchId: 'HQ',\n          productId: line.product_id,\n          batchNumber: line.batch_number || 'UNSPECIFIED',\n          expiryDate: line.expiry_date || '',\n          quantity: increment(quantity),\n          purchasePrice: Number(line.unit_cost_ugx || 0),\n          sellingPrice: Number(line.unit_cost_ugx || 0) * 1.3,\n          batch_status: 'active',\n          sourceType: isHqProcurementDelivery(transfer) ? 'procurement' : 'transfer',\n          createdAt: now,\n          lastUpdated: now,\n          updatedAt: now\n        }, { merge: true });\n      }\n      productIncrements.set(line.product_id, (productIncrements.get(line.product_id) || 0) + quantity);\n      batch.update(doc(db, 'transfer_invoice_lines', line.id), {\n        qty_received: quantity,\n        qty_accepted: quantity,\n        line_status: 'received',\n        updatedAt: now\n      });\n    });\n\n    productIncrements.forEach((quantity, productId) => {\n      batch.update(doc(db, 'products', productId), {\n        stock: increment(quantity),\n        updatedAt: now\n      });\n    });\n\n    batch.update(transferRef, {\n      status: 'fully_accepted',\n      accepted_at: now,\n      received_at: now,\n      received_by: user.uid,\n      received_by_name: user.name,\n      reception_claimed_by: null,\n      reception_claimed_at: null,\n      updatedAt: now\n    });\n    const orderId = (transfer as any).order_id;\n    const grnId = (transfer as any).grn_id;\n    if (orderId) {\n      batch.update(doc(db, 'stock_orders', orderId), {\n        status: 'fully_received',\n        received_at: now,\n        received_by: user.uid,\n        updatedAt: now\n      });\n    }\n    if (grnId) {\n      batch.update(doc(db, 'grn_records', grnId), {\n        reception_status: 'received',\n        receivedAt: now,\n        receivedBy: user.uid,\n        updatedAt: now\n      });\n    }\n    batch.set(doc(db, 'global_audit_logs', \`hq_receipt_\${transfer.id}\`), {\n      tenantId,\n      action: 'HQ_STOCK_RECEIPT_CONFIRMED',\n      category: 'INVENTORY',\n      referenceId: transfer.id,\n      grnId: grnId || null,\n      orderId: orderId || null,\n      actorId: user.uid,\n      actor: user.name,\n      timestamp: now,\n      itemCount: lines.length\n    }, { merge: true });\n    await batch.commit();\n  } catch (error) {\n    if (claimed) {\n      try {\n        await runTransaction(db, async transaction => {\n          const snapshot = await transaction.get(transferRef);\n          if (snapshot.exists() && snapshot.data().status === 'receiving' && snapshot.data().reception_claimed_by === user.uid) {\n            transaction.update(transferRef, {\n              status: 'dispatched',\n              reception_claimed_by: null,\n              reception_claimed_at: null\n            });\n          }\n        });\n      } catch (rollbackError) {\n        console.error('Failed to release HQ receipt claim', rollbackError);\n      }\n    }\n    throw error;\n  }\n}\n`,
  'HQ receipt atomic aggregate and stale claim hardening'
);

const networkFile = 'src/services/networkFulfilmentService.ts';
replaceOne(
  networkFile,
  /export async function createTransferReservationTx\(params: \{[\s\S]*?\n\}\n\n\/\*\*\n \* Scheduled or lazy cleanup of expired reservations\./,
  `export async function createTransferReservationTx(params: {\n  tenantId: string;\n  sourceBranchId: string;\n  destinationBranchId: string;\n  productId: string;\n  autoGenerateRunId: string;\n  qtyBaseUnits: number;\n  createdBy: string;\n  reservationTtlMinutes?: number;\n}): Promise<string> {\n  const {\n    tenantId,\n    sourceBranchId,\n    destinationBranchId,\n    productId,\n    autoGenerateRunId,\n    qtyBaseUnits,\n    createdBy,\n    reservationTtlMinutes = 30\n  } = params;\n\n  if (!tenantId || !sourceBranchId || !destinationBranchId || !productId || !autoGenerateRunId) {\n    throw new Error('Tenant, source, destination, product and order run are required for a transfer reservation.');\n  }\n  if (!Number.isFinite(qtyBaseUnits) || qtyBaseUnits <= 0) throw new Error('Reservation quantity must be greater than zero.');\n\n  const stablePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);\n  const reservationId = stablePart(\`reservation_\${tenantId}_\${autoGenerateRunId}_\${sourceBranchId}_\${destinationBranchId}_\${productId}\`);\n  const lockId = stablePart(\`lock_\${tenantId}_\${sourceBranchId}_\${productId}\`);\n  const reservationRef = doc(db, 'inventoryTransferReservations', reservationId);\n  const lockRef = doc(db, 'inventoryTransferReservations', lockId);\n\n  await runTransaction(db, async transaction => {\n    const [lockSnapshot, existingReservation] = await Promise.all([\n      transaction.get(lockRef),\n      transaction.get(reservationRef)\n    ]);\n\n    const now = new Date();\n    const nowIso = now.toISOString();\n    if (existingReservation.exists()) {\n      const existing = existingReservation.data() as InventoryTransferReservation;\n      if (existing.tenantId !== tenantId) throw new Error('Reservation ID collision across tenants.');\n      if (existing.status === 'CONVERTED') return;\n      if (['PENDING', 'ACTIVE'].includes(existing.status) && existing.expiresAt > nowIso) return;\n    }\n\n    // The lock document serializes reservation creators for one source/product.\n    // Queries are re-run when Firestore retries the transaction after lock contention.\n    const activeReservationsSnap = await getDocs(query(\n      collection(db, 'inventoryTransferReservations'),\n      where('tenantId', '==', tenantId),\n      where('sourceBranchId', '==', sourceBranchId),\n      where('productId', '==', productId),\n      where('status', 'in', ['PENDING', 'ACTIVE'])\n    ));\n\n    const batchesSnap = await getDocs(query(\n      collection(db, 'product_batches'),\n      where('tenantId', '==', tenantId),\n      where('branchId', '==', sourceBranchId),\n      where('productId', '==', productId)\n    ));\n    if (batchesSnap.empty) throw new Error('No stock batches exist at the selected source branch.');\n\n    const batchSnapshots = await Promise.all(batchesSnap.docs.map(batchDoc => transaction.get(batchDoc.ref)));\n    let totalUsable = 0;\n    batchSnapshots.forEach(snapshot => {\n      if (!snapshot.exists()) return;\n      const batch = snapshot.data();\n      const status = String(batch.batch_status || '').toLowerCase();\n      const expiryMs = batch.expiryDate ? new Date(\`${'${batch.expiryDate}'}T23:59:59\`).getTime() : Number.POSITIVE_INFINITY;\n      if (['quarantined', 'expired', 'recalled', 'blocked'].includes(status)) return;\n      if (Number.isFinite(expiryMs) && expiryMs <= now.getTime()) return;\n      totalUsable += Math.max(0, Number(batch.quantity || 0));\n    });\n\n    let currentReserved = 0;\n    activeReservationsSnap.forEach(reservationDoc => {\n      if (reservationDoc.id === reservationId) return;\n      const reservation = reservationDoc.data() as InventoryTransferReservation;\n      if (reservation.expiresAt > nowIso) currentReserved += Math.max(0, Number(reservation.reservedQuantityBaseUnits || 0));\n    });\n\n    const available = Math.max(0, totalUsable - currentReserved);\n    if (available < qtyBaseUnits) {\n      throw new Error(\`Insufficient stock available at source branch: \${available} base units available after active reservations, \${qtyBaseUnits} requested.\`);\n    }\n\n    const expiresAt = new Date(now.getTime() + reservationTtlMinutes * 60 * 1000).toISOString();\n    transaction.set(lockRef, {\n      tenantId,\n      sourceBranchId,\n      productId,\n      status: 'LOCK',\n      isReservationLock: true,\n      version: Number(lockSnapshot.exists() ? lockSnapshot.data().version || 0 : 0) + 1,\n      updatedAt: nowIso\n    }, { merge: true });\n\n    transaction.set(reservationRef, {\n      tenantId,\n      sourceBranchId,\n      destinationBranchId,\n      productId,\n      batchId: null,\n      autoGenerateRunId,\n      requestedQuantityBaseUnits: qtyBaseUnits,\n      reservedQuantityBaseUnits: qtyBaseUnits,\n      status: 'ACTIVE',\n      createdBy,\n      createdAt: existingReservation.exists() ? existingReservation.data().createdAt || nowIso : nowIso,\n      updatedAt: nowIso,\n      expiresAt,\n      convertedTransferRequestId: null\n    }, { merge: true });\n  });\n\n  return reservationRef.id;\n}\n\n/**\n * Scheduled or lazy cleanup of expired reservations.`,
  'Serialized and idempotent transfer reservation creation'
);

console.log('Batch 1 source patch complete.');
