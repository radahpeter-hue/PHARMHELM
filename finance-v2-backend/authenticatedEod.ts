import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { assignSaleToEodShift, assertUgx, eodCanonicalId, validateEodAmounts, type EodShift } from '../src/services/financeV2EodPolicy';

/**
 * Server-side EOD execution. This file is not a deployed endpoint.
 * Only trusted Admin SDK callers may invoke it after verifying the bearer token.
 * Transaction reads of the branch and sale query precede all writes.
 */
const fields = ['cash', 'mtn', 'airtel', 'card', 'insurance', 'institutional_credit', 'staff_welfare'] as const;
type Method = typeof fields[number];
export interface TrustedEodRequest {
  tenantId: string;
  branchId: string;
  businessDate: string;
  shiftId: string;
  declared: Record<Method, number>;
  varianceReason: string;
}
function method(value: unknown): Method {
  const names: Record<string, Method> = {
    cash: 'cash', mtn_momo: 'mtn', mtn: 'mtn',
    airtel_money: 'airtel', airtel: 'airtel', card: 'card',
    insurance: 'insurance', institutional_credit: 'institutional_credit',
    credit: 'institutional_credit', staff_welfare: 'staff_welfare'
  };
  const resolved = names[String(value || '')];
  if (!resolved) throw new Error('Unsupported POS payment method; reconcile data before posting.');
  return resolved;
}
function totals(sales: Array<Record<string, any>>): Record<Method, number> {
  const expected = Object.fromEntries(fields.map(k => [k, 0])) as Record<Method, number>;
  const add = (name: unknown, amount: unknown) => {
    const key = method(name);
    const numeric = assertUgx(Number(amount));
    expected[key] += numeric;
    if (!Number.isSafeInteger(expected[key])) throw new Error('EOD amount overflow');
  };
  for (const sale of sales) {
    const total = assertUgx(Number(sale.totalAmount ?? sale.total));
    const secondary = sale.secondaryPaymentMethod;
    if (secondary) {
      const secondAmount = assertUgx(Number(sale.secondaryAmount));
      if (secondAmount > total) throw new Error('POS payment split exceeds sale amount');
      const firstAmount = total - secondAmount;
      if (sale.paymentMethod === 'staff_welfare') {
        const welfare = assertUgx(Number(sale.welfareAmount));
        if (welfare !== firstAmount) throw new Error('POS welfare split inconsistent with sale');
      }
      add(sale.paymentMethod, firstAmount);
      add(secondary, secondAmount);
    } else {
      add(sale.paymentMethod, total);
    }
  }
  return expected;
}
export async function executeAuthenticatedFinanceV2Eod(
  auth: Pick<Auth, 'verifyIdToken'>,
  db: Firestore,
  idToken: string,
  input: TrustedEodRequest
) {
  if (!idToken || idToken.length < 20) throw new Error('Authentication required');
  const token = await auth.verifyIdToken(idToken, true);
  const uid = token.uid;
  if (!uid) throw new Error('Authenticated identity missing');
  if (!uid || !input.tenantId || !input.branchId || !input.shiftId) throw new Error('Invalid EOD identity');
  if (!input.declared || typeof input.varianceReason !== 'string' || fields.some(k => !(k in input.declared))) throw new Error('All EOD declarations are required');
  for (const key of fields) assertUgx(input.declared[key]);
  const id = eodCanonicalId(input.tenantId, input.branchId, input.businessDate, input.shiftId);
  const staffSnap = await db.doc('staff/' + uid).get();
  if (!staffSnap.exists) throw new Error('Unknown staff identity');
  const staff = staffSnap.data()!;
  const roles = [staff.role, ...(Array.isArray(staff.secondaryRoles) ? staff.secondaryRoles : [])];
  if (staff.tenantId !== input.tenantId || staff.active !== true || staff.status !== 'active' ||
      !roles.some((role: string) => ['owner', 'CEO', 'CEO / MD', 'Finance Head', 'Finance Officer', 'Accountant', 'Branch Manager', 'cashier', 'Cashier'].includes(role))) {
    throw new Error('Staff not authorised for EOD');
  }
  const privileged = roles.some((role: string) => ['owner', 'CEO', 'CEO / MD', 'Finance Head'].includes(role));
  if (!privileged && ![staff.branch_id, staff.default_branch_id, ...(staff.assigned_branches || [])].includes(input.branchId))
    throw new Error('Staff is not assigned to selected branch');
  const tenantSnap = await db.doc('tenants/' + input.tenantId).get();
  if (!tenantSnap.exists || tenantSnap.data()?.status === 'suspended') throw new Error('Tenant unavailable');
  const controls = await db.doc('system_settings/' + input.tenantId).get();
  if (controls.data()?.financeV2TrustedEodEnabled !== true) throw new Error('Tenant EOD V2 posting disabled');
  const eodRef = db.doc('eod_reconciliations/' + id);
  return db.runTransaction(async tx => {
    const previous = await tx.get(eodRef);
    if (previous.exists) {
      const existing = previous.data()!;
      if (existing.tenantId !== input.tenantId || existing.branch_id !== input.branchId ||
          existing.reconciliation_date !== input.businessDate || existing.shift_id !== input.shiftId)
        throw new Error('Canonical EOD ID collision');
      const suffixes: Record<Method, string> = {
        cash: 'cash', mtn: 'momo', airtel: 'airtel', card: 'card',
        insurance: 'insurance', institutional_credit: 'institutional_credit', staff_welfare: 'staff_welfare'
      };
      for (const key of fields) {
        if (existing[suffixes[key] + '_actual'] !== input.declared[key]) {
          throw new Error('Conflicting EOD submission: this shift has already been reconciled.');
        }
      }
      return { id, replayed: true, record: existing };
    }
    const branchSnap = await tx.get(db.doc('branches/' + input.branchId));
    if (!branchSnap.exists || branchSnap.data()?.tenantId !== input.tenantId) throw new Error('Branch not in tenant');
    const rawShifts = branchSnap.data()?.shifts ?? {};
    const shifts: EodShift[] = Object.entries(rawShifts).map(([id, item]) => ({ id, ...(item as object) })) as EodShift[];
    if (!shifts.some(shift => shift.id === input.shiftId && shift.enabled)) throw new Error('Selected shift is disabled');
    const salesQuery = db.collection('sales').where('tenantId', '==', input.tenantId).where('branchId', '==', input.branchId);
    const saleSnaps = await tx.get(salesQuery);
    const scoped = saleSnaps.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(sale => {
      if (sale.status !== 'completed' && sale.status !== 'active') return false;
      if (sale.revisionOfSaleId && !sale.isRevisionReplacement) throw new Error('Malformed POS revision metadata');
      if (['superseded', 'reversed', 'voided', 'cancelled'].includes(String(sale.revisionStatus || '').toLowerCase())) return false;
      if (sale.voided === true || sale.isVoided === true || sale.isDeleted === true || sale.status === 'deleted') return false;
      if (typeof sale.timestamp !== 'string') throw new Error('Sale without canonical timestamp');
      const shift = assignSaleToEodShift(sale.timestamp, shifts);
      if (!shift) throw new Error('Completed sale cannot be assigned to configured shifts');
      return shift.businessDate === input.businessDate && shift.shiftId === input.shiftId;
    });
    const expected = totals(scoped);
    const assessment = validateEodAmounts(expected, input.declared, input.varianceReason || '');
    const totalExpected = Object.values(expected).reduce((a, b) => a + b, 0);
    const totalActual = Object.values(input.declared).reduce((a, b) => a + b, 0);
    if (![totalExpected, totalActual].every(Number.isSafeInteger)) throw new Error('EOD aggregate exceeds safe UGX precision');
    const record: Record<string, unknown> = {
      tenantId: input.tenantId, branch_id: input.branchId,
      reconciliation_date: input.businessDate, shift_id: input.shiftId,
      cashier_id: uid, logged_by: uid, status: 'Pending',
      total_expected: totalExpected, total_actual: totalActual,
      total_variance: assessment.totalVariance,
      variance_reason: input.varianceReason.trim(),
      sales_count: scoped.length,
      created_at: new Date().toISOString(), engineVersion: 2
    };
    const suffix: Record<Method, string> = {
      cash: 'cash', mtn: 'momo', airtel: 'airtel', card: 'card',
      insurance: 'insurance', institutional_credit: 'institutional_credit', staff_welfare: 'staff_welfare'
    };
    for (const k of fields) {
      record[suffix[k] + '_expected'] = expected[k];
      record[suffix[k] + '_actual'] = input.declared[k];
      record[suffix[k] + '_variance'] = assessment.variances[k];
    }
    tx.create(eodRef, record);
    return { id, replayed: false, record };
  });
}
