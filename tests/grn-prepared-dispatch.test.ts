import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const grn=readFileSync(new URL('../src/services/procurementFinanceService.ts',import.meta.url),'utf8');
const dispatch=readFileSync(new URL('../src/services/grnDispatchService.ts',import.meta.url),'utf8');
const procurement=readFileSync(new URL('../src/pages/Procurement.tsx',import.meta.url),'utf8');
const stock=readFileSync(new URL('../src/pages/StockInOut.tsx',import.meta.url),'utf8');
const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');

test('GRN finalization prepares transfer but does not pretend to dispatch',()=>{
  assert.match(grn,/dispatch_status: 'ready_for_dispatch', reception_status: 'not_dispatched'/);
  assert.match(grn,/status: 'ready_for_dispatch', grn_id: ids\.grnId/);
  assert.match(grn,/status: 'ready_for_dispatch',\s*preparedAt/);
  assert.match(grn,/line_status: 'ready_for_dispatch'/);
});

test('explicit dispatch is atomic and retry-safe, without destination stock mutation',()=>{
  assert.match(dispatch,/runTransaction\(connection, async tx/);
  assert.match(dispatch,/t\.status === 'dispatched' && g\.dispatch_status === 'dispatched'/);
  assert.match(dispatch,/t\.status !== 'ready_for_dispatch'/);
  assert.match(dispatch,/tx\.update\(transferRef, \{/);
  assert.match(dispatch,/tx\.update\(grnRef, \{/);
  assert.match(dispatch,/tx\.update\(orderRef, \{/);
  assert.doesNotMatch(dispatch,/product_batches|quantityInStock|operational_inventory/);
});

test('Procurement dispatch has a separate explicit prepared-GRN action',()=>{
  assert.match(procurement,/preparedSellableOrders/);
  assert.match(procurement,/dispatchPreparedSellableGrn\(/);
  assert.match(procurement,/Confirm Physical Dispatch/);
});

test('branch Stock In cannot receive prepared inventory that has not been dispatched',()=>{
  assert.match(stock,/i\.status !== 'ready_for_dispatch'/);
  assert.match(stock,/if \(status !== 'dispatched'\) throw new Error\('This transfer has not been physically dispatched/);
});

test('rules restrict prepared transfer dispatch to canonical matching GRN and order',()=>{
  const part=rules.slice(rules.indexOf('match /transfer_invoices/{invoiceId}'),rules.indexOf('match /transfer_invoice_lines/{lineId}'));
  assert.match(part,/resource\.data\.status == 'ready_for_dispatch'/);
  assert.match(part,/request\.resource\.data\.status == 'dispatched'/);
  assert.match(part,/affectedKeys\(\)\.hasOnly/);
  assert.match(part,/data\.dispatch_status == 'dispatched'/);
});
