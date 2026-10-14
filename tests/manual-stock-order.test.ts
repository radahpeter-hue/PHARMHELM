import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { manualStockOrderWrites } from '../src/services/manualStockOrderPolicy';
const order = {tenantId:'tenant-a',inventoryClass:'OPERATIONAL'};
const line = {tenantId:'tenant-a',inventoryClass:'OPERATIONAL',product_id:'pens',masterItemId:'master',qty_ordered:1,unit_cost_ugx:12000,line_total_ugx:12000};
test('manual order retries retain header and deterministic line identity',()=>{
  assert.deepEqual(manualStockOrderWrites('request',order,[line]),manualStockOrderWrites('request',order,[line]));
  assert.equal(manualStockOrderWrites('request',order,[line])[0].data.order_id,'request');
});
test('manual orders reject mixed tenant/class, duplicate and unlinked items',()=>{
  for(const changed of [{tenantId:'other'},{inventoryClass:'SELLABLE'},{masterItemId:''},{qty_ordered:0},{qty_ordered:NaN},{unit_cost_ugx:-1},{line_total_ugx:1}]) assert.throws(()=>manualStockOrderWrites('request',order,[{...line,...changed}]));
  assert.throws(()=>manualStockOrderWrites('request',order,[line,line]));
});
test('new manual orders write the header and all lines in one batch',()=>{
  const service=readFileSync(new URL('../src/services/manualStockOrderService.ts',import.meta.url),'utf8').split('export async function persistManualStockOrderDraft')[0];
  assert.match(service,/writeBatch\(connection\)/);
  assert.match(service,/batch\.set\(doc\(connection, 'stock_orders'/);
  assert.match(service,/batch\.set\(doc\(connection, 'stock_order_lines'/);
  assert.equal(service.match(/batch\.commit\(\)/g)?.length,1);
});
