import {doc, runTransaction, serverTimestamp, type Firestore} from 'firebase/firestore';
import {db} from '../firebase';

export interface SalarySettlementInput {
 tenantId:string; payrollId:string; requestId:string; accountId:string; actorUid:string;
 amountUGX:number; chargeUGX:number; externalReference:string; recipientReference:string; paymentDate:string;
}
const key=(s:string)=>/^[A-Za-z0-9_-]{1,300}$/.test(s);
export function validateSalarySettlement(input:SalarySettlementInput) {
 if(![input.tenantId,input.payrollId,input.requestId,input.accountId,input.actorUid].every(key)) throw new Error('Invalid settlement identity');
 if(!Number.isSafeInteger(input.amountUGX)||input.amountUGX<=0||!Number.isSafeInteger(input.chargeUGX)||input.chargeUGX<0
    ||!Number.isSafeInteger(input.amountUGX+input.chargeUGX)) throw new Error('Payment and charge require safe whole-number UGX');
 if(!/^[A-Z0-9_.-]{3,100}$/.test(input.externalReference) || input.recipientReference.trim().length<3
    ||input.recipientReference.length>150 || !/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)||(Number.isNaN(Date.parse(input.paymentDate)) || new Date(input.paymentDate).toISOString().slice(0,10)!==input.paymentDate))
   throw new Error('Payment date, payment reference and recipient details are required');
}
/** Shared V2 disbursement journal; principal settles a payable, only external fees are expense. */
export async function settleSalary(input:SalarySettlementInput,connection:Firestore=db) {
 validateSalarySettlement(input);
 const eventId=`salary_${input.payrollId}_${input.requestId}`;
 const eventRef=doc(connection,'finance_v2_events',eventId);
 const payrollRef=doc(connection,'payroll',input.payrollId);
 const stateRef=doc(payrollRef,'state','current');
 const settlementRef=doc(payrollRef,'settlements',input.requestId);
 const accountRef=doc(connection,'finance_payment_accounts',`${input.tenantId}_${input.accountId}`);
 return runTransaction(connection,async tx=>{
  const claimRef=doc(accountRef,'payment_references',input.externalReference);
  const [event,payroll,state,account,claim]=await Promise.all([tx.get(eventRef),tx.get(payrollRef),tx.get(stateRef),tx.get(accountRef),tx.get(claimRef)]);
  if(event.exists()) {
   const prior=event.data();
   if(Object.entries(input).some(([field,value])=>prior[field]!==value))throw new Error('Payment reference conflicts with an existing settlement');
   return {eventId,replay:true};
  }
  if(claim.exists())throw new Error('This funding account payment reference is already posted.');
  if(!payroll.exists()||!state.exists()||!account.exists())throw new Error('Payroll obligation or registered account missing');
  const p=payroll.data(),s=state.data(),a=account.data();
  if(p.tenantId!==input.tenantId||a.tenantId!==input.tenantId||s.voided||!Number.isSafeInteger(s.outstandingUGX)
     ||input.amountUGX>s.outstandingUGX)throw new Error('Payment exceeds the valid outstanding salary');
  if(a.controlVersion!==2||a.initialized!==true||a.active!==true||a.currency!=='UGX'||a.salaryEligible!==true)
    throw new Error('Select a certified active salary funding account');
  const after=a.balanceUGX-input.amountUGX-input.chargeUGX;
  if(!Number.isSafeInteger(a.balanceUGX)||!Number.isSafeInteger(after)||after<0)throw new Error('Insufficient or invalid account balance');
  const now=serverTimestamp();
  const data={...input,eventId,sourceType:'SALARY_SETTLEMENT',sourceId:input.payrollId,branchId:p.branch_id,
    beforeUGX:a.balanceUGX,afterUGX:after,currency:'UGX',expenseUGX:input.chargeUGX,createdAt:now};
  tx.set(eventRef,data);tx.set(settlementRef,data);
  tx.set(claimRef,{tenantId:input.tenantId,accountId:input.accountId,eventId,createdAt:now});
  tx.update(accountRef,{balanceUGX:after,lastPostingId:eventId,updatedAt:now});
  tx.update(stateRef,{outstandingUGX:s.outstandingUGX-input.amountUGX,paidUGX:s.paidUGX+input.amountUGX,lastAction:eventId,updatedAt:now});
  tx.set(doc(connection,'finance_v2_account_movements',`${eventId}_principal`),{
    tenantId:input.tenantId,eventId,accountId:input.accountId,actorUid:input.actorUid,
    purpose:'PRINCIPAL',deltaUGX:-input.amountUGX,beforeUGX:a.balanceUGX,afterUGX:a.balanceUGX-input.amountUGX,createdAt:now});
  if(input.chargeUGX>0)tx.set(doc(connection,'finance_v2_account_movements',`${eventId}_charge`),{
    tenantId:input.tenantId,eventId,accountId:input.accountId,actorUid:input.actorUid,
    purpose:'CHARGE',deltaUGX:-input.chargeUGX,beforeUGX:a.balanceUGX-input.amountUGX,afterUGX:after,createdAt:now});
  return {eventId,replay:false};
 });
}

/** Zero-opening registration reuses the Phase 1 registry contract; no balance migration. */
export async function registerSalaryFundingAccount(input: import('./financeV2AccountRegistryPolicy').FinanceV2AccountRegistration,connection:Firestore=db) {
 const {planFinanceV2AccountRegistration}=await import('./financeV2AccountRegistryPolicy');
 const record=planFinanceV2AccountRegistration(input);
 if(record.openingBalanceUGX!==0 || !record.branchId) throw new Error('A branch-owned zero-opening account is required.');
 const ref=doc(connection,'finance_payment_accounts',`${input.tenantId}_${input.accountId}`);
 await runTransaction(connection,async tx=>{
  if((await tx.get(ref)).exists())throw new Error('Account already exists. Registration cannot alter balances.');
  tx.set(ref,{...record,salaryEligible:true,salaryBranchIds:[record.branchId],createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
 });
}
