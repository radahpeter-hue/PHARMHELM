import {doc,runTransaction,serverTimestamp,type Firestore} from 'firebase/firestore';
import {db} from '../firebase';
export interface OpeningRequest {tenantId:string;accountId:string;actorUid:string;amountUGX:number;externalReference:string;evidence:string;}
export function validateOpening(input:OpeningRequest) {
 if(![input.tenantId,input.accountId,input.actorUid].every(s=>/^[A-Za-z0-9_-]{1,150}$/.test(s))||!Number.isSafeInteger(input.amountUGX)||input.amountUGX<=0
   || !/^[A-Z0-9_.-]{3,100}$/.test(input.externalReference)||input.evidence.trim().length<10||input.evidence.length>1000)
   throw new Error('Verified positive whole UGX, unique reconciliation reference and documentary evidence are required.');
}
export async function requestAccountOpening(input:OpeningRequest,connection:Firestore=db) {
 validateOpening(input);
 await runTransaction(connection,async tx=>{
  const root=doc(connection,'finance_payment_accounts',`${input.tenantId}_${input.accountId}`);
  const ref=doc(root,'opening','request');
  const [account,prior]=await Promise.all([tx.get(root),tx.get(ref)]);
  if(!account.exists()||prior.exists()||account.data().balanceUGX!==0||account.data().lastPostingId!==null)throw new Error('Opening requires an unused zero-opening account.');
  tx.set(ref,{...input,branchId:account.data().branchId,createdAt:serverTimestamp()});
 });
}
export async function approveAccountOpening(input:{tenantId:string;accountId:string;actorUid:string;reason:string},connection:Firestore=db) {
 if(input.reason.trim().length<5)throw new Error('Independent review reason required.');
 await runTransaction(connection,async tx=>{
  const root=doc(connection,'finance_payment_accounts',`${input.tenantId}_${input.accountId}`);
  const request=await tx.get(doc(root,'opening','request'));
  if(!request.exists()||request.data().actorUid===input.actorUid)throw new Error('Independent owner approval required.');
  tx.set(doc(root,'opening','approval'),{tenantId:input.tenantId,accountId:input.accountId,branchId:request.data().branchId,
   request:request.data(),approvedBy:input.actorUid,reason:input.reason.trim(),approvedAt:serverTimestamp()});
 });
}
/** Opening is an equity/balance migration, never revenue or an expense. */
export async function postAccountOpening(input:{tenantId:string;accountId:string;actorUid:string},connection:Firestore=db) {
 return runTransaction(connection,async tx=>{
  const root=doc(connection,'finance_payment_accounts',`${input.tenantId}_${input.accountId}`);
  const [account,approval]=await Promise.all([tx.get(root),tx.get(doc(root,'opening','approval'))]);
  if(!account.exists()||!approval.exists()||approval.data().approvedBy===input.actorUid)throw new Error('Independent approved opening required.');
  const request=approval.data().request;
  const eventId=`opening_${input.tenantId}_${request.externalReference}`;
  const eventRef=doc(connection,'finance_v2_events',eventId);
  const existing=await tx.get(eventRef);
  if(existing.exists()) {
   if(existing.data().accountId!==input.accountId)throw new Error('Opening reference already used by another account.');
   return {eventId,replay:true};
  }
  if(account.data().balanceUGX!==0||account.data().lastPostingId!==null)throw new Error('An opening can only be posted once to an unused account.');
  const now=serverTimestamp();
  tx.set(eventRef,{...input,eventId,sourceType:'ACCOUNT_OPENING',branchId:account.data().branchId,amountUGX:request.amountUGX,chargeUGX:0,
    externalReference:request.externalReference,beforeUGX:0,afterUGX:request.amountUGX,expenseUGX:0,revenueUGX:0,currency:'UGX',createdAt:now});
  tx.set(doc(connection,'finance_v2_account_movements',eventId+'_principal'),{...input,eventId,purpose:'PRINCIPAL',deltaUGX:request.amountUGX,beforeUGX:0,afterUGX:request.amountUGX,createdAt:now});
  tx.update(root,{balanceUGX:request.amountUGX,lastPostingId:eventId,updatedAt:now});
  return {eventId,replay:false};
 });
}
