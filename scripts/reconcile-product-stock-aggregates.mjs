import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const tenantArgIndex = process.argv.indexOf('--tenant');
const selectorArgIndex = process.argv.indexOf('--tenant-selector');
const TENANT_ID_ARG = tenantArgIndex >= 0 ? String(process.argv[tenantArgIndex + 1] || '').trim() : '';
const TENANT_SELECTOR = selectorArgIndex >= 0 ? String(process.argv[selectorArgIndex + 1] || '').trim() : '';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';

if (!TENANT_ID_ARG && !TENANT_SELECTOR) {
  console.error('Usage: node scripts/reconcile-product-stock-aggregates.mjs (--tenant <tenantId> | --tenant-selector <name|slug|acronym>) [--apply]');
  process.exit(2);
}

const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID });
const db = DATABASE_ID && DATABASE_ID !== '(default)'
  ? getFirestore(app, DATABASE_ID)
  : getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const normalize = value => String(value || '').trim().toLowerCase();

async function resolveTenantId() {
  if (TENANT_ID_ARG) {
    const direct = await db.collection('tenants').doc(TENANT_ID_ARG).get();
    if (!direct.exists) throw new Error(`Tenant document ${TENANT_ID_ARG} was not found.`);
    return { id: direct.id, data: direct.data(), matchedBy: 'document-id' };
  }

  const needle = normalize(TENANT_SELECTOR);
  const tenantsSnap = await db.collection('tenants').get();
  const matches = tenantsSnap.docs.filter(doc => {
    const data = doc.data();
    const candidates = [
      doc.id,
      data.name,
      data.pharmacyName,
      data.slug,
      data.subdomain,
      data.subdomain_slug,
      data.acronym,
      data.tenantAcronym
    ].map(normalize).filter(Boolean);
    return candidates.includes(needle);
  });

  if (matches.length === 0) {
    throw new Error(`No tenant matched selector "${TENANT_SELECTOR}". Use the visible tenant name, subdomain slug or acronym from TMC.`);
  }
  if (matches.length > 1) {
    throw new Error(`Tenant selector "${TENANT_SELECTOR}" matched multiple tenant records: ${matches.map(doc => doc.id).join(', ')}.`);
  }

  const match = matches[0];
  return { id: match.id, data: match.data(), matchedBy: 'visible-selector' };
}

const resolvedTenant = await resolveTenantId();
const TENANT_ID = resolvedTenant.id;
const tenantName = resolvedTenant.data?.name || resolvedTenant.data?.pharmacyName || '';
const tenantSlug = resolvedTenant.data?.slug || resolvedTenant.data?.subdomain || resolvedTenant.data?.subdomain_slug || '';

const stats = {
  products: 0,
  batches: 0,
  mismatches: 0,
  wouldRepair: 0,
  repaired: 0,
  invalidBatchQuantities: 0,
  orphanBatchProducts: 0
};

console.log(`[stock-reconcile] mode=${APPLY ? 'APPLY' : 'DRY_RUN'} project=${PROJECT_ID} database=${DATABASE_ID}`);
console.log(`[tenant-resolved] selector=${TENANT_SELECTOR || TENANT_ID_ARG} id=${TENANT_ID} name=${tenantName} slug=${tenantSlug} matchedBy=${resolvedTenant.matchedBy}`);

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
  if (stats.invalidBatchQuantities > 0 || stats.orphanBatchProducts > 0) {
    throw new Error('Apply blocked because invalid/orphan batch anomalies exist. Resolve them before aggregate repair.');
  }

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
