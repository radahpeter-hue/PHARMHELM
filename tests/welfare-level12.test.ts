import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reserveWelfare,type WelfareEmployee} from '../src/domain/finance/welfareFund';
import {calculateProfitability} from '../src/domain/finance/profitability';
import {collectCashOutflows} from '../src/domain/finance/cashOutflows';
const employee:WelfareEmployee={kind:'employee',tenantId:'tenant',staffId:'a',branchId:'masaka',allocatedUGX:0,utilizedUGX:0,recalledUGX:0,committedUGX:0,balanceUGX:0,lastEventId:''};
test('full Level 12 arithmetic preserves cash versus reservations',()=>{
 let fund={balanceUGX:1000000,reservedUGX:0};let a=employee,b={...employee,staffId:'b'};
 const post=(person:WelfareEmployee,type:'allocation'|'recall'|'utilization',amount:number)=>{const next=reserveWelfare(fund,person,type,amount);fund={balanceUGX:next.balanceUGX,reservedUGX:next.reservedUGX};return next.employee;};
 a=post(a,'allocation',300000);b=post(b,'allocation',200000);a=post(a,'utilization',100000);a=post(a,'recall',100000);b=post(b,'allocation',50000);fund.balanceUGX-=200000;
 assert.deepEqual(fund,{balanceUGX:700000,reservedUGX:350000});assert.equal(a.balanceUGX,100000);assert.equal(b.balanceUGX,250000);assert.equal(fund.balanceUGX-fund.reservedUGX,350000);
});
test('recalls and utilization cannot consume committed reservations',()=>{
 const a={...employee,allocatedUGX:100000,balanceUGX:100000,committedUGX:80000};
 for(const type of ['recall','utilization'] as const){assert.throws(()=>reserveWelfare({balanceUGX:100000,reservedUGX:100000},a,type,20001),/uncommitted/);assert.equal(reserveWelfare({balanceUGX:100000,reservedUGX:100000},a,type,20000).employee.balanceUGX,80000);}
});
test('allocations reject fractions, negatives and overdraw',()=>{
 for(const amount of [0,-1,0.5,NaN,Infinity,101])assert.throws(()=>reserveWelfare({balanceUGX:100,reservedUGX:0},employee,'allocation',amount));
});
test('actual welfare expense recognized once while internal funding is excluded',()=>{
 const expense={id:'we_test',tenantId:'tenant',branch_id:'masaka',category:'Staff Welfare',amount:100000,status:'paid',expense_date:'2026-11-27'};
 const result=calculateProfitability({branch_expenses:[expense],petty_cash_ledger:[{id:'funding',tenantId:'tenant',amount:1000000,type:'outgoing',accountingClassification:'internal_transfer',excludeFromOpexRollup:true}]},{tenantId:'tenant'});
 assert.equal(result.totals.payroll,100000);
});
test('cash report excludes funding principal and includes utilization once',()=>{
 const account={id:'tenant_system_welfare_fund',tenantId:'tenant',accountId:'system_welfare_fund',portfolioId:'system_welfare_fund',name:'Welfare Fund',initialized:true,currency:'UGX',kind:'petty_cash',scope:{kind:'organisation'}};
 const movement={id:'we_test',tenantId:'tenant',collection:'petty_cash_ledger' as const,accountDocumentId:account.id,amount:100000,accountDeltaUGX:-100000,type:'outgoing',source:'Welfare utilization',welfareEventId:'we_test',date:'2026-11-27',postedBy:'finance',reference_number:'WELFARE-001'};
 const rows=collectCashOutflows({tenantId:'tenant',accounts:[account],movements:[movement,movement,{...movement,id:'funding',welfareRequisitionId:'wf_test'}],supplierPayments:[],creditPayments:[]});
 assert.equal(rows.length,1);assert.equal(rows[0].amount,100000);assert.equal(rows[0].status,'posted');
});
