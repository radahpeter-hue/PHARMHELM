import test from 'node:test';
import assert from 'node:assert/strict';
import { planProcurementApproval, type ApprovalAddition } from '../src/services/procurementApprovalPolicy';
import type { StockOrder, StockOrderLine } from '../src/types';

const order = (status: StockOrder['status'] = 'awaiting_finance_approval'): StockOrder => ({
  id: 'order-a', tenantId: 'tenant-a', order_number: 'ORD-1',
  requesting_branch_id: 'Masaka', category: 'sellable_non_cosmetic',
  order_type: 'weekly', generation_method: 'manual', status,
  total_order_value_ugx: 3000, is_emergency: false, created_at: '',
  created_by: 'staff-a'
});
const line = (id: string, product: string, qty: number, cost: number, status: StockOrderLine['line_status'] = 'awaiting_finance_approval'): StockOrderLine => ({
  id, tenantId: 'tenant-a', order_id: 'order-a', product_id: product,
  product_name: product, qty_ordered: qty, unit_cost_ugx: cost,
  line_total_ugx: qty * cost, line_status: status
});
const substitute: ApprovalAddition = {
  productId: 'Y', supplierId: 'supplier-1', supplierName: 'Supplier 1',
  quantity: 12, unitCostUGX: 90, replacesLineId: 'line-x',
  reason: 'Approved alternative for unavailable X'
};

test('a replacement leaves the original product visibly unsupplied and approves only the substitute', () => {
  const plan = planProcurementApproval(order(), [
    line('line-x','X',20,100),
    line('line-z','Z',10,100)
  ], {
    'line-x': { qty: 0, removed: true },
    'line-z': { qty: 10, removed: false }
  }, [substitute]);
  assert.equal(plan.changes[0].removedQty, 20);
  assert.equal(plan.changes[0].replacement?.productId, 'Y');
  assert.equal(plan.approvedTotalUGX, 2080);
  assert.equal(plan.additions.length, 1);
});

test('quantity reductions preserve remaining approval and outstanding unsupplied units', () => {
  const plan = planProcurementApproval(order(), [line('line-x','X',20,100)], {
    'line-x': { qty: 12, removed: false }
  }, []);
  assert.equal(plan.changes[0].approvedQty, 12);
  assert.equal(plan.changes[0].removedQty, 8);
  assert.equal(plan.approvedTotalUGX, 1200);
});

test('already-approved internal lines count in the final order value', () => {
  const plan = planProcurementApproval(order(), [
    line('line-x','X',20,100),
    line('internal','Y',2,20,'approved')
  ], { 'line-x': {qty: 18, removed:false} }, []);
  assert.equal(plan.approvedTotalUGX, 1840);
});

test('reject duplicate products, unsourced items and unremoved substitution originals', () => {
  const lines = [line('line-x','X',20,100)];
  const edits = { 'line-x': { qty: 20, removed: false } };
  assert.throws(() => planProcurementApproval(order(),lines,edits,[substitute]), /original product must be removed/);
  assert.throws(() => planProcurementApproval(order(),lines,{ 'line-x': {qty:0,removed:true} },[{...substitute,productId:'X'}]), /already exists/);
  assert.throws(() => planProcurementApproval(order(),lines,edits,[{...substitute,replacesLineId:undefined,reason:''}]), /supplier and a reason/);
});

test('reject stale status, cross-tenant edits, invalid quantities and zero-value orders', () => {
  const lineX = line('line-x','X',20,100);
  assert.throws(() => planProcurementApproval(order('approved'),[lineX],{'line-x': {qty:20,removed:false}},[]), /awaiting financial approval/);
  assert.throws(() => planProcurementApproval(order(),[{...lineX,tenantId:'wrong'}],{'line-x': {qty:20,removed:false}},[]), /ownership/);
  assert.throws(() => planProcurementApproval(order(),[lineX],{'line-x': {qty:0.5,removed:false}},[]), /Invalid approved quantity/);
  assert.throws(() => planProcurementApproval(order(),[lineX],{'line-x': {qty:0,removed:true}},[]), /nonzero total/);
});
