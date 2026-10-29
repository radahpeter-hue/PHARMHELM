import { collection, doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { canCorrectEod } from '../utils/eodEditPolicy';
import { eodAmountNumber, eodVariance, sumEodAmounts, requiresEodVarianceReason } from '../utils/eodMoney';
export const EOD_CHANNELS = ['cash','momo','airtel','card','insurance','institutional_credit','staff_welfare'] as const;
export async function correctEod(id: string, profile: {uid: string; tenantId: string; role?: string; secondaryRoles?: string[]},
  amounts: Record<string, number>, reason: string, connection: Firestore = db): Promise<void> {
  if (!reason.trim()) throw new Error('A correction reason is required.');
  const auditRef = doc(collection(connection, 'audit_logs'));
  await runTransaction(connection, async tx => {
    const ref = doc(connection, 'eod_reconciliations', id);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists() || !canCorrectEod(profile, snapshot.data() as any)) throw new Error('This EOD reconciliation is locked.');
    const original = snapshot.data();
    const changes: Record<string, unknown> = {};
    const channels = EOD_CHANNELS.map(channel => {
      const declared = eodAmountNumber(amounts[channel]);
      if (declared < 0) throw new Error('Declared amounts cannot be negative.');
      const expected = eodAmountNumber(original[`${channel}_expected`] || 0);
      changes[`${channel}_actual`] = declared;
      changes[`${channel}_variance`] = eodVariance(declared, expected);
      return { declared, expected };
    });
    changes.total_actual = sumEodAmounts(channels.map(c => c.declared));
    changes.total_variance = eodVariance(changes.total_actual, original.total_expected ?? sumEodAmounts(channels.map(c => c.expected)));
    changes.variance_reason = requiresEodVarianceReason(channels) ? reason.trim() : '';
    const correction = {...changes, correction_reason: reason.trim(), corrected_by: profile.uid, corrected_at: serverTimestamp()};
    tx.update(ref, correction);
    tx.set(auditRef, { tenantId: profile.tenantId, action: 'EOD_CORRECTION', entity_type: 'eod_reconciliation',
      entity_id: id, branch_id: original.branch_id, reconciliation_date: original.reconciliation_date,
      userId: profile.uid, reason: reason.trim(), timestamp: serverTimestamp(), before: original, after: { ...original, ...correction } });
  });
}
