import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPosChannelEvidence} from '../src/domain/finance/portfolioPosEvidence';
const row={tenantId:'mp',branchId:'masaka',paymentId:'payment_1',source:'POS',engineVersion:2,currency:'UGX',
 saleId:'sale_1',receiptNumber:'R-100',amount:1500,settledAmount:1400,outstandingAmount:100,
 createdAt:'2026-10-30T10:00:00Z',
 components:[
 {method:'cash',amount:500,settledAmount:500,outstandingAmount:0},
 {method:'mtn_momo',amount:900,settledAmount:900,outstandingAmount:0},
 {method:'institutional_credit',amount:100,settledAmount:0,outstandingAmount:100}
 ]};
test('canonical POS component selection excludes credit and never mints a portfolio balance',()=>{
 const cash=projectPosChannelEvidence('payment_1',row,'mp','masaka','cash');
 const momo=projectPosChannelEvidence('payment_1',row,'mp','masaka','momo');
 assert.equal(cash?.settledUGX,500);
 assert.equal(momo?.settledUGX,900);
 assert.equal(cash?.fundingPosted,false);
 assert.equal(projectPosChannelEvidence('payment_1',row,'mp','masaka','airtel'),null);
});
test('reject inconsistent, mismatched and noncanonical POS records',()=>{
 assert.throws(()=>projectPosChannelEvidence('payment_1',{...row,branchId:'other'},'mp','masaka','cash'),/scope/);
 assert.throws(()=>projectPosChannelEvidence('payment_1',{...row,settledAmount:1500},'mp','masaka','cash'),/reconcile/);
 assert.throws(()=>projectPosChannelEvidence('payment_1',{...row,engineVersion:1},'mp','masaka','cash'),/canonical/);
});
