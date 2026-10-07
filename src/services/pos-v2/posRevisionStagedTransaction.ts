import { doc, type Firestore, type Transaction, type DocumentReference } from 'firebase/firestore';
import { omitUndefinedDeep } from '../../utils/firestoreData';

/** Read-your-writes overlay. No write reaches Firestore before flush().
 * This keeps restoration, canonical checkout and financial compensation in ONE commit.
 */
export class PosRevisionStagedTransaction {
  private snapshots = new Map<string, any>();
  private pending = new Map<string, { ref: DocumentReference; data: Record<string, any>; exists: boolean }>();
  constructor(private database: Firestore, private transaction: Transaction) {}

  async get(ref: DocumentReference): Promise<any> {
    if (!this.snapshots.has(ref.path)) this.snapshots.set(ref.path, await this.transaction.get(ref));
    const original = this.snapshots.get(ref.path);
    const staged = this.pending.get(ref.path);
    if (!staged) return original;
    return { id: ref.id, ref, exists: () => staged.exists, data: () => staged.data };
  }

  set(ref: DocumentReference, data: Record<string, any>, options?: { merge?: boolean }) {
    const previous = this.pending.get(ref.path)?.data ?? this.snapshots.get(ref.path)?.data() ?? {};
    this.pending.set(ref.path, { ref, data: options?.merge ? { ...previous, ...data } : data, exists: true });
    return this;
  }

  update(ref: DocumentReference, patch: Record<string, any>) {
    const original = this.snapshots.get(ref.path);
    const staged = this.pending.get(ref.path);
    if (!staged && !original?.exists()) throw new Error(`Cannot revise missing record ${ref.path}.`);
    return this.set(ref, { ...(staged?.data ?? original.data()), ...patch });
  }

  /** Adapter for existing, independently tested reversal executors. */
  asExecutorDatabase() {
    const self = this;
    return {
      collection: (name: string) => ({ doc: (id: string) => doc(self.database, name, id) }),
      runTransaction: async (operation: (tx: any) => any) => operation({
        get: async (ref: DocumentReference) => {
          const snap = await self.get(ref);
          return { id: snap.id, exists: snap.exists(), data: () => snap.data() };
        },
        update: (ref: DocumentReference, data: any) => self.update(ref, data),
        set: (ref: DocumentReference, data: any, options?: any) => self.set(ref, data, options),
        create: (ref: DocumentReference, data: any) => {
          if (self.pending.has(ref.path) || self.snapshots.get(ref.path)?.exists()) throw new Error(`Revision record already exists: ${ref.path}.`);
          self.set(ref, data);
        }
      })
    };
  }

  annotateFinancialWrites(requestId: string, effectiveAt: string) {
    const collections = new Set(['welfare', 'branch_expenses', 'cashTransfers', 'credit_receivables',
      'pos_payment_reversals', 'pos_welfare_reversals', 'pos_credit_reversals', 'pos_quotation_reversals']);
    for (const [path, entry] of this.pending) {
      if (collections.has(path.split('/')[0]) ||
        (['staff', 'clients'].includes(path.split('/')[0]) && 'welfare_spent' in entry.data)) {
        entry.data = { ...entry.data, atomicRevisionRequestId: requestId };
        const collection = path.split('/')[0];
        if (collection === 'welfare' || collection === 'branch_expenses') entry.data.date = effectiveAt;
        if (collection === 'branch_expenses') entry.data.expense_date = effectiveAt.slice(0, 10);
      }
    }
  }

  flush() {
    if (this.pending.size > 450) throw new Error('This receipt exceeds the atomic correction write limit. No change was saved.');
    for (const { ref, data } of this.pending.values()) this.transaction.set(ref, omitUndefinedDeep(data));
  }
}
