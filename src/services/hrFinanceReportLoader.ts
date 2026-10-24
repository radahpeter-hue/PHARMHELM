import {collection,doc,getDoc,getDocs,query,where,type Firestore} from 'firebase/firestore';
import {db} from '../firebase';
import type {FinanceRow,HrFinanceEvidence,ObligationEvidence} from './hrFinanceReconciliation';
const rows=(snapshot:any):FinanceRow[]=>snapshot.docs.map((d:any)=>({...d.data(),id:d.id}));
/** Explicit branch queries; any denied/missing evidence aborts instead of returning a false zero. */
export async function loadHrFinanceEvidence(tenantId:string,branchIds:string[],connection:Firestore=db):Promise<HrFinanceEvidence> {
 const branches=[...new Set(branchIds)];
 if(!tenantId||!branches.length||branches.length>30)throw new Error('Select 1–30 authorized branches.');
 const scoped=(name:string,branchField='branchId')=>getDocs(query(collection(connection,name),where('tenantId','==',tenantId),where(branchField,'in',branches)));
 const signature=(snapshot:any)=>JSON.stringify(rows(snapshot).sort((a,b)=>a.id.localeCompare(b.id)));
 const positions:Array<{ref:any;signature:string}>=[];
 const [payroll,advances,benefits,accounts,events]=await Promise.all([scoped('payroll','branch_id'),scoped('advance_requests'),scoped('welfare_records'),scoped('finance_payment_accounts'),scoped('finance_v2_events')]);
 const evidence=async(name:string,record:FinanceRow):Promise<ObligationEvidence>=>{
  const root=doc(connection,name,record.id);
  const [state,settlements]=await Promise.all([getDoc(doc(root,'state','current')),getDocs(query(collection(root,'settlements'),where('tenantId','==',tenantId),where('branchId','in',branches)))]);
  positions.push({ref:doc(root,'state','current'),signature:JSON.stringify(state.exists()?state.data():null)});
  const result:ObligationEvidence={record,state:state.exists()?state.data():undefined,settlements:rows(settlements)};
  if(name==='payroll'){
   const reversal=await getDoc(doc(root,'corrections','void'));result.reversal=reversal.exists()?reversal.data():undefined;
  }else if(name==='advance_requests'){
   result.recoveries=rows(await getDocs(query(collection(root,'recoveries'),where('tenantId','==',tenantId),where('branchId','in',branches))));
  }else{
   const approval=await getDoc(doc(root,'approval','current'));result.approval=approval.exists()?approval.data():undefined;
  }
  return result;
 };
 const eventRows=rows(events),accountRows=rows(accounts).filter(a=>a.controlVersion===2);
 const movements=(await Promise.all(eventRows.filter(e=>e.sourceType!=='WELFARE_RECOGNITION').map(e=>getDocs(query(collection(connection,'finance_v2_account_movements'),where('tenantId','==',tenantId),where('eventId','==',e.id)))))).flatMap(rows);
 const result={tenantId,branchIds:branches,payroll:await Promise.all(rows(payroll).map(r=>evidence('payroll',r))),advances:await Promise.all(rows(advances).map(r=>evidence('advance_requests',r))),benefits:await Promise.all(rows(benefits).map(r=>evidence('welfare_records',r))),accounts:accountRows,events:eventRows,movements};
 const final=await Promise.all([scoped('payroll','branch_id'),scoped('advance_requests'),scoped('welfare_records'),scoped('finance_payment_accounts'),scoped('finance_v2_events')]);
 if([payroll,advances,benefits,accounts,events].some((before,i)=>signature(before)!==signature(final[i])))throw new Error('Transactions changed while loading. Refresh reconciliation.');
 await Promise.all(positions.map(async p=>{const current=await getDoc(p.ref);if(JSON.stringify(current.exists()?current.data():null)!==p.signature)throw new Error('An obligation changed while loading. Refresh reconciliation.');}));
 return result;
}
