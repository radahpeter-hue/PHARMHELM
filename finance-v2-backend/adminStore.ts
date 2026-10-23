import type {Firestore} from 'firebase-admin/firestore';
import type {TrustedFinanceStore,TrustedFinanceTransaction} from '../src/services/financeV2TrustedTransferCore';

/** Admin-only adapter for isolated emulator verification. No HTTP endpoint. */
export function createFinanceV2AdminStore(db:Firestore):TrustedFinanceStore {
 return {
  runTransaction:fn=>db.runTransaction(async transaction=>{
   const writes:Array<()=>void>=[];
   let writing=false;
   const adapter:TrustedFinanceTransaction={
    get:async path=>{
     if(writing)throw new Error('Transaction reads must precede writes');
     const snap=await transaction.get(db.doc(path));
     return {exists:snap.exists,data:()=>snap.data()??{}};
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
