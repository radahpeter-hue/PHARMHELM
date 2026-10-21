import {prepareBranchCashFunding,assertBranchCashFundingAccount} from './posCashFunding';
import type {Firestore} from 'firebase-admin/firestore';
import type {TrustedFinanceStore,TrustedFinanceTransaction} from '../src/services/financeV2TrustedTransferCore';

/** Admin-only adapter for isolated emulator verification. No HTTP endpoint. */
export function createFinanceV2AdminStore(db:Firestore, cashActorUid?:string, creditOnlyAccountId?:string):TrustedFinanceStore {
 return {
  runTransaction:fn=>db.runTransaction(async transaction=>{
   const writes:Array<()=>void>=[];
   let writing=false;
   const adapter:TrustedFinanceTransaction={
    get:async path=>{
     if(writing)throw new Error('Transaction reads must precede writes');
     const snap=await transaction.get(db.doc(path));
     let data=snap.data()??{};
     if(cashActorUid&&snap.exists&&path.startsWith('finance_payment_accounts/')&&data.kind==='BRANCH_CASH_SALES'){
      if(data.accountId===creditOnlyAccountId)await assertBranchCashFundingAccount(db,transaction,data);
      else {const prepared=await prepareBranchCashFunding(db,transaction,data,cashActorUid);data=prepared.account;writes.push(prepared.flush);}
     }
     return {exists:snap.exists,data:()=>data};
    },
    create:(path,data)=>{
     writing=true;
     writes.push(()=>transaction.create(db.doc(path),data));
    },
    update:(path,data)=>{
     writing=true;
     writes.push(()=>transaction.update(db.doc(path),data));
    }
   };
   const result=await fn(adapter);
   for(const write of writes)write();
   return result;
  })
 };
}
