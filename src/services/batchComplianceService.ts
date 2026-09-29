import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type { Product, ProductBatch } from '../types';

export interface QuarantinedInventoryBatch {
  id: string;
  productId: string;
  branchId: string;
  batchNumber: string;
  quantity: number;
}

function snapshotBatch(id: string, data: ProductBatch): QuarantinedInventoryBatch {
  return {
    id,
    productId: data.productId,
    branchId: data.branchId,
    batchNumber: data.batchNumber,
    quantity: Math.max(0, Number(data.quantity || 0))
  };
}

export async function quarantineInventoryBatch(params: {
  tenantId: string;
  branchId: string;
  productId: string;
  batchNumber: string;
  batchId?: string | null;
}): Promise<QuarantinedInventoryBatch> {
  let match: { id: string; data: ProductBatch } | null = null;
  if (params.batchId) {
    const snap = await getDoc(doc(db, 'product_batches', params.batchId));
    if (snap.exists()) match = { id: snap.id, data: snap.data() as ProductBatch };
  }
  if (!match) {
    const snap = await getDocs(query(collection(db, 'product_batches'), where('productId', '==', params.productId)));
    const row = snap.docs.find(candidate => {
      const data = candidate.data() as ProductBatch;
      return data.tenantId === params.tenantId
        && data.branchId === params.branchId
        && String(data.batchNumber || '') === params.batchNumber;
    });
    if (row) match = { id: row.id, data: row.data() as ProductBatch };
  }
  if (!match
    || match.data.tenantId !== params.tenantId
    || match.data.branchId !== params.branchId
    || match.data.productId !== params.productId
    || String(match.data.batchNumber || '') !== params.batchNumber) {
    throw new Error('The selected quarantine line no longer matches an Inventory batch in this branch.');
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'product_batches', match.id), {
    batch_status: 'quarantined',
    lastUpdated: new Date().toISOString()
  });
  await batch.commit();
  return snapshotBatch(match.id, match.data);
}

async function resolveRecallProductId(tenantId: string, productId: string | undefined, productName: string): Promise<string> {
  if (productId && productId !== 'manual-entry' && productId !== 'N/A') return productId;
  const productsSnap = await getDocs(query(collection(db, 'products'), where('tenantId', '==', tenantId)));
  const normalizedName = productName.trim().toLowerCase();
  const matches = productsSnap.docs.filter(row => String((row.data() as Product).name || '').trim().toLowerCase() === normalizedName);
  if (matches.length !== 1) {
    throw new Error('Recall must resolve to exactly one Inventory product before its batch can be quarantined.');
  }
  return matches[0].id;
}

export async function quarantineRecallBatches(params: {
  tenantId: string;
  productId?: string;
  productName: string;
  batchNumber: string;
}): Promise<{ productId: string; batches: QuarantinedInventoryBatch[]; totalQuantity: number }> {
  const productId = await resolveRecallProductId(params.tenantId, params.productId, params.productName);
  const snap = await getDocs(query(collection(db, 'product_batches'), where('productId', '==', productId)));
  const matches = snap.docs
    .map(row => ({ id: row.id, data: row.data() as ProductBatch }))
    .filter(row => row.data.tenantId === params.tenantId && String(row.data.batchNumber || '') === params.batchNumber);
  if (matches.length === 0) throw new Error('No Inventory batch matches this recall.');

  const writer = writeBatch(db);
  for (const row of matches) {
    writer.update(doc(db, 'product_batches', row.id), {
      batch_status: 'quarantined',
      lastUpdated: new Date().toISOString()
    });
  }
  await writer.commit();
  const batches = matches.map(row => snapshotBatch(row.id, row.data));
  return {
    productId,
    batches,
    totalQuantity: batches.reduce((sum, row) => sum + row.quantity, 0)
  };
}
