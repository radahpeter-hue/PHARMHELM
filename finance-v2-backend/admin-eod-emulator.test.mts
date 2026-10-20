/** Isolated Firestore emulator acceptance. Never connects to production. */
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { executeAuthenticatedFinanceV2Eod } from './authenticatedEod.ts';
import { eodCanonicalId } from '../src/services/financeV2EodPolicy.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('FIRESTORE_EMULATOR_HOST is mandatory');
const app = initializeApp({ projectId: 'finance-v2-eod-isolated' });
const db = getFirestore(app);
const token = { verifyIdToken: async (value: string) => {
  if (value !== 'test-token-authenticated') throw Error('Invalid authentication');
  return { uid: 'eod-cashier' };
}} as any;
const request = {
  tenantId: 'tenant-a', branchId: 'branch-a', businessDate: '2026-10-19',
  shiftId: 'nightShift', declared: { cash: 10000, mtn: 0, airtel: 0, card: 0, insurance: 0, institutional_credit: 0, staff_welfare: 0 },
  varianceReason: ''
};
try {
  await db.doc('staff/eod-cashier').set({ tenantId: 'tenant-a', active: true, status: 'active', role: 'cashier', assigned_branches: ['branch-a'] });
  await db.doc('tenants/tenant-a').set({ status: 'active' });
  await db.doc('system_settings/tenant-a').set({ financeV2TrustedEodEnabled: true });
  await db.doc('branches/branch-a').set({
    tenantId: 'tenant-a', shifts: { nightShift: { enabled: true, startTime: '22:00', endTime: '07:30' } }
  });
  await db.doc('sales/sale-1').set({
    tenantId: 'tenant-a', branchId: 'branch-a', status: 'completed',
    timestamp: '2026-10-20T02:00:00Z', paymentMethod: 'cash', total: 10000
  });
  await db.doc('sales/other-branch').set({
    tenantId: 'tenant-a', branchId: 'branch-b', status: 'completed',
    timestamp: '2026-10-20T02:00:00Z', paymentMethod: 'cash', total: 9999
  });
  await db.doc('sales/other-tenant').set({
    tenantId: 'tenant-b', branchId: 'branch-a', status: 'completed',
    timestamp: '2026-10-20T02:00:00Z', paymentMethod: 'cash', total: 9999
  });
  const [first, second] = await Promise.all([
    executeAuthenticatedFinanceV2Eod(token, db, 'test-token-authenticated', request),
    executeAuthenticatedFinanceV2Eod(token, db, 'test-token-authenticated', request)
  ]);
  assert.equal([first, second].filter(result => !result.replayed).length, 1);
  const id = eodCanonicalId('tenant-a', 'branch-a', '2026-10-19', 'nightShift');
  const record = (await db.doc('eod_reconciliations/' + id).get()).data()!;
  assert.equal(record.cash_expected, 10000);
  assert.equal(record.total_variance, 0);
  assert.equal(record.sales_count, 1);
  await assert.rejects(
    executeAuthenticatedFinanceV2Eod(token, db, 'test-token-authenticated', { ...request, shiftId: 'missing' }),
    /disabled/
  );
  await assert.rejects(
    executeAuthenticatedFinanceV2Eod(token, db, 'test-token-authenticated', { ...request, tenantId: 'tenant-b' }),
    /authorised/
  );
  console.log('PASS EOD single canonical posting, overnight shift, tenant/branch isolation, duplicate replay');
} finally {
  await deleteApp(app);
}
