import {doc,runTransaction,serverTimestamp,getDocFromServer,type Firestore} from 'firebase/firestore';
import {db} from '../firebase';
import {WELFARE_ACCOUNT,WELFARE_RECORDS,WELFARE_SOURCE,welfareEmployeeId,reserveWelfare,wholeUGX,type WelfareEmployee,type WelfareEvent} from '../domain/finance/welfareFund';
import {portfolioTransferIdentity} from '../domain/finance/portfolioTransfer';
import {managementAccountDocumentId,MANAGEMENT_CASH_ACCOUNT} from './managementCashPosting';
import {kampalaBusinessDate} from '../utils/eodBusinessDate';
const account=(database:Firestore,tenant:string)=>doc(database,'finance_payment_accounts',managementAccountDocumentId(tenant,WELFARE_ACCOUNT));
export async function initializeWelfareFund(tenantId:string,actorId:string,reference:string,database:Firestore=db){
 if(reference.trim().length<5)throw Error('Record the opening reconciliation decision.');
 return runTransaction(database,async tx=>{const ref=account(database,tenantId),prior=await tx.get(ref);if(prior.exists())return;
 tx.set(ref,{tenantId,accountId:WELFARE_ACCOUNT,portfolioId:WELFARE_ACCOUNT,name:'Staff Welfare Fund',kind:'petty_cash',portfolioClassification:'restricted_internal_fund',scope:{kind:'organisation'},currency:'UGX',initialized:true,balanceUGX:0,openingBalanceUGX:0,reservedUGX:0,reconciliationReference:reference.trim(),registeredBy:actorId,lastPostingId:null,lastWelfareEventId:null,controlVersion:1,updatedAt:serverTimestamp()});});
}
export async function postWelfareEvent(input:{tenantId:string;staffId:string;type:WelfareEvent['type'];amountUGX:number;reason:string;reference:string;actorId:string;originalAllocationId?:string;paymentReference?:string},database:Firestore=db){
 wholeUGX(input.amountUGX,true);if(input.reason.trim().length<5)throw Error('Enter a reason of at least five characters.');
 if(input.type==='recall'&&!input.originalAllocationId)throw Error('Select an original allocation.');
 if(input.type==='utilization'&&(!input.paymentReference||input.paymentReference.trim().length<3))throw Error('A payment or settlement reference is required.');
 const id='we_'+(await portfolioTransferIdentity(input.tenantId,input.reference)).slice(3),ref=doc(database,WELFARE_RECORDS,id);
 const matches=(r:any)=>r.kind==='event'&&r.tenantId===input.tenantId&&r.staffId===input.staffId&&r.type===input.type&&r.amountUGX===input.amountUGX&&r.reason===input.reason.trim()&&r.actorId===input.actorId&&r.originalAllocationId===(input.originalAllocationId||'')&&r.paymentReference===(input.paymentReference?.trim()||'');
 try{return await runTransaction(database,async tx=>{
 const fundRef=account(database,input.tenantId),employeeRef=doc(database,WELFARE_RECORDS,welfareEmployeeId(input.tenantId,input.staffId));
 const [prior,fund,employee,staff,original]=await Promise.all([tx.get(ref),tx.get(fundRef),tx.get(employeeRef),tx.get(doc(database,'staff',input.staffId)),input.originalAllocationId?tx.get(doc(database,WELFARE_RECORDS,input.originalAllocationId)):undefined]);
 if(prior.exists()){if(!matches(prior.data()))throw Error('Welfare reference conflicts with an existing transaction.');return {id,replayed:true};}
 if(!fund.exists()||!fund.data().initialized)throw Error('Reconcile the Welfare Fund before posting.');
 const person=staff.data();if(!person||person.tenantId!==input.tenantId||person.is_duplicate||person.duplicate_of||person.canonical_staff_id&&person.canonical_staff_id!==input.staffId||person.active===false||['inactive','closed','terminated'].includes(String(person.status||'active').toLowerCase()))throw Error('Select an active canonical HR employee in this tenant.');
 if(input.type==='recall'&&(person.welfare_vested===true||original?.data()?.type!=='allocation'||original.data()?.staffId!==input.staffId||original.data()?.tenantId!==input.tenantId))throw Error('Select a discretionary original allocation for this employee.');
 const branchId=String(person.branch_id||person.default_branch_id||person.assigned_branches?.[0]||'');
 const before:WelfareEmployee=employee.exists()?employee.data() as WelfareEmployee:{kind:'employee',tenantId:input.tenantId,staffId:input.staffId,branchId,allocatedUGX:0,utilizedUGX:0,recalledUGX:0,committedUGX:0,balanceUGX:0,lastEventId:''};
 const next=reserveWelfare(fund.data() as any,before,input.type,input.amountUGX),now=serverTimestamp(),date=kampalaBusinessDate(new Date());
 const event:WelfareEvent={kind:'event',id,tenantId:input.tenantId,staffId:input.staffId,branchId,type:input.type,amountUGX:input.amountUGX,reason:input.reason.trim(),reference:input.reference.trim().toUpperCase(),originalAllocationId:input.originalAllocationId||'',actorId:input.actorId,date,paymentReference:input.paymentReference?.trim()||'',balanceBeforeUGX:fund.data().balanceUGX,balanceAfterUGX:next.balanceUGX,employeeBeforeUGX:before.balanceUGX,employeeAfterUGX:next.employee.balanceUGX};
 tx.set(ref,{...event,postedAt:now});tx.set(employeeRef,{...next.employee,branchId,lastEventId:id});
 tx.update(fundRef,{balanceUGX:next.balanceUGX,reservedUGX:next.reservedUGX,lastWelfareEventId:id,...input.type==='utilization'?{lastPostingId:id}:{},updatedAt:now});
 if(input.type==='utilization'){
 tx.set(doc(database,'petty_cash_ledger',id),{tenantId:input.tenantId,accountDocumentId:fundRef.id,amount:input.amountUGX,accountDeltaUGX:-input.amountUGX,type:'outgoing',source:'Welfare utilization',welfareEventId:id,reference_number:event.reference,postedBy:input.actorId,date,branchId,createdAt:now,updatedAt:now});
 tx.set(doc(database,'branch_expenses',id),{tenantId:input.tenantId,branchId,branch_id:branchId,staffId:input.staffId,category:'Staff Welfare',amount:input.amountUGX,date,expense_date:date,description:event.reason,payment_method:'Welfare Fund',status:'paid',welfareEventId:id,receipt_number:event.paymentReference,logged_by:input.actorId,createdAt:now});
 }
 return {id,replayed:false};
 });}catch(error){try{const winner=await getDocFromServer(ref);if(winner.exists()&&matches(winner.data()))return {id,replayed:true};}catch{}throw error;}
}
/** Existing petty-cash lifecycle, with welfare-specific classification and immutable issue identity. */
export async function requestWelfareFunding(input:{tenantId:string;actorId:string;amountUGX:number;reason:string;reference:string},database:Firestore=db){
 wholeUGX(input.amountUGX,true);if(input.reason.trim().length<5)throw Error('Funding justification is required.');
 const id='wf_'+(await portfolioTransferIdentity(input.tenantId,input.reference)).slice(3),ref=doc(database,'petty_cash_requisitions',id);
 await runTransaction(database,async tx=>{const old=await tx.get(ref);if(old.exists()){const r=old.data();if(r.tenantId!==input.tenantId||r.requested_by!==input.actorId||r.amount_requested!==input.amountUGX||r.reason!==input.reason.trim())throw Error('Funding reference conflicts with an existing requisition.');return;}
 tx.set(ref,{tenantId:input.tenantId,source:WELFARE_SOURCE,sourceReference:id,department:'Welfare',branch_id:'',branch_name:'Welfare Fund',requested_by:input.actorId,recipientId:input.actorId,amount_requested:input.amountUGX,reason:input.reason.trim(),requisition_number:input.reference.trim().toUpperCase(),requisition_date:kampalaBusinessDate(new Date()),status:'pending',createdAt:serverTimestamp()});});return id;
}
export async function transitionWelfareFunding(input:{tenantId:string;actorId:string;requisitionId:string;action:'finance_approve'|'ceo_approve'|'reject'|'issue'|'receive'|'cancel'},database:Firestore=db){
 const ref=doc(database,'petty_cash_requisitions',input.requisitionId);
 return runTransaction(database,async tx=>{
 const old=await tx.get(ref),r=old.data();if(!r||r.tenantId!==input.tenantId||r.source!==WELFARE_SOURCE)throw Error('Linked welfare requisition required.');
 const target={finance_approve:'finance_approved',ceo_approve:'approved',reject:'rejected',issue:'issued',receive:'received',cancel:'cancelled'}[input.action];
 const actorField={finance_approve:'finance_approval_by',ceo_approve:'ceo_approval_by',reject:'rejectedBy',issue:'issued_by',receive:'received_by',cancel:'cancelledBy'}[input.action];
 if(r.status===target){if(r[actorField]!==input.actorId)throw Error('Requisition transition belongs to another officer.');return;}
 const now=serverTimestamp(),date=kampalaBusinessDate(new Date()),issueRef=doc(database,'petty_cash_issues',ref.id);
 let funding:any,source:any;
 if(input.action==='issue')source=await tx.get(doc(database,'finance_payment_accounts',managementAccountDocumentId(input.tenantId)));
 if(input.action==='receive')funding=await tx.get(account(database,input.tenantId));
 const expected={finance_approve:['pending'],ceo_approve:['finance_approved'],reject:['pending','finance_approved'],issue:['approved'],receive:['issued'],cancel:['pending']}[input.action];
 if(!expected.includes(r.status))throw Error('The requisition is no longer at this workflow stage.');
 tx.update(ref,{status:target,[actorField]:input.actorId,updatedAt:now});
 if(input.action==='ceo_approve')tx.set(issueRef,{tenantId:input.tenantId,source:WELFARE_SOURCE,requisition_id:ref.id,branch_id:'',branch_name:'Welfare Fund',amount:r.amount_requested,issue_date:date,reference_number:r.requisition_number,status:'pending',createdAt:now});
 if(input.action==='issue'){
 if(!source?.exists()||source.data().balanceUGX<r.amount_requested)throw Error('Insufficient reconciled Management Petty Cash.');
 tx.set(doc(database,'petty_cash_ledger',ref.id+'_issue'),{tenantId:input.tenantId,accountDocumentId:source.ref.id,amount:r.amount_requested,accountDeltaUGX:-r.amount_requested,type:'outgoing',source:'Petty Cash Reserve',accountingClassification:'internal_transfer',excludeFromOpexRollup:true,welfareRequisitionId:ref.id,reference_number:r.requisition_number,postedBy:input.actorId,date,createdAt:now,updatedAt:now});
 tx.update(source.ref,{balanceUGX:source.data().balanceUGX-r.amount_requested,lastPostingId:ref.id+'_issue',updatedAt:now});
 tx.update(issueRef,{status:'completed',issued_by:input.actorId,issued_at:now});
 }
 if(input.action==='receive'){
 if(!funding?.exists())throw Error('Reconcile the Welfare Fund before confirming receipt.');
 tx.set(doc(database,'petty_cash_ledger',ref.id+'_receipt'),{tenantId:input.tenantId,accountDocumentId:funding.ref.id,amount:r.amount_requested,accountDeltaUGX:r.amount_requested,type:'incoming',source:'Welfare funding received',accountingClassification:'internal_transfer',excludeFromOpexRollup:true,welfareRequisitionId:ref.id,reference_number:r.requisition_number,postedBy:input.actorId,date,createdAt:now,updatedAt:now});
 tx.update(funding.ref,{balanceUGX:funding.data().balanceUGX+r.amount_requested,lastPostingId:ref.id+'_receipt',updatedAt:now});
 }
 });
}
