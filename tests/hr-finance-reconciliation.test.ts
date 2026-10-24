import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileHrFinance,type HrFinanceEvidence} from '../src/services/hrFinanceReconciliation';
import {toSafeCsv} from '../src/utils/csv';
const tenantId='martin-pharma-staging',branchId='masaka-staging';
function fixture():HrFinanceEvidence {
 const event=(id:string,sourceType:string,sourceId:string,amountUGX:number,beforeUGX:number,chargeUGX=0)=>({id,eventId:id,tenantId,branchId,accountId:'bank',actorUid:'finance',createdAt:{seconds:1},sourceType,sourceId,amountUGX,chargeUGX,beforeUGX,afterUGX:beforeUGX+(sourceType==='ACCOUNT_OPENING'?amountUGX:-amountUGX)-chargeUGX,expenseUGX:chargeUGX,requestId:id,externalReference:id});
 const events=[event('opening','ACCOUNT_OPENING','bank',100000,0),event('advance','ADVANCE_DISBURSEMENT','a',20000,100000),event('salary','SALARY_SETTLEMENT','p',15000,80000,100),event('benefit','WELFARE_SETTLEMENT','b',5000,64900)];
 const movements=events.flatMap(e=>[{id:e.id+'_principal',tenantId,eventId:e.id,accountId:'bank',deltaUGX:e.sourceType==='ACCOUNT_OPENING'?e.amountUGX:-e.amountUGX,beforeUGX:e.beforeUGX,afterUGX:e.afterUGX+e.chargeUGX},...(e.chargeUGX?[{id:e.id+'_charge',tenantId,eventId:e.id,accountId:'bank',deltaUGX:-e.chargeUGX,beforeUGX:e.afterUGX+e.chargeUGX,afterUGX:e.afterUGX}]:[])]);
 const p={id:'p',tenantId,branch_id:branchId,staffId:'employee',staff_name:'Employee',period:'2026-10',status:'approved_unpaid',snapshot:{dueDate:'2026-10-20',advanceId:'a'},baseSalary:50000,bonuses:0,unpaidLeaveDeduction:0,salaryExpenseUGX:50000,employerNssfExpenseUGX:5000,payePayableUGX:5000,nssfEmployee:2500,nssfPayableUGX:7500,otherDeductionsPayableUGX:2500,advanceDeduction:5000,advanceId:'a',netSalaryPayableUGX:35000};
 return {tenantId,branchIds:[branchId],payroll:[{record:p,state:{paidUGX:15000,outstandingUGX:20000,voided:false},settlements:[events[2]]}],
  advances:[{record:{id:'a',tenantId,branchId,staffId:'employee',status:'Approved',amount_requested:20000},state:{principalUGX:20000,outstandingUGX:15000,recoveredUGX:5000},settlements:[events[1]],recoveries:[{id:'p',payrollId:'p',deltaUGX:5000}]}],
  benefits:[{record:{id:'b',tenantId,branchId,staffId:'employee',amountUGX:10000},state:{principalUGX:10000,outstandingUGX:5000,settledUGX:5000},approval:{decision:'approved'},settlements:[events[3]]}],
  accounts:[{id:'bank',tenantId,branchId,accountId:'bank',name:'Masaka bank',kind:'BANK',openingBalanceUGX:0,balanceUGX:59900}],
  events:[...events,{id:'welfare_accrual_b',tenantId,branchId,actorUid:'finance',createdAt:{seconds:1},sourceType:'WELFARE_RECOGNITION',sourceId:'b',amountUGX:10000,expenseUGX:10000}],movements};
}
test('payroll, welfare, advance and funding identities reconcile without double expenses',()=>{
 const report=reconcileHrFinance(fixture(),'2026-10-23');assert.deepEqual(report.exceptions,[]);
 assert.equal(report.totals.salaryExpenseUGX,50000);assert.equal(report.totals.employerNssfUGX,5000);
 assert.equal(report.totals.salaryPaidUGX,15000);assert.equal(report.totals.salaryOutstandingUGX,20000);assert.equal(report.totals.overdueSalaryUGX,20000);
 assert.equal(report.totals.advanceOutstandingUGX,15000);assert.equal(report.totals.advanceRecoveredUGX,5000);
 assert.equal(report.totals.welfareExpenseUGX,10000);assert.equal(report.totals.welfarePaidUGX,5000);assert.equal(report.totals.chargesUGX,100);
 assert.equal(report.payrollRows[0].status,'partially settled');
});
test('missing or duplicated movements, payable drift, orphan events and excess recoveries are exceptions',()=>{
 const mutations=[
  (v:HrFinanceEvidence)=>{v.movements=v.movements.filter(m=>m.id!=='salary_principal');},
  (v:HrFinanceEvidence)=>{v.movements.push(v.movements[0]);},
  (v:HrFinanceEvidence)=>{v.payroll[0].state.outstandingUGX=1;},
  (v:HrFinanceEvidence)=>{v.payroll[0].settlements=[];},
  (v:HrFinanceEvidence)=>{v.advances[0].recoveries![0].deltaUGX=50000;},
  (v:HrFinanceEvidence)=>{v.benefits[0].state.outstandingUGX=-1;},
  (v:HrFinanceEvidence)=>{v.events.find(e=>e.id==='salary')!.expenseUGX=15100;},
  (v:HrFinanceEvidence)=>{v.payroll[0].record.payePayableUGX=-5000;v.payroll[0].record.otherDeductionsPayableUGX=12500;},
  (v:HrFinanceEvidence)=>{v.accounts[0].balanceUGX=100000;}
 ];
 for(const mutate of mutations){const value=fixture();mutate(value);assert.ok(reconcileHrFinance(value,'2026-10-23').exceptions.length>0);}
});
test('unpaid payroll reversal cancels accrual and restores the advance without a cash movement',()=>{
 const value=fixture(),p=value.payroll[0];
 p.settlements=[];p.state={paidUGX:0,outstandingUGX:0,voided:true};p.reversal={};
 for(const field of ['salaryExpenseUGX','employerNssfExpenseUGX','payePayableUGX','nssfPayableUGX','otherDeductionsPayableUGX','netSalaryPayableUGX'])p.reversal[field]=-p.record[field];
 value.advances[0].recoveries!.push({id:'void_p',payrollId:'p',deltaUGX:-5000});value.advances[0].state={principalUGX:20000,outstandingUGX:20000,recoveredUGX:0};
 value.events=value.events.filter(e=>e.id!=='salary');value.movements=value.movements.filter(m=>m.eventId!=='salary');
 const benefit=value.events.find(e=>e.id==='benefit')!;benefit.beforeUGX=80000;benefit.afterUGX=75000;
 const movement=value.movements.find(m=>m.id==='benefit_principal')!;movement.beforeUGX=80000;movement.afterUGX=75000;
 value.accounts[0].balanceUGX=75000;
 const report=reconcileHrFinance(value,'2026-10-23');assert.deepEqual(report.exceptions,[]);assert.equal(report.totals.salaryExpenseUGX,0);assert.equal(report.totals.advanceRecoveredUGX,0);assert.equal(report.payrollRows[0].status,'reversed');
});
test('approval without disbursement creates no advance receivable or cash payment',()=>{
 const value:HrFinanceEvidence={tenantId,branchIds:[branchId],payroll:[],benefits:[],accounts:[],events:[],movements:[],advances:[{record:{id:'approved',tenantId,branchId,staffId:'employee',status:'Approved',amount_requested:20000},settlements:[],recoveries:[]}]};
 const report=reconcileHrFinance(value,'2026-10-23');assert.deepEqual(report.exceptions,[]);assert.equal(report.totals.advanceOutstandingUGX,0);assert.equal(report.advanceRows[0].status,'approved undisbursed');
});
test('foreign evidence is rejected and overdue status is not invented without a due date',()=>{
 const value=fixture();value.payroll[0].record.snapshot={advanceId:'a'};const report=reconcileHrFinance(value,'2026-10-23');assert.equal(report.dueDateUnspecified,1);assert.equal(report.totals.overdueSalaryUGX,0);
 value.payroll[0].record.tenantId='foreign';assert.throws(()=>reconcileHrFinance(value,'2026-10-23'),/authorized scope/);
 assert.throws(()=>reconcileHrFinance(fixture(),'2026-02-31'),/reporting date/);
});
test('CSV exports quote user content and neutralize formulas without altering numeric amounts',()=>{
 assert.equal(toSafeCsv([['=HYPERLINK("bad")','staff, name',-100,'line\nbreak']]),'"\'=HYPERLINK(""bad"")","staff, name","-100","line\nbreak"');
});
