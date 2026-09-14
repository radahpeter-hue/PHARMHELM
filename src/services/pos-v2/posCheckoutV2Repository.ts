import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentReference,
  type DocumentData,
  type Transaction
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { Branch, Product, ProductBatch, Sale, SaleItem, Staff, SystemSettings } from '../../types';
import { SYSTEM_ROLE_PERMISSIONS, roleRealmId } from '../../config/rbac';
import { calculateCheckoutV2 } from './posCheckoutV2Calculator';
import { PosCheckoutV2Error } from './posCheckoutV2Errors';
import type {
  CheckoutV2Request,
  PosCheckoutV2AttemptRecord,
  PosCheckoutV2CompletedResult
} from './posCheckoutV2Types';

const EPSILON = 0.0001;
const ACCESS_RANK: Record<string, number> = { none: 0, view: 1, operate: 2, all: 3 };

const ROLE_ALIASES: Record<string, string> = {
  'ceo / md': 'ceo',
  'it support personnel': 'it support staff',
  'procurement personnel': 'procurement officer'
};

export interface PosCheckoutV2PreparedAuthority {
  uid: string;
  tenantId: string;
  staff: Staff;
  branch: Branch;
  roles: string[];
  salesAccess: 'none' | 'view' | 'operate' | 'all';
  branchAuthorized: boolean;
}

export interface PosCheckoutV2BatchRef {
  id: string;
  ref: DocumentReference<DocumentData>;
}

export interface PosCheckoutV2RepositoryPreparation {
  authority: PosCheckoutV2PreparedAuthority;
  settings: SystemSettings | null;
  productRefs: Map<string, DocumentReference<DocumentData>>;
  batchRefsByProduct: Map<string, PosCheckoutV2BatchRef[]>;
  attemptRef: DocumentReference<DocumentData>;
  saleRef: DocumentReference<DocumentData>;
  fingerprint: string;
  saleId: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export function buildCheckoutV2IntentFingerprint(request: CheckoutV2Request): string {
  return JSON.stringify(canonicalize({
    branchId: request.branchId,
    items: request.items.map(item => ({
      productId: item.productId,
      isService: Boolean(item.isService),
      commercialQuantity: item.commercialQuantity ?? item.quantity,
      tierCode: item.tierCode ?? null,
      tierMultiplier: item.tierMultiplier ?? null,
      configuredPrice: item.configuredPrice ?? null,
      actualUnitPrice: item.actualUnitPrice ?? item.unitPrice ?? null,
      lineTotal: item.lineTotal ?? item.subtotal ?? item.total ?? null
    })),
    discountPercentage: request.discountPercentage ?? 0,
    paymentMethod: request.paymentMethod ?? 'cash',
    secondaryPaymentMethod: request.secondaryPaymentMethod ?? null,
    secondaryAmount: request.secondaryAmount ?? null,
    welfareAmount: request.welfareAmount ?? null,
    context: request.context ?? 'walk-in',
    sourceQuotationId: request.sourceQuotationId ?? null,
    customerId: request.customerId ?? null,
    patientId: request.patientId ?? null,
    institutionId: request.institutionId ?? null,
    prescriberId: request.prescriberId ?? null,
    isExceptionalConsumption: Boolean(request.isExceptionalConsumption),
    exceptionalConsumptionReason: request.exceptionalConsumptionReason ?? null
  }));
}

function deterministicDocumentId(prefix: string, tenantId: string, attemptId: string): string {
  const raw = `${tenantId}__${attemptId}`;
  let checksum = 5381;
  for (let i = 0; i < raw.length; i += 1) checksum = ((checksum << 5) + checksum) ^ raw.charCodeAt(i);
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return `${prefix}_${safe}_${(checksum >>> 0).toString(16)}`;
}

export function checkoutV2AttemptDocumentId(tenantId: string, attemptId: string): string {
  return deterministicDocumentId('attempt', tenantId, attemptId);
}

export function checkoutV2SaleDocumentId(tenantId: string, attemptId: string): string {
  return deterministicDocumentId('v2sale', tenantId, attemptId);
}

function normalizeRole(role: string): string {
  const normalized = String(role || '').trim().toLowerCase();
  return ROLE_ALIASES[normalized] || normalized;
}

function systemSalesAccess(role: string): 'none' | 'view' | 'operate' | 'all' | null {
  const normalized = normalizeRole(role);
  const entry = Object.entries(SYSTEM_ROLE_PERMISSIONS).find(([name]) => name.toLowerCase() === normalized);
  return (entry?.[1]?.sales?.access as 'none' | 'view' | 'operate' | 'all' | undefined) || null;
}

async function resolveSalesAccess(tenantId: string, roles: string[]): Promise<'none' | 'view' | 'operate' | 'all'> {
  let resolved: 'none' | 'view' | 'operate' | 'all' = 'none';
  for (const role of roles) {
    const systemAccess = systemSalesAccess(role);
    let access = systemAccess;
    if (!access) {
      const realmSnap = await getDoc(doc(db, 'role_realms_of_operation', roleRealmId(tenantId, role)));
      if (realmSnap.exists() && realmSnap.data().tenantId === tenantId) {
        const raw = realmSnap.data()?.permissions?.sales?.accessLevel;
        access = raw === 'all' ? 'all' : raw === 'view_functional' ? 'operate' : raw === 'view_only' ? 'view' : 'none';
      }
    }
    if (access && ACCESS_RANK[access] > ACCESS_RANK[resolved]) resolved = access;
  }
  return resolved;
}

function roleHasAllBranchAuthority(role: string): boolean {
  return ['owner', 'ceo', 'ceo / md', 'it head', 'it support staff', 'it support personnel'].includes(String(role || '').trim().toLowerCase());
}

export async function loadCheckoutV2Authority(uid: string, requestedBranchId: string): Promise<PosCheckoutV2PreparedAuthority> {
  if (!uid) throw new PosCheckoutV2Error('AUTHORIZATION_DENIED', 'An authenticated operator is required.');
  const staffSnap = await getDoc(doc(db, 'staff', uid));
  if (!staffSnap.exists()) throw new PosCheckoutV2Error('AUTHORIZATION_DENIED', 'The authenticated operator has no authoritative staff record.');
  const staff = { ...(staffSnap.data() as Staff), id: staffSnap.id };
  if (!staff.tenantId) throw new PosCheckoutV2Error('TENANT_MISMATCH', 'The operator staff record has no authoritative tenant.');
  if (!(staff.status === 'active' || staff.active === true)) throw new PosCheckoutV2Error('AUTHORIZATION_DENIED', 'The operator staff record is not active.');
  if (String(staff.role || '').trim().toLowerCase() === 'cashier') throw new PosCheckoutV2Error('AUTHORIZATION_DENIED', 'Cashier accounts cannot complete sales.');

  const branchSnap = await getDoc(doc(db, 'branches', requestedBranchId));
  if (!branchSnap.exists()) throw new PosCheckoutV2Error('BRANCH_NOT_AUTHORIZED', 'The requested branch does not exist.');
  const branch = { ...(branchSnap.data() as Branch), id: branchSnap.id };
  if (branch.tenantId !== staff.tenantId) throw new PosCheckoutV2Error('TENANT_MISMATCH', 'The requested branch belongs to a different tenant.');
  if (branch.status && String(branch.status).toLowerCase() !== 'active') throw new PosCheckoutV2Error('BRANCH_NOT_AUTHORIZED', 'The requested branch is not active.');

  const roles = [String(staff.role || ''), ...(staff.secondaryRoles || [])].filter(Boolean);
  const branchAuthorized = roles.some(roleHasAllBranchAuthority) || (staff.assigned_branches || []).includes(requestedBranchId) || staff.branch_id === requestedBranchId;
  if (!branchAuthorized) throw new PosCheckoutV2Error('BRANCH_NOT_AUTHORIZED', 'The operator is not authorised for the requested branch.');

  const salesAccess = await resolveSalesAccess(staff.tenantId, roles);
  if (!(salesAccess === 'operate' || salesAccess === 'all')) throw new PosCheckoutV2Error('AUTHORIZATION_DENIED', 'The operator does not have effective sales:operate permission.');

  return { uid, tenantId: staff.tenantId, staff, branch, roles, salesAccess, branchAuthorized };
}

async function loadSystemSettings(tenantId: string): Promise<SystemSettings | null> {
  const snap = await getDocs(query(collection(db, 'system_settings'), where('tenantId', '==', tenantId)));
  return snap.empty ? null : ({ ...snap.docs[0].data(), id: snap.docs[0].id } as SystemSettings);
}

async function loadProductRefs(productIds: string[]): Promise<Map<string, DocumentReference<DocumentData>>> {
  return new Map(productIds.map(productId => [productId, doc(db, 'products', productId)]));
}

async function loadTenantProductBatchRefs(tenantId: string, productIds: string[]): Promise<Map<string, PosCheckoutV2BatchRef[]>> {
  const result = new Map<string, PosCheckoutV2BatchRef[]>();
  await Promise.all(productIds.map(async productId => {
    const snap = await getDocs(query(
      collection(db, 'product_batches'),
      where('tenantId', '==', tenantId),
      where('productId', '==', productId)
    ));
    result.set(productId, snap.docs.map(row => ({ id: row.id, ref: row.ref })));
  }));
  return result;
}

export async function prepareCheckoutV2Repository(uid: string, request: CheckoutV2Request): Promise<PosCheckoutV2RepositoryPreparation> {
  const authority = await loadCheckoutV2Authority(uid, request.branchId);
  const productIds = Array.from(new Set(request.items.filter(item => !item.isService).map(item => item.productId)));
  const [settings, productRefs, batchRefsByProduct] = await Promise.all([
    loadSystemSettings(authority.tenantId),
    loadProductRefs(productIds),
    loadTenantProductBatchRefs(authority.tenantId, productIds)
  ]);
  const fingerprint = buildCheckoutV2IntentFingerprint(request);
  const attemptId = checkoutV2AttemptDocumentId(authority.tenantId, request.attemptId);
  const saleId = checkoutV2SaleDocumentId(authority.tenantId, request.attemptId);
  return {
    authority,
    settings,
    productRefs,
    batchRefsByProduct,
    attemptRef: doc(db, 'pos_checkout_attempts', attemptId),
    saleRef: doc(db, 'sales', saleId),
    fingerprint,
    saleId
  };
}

function taxSnapshot(items: SaleItem[], liveProducts: Map<string, Product>): { items: SaleItem[]; taxAmount: number } {
  let taxAmount = 0;
  const snapshotted = items.map(item => {
    if (item.isService) return { ...item, vatAmount: Number((item as any).vatAmount || 0), vatRate: Number((item as any).vatRate || 0) } as SaleItem;
    const product = liveProducts.get(item.productId);
    let vatRate = 0;
    let vatAmount = 0;
    if (product?.vatClassification === 'Standard Rated') {
      vatRate = Number(product.vatPercentage || 18);
      const unitPrice = Number(item.actualUnitPrice ?? item.unitPrice ?? 0);
      const quantity = Number(item.commercialQuantity ?? item.quantity ?? 0);
      const basePrice = unitPrice / (1 + vatRate / 100);
      vatAmount = Math.round((unitPrice - basePrice) * quantity);
    }
    taxAmount += vatAmount;
    return { ...item, vatRate, vatAmount } as SaleItem;
  });
  return { items: snapshotted, taxAmount };
}

function aggregateBatchQuantity(rows: ProductBatch[]): number {
  return rows.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
}

function assertAggregateMatches(product: Product, batchTotal: number) {
  const stock = Number(product.stock);
  const quantityInStock = Number(product.quantityInStock);
  if (!Number.isFinite(stock) || !Number.isFinite(quantityInStock) || Math.abs(stock - batchTotal) > EPSILON || Math.abs(quantityInStock - batchTotal) > EPSILON) {
    throw new PosCheckoutV2Error('STOCK_AGGREGATE_MISMATCH', `Inventory aggregate mismatch for ${product.name}. Reconcile product stock before retrying.`, {
      productId: product.id,
      batchTotal,
      stock: product.stock,
      quantityInStock: product.quantityInStock
    });
  }
}

function assertTransactionAuthority(staff: Staff, expected: PosCheckoutV2PreparedAuthority, branch: Branch) {
  if (staff.tenantId !== expected.tenantId || branch.tenantId !== expected.tenantId) throw new PosCheckoutV2Error('TENANT_MISMATCH', 'Tenant authority changed during checkout.');
  if (!(staff.status === 'active' || staff.active === true)) throw new PosCheckoutV2Error('AUTHORIZATION_DENIED', 'Operator authority changed during checkout.');
  if (String(staff.role || '').trim().toLowerCase() === 'cashier') throw new PosCheckoutV2Error('AUTHORIZATION_DENIED', 'Cashier accounts cannot complete sales.');
  if (branch.status && String(branch.status).toLowerCase() !== 'active') throw new PosCheckoutV2Error('BRANCH_NOT_AUTHORIZED', 'Branch became inactive during checkout.');
  const roles = [String(staff.role || ''), ...(staff.secondaryRoles || [])].filter(Boolean);
  const branchAuthorized = roles.some(roleHasAllBranchAuthority) || (staff.assigned_branches || []).includes(branch.id) || staff.branch_id === branch.id;
  if (!branchAuthorized) throw new PosCheckoutV2Error('BRANCH_NOT_AUTHORIZED', 'Branch authority changed during checkout.');
}

export async function commitCheckoutV2(request: CheckoutV2Request, prepared: PosCheckoutV2RepositoryPreparation): Promise<PosCheckoutV2CompletedResult> {
  return runTransaction(db, async (transaction: Transaction) => {
    const attemptSnap = await transaction.get(prepared.attemptRef);
    if (attemptSnap.exists()) {
      const attempt = attemptSnap.data() as PosCheckoutV2AttemptRecord;
      if (attempt.tenantId !== prepared.authority.tenantId || attempt.fingerprint !== prepared.fingerprint) {
        throw new PosCheckoutV2Error('IDEMPOTENCY_CONFLICT', 'This checkout attempt ID has already been used for different commercial intent.');
      }
      const existingSaleRef = doc(db, 'sales', attempt.saleId);
      const existingSaleSnap = await transaction.get(existingSaleRef);
      if (!existingSaleSnap.exists()) throw new PosCheckoutV2Error('TRANSACTION_CONFLICT', 'The completed checkout attempt points to a missing sale.');
      const sale = { ...(existingSaleSnap.data() as Sale), id: existingSaleSnap.id };
      return { saleId: sale.id, receiptNumber: sale.receiptNumber, attemptId: request.attemptId, sale, replayed: true };
    }

    const staffSnap = await transaction.get(doc(db, 'staff', prepared.authority.uid));
    const branchSnap = await transaction.get(doc(db, 'branches', prepared.authority.branch.id));
    if (!staffSnap.exists()) throw new PosCheckoutV2Error('AUTHORIZATION_DENIED', 'Operator staff record disappeared during checkout.');
    if (!branchSnap.exists()) throw new PosCheckoutV2Error('BRANCH_NOT_AUTHORIZED', 'Branch disappeared during checkout.');
    const liveStaff = { ...(staffSnap.data() as Staff), id: staffSnap.id };
    const liveBranch = { ...(branchSnap.data() as Branch), id: branchSnap.id };
    assertTransactionAuthority(liveStaff, prepared.authority, liveBranch);

    const liveProducts = new Map<string, Product>();
    for (const [productId, productRef] of prepared.productRefs.entries()) {
      const snap = await transaction.get(productRef);
      if (!snap.exists()) throw new PosCheckoutV2Error('INVALID_PRODUCT', `Product ${productId} no longer exists.`);
      const product = { ...(snap.data() as Product), id: snap.id };
      if (product.tenantId !== prepared.authority.tenantId) throw new PosCheckoutV2Error('TENANT_MISMATCH', `Product ${productId} belongs to a different tenant.`);
      liveProducts.set(productId, product);
    }

    const batchesByProduct = new Map<string, any[]>();
    const rawBatchesByProduct = new Map<string, ProductBatch[]>();
    for (const [productId, refs] of prepared.batchRefsByProduct.entries()) {
      const rows: ProductBatch[] = [];
      for (const row of refs) {
        const snap = await transaction.get(row.ref);
        if (!snap.exists()) continue;
        const batch = { ...(snap.data() as ProductBatch), id: snap.id };
        if (batch.tenantId !== prepared.authority.tenantId) throw new PosCheckoutV2Error('TENANT_MISMATCH', `Batch ${batch.id} belongs to a different tenant.`);
        if (batch.productId !== productId) throw new PosCheckoutV2Error('INVALID_PRODUCT', `Batch ${batch.id} changed product ownership during checkout.`);
        if (!Number.isFinite(Number(batch.quantity)) || Number(batch.quantity) < 0) throw new PosCheckoutV2Error('STOCK_AGGREGATE_MISMATCH', `Batch ${batch.id} has an invalid quantity.`);
        rows.push(batch);
      }
      rawBatchesByProduct.set(productId, rows);
      batchesByProduct.set(productId, rows.map(batch => ({
        id: batch.id,
        tenantId: batch.tenantId,
        branchId: batch.branchId,
        productId: batch.productId,
        batchNumber: batch.batchNumber || 'UNSPECIFIED',
        expiryDate: batch.expiryDate,
        batchStatus: batch.batch_status,
        quantity: Number(batch.quantity || 0),
        costPerBaseUnit: Number(batch.purchasePrice)
      })));
    }

    for (const [productId, product] of liveProducts.entries()) {
      assertAggregateMatches(product, aggregateBatchQuantity(rawBatchesByProduct.get(productId) || []));
    }

    const calculation = calculateCheckoutV2({
      tenantId: prepared.authority.tenantId,
      branchId: prepared.authority.branch.id,
      items: request.items,
      liveProducts,
      batchesByProduct,
      settings: prepared.settings,
      discountPercentage: request.discountPercentage,
      now: new Date()
    });

    for (const [productId, deductions] of calculation.batchDeductions.entries()) {
      const rows = rawBatchesByProduct.get(productId) || [];
      for (const [batchId, deduction] of deductions.entries()) {
        const batch = rows.find(candidate => candidate.id === batchId);
        if (!batch || batch.branchId !== prepared.authority.branch.id || batch.tenantId !== prepared.authority.tenantId) {
          throw new PosCheckoutV2Error('BRANCH_NOT_AUTHORIZED', `Allocated batch ${batchId} is outside the authoritative branch.`);
        }
        const nextQuantity = Number(batch.quantity) - deduction;
        if (nextQuantity < -EPSILON) throw new PosCheckoutV2Error('TRANSACTION_CONFLICT', `Batch ${batchId} no longer has enough stock.`);
        transaction.update(doc(db, 'product_batches', batchId), { quantity: Math.max(0, nextQuantity), lastUpdated: new Date().toISOString() });
      }
    }

    for (const [productId, deduction] of calculation.productDeductions.entries()) {
      const product = liveProducts.get(productId)!;
      const nextStock = Number(product.stock) - deduction;
      if (nextStock < -EPSILON) throw new PosCheckoutV2Error('STOCK_AGGREGATE_MISMATCH', `Product aggregate for ${product.name} cannot satisfy the base-unit deduction.`);
      transaction.update(doc(db, 'products', productId), {
        stock: Math.max(0, nextStock),
        quantityInStock: Math.max(0, nextStock),
        stockAggregateSource: 'product_batches',
        updatedAt: serverTimestamp()
      });
    }

    const tax = taxSnapshot(calculation.finalizedItems, liveProducts);
    const branchCode = prepared.authority.branch.branch_code || 'KLA';
    const receiptNumber = `${branchCode}-${new Date().getFullYear()}-${prepared.saleId.slice(-8).toUpperCase()}`;
    const sale: Sale = {
      id: prepared.saleId,
      tenantId: prepared.authority.tenantId,
      branchId: prepared.authority.branch.id,
      receiptNumber,
      timestamp: new Date().toISOString(),
      items: tax.items,
      subtotal: calculation.grossTotal,
      tax: 0,
      taxAmount: tax.taxAmount,
      discountAmount: calculation.discountAmount,
      discountPercentage: calculation.discountPercentage,
      total: calculation.netTotal,
      totalAmount: calculation.netTotal,
      paymentMethod: request.paymentMethod || 'cash',
      secondaryPaymentMethod: request.secondaryPaymentMethod,
      secondaryAmount: request.secondaryAmount,
      welfareAmount: request.welfareAmount,
      welfareBeneficiaryIsStaff: request.welfareBeneficiaryIsStaff,
      welfarePostingStatus: request.paymentMethod === 'staff_welfare' ? 'pending' : 'not_applicable',
      sourceQuotationId: request.sourceQuotationId,
      quotationConversionStatus: request.sourceQuotationId ? 'pending' : 'not_applicable',
      cashierId: prepared.authority.uid,
      clientId: request.customerId,
      patientId: request.patientId,
      patientName: request.patientName,
      institutionId: request.institutionId,
      institutionName: request.institutionName,
      prescriberId: request.prescriberId,
      prescriberName: request.prescriberName,
      context: (request.context || 'walk-in') as any,
      servedBy: prepared.authority.uid,
      isExceptionalConsumption: Boolean(request.isExceptionalConsumption),
      exceptionalConsumptionReason: request.exceptionalConsumptionReason ?? null,
      status: 'completed',
      inventoryPosted: true,
      inventoryPostedAt: serverTimestamp()
    };

    transaction.set(prepared.saleRef, {
      ...sale,
      engineVersion: 2,
      integrityVersion: 2,
      checkoutAttemptId: request.attemptId,
      checkoutIntentFingerprint: prepared.fingerprint,
      operatorUid: prepared.authority.uid,
      authoritativeTenantId: prepared.authority.tenantId,
      authoritativeBranchId: prepared.authority.branch.id,
      actualSaleCost: calculation.actualCostTotal,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      v2CompletedAt: serverTimestamp()
    });

    const attempt: PosCheckoutV2AttemptRecord = {
      tenantId: prepared.authority.tenantId,
      attemptId: request.attemptId,
      fingerprint: prepared.fingerprint,
      status: 'completed',
      saleId: prepared.saleId,
      branchId: prepared.authority.branch.id,
      operatorUid: prepared.authority.uid,
      createdAt: serverTimestamp(),
      completedAt: serverTimestamp()
    };
    transaction.set(prepared.attemptRef, attempt);

    return { saleId: prepared.saleId, receiptNumber, attemptId: request.attemptId, sale, replayed: false };
  });
}
