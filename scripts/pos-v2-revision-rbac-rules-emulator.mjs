import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const projectId = 'pharmhelm-pos-v2-revision-rbac';
const tenantId = 'tenant-a';
const otherTenantId = 'tenant-b';
const branchId = 'branch-a';

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});

function revisionRequest(uid, requestId, overrides = {}) {
  const replacementSaleId = `replacement-${requestId}`;
  return {
    requestType: 'POS_SALE_REVISION_REQUESTED',
    engineVersion: 2,
    payloadVersion: 1,
    status: 'PENDING',
    requestId,
    revisionId: `revision-${requestId}`,
    tenantId,
    branchId,
    originalSaleId: 'sale-original',
    originalReceiptNumber: 'BR-2026-123456',
    requestedBy: uid,
    requestedByName: 'Revision Operator',
    requestedByRole: 'Dispenser',
    reason: 'Correct the recorded sale details',
    sequence: 1,
    replacementAttemptId: `attempt-${requestId}`,
    replacementSaleId,
    pendingReplacementSaleId: replacementSaleId,
    replacementPaymentId: `payment-${requestId}`,
    replacementOutboxEventId: `outbox-${requestId}`,
    reversalEventId: `reversal-${requestId}`,
    auditId: `audit-${requestId}`,
    originalTotal: 1000,
    revisedTotal: 1000,
    monetaryDelta: 0,
    adjustmentDirection: 'NO_VALUE_CHANGE',
    changeTypes: ['CONTEXT'],
    itemChanges: [],
    revisedItems: [{ productId: 'product-1', quantity: 1, unitPrice: 1000 }],
    before: {},
    after: {},
    envelope: {},
    ...overrides
  };
}

async function attempt(uid, requestId, claims, overrides) {
  const context = testEnv.authenticatedContext(uid, claims);
  return setDoc(
    doc(context.firestore(), 'pos_sale_revision_requests', requestId),
    revisionRequest(uid, requestId, overrides)
  );
}

try {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'staff', 'active-operator'), {
        tenantId,
        role: 'Dispenser',
        secondaryRoles: [],
        assigned_branches: [branchId],
        status: 'active',
        active: true
      }),
      setDoc(doc(db, 'staff', 'inactive-operator'), {
        tenantId,
        role: 'Dispenser',
        secondaryRoles: [],
        assigned_branches: [branchId],
        status: 'inactive',
        active: false
      }),
      setDoc(doc(db, 'staff', 'view-only-operator'), {
        tenantId,
        role: 'Sales Viewer',
        roleRealmId: 'tenant-a_sales_viewer',
        secondaryRoles: [],
        assigned_branches: [branchId],
        status: 'active',
        active: true
      }),
      setDoc(doc(db, 'role_realms_of_operation', 'tenant-a_sales_viewer'), {
        tenantId,
        roleType: 'custom',
        roleName: 'Sales Viewer',
        permissions: { sales: { accessLevel: 'view_only' } }
      }),
      setDoc(doc(db, 'staff', 'cashier-operator'), {
        tenantId,
        role: 'Cashier',
        secondaryRoles: ['Dispenser'],
        assigned_branches: [branchId],
        status: 'active',
        active: true
      }),
      setDoc(doc(db, 'staff', 'cross-tenant-operator'), {
        tenantId: otherTenantId,
        role: 'Dispenser',
        secondaryRoles: [],
        assigned_branches: [branchId],
        status: 'active',
        active: true
      }),
      setDoc(doc(db, 'staff', 'unassigned-operator'), {
        tenantId,
        role: 'Dispenser',
        secondaryRoles: [],
        assigned_branches: [],
        status: 'active',
        active: true
      })
    ]);
  });

  await assertSucceeds(attempt('active-operator', 'request-active', { tenantId }));
  await assertFails(attempt('inactive-operator', 'request-inactive', { tenantId }));
  await assertFails(attempt('view-only-operator', 'request-view-only', { tenantId }));
  await assertFails(attempt('cashier-operator', 'request-cashier', { tenantId }));
  await assertFails(attempt('cross-tenant-operator', 'request-cross-tenant', { tenantId: otherTenantId }));
  await assertFails(attempt('unassigned-operator', 'request-unassigned', { tenantId }));

  console.log('[revision-rbac-rules] PASS: only an active, functional, tenant-matched, branch-assigned non-Cashier POS operator can create a revision request.');
} finally {
  await testEnv.cleanup();
}
