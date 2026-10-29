import React,{useState} from 'react';
import type { Sale } from '../../types';
import type { EodShift } from '../../utils/eodShifts';
import { verifyLegacyEodShift } from '../../services/eodLegacyShiftService';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
export function EodLegacyShiftReview({sales,branchId,date,shift,onClose}:{sales:Sale[];branchId:string;date:string;shift:EodShift;onClose:()=>void}){
 const {profile}=useAuth();const [ids,setIds]=useState<string[]>([]);const [reason,setReason]=useState('');const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);
 return <div role="dialog" aria-modal="true" aria-label="Verify legacy receipt shifts" className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center"><form className="bg-white text-zinc-900 rounded-2xl p-5 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-4" onSubmit={async e=>{e.preventDefault();if(!profile||busy||!confirmed)return;setBusy(true);try{await verifyLegacyEodShift(ids,branchId,date,shift,reason,profile);toast.success('Receipt shift evidence saved. Reopen system totals.');onClose();}catch(e){toast.error(e instanceof Error?e.message:'Verification failed');}finally{setBusy(false);}}}>
 <h3 className="font-bold text-lg">Verify receipts — {date} · {shift.name}</h3>
 <p className="text-sm">IT Head only. Select only receipts you have verified belong to this shift. This saves audit evidence without changing sales, payments or balances.</p>
 {sales.map(s=><label key={s.id} className="flex gap-3 items-start border-b py-2 text-sm"><input type="checkbox" checked={ids.includes(s.id)} onChange={e=>setIds(e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id))}/><span>{s.receiptNumber||s.id} · {new Date(s.timestamp).toLocaleString('en-GB',{timeZone:'Africa/Kampala'})} EAT · UGX {(s.totalAmount??s.total??0).toLocaleString()}</span></label>)}
 <label className="block text-sm">Verification reason<textarea required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} className="block w-full border rounded-lg p-2"/></label>
 <label className="flex gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>I have verified these selected receipts and confirm that {shift.name} ran {shift.startTime}–{shift.endTime} for this business date.</span></label>
 <div className="flex gap-4"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button disabled={busy||!confirmed||!ids.length||!reason.trim()} className="bg-emerald-700 text-white rounded-lg px-4 py-2">{busy?'Saving…':'Save verified shift evidence'}</button></div>
 </form></div>;
}
