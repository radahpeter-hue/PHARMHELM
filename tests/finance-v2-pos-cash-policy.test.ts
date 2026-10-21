import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPosCash,planPosCashDelta} from '../src/services/financeV2PosCashPolicy';
const sale={id:'s',tenantId:'t',branchId:'b',receiptNumber:'R',engineVersion:2,canonicalPaymentId:'p',transactionOutboxEventId:'e',total:10000,paymentMethod:'cash'};
const payment={...sale,saleId:'s',paymentId:'p',currency:'UGX',amount:10000,settledAmount:10000,outstandingAmount:0,components:[{method:'cash',amount:10000,settledAmount:10000,outstandingAmount:0,status:'settled'}]};
const event={...sale,eventId:'e',saleId:'s',paymentId:'p',eventType:'POS_SALE_COMMITTED'};
test('canonical settled cash funds location; other tender does not become cash',()=>{
 assert.equal(canonicalPosCash(sale,payment,event),10000);
 assert.equal(canonicalPosCash({...sale,paymentMethod:'card'},{...payment,paymentMethod:'card',components:[{...payment.components[0],method:'card'}]},event),0);
});
test('welfare split funds only actual cash component',()=>{
 const split={...sale,paymentMethod:'staff_welfare',secondaryPaymentMethod:'cash',secondaryAmount:4000,welfareAmount:6000};
 assert.equal(canonicalPosCash(split,{...payment,paymentMethod:'staff_welfare',components:[{...payment.components[0],method:'staff_welfare',amount:6000,settledAmount:6000},{...payment.components[0],amount:4000,settledAmount:4000}]},event),4000);
});
test('malformed, cross-tenant and unbalanced payment evidence is rejected',()=>{
 assert.throws(()=>canonicalPosCash(sale,{...payment,tenantId:'foreign'},event),/linkage/);
 assert.throws(()=>canonicalPosCash(sale,{...payment,components:[{...payment.components[0],amount:10001}]},event),/reconcile/);
 assert.throws(()=>canonicalPosCash(sale,{...payment,paymentMethod:'card'},event),/method/);
 assert.throws(()=>canonicalPosCash({...sale,total:100.5},payment,event),/whole UGX/);
});
test('corrections use only cash difference and cannot manufacture revenue or spend banked funds',()=>{
 assert.deepEqual(planPosCashDelta(20000,10000,[{saleId:'s2',paymentId:'p2',cashUGX:6000}]),{totalCashUGX:6000,deltaUGX:-4000,closingUGX:16000});
 assert.equal(planPosCashDelta(20000,10000,[{saleId:'s2',paymentId:'p2',cashUGX:10000}]).deltaUGX,0);
 assert.throws(()=>planPosCashDelta(100,10000,[{saleId:'s2',paymentId:'p2',cashUGX:0}]),/correction exceeds/);
 assert.throws(()=>planPosCashDelta(0,0,[{saleId:'s',paymentId:'p',cashUGX:1},{saleId:'s',paymentId:'p',cashUGX:1}]),/Duplicate/);
});
