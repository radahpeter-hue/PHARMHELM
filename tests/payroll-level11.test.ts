import test from 'node:test';
import assert from 'node:assert/strict';
import {payableAttendance} from '../src/domain/finance/payrollAttendance';
import {payrollStatutory} from '../src/domain/finance/payrollStatutory';
import {addPayrollTotals,emptyPayrollTotals,employeePayrollStatus,finalizePayrollLine,payrollIdentity,reconcilePayroll,salaryPaymentBalance,type PayrollLine} from '../src/domain/finance/payroll';
import {calculateProfitability} from '../src/domain/finance/profitability';
import {collectCashOutflows} from '../src/domain/finance/cashOutflows';
const start='2026-11-01',end='2026-11-30';
const attendance=(date:string,extra:Record<string,unknown>={})=>({date,status:'present',verificationStatus:'approved',verifiedBy:'hr',hours_worked:8,check_in_time:'08:00',check_out_time:'16:00',...extra});
const hours=(rows:any[]=[],leaves:any[]=[])=>payableAttendance(rows,leaves,start,end,8);
const line=(extra:Partial<PayrollLine>={}):PayrollLine=>({staffId:'staff',staffName:'Employee',employeeId:'MP-1',branchId:'masaka',loggedHours:120,paidLeaveHours:0,baseSalary:360000,bonuses:0,bonusNotes:'',advanceDeduction:0,fineDeduction:0,nssfEmployee:18000,nssfEmployer:36000,paye:11400,customDeduction:0,deductions:29400,netSalary:330600,reviewed:true,...extra});

test('full and partial verified attendance earn the approved hourly rate, with no monthly fallback',()=>{
 const rows=Array.from({length:25},(_,i)=>attendance('2026-11-'+String(i+1).padStart(2,'0')));
 assert.equal(hours(rows).workedHours,200);assert.equal(hours(rows).payableHours*3000,600000);
 assert.equal(hours(rows.slice(0,15)).workedHours,120);assert.equal(hours(rows.slice(0,15)).payableHours*3000,360000);
});
test('missing, unverified and verified-zero attendance remain distinct and earn zero ordinary remuneration',()=>{
 for(const [rows,state] of [[[],'missing'],[[attendance(start,{verificationStatus:'unverified',verifiedBy:null})],'unverified'],[[attendance(start,{status:'absent',hours_worked:0})],'verified_zero']] as const){
  const result=hours([...rows]);assert.equal(result.attendanceState,state);assert.equal(result.payableHours,0);assert.ok(result.warnings.length);
 }
});
test('duplicate imports, overlaps and break-adjusted hours cannot inflate verified payable time',()=>{
 const row=attendance(start);assert.equal(hours([row,row]).workedHours,8);
 assert.equal(hours([row,attendance(start,{check_in_time:'12:00',check_out_time:'18:00',hours_worked:6})]).workedHours,10);
 const breakAdjusted=attendance(start,{check_out_time:'17:00',hours_worked:8});
 assert.equal(hours([breakAdjusted,breakAdjusted]).workedHours,8);
 const unclocked=attendance(start,{check_in_time:null,check_out_time:null});
 const ambiguous=hours([unclocked,unclocked]);assert.equal(ambiguous.workedHours,0);assert.ok(ambiguous.warnings.some(x=>x.includes('Ambiguous')));
});
test('overnight attendance is clipped to the chosen period, including an overlapping previous day',()=>{
 assert.equal(hours([attendance('2026-10-31',{check_in_time:'22:00',check_out_time:'06:00',hours_worked:8})]).workedHours,6);
 assert.equal(hours([attendance(end,{check_in_time:'22:00',check_out_time:'06:00',hours_worked:8})]).workedHours,2);
 assert.equal(hours([attendance('2026-12-01')]).payableHours,0);
});
test('approved paid leave is bounded to its actual dates and is not paid twice with attendance or duplicate leave',()=>{
 const leave={status:'Approved',leave_type:'Annual',startDate:'2026-11-01',endDate:'2026-11-05',total_days:5,created_at:'2026-10-01'};
 assert.equal(hours([], [leave]).paidLeaveHours,40);
 assert.equal(hours([attendance(start)],[leave,leave]).payableHours,40);
 assert.equal(hours([],[{...leave,startDate:'2026-10-30',endDate:'2026-11-02',total_days:4}]).paidLeaveHours,16);
 assert.equal(hours([],[{...leave,status:'Pending'}]).paidLeaveHours,0);
});
test('unpaid leave earns no absent hours and blocks conflicting paid entitlement without a second wage deduction',()=>{
 const paid={status:'Approved',leave_type:'Annual',startDate:start,endDate:start,total_days:1};
 assert.equal(hours([],[{...paid,leave_type:'Unpaid'}]).payableHours,0);
 assert.equal(hours([],[paid,{...paid,leave_type:'Unpaid'}]).payableHours,0);
 assert.equal(hours([attendance('2026-11-02')],[{...paid,leave_type:'Unpaid'}]).payableHours*3000,24000);
});
test('existing progressive PAYE and employee/employer NSSF policy remains intact',()=>{
 assert.deepEqual(payrollStatutory(360000,'Full-Time',true,true),{nssfEmployee:18000,nssfEmployer:36000,paye:11400});
 assert.deepEqual(payrollStatutory(200000,'Part-Time',true,true),{nssfEmployee:10000,nssfEmployer:20000,paye:0});
 assert.equal(payrollStatutory(410000,'Full-Time',true,false).paye,25000);
 assert.equal(payrollStatutory(12000000,'Full-Time',true,false).paye,3702000);
 assert.deepEqual(payrollStatutory(600000,'Full-Time',false,true),{nssfEmployee:0,nssfEmployer:0,paye:0});
 assert.equal(payrollStatutory(1000000,'Resident Consultant',true,true).paye,60000);
 assert.equal(payrollStatutory(1000000,'Non-Resident Consultant',true,true).paye,150000);
});
test('advances, fines and authorized tax/deduction overrides reconcile at the employee level',()=>{
 const result=finalizePayrollLine(line({advanceDeduction:10000.4,fineDeduction:2000.6,paye:5000.5,nssfEmployee:18000.5,customDeduction:500.2,bonuses:10000.4,bonusNotes:'Reviewed allowance'}));
 assert.equal(result.deductions,35503);assert.equal(result.netSalary,334497);
 assert.equal(result.baseSalary+result.bonuses,result.netSalary+result.deductions);
 assert.throws(()=>finalizePayrollLine(line({reviewed:false})),/Review/);
 assert.throws(()=>finalizePayrollLine(line({bonuses:1})),/reason/);
 assert.throws(()=>finalizePayrollLine(line({advanceDeduction:1000000})),/exceed/);
});
test('fractional hours and hourly rates round deterministically at each employee, then sum whole UGX',()=>{
 const base=600000/208*125.75;
 const lines=Array.from({length:16},(_,i)=>finalizePayrollLine(line({staffId:'staff'+i,baseSalary:base,bonuses:10.5,bonusNotes:'Allowance',paye:14.4,nssfEmployee:18000.2})));
 const total=reconcilePayroll(lines);assert.equal(total.net,lines.reduce((sum,l)=>sum+l.netSalary,0));
 assert.ok(Object.values(total).every(Number.isSafeInteger));
 const big=Array.from({length:10000},(_,i)=>({...lines[0],staffId:String(i)}));
 assert.equal(reconcilePayroll(big).net,lines[0].netSalary*10000);
 assert.throws(()=>reconcilePayroll([lines[0],lines[0]]),/unique/);
});
test('permanent payroll identities are tenant scoped, period scoped and stable across retries',async()=>{
 const first=await payrollIdentity('tenant-a',start,end);
 assert.deepEqual(await payrollIdentity('tenant-a',start,end),first);
 assert.notEqual((await payrollIdentity('tenant-b',start,end)).id,first.id);
 assert.notEqual((await payrollIdentity('tenant-a',start,'2026-11-29')).id,first.id);
 assert.match(first.reference,/^PAY-202611-/);
});
test('partial and full employee states derive from one authoritative approval and actual payments',()=>{
 assert.deepEqual(salaryPaymentBalance(800000,0,500000),{paid:500000,outstanding:300000});
 assert.deepEqual(salaryPaymentBalance(800000,500000,300000),{paid:800000,outstanding:0});
 assert.equal(employeePayrollStatus('pending_finance',0,800000),'pending_finance');
 assert.equal(employeePayrollStatus('approved',0,800000),'approved');
 assert.equal(employeePayrollStatus('partial',500000,800000),'partial');
 assert.equal(employeePayrollStatus('partial',800000,800000),'paid');
 assert.throws(()=>salaryPaymentBalance(800000,500000,300001),/exceeds/);
 assert.throws(()=>salaryPaymentBalance(800000,0,0.5),/whole UGX/);
});
test('P&L recognizes an approved gross employer cost once, without recognizing submission, returns or settlement again',()=>{
 const tenantId='tenant',id='payroll-batch';
 const employee={id:'employee',tenantId,branch_id:'masaka',payrollVersion:11,batchId:id,revision:2,staffId:'employee',periodStart:start,periodEnd:end,status:'pending_finance',base_salary:360000,gross_salary:370000,allowances:10000,net_salary:340600,nssf_employer:36000};
 const totals=addPayrollTotals(emptyPayrollTotals(),finalizePayrollLine(line({bonuses:10000,bonusNotes:'Allowance'})));
 const batch={id,tenantId,revision:2,status:'pending_finance',totals};
 const report=(status:string,extra:any={})=>calculateProfitability({payroll:[employee],finance_payroll_batches_v1:[{...batch,status}],management_expenses:[{id,tenantId,source:'hr_salary',amount:340600,status:'approved',excludeFromOpexRollup:true}],...extra},{tenantId});
 for(const status of ['draft','pending_finance','returned'])assert.equal(report(status).totals.payroll,0);
 for(const status of ['approved','partial','paid'])assert.equal(report(status,{banking_records:[{id:'salary-payment',tenantId,type:'outgoing',amount:340600,source:'Payroll salary settlement',excludeFromOpexRollup:true}]}).totals.payroll,406000);
 const legacy=calculateProfitability({payroll:[{...employee,payrollVersion:undefined,status:'paid'}]},{tenantId});
 assert.equal(legacy.totals.payroll,406000);
 assert.equal(report('approved',{finance_payroll_batches_v1:[{...batch,status:'approved',revision:1}]}).totals.payroll,0);
});
test('actual salary account movements appear once as verified cash outflows',()=>{
 const account={id:'tenant_system_mtn_mobile_money',tenantId:'tenant',accountId:'system_mtn_mobile_money',portfolioId:'system_mtn_mobile_money',name:'MTN',kind:'bank',currency:'UGX',initialized:true};
 const payment={id:'salary',tenantId:'tenant',movementId:'salary_payment_salary',actorId:'finance',accountId:account.accountId,amountUGX:500000,reference:'SAL-001',date:'2026-11-18'};
 const movement={id:payment.movementId,tenantId:'tenant',collection:'banking_records' as const,accountDocumentId:account.id,amount:500000,accountDeltaUGX:-500000,type:'outgoing',source:'Payroll salary settlement',payrollPaymentId:payment.id,postedBy:'finance',date:payment.date,reference_number:payment.reference};
 const result=collectCashOutflows({tenantId:'tenant',accounts:[account],movements:[movement,movement],supplierPayments:[],creditPayments:[],salaryPayments:[payment]});
 assert.equal(result.length,1);assert.equal(result[0].status,'posted');assert.equal(result[0].category,'Salary payment');
});

test('recovery replaces only explicitly linked historical cost after Finance approval',()=>{
 const tenantId='tenant',legacy={id:'old',tenantId,staffId:'employee',status:'paid',month:'2026-11',base_salary:360000,gross_salary:370000,allowances:10000,net_salary:340600,nssf_employer:36000};
 const employee={...legacy,id:'new',payrollVersion:11,batchId:'recovery',revision:1,periodStart:start,periodEnd:end};
 const batch={id:'recovery',tenantId,legacySourceId:'rejected',legacyPayrollIds:['old'],revision:1};
 const report=(status:string,extra:any={})=>calculateProfitability({payroll:[legacy,employee],finance_payroll_batches_v1:[{...batch,status,...extra}]},{tenantId}).totals.payroll;
 assert.equal(report('pending_finance'),406000);assert.equal(report('returned'),406000);
 for(const status of ['approved','partial','paid'])assert.equal(report(status),406000);
 assert.equal(report('approved',{legacyPayrollIds:[]}),812000);
 assert.equal(report('approved',{tenantId:'other'}),406000);
 const unrelated={...legacy,id:'unrelated',staffId:'other'};
 assert.equal(calculateProfitability({payroll:[legacy,employee,unrelated],finance_payroll_batches_v1:[{...batch,status:'approved'}]},{tenantId}).totals.payroll,812000);
});
