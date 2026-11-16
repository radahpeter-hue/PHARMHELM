import test from 'node:test';
import assert from 'node:assert/strict';
import { manualStockOrderWrites } from '../src/services/manualStockOrderPolicy';
const order = {tenantId:'tenant-a',inventoryClass:'OPERATIONAL',status:'draft'};
const line = {tenantId:'tenant-a',inventoryClass:'OPERATIONAL',product_id:'pens',masterItemId:'master',qty_ordered:1,unit_cost_ugx:12000,line_total_ugx:12000};
test('manual order retries retain header and deterministic line identity',()=>{
  assert.deepEqual(manualStockOrderWrites('request',order,[line]),manualStockOrderWrites('request',order,[line]));
  assert.equal(manualStockOrderWrites('request',order,[line])[0].data.order_id,'request');
});
test('manual orders reject mixed tenant/class, duplicate and unlinked items',()=>{
  for(const changed of [{tenantId:'other'},{inventoryClass:'SELLABLE'},{masterItemId:''},{qty_ordered:0},{qty_ordered:NaN},{unit_cost_ugx:-1},{line_total_ugx:1}]) assert.throws(()=>manualStockOrderWrites('request',order,[{...line,...changed}]));
  assert.throws(()=>manualStockOrderWrites('request',order,[line,line]));
});
test('manual orders can have hundreds of distinct products', () => {
  const lines = Array.from({ length: 501 }, (_, index) => ({ ...line, product_id: `product-${index}` }));
  assert.equal(manualStockOrderWrites('request', order, lines.slice(0, 500)).length, 500);
  assert.throws(() => manualStockOrderWrites('request', order, lines), /500 products/);
});
