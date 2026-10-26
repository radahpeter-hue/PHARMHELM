import {doc,runTransaction,serverTimestamp,type Firestore,type Transaction} from 'firebase/firestore';
import {db} from '../firebase';
import {validateSalarySettlement} from './financeV2Disbursement';
export interface WelfarePayment {tenantId:string;obligationId:string;kind:'ADVANCE'|'BENEFIT';actorUid:string;accountId:string;requestId:string;amountUGX:number;chargeUGX:number;externalReference:string;recipientReference:string;paymentDate:string;}
export function validateBenefitRequest(input:{tenantId:string;id:string;staffId:string;branchId:string;amountUGX:number;reason:string;actorUid:string}) {
 if(![input.tenantId,input.id,input.staffId,input.branchId,input.actorUid].every(s=>/^[A-Za-z0-9_-]{1,150}$/.test(s))
   ||!Number.isSafeInteger(input.amountUGX)||input.amountUGX<=0||input.reason.trim().length<5||input.reason.length>1000)
   throw new Error('Valid benefit identities, whole UGX amount and reason required.');
}
export async function requestWelfareBenefit(input:{tenantId:string;id:string;staffId:string;branchId:string;amountUGX:number;reason:string;actorUid:string},connection:Firestore=db) {
 validateBenefitRequest(input);
 await runTransaction(connection,async tx=>{const ref=doc(connection,'welfare_records',input.id);if((await tx.get(ref)).exists())throw new Error('Benefit request already exists.');tx.set(ref,{...input,kind:'BENEFIT',status:'Requested',createdAt:serverTimestamp()});});
}
export async function approveWelfareBenefit(input:{id:string;actorUid:string;reason:string;decision?:'approved'|'rejected'},connection:Firestore=db) {
 if(input.reason.trim().length<5)throw new Error('Approval reason required.');
 await runTransaction(connection,async tx=>{const root=doc(connection,'welfare_records',input.id);const record=await tx.get(root);if(!record.exists()||record.data().actorUid===input.actorUid)throw new Error('Independent benefit approval required.');tx.set(doc(root,'approval','current'),{tenantId:record.data().tenantId,branchId:record.data().branchId,snapshot:record.data(),approvedBy:input.actorUid,decision:input.decision||'approved',reason:input.reason,approvedAt:serverTimestamp()});});
}
export async function recognizeWelfareBenefit(input:{id:string;actorUid:string},connection:Firestore=db) {
 await runTransaction(connection,async tx=>{
  const root=doc(connection,'welfare_records',input.id),state=doc(root,'state','current');
  const [request,approval,prior]=await Promise.all([tx.get(root),tx.get(doc(root,'approval','current')),tx.get(state)]);
  if(prior.exists())return;
  if(!request.exists()||!approval.exists()||approval.data().decision!=='approved'||approval.data().approvedBy===input.actorUid||request.data().actorUid===input.actorUid)throw new Error('Independent HR and owner approval required.');
  const r=request.data(),eventId=`welfare_accrual_${input.id}`,now=serverTimestamp();
  tx.set(doc(connection,'finance_v2_events',eventId),{eventId,tenantId:r.tenantId,branchId:r.branchId,sourceId:input.id,sourceType:'WELFARE_RECOGNITION',actorUid:input.actorUid,amountUGX:r.amountUGX,expenseUGX:r.amountUGX,payableUGX:r.amountUGX,createdAt:now});
  tx.set(state,{tenantId:r.tenantId,branchId:r.branchId,staffId:r.staffId,principalUGX:r.amountUGX,outstandingUGX:r.amountUGX,settledUGX:0,lastAction:eventId,updatedAt:now});
 });
}
function writeJournal(tx:Transaction,connection:Firestore,input:WelfarePayment,eventId:string,branchId:string,balance:number) {
 const now=serverTimestamp(),after=balance-input.amountUGX-input.chargeUGX;
 const event={...input,eventId,sourceType:input.kind==='ADVANCE'?'ADVANCE_DISBURSEMENT':'WELFARE_SETTLEMENT',sourceId:input.obligationId,branchId,beforeUGX:balance,afterUGX:after,currency:'UGX',expenseUGX:input.chargeUGX,receivableUGX:input.kind==='ADVANCE'?input.amountUGX:0,createdAt:now};
 tx.set(doc(connection,'finance_v2_events',eventId),event);
 const root=doc(connection,input.kind==='ADVANCE'?'advance_requests':'welfare_records',input.obligationId);
 tx.set(doc(root,'settlements',input.requestId),event);
 tx.set(doc(connection,'finance_payment_accounts',`${input.tenantId}_${input.accountId}`,'payment_references',input.externalReference),{tenantId:input.tenantId,accountId:input.accountId,eventId,createdAt:now});
 tx.update(doc(connection,'finance_payment_accounts',`${input.tenantId}_${input.accountId}`),{balanceUGX:after,lastPostingId:eventId,updatedAt:now});
 tx.set(doc(connection,'finance_v2_account_movements',eventId+'_principal'),{tenantId:input.tenantId,eventId,accountId:input.accountId,actorUid:input.actorUid,purpose:'PRINCIPAL',deltaUGX:-input.amountUGX,beforeUGX:balance,afterUGX:balance-input.amountUGX,createdAt:now});
 if(input.chargeUGX>0)tx.set(doc(connection,'finance_v2_account_movements',eventId+'_charge'),{tenantId:input.tenantId,eventId,accountId:input.accountId,actorUid:input.actorUid,purpose:'CHARGE',deltaUGX:-input.chargeUGX,beforeUGX:balance-input.amountUGX,afterUGX:after,createdAt:now});
 return {root,now};
}
export async function settleWelfare(input:WelfarePayment,connection:Firestore=db) {
 validateSalarySettlement({...input,payrollId:input.obligationId});
 if(!['ADVANCE','BENEFIT'].includes(input.kind))throw new Error('Unsupported welfare classification.');
 return runTransaction(connection,async tx=>{
  const eventId=`${input.kind==='ADVANCE'?'advance':'welfare'}_${input.obligationId}_${input.requestId}`;
  const root=doc(connection,input.kind==='ADVANCE'?'advance_requests':'welfare_records',input.obligationId),state=doc(root,'state','current');
  const [record,position,account,prior,claim]=await Promise.all([tx.get(root),tx.get(state),tx.get(doc(connection,'finance_payment_accounts',`${input.tenantId}_${input.accountId}`)),tx.get(doc(connection,'finance_v2_events',eventId)),tx.get(doc(connection,'finance_payment_accounts',`${input.tenantId}_${input.accountId}`,'payment_references',input.externalReference))]);
  if(prior.exists()){if(Object.entries(input).some(([k,v])=>prior.data()[k]!==v))throw new Error('Conflicting payment retry.');return {eventId,replay:true};}
  if(claim.exists()||!record.exists()||!account.exists())throw new Error('Missing approved obligation/account or duplicate payment reference.');
  const r=record.data(),a=account.data();
  if(r.tenantId!==input.tenantId||a.tenantId!==input.tenantId||a.controlVersion!==2||!a.active||!a.initialized||!a.salaryEligible||a.currency!=='UGX'||!Number.isSafeInteger(a.balanceUGX)||a.balanceUGX<input.amountUGX+input.chargeUGX)throw new Error('Invalid or insufficient funding account.');
  let branchId:string,staffId:string;
  if(input.kind==='ADVANCE'){
   const employee=await tx.get(doc(connection,'staff',r.staffId));
   if(position.exists()||!employee.exists()||r.status!=='Approved'||r.hr_approval_status!=='Approved'||r.ceo_approval_status!=='Approved'||r.hr_reviewed_by===r.ceo_reviewed_by||!r.hr_reviewed_by||!r.ceo_reviewed_by||[r.hr_reviewed_by,r.ceo_reviewed_by,r.staffId].includes(input.actorUid)||r.amount_requested!==input.amountUGX||r.amount!==input.amountUGX||r.amountRequested!==input.amountUGX)throw new Error('Advance needs verified distinct approvals and exactly one full disbursement.');
   branchId=employee.data().branch_id;staffId=r.staffId;
  }else{
   if(!position.exists()||input.amountUGX>position.data().outstandingUGX)throw new Error('Benefit exceeds recognized outstanding payable.');
   branchId=r.branchId;staffId=r.staffId;
  }
  const {now}=writeJournal(tx,connection,input,eventId,branchId,a.balanceUGX);
  if(input.kind==='ADVANCE')tx.set(state,{tenantId:input.tenantId,branchId,staffId,principalUGX:input.amountUGX,outstandingUGX:input.amountUGX,recoveredUGX:0,disbursementEventId:eventId,lastAction:eventId,updatedAt:now});
  else tx.update(state,{outstandingUGX:position.data().outstandingUGX-input.amountUGX,settledUGX:position.data().settledUGX+input.amountUGX,lastAction:eventId,updatedAt:now});
  return {eventId,replay:false};
 });
}
