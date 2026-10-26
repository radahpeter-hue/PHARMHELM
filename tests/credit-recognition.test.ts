import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreditRecognition, buildReceivablesRegister, approvedDueDate, assertCreditDebtor, creditDebtorReference } from '../src/services/creditRecognition';
import { buildPosCheckoutV2Payment } from '../src/services/pos-v2/posCheckoutV2PaymentOutbox';
const master = { tenantId:'martin', supplier_name:'Masaka Hospital', role:'billable', care_status:'active', payment_terms:'Net 30' };
const sale = {id:'sale',tenantId:'martin',branchId:'masaka',institutionId:'hospital',totalAmount:10000,receiptNumber:'MSK-1',timestamp:'2026-10-26T12:00:00Z',canonicalPaymentId:'payment'};
function payment(paid=0) { return buildPosCheckoutV2Payment({request:{attemptId:'a',branchId:'masaka',items:[],paymentMethod:'institutional_credit',...(paid !== 0 ? {secondaryPaymentMethod:'cash',secondaryAmount:paid}:{})},saleId:'sale',receiptNumber:'MSK-1',tenantId:'martin',branchId:'masaka',operatorUid:'seller',authoritativeTotal:10000,paymentId:'payment'}); }
test('full credit recognizes the debt without any cash account field',()=>{
 const r=buildCreditRecognition(sale,payment(),master);assert.equal(r.amount_ugx,10000);assert.equal(r.invoice_amount_ugx,10000);assert.equal(r.debtorId,'hospital');assert.equal(r.debtorType,'institution');assert.equal(r.due_date,null);assert.equal(r.credit_terms,'Net 30');assert.ok(!('accountId' in r));
});
test('partial credit recognizes only unpaid principal and keeps invoice total',()=>{
 const p=payment(2500),r=buildCreditRecognition(sale,p,master);assert.equal(r.amount_ugx,7500);assert.equal(p.settledAmount,2500);assert.equal(p.outstandingAmount,7500);assert.equal(p.components[0].amount,7500);assert.equal(r.invoice_amount_ugx,10000);
});
test('individual debt uses existing client identity',()=>{
 const s={...sale,institutionId:undefined,patientId:'client'};const r=buildCreditRecognition(s,payment(),{tenantId:'martin',full_name:'Peter',care_status:'active'});assert.equal(r.debtorType,'client');assert.equal(r.debtorId,'client');
});
test('institutional-pay client must use canonical biller',()=>assert.throws(()=>assertCreditDebtor(creditDebtorReference({patientId:'client'}),{tenantId:'martin',full_name:'Peter',billing_type:'institutional-pay'},'martin','masaka')));
for(const changes of [{tenantId:'other'}, {care_status:'blacklisted'}, {active:false}, {creditEligible:false}, {role:'primary_care'}, {branch_id:'other'}])test(`invalid debtor denied ${JSON.stringify(changes)}`,()=>assert.throws(()=>buildCreditRecognition(sale,payment(),{...master,...changes})));
for(const amount of [-1,0.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1,'5000',10000,11000])test(`invalid partial payment ${String(amount)} rejected`,()=>assert.throws(()=>payment(amount as number)));
test('forged source and payment amounts are rejected',()=>{
 for(const changes of [{saleId:'wrong'},{tenantId:'other'},{branchId:'other'},{paymentId:'wrong'},{outstandingAmount:11000},{amount:0.5}])assert.throws(()=>buildCreditRecognition(sale,{...payment(),...changes},master));
});
test('due dates derive only from snapshotted recognized terms; unknown dates stay unknown',()=>{
 assert.equal(approvedDueDate(sale.timestamp,'Net 30'),'2026-11-25');assert.equal(approvedDueDate(sale.timestamp,'Credit — 60 Days'),'2026-12-25');assert.equal(approvedDueDate(sale.timestamp,null),null);assert.equal(approvedDueDate(sale.timestamp,'Monthly'),null);
});
test('CRM rename is live while debtor ID and source snapshot remain immutable',()=>{
 const r={...buildCreditRecognition(sale,payment(),master),id:'sale'};const rows=buildReceivablesRegister([r],[sale],[],[{...master,id:'hospital',supplier_name:'Renamed Hospital',institution_phone:'0700'}],[{id:'masaka',name:'Masaka'}]);assert.equal(rows[0].client_name,'Renamed Hospital');assert.equal(rows[0].contact,'0700');assert.equal(rows[0].verified,true);assert.equal(r.client_name,'Masaka Hospital');
});
test('duplicates and legacy rows are excluded from verified balances',()=>{
 const r={...buildCreditRecognition(sale,payment(),master),id:'sale'};const rows=buildReceivablesRegister([r,{...r,id:'copy'}],[sale],[],[],[]);assert.ok(rows.every(r=>!r.verified));assert.ok(buildReceivablesRegister([{...r,controlVersion:undefined}],[sale],[],[],[]).every(r=>!r.verified));
});
test('missing recognition is an exception rather than synthetic outstanding money',()=>{
 const rows=buildReceivablesRegister([{id:'old',receipt_id:'unknown',amount_ugx:5000,due_date:'2026-01-01'}],[{...sale,paymentMethod:'institutional_credit'}],[],[],[]);assert.equal(rows.length,2);assert.equal(rows[1].outstanding_ugx,undefined);assert.equal(rows[0].due_date,null);
});

test('the established sale clientId alias retains canonical customer identity',()=>{
 const r=buildCreditRecognition({...sale,institutionId:undefined,clientId:'client'},payment(),{tenantId:'martin',full_name:'Peter',care_status:'active'});assert.equal(r.debtorId,'client');assert.equal(r.client_id,'client');
});
