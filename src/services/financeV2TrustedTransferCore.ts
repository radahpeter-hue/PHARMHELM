import {planFinanceV2Transfer, type FinanceV2AccountSnapshot, type FinanceV2TransferInput} from './financeV2TransferPolicy';
import {verifyFinanceV2TransferAudit} from './financeV2TransferIntegrity';

export interface TrustedFinanceDocument {exists:boolean; data:()=>Record<string,unknown>}
export interface TrustedFinanceTransaction {
 get:(path:string)=>Promise<TrustedFinanceDocument>;
 create:(path:string,data:Record<string,unknown>)=>void;
 update:(path:string,data:Record<string,unknown>)=>void;
}
export interface TrustedFinanceStore {
 runTransaction:<T>(fn:(tx:TrustedFinanceTransaction)=>Promise<T>)=>Promise<T>;
}
export interface TrustedFinanceActor {uid:string; tenantId:string; active:boolean; canPostFinance:boolean}

/** Server-only transaction core. The caller must verify the actor with Admin Auth,
 * resolve roles and tenant membership from trusted records, and gate rollout.
 * Never expose this store interface to browser-supplied implementations. */
export async function postTrustedFinanceV2Transfer(
 store:TrustedFinanceStore,actor:TrustedFinanceActor,input:FinanceV2TransferInput
):Promise<{transferId:string;replay:boolean}> {
 if(!actor.uid||!actor.active||!actor.canPostFinance||actor.tenantId!==input.tenantId||actor.uid!==input.actorUid)
   throw new Error('Unauthorised finance transfer actor');
 if(!/^[A-Za-z0-9_-]{1,150}$/.test(input.tenantId)||![input.requestId,input.sourceAccountId,input.destinationAccountId,input.chargePayerAccountId,input.actorUid].every(v=>/^[A-Za-z0-9_-]{1,150}$/.test(v)))throw new Error('Invalid transfer identifiers');
 return store.runTransaction(async tx=>{
  const id=`finance_v2_transfer_${input.tenantId}_${input.requestId}`;
  const transferPath=`finance_v2_transfers/${id}`;
  const prior=await tx.get(transferPath);
  if(prior.exists){
   const d=prior.data();
   const keys=['tenantId','requestId','sourceAccountId','destinationAccountId','chargePayerAccountId','principalUGX','chargeUGX','actorUid'];
   if(d.status!=='posted'||keys.some(k=>d[k]!==input[k]))throw new Error('Conflicting transfer replay');
   return {transferId:id,replay:true};
  }
  const ids=[...new Set([input.sourceAccountId,input.destinationAccountId,input.chargePayerAccountId])];
  const paths=ids.map(accountId=>`finance_payment_accounts/${input.tenantId}_${accountId}`);
  const snapshots=await Promise.all(paths.map(path=>tx.get(path)));
  const accounts:FinanceV2AccountSnapshot[]=snapshots.map((snapshot,i)=>{
   if(!snapshot.exists)throw new Error('Missing financial account');
   const data=snapshot.data();
   if(data.tenantId!==input.tenantId||data.accountId!==ids[i]||data.controlVersion!==2||
      data.currency!=='UGX'||data.initialized!==true||data.active!==true)
     throw new Error('Invalid V2 account');
   return {tenantId:input.tenantId,accountId:ids[i],kind:data.kind as FinanceV2AccountSnapshot['kind'],
    balanceUGX:data.balanceUGX as number,active:true,branchId:data.branchId as string|undefined};
  });
  const planned=planFinanceV2Transfer(input,accounts);
  const auditDeltas=planned.accountDeltas.map(delta=>{
   const before=accounts.find(a=>a.accountId===delta.accountId)!.balanceUGX;
   return {accountId:delta.accountId,beforeUGX:before,deltaUGX:delta.deltaUGX,afterUGX:before+delta.deltaUGX};
  });
  const audit={accountDeltas:auditDeltas,movements:planned.movements,externalChargeExpenseUGX:planned.externalChargeExpenseUGX};
  verifyFinanceV2TransferAudit(input,accounts,audit);
  const postedAt=new Date().toISOString();
  for(const delta of auditDeltas) tx.update(`finance_payment_accounts/${input.tenantId}_${delta.accountId}`,{
   balanceUGX:delta.afterUGX,lastPostingId:id,updatedAt:postedAt
  });
  planned.movements.forEach((m,index)=>tx.create(`finance_v2_account_movements/${id}_${index}`,{
   tenantId:input.tenantId,transferId:id,accountId:m.accountId,deltaUGX:m.deltaUGX,
   purpose:m.purpose,movementIndex:index,actorUid:actor.uid,createdAt:postedAt
  }));
  if(planned.externalChargeExpenseUGX>0)tx.create(`finance_v2_events/${id}_charge`,{
   tenantId:input.tenantId,sourceType:'ACCOUNT_TRANSFER',sourceId:id,eventKind:'EXTERNAL_TRANSFER_CHARGE_OPEX',
   amountUGX:planned.externalChargeExpenseUGX,currency:'UGX',actorUid:actor.uid,createdAt:postedAt
  });
  tx.create(transferPath,{...input,status:'posted',currency:'UGX',accountDeltas:auditDeltas,
   movementCount:planned.movements.length,chargeEventId:planned.externalChargeExpenseUGX>0?`${id}_charge`:null,createdAt:postedAt});
  return {transferId:id,replay:false};
 });
}
