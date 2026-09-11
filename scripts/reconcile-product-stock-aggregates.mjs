import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const tenantArgIndex = process.argv.indexOf('--tenant');
const TENANT_ID = tenantArgIndex >= 0 ? String(process.argv[tenantArgIndex + 1] || '').trim() : '';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';

if (!TENANT_ID) {
  console.error('Usage: node scripts/reconcile-product-stock-aggregates.mjs --tenant <tenantId> [--apply]');
  process.exit(2);
}

const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID });
const db = DATABASE_ID && DATABASE_ID !== '(default)'
  ? getFirestore(app, DATABASE_ID)
  : getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const stats = {
  products: 0,
  batches: 0,
  mismatches: 0,
  wouldRepair: 0,
  repaired: 0,
  invalidBatchQuantities: 0,
  orphanBatchProducts: 0
};

console.log(`[stock-reconcile] mode=${APPLY ? 'APPLY' : 'DRY_RUN'} project=${PROJECT_ID} database=${DATABASE_ID} tenant=${TENANT_ID}`);

const [productsSnap, batchesSnap] = await Promise.all([
  db.collection('products').where('tenantId', '==', TENANT_ID).get(),
  db.collection('product_batches').where('tenantId', '==', TENANT_ID).get()
]);

stats.products = productsSnap.size;
stats.batches = batchesSnap.size;

const products = new Map(productsSnap.docs.map(doc => [doc.id, { ref: doc.ref, data: doc.data() }]));
const totals = new Map();

for (const batchDoc of batchesSnap.docs) {
  const data = batchDoc.data();
  const productId = String(data.productId || '').trim();
  if (!productId || !products.has(productId)) {
    stats.orphanBatchProducts += 1;
    console.log(`[orphan batch] batch=${batchDoc.id} productId=${productId || '(missing)'}`);
    continue;
  }

  const quantity = Number(data.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0) {
    stats.invalidBatchQuantities += 1;
    console.log(`[invalid batch quantity] batch=${batchDoc.id} product=${productId} quantity=${data.quantity}`);
    continue;
  }

  totals.set(productId, (totals.get(productId) || 0) + quantity);
}

const repairs = [];
for (const [productId, product] of products.entries()) {
  const batchTotal = Number(totals.get(productId) || 0);
  const currentStock = Number(product.data.stock ?? 0);
  const currentLegacy = Number(product.data.quantityInStock ?? 0);
  const stockMismatch = !Number.isFinite(currentStock) || Math.abs(currentStock - batchTotal) > 0.0001;
  const legacyMismatch = !Number.isFinite(currentLegacy) || Math.abs(currentLegacy - batchTotal) > 0.0001;

  if (!stockMismatch && !legacyMismatch) continue;

  stats.mismatches += 1;
  repairs.push({ productId, ref: product.ref, batchTotal, currentStock, currentLegacy, name: product.data.name || product.data.productName || '' });
  console.log(`[mismatch] product=${productId} name=${product.data.name || product.data.productName || ''} batches=${batchTotal} stock=${product.data.stock ?? '(missing)'} quantityInStock=${product.data.quantityInStock ?? '(missing)'}`);
}

if (!APPLY) {
  stats.wouldRepair = repairs.length;
} else {
  const chunkSize = 350;
  for (let i = 0; i < repairs.length; i += chunkSize) {
    const chunk = repairs.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const repair of chunk) {
      batch.update(repair.ref, {
        stock: repair.batchTotal,
        quantityInStock: repair.batchTotal,
        stockAggregateSource: 'product_batches',
        stockAggregateReconciledAt: FieldValue.serverTimestamp(),
        stockAggregateReconciliationVersion: 1
      });
    }
    await batch.commit();
    stats.repaired += chunk.length;
  }
}

console.log('[stock-reconcile] summary');
console.log(JSON.stringify(stats, null, 2));

if (stats.invalidBatchQuantities > 0 || stats.orphanBatchProducts > 0) {
  console.log('[stock-reconcile] completed with inventory anomalies requiring manual review; invalid/orphan batch rows were not included in aggregate repairs.');
}
