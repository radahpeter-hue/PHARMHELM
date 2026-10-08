import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { omitUndefinedDeep } from '../utils/firestoreData';

function formatQuotationId(format: string, branchCode: string, year: string, sequence: number): string {
  const seq4 = String(sequence).padStart(4, '0');
  const seq6 = String(sequence).padStart(6, '0');
  return format
    .replaceAll('[BRANCH]', branchCode).replaceAll('{BRANCH}', branchCode)
    .replaceAll('[YEAR]', year).replaceAll('{YEAR}', year)
    .replaceAll('[SEQ4]', seq4).replaceAll('{SEQ4}', seq4)
    .replaceAll('[SEQ6]', seq6).replaceAll('{SEQ6}', seq6);
}

/** Atomically reserve a tenant/branch/year quotation number. Gaps are allowed when a draft is cancelled. */
export async function getNextQuotationId(tenantId: string, branchId: string, branchCode: string, systemSettings: any): Promise<string> {
  if (!tenantId || !branchId || !branchCode) throw new Error('Tenant and branch are required to number a quotation.');
  const configuredFormat = systemSettings?.numberingFormats?.Quotation || 'QUO-[BRANCH]-[YEAR]-[SEQ4]';
  const format = /(?:\[SEQ(?:4|6)\]|\{SEQ(?:4|6)\})/i.test(configuredFormat)
    ? configuredFormat
    : `${configuredFormat}-[SEQ4]`;
  const year = String(new Date().getFullYear());
  const safeBranchCode = String(branchCode).replace(/[^a-zA-Z0-9_-]/g, '_');
  const counterId = [tenantId, branchId, year].map(value => encodeURIComponent(value)).join('__');
  const counterRef = doc(db, 'pos_quotation_counters', counterId);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await runTransaction(db, async transaction => {
        const counterSnap = await transaction.get(counterRef);
        let sequence = Math.max(0, Number(counterSnap.data()?.lastSequence || 0));
        let quotationId = '';
        let quotationRef;
        for (let reservationAttempt = 0; reservationAttempt < 100; reservationAttempt += 1) {
          sequence += 1;
          quotationId = formatQuotationId(format, safeBranchCode, year, sequence);
          if (!quotationId || quotationId.includes('/')) throw new Error('Quotation numbering format produced an invalid document ID.');
          quotationRef = doc(db, 'pos_quotations', quotationId);
          const existing = await transaction.get(quotationRef);
          if (!existing.exists()) break;
          quotationRef = undefined;
        }
        if (!quotationRef) throw new Error('Could not reserve a unique quotation number. Check the quotation numbering format.');

        const counter = { tenantId, branchId, branchCode: safeBranchCode, year, lastSequence: sequence, updatedAt: serverTimestamp() };
        if (counterSnap.exists()) transaction.update(counterRef, counter);
        else transaction.set(counterRef, counter);
        return quotationId;
      });
    } catch (error) {
      // Firestore may surface a concurrent counter create/increment as a rules
      // denial instead of an abort. Re-read and reserve against the latest value;
      // the same tenant and monotonic-increment rules are checked on every retry.
      const code = String((error as { code?: unknown })?.code || '');
      const retryableContention = ['permission-denied', 'already-exists', '6', '7'].includes(code);
      if (!retryableContention || attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw new Error('Could not reserve a unique quotation number. Please retry.');
}

export async function createQuotationDraft(params: {
  tenantId: string;
  branchId: string;
  quotationId: string;
  actorUid: string;
  data: Record<string, unknown>;
}): Promise<void> {
  const { tenantId, branchId, quotationId, actorUid, data } = params;
  if (!tenantId || !branchId || !quotationId || !actorUid) throw new Error('Tenant, branch, quotation number and authenticated operator are required.');
  if (auth.currentUser?.uid !== actorUid) throw new Error('The quotation operator does not match the signed-in user.');
  if (data.tenantId !== tenantId || data.branchId !== branchId || data.status !== 'Draft' || data.createdBy !== actorUid) {
    throw new Error('Quotation draft authority or status is invalid.');
  }
  const branchRef = doc(db, 'branches', branchId);
  const quotationRef = doc(db, 'pos_quotations', quotationId);
  await runTransaction(db, async transaction => {
    const [branch, existing] = await Promise.all([transaction.get(branchRef), transaction.get(quotationRef)]);
    if (!branch.exists() || branch.data().tenantId !== tenantId) throw new Error('The active branch does not belong to this tenant.');
    if (existing.exists()) {
      const prior = existing.data();
      if (data.saveRequestId && prior.saveRequestId === data.saveRequestId
        && prior.tenantId === tenantId && prior.branchId === branchId && prior.createdBy === actorUid && prior.status === 'Draft') return;
      throw new Error('This quotation number is already in use. Reopen the quotation preview to reserve another number.');
    }
    transaction.set(quotationRef, omitUndefinedDeep(data));
  });
}
