import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentReference
} from 'firebase/firestore';
import { db } from '../firebase';
import { Product, Sale, SaleItem } from '../types';
import { getBaseUnitMultiplier } from './consumptionService';
import {
  assertExactStoredAllocations,
  getStoredBaseQuantity,
  saleItemFingerprint
} from './saleTierHistoryService';
import {
  planSaleInventoryRevision,
  type RevisionBatchState
} from './saleInventoryRevisionPlanner';

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

const stockKey = (productId: string, batchNumber: string) => `${productId}::${batchNumber}`;

function productMap(products: Product[]) {
  return new Map(products.map(product => [product.id, product]));
}

function legacyBaseQuantity(item: SaleItem, product: Product): number {
  const quantity = Number(item.quantity || 0);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Sale item quantity is invalid.');

  const explicitBaseQuantity = Number(item.baseQuantity);
  if (Number.isFinite(explicitBaseQuantity) && explicitBaseQuantity >= 0) return explicitBaseQuantity;

  const snapshotMultiplier = Number(item.tierMultiplier ?? (item as any).multiplier);
  const multiplier = Number.isFinite(snapshotMultiplier) && snapshotMultiplier > 0
    ? snapshotMultiplier
    : getBaseUnitMultiplier(product);
  return quantity * multiplier;
}

function usesExactAllocationHistory(items: SaleItem[]): boolean {
  return items.some(item => !item.isService && (Boolean(item.tierCode) || Boolean(item.batchAllocations?.length)));
}

async function resolveLegacyBatchRefs(
  tenantId: string,
  branchId: string,
  items: SaleItem[]
): Promise<Map<string, DocumentReference>> {
  const refs = new Map<string, DocumentReference>();
  const unique = new Map<string, SaleItem>();

  for (const item of items) {
    if (item.isService) continue;
    const batchNumber = item.batchNumber || 'N/A';
    if (batchNumber === 'N/A') throw new Error(`Batch number is missing for ${item.productName || item.productId}.`);
    unique.set(stockKey(item.productId, batchNumber), item);
  }

  for (const [key, item] of unique) {
    const batchId = String(item.batchId || '').trim();
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

    if (snapshots.empty) throw new Error(`Batch ${item.batchNumber} for ${item.productName || item.productId} no longer exists.`);
    if (snapshots.size > 1) {
      throw new Error(`Inventory integrity check found duplicate batch records for ${item.productName || item.productId} batch ${item.batchNumber}. Reconcile the duplicate batches before editing this receipt.`);
    }
    refs.set(key, snapshots.docs[0].ref);
  }

  return refs;
}

function buildLegacyAdjustments(
  originalItems: SaleItem[],
  updatedItems: SaleItem[],
  productsById: Map<string, Product>
) {
  const byBatch = new Map<string, StockAdjustment>();
  const byProduct = new Map<string, number>();

  const apply = (item: SaleItem, sign: 1 | -1) => {
    if (item.isService) return;
    const product = productsById.get(item.productId);
    if (!product) throw new Error(`Product ${item.productName || item.productId} no longer exists in the current tenant catalogue.`);
    const qty = legacyBaseQuantity(item, product) * sign;
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

async function collectExactBatchRefs(
  tenantId: string,
  branchId: string,
  productIds: string[],
  originalItems: SaleItem[]
): Promise<Map<string, DocumentReference>> {
  const refs = new Map<string, DocumentReference>();

  for (const productId of productIds) {
    const snapshots = await getDocs(query(
      collection(db, 'product_batches'),
      where('tenantId', '==', tenantId),
      where('branchId', '==', branchId),
      where('productId', '==', productId)
    ));
    snapshots.docs.forEach(snapshot => refs.set(snapshot.id, snapshot.ref));
  }

  for (const item of originalItems) {
    if (item.isService) continue;
    for (const allocation of item.batchAllocations || []) {
      const batchId = String(allocation.batchId || '').trim();
      if (batchId && !refs.has(batchId)) refs.set(batchId, doc(db, 'product_batches', batchId));
    }
    const directBatchId = String(item.batchId || '').trim();
    if (directBatchId && !refs.has(directBatchId)) refs.set(directBatchId, doc(db, 'product_batches', directBatchId));
  }

  return refs;
}

async function reviseSaleWithExactAllocations(input: ReviseSaleInventoryInput): Promise<void> {
  const productsById = productMap(input.products);
  const productIds = Array.from(new Set(
    [...(input.originalSale.items || []), ...(input.updatedItems || [])]
      .filter(item => !item.isService)
      .map(item => item.productId)
  ));
  const batchRefs = await collectExactBatchRefs(input.tenantId, input.branchId, productIds, input.originalSale.items || []);
  const productRefs = new Map(productIds.map(productId => [productId, doc(db, 'products', productId)] as const));
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
    if (saleItemFingerprint(currentSale.items || []) !== saleItemFingerprint(input.originalSale.items || [])) {
      throw new Error('This receipt changed in another session. Reload the Receipt Ledger before editing it again.');
    }

    const batchSnapshots = new Map<string, any>();
    for (const [batchId, ref] of batchRefs) batchSnapshots.set(batchId, await transaction.get(ref));
    const productSnapshots = new Map<string, any>();
    for (const [productId, ref] of productRefs) productSnapshots.set(productId, await transaction.get(ref));

    const batchStates: RevisionBatchState[] = [];
    for (const [batchId, snapshot] of batchSnapshots) {
      if (!snapshot.exists()) {
        const referenced = (input.originalSale.items || []).some(item =>
          (item.batchAllocations || []).some(allocation => allocation.batchId === batchId) || item.batchId === batchId
        );
        if (referenced) throw new Error('A historical batch required for this receipt revision no longer exists.');
        continue;
      }
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId || data.branchId !== input.branchId) throw new Error('Batch tenant or branch mismatch.');
      if (!productRefs.has(data.productId)) continue;
      batchStates.push({
        id: batchId,
        tenantId: data.tenantId,
        branchId: data.branchId,
        productId: data.productId,
        batchNumber: data.batchNumber || 'UNSPECIFIED',
        expiryDate: data.expiryDate,
        batchStatus: data.batch_status,
        quantity: Number(data.quantity || 0),
        costPerBaseUnit: Math.max(0, Number(data.purchasePrice || 0))
      });
    }

    for (const [productId, snapshot] of productSnapshots) {
      if (!snapshot.exists()) throw new Error(`Product ${productId} no longer exists.`);
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId) throw new Error('Product tenant mismatch.');
    }

    const plan = planSaleInventoryRevision({
      originalItems: input.originalSale.items || [],
      updatedItems: input.updatedItems,
      products: productsById,
      batches: batchStates,
      tenantId: input.tenantId,
      branchId: input.branchId,
      discountPercentage: Number(input.saleUpdates.discountPercentage ?? input.originalSale.discountPercentage ?? 0)
    });

    for (const batchState of batchStates) {
      const nextQuantity = plan.batchNextQuantities.get(batchState.id);
      if (nextQuantity === undefined || Math.abs(nextQuantity - batchState.quantity) < 0.0001) continue;
      if (!Number.isFinite(nextQuantity) || nextQuantity < 0) throw new Error(`Receipt edit would make batch ${batchState.batchNumber} negative.`);
      transaction.update(batchRefs.get(batchState.id)!, { quantity: nextQuantity, updatedAt: serverTimestamp() });
    }

    for (const [productId, baseDelta] of plan.productBaseDeltas) {
      if (Math.abs(baseDelta) < 0.0001) continue;
      const snapshot = productSnapshots.get(productId);
      const data = snapshot.data();
      const currentStock = Number(data.stock || 0);
      const nextStock = currentStock - baseDelta;
      if (!Number.isFinite(nextStock) || nextStock < 0) {
        throw new Error('Product aggregate stock is lower than the requested receipt adjustment. Reconcile inventory before retrying.');
      }
      transaction.update(productRefs.get(productId)!, { stock: nextStock, updatedAt: serverTimestamp() });
    }

    transaction.update(saleRef, {
      ...input.saleUpdates,
      items: plan.finalItems,
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
      afterJson: JSON.stringify({ ...input.saleUpdates, items: plan.finalItems })
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

async function reviseLegacySale(input: ReviseSaleInventoryInput): Promise<void> {
  const productsById = productMap(input.products);
  const allItems = [...input.originalSale.items, ...input.updatedItems];
  const batchRefs = await resolveLegacyBatchRefs(input.tenantId, input.branchId, allItems);
  const { byBatch, byProduct } = buildLegacyAdjustments(input.originalSale.items, input.updatedItems, productsById);
  const productRefs = new Map(Array.from(byProduct.keys()).map(productId => [productId, doc(db, 'products', productId)] as const));
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
    if (saleItemFingerprint(currentSale.items || []) !== saleItemFingerprint(input.originalSale.items || [])) {
      throw new Error('This receipt changed in another session. Reload the Receipt Ledger before editing it again.');
    }

    const batchSnapshots = new Map<string, any>();
    for (const [key, ref] of batchRefs) batchSnapshots.set(key, await transaction.get(ref));
    const productSnapshots = new Map<string, any>();
    for (const [productId, ref] of productRefs) productSnapshots.set(productId, await transaction.get(ref));

    for (const [key, adjustment] of byBatch) {
      if (adjustment.baseDelta === 0) continue;
      const snapshot = batchSnapshots.get(key);
      if (!snapshot?.exists()) throw new Error(`Batch ${adjustment.batchNumber} no longer exists.`);
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId || data.branchId !== input.branchId || data.productId !== adjustment.productId) {
        throw new Error(`Batch ${adjustment.batchNumber} failed tenant or branch validation.`);
      }
      const currentQuantity = Number(data.quantity || 0);
      const nextQuantity = currentQuantity - adjustment.baseDelta;
      if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
        throw new Error(`Receipt edit would make batch ${adjustment.batchNumber} negative. Available base units: ${currentQuantity}.`);
      }
      transaction.update(batchRefs.get(key)!, { quantity: nextQuantity, updatedAt: serverTimestamp() });
    }

    for (const [productId, baseDelta] of byProduct) {
      if (baseDelta === 0) continue;
      const snapshot = productSnapshots.get(productId);
      if (!snapshot?.exists()) throw new Error(`Product ${productId} no longer exists.`);
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId) throw new Error('Product tenant mismatch.');
      const currentStock = Number(data.stock || 0);
      const nextStock = currentStock - baseDelta;
      if (!Number.isFinite(nextStock) || nextStock < 0) {
        throw new Error('Product aggregate stock is lower than the requested receipt adjustment. Reconcile inventory before retrying.');
      }
      transaction.update(productRefs.get(productId)!, { stock: nextStock, updatedAt: serverTimestamp() });
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

export async function reviseSaleInventoryAtomically(input: ReviseSaleInventoryInput): Promise<void> {
  if (!input.tenantId || !input.branchId || !input.saleId) throw new Error('Tenant, branch and sale identifiers are required for receipt revision.');
  if (input.updatedItems.length === 0) throw new Error('A receipt must contain at least one item.');

  const exactMode = usesExactAllocationHistory([...(input.originalSale.items || []), ...(input.updatedItems || [])]);
  if (exactMode) {
    await reviseSaleWithExactAllocations(input);
    return;
  }
  await reviseLegacySale(input);
}

async function voidSaleWithExactAllocations(input: VoidSaleInventoryInput): Promise<boolean> {
  const productsById = productMap(input.products);
  const batchTotals = new Map<string, number>();
  const batchNumbers = new Map<string, string>();
  const productTotals = new Map<string, number>();

  for (const item of input.sale.items || []) {
    if (item.isService) continue;
    const product = productsById.get(item.productId);
    if (!product) throw new Error(`Product ${item.productName || item.productId} no longer exists.`);
    const allocations = assertExactStoredAllocations(item, product);
    for (const allocation of allocations) {
      batchTotals.set(allocation.batchId, (batchTotals.get(allocation.batchId) || 0) + allocation.baseQuantity);
      batchNumbers.set(allocation.batchId, allocation.batchNumber);
    }
    productTotals.set(item.productId, (productTotals.get(item.productId) || 0) + getStoredBaseQuantity(item, product));
  }

  const batchRefs = new Map(Array.from(batchTotals.keys()).map(batchId => [batchId, doc(db, 'product_batches', batchId)] as const));
  const productRefs = new Map(Array.from(productTotals.keys()).map(productId => [productId, doc(db, 'products', productId)] as const));
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
    if (saleItemFingerprint(currentSale.items || []) !== saleItemFingerprint(input.sale.items || [])) {
      throw new Error('This receipt changed since it was loaded. Reload it before voiding.');
    }

    const batchSnapshots = new Map<string, any>();
    for (const [batchId, ref] of batchRefs) batchSnapshots.set(batchId, await transaction.get(ref));
    const productSnapshots = new Map<string, any>();
    for (const [productId, ref] of productRefs) productSnapshots.set(productId, await transaction.get(ref));

    for (const [batchId, quantity] of batchTotals) {
      const snapshot = batchSnapshots.get(batchId);
      if (!snapshot?.exists()) throw new Error(`Historical batch ${batchNumbers.get(batchId) || batchId} no longer exists.`);
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId || data.branchId !== input.branchId) throw new Error('Batch tenant or branch mismatch.');
      transaction.update(batchRefs.get(batchId)!, {
        quantity: Number(data.quantity || 0) + quantity,
        updatedAt: serverTimestamp()
      });
    }

    for (const [productId, quantity] of productTotals) {
      const snapshot = productSnapshots.get(productId);
      if (!snapshot?.exists()) throw new Error(`Product ${productId} no longer exists.`);
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId) throw new Error('Product tenant mismatch.');
      transaction.update(productRefs.get(productId)!, {
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

async function voidLegacySale(input: VoidSaleInventoryInput): Promise<boolean> {
  const productsById = productMap(input.products);
  const batchRefs = await resolveLegacyBatchRefs(input.tenantId, input.branchId, input.sale.items);
  const productTotals = new Map<string, number>();
  const batchTotals = new Map<string, number>();

  for (const item of input.sale.items) {
    if (item.isService) continue;
    const product = productsById.get(item.productId);
    if (!product) throw new Error(`Product ${item.productName || item.productId} no longer exists.`);
    const quantity = legacyBaseQuantity(item, product);
    const key = stockKey(item.productId, item.batchNumber || 'N/A');
    batchTotals.set(key, (batchTotals.get(key) || 0) + quantity);
    productTotals.set(item.productId, (productTotals.get(item.productId) || 0) + quantity);
  }

  const productRefs = new Map(Array.from(productTotals.keys()).map(productId => [productId, doc(db, 'products', productId)] as const));
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
    if (saleItemFingerprint(currentSale.items || []) !== saleItemFingerprint(input.sale.items || [])) {
      throw new Error('This receipt changed since it was loaded. Reload it before voiding.');
    }

    const batchSnapshots = new Map<string, any>();
    for (const [key, ref] of batchRefs) batchSnapshots.set(key, await transaction.get(ref));
    const productSnapshots = new Map<string, any>();
    for (const [productId, ref] of productRefs) productSnapshots.set(productId, await transaction.get(ref));

    for (const [key, quantity] of batchTotals) {
      const snapshot = batchSnapshots.get(key);
      if (!snapshot?.exists()) throw new Error('A batch required for this void no longer exists.');
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId || data.branchId !== input.branchId) throw new Error('Batch tenant or branch mismatch.');
      transaction.update(batchRefs.get(key)!, {
        quantity: Number(data.quantity || 0) + quantity,
        updatedAt: serverTimestamp()
      });
    }

    for (const [productId, quantity] of productTotals) {
      const snapshot = productSnapshots.get(productId);
      if (!snapshot?.exists()) throw new Error(`Product ${productId} no longer exists.`);
      const data = snapshot.data();
      if (data.tenantId !== input.tenantId) throw new Error('Product tenant mismatch.');
      transaction.update(productRefs.get(productId)!, {
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

export async function voidSaleInventoryAtomically(input: VoidSaleInventoryInput): Promise<boolean> {
  if (!input.tenantId || !input.branchId || !input.sale.id) throw new Error('Tenant, branch and sale identifiers are required to void a sale.');
  if (usesExactAllocationHistory(input.sale.items || [])) return voidSaleWithExactAllocations(input);
  return voidLegacySale(input);
}
