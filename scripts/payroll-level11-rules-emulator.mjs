import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocs,query,setDoc,updateDoc,deleteDoc,where,writeBatch,serverTimestamp} from 'firebase/firestore';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Isolated Firestore emulator required.');
mkdirSync('node_modules/.cache/payroll-emulator',{recursive:true});
await build({entryPoints:['src/services/payrollFinanceService.ts'],outfile:'node_modules/.cache/payroll-emulator/service.js',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'emulator-only',setup(b){b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db={};export const auth={currentUser:null};'}));}}]});
const {submitPayroll,reviewPayroll,paySalary,getPayrollRevision,payrollEmployeeKey}=await import('../node_modules/.cache/payroll-emulator/service.js');
const env=await initializeTestEnvironment({projectId:'demo-pharmhelm-payroll11',firestore:{rules:readFileSync(process.env.PAYROLL_RULES || 'firestore.rules','utf8')}});
const tenantId='martin-test';
const admin=async fn=>{let result;await env.withSecurityRulesDisabled(async ctx=>{result=await fn(ctx.firestore());});return result;};
const get=(path,id)=>admin(async db=>(await getDoc(doc(db,path,id))).data());
const hr=env.authenticatedContext('hr').firestore(),finance=env.authenticatedContext('finance').firestore();
const line=(id,extra={})=>({staffId:id,staffName:'Employee '+id,employeeId:'MP-'+id,branchId:'masaka',loggedHours:120,paidLeaveHours:0,baseSalary:360000,bonuses:0,bonusNotes:'',advanceDeduction:10000,fineDeduction:2000,nssfEmployee:18000,nssfEmployer:36000,paye:11400,customDeduction:0,deductions:41400,netSalary:318600,reviewed:true,...extra});
const submit=(lines,extra={})=>({tenantId,actorId:'hr',actorName:'HR Test',periodStart:'2026-11-01',periodEnd:'2026-11-30',lines,...extra});
const accountId='system_mtn_mobile_money';
const pay=(batch,staffId,amountUGX,suffix,extra={})=>({tenantId,batchId:batch.id,revision:batch.revision,staffId,actorId:'finance',accountId,amountUGX,reference:'SAL/TEST '+suffix,requestId:'payroll_request_000000_'+suffix,...extra});
let checks=0;
const pass=s=>{checks++;console.log('PASS '+s);};
try{
 await env.clearFirestore();
 await admin(async db=>{
  for(const [id,role,tenant,active,branches] of [['hr','HR Head',tenantId,true,[]],['finance','Finance Head',tenantId,true,[]],['employee1','Cashier',tenantId,true,['masaka']],['employee2','Cashier',tenantId,true,['masaka']],['foreign','Finance Head','outside',true,[]],['inactive','Finance Head',tenantId,false,[]],['restricted','Finance Officer',tenantId,true,['other']]]){
   await setDoc(doc(db,'staff',id),{tenantId:tenant,role,active,status:active?'active':'inactive',assigned_branches:branches,...(id.startsWith('employee')?{branch_id:'masaka'}:{})});
  }
  await setDoc(doc(db,'branches','masaka'),{tenantId,status:'Active'});
  await setDoc(doc(db,'finance_payment_accounts',tenantId+'_'+accountId),{tenantId,accountId,portfolioId:accountId,name:'MTN Payroll Test',kind:'bank',portfolioClassification:'mobile_money',scope:{kind:'organisation'},initialized:true,currency:'UGX',balanceUGX:2000000,openingBalanceUGX:2000000,lastPostingId:null});
 });
 const intent=submit([line('employee1'),line('employee2')]);
 const result=await submitPayroll(intent,hr);
 let batch=await get('finance_payroll_batches_v1',result.id);
 assert.equal(batch.status,'pending_finance');assert.equal(batch.totals.net,637200);assert.equal(batch.paidUGX,0);
 const draft=await get('management_expenses',batch.id);assert.equal(draft.amount,batch.totals.net);assert.equal(draft.excludeFromOpexRollup,true);
 assert.equal((await get('payroll',payrollEmployeeKey(batch.id,'employee1'))).status,'pending_finance');
 assert.equal((await get('finance_payment_accounts',tenantId+'_'+accountId)).balanceUGX,2000000);
 pass('complete HR submission, authoritative totals, Finance linkage and no premature payment');
 assert.equal((await submitPayroll(intent,hr)).replayed,true);
 await assert.rejects(submitPayroll(submit([line('employee1',{bonuses:1,bonusNotes:'changed'}),line('employee2')]),hr));
 assert.equal((await admin(db=>getDocs(collection(db,'management_expenses')))).size,1);
 pass('submission retries and conflicting revision prevention');
 await assert.rejects(paySalary(pay(batch,'employee1',100,'unapproved'),finance));
 for(const actorId of ['hr','employee1','foreign','inactive','restricted'])await assert.rejects(reviewPayroll({tenantId,batchId:batch.id,revision:1,actorId,action:'approve'},env.authenticatedContext(actorId).firestore()));
 await assertFails(updateDoc(doc(finance,'payroll',payrollEmployeeKey(batch.id,'employee1')),{status:'paid',net_salary:1}));
 await assertFails(updateDoc(doc(hr,'finance_payroll_batches_v1',batch.id),{status:'paid'}));
 await assertFails(updateDoc(doc(finance,'management_expenses',batch.id),{amount:1}));
 pass('unapproved settlement, unauthorized approval and direct total/status tampering rejected');
 await assert.rejects(reviewPayroll({tenantId,batchId:batch.id,revision:1,actorId:'finance',action:'return',reason:''},finance));
 await reviewPayroll({tenantId,batchId:batch.id,revision:1,actorId:'finance',action:'return',reason:'Correct employee allowance'},finance);
 batch=await get('finance_payroll_batches_v1',batch.id);assert.equal(batch.status,'returned');
 assert.equal((await getPayrollRevision(batch,hr)).length,2);
 const corrected=submit([line('employee1',{bonuses:10000.4,bonusNotes:'Authorized allowance'}),line('employee2')],{batchId:batch.id});
 const second=await submitPayroll(corrected,hr);assert.equal(second.id,batch.id);assert.equal(second.revision,2);
 batch=await get('finance_payroll_batches_v1',batch.id);assert.equal(batch.totals.net,647200);
 assert.equal((await admin(db=>getDocs(collection(db,'finance_payroll_lines_v1')))).size,4);
 assert.equal((await admin(db=>getDocs(collection(db,'payroll')))).size,2);
 pass('mandatory return reason, same-ID resubmission, employee uniqueness and immutable revision history');
 const approval={tenantId,batchId:batch.id,revision:2,actorId:'finance',action:'approve'};
 await reviewPayroll(approval,finance);assert.equal((await reviewPayroll(approval,finance)).replayed,true);
 assert.equal((await get('finance_payroll_batches_v1',batch.id)).status,'approved');
 await assert.rejects(reviewPayroll({...approval,revision:1},finance));
 await assert.rejects(submitPayroll(submit([line('employee1'),line('employee2')]),hr));
 pass('Finance approval is separate, revision-bound and exactly once');
 const first=pay(batch,'employee1',200000,'first');await paySalary(first,finance);
 let employee=await get('payroll',payrollEmployeeKey(batch.id,'employee1'));assert.equal(employee.status,'partial');assert.equal(employee.paidUGX,200000);
 assert.equal((await get('finance_payment_accounts',tenantId+'_'+accountId)).balanceUGX,1800000);
 assert.equal((await paySalary(first,finance)).replayed,true);
 for(const change of [{amountUGX:1},{staffId:'employee2'},{reference:'different-ref'}])await assert.rejects(paySalary({...first,...change},finance));
 await assert.rejects(paySalary(pay(batch,'employee1',128601,'over'),finance));
 pass('partial settlement, selected funding deduction, persistent replay and overpayment protection');
 const races=await Promise.allSettled([paySalary(pay(batch,'employee1',100000,'race1'),finance),paySalary(pay(batch,'employee1',100000,'race2'),finance)]);
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
 employee=await get('payroll',payrollEmployeeKey(batch.id,'employee1'));assert.equal(employee.paidUGX,300000);
 await paySalary(pay(batch,'employee1',28600,'final1'),finance);
 await paySalary(pay(batch,'employee2',318600,'final2'),finance);
 batch=await get('finance_payroll_batches_v1',batch.id);assert.equal(batch.status,'paid');assert.equal(batch.paidUGX,batch.totals.net);
 assert.equal((await get('payslips',payrollEmployeeKey(batch.id,'employee1'))).paidUGX,328600);
 assert.equal((await get('finance_payment_accounts',tenantId+'_'+accountId)).balanceUGX,1352800);
 pass('concurrent overpayment protection, full settlement, synchronized batch/employee/payslip balances');
 const employeeDb=env.authenticatedContext('employee1').firestore();
 assert.equal((await getDocs(query(collection(employeeDb,'payslips'),where('tenantId','==',tenantId),where('staffId','==','employee1')))).size,1);
 await assertFails(getDoc(doc(employeeDb,'payslips',payrollEmployeeKey(batch.id,'employee2'))));
 await assertFails(getDocs(query(collection(employeeDb,'payslips'),where('tenantId','==',tenantId))));
 await assertFails(getDoc(doc(employeeDb,'finance_payroll_batches_v1',batch.id)));
 assert.equal((await getDoc(doc(employeeDb,'finance_payroll_status_v1',batch.id))).data().status,'paid');
 await assertFails(getDoc(doc(env.authenticatedContext('foreign').firestore(),'finance_payroll_batches_v1',batch.id)));
 await assertFails(deleteDoc(doc(finance,'finance_payroll_events_v1',batch.id+'_r2_approve')));
 pass('employee payslip privacy, tenant isolation and immutable financial audit');
 // Verify that the security rules reject a complete forged transaction, independently of frontend policy.
 const extraResult=await submitPayroll(submit([line('employee1')],{periodStart:'2026-12-01',periodEnd:'2026-12-31'}),hr);
 let extraBatch=await get('finance_payroll_batches_v1',extraResult.id);
 const forge=async(amount,suffix)=>{
  const key=payrollEmployeeKey(extraBatch.id,'employee1');
  const currentRow=await get('payroll',key),currentBatch=await get('finance_payroll_batches_v1',extraBatch.id);
  const account=await get('finance_payment_accounts',tenantId+'_'+accountId);
  const reference='FORGED_'+suffix,paymentId='salary_'+tenantId+'__'+accountId+'__'+reference;
  const requestId='payroll_forged_request_'+suffix,movementId='salary_payment_'+paymentId,date=new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Kampala'});
  const payment={tenantId,batchId:extraBatch.id,staffId:'employee1',revision:currentBatch.revision,actorId:'finance',accountId,amountUGX:amount,reference,requestId,paymentId,
   accountDocumentId:tenantId+'_'+accountId,accountKind:'bank',accountName:account.name,movementId,branchId:'masaka',
   paidBeforeUGX:currentRow.paidUGX,paidAfterUGX:currentRow.paidUGX+amount,batchPaidBeforeUGX:currentBatch.paidUGX,
   batchPaidAfterUGX:currentBatch.paidUGX+amount,outstandingUGX:currentRow.line.netSalary-currentRow.paidUGX-amount,recordedAt:serverTimestamp(),date};
  const status=payment.batchPaidAfterUGX===currentBatch.totals.net?'paid':'partial';
  const employeeStatus=payment.paidAfterUGX===currentRow.line.netSalary?'paid':'partial';
  const writes=writeBatch(finance);
  writes.set(doc(finance,'finance_payroll_payments_v1',paymentId),payment);
  writes.set(doc(finance,'finance_payroll_payment_requests_v1',requestId),{tenantId,requestId,paymentId,actorId:'finance',recordedAt:serverTimestamp()});
  writes.set(doc(finance,'banking_records',movementId),{tenantId,portfolioId:accountId,accountDocumentId:payment.accountDocumentId,accountDeltaUGX:-amount,amount,type:'outgoing',source:'Payroll salary settlement',excludeFromOpexRollup:true,payrollPaymentId:paymentId,batchId:extraBatch.id,payrollReference:currentBatch.reference,staffId:'employee1',branchId:'masaka',reference_number:reference,postedBy:'finance',date,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  writes.update(doc(finance,'finance_payment_accounts',payment.accountDocumentId),{balanceUGX:account.balanceUGX-amount,lastPostingId:movementId,updatedAt:serverTimestamp()});
  for(const path of ['payroll','payslips'])writes.update(doc(finance,path,key),{paidUGX:payment.paidAfterUGX,status:employeeStatus,lastPaymentId:paymentId,...(employeeStatus==='paid'?{paid_date:date}:{})});
  writes.update(doc(finance,'finance_payroll_batches_v1',extraBatch.id),{paidUGX:payment.batchPaidAfterUGX,status,lastPaymentId:paymentId,updatedAt:serverTimestamp()});
  writes.set(doc(finance,'finance_payroll_status_v1',extraBatch.id),{tenantId,batchId:extraBatch.id,revision:currentBatch.revision,status});
  return writes.commit();
 };
 const originalBalance=(await get('finance_payment_accounts',tenantId+'_'+accountId)).balanceUGX;
 await assertFails(forge(1,'UNAPPROVED'));
 await reviewPayroll({tenantId,batchId:extraBatch.id,revision:1,actorId:'finance',action:'approve'},finance);
 await assertFails(forge(318601,'OVERPAY'));
 assert.equal((await get('finance_payment_accounts',tenantId+'_'+accountId)).balanceUGX,originalBalance);
 pass('direct atomic unapproved and overpayment forgery rejected without account or salary changes');

 // Positive funding controls exercise bank registry and branch-scoped accounts, beyond the organisation MoMo path.
 const bank='bank_'+'a'.repeat(64),airtel='system_airtel_mobile_money',branchCash='system_branch_cash_sales_masaka';
 await admin(async db=>{
  for(const [id,kind,classification,scope] of [[bank,'bank','bank',{kind:'organisation'}],[airtel,'bank','mobile_money',{kind:'organisation'}],[branchCash,'petty_cash','cash_equivalent',{kind:'branch',branchId:'masaka'}]]){
   await setDoc(doc(db,'finance_payment_accounts',tenantId+'_'+id),{tenantId,accountId:id,portfolioId:id,name:id,kind,portfolioClassification:classification,scope,initialized:true,currency:'UGX',balanceUGX:500000,openingBalanceUGX:500000,lastPostingId:null});
  }
  await setDoc(doc(db,'finance_portfolios_v1',tenantId+'__'+bank),{tenantId,id:bank,status:'active',origin:'custom',classification:'bank',currency:'UGX',scope:{kind:'organisation'},bankParentId:'system_bank',allowsTransfersOut:true});
 });
 await paySalary(pay(extraBatch,'employee1',100000,'BANK',{accountId:bank}),finance);
 await paySalary(pay(extraBatch,'employee1',100000,'AIRTEL',{accountId:airtel}),finance);
 await paySalary(pay(extraBatch,'employee1',118600,'BRANCH',{accountId:branchCash}),finance);
 for(const [id,balance] of [[bank,400000],[airtel,400000],[branchCash,381400]])assert.equal((await get('finance_payment_accounts',tenantId+'_'+id)).balanceUGX,balance);
 pass('actual individual bank, Airtel Money and matched branch account settlement');

 await admin(async db=>{
  const writes=writeBatch(db);
  for(let i=0;i<130;i++)if(i!==3){const id='bulk'+String(i).padStart(3,'0');writes.set(doc(db,'staff',id),{tenantId,role:'Cashier',active:true,status:'active',branch_id:'masaka'});}
  await writes.commit();
 });
 const bigLines=Array.from({length:130},(_,i)=>line('bulk'+String(i).padStart(3,'0'),{baseSalary:1000.6,nssfEmployee:0,nssfEmployer:0,paye:0,advanceDeduction:0,fineDeduction:0}));
 const bigIntent=submit(bigLines,{periodStart:'2027-01-01',periodEnd:'2027-01-31'});
 await assert.rejects(submitPayroll(bigIntent,hr));
 const bigId=tenantId+'_PAY_2027-01-01_2027-01-31';
 assert.equal((await get('finance_payroll_batches_v1',bigId)).nextIndex,3);
 assert.equal(await get('management_expenses',bigId),undefined);
 await admin(db=>setDoc(doc(db,'staff','bulk003'),{tenantId,role:'Cashier',active:true,status:'active',branch_id:'masaka'}));
 const resumed=await submitPayroll(bigIntent,hr);
 assert.equal(resumed.revision,1);
 assert.equal((await get('finance_payroll_batches_v1',bigId)).totals.net,130130);
 assert.equal((await getPayrollRevision(await get('finance_payroll_batches_v1',bigId),hr)).length,130);
 pass('130-employee payroll exceeds a single write batch safely and resumes after an interrupted line');

 const incomplete=submit([line('employee1'),line('zzmissing')],{periodStart:'2027-02-01',periodEnd:'2027-02-28'});
 await assert.rejects(submitPayroll(incomplete,hr));
 await admin(db=>setDoc(doc(db,'staff','zzmissing'),{tenantId,role:'Cashier',active:true,status:'active',branch_id:'masaka'}));
 const replacement={...incomplete,lines:[line('employee1',{bonuses:100,bonusNotes:'Reviewed correction'}),line('zzmissing')]};
 await assert.rejects(submitPayroll(replacement,hr));
 const restarted=await submitPayroll({...replacement,restartIncomplete:true},hr);
 assert.equal(restarted.revision,2);
 assert.equal((await get('finance_payroll_events_v1',restarted.id+'_r2_restart')).previousStagedEmployees,1);
 pass('an incomplete staging plan can only be replaced by an explicit audited HR restart');

 // Existing logs without verification never become payable merely by having a present flag.
 const attendanceRef=doc(hr,'attendance','attendance-test');
 await setDoc(attendanceRef,{tenantId,staffId:'employee1',branch_id:'masaka',date:'2026-11-01',status:'present',hours_worked:8,check_in_time:'08:00',check_out_time:'16:00',verificationStatus:'unverified',verifiedBy:null,verifiedAt:null});
 await assertFails(updateDoc(doc(employeeDb,'attendance','attendance-test'),{verificationStatus:'approved',verifiedBy:'employee1',verifiedAt:serverTimestamp()}));
 await updateDoc(attendanceRef,{verificationStatus:'approved',verifiedBy:'hr',verifiedAt:serverTimestamp()});
 await assertFails(updateDoc(attendanceRef,{hours_worked:20}));
 await updateDoc(attendanceRef,{hours_worked:7,verificationStatus:'unverified',verifiedBy:null,verifiedAt:null});
 assert.equal((await get('attendance','attendance-test')).verificationStatus,'unverified');
 await assertFails(setDoc(doc(employeeDb,'leave_requests','fake-paid-leave'),{tenantId,staffId:'employee1',status:'Approved',leave_type:'Annual'}));
 await assertFails(setDoc(doc(employeeDb,'payslips','fake'),{tenantId,staffId:'employee1',netPayable:1000000}));
 pass('attendance requires HR verification, edits revoke verification and employees cannot approve their own paid leave');
 console.log(`PAYROLL LEVEL 11: ${checks} acceptance groups passed.`);
}finally{await env.cleanup();}
