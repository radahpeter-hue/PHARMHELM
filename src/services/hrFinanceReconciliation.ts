/** Read-only current-position reconciliation. The review date tests overdue status;
 * it does not pretend current state is a historical point-in-time balance. */
export type FinanceRow = Record<string,any> & {id:string};
export interface ObligationEvidence {record:FinanceRow;state?:any;settlements:FinanceRow[];recoveries?:FinanceRow[];reversal?:any;approval?:any;}
export interface HrFinanceEvidence {tenantId:string;branchIds:string[];payroll:ObligationEvidence[];advances:ObligationEvidence[];benefits:ObligationEvidence[];accounts:FinanceRow[];events:FinanceRow[];movements:FinanceRow[];}
export interface PayrollFinanceRow {id:string;employee:string;staffId:string;branchId:string;period:string;grossUGX:number;salaryExpenseUGX:number;employerNssfUGX:number;payeUGX:number;employeeNssfUGX:number;otherDeductionsUGX:number;advanceRecoveryUGX:number;netPayableUGX:number;paidUGX:number;outstandingUGX:number;status:string;dueDate:string;overdue:boolean;}
export function reconcileHrFinance(input:HrFinanceEvidence,asOfDate:string) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)||Number.isNaN(Date.parse(asOfDate))||new Date(asOfDate).toISOString().slice(0,10)!==asOfDate)throw new Error('Valid reporting date required.');
 const exceptions:string[]=[],payrollRows:PayrollFinanceRow[]=[],advanceRows:any[]=[],benefitRows:any[]=[];
 const branches=new Set(input.branchIds),events=new Map(input.events.map(e=>[e.id,e])),movements=new Map(input.movements.map(m=>[m.id,m]));
 const inScope=(r:any,branch:string)=>r.tenantId===input.tenantId&&branches.has(branch);
 const number=(v:any,ref:string)=>{if(!Number.isSafeInteger(v)){exceptions.push(`${ref}: invalid whole UGX`);return 0;}return v;};
 const equal=(actual:number,expected:number,ref:string)=>{if(!Number.isSafeInteger(actual)||!Number.isSafeInteger(expected)||actual!==expected)exceptions.push(`${ref}: difference ${actual-expected} UGX`);};
 const sums=(items:number[],ref:string)=>number(items.reduce((a,b)=>a+b,0),ref);
 const unique=(rows:FinanceRow[],ref:string)=>{if(new Set(rows.map(r=>r.id)).size!==rows.length)exceptions.push(`${ref}: duplicate evidence IDs`);};
 unique(input.events,'Events');unique(input.movements,'Movements');
 const linkedSettlements=new Set<string>(),linkedRecoveries=new Set<string>();
 const payment=(rows:FinanceRow[],sourceId:string,type:string)=>{
  unique(rows,`${sourceId} settlements`);
  return sums(rows.map(s=>{
   const e=events.get(s.eventId);
   if(!e||e.sourceType!==type||e.sourceId!==sourceId||e.requestId!==s.id||e.amountUGX!==s.amountUGX||e.accountId!==s.accountId||e.externalReference!==s.externalReference)exceptions.push(`${sourceId}/${s.id}: settlement lacks matching journal event`);
   if(linkedSettlements.has(s.eventId))exceptions.push(`${s.eventId}: settlement linked twice`);
   linkedSettlements.add(s.eventId);
   return number(s.amountUGX,`${sourceId}/${s.id}`);
  }),`${sourceId} payments`);
 };
 for(const item of input.payroll){
  const p=item.record,s=item.state,branch=p.branch_id;
  if(!inScope(p,branch))throw new Error('Payroll evidence outside authorized scope.');
  if(p.status!=='approved_unpaid'||!p.snapshot){exceptions.push(`${p.id}: historical payroll requires reconciliation`);continue;}
  const amount=(field:string)=>{const value=number(p[field],`${p.id}.${field}`);if(value<0)exceptions.push(`${p.id}.${field}: negative recognized component`);return value;};
  const gross=amount('baseSalary')+amount('bonuses')-amount('unpaidLeaveDeduction');
  const net=amount('netSalaryPayableUGX'),paye=amount('payePayableUGX'),employeeNssf=amount('nssfEmployee'),employer=amount('employerNssfExpenseUGX');
  const other=amount('otherDeductionsPayableUGX'),advance=amount('advanceDeduction');
  equal(amount('salaryExpenseUGX'),gross,`${p.id} salary expense`);
  equal(amount('nssfPayableUGX'),employeeNssf+employer,`${p.id} NSSF obligations`);
  equal(gross,net+paye+employeeNssf+other+advance,`${p.id} gross/deductions/net`);
  equal(gross+employer,net+paye+employeeNssf+employer+other+advance,`${p.id} expense/obligation/asset offset`);
  const paid=payment(item.settlements,p.id,'SALARY_SETTLEMENT');
  if(!s){exceptions.push(`${p.id}: missing payable position`);continue;}
  equal(number(s.paidUGX,p.id),paid,`${p.id} verified paid`);
  if(!!s.voided!==!!item.reversal)exceptions.push(`${p.id}: missing or unexpected accrual reversal`);
  if(item.reversal){
   for(const field of ['salaryExpenseUGX','employerNssfExpenseUGX','payePayableUGX','nssfPayableUGX','otherDeductionsPayableUGX','netSalaryPayableUGX'])equal(number(item.reversal[field],p.id)+amount(field),0,`${p.id} reversal ${field}`);
   equal(paid,0,`${p.id} reversed payroll must be unpaid`);equal(number(s.outstandingUGX,p.id),0,`${p.id} void payable`);
  }else equal(number(s.outstandingUGX,p.id),net-paid,`${p.id} outstanding payable`);
  if(paid>net||s.outstandingUGX<0)exceptions.push(`${p.id}: overpayment or negative payable`);
  const factor=item.reversal?0:1,due=p.snapshot.dueDate||'';
  payrollRows.push({id:p.id,employee:p.staff_name,staffId:p.staffId,branchId:branch,period:p.period,grossUGX:gross*factor,salaryExpenseUGX:gross*factor,
   employerNssfUGX:employer*factor,payeUGX:paye*factor,employeeNssfUGX:employeeNssf*factor,otherDeductionsUGX:other*factor,advanceRecoveryUGX:advance*factor,
   netPayableUGX:net*factor,paidUGX:paid,outstandingUGX:s.outstandingUGX,status:s.voided?'reversed':s.outstandingUGX===0?'fully settled':paid>0?'partially settled':'approved unpaid',
   dueDate:due,overdue:!!due&&due<asOfDate&&s.outstandingUGX>0});
 }
 for(const item of input.advances){
  const r=item.record,s=item.state;
  if(!inScope(r,r.branchId||s?.branchId))throw new Error('Advance evidence outside authorized scope.');
  const disbursed=payment(item.settlements,r.id,'ADVANCE_DISBURSEMENT');
  const recoveries=sums((item.recoveries||[]).map(recovery=>{
   linkedRecoveries.add(`${r.id}/${recovery.id}`);
   const p=input.payroll.find(p=>p.record.id===recovery.payrollId);
   if(!p||p.record.advanceId!==r.id||Math.abs(recovery.deltaUGX)!==p.record.advanceDeduction
      ||(recovery.deltaUGX<0&&!p.reversal))exceptions.push(`${r.id}/${recovery.id}: recovery lacks matching payroll or reversal`);
   return number(recovery.deltaUGX,r.id);
  }),`${r.id} recoveries`);
  if(s){equal(number(s.principalUGX,r.id),disbursed,`${r.id} advance principal`);equal(number(s.recoveredUGX,r.id),recoveries,`${r.id} recovered`);equal(number(s.outstandingUGX,r.id),disbursed-recoveries,`${r.id} outstanding advance`);if(item.settlements.length!==1||s.outstandingUGX<0||recoveries<0)exceptions.push(`${r.id}: invalid disbursement count or recovery balance`);}
  else if(disbursed||recoveries)exceptions.push(`${r.id}: missing advance receivable position`);
  advanceRows.push({id:r.id,staffId:r.staffId,branchId:r.branchId||s?.branchId,approvedUGX:r.status==='Approved'?number(r.amount_requested,r.id):0,disbursedUGX:disbursed,recoveredUGX:recoveries,outstandingUGX:s?.outstandingUGX??0,status:s?'disbursed':r.status==='Approved'?'approved undisbursed':r.status});
 }
 for(const item of input.payroll)if(item.record.advanceDeduction>0){
  const p=item.record;
  if(!linkedRecoveries.has(`${p.advanceId}/${p.id}`))exceptions.push(`${p.id}: missing advance recovery`);
  if(item.reversal&&!linkedRecoveries.has(`${p.advanceId}/void_${p.id}`))exceptions.push(`${p.id}: missing recovery reversal`);
 }
 for(const item of input.benefits){
  const r=item.record,s=item.state;
  if(!inScope(r,r.branchId))throw new Error('Benefit evidence outside authorized scope.');
  const paid=payment(item.settlements,r.id,'WELFARE_SETTLEMENT'),e=events.get(`welfare_accrual_${r.id}`);
  if(s){
   if(!e||e.sourceType!=='WELFARE_RECOGNITION'||e.sourceId!==r.id||item.approval?.decision!=='approved')exceptions.push(`${r.id}: unverified welfare recognition`);
   equal(number(s.principalUGX,r.id),number(r.amountUGX,r.id),`${r.id} benefit principal`);equal(number(e?.expenseUGX,r.id),r.amountUGX,`${r.id} benefit expense`);
   equal(number(s.settledUGX,r.id),paid,`${r.id} benefit paid`);equal(number(s.outstandingUGX,r.id),r.amountUGX-paid,`${r.id} benefit payable`);
   if(paid>r.amountUGX||s.outstandingUGX<0)exceptions.push(`${r.id}: benefit overpaid`);
  }else if(paid||e)exceptions.push(`${r.id}: missing benefit payable position`);
  benefitRows.push({id:r.id,staffId:r.staffId,branchId:r.branchId,approval:item.approval?.decision||'pending',approvedUGX:item.approval?.decision==='approved'?r.amountUGX:0,expenseUGX:s?r.amountUGX:0,paidUGX:paid,outstandingUGX:s?.outstandingUGX??0});
 }
 let chargesUGX=0;
 for(const e of input.events){
  if(!inScope(e,e.branchId))throw new Error('Journal evidence outside authorized scope.');
  if(!e.actorUid||!e.createdAt)exceptions.push(`${e.id}: missing operator or posting timestamp`);
  if(['SALARY_SETTLEMENT','ADVANCE_DISBURSEMENT','WELFARE_SETTLEMENT'].includes(e.sourceType)&&!linkedSettlements.has(e.id))exceptions.push(`${e.id}: orphan disbursement event`);
  if(e.sourceType==='WELFARE_RECOGNITION')continue;
  const opening=e.sourceType==='ACCOUNT_OPENING';
  if(!opening&&!['SALARY_SETTLEMENT','ADVANCE_DISBURSEMENT','WELFARE_SETTLEMENT'].includes(e.sourceType)){exceptions.push(`${e.id}: unsupported journal source`);continue;}
  const principal=movements.get(`${e.id}_principal`),fee=movements.get(`${e.id}_charge`);
  if(!principal||principal.eventId!==e.id||principal.accountId!==e.accountId||principal.deltaUGX!==(opening?e.amountUGX:-e.amountUGX)
     ||principal.beforeUGX!==e.beforeUGX||principal.afterUGX!==e.beforeUGX+principal.deltaUGX)exceptions.push(`${e.id}: principal movement mismatch`);
  if(e.chargeUGX>0){if(!fee||fee.eventId!==e.id||fee.accountId!==e.accountId||fee.deltaUGX!==-e.chargeUGX||fee.beforeUGX!==principal?.afterUGX||fee.afterUGX!==e.afterUGX)exceptions.push(`${e.id}: charge movement mismatch`);}
  else if(fee)exceptions.push(`${e.id}: unexpected charge movement`);
  equal(number(e.afterUGX,e.id),number(e.beforeUGX,e.id)+(opening?e.amountUGX:-e.amountUGX)-e.chargeUGX,`${e.id} account debit`);
  equal(number(e.expenseUGX,e.id),opening?0:e.chargeUGX,`${e.id} principal is not expense`);chargesUGX+=e.chargeUGX;
 }
 const accountRows=input.accounts.map(a=>{
  if(!inScope(a,a.branchId))throw new Error('Account evidence outside authorized scope.');
  const rows=input.movements.filter(m=>m.accountId===a.accountId);
  const delta=sums(rows.map(m=>number(m.deltaUGX,m.id)),`${a.id} movement total`);
  equal(number(a.balanceUGX,a.id),number(a.openingBalanceUGX,a.id)+delta,`${a.id} registered balance`);
  return {id:a.id,name:a.name,kind:a.kind,branchId:a.branchId,balanceUGX:a.balanceUGX,movementUGX:delta};
 });
 for(const m of input.movements)if(!events.has(m.eventId)||!input.accounts.some(a=>a.accountId===m.accountId)||m.tenantId!==input.tenantId)exceptions.push(`${m.id}: orphan or foreign movement`);
 const sum=(rows:any[],key:string)=>sums(rows.map(r=>number(r[key],key)),key);
 const totals={grossUGX:sum(payrollRows,'grossUGX'),salaryExpenseUGX:sum(payrollRows,'salaryExpenseUGX'),employerNssfUGX:sum(payrollRows,'employerNssfUGX'),payeUGX:sum(payrollRows,'payeUGX'),employeeNssfUGX:sum(payrollRows,'employeeNssfUGX'),otherDeductionsUGX:sum(payrollRows,'otherDeductionsUGX'),netSalaryUGX:sum(payrollRows,'netPayableUGX'),salaryPaidUGX:sum(payrollRows,'paidUGX'),salaryOutstandingUGX:sum(payrollRows,'outstandingUGX'),overdueSalaryUGX:sum(payrollRows.filter(r=>r.overdue),'outstandingUGX'),advanceDisbursedUGX:sum(advanceRows,'disbursedUGX'),advanceRecoveredUGX:sum(advanceRows,'recoveredUGX'),advanceOutstandingUGX:sum(advanceRows,'outstandingUGX'),welfareExpenseUGX:sum(benefitRows,'expenseUGX'),welfarePaidUGX:sum(benefitRows,'paidUGX'),welfareOutstandingUGX:sum(benefitRows,'outstandingUGX'),chargesUGX:number(chargesUGX,'charges')};
 const movementRows=input.movements.map(m=>{const e=events.get(m.eventId);let postedAt='Unverified';try{const date=typeof e?.createdAt?.toDate==='function'?e.createdAt.toDate():new Date(e?.createdAt?.seconds*1000);if(!Number.isNaN(date.getTime()))postedAt=date.toISOString();}catch{}return {id:m.id,accountId:m.accountId,sourceType:e?.sourceType||'Unverified',sourceId:e?.sourceId||'',purpose:m.purpose||'',deltaUGX:m.deltaUGX,beforeUGX:m.beforeUGX,afterUGX:m.afterUGX,reference:e?.externalReference||'',actorUid:e?.actorUid||'Unverified',postedAt,paymentDate:e?.paymentDate||''};});
 return {asOfDate,totals,payrollRows,advanceRows,benefitRows,accountRows,movementRows,exceptions:[...new Set(exceptions)],dueDateUnspecified:payrollRows.filter(r=>!r.dueDate&&r.outstandingUGX>0).length};
}
