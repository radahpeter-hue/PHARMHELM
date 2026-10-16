import test from 'node:test';
import assert from 'node:assert/strict';
import { planCentralGrnFinance, assertSettlementDoesNotDuplicateExpense } from '../src/services/centralGrnFinanceContract';

const input = {
  tenantId: 'martin-pharma', grnId: 'grn_masaka_stage2_001', orderId: 'order-1',
  invoiceRef: 'INV-001', supplierId: 'supplier-1',
  inventoryClass: 'SELLABLE' as const, paymentType: 'cash' as const,
  lines: [{ orderLineId: 'line-1', supplierId: 'supplier-1', quantity: 12, unitCostUGX: 3500 }]
};

test('cash sellable GRN creates unpaid invoice and draft, never petty cash debit or dispatched transfer', () => {
  const plan = planCentralGrnFinance(input);
  assert.equal(plan.invoiceAmountUGX, 42000);
  assert.equal(plan.invoiceStatus, 'cash_pending_payment');
  assert.equal(plan.paymentStatus, 'Pending Payment');
  assert.equal(plan.managementPaymentDraftId, 'management_payment_draft_grn_masaka_stage2_001');
  assert.equal(plan.supplierCreditId, null);
  assert.equal(plan.pettyCashPostingAtGrn, false);
  assert.equal(plan.dispatchStatus, 'ready_for_dispatch');
  assert.deepEqual(plan.expenseRecognition, {
    consumablesOpexUGX: 0, fixedAssetAcquisitionUGX: 0, sellableInventoryAcquisitionUGX: 42000
  });
  assert.doesNotThrow(() => assertSettlementDoesNotDuplicateExpense(plan,0));
  assert.throws(() => assertSettlementDoesNotDuplicateExpense(plan,42000),/second time/);
});

test('credit sellable GRN creates payable only, not cash draft', () => {
  const plan = planCentralGrnFinance({...input,paymentType:'credit'});
  assert.equal(plan.paymentStatus,'Outstanding');
  assert.equal(plan.supplierCreditId,'supplier_credit_grn_masaka_stage2_001');
  assert.equal(plan.managementPaymentDraftId,null);
  assert.equal(plan.pettyCashPostingAtGrn,false);
});

test('operational consumables and fixed assets retain separate accounting treatment', () => {
  const plan = planCentralGrnFinance({
    ...input,inventoryClass:'OPERATIONAL',paymentType:'credit',
    lines:[
      {orderLineId:'a',supplierId:'supplier-1',quantity:3,unitCostUGX:9000,operationalType:'CONSUMABLE_OPERATIONAL'},
      {orderLineId:'b',supplierId:'supplier-1',quantity:2,unitCostUGX:40000,operationalType:'FIXED_ASSET'}
    ]
  });
  assert.equal(plan.invoiceAmountUGX,107000);
  assert.equal(plan.expenseRecognition.consumablesOpexUGX,27000);
  assert.equal(plan.expenseRecognition.fixedAssetAcquisitionUGX,80000);
  assert.equal(plan.expenseRecognition.sellableInventoryAcquisitionUGX,0);
  assert.equal(plan.dispatchStatus,'ready_for_dispatch');
});

test('reject invalid class mixing, supplier mixing, missing accounting treatment and duplicated source lines', () => {
  assert.throws(()=>planCentralGrnFinance({...input,lines:[{...input.lines[0],supplierId:'supplier-2'}]}),/different suppliers/);
  assert.throws(()=>planCentralGrnFinance({...input,lines:[input.lines[0],input.lines[0]]}),/distinct identities/);
  assert.throws(()=>planCentralGrnFinance({...input,inventoryClass:'OPERATIONAL'}),/accounting classification/);
  assert.throws(()=>planCentralGrnFinance({...input,lines:[{...input.lines[0],operationalType:'CONSUMABLE_OPERATIONAL'}]}),/cannot carry Operational/);
  assert.throws(()=>planCentralGrnFinance({...input,lines:[{...input.lines[0],quantity:0}]}),/positive whole/);
  assert.throws(()=>planCentralGrnFinance({...input,invoiceRef:''}),/invoice reference/);
  assert.throws(()=>planCentralGrnFinance({...input,grnId:'bad/grn'}),/canonical GRN/);
});
