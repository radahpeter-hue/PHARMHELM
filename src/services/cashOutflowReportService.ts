import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { collectCashOutflows } from '../domain/finance/cashOutflows';

export async function loadCashOutflows(tenantId: string, database: Firestore = db) {
  if (!tenantId) throw new Error('A tenant is required.');
  const read = async (path: string) => {
    const snapshot = await getDocs(query(collection(database, path), where('tenantId', '==', tenantId)));
    return snapshot.docs.map(row => ({ ...row.data(), id: row.id }));
  };
  const [accounts, cash, bank, supplierPayments, creditPayments] = await Promise.all([
    read('finance_payment_accounts'), read('petty_cash_ledger'), read('banking_records'),
    read('cash_grn_payments'), read('creditPayments'),
  ]);
  return collectCashOutflows({ tenantId, accounts, supplierPayments, creditPayments, movements: [
    ...cash.map(row => ({ ...row, collection: 'petty_cash_ledger' as const })),
    ...bank.map(row => ({ ...row, collection: 'banking_records' as const })),
  ] });
}
