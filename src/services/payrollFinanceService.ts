import {payrollRecordView} from '../domain/finance/payrollRecordView';
import {collection,doc,getDocs,query,runTransaction,serverTimestamp,where,type Firestore} from 'firebase/firestore';
import {auth,db} from '../firebase';
import {PAYROLL_BATCHES,PAYROLL_STATUS,PAYROLL_LINES,PAYROLL_EVENTS,PAYROLL_PAYMENTS,emptyPayrollTotals,finalizePayrollLine,
  addPayrollTotals,reconcilePayroll,payrollDigest,payrollIdentity,salaryPaymentBalance,type PayrollLine,type PayrollStatus,type PayrollTotals} from '../domain/finance/payroll';
import {eligibleSupplierFunding,isRegisteredSupplierPortfolio} from '../domain/finance/supplierPaymentPolicy';
import {fundingDocumentId,ledgerCollectionForPortfolioKind} from '../domain/finance/portfolioFundingService';
import {portfolioRef} from '../domain/finance/portfolioFirestore';
import {kampalaBusinessDate} from '../utils/eodBusinessDate';

export interface PayrollBatch {
  id: string; tenantId: string; reference: string; periodStart: string; periodEnd: string; month: string;
  revision: number; status: PayrollStatus; employeeCount: number; nextIndex: number; totals: PayrollTotals;
  paidUGX: number; submittedBy: string; submittedByName: string; planHash: string;
  returnReason?: string; approvedAt?: any; submittedAt?: any; [key: string]: any;
}
function authenticated(actorId: string,database: Firestore) {
  if (!actorId || (database === db && auth.currentUser?.uid !== actorId)) throw new Error('Sign in as the processing user.');
}
const revisionKey = (id: string,revision: number) => id + '_r' + revision;
export const payrollEmployeeKey = (batchId: string,staffId: string) => batchId + '__' + staffId;
const publicStatus = (batch:PayrollBatch) => ({tenantId:batch.tenantId,batchId:batch.id,revision:batch.revision,status:batch.status});
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function employeeRecord(batch: PayrollBatch,line: PayrollLine,index: number) {
  return clean({tenantId:batch.tenantId,payrollVersion:11,batchId:batch.id,payrollReference:batch.reference,
    revision:batch.revision,index,staffId:line.staffId,branch_id:line.branchId,
    periodStart:batch.periodStart,periodEnd:batch.periodEnd,month:batch.month,
    line,paidUGX:0,status:'pending_finance'});
}

/** Each employee advances a rules-checked accumulator. Only a complete revision can reach Finance.
 * Transactions are bounded to five writes, independently of payroll size. Retrying resumes the same plan. */
export async function submitPayroll(input:{tenantId:string;actorId:string;actorName:string;periodStart:string;periodEnd:string;
  lines:PayrollLine[];batchId?:string;restartIncomplete?:boolean},database: Firestore=db) {
  authenticated(input.actorId,database);
  const lines=input.lines.map(finalizePayrollLine).sort((a,b)=>a.staffId<b.staffId?-1:a.staffId>b.staffId?1:0);
  const totals=reconcilePayroll(lines);
  const identity=await payrollIdentity(input.tenantId,input.periodStart,input.periodEnd);
  if(input.batchId && input.batchId!==identity.id)throw new Error('A correction must retain the original payroll period and ID.');
  const planHash=await payrollDigest(lines);
  const batchRef=doc(database,PAYROLL_BATCHES,identity.id);
  const draftRef=doc(database,'management_expenses',identity.id);
  let batch=await runTransaction(database,async tx=>{
    const prior=await tx.get(batchRef);
    if(prior.exists()){
      const current=prior.data() as PayrollBatch;
      if(current.tenantId!==input.tenantId)throw new Error('Payroll belongs to a different tenant.');
      const restart=current.status==='draft' && current.planHash!==planHash && input.restartIncomplete===true;
      if(current.status!=='returned' && !restart){
        if(current.planHash!==planHash)throw new Error('A different payroll revision already exists for this period. Return it to HR before changing it.');
        return current;
      }
      const next={...current,status:'draft' as const,revision:current.revision+1,nextIndex:0,totals:emptyPayrollTotals(),
        employeeCount:lines.length,planHash,submittedBy:input.actorId,submittedByName:input.actorName};
      tx.set(batchRef,{...next,updatedAt:serverTimestamp()});tx.set(doc(database,PAYROLL_STATUS,next.id),publicStatus(next));
      if(restart)tx.set(doc(database,PAYROLL_EVENTS,revisionKey(next.id,next.revision)+'_restart'),{tenantId:next.tenantId,batchId:next.id,revision:next.revision,action:'restart',actorId:input.actorId,recordedAt:serverTimestamp(),totals:next.totals,previousPlanHash:current.planHash,previousStagedEmployees:current.nextIndex,reason:'HR replaced incomplete staging after reviewing a new payroll draft'});
      return next;
    }
    const created:PayrollBatch={id:identity.id,tenantId:input.tenantId,reference:identity.reference,
      periodStart:input.periodStart,periodEnd:input.periodEnd,month:input.periodEnd.slice(0,7),revision:1,
      status:'draft',employeeCount:lines.length,nextIndex:0,totals:emptyPayrollTotals(),paidUGX:0,
      submittedBy:input.actorId,submittedByName:input.actorName,planHash};
    tx.set(batchRef,{...created,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});tx.set(doc(database,PAYROLL_STATUS,created.id),publicStatus(created));return created;
  });
  if(batch.status!=='draft')return {id:identity.id,revision:batch.revision,replayed:true};
  for(let index=batch.nextIndex;index<lines.length;index++){
    const line=lines[index];
    await runTransaction(database,async tx=>{
      const live=await tx.get(batchRef);const current=live.data() as PayrollBatch;
      if(current.planHash!==planHash || current.revision!==batch.revision)throw new Error('Payroll revision changed; reload HR.');
      if(current.nextIndex>index)return;
      if(current.status!=='draft'||current.nextIndex!==index)throw new Error('Payroll staging order changed; retry submission.');
      const key=payrollEmployeeKey(identity.id,line.staffId);
      const record=employeeRecord(current,line,index);
      const nextTotals=addPayrollTotals(current.totals,line);
      const snapshotRef=doc(database,PAYROLL_LINES,revisionKey(identity.id,current.revision)+'__'+line.staffId);
      tx.set(snapshotRef,{...record,stagedAt:serverTimestamp()});
      tx.set(doc(database,'payroll',key),record);
      tx.set(doc(database,'payslips',key),record);
      tx.update(batchRef,{nextIndex:index+1,totals:nextTotals,lastStaffId:line.staffId,updatedAt:serverTimestamp()});
    });
  }
  await runTransaction(database,async tx=>{
    const live=await tx.get(batchRef);const current=live.data() as PayrollBatch;
    if(current.planHash!==planHash || current.revision!==batch.revision)throw new Error('Payroll revision changed.');
    if(current.status==='pending_finance')return;
    if(current.status!=='draft'||current.nextIndex!==lines.length||JSON.stringify(current.totals)!==JSON.stringify(totals)){
      // Firestore map key order is not a contract.
      if(current.status!=='draft'||current.nextIndex!==lines.length||Object.keys(totals).some(k=>current.totals[k]!==totals[k]))throw new Error('Payroll employee totals do not reconcile.');
    }
    const now=serverTimestamp();
    tx.update(batchRef,{status:'pending_finance',submittedAt:now,updatedAt:now});
    tx.set(doc(database,PAYROLL_STATUS,current.id),publicStatus({...current,status:'pending_finance'}));
    tx.set(draftRef,{tenantId:input.tenantId,payrollVersion:11,batchId:identity.id,payrollReference:identity.reference,
      revision:current.revision,source:'hr_salary',sourceType:'hr',category:'Salaries - Payroll Disbursal',department:'HR',
      description:`Payroll ${identity.reference}: ${input.periodStart} to ${input.periodEnd} (${lines.length} employees)`,
      amount:totals.net,amount_ugx:totals.net,employeeCount:lines.length,status:'pending',
      logged_by:input.actorName,submittedBy:input.actorId,expense_date:kampalaBusinessDate(),created_at:new Date().toISOString(),
      excludeFromOpexRollup:true});
    tx.set(doc(database,PAYROLL_EVENTS,revisionKey(identity.id,current.revision)+'_submitted'),{
      tenantId:input.tenantId,batchId:identity.id,revision:current.revision,action:'submitted',actorId:input.actorId,
      recordedAt:now,totals,employeeCount:lines.length,planHash});
  });
  return {id:identity.id,revision:batch.revision,replayed:false};
}

export async function reviewPayroll(input:{tenantId:string;batchId:string;revision:number;actorId:string;action:'approve'|'return';reason?:string},database:Firestore=db){
  authenticated(input.actorId,database);
  const reason=(input.reason||'').trim();
  if(input.action==='return'&&reason.length<5)throw new Error('Enter a correction reason of at least five characters.');
  const batchRef=doc(database,PAYROLL_BATCHES,input.batchId);
  const eventRef=doc(database,PAYROLL_EVENTS,revisionKey(input.batchId,input.revision)+'_'+input.action);
  return runTransaction(database,async tx=>{
    const [live,prior,draft]=await Promise.all([tx.get(batchRef),tx.get(eventRef),tx.get(doc(database,'management_expenses',input.batchId))]);
    const batch=live.data() as PayrollBatch;
    if(!batch||batch.tenantId!==input.tenantId||batch.revision!==input.revision)throw new Error('Payroll revision changed; reopen the draft.');
    if(prior.exists()){
      if(prior.data().actorId!==input.actorId||prior.data().reason!==reason)throw new Error('Approval identity conflicts with a previous action.');
      return {replayed:true};
    }
    if(batch.status!=='pending_finance'||draft.data()?.revision!==input.revision||draft.data()?.amount!==batch.totals.net||batch.nextIndex!==batch.employeeCount)throw new Error('Only a complete submitted revision can be reviewed.');
    const now=serverTimestamp();
    tx.update(batchRef,{status:input.action==='approve'?'approved':'returned',updatedAt:now,
      ...(input.action==='approve'?{approvedAt:now,approvedBy:input.actorId}: {returnReason:reason,returnedAt:now,returnedBy:input.actorId})});
    tx.set(doc(database,PAYROLL_STATUS,batch.id),publicStatus({...batch,status:input.action==='approve'?'approved':'returned'}));
    tx.update(doc(database,'management_expenses',input.batchId),{status:input.action==='approve'?'approved':'rejected'});
    tx.set(eventRef,{tenantId:input.tenantId,batchId:input.batchId,revision:input.revision,action:input.action,
      actorId:input.actorId,reason,recordedAt:now,totals:batch.totals});
    return {replayed:false};
  });
}

export async function getPayrollRevision(batch:PayrollBatch,database:Firestore=db){
  const rows=await getDocs(query(collection(database,PAYROLL_LINES),where('tenantId','==',batch.tenantId),
    where('batchId','==',batch.id),where('revision','==',batch.revision)));
  return rows.docs.map(d=>payrollRecordView({...d.data(),id:d.id})).sort((a:any,b:any)=>a.index-b.index) as any[];
}

export async function paySalary(input:{tenantId:string;batchId:string;staffId:string;revision:number;actorId:string;
  accountId:string;amountUGX:number;reference:string;requestId:string},database:Firestore=db){
  authenticated(input.actorId,database);
  const reference=input.reference.trim();
  if(!/^[A-Za-z0-9_-]{20,100}$/.test(input.requestId)||reference.length<3||reference.length>120)throw new Error('A persistent payment ID and valid payment reference are required.');
  const key=payrollEmployeeKey(input.batchId,input.staffId);
  const batchRef=doc(database,PAYROLL_BATCHES,input.batchId),employeeRef=doc(database,'payroll',key);
  // The same external reference on the same account is a persistent duplicate-payment guard.
  const paymentId='salary_'+input.tenantId+'__'+input.accountId+'__'+reference.toUpperCase().replace(/[^A-Z0-9_-]/g,'_');
  const paymentRef=doc(database,PAYROLL_PAYMENTS,paymentId);
  const requestRef=doc(database,'finance_payroll_payment_requests_v1',input.requestId);
  return runTransaction(database,async tx=>{
    const [prior,request]=await Promise.all([tx.get(paymentRef),tx.get(requestRef)]);
    if(request.exists()&&request.data().paymentId!==paymentId)throw new Error('This payment request ID is already in use.');
    if(prior.exists()){
      if(Object.entries({...input,reference}).some(([key,value])=>prior.data()[key]!==value))throw new Error('Payment reference conflicts with a previous salary transaction.');
      return {replayed:true,paymentId};
    }
    const accountRef=doc(database,'finance_payment_accounts',fundingDocumentId(input.tenantId,input.accountId));
    const [live,employee,funding]=await Promise.all([tx.get(batchRef),tx.get(employeeRef),tx.get(accountRef)]);
    const batch=live.data() as PayrollBatch,row=employee.data(),account=funding.data() as any;
    if(!batch||batch.tenantId!==input.tenantId||batch.revision!==input.revision||!['approved','partial'].includes(batch.status)||
      !row||row.tenantId!==input.tenantId||row.revision!==batch.revision||row.batchId!==input.batchId)throw new Error('Only an approved current salary obligation can be paid.');
    const portfolio=isRegisteredSupplierPortfolio(input.accountId)?(await tx.get(portfolioRef(database,input.tenantId,input.accountId))).data():undefined;
    if(!account||!eligibleSupplierFunding(account,input.tenantId,portfolio))throw new Error('Select an active reconciled payment account.');
    if(account.scope?.kind==='branch'&&account.scope.branchId!==row.branch_id)throw new Error('The funding branch must match this employee allocation.');
    if(account.balanceUGX<input.amountUGX)throw new Error('Insufficient funds in the selected account.');
    const balance=salaryPaymentBalance(row.line.netSalary,row.paidUGX,input.amountUGX);
    const paidUGX=batch.paidUGX+input.amountUGX;
    const now=serverTimestamp(),date=kampalaBusinessDate(),movementId='salary_payment_'+paymentId;
    const employeeUpdate={paidUGX:balance.paid,status:balance.outstanding===0?'paid':'partial',lastPaymentId:paymentId,
      ...(balance.outstanding===0?{paid_date:date}:{})};
    tx.set(paymentRef,{...input,reference,paymentId,accountDocumentId:accountRef.id,accountKind:account.kind,
      accountName:account.name,movementId,branchId:row.branch_id,paidBeforeUGX:row.paidUGX,paidAfterUGX:balance.paid,
      batchPaidBeforeUGX:batch.paidUGX,batchPaidAfterUGX:paidUGX,outstandingUGX:balance.outstanding,recordedAt:now,date});
    tx.set(requestRef,{tenantId:input.tenantId,requestId:input.requestId,paymentId,actorId:input.actorId,recordedAt:now});
    tx.set(doc(database,ledgerCollectionForPortfolioKind(account.kind),movementId),{
      tenantId:input.tenantId,portfolioId:input.accountId,accountDocumentId:accountRef.id,accountDeltaUGX:-input.amountUGX,
      amount:input.amountUGX,type:'outgoing',source:'Payroll salary settlement',excludeFromOpexRollup:true,
      payrollPaymentId:paymentId,batchId:input.batchId,payrollReference:batch.reference,staffId:input.staffId,branchId:row.branch_id,
      reference_number:reference,postedBy:input.actorId,date,createdAt:now,updatedAt:now});
    tx.update(accountRef,{balanceUGX:account.balanceUGX-input.amountUGX,lastPostingId:movementId,updatedAt:now});
    tx.update(employeeRef,employeeUpdate);
    tx.update(doc(database,'payslips',key),employeeUpdate);
    const status=paidUGX===batch.totals.net?'paid':'partial';
    tx.update(batchRef,{paidUGX,status,lastPaymentId:paymentId,updatedAt:now});
    if(status!==batch.status)tx.set(doc(database,PAYROLL_STATUS,batch.id),publicStatus({...batch,status}));
    return {replayed:false,paymentId};
  });
}
