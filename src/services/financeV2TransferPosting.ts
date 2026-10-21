import { doc, runTransaction, Timestamp, type Firestore } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { planFinanceV2Transfer, type FinanceV2AccountSnapshot, type FinanceV2TransferInput } from './financeV2TransferPolicy';

/**
 * Staged writer, deliberately disabled until Finance V2 Firestore rules and
 * account migration are approved. This prevents bypass of live legacy controls.
 */
export async function postFinanceV2Transfer(
  input: FinanceV2TransferInput,
  connection: Firestore = db,
  options: { financeV2TransferRulesCertified?: boolean } = {}
) {
  if (options.financeV2TransferRulesCertified !== true) {
    throw new Error('Finance V2 transfers are disabled pending rules certification and account reconciliation.');
  }
  if (!auth.currentUser?.uid || auth.currentUser.uid !== input.actorUid) {
    throw new Error('Authenticated transfer actor must match the request.');
  }
  const id = `finance_v2_transfer_${input.tenantId}_${input.requestId}`;
  // Check identifiers before constructing document references.
  if (![input.tenantId, input.requestId, input.sourceAccountId, input.destinationAccountId, input.chargePayerAccountId, input.actorUid]
    .every(value => /^[A-Za-z0-9_-]{1,150}$/.test(value))) throw new Error('Invalid transfer identity.');
  const requestRef = doc(connection, 'finance_v2_transfers', id);
  return runTransaction(connection, async tx => {
    // Read request first: repeated requests must never repeat balance movements.
    const existing = await tx.get(requestRef);
    if (existing.exists()) {
      const data = existing.data();
      // Replays must match the full financial request, including the narrative,
      // and the exact number of movements/charge evidence in the trusted core.
      // A caller-controlled certification option is NOT a security boundary.
      const fields = ['tenantId','requestId','sourceAccountId','destinationAccountId','chargePayerAccountId','principalUGX','chargeUGX','actorUid','description'] as const;
      const expectedMovementCount = input.chargeUGX > 0 ? 3 : 2;
      const expectedChargeEventId = input.chargeUGX > 0 ? `${id}_charge` : null;
      if (data.status !== 'posted' || data.currency !== 'UGX' ||
          !Array.isArray(data.accountDeltas) || data.accountDeltas.length < 2 ||
          !Number.isSafeInteger(data.movementCount) ||
          data.movementCount !== expectedMovementCount ||
          data.chargeEventId !== expectedChargeEventId ||
          fields.some(field => data[field] !== input[field]) ||
          !data.accountDeltas.every((entry: unknown) => {
            if (!entry || typeof entry !== 'object') return false;
            const delta = entry as {accountId?: unknown; beforeUGX?: unknown; deltaUGX?: unknown; afterUGX?: unknown};
            return typeof delta.accountId === 'string' &&
              Number.isSafeInteger(delta.beforeUGX) && Number.isSafeInteger(delta.deltaUGX) &&
              Number.isSafeInteger(delta.afterUGX) &&
              (delta.beforeUGX as number) + (delta.deltaUGX as number) === delta.afterUGX;
          }) ||
          (() => {
            const expected = new Map<string, number>();
            expected.set(input.sourceAccountId, -input.principalUGX);
            expected.set(input.destinationAccountId, input.principalUGX);
            if (input.chargeUGX > 0) expected.set(input.chargePayerAccountId,
              (expected.get(input.chargePayerAccountId) ?? 0) - input.chargeUGX);
            return data.accountDeltas.length !== expected.size ||
              data.accountDeltas.some((entry: {accountId: string; deltaUGX: number}) =>
                expected.get(entry.accountId) !== entry.deltaUGX);
          })()) {
        throw new Error('Transfer idempotency conflict or incomplete posting.');
      }
      return { transferId: id, replay: true };
    }
    const uniqueIds = [...new Set([input.sourceAccountId, input.destinationAccountId, input.chargePayerAccountId])];
    const refs = uniqueIds.map(accountId => doc(connection, 'finance_payment_accounts', `${input.tenantId}_${accountId}`));
    const snaps = await Promise.all(refs.map(ref => tx.get(ref)));
    const accounts: FinanceV2AccountSnapshot[] = snaps.map((snap, i) => {
      if (!snap.exists()) throw new Error('Transfer account is not registered.');
      const data = snap.data();
      if (data.tenantId !== input.tenantId || data.accountId !== uniqueIds[i] || data.initialized !== true || data.currency !== 'UGX' || data.controlVersion !== 2)
        throw new Error('Account identity, V2 control version, currency or reconciliation invalid.');
      const normalizedKind = data.kind === 'bank' ? 'BANK' : data.kind === 'petty_cash' ? 'PETTY_CASH' : data.kind;
      return { tenantId: data.tenantId, accountId: data.accountId, kind: normalizedKind,
        balanceUGX: data.balanceUGX, branchId: data.branchId,
        active: data.active !== false };
    });
    const plan = planFinanceV2Transfer(input, accounts);
    const now = Timestamp.now();
    // Record an account-specific before/after snapshot to support rule-side
    // consistency checks and independent audit reconstruction.
    const auditDeltas = plan.accountDeltas.map(m => {
      const i = uniqueIds.indexOf(m.accountId);
      return {
        accountId:m.accountId, beforeUGX:accounts[i].balanceUGX,
        deltaUGX:m.deltaUGX, afterUGX:accounts[i].balanceUGX + m.deltaUGX
      };
    });
    for (const movement of plan.accountDeltas) {
      const index = uniqueIds.indexOf(movement.accountId);
      tx.update(refs[index], { balanceUGX: accounts[index].balanceUGX + movement.deltaUGX,
        lastPostingId: id, updatedAt: now });
    }
    plan.movements.forEach((movement, index) => {
      tx.set(doc(connection, 'finance_v2_account_movements', `${id}_${index}`), {
        tenantId: input.tenantId, transferId: id, accountId: movement.accountId,
        deltaUGX: movement.deltaUGX, purpose: movement.purpose, movementIndex:index,
        actorUid: input.actorUid, createdAt: now
      });
    });
    if (plan.externalChargeExpenseUGX > 0) tx.set(doc(connection,'finance_v2_events', `${id}_charge`), {
      tenantId: input.tenantId, sourceType: 'ACCOUNT_TRANSFER', sourceId: id,
      eventKind: 'EXTERNAL_TRANSFER_CHARGE_OPEX', amountUGX: plan.externalChargeExpenseUGX,
      currency: 'UGX', actorUid: input.actorUid, createdAt: now
    });
    tx.set(requestRef, {...input, status:'posted', currency:'UGX', accountDeltas:auditDeltas,
      movementCount:plan.movements.length, chargeEventId:plan.externalChargeExpenseUGX > 0 ? `${id}_charge` : null, createdAt:now});
    return { transferId:id, replay:false };
  });
}
