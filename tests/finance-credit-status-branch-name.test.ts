import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectReceivables, receivableAgeing, receivableBalanceAt } from '../src/domain/finance/creditReceivablesPortfolio';
import { buildPosCheckoutV2Payment } from '../src/services/pos-v2/posCheckoutV2PaymentOutbox';
import { buildCreditRecognition } from '../src/domain/finance/creditRecognition';
import { calculateProfitability } from '../src/domain/finance/profitability';
import { expectedEodSales } from '../src/utils/eodExpected';
import type { Sale } from '../src/types';

const tenantId='martin';
const branchId='masaka';
const sale={id:'sale',tenantId,branchId,status:'completed',receiptNumber:'MSK-001',paymentMethod:'institutional_credit',
  secondaryPaymentMethod:'cash',secondaryAmount:200000,totalAmount:500000,timestamp:'2026-10-30T22:15:00Z',patientId:'client',
  canonicalPaymentId:'payment'};
const debt={id:'sale',tenantId,branch_id:branchId,receipt_id:'sale',debtorId:'client',debtorType:'client',
  invoice_number:'MSK-001',amount_ugx:300000,outstanding_ugx:150000,status:'outstanding',due_date:'2026-11-05',created_at:sale.timestamp};
const repayment={id:'collection',settlementId:'collection',tenantId,receivableId:'sale',amountUGX:150000,
  destinationName:'MTN Mobile Money',reference:'MM-001',recordedAt:'2026-11-06T22:15:00Z',accountDocumentId:'mtn',movementId:'movement'};

test('split credit recognition and EOD retain each tender independently',()=>{
  const method='institutional_credit';
  const payment=buildPosCheckoutV2Payment({request:{attemptId:'attempt',branchId,items:[],paymentMethod:method,
    secondaryPaymentMethod:'cash',secondaryAmount:200000,patientId:'client'},
    saleId:sale.id,receiptNumber:sale.receiptNumber,tenantId,branchId,operatorUid:'staff',authoritativeTotal:500000,paymentId:'payment'});
  const record=buildCreditRecognition(sale,payment,{tenantId,full_name:'Customer',payment_terms:'Net 30'});
  assert.equal(record.amount_ugx,300000); assert.equal(record.outstanding_ugx,300000);
  assert.equal(record.receipt_id,sale.id); assert.equal(record.invoice_number,sale.receiptNumber);
  const eod=expectedEodSales([{...sale,eodShift:{version:1,timeZone:'Africa/Kampala',businessDate:'2026-10-31',
    shiftId:'day',shiftName:'Day',startTime:'06:00',endTime:'18:00'}} as Sale],tenantId,branchId,'2026-10-31','day');
  assert.equal(eod.computedExpected.cash,200000); assert.equal(eod.computedExpected.institutional_credit,300000);
  assert.equal(eod.computedExpected.total,500000);
});

test('saved credit controls the balance, status and Kampala ageing',()=>{
  const result=inspectReceivables(tenantId,[debt],[repayment],[sale]);
  assert.equal(result.totalOutstandingUGX,150000);
  assert.equal(result.rows[0].status,'partial');
  assert.equal(result.rows[0].businessDate,'2026-10-31');
  assert.equal(result.repayments[0].businessDate,'2026-11-07');
  assert.equal(receivableBalanceAt(result.rows[0],result.repayments,'2026-11-06','2026-11-16'),300000);
  assert.equal(receivableBalanceAt(result.rows[0],result.repayments,'2026-11-07','2026-11-16'),150000);
  assert.equal(receivableBalanceAt(result.rows[0],[],'2026-11-06','2026-11-16'),null);
  assert.equal(receivableAgeing(result.rows[0].dueDate,'2026-11-16'),'1 to 30 days');
  for (const [date,bucket] of [['2026-01-01','Not yet due'],['2026-01-31','1 to 30 days'],
    ['2026-02-01','31 to 60 days'],['2026-03-02','31 to 60 days'],['2026-03-03','61 to 90 days'],
    ['2026-04-01','61 to 90 days'],['2026-04-02','Over 90 days']]) assert.equal(receivableAgeing('2026-01-01',date),bucket);
  assert.equal(receivableAgeing('','2026-11-16'),'Terms missing');
});

test('register flags missing and duplicate credit, inconsistent receiving movements and stored CRM balances',()=>{
  const unmatched={...sale,id:'missing',receiptNumber:'MSK-002'};
  const duplicate={...debt,id:'duplicate'};
  const excluded=inspectReceivables(tenantId,[debt,duplicate],[],[sale,unmatched]);
  assert.equal(excluded.totalOutstandingUGX,0);
  assert.equal(excluded.exceptions.filter(row=>row.detail.includes('Duplicate')).length,2);
  assert.equal(excluded.exceptions.filter(row=>row.detail.includes('no saved receivable')).length,1);
  const ledger=inspectReceivables(tenantId,[debt],[repayment],[sale],
    [{id:'movement',tenantId,amount:1200,accountDeltaUGX:1200,accountDocumentId:'mtn',receivableSettlementId:'collection'}],
    {client:[{id:'client',full_name:'Customer',receivablesBalanceUGX:300000}],institution:[]});
  assert.equal(ledger.totalOutstandingUGX,150000);
  assert.ok(ledger.exceptions.some(row=>row.detail.includes('receiving-account movement')));
  assert.ok(ledger.exceptions.some(row=>row.detail.includes('CRM shows')));
});

test('collections do not recognize sales revenue a second time',()=>{
  const data={sales:[{...sale,subtotal:500000,discountAmount:0,actualSaleCost:120000}]};
  const original=calculateProfitability(data,{tenantId});
  const after=calculateProfitability({...data,banking_records:[{id:'credit-collection',tenantId,branchId,date:'2026-11-07',
    source:'Credit receivable payment',type:'incoming',amount:150000,accountDeltaUGX:150000,receivableSettlementId:'payment-item'}]},{tenantId});
  assert.equal(original.netSales,500000);
  assert.equal(after.netSales,original.netSales);
  assert.equal(after.netProfit,original.netProfit);
});
