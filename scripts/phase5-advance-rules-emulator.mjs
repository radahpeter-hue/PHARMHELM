import {requestAccountOpening,approveAccountOpening,postAccountOpening} from '../src/services/financeV2Opening.ts';
import {requestWelfareBenefit,approveWelfareBenefit,recognizeWelfareBenefit,settleWelfare} from '../src/services/hrWelfareSettlement.ts';
import { settleSalary, registerSalaryFundingAccount } from '../src/services/financeV2Disbursement.ts';
import assert from 'node:assert/strict';
import { requestPayrollVoid, voidUnpaidPayroll } from '../src/services/hrPayrollCorrection.ts';
import { attestPayroll as postAttestation } from '../src/services/hrPayrollApproval.ts';
// Synthetic authorization fixtures use an explicit manual assessment, never a
// claim that their arbitrary component amounts are production statutory rates.
const attestPayroll=(input,connection)=>postAttestation({...input,reason:input.reason||'Documented manual statutory assessment. Synthetic authorization fixture reviewed by HR.'},connection);
import { finalizePayrollDraft } from '../src/services/hrPayrollFinalization.ts';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';

const projectId = 'phase5-advance-rules';
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync(process.env.PHARMHELM_TEST_RULES || 'firestore.rules', 'utf8') }
});
const request = {
  tenantId: 'tenant-a',
  staffId: 'employee',
  staff_id: 'employee',
  branchId: 'b1',
  amount: 100000,
  amountRequested: 100000,
  amount_requested: 100000,
  reason: 'Personal advance',
  repayment_period_months: 3,
  status: 'Pending',
  hr_approval_status: 'Pending',
  ceo_approval_status: 'Pending'
};
const employee = env.authenticatedContext('employee', { tenantId: 'tenant-a', role: 'Employee' }).firestore();
const hr = env.authenticatedContext('hr', { tenantId: 'tenant-a', role: 'HR Head' }).firestore();
const logger = env.authenticatedContext('logger', { tenantId: 'tenant-a', role: 'HR Support Personnel' }).firestore();
const ceo = env.authenticatedContext('ceo', { tenantId: 'tenant-a', role: 'CEO' }).firestore();
const outsider = env.authenticatedContext('outsider', { tenantId: 'tenant-b', role: 'Finance Head' }).firestore();
const advance = doc(employee, 'advance_requests', 'advance-test');
try {
  await env.withSecurityRulesDisabled(async admin => {
    for (const [uid, role] of [['ceo','CEO'],['hr','HR Head'], ['finance','Finance Head'], ['employee','Employee'], ['outsider','Finance Head']]) {
      await setDoc(doc(admin.firestore(),'staff',uid), {tenantId:uid === 'outsider' ? 'tenant-b':'tenant-a',role,branch_id:'b1',assigned_branches:['b1']});
    }
  });
  await assertSucceeds(setDoc(advance, request));
  await assertFails(updateDoc(advance, { status: 'Disbursed' }));
  await assertFails(setDoc(doc(employee, 'advance_requests', 'forged'), { ...request, status: 'Approved' }));
  await assertFails(setDoc(doc(employee, 'advance_requests', 'negative'), { ...request, amount: -5, amountRequested: -5, amount_requested: -5 }));
  await assertFails(setDoc(doc(outsider, 'advance_requests', 'other-tenant'), { ...request, staffId: 'outsider', staff_id: 'outsider' }));
  await assertFails(updateDoc(doc(outsider, 'advance_requests', 'advance-test'), { status: 'Rejected' }));
  await assertSucceeds(updateDoc(doc(hr, 'advance_requests', 'advance-test'), { hr_approval_status: 'Approved', hr_notes: 'Reviewed', hr_reviewed_by: 'hr',hr_reviewed_at:serverTimestamp(),updatedAt:serverTimestamp() }));
  await assertFails(updateDoc(doc(hr, 'advance_requests', 'advance-test'), { status: 'Approved', amount_requested: 200000 }));
  await assertFails(updateDoc(doc(hr, 'advance_requests', 'advance-test'), { status: 'Disbursed' }));
  await assertFails(updateDoc(doc(hr, 'advance_requests', 'advance-test'), { ceo_approval_status: 'Approved', ceo_reviewed_by: 'hr', status: 'Approved' }));
  await assertSucceeds(updateDoc(doc(ceo, 'advance_requests', 'advance-test'), { ceo_approval_status: 'Approved', ceo_notes: 'Approved', ceo_reviewed_by: 'ceo',ceo_reviewed_at:serverTimestamp(),updatedAt:serverTimestamp(), status: 'Approved' }));
  await assertFails(updateDoc(doc(ceo, 'advance_requests', 'advance-test'), { amount_requested: 200000 }));
  await assertFails(setDoc(doc(hr, 'payroll', 'fake-paid'), { tenantId: 'tenant-a', staffId: 'employee', status: 'paid', net_salary: 100000 }));
  await assertFails(setDoc(doc(hr, 'payslips', 'fake-paid'), { tenantId: 'tenant-a', staffId: 'employee', netPayable: 100000 }));
  console.log('Advance approval and payroll write denials validated; checking attendance.');
  const timesheet = {
    tenantId: 'tenant-a', staffId: 'employee', staff_name: 'Test Employee',
    branch_id: 'b1', date: '2026-10-20', status: 'present', hours_worked: 8,
    check_in_time: '08:00', check_out_time: '16:00',
    loggedByUid: 'logger', approval_status: 'Submitted'
  };
  await assertSucceeds(setDoc(doc(logger, 'attendance', 'tenant-a_employee_2026-10-20'), timesheet));
  await assertFails(setDoc(doc(logger, 'attendance', 'tenant-a_employee_2026-10-21'), { ...timesheet, date: '2026-10-21', approval_status: 'Approved' }));
  await assertFails(updateDoc(doc(logger, 'attendance', 'tenant-a_employee_2026-10-20'), { approval_status: 'Approved', approvedByUid: 'logger' }));
  console.log('Attendance submitted; checking independent HR approval.');
  await assertSucceeds(updateDoc(doc(hr, 'attendance', 'tenant-a_employee_2026-10-20'), { approval_status: 'Approved', approvedByUid: 'hr' }));
  await assertFails(updateDoc(doc(hr, 'attendance', 'tenant-a_employee_2026-10-20'), { hours_worked: 10 }));
  await assertFails(updateDoc(doc(hr, 'attendance', 'tenant-a_employee_2026-10-20'), { approval_status: 'Submitted' }));
  await assertSucceeds(getDoc(doc(hr, 'advance_requests', 'advance-test')));
  console.log('Attendance approval and immutable-history denials validated; checking privacy.');
  await env.withSecurityRulesDisabled(async admin => {
    await setDoc(doc(admin.firestore(), 'payroll', 'other-payroll'), {
      tenantId: 'tenant-a', staffId: 'other-employee', branch_id:'b1',net_salary: 500000, status: 'approved_unpaid'
    });
    await setDoc(doc(admin.firestore(), 'payslips', 'other-payslip'), {
      tenantId: 'tenant-a', staffId: 'other-employee', branch_id:'b1',netPayable: 500000
    });
  });
  await assertFails(getDoc(doc(employee, 'payroll', 'other-payroll')));
  await assertFails(getDoc(doc(employee, 'payslips', 'other-payslip')));
  await assertFails(getDoc(doc(outsider, 'payroll', 'other-payroll')));
  await assertSucceeds(getDoc(doc(hr, 'payroll', 'other-payroll')));
  const finance = env.authenticatedContext('finance', {tenantId:'tenant-a',role:'Finance Head'}).firestore();
  const id = 'tenant-a_employee_2026-10';
  const snapshot = {staffId:'employee',staffName:'Test Employee',branchId:'b1',period:'2026-10',
    baseSalary:500000,bonuses:0,deductions:100000,netSalary:400000,paye:75000,
    nssfEmployee:25000,nssfEmployer:50000,advanceDeduction:0,fineDeduction:0,unpaidLeaveDeduction:0,otherDeductions:0};
  const common = {tenantId:'tenant-a',staffId:'employee',staff_name:'Test Employee',branch_id:'b1',month:'2026-10',
    period:'2026-10',payrollId:id,finalizedBy:'finance',finalizedAt:serverTimestamp(),status:'approved_unpaid',
    snapshot,approvalRevision:1,hrApprovedBy:'hr',
    baseSalary:500000,base_salary:500000,bonuses:0,deductions:100000,netSalary:400000,net_salary:400000,
    paye:75000,nssfEmployee:25000,nssfEmployer:50000,nssf_employee:25000,nssf_employer:50000,
    advanceDeduction:0,advance_deduction:0,fineDeduction:0,fine_deduction:0,unpaidLeaveDeduction:0,
    salaryExpenseUGX:500000,employerNssfExpenseUGX:50000,payePayableUGX:75000,nssfPayableUGX:75000,
    otherDeductionsPayableUGX:0,netSalaryPayableUGX:400000,accountingReference:id};
  const payrollInput = {...common};
  const payslipInput = {...common,netPayable:400000,basePay:500000,allowances:0,year:2026};
  const pair = (connection, payroll = payrollInput, payslip = payslipInput) => {
    const batch = writeBatch(connection);
    batch.set(doc(connection,'payroll',id),payroll);
    batch.set(doc(connection,'payslips',id),payslip);
    batch.set(doc(connection,'payroll',id,'state','current'),{tenantId:'tenant-a',snapshot,paidUGX:0,outstandingUGX:400000,voided:false,lastAction:'recognition',updatedAt:serverTimestamp()});
    return batch.commit();
  };
  await assertFails(pair(finance)); // Finance cannot invent an HR signature.
  const approval = {tenantId:'tenant-a',snapshot,revision:1,status:'approved',approvedBy:'hr',approvedAt:serverTimestamp(),reason:'Documented manual statutory assessment. Synthetic authorization fixture reviewed by HR.'};
  const approve = (connection, value = approval) => {
    const batch = writeBatch(connection);
    batch.set(doc(connection,'payroll_approvals',id),value);
    batch.set(doc(connection,'payroll_approvals',id,'revisions',String(value.revision)),value);
    return batch.commit();
  };
  await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'payroll_approvals',id),{...approval,revision:0,reason:'Historical generic review without statutory treatment'}));
  await assertFails(pair(finance,{...payrollInput,approvalRevision:0},{...payslipInput,approvalRevision:0}));
  await assertFails(approve(finance, {...approval,approvedBy:'finance'}));
  await assertFails(approve(outsider, {...approval,approvedBy:'outsider'}));
  await assertFails(approve(hr,{...approval,reason:'Generic reviewed flag is not statutory attestation'}));
  await assertFails(approve(hr, {...approval,snapshot:{...snapshot,advanceDeduction:1}}));
  await assertSucceeds(approve(hr));
  const rejection = {...approval, revision:2, status:'rejected'};
  await assertSucceeds(approve(hr, rejection));
  await assertFails(pair(finance));
  const superseded = {...approval, revision:3, status:'superseded'};
  await assertSucceeds(approve(hr, superseded));
  await assertFails(pair(finance));
  await assertSucceeds(approve(hr, {...approval,revision:4}));
  payrollInput.approvalRevision = 4;
  payslipInput.approvalRevision = 4;

  await assertFails(pair(hr,{...payrollInput,finalizedBy:'hr'},{...payslipInput,finalizedBy:'hr'}));
  await assertFails(pair(finance,{...payrollInput,netSalary:1,net_salary:1}));
  await assertFails(pair(finance,{...payrollInput,salaryExpenseUGX:1}));
  await assertFails(pair(finance,{...payrollInput,branch_id:'other'}));
  await assertFails(updateDoc(doc(hr,'payroll_approvals',id,'revisions','1'),{status:'rejected'}));
  const forgedBatch = writeBatch(finance);
  forgedBatch.set(doc(finance,'payroll',id),payrollInput);
  forgedBatch.set(doc(finance,'payslips',id),{...payslipInput,staffId:'other-employee'});
  await assertFails(forgedBatch.commit());
  await assertFails(setDoc(doc(finance,'payroll',id),payrollInput));
  await assertFails(setDoc(doc(finance,'payslips',id),payslipInput));
  const batch = writeBatch(finance);
  batch.set(doc(finance,'payroll',id),payrollInput);
  batch.set(doc(finance,'payslips',id),payslipInput);
  batch.set(doc(finance,'payroll',id,'state','current'),{tenantId:'tenant-a',snapshot,paidUGX:0,outstandingUGX:400000,voided:false,lastAction:'recognition',updatedAt:serverTimestamp()});
  await assertSucceeds(batch.commit());
  await assertFails(approve(hr, {...approval,revision:2}));
  await assertFails(setDoc(doc(finance,'payroll',id),payrollInput));
  await assertFails(updateDoc(doc(finance,'payroll',id),{netSalary:1}));
  await assertFails(updateDoc(doc(finance,'payslips',id),{netPayable:1}));
  await assertFails(setDoc(doc(outsider,'payroll','tenant-b_employee_2026-10'),{...payrollInput,tenantId:'tenant-b',payrollId:'tenant-b_employee_2026-10'}));
  // Exercise actual production services, including missing-record reads and transactions.
  const serviceRecord = {...snapshot, period:'2026-11', reviewed:true};
  await assert.rejects(postAttestation({tenantId:'tenant-a',actorUid:'hr',records:[serviceRecord]},hr),/statutory treatment/);
  await assertSucceeds(attestPayroll({tenantId:'tenant-a',actorUid:'hr',records:[serviceRecord]},hr));
  await assertSucceeds(finalizePayrollDraft({tenantId:'tenant-a',actorUid:'finance',records:[serviceRecord]},finance));
  await assertSucceeds(finalizePayrollDraft({tenantId:'tenant-a',actorUid:'finance',records:[serviceRecord]},finance)); // Exact service retry is a no-op; direct duplicate creates above remain denied.
  const resumable=['2027-03','2027-04'].map(period=>({...snapshot,period,reviewed:true}));
  await attestPayroll({tenantId:'tenant-a',actorUid:'hr',records:[resumable[0]]},hr);
  await assert.rejects(finalizePayrollDraft({tenantId:'tenant-a',actorUid:'finance',records:resumable},finance),/HR approval/);
  const firstFinalizedAt=(await getDoc(doc(finance,'payroll','tenant-a_employee_2027-03'))).data().finalizedAt.toMillis();
  await attestPayroll({tenantId:'tenant-a',actorUid:'hr',records:[resumable[1]]},hr);
  await assertSucceeds(finalizePayrollDraft({tenantId:'tenant-a',actorUid:'finance',records:resumable},finance));
  assert.equal((await getDoc(doc(finance,'payroll','tenant-a_employee_2027-03'))).data().finalizedAt.toMillis(),firstFinalizedAt);
  const posted = (await getDoc(doc(finance,'payroll','tenant-a_employee_2026-11'))).data();
  if (posted.netSalaryPayableUGX !== 400000 || posted.salaryExpenseUGX + posted.employerNssfExpenseUGX !==
      posted.netSalaryPayableUGX + posted.payePayableUGX + posted.nssfPayableUGX + posted.otherDeductionsPayableUGX)
    throw new Error('Salary accrual does not reconcile');
  const salaryRecord = {...snapshot,period:'2026-12',reviewed:true};
  await attestPayroll({tenantId:'tenant-a',actorUid:'hr',records:[salaryRecord]},hr);
  await finalizePayrollDraft({tenantId:'tenant-a',actorUid:'finance',records:[salaryRecord]},finance);
  const salaryId='tenant-a_employee_2026-12';
  const settlement={tenantId:'tenant-a',payrollId:salaryId,requestId:'first',accountId:'salary_bank',actorUid:'finance',
    amountUGX:100000,chargeUGX:1000,externalReference:'BANK-REF-001',recipientReference:'Test Employee verified bank',paymentDate:'2026-12-01'};
  await env.withSecurityRulesDisabled(async admin=>{
    await setDoc(doc(admin.firestore(),'finance_payment_accounts','tenant-a_salary_bank'),{
      tenantId:'tenant-a',accountId:'salary_bank',kind:'BANK',branchId:'b1',currency:'UGX',controlVersion:2,
      initialized:true,active:true,salaryEligible:true,salaryBranchIds:['b1'],balanceUGX:500000,lastPostingId:null
    });
  });
  await assertFails(settleSalary(settlement,finance)); // Release activation is independently required.
  await env.withSecurityRulesDisabled(async admin=>{
    await setDoc(doc(admin.firestore(),'system_settings','tenant-a'),{tenantId:'tenant-a',phase5SalarySettlementEnabled:true});
    await setDoc(doc(admin.firestore(),'staff','wrong-branch'),{tenantId:'tenant-a',role:'Finance Head',branch_id:'b2',assigned_branches:['b2']});
  });
  const wrongBranch=env.authenticatedContext('wrong-branch',{tenantId:'tenant-a',role:'Finance Head'}).firestore();
  await assertFails(settleSalary({...settlement,actorUid:'wrong-branch'},wrongBranch));
  await assertFails(settleSalary({...settlement,tenantId:'tenant-b',actorUid:'outsider'},outsider));
  await assertFails(settleSalary({...settlement,actorUid:'employee'},employee));
  async function rawSalary(requestId, amountUGX=1000, omit='',paymentDate=settlement.paymentDate) {
    const account=(await getDoc(doc(finance,'finance_payment_accounts','tenant-a_salary_bank'))).data();
    const state=(await getDoc(doc(finance,'payroll',salaryId,'state','current'))).data();
    const eventId=`salary_${salaryId}_${requestId}`;
    const event={...settlement,requestId,paymentDate,externalReference:('RAW-'+requestId).toUpperCase(),amountUGX,chargeUGX:0,eventId,sourceType:'SALARY_SETTLEMENT',sourceId:salaryId,
      branchId:'b1',beforeUGX:account.balanceUGX,afterUGX:account.balanceUGX-amountUGX,currency:'UGX',expenseUGX:0,createdAt:serverTimestamp()};
    const batch=writeBatch(finance);
    batch.set(doc(finance,'finance_v2_events',eventId),event);
    batch.set(doc(finance,'finance_payment_accounts','tenant-a_salary_bank','payment_references',event.externalReference),{tenantId:'tenant-a',accountId:'salary_bank',eventId,createdAt:serverTimestamp()});
    if(omit!=='settlement')batch.set(doc(finance,'payroll',salaryId,'settlements',requestId),event);
    batch.update(doc(finance,'finance_payment_accounts','tenant-a_salary_bank'),{balanceUGX:event.afterUGX,lastPostingId:eventId,updatedAt:serverTimestamp()});
    if(omit!=='state')batch.update(doc(finance,'payroll',salaryId,'state','current'),{outstandingUGX:state.outstandingUGX-amountUGX,paidUGX:state.paidUGX+amountUGX,lastAction:eventId,updatedAt:serverTimestamp()});
    if(omit!=='principal')batch.set(doc(finance,'finance_v2_account_movements',eventId+'_principal'),{tenantId:'tenant-a',eventId,accountId:'salary_bank',actorUid:'finance',purpose:'PRINCIPAL',deltaUGX:-amountUGX,beforeUGX:event.beforeUGX,afterUGX:event.afterUGX,createdAt:serverTimestamp()});
    return batch.commit();
  }
  for(const omitted of ['state','settlement','principal'])await assertFails(rawSalary('orphan_'+omitted,1000,omitted));
  await assertFails(rawSalary('fraction',1.5));
  await assertFails(rawSalary('invalid_calendar',1000,'','2026-02-31'));
  await assertFails(rawSalary('overpay',400001));
  await env.withSecurityRulesDisabled(async admin=>{await updateDoc(doc(admin.firestore(),'finance_payment_accounts','tenant-a_salary_bank'),{balanceUGX:99});});
  await assertFails(rawSalary('overdraft',1000));
  await env.withSecurityRulesDisabled(async admin=>{await updateDoc(doc(admin.firestore(),'finance_payment_accounts','tenant-a_salary_bank'),{balanceUGX:500000});});
  for(const [field,value] of [['active',false],['initialized',false],['salaryEligible',false],['kind','UNSUPPORTED']]) {
    await env.withSecurityRulesDisabled(async admin=>{await updateDoc(doc(admin.firestore(),'finance_payment_accounts','tenant-a_salary_bank'),{[field]:value});});
    await assertFails(rawSalary('invalid_'+field));
    await env.withSecurityRulesDisabled(async admin=>{await updateDoc(doc(admin.firestore(),'finance_payment_accounts','tenant-a_salary_bank'),{[field]:field==='kind'?'BANK':true});});
  }
  const partial=await assertSucceeds(settleSalary(settlement,finance));
  assert.equal(partial.replay,false);
  assert.equal((await getDoc(doc(finance,'payroll',salaryId,'state','current'))).data().outstandingUGX,300000);
  assert.equal((await getDoc(doc(finance,'finance_payment_accounts','tenant-a_salary_bank'))).data().balanceUGX,399000);
  assert.equal((await getDoc(doc(finance,'finance_v2_events',partial.eventId))).data().expenseUGX,1000);
  assert.equal((await settleSalary(settlement,finance)).replay,true);
  await assert.rejects(settleSalary({...settlement,amountUGX:99999},finance),/conflicts/);
  await assert.rejects(settleSalary({...settlement,requestId:'changed_id_duplicate'},finance),/reference is already/);
  await assert.rejects(settleSalary({...settlement,requestId:'overpay',externalReference:'OVERPAY-REF',amountUGX:300001},finance),/outstanding/);
  await assertFails(updateDoc(doc(finance,'finance_v2_events',partial.eventId),{amountUGX:1}));
  await assertFails(updateDoc(doc(finance,'finance_v2_account_movements',partial.eventId+'_principal'),{deltaUGX:0}));
  await assertFails(updateDoc(doc(finance,'finance_payment_accounts','tenant-a_salary_bank'),{balanceUGX:1}));
  await assertFails(updateDoc(doc(finance,'payroll',salaryId,'state','current'),{outstandingUGX:0}));
  const races=await Promise.allSettled(['racer-a','racer-b'].map(requestId=>settleSalary({...settlement,requestId,externalReference:requestId.toUpperCase(),amountUGX:200000,chargeUGX:0},finance)));
  assert.equal(races.filter(result=>result.status==='fulfilled').length,1,'Concurrent salary payments must not overpay');
  const full=await settleSalary({...settlement,requestId:'last',externalReference:'LAST-REF',amountUGX:100000,chargeUGX:0},finance);
  assert.equal(full.replay,false);
  assert.equal((await getDoc(doc(finance,'payroll',salaryId,'state','current'))).data().outstandingUGX,0);
  assert.equal((await getDoc(doc(finance,'finance_payment_accounts','tenant-a_salary_bank'))).data().balanceUGX,99000);
  await assert.rejects(settleSalary({...settlement,requestId:'extra',externalReference:'EXTRA-REF',amountUGX:1,chargeUGX:0},finance),/outstanding/);
  const newAccount={tenantId:'tenant-a',accountId:'new_zero',name:'Registered salary bank',kind:'BANK',branchId:'b1',openingBalanceUGX:0,reconciliationReference:'Verified zero account',actorUid:'finance'};
  await assertSucceeds(registerSalaryFundingAccount(newAccount,finance));
  await assert.rejects(registerSalaryFundingAccount({...newAccount,accountId:'forged_opening',openingBalanceUGX:100000},finance),/zero-opening/);
  const openingScope={tenantId:'tenant-a',accountId:'new_zero',actorUid:'finance'};
  const openingRequest={...openingScope,amountUGX:300000,externalReference:'OPENING-001',evidence:'Controlled emulator bank reconciliation, no existing duplicate balance.'};
  await assert.rejects(postAccountOpening(openingScope,finance),/Independent/);
  const rawOpening=(omit='')=>{const eventId='opening_tenant-a_OPENING-001',amount=openingRequest.amountUGX;const b=writeBatch(finance);b.set(doc(finance,'finance_v2_events',eventId),{...openingScope,eventId,sourceType:'ACCOUNT_OPENING',branchId:'b1',amountUGX:amount,chargeUGX:0,externalReference:'OPENING-001',beforeUGX:0,afterUGX:amount,expenseUGX:0,revenueUGX:0,currency:'UGX',createdAt:serverTimestamp()});b.update(doc(finance,'finance_payment_accounts','tenant-a_new_zero'),{balanceUGX:amount,lastPostingId:eventId,updatedAt:serverTimestamp()});if(omit!=='movement')b.set(doc(finance,'finance_v2_account_movements',eventId+'_principal'),{...openingScope,eventId,purpose:'PRINCIPAL',deltaUGX:amount,beforeUGX:0,afterUGX:amount,createdAt:serverTimestamp()});return b.commit();};
  await assertFails(rawOpening()); // No approval, despite a fully paired malicious browser batch.
  await assertSucceeds(requestAccountOpening(openingRequest,finance));
  const openingRequestDoc=(await getDoc(doc(finance,'finance_payment_accounts','tenant-a_new_zero','opening','request'))).data();
  await assertFails(setDoc(doc(finance,'finance_payment_accounts','tenant-a_new_zero','opening','approval'),{tenantId:'tenant-a',accountId:'new_zero',branchId:'b1',request:openingRequestDoc,approvedBy:'finance',reason:'Forged own approval',approvedAt:serverTimestamp()}));
  await assert.rejects(approveAccountOpening({...openingScope,reason:'Finance cannot approve own opening'},finance),/Independent/);
  await assertFails(approveAccountOpening({...openingScope,actorUid:'outsider',reason:'Cross tenant denied'},outsider));
  await assertSucceeds(approveAccountOpening({...openingScope,actorUid:'ceo',reason:'Verified test statement and unique account'},ceo));
  await assert.rejects(postAccountOpening({...openingScope,actorUid:'ceo'},ceo),/Independent/);
  await assertFails(rawOpening('movement'));
  const openingPosted=await assertSucceeds(postAccountOpening(openingScope,finance));
  assert.equal((await postAccountOpening(openingScope,finance)).replay,true);
  assert.equal((await getDoc(doc(finance,'finance_payment_accounts','tenant-a_new_zero'))).data().balanceUGX,300000);
  const openingEvent=(await getDoc(doc(finance,'finance_v2_events',openingPosted.eventId))).data();
  assert.equal(openingEvent.expenseUGX,0);assert.equal(openingEvent.revenueUGX,0);
  assert.equal((await getDoc(doc(finance,'finance_v2_account_movements',openingPosted.eventId+'_principal'))).data().deltaUGX,300000);
  await assertFails(updateDoc(doc(ceo,'finance_payment_accounts','tenant-a_new_zero','opening','approval'),{reason:'rewrite approval'}));
  await assert.rejects(requestAccountOpening({...openingRequest,amountUGX:300000},finance),/unused/);
  await assertSucceeds(registerSalaryFundingAccount({...newAccount,accountId:'duplicate_opening'},finance));
  await requestAccountOpening({...openingRequest,accountId:'duplicate_opening'},finance);
  await approveAccountOpening({...openingScope,accountId:'duplicate_opening',actorUid:'ceo',reason:'Duplicate reference attempt'},ceo);
  await assert.rejects(postAccountOpening({...openingScope,accountId:'duplicate_opening'},finance),/already used/);
  console.log('Independent opening authorization, immutable balance migration and duplicate reference denials: PASS');
  const competingRecords=['2027-01','2027-02'].map(period=>({...snapshot,period,reviewed:true}));
  await attestPayroll({tenantId:'tenant-a',actorUid:'hr',records:competingRecords},hr);
  await finalizePayrollDraft({tenantId:'tenant-a',actorUid:'finance',records:competingRecords},finance);
  const concurrent=await Promise.allSettled(competingRecords.map(record=>settleSalary({...settlement,payrollId:`tenant-a_employee_${record.period}`,requestId:'shared_funding',externalReference:'SHARED-'+record.period,amountUGX:70000,chargeUGX:0},finance)));
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1,'Competing payrolls cannot overdraw one funding account');
  assert.equal((await getDoc(doc(finance,'finance_payment_accounts','tenant-a_salary_bank'))).data().balanceUGX,29000);
  for(const kind of ['BANK','BRANCH_CASH_SALES','PETTY_CASH','MTN_MOBILE_MONEY','AIRTEL_MONEY']) {
    const accountId='kind_'+kind;
    await env.withSecurityRulesDisabled(async admin=>{await setDoc(doc(admin.firestore(),'finance_payment_accounts','tenant-a_'+accountId),{
      tenantId:'tenant-a',accountId,kind,branchId:'b1',currency:'UGX',controlVersion:2,initialized:true,active:true,
      salaryEligible:true,salaryBranchIds:['b1'],balanceUGX:10000,lastPostingId:null
    });});
    await assertSucceeds(settleSalary({...settlement,payrollId:id,accountId,requestId:kind,amountUGX:1000,chargeUGX:100},finance));
    assert.equal((await getDoc(doc(finance,'finance_payment_accounts','tenant-a_'+accountId))).data().balanceUGX,8900);
  }
  await assertFails(requestPayrollVoid({payrollId:salaryId,actorUid:'hr',reason:'Cannot void a paid payroll'},hr));
  console.log('Salary partial/full settlement, replay, concurrency, immutable journal and branch/tenant/role denials: PASS');
  const voidInput = {payrollId:'tenant-a_employee_2026-11',actorUid:'hr',reason:'Incorrect employee remuneration'};
  await assertFails(requestPayrollVoid({...voidInput,actorUid:'finance'},finance));
  await assertSucceeds(requestPayrollVoid(voidInput,hr));
  await assert.rejects(voidUnpaidPayroll({...voidInput,actorUid:'hr'},hr));
  await assertSucceeds(voidUnpaidPayroll({...voidInput,actorUid:'finance'},finance));
  await assert.rejects(voidUnpaidPayroll({...voidInput,actorUid:'finance'},finance));
  const reversed = (await getDoc(doc(finance,'payroll',voidInput.payrollId,'corrections','void'))).data();
  assert.equal(reversed.netSalaryPayableUGX + posted.netSalaryPayableUGX, 0);
  assert.equal(reversed.salaryExpenseUGX + posted.salaryExpenseUGX, 0);
  await assertFails(updateDoc(doc(finance,'payroll',voidInput.payrollId,'corrections','void'),{reason:'erase evidence'}));
  console.log('Atomic payroll + payslip creates allowed together, single writes and mutation denied');
  const welfarePayment={tenantId:'tenant-a',obligationId:'advance-test',kind:'ADVANCE',actorUid:'finance',accountId:'new_zero',requestId:'advance-first',amountUGX:100000,chargeUGX:1000,externalReference:'ADVANCE-001',recipientReference:'Verified employee bank account',paymentDate:'2026-10-22'};
  await setDoc(doc(employee,'advance_requests','unpaid-advance'),request);
  await updateDoc(doc(hr,'advance_requests','unpaid-advance'),{hr_approval_status:'Approved',hr_reviewed_by:'hr',hr_notes:'Reviewed',hr_reviewed_at:serverTimestamp(),updatedAt:serverTimestamp()});
  await updateDoc(doc(ceo,'advance_requests','unpaid-advance'),{ceo_approval_status:'Approved',ceo_reviewed_by:'ceo',ceo_notes:'Approved',status:'Approved',ceo_reviewed_at:serverTimestamp(),updatedAt:serverTimestamp()});
  await assertFails(attestPayroll({tenantId:'tenant-a',actorUid:'hr',records:[{...snapshot,period:'2028-01',advanceId:'unpaid-advance',advanceDeduction:10000,deductions:110000,netSalary:390000,reviewed:true}]},hr));
  const fundedBefore=(await getDoc(doc(finance,'finance_payment_accounts','tenant-a_new_zero'))).data().balanceUGX;
  await assertFails(settleWelfare({...welfarePayment,actorUid:'wrong-branch'},wrongBranch));
  await assertFails(settleWelfare({...welfarePayment,actorUid:'outsider'},outsider));
  await assert.rejects(settleWelfare({...welfarePayment,actorUid:'ceo'},ceo),/distinct approvals/);
  const disbursement=await assertSucceeds(settleWelfare(welfarePayment,finance));
  assert.equal((await settleWelfare(welfarePayment,finance)).replay,true);
  assert.equal((await getDoc(doc(finance,'finance_payment_accounts','tenant-a_new_zero'))).data().balanceUGX,fundedBefore-101000);
  assert.equal((await getDoc(doc(finance,'finance_v2_events',disbursement.eventId))).data().receivableUGX,100000);
  assert.equal((await getDoc(doc(finance,'finance_v2_events',disbursement.eventId))).data().expenseUGX,1000);
  await assert.rejects(settleWelfare({...welfarePayment,requestId:'second',externalReference:'ADVANCE-002'},finance),/exactly one/);
  await assertFails(updateDoc(doc(finance,'advance_requests','advance-test','state','current'),{outstandingUGX:0}));
  async function rawWelfare(input,omit='') {
    const coll=input.kind==='ADVANCE'?'advance_requests':'welfare_records';
    const root=doc(finance,coll,input.obligationId),account=doc(finance,'finance_payment_accounts','tenant-a_new_zero');
    const a=(await getDoc(account)).data(),s=(await getDoc(doc(root,'state','current'))).data();
    const eventId=(input.kind==='ADVANCE'?'advance_':'welfare_')+input.obligationId+'_'+input.requestId;
    const event={...input,eventId,sourceType:input.kind==='ADVANCE'?'ADVANCE_DISBURSEMENT':'WELFARE_SETTLEMENT',sourceId:input.obligationId,branchId:'b1',beforeUGX:a.balanceUGX,afterUGX:a.balanceUGX-input.amountUGX-input.chargeUGX,currency:'UGX',expenseUGX:input.chargeUGX,receivableUGX:input.kind==='ADVANCE'?input.amountUGX:0,createdAt:serverTimestamp()};
    const b=writeBatch(finance);b.set(doc(finance,'finance_v2_events',eventId),event);b.set(doc(root,'settlements',input.requestId),event);
    b.update(account,{balanceUGX:event.afterUGX,lastPostingId:eventId,updatedAt:serverTimestamp()});
    if(omit!=='claim')b.set(doc(account,'payment_references',input.externalReference),{tenantId:input.tenantId,accountId:input.accountId,eventId,createdAt:serverTimestamp()});
    if(omit!=='state') {
      if(input.kind==='ADVANCE')b.set(doc(root,'state','current'),{tenantId:'tenant-a',branchId:'b1',staffId:'employee',principalUGX:input.amountUGX,outstandingUGX:input.amountUGX,recoveredUGX:0,disbursementEventId:eventId,lastAction:eventId,updatedAt:serverTimestamp()});
      else b.update(doc(root,'state','current'),{outstandingUGX:s.outstandingUGX-input.amountUGX,settledUGX:s.settledUGX+input.amountUGX,lastAction:eventId,updatedAt:serverTimestamp()});
    }
    if(omit!=='principal')b.set(doc(finance,'finance_v2_account_movements',eventId+'_principal'),{tenantId:input.tenantId,eventId,accountId:input.accountId,actorUid:input.actorUid,purpose:'PRINCIPAL',deltaUGX:-input.amountUGX,beforeUGX:event.beforeUGX,afterUGX:event.beforeUGX-input.amountUGX,createdAt:serverTimestamp()});
    if(input.chargeUGX)b.set(doc(finance,'finance_v2_account_movements',eventId+'_charge'),{tenantId:input.tenantId,eventId,accountId:input.accountId,actorUid:input.actorUid,purpose:'CHARGE',deltaUGX:-input.chargeUGX,beforeUGX:event.beforeUGX-input.amountUGX,afterUGX:event.afterUGX,createdAt:serverTimestamp()});
    return b.commit();
  }
  await assertFails(rawWelfare({...welfarePayment,requestId:'raw-double',externalReference:'RAW-DOUBLE'}));
  const recoveryRecord={...snapshot,period:'2028-03',advanceId:'advance-test',advanceDeduction:40000,deductions:140000,netSalary:360000,reviewed:true};
  await attestPayroll({tenantId:'tenant-a',actorUid:'hr',records:[recoveryRecord]},hr);
  await finalizePayrollDraft({tenantId:'tenant-a',actorUid:'finance',records:[recoveryRecord]},finance);
  await finalizePayrollDraft({tenantId:'tenant-a',actorUid:'finance',records:[recoveryRecord]},finance);
  assert.equal((await getDoc(doc(finance,'advance_requests','advance-test','state','current'))).data().outstandingUGX,60000);
  const recoveryPayroll=(await getDoc(doc(finance,'payroll','tenant-a_employee_2028-03'))).data();
  assert.equal(recoveryPayroll.otherDeductionsPayableUGX,0,'Advance recovery is an asset offset, not a new payable or expense');
  const competingRecoveries=['2028-04','2028-05'].map(period=>({...recoveryRecord,period,advanceDeduction:50000,deductions:150000,netSalary:350000}));
  await attestPayroll({tenantId:'tenant-a',actorUid:'hr',records:competingRecoveries},hr);
  const recoveryRace=await Promise.allSettled(competingRecoveries.map(record=>finalizePayrollDraft({tenantId:'tenant-a',actorUid:'finance',records:[record]},finance)));
  assert.equal(recoveryRace.filter(r=>r.status==='fulfilled').length,1,'Concurrent recoveries cannot exceed principal');
  assert.equal((await getDoc(doc(finance,'advance_requests','advance-test','state','current'))).data().outstandingUGX,10000);
  await requestPayrollVoid({payrollId:'tenant-a_employee_2028-03',actorUid:'hr',reason:'Controlled recovery reversal'},hr);
  await voidUnpaidPayroll({payrollId:'tenant-a_employee_2028-03',actorUid:'finance'},finance);
  assert.equal((await getDoc(doc(finance,'advance_requests','advance-test','state','current'))).data().outstandingUGX,50000);
  assert.equal((await getDoc(doc(finance,'finance_payment_accounts','tenant-a_new_zero'))).data().balanceUGX,fundedBefore-101000,'Payroll recovery and reversal never change cash');
  await assertFails(updateDoc(doc(hr,'advance_requests','advance-test','recoveries','tenant-a_employee_2028-03'),{deltaUGX:1}));
  const benefit={tenantId:'tenant-a',id:'benefit-test',staffId:'employee',branchId:'b1',amountUGX:20000,reason:'Controlled non-repayable medical claim',actorUid:'hr'};
  await requestWelfareBenefit(benefit,hr);
  await assert.rejects(recognizeWelfareBenefit({id:benefit.id,actorUid:'finance'},finance),/approval/);
  await approveWelfareBenefit({id:benefit.id,actorUid:'ceo',reason:'Verified eligible benefit claim'},ceo);
  const bankBeforeBenefit=(await getDoc(doc(finance,'finance_payment_accounts','tenant-a_new_zero'))).data().balanceUGX;
  await recognizeWelfareBenefit({id:benefit.id,actorUid:'finance'},finance);
  await recognizeWelfareBenefit({id:benefit.id,actorUid:'finance'},finance);
  assert.equal((await getDoc(doc(finance,'finance_payment_accounts','tenant-a_new_zero'))).data().balanceUGX,bankBeforeBenefit);
  assert.equal((await getDoc(doc(finance,'welfare_records',benefit.id,'state','current'))).data().outstandingUGX,20000);
  const benefitPayment={...welfarePayment,kind:'BENEFIT',obligationId:benefit.id,requestId:'benefit-part',amountUGX:5000,chargeUGX:100,externalReference:'BENEFIT-001'};
  for(const omit of ['state','principal','claim'])await assertFails(rawWelfare({...benefitPayment,requestId:'raw-'+omit,externalReference:'RAW-'+omit.toUpperCase()},omit));
  await assertFails(rawWelfare({...benefitPayment,requestId:'fraction',amountUGX:1.5,externalReference:'RAW-FRACTION'}));
  await assertFails(rawWelfare({...benefitPayment,requestId:'overpay',amountUGX:20001,externalReference:'RAW-OVERPAY'}));
  await assertSucceeds(settleWelfare(benefitPayment,finance));
  await assert.rejects(settleWelfare({...benefitPayment,requestId:'other',externalReference:'BENEFIT-002',amountUGX:15001},finance),/outstanding/);
  await assertSucceeds(settleWelfare({...benefitPayment,requestId:'benefit-full',externalReference:'BENEFIT-FULL',amountUGX:15000,chargeUGX:0},finance));
  assert.equal((await getDoc(doc(finance,'welfare_records',benefit.id,'state','current'))).data().outstandingUGX,0);
  assert.equal((await getDoc(doc(finance,'finance_payment_accounts','tenant-a_new_zero'))).data().balanceUGX,bankBeforeBenefit-20100);
  await assertFails(updateDoc(doc(hr,'welfare_records',benefit.id),{amountUGX:1}));
  await assertFails(setDoc(doc(employee,'welfare_records','forged-benefit'),{...benefit,id:'forged-benefit',actorUid:'employee',createdAt:serverTimestamp()}));
  await assertFails(getDoc(doc(outsider,'welfare_records',benefit.id)));
  await assertFails(getDoc(doc(wrongBranch,'welfare_records',benefit.id)));
  await requestWelfareBenefit({...benefit,id:'rejected-benefit'},hr);
  await approveWelfareBenefit({id:'rejected-benefit',actorUid:'ceo',reason:'Ineligible benefit request',decision:'rejected'},ceo);
  await assert.rejects(recognizeWelfareBenefit({id:'rejected-benefit',actorUid:'finance'},finance),/approval/);
  await assertFails(updateDoc(doc(employee,'staff','employee'),{role:'Finance Head'}));
  await assertFails(updateDoc(doc(employee,'staff','finance'),{role:'Employee'}));
  await assertFails(updateDoc(doc(hr,'staff','employee'),{tenantId:'tenant-b'}));
  console.log('Welfare unpaid recognition, funded settlement, advance receivable, bounded concurrent recoveries and controlled reversal: PASS');
  console.log('Phase 5 HR privacy, approvals and forbidden payroll writes: PASS');
} finally {
  await env.cleanup();
}
