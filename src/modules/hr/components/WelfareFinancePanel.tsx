import React,{useState} from 'react';
import {doc,getDoc} from 'firebase/firestore';
import {db} from '../../../firebase';
import {requestWelfareBenefit,approveWelfareBenefit,recognizeWelfareBenefit} from '../../../services/hrWelfareSettlement';
import {SalarySettlementPanel} from './SalarySettlementPanel';

export function WelfareFinancePanel({profile}:{profile:any}) {
 const [kind,setKind]=useState<'ADVANCE'|'BENEFIT'>('ADVANCE'),[id,setId]=useState(''),[record,setRecord]=useState<any>(null);
 const [staffId,setStaffId]=useState(''),[branchId,setBranchId]=useState(profile.branch_id||''),[amount,setAmount]=useState(''),[reason,setReason]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[payment,setPayment]=useState(false);
 const [approval,setApproval]=useState<any>(null),[position,setPosition]=useState<any>(null);
 const load=async()=>{
  const root=doc(db,kind==='ADVANCE'?'advance_requests':'welfare_records',id.trim());
  const r=await getDoc(root);if(!r.exists())throw new Error('Request not found.');
  const employee=await getDoc(doc(db,'staff',r.data().staffId));
  const state=await getDoc(doc(root,'state','current'));
  const decision=kind==='BENEFIT'?await getDoc(doc(root,'approval','current')):null;
  setPosition(state.exists()?state.data():null);setApproval(decision?.exists()?decision.data():null);
  setRecord({id:r.id,...r.data(),branch_id:r.data().branchId||employee.data()?.branch_id,staff_name:employee.data()?.full_name||r.data().staffId});
 };
 const action=async(type:'load'|'request'|'approve'|'reject'|'recognize')=>{
  setError('');setBusy(true);
  try{
   if(!/^[A-Za-z0-9_-]{1,150}$/.test(id.trim()))throw new Error('Enter a valid request ID.');
   if(type==='request')await requestWelfareBenefit({tenantId:profile.tenantId,id:id.trim(),staffId,branchId,amountUGX:Number(amount),reason,actorUid:profile.uid});
   if(type==='approve'||type==='reject')await approveWelfareBenefit({id:id.trim(),actorUid:profile.uid,reason,decision:type==='approve'?'approved':'rejected'});
   if(type==='recognize')await recognizeWelfareBenefit({id:id.trim(),actorUid:profile.uid});
   await load();
  }catch(e){setError(e instanceof Error?e.message:'Welfare action denied.');}finally{setBusy(false);}
 };
 const input='border rounded p-2 w-full';
 return <details className="bg-white border rounded-xl p-4"><summary className="cursor-pointer font-bold">Welfare approvals and payments</summary>
  <p className="text-sm my-3">Salary advances create a receivable only when disbursed. Non-repayable benefits require HR preparation, independent owner approval and Finance recognition before payment. POS medical allocations remain separate.</p>
  <div className="grid sm:grid-cols-2 gap-3">
   <label>Transaction category<select className={input} value={kind} onChange={e=>{setKind(e.target.value as any);setRecord(null);}}><option value="ADVANCE">Salary advance</option><option value="BENEFIT">Non-repayable benefit or claim</option></select></label>
   <label>Request ID<input className={input} value={id} onChange={e=>{setId(e.target.value);setRecord(null);}}/></label>
   <button disabled={busy} onClick={()=>action('load')}>Load request and verified position</button>
   {kind==='BENEFIT'&&<><label>Employee ID<input className={input} value={staffId} onChange={e=>setStaffId(e.target.value)}/></label><label>Branch ID<input className={input} value={branchId} onChange={e=>setBranchId(e.target.value)}/></label><label>Claim amount UGX<input className={input} type="number" min="1" step="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label>Preparation or review reason<textarea className={input} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button disabled={busy} onClick={()=>action('request')}>HR prepare immutable benefit request</button></>}
  </div>
  {error&&<p role="alert" className="text-rose-700 mt-3">{error}</p>}
  {record&&<div className="space-y-3 mt-4 text-sm"><p>{record.staff_name} | {record.branch_id} | Requested UGX {(record.amountUGX??record.amount_requested)?.toLocaleString()} | {record.reason}</p>
   {kind==='ADVANCE'?<p>HR: {record.hr_approval_status} ({record.hr_reviewed_by||'pending'}) | Owner: {record.ceo_approval_status} ({record.ceo_reviewed_by||'pending'}) | {position?`Disbursed UGX ${position.principalUGX}; receivable UGX ${position.outstandingUGX}; recovered UGX ${position.recoveredUGX}`:'Not disbursed'}</p>:<>
    <p>Owner decision: {approval?.decision||'pending'} {approval?.approvedBy} | {approval?.reason}</p>
    <p>{position?`Recognized UGX ${position.principalUGX}; paid UGX ${position.settledUGX}; unpaid UGX ${position.outstandingUGX}`:'No liability recognized. No cash changed.'}</p>
    <div className="flex flex-wrap gap-3"><button disabled={busy||!!approval} onClick={()=>action('approve')}>Owner approve</button><button disabled={busy||!!approval} onClick={()=>action('reject')}>Owner reject</button><button disabled={busy||!!position} onClick={()=>action('recognize')}>Finance recognize unpaid benefit</button></div></>}
   <button className="border rounded p-2" disabled={busy||(kind==='BENEFIT'&&!position)} onClick={()=>setPayment(true)}>Preview account-funded payment</button>
   <p className="text-xs">Approved records and financial movements cannot be edited or deleted. Record a new reviewed request for a corrected benefit; paid corrections require a separately verified refund or adjustment.</p>
  </div>}
  {payment&&record&&<SalarySettlementPanel payroll={record} welfareKind={kind} profile={profile} onClose={()=>{setPayment(false);action('load');}}/>}
 </details>;
}
