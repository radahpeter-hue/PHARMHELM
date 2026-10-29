import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { EOD_PAYMENT_CHANNELS } from '../../utils/eodExpected';
import { eodRecordVariance, eodVariance, formatEodAmount } from '../../utils/eodMoney';
import { staffReportIdentity } from '../../utils/staffReportIdentity';
export function eodAuditTime(value: any): string {
  const date = value?.toDate ? value.toDate() : new Date(value?.seconds ? value.seconds * 1000 : value || '');
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-UG', {timeZone:'Africa/Kampala',dateStyle:'medium',timeStyle:'medium'}).format(date) + ' EAT' : 'Not recorded';
}
export function EodAuditDialog({ record, staff, onClose }: {record: any; staff: any[]; onClose: () => void}) {
  const { profile } = useAuth();
  const [events, setEvents] = useState<any[]>([]);
  const [state, setState] = useState('Loading correction history…');
  useEffect(() => {
    let active = true;
    if (!profile?.tenantId || record.tenantId !== profile.tenantId) { setState('Record unavailable.'); return; }
    getDocs(query(collection(db,'audit_logs'),where('tenantId','==',profile.tenantId),where('entity_id','==',record.id))).then(snapshot => {
      if (!active) return;
      const rows = snapshot.docs.map(d=>({id:d.id,...d.data()})).filter((e:any)=>e.action==='EOD_CORRECTION');
      rows.sort((a:any,b:any)=>(b.timestamp?.seconds || 0)-(a.timestamp?.seconds || 0));
      setEvents(rows);setState('');
    }).catch(()=>{if(active)setState('Unable to load correction history.');});
    return () => {active=false;};
  },[profile?.tenantId,record.id]);
  const name = (id: string) => staffReportIdentity(id,staff,record.tenantId);
  return <div role="dialog" aria-modal="true" aria-label="EOD audit history" className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl p-5 w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4">
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-lg">EOD audit — {record.reconciliation_date}</h3><p className="text-sm">{record.shift_name || (record.shift_id ? record.shift_id : 'Historical whole-day record — shift not recorded')}{record.shift_start ? ` (${record.shift_start}–${record.shift_end})` : ''}</p></div><button onClick={onClose} className="border rounded-lg px-3 py-2">Close</button></div>
      <p className="text-sm">Submitted by {name(record.logged_by || record.cashier_id)} · {eodAuditTime(record.submitted_at || record.created_at)}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">Channel</th><th className="text-right">Expected</th><th className="text-right">Declared</th><th className="text-right">Variance</th></tr></thead><tbody>{EOD_PAYMENT_CHANNELS.map(c=><tr key={c}><td className="capitalize py-1">{c.replaceAll('_',' ')}</td><td className="text-right">{formatEodAmount(record[`${c}_expected`] || 0)}</td><td className="text-right">{formatEodAmount(record[`${c}_actual`] || 0)}</td><td className="text-right">{formatEodAmount(eodVariance(record[`${c}_actual`] || 0,record[`${c}_expected`] || 0))}</td></tr>)}</tbody></table></div>
      <p className="font-bold">Variance: UGX {formatEodAmount(eodRecordVariance(record))}</p><p className="text-sm">Variance reason: {record.variance_reason || 'None required'}</p>
      <h4 className="font-bold">Correction history</h4>
      {record.corrected_by && <p className="text-sm">Latest correction: {name(record.corrected_by)} · {eodAuditTime(record.corrected_at)} · {record.correction_reason}</p>}
      {state ? <p role="status">{state}</p> : !events.length ? <p className="text-sm text-zinc-500">No Level 3 correction events recorded. Earlier corrections retain their latest saved metadata; earlier versions cannot be reconstructed.</p> : events.map(event=><div key={event.id} className="border rounded-xl p-3 space-y-1 text-sm"><p className="font-bold">{name(event.userId)} · {eodAuditTime(event.timestamp)}</p><p>{event.reason}</p><p>Declared: UGX {formatEodAmount(event.before.total_actual || 0)} → {formatEodAmount(event.after.total_actual || 0)}</p><p>Variance: UGX {formatEodAmount(eodRecordVariance(event.before))} → {formatEodAmount(eodRecordVariance(event.after))}</p></div>)}
    </div>
  </div>;
}
