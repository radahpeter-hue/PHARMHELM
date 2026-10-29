import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { configuredEodShifts, eodIdentity } from '../utils/eodShifts';
import { EOD_PAYMENT_CHANNELS } from '../utils/eodExpected';
import { eodAmountNumber, eodVariance, requiresEodVarianceReason, sumEodAmounts } from '../utils/eodMoney';
import { hasAnyRole } from '../utils/roles';
import type { Branch } from '../types';
export type EodSubmission = Record<string, unknown> & {
  tenantId: string; branch_id: string; reconciliation_date: string; shift_id: string;
  shift_name: string; shift_start: string; shift_end: string;
};
export async function submitEod(input: EodSubmission, actor: { uid: string; tenantId: string }, connection: Firestore = db): Promise<{ id: string; replayed: boolean }> {
  if (!actor.uid || actor.tenantId !== input.tenantId) throw new Error('EOD tenant does not match the authenticated operator.');
  const id = eodIdentity(input.tenantId, input.branch_id, input.reconciliation_date, input.shift_id);
  const ref = doc(connection, 'eod_reconciliations', id);
  // Existing Rules deny point-reading a missing EOD. This tenant-scoped list query
  // safely returns an empty result without widening those production Rules.
  const existing = async () => {
    const rows = await getDocs(query(collection(connection, 'eod_reconciliations'), where('tenantId', '==', actor.tenantId), where('reconciliation_date', '==', input.reconciliation_date)));
    const match = rows.docs.find(row => row.id === id);
    if (!match) return false;
    const record = match.data();
    if (eodIdentity(record.tenantId, record.branch_id, record.reconciliation_date, record.shift_id) !== id) throw new Error('EOD identity conflict.');
    return true;
  };
  if (await existing()) return { id, replayed: true };
  const amounts: Record<string, number> = {};
  const channels = EOD_PAYMENT_CHANNELS.map(channel => {
    const declared = eodAmountNumber(input[`${channel}_actual`]);
    const expected = eodAmountNumber(input[`${channel}_expected`]);
    if (declared < 0 || expected < 0) throw new Error('EOD amounts cannot be negative.');
    amounts[`${channel}_actual`] = declared;
    amounts[`${channel}_expected`] = expected;
    amounts[`${channel}_variance`] = eodVariance(declared, expected);
    return { declared, expected };
  });
  const reason = String(input.variance_reason || '').trim();
  if (requiresEodVarianceReason(channels) && !reason) throw new Error('A variance reason is required.');
  amounts.total_expected = sumEodAmounts(channels.map(c => c.expected));
  amounts.total_actual = sumEodAmounts(channels.map(c => c.declared));
  amounts.total_variance = eodVariance(amounts.total_actual, amounts.total_expected);
  const attemptId = crypto.randomUUID();
  try {
    await runTransaction(connection, async tx => {
      const branch = await tx.get(doc(connection, 'branches', input.branch_id));
      const staff = await tx.get(doc(connection, 'staff', actor.uid));
      if (!branch.exists() || branch.data().tenantId !== actor.tenantId || !staff.exists() || staff.data().tenantId !== actor.tenantId) throw new Error('EOD branch/operator is outside this tenant.');
      const operator = staff.data();
      if (!(operator.assigned_branches || []).includes(input.branch_id) && operator.branch_id !== input.branch_id && !hasAnyRole(operator, ['owner', 'CEO', 'CEO / MD', 'admin', 'Finance Head', 'Accountant'])) throw new Error('Operator is not assigned to this branch.');
      const shift = configuredEodShifts(branch.data() as Branch).find(s => s.id === input.shift_id);
      if (!shift || shift.startTime !== input.shift_start || shift.endTime !== input.shift_end) throw new Error('Shift configuration changed. Refresh and select an enabled shift.');
      // No missing-document point read. The deterministic set is create-only under
      // deployed EOD update Rules: submission_attempt_id/submitted_at are never
      // correction fields. Concurrent sets after the first cannot overwrite it.
      tx.set(ref, { ...input, ...amounts, shift_name: shift.name, variance_reason: requiresEodVarianceReason(channels) ? reason : '',
        cashier_id: actor.uid, logged_by: actor.uid, created_at: new Date().toISOString(),
        audit_only: true, financial_posting: 'none', reconciliation_key: id, submission_attempt_id: attemptId, submitted_at: serverTimestamp(), status: 'submitted' });
    });
    return { id, replayed: false };
  } catch (error) {
    // Resolve a concurrent winner or a lost acknowledgement without another write.
    // If the network is still unavailable, propagate the failure so the user retries.
    if (await existing()) return { id, replayed: true };
    throw error;
  }
}
