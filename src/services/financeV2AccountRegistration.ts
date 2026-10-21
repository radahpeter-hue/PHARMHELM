import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { financeV2AccountDocumentId, planFinanceV2AccountRegistration, type FinanceV2AccountRegistration } from './financeV2AccountRegistryPolicy';

/**
 * V2 account registration. Only zero-opening accounts can be submitted until
 * an independently reconciled opening-balance approval workflow exists.
 * Firestore rules deliberately deny creation today, so this service fails closed.
 */
export async function registerFinanceV2Account(
  input: FinanceV2AccountRegistration,
  connection: Firestore = db
): Promise<{ accountDocumentId: string; created: boolean }> {
  const planned = planFinanceV2AccountRegistration(input);
  if (!auth.currentUser?.uid || auth.currentUser.uid !== input.actorUid) {
    throw new Error('Authenticated Finance actor must match account registration.');
  }
  if (planned.openingBalanceUGX !== 0) {
    throw new Error('Positive opening balance requires independently approved reconciliation.');
  }
  const accountDocumentId = financeV2AccountDocumentId(input.tenantId, input.accountId);
  const ref = doc(connection, 'finance_payment_accounts', accountDocumentId);
  return runTransaction(connection, async tx => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      // Never interpret duplicate registration as authorisation to update a balance.
      throw new Error('Account already registered; reconcile the existing account instead.');
    }
    tx.set(ref, {...planned, createdAt: serverTimestamp(), updatedAt: serverTimestamp()});
    return {accountDocumentId, created:true};
  });
}
