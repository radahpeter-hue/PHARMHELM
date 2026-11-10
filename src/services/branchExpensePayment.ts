import { doc, getDocFromServer, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { kampalaBusinessDate } from '../utils/eodBusinessDate';
import { managementAccountDocumentId, stageManagementCashEntry } from './managementCashPosting';

type ExpenseAction = { tenantId: string; branchId: string; expenseId: string; actorId: string; amount: number };

export async function approveBranchExpense(input: ExpenseAction, database: Firestore = db) {
  const expense = doc(database, 'branch_expenses', input.expenseId);
  await runTransaction(database, async tx => {
    const record = (await tx.get(expense)).data();
    if (!record || record.tenantId !== input.tenantId || record.branch_id !== input.branchId ||
        record.cashPaymentVersion !== 1 || record.amount_ugx !== input.amount || String(record.status).toLowerCase() !== 'pending')
      throw new Error('The expense changed. Review it again before approving.');
    tx.update(expense, { status: 'approved', cashApprovedBy: input.actorId, cashApprovedAt: serverTimestamp() });
  });
}

export async function postBranchExpensePayment(input: ExpenseAction, database: Firestore = db) {
  const { tenantId, branchId, expenseId, actorId } = input;
  const expense = doc(database, 'branch_expenses', expenseId);
  const accountId = 'system_petty_cash_' + branchId;
  const account = doc(database, 'finance_payment_accounts', managementAccountDocumentId(tenantId, accountId));
  const postingId = 'expense_payment_' + expenseId;
  const paid = (record: Record<string, unknown> | undefined) => record?.tenantId === tenantId &&
    record.branch_id === branchId && record.amount_ugx === input.amount && record.status === 'paid' &&
    record.cashOutflowPostingId === postingId;
  try {
    await runTransaction(database, async tx => {
      const expenseSnapshot = await tx.get(expense);
      const record = expenseSnapshot.data();
      if (!record || record.tenantId !== tenantId || record.branch_id !== branchId || record.cashPaymentVersion !== 1 || record.amount_ugx !== input.amount)
        throw new Error('Select an expense eligible for payment in this branch.');
      if (paid(record)) return;
      if (record.status !== 'approved') throw new Error('Approve the expense before recording payment.');
      const amount = record.amount_ugx;
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Payment requires a positive whole UGX amount.');
      const funding = (await tx.get(account)).data();
      if (!funding || funding.tenantId !== tenantId || funding.accountId !== accountId || funding.initialized !== true ||
        funding.kind !== 'petty_cash' || funding.currency !== 'UGX' || funding.scope?.kind !== 'branch' ||
        funding.scope.branchId !== branchId || !Number.isSafeInteger(funding.balanceUGX))
        throw new Error('Reconcile the opening of this branch’s Petty Cash account in Treasury first.');
      if (funding.balanceUGX < amount) throw new Error('The branch Petty Cash account has insufficient funds.');
      stageManagementCashEntry(tx, postingId, {
        tenantId, branchId, amount, type: 'outgoing', date: kampalaBusinessDate(),
        source: String(record.description || 'Branch expense payment'), expenseCategory: record.category,
        reference_number: postingId, externalExpenseCollection: 'branch_expenses', externalExpenseId: expenseId,
      }, database, accountId, actorId);
      tx.update(expense, { status: 'paid', cashOutflowPostingId: postingId, cashPaidBy: actorId, cashPaidAt: serverTimestamp() });
    });
  } catch (error) {
    // The Rules can reject a concurrent writer before the SDK retries its transaction.
    const winner = await getDocFromServer(expense).catch(() => undefined);
    if (paid(winner?.data())) return;
    throw error;
  }
}
