import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { approveBranchExpense, postBranchExpensePayment } from '../src/services/branchExpensePayment.ts';
import { stageManagementCashEntry } from '../src/services/managementCashPosting.ts';
import { loadCashOutflows } from '../src/services/cashOutflowReportService.ts';

const projectId = 'pharmhelm-cash-outflows-test';
const env = await initializeTestEnvironment({
  projectId, firestore: { rules: readFileSync(process.env.LEVEL7_RULES_PATH || 'firestore.rules', 'utf8') },
});
const tenantId = 'martin';
const branchId = 'masaka';
const expenseId = 'test-branch-expense';
const paymentId = 'expense_payment_' + expenseId;
const accountId = 'system_petty_cash_' + branchId;
const account = (db, key = accountId) => doc(db, 'finance_payment_accounts', tenantId + '_' + key);
const expense = db => doc(db, 'branch_expenses', expenseId);
const funding = (key, scope) => ({
  tenantId, accountId: key, portfolioId: key, scope, kind: 'petty_cash', name: key,
  currency: 'UGX', initialized: true, balanceUGX: 1000, openingBalanceUGX: 1000, lastPostingId: null,
});
const draft = { tenantId, branch_id: branchId, cashPaymentVersion: 1, status: 'Pending',
  amount_ugx: 150, category: 'allowances', description: 'Travel allowance', logged_by: 'manager' };

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const [uid, role, tenant, branches] of [
      ['finance', 'Finance Head', tenantId, [branchId]], ['manager', 'Branch Manager', tenantId, [branchId]],
      ['cashier', 'Cashier', tenantId, [branchId]], ['logistics', 'Logistics Head', tenantId, []], ['other-branch', 'Branch Manager', tenantId, ['kampala']],
      ['outsider', 'Finance Head', 'other-tenant', [branchId]],
    ]) await setDoc(doc(db, 'staff', uid), { tenantId: tenant, role, assigned_branches: branches, secondaryRoles: [] });
    await setDoc(doc(db, 'branches', branchId), { tenantId, name: 'Masaka' });
    await setDoc(account(db), funding(accountId, { kind: 'branch', branchId }));
    await setDoc(account(db, 'management_petty_cash'), funding('management_petty_cash', { kind: 'organisation' }));
  });
  const client = (uid, tenant = tenantId) => env.authenticatedContext(uid, { tenantId: tenant }).firestore();
  const finance = client('finance');
  const manager = client('manager');
  const input = { tenantId, branchId, expenseId, amount: 150 };
  await assertFails(setDoc(expense(client('other-branch')), { ...draft, logged_by: 'other-branch' }));
  await setDoc(expense(manager), draft);
  await assert.rejects(postBranchExpensePayment({ ...input, actorId: 'manager' }, manager), /Approve/);
  await assertFails(approveBranchExpense({ ...input, actorId: 'manager' }, manager));
  await approveBranchExpense({ ...input, actorId: 'finance' }, finance);
  assert.equal((await getDoc(account(finance))).data().balanceUGX, 1000);
  assert.equal((await getDoc(expense(finance))).data().status, 'approved');
  await assertFails(updateDoc(expense(finance), {
    status: 'paid', cashOutflowPostingId: paymentId, cashPaidBy: 'finance', cashPaidAt: serverTimestamp(),
  }));
  for (const [uid, db] of [['cashier', client('cashier')], ['other-branch', client('other-branch')], ['outsider', client('outsider', 'other-tenant')]])
    await assertFails(postBranchExpensePayment({ ...input, actorId: uid }, db));
  const forged = writeBatch(manager);
  stageManagementCashEntry(forged, paymentId, {
    tenantId, branchId, amount: 150, type: 'outgoing', externalExpenseCollection: 'branch_expenses',
    externalExpenseId: expenseId, expenseCategory: 'allowances',
  }, manager, accountId, 'manager');
  await assertFails(forged.commit());

  await Promise.all([
    postBranchExpensePayment({ ...input, actorId: 'manager' }, manager),
    postBranchExpensePayment({ ...input, actorId: 'finance' }, finance),
  ]);
  await postBranchExpensePayment({ ...input, actorId: 'manager' }, manager);
  assert.equal((await getDoc(account(finance))).data().balanceUGX, 850);
  assert.equal((await getDoc(expense(finance))).data().status, 'paid');
  assert.equal((await getDoc(doc(finance, 'petty_cash_ledger', paymentId))).data().externalExpenseId, expenseId);
  await assertFails(updateDoc(expense(finance), { status: 'approved' }));
  await assertFails(updateDoc(expense(finance), { amount_ugx: 151 }));

  const unfundedId = 'larger-branch-expense';
  const unfunded = doc(manager, 'branch_expenses', unfundedId);
  await setDoc(unfunded, { ...draft, amount_ugx: 1000 });
  const unfundedInput = { ...input, expenseId: unfundedId, amount: 1000 };
  await approveBranchExpense({ ...unfundedInput, actorId: 'finance' }, finance);
  await assert.rejects(postBranchExpensePayment({ ...unfundedInput, actorId: 'manager' }, manager), /insufficient funds/);
  assert.equal((await getDoc(unfunded)).data().status, 'approved');
  assert.equal((await getDoc(account(finance))).data().balanceUGX, 850);

  const hqId = 'mcpay_example';
  const hqPayment = 'expense_payment_' + hqId;
  const hqExpense = doc(finance, 'management_expenses', hqId);
  assert.equal((await getDoc(hqExpense)).exists(), false);
  const approved = { tenantId, status: 'approved', amount: 200, category: 'HQ supply', cashOutflowPostingId: hqPayment };
  await assertFails(setDoc(hqExpense, approved));
  const hq = writeBatch(finance);
  hq.set(hqExpense, approved);
  stageManagementCashEntry(hq, hqPayment, {
    tenantId, amount: 200, type: 'outgoing', source: 'HQ supply payment',
    externalExpenseCollection: 'management_expenses', externalExpenseId: hqId, expenseCategory: 'HQ supply',
  }, finance, 'management_petty_cash', 'finance');
  await hq.commit();
  assert.equal((await getDoc(account(finance, 'management_petty_cash'))).data().balanceUGX, 800);
  await assertFails(updateDoc(hqExpense, { cashOutflowPostingId: 'replacement' }));

  const duplicate = writeBatch(finance);
  stageManagementCashEntry(duplicate, hqPayment, {
    tenantId, amount: 200, type: 'outgoing', externalExpenseCollection: 'management_expenses',
    externalExpenseId: hqId, expenseCategory: 'HQ supply',
  }, finance, 'management_petty_cash', 'finance');
  await assertFails(duplicate.commit());

  const logistics = client('logistics');
  const logisticsPayment = 'logistics_payment_fuel-test';
  const fuel = writeBatch(logistics);
  fuel.set(doc(logistics, 'fuel_logs', 'fuel-test'), { tenantId, cost_ugx: 25, date: '2026-11-09' });
  stageManagementCashEntry(fuel, logisticsPayment, {
    tenantId, amount: 25, type: 'outgoing', source: 'Paid for fuel',
    externalExpenseCollection: 'fuel_logs', externalExpenseId: 'fuel-test',
  }, logistics, 'management_petty_cash', 'logistics');
  await fuel.commit();

  const payments = await getDocs(query(collection(finance, 'petty_cash_ledger'), where('tenantId', '==', tenantId)));
  assert.deepEqual(payments.docs.map(row => row.id).sort(), [hqPayment, paymentId, logisticsPayment].sort());
  const report = await loadCashOutflows(tenantId, finance);
  assert.equal(report.filter(row => row.status === 'posted').reduce((sum, row) => sum + row.amount, 0), 375);
  await assertFails(loadCashOutflows(tenantId, client('outsider', 'other-tenant')));
  console.log('Cash outflows approval, payment, replay, provenance and access checks passed.');
} finally {
  await env.cleanup();
}
