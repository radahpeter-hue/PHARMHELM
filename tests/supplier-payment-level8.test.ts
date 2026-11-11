import test from 'node:test';
import assert from 'node:assert/strict';
import { canSettleSupplierInvoices, eligibleSupplierFunding, supplierAccountDebit } from '../src/domain/finance/supplierPaymentPolicy';
import { collectCashOutflows, type CashMovementEvidence } from '../src/domain/finance/cashOutflows';

const tenantId = 'martin';
const staff = { tenantId, status: 'active' };

test('supplier authority follows active HQ Finance roles in the tenant', () => {
  assert.equal(canSettleSupplierInvoices({ ...staff, role: 'Finance Head' }, tenantId), true);
  assert.equal(canSettleSupplierInvoices({ ...staff, role: 'IT Head', secondaryRoles: ['Finance Officer'] }, tenantId), true);
  for (const role of ['Branch Manager', 'Cashier', 'Dispenser', 'Pharmacist', 'Branch Pharmacist']) {
    assert.equal(canSettleSupplierInvoices({ ...staff, role, secondaryRoles: ['Finance Officer'] }, tenantId), false);
  }
  for (const role of ['Admin', 'owner', 'Accountant', 'Custom Finance Operator']) {
    assert.equal(canSettleSupplierInvoices({ ...staff, role }, tenantId), false);
  }
  assert.equal(canSettleSupplierInvoices({ ...staff, role: 'Finance Head', status: 'suspended', active: true }, tenantId), false);
  assert.equal(canSettleSupplierInvoices({ ...staff, role: 'Finance Head', is_duplicate: true }, tenantId), false);
  assert.equal(canSettleSupplierInvoices({ ...staff, role: 'Finance Head' }, 'another-tenant'), false);
});

test('only the supplier principal is payable and account debit includes the charge in whole UGX', () => {
  assert.equal(supplierAccountDebit(350000, 2500), 352500);
  assert.equal(supplierAccountDebit(350000, 0), 350000);
  for (const charge of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => supplierAccountDebit(350000, charge), /whole UGX/);
  }
});

test('reconciled branch cash sales and active registered cash safes are eligible with matching scope', () => {
  const scope = { kind: 'branch' as const, branchId: 'masaka' };
  const account = {
    tenantId, currency: 'UGX', kind: 'petty_cash' as const, initialized: true, balanceUGX: 1000, scope, name: 'Masaka cash sales',
    accountId: 'system_branch_cash_sales_masaka', portfolioId: 'system_branch_cash_sales_masaka', portfolioClassification: 'cash_equivalent',
  };
  assert.equal(eligibleSupplierFunding(account, tenantId), true);
  assert.equal(eligibleSupplierFunding({ ...account, scope: { ...scope, branchId: 'other' } }, tenantId), false);
  assert.equal(eligibleSupplierFunding({ ...account, initialized: false }, tenantId), false);
  assert.equal(eligibleSupplierFunding({ ...account, currency: 'USD' }, tenantId), false);
  assert.equal(eligibleSupplierFunding({ ...account, status: 'inactive' }, tenantId), false);
  const safe = { ...account, accountId: 'custom_safe', portfolioId: 'custom_safe' };
  const portfolio = {
    tenantId, id: 'custom_safe', status: 'active' as const, origin: 'custom' as const, currency: 'UGX' as const,
    classification: 'cash_equivalent' as const, scope, allowsTransfersOut: true,
  };
  assert.equal(eligibleSupplierFunding(safe, tenantId, portfolio), true);
  assert.equal(eligibleSupplierFunding(safe, tenantId, { ...portfolio, allowsTransfersOut: false }), false);
  assert.equal(eligibleSupplierFunding(safe, tenantId, { ...portfolio, status: 'inactive' }), false);
  assert.equal(eligibleSupplierFunding({ ...safe, portfolioClassification: 'restricted_internal_fund' }, tenantId,
    { ...portfolio, classification: 'restricted_internal_fund' }), false);
});

test('supplier fees require matching payment evidence and failed or cancelled attempts stay outside outflows', () => {
  const paymentId = 'supplier_credit_settlement_payment';
  const movementId = 'credit_payment_' + paymentId;
  const account = {
    id: 'martin_system_branch_cash_sales_masaka', accountId: 'system_branch_cash_sales_masaka',
    tenantId, currency: 'UGX', initialized: true, kind: 'petty_cash', scope: { kind: 'branch', branchId: 'masaka' },
  };
  const references = { tenantId, invoiceId: 'invoice', grnId: 'grn', creditLedgerId: 'credit', externalReference: 'VOUCHER' };
  const payment = {
    ...references, id: paymentId, status: 'posted', amount: 1000, chargeUGX: 100, movementId,
    chargeMovementId: movementId + '_fee', processedBy: 'finance', paymentAccountId: account.accountId,
    paymentAccountKind: account.kind, fundingBranchId: 'masaka',
  };
  const principal: CashMovementEvidence = {
    ...references, id: movementId, paymentId, collection: 'petty_cash_ledger', supplierPosting: 'credit', supplierCharge: false,
    amount: 1000, type: 'outgoing', accountDeltaUGX: -1000, postedBy: 'finance', accountDocumentId: account.id,
    paymentAccountId: account.accountId, fundingBranchId: 'masaka', date: '2026-11-11',
  };
  const fee = {
    ...principal, id: movementId + '_fee', supplierCharge: true, amount: 100, accountDeltaUGX: -100,
    expenseCategory: 'Financial service expenses',
  };
  const report = (status: string, movements = [principal, fee, fee]) => collectCashOutflows({
    tenantId, accounts: [account], supplierPayments: [], creditPayments: [{ ...payment, status }], movements,
  });
  assert.deepEqual(report('posted').map(row => [row.status, row.amount]), [['posted', 1000], ['posted', 100]]);
  assert.equal(report('posted', [principal, { ...fee, invoiceId: 'other' }]).filter(row => row.status === 'posted').length, 1);
  assert.deepEqual(report('cancelled'), []);
  assert.deepEqual(report('failed'), []);
});
