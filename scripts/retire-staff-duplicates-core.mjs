import {staffDuplicateEvidence} from './staff-duplicate-evidence.mjs';
import {planStaffDuplicateAudit} from '../src/utils/staffIdentityAudit.ts';
/** No transaction amounts, personal data, permissions or Auth users are rewritten. */
export async function retireStaffDuplicates(db,auth,tenantId,{apply=false,deleteField}={}) {
 const evidence=await staffDuplicateEvidence(db,auth,tenantId);
 if(evidence.plan.summary.reviewGroups)throw new Error('Ambiguous staff identity groups require review; no retirement applied.');
 const run=async tx=>{
  const read=q=>tx?tx.get(q):q.get();
  const snapshot=await read(db.collection('staff').where('tenantId','==',tenantId));
  const pending=await read(db.collection('pending_activations').where('tenantId','==',tenantId));
  const claims=await read(db.collection('staff_identity_claims').where('tenantId','==',tenantId));
  const staff=snapshot.docs.map(d=>({...d.data(),id:d.id}));
  const plan=planStaffDuplicateAudit(staff,evidence.auth);
  if(plan.summary.reviewGroups)throw new Error('Staff identity evidence changed; no retirement applied.');
  let pendingClosed=0;
  for(const group of plan.groups) {
   const canonical=staff.find(s=>s.id===group.canonicalId);
   const duplicates=group.duplicateIds.map(id=>staff.find(s=>s.id===id));
   // Do not infer or combine welfare balances from duplicate profile snapshots.
   if(duplicates.some(d=>Number(d.welfare_spent||0)>Number(canonical.welfare_spent||0)||Number(d.welfare_used_ytd||0)>Number(canonical.welfare_used_ytd||0)))throw new Error('A legacy welfare balance exceeds its live account snapshot; financial review required before retirement.');
   for(const d of duplicates){if(!d.staff_code||!claims.docs.some(c=>c.data().code===d.staff_code&&c.data().staffId===d.id))throw new Error('Duplicate number lacks its permanent reservation.');}
   const aliases=Array.from(new Set([...(canonical.identity_alias_ids||[]),...duplicates.flatMap(d=>[d.id,d.uid,d.legacyStaffId])].filter(v=>v&&v!==canonical.id)));
   if(apply){
    tx.update(db.collection('staff').doc(canonical.id),{identity_alias_ids:aliases,identity_cleanup_at:new Date().toISOString()});
    for(const d of duplicates)tx.update(db.collection('staff').doc(d.id),{
     duplicate_of:canonical.id,canonical_staff_id:canonical.id,is_duplicate:true,status:'inactive',active:false,
     retired_staff_code:d.staff_code,retired_employee_id:d.employee_id||null,staff_code:deleteField(),employee_id:deleteField(),identity_retired_at:new Date().toISOString()
    });
   }
   for(const p of pending.docs)if(group.duplicateIds.includes(p.data().staffId)&&p.data().status==='pending'){
    pendingClosed++;if(apply)tx.update(p.ref,{status:'duplicate_retired',canonicalStaffId:canonical.id,completedAt:new Date().toISOString()});
   }
  }
  return {mode:apply?'DUPLICATE_STAFF_RETIREMENT_APPLIED':'READ_ONLY_DUPLICATE_RETIREMENT_PLAN',...plan.summary,operationalStaff:staff.length-staff.filter(s=>s.duplicate_of||s.canonical_staff_id||s.is_duplicate).length-plan.summary.verifiedDuplicates,
   pendingActivationsClosed:pendingClosed,financialFieldsChanged:false,authUsersChanged:false,staffNumbersReassigned:false};
 };
 const report=apply?await db.runTransaction(run):await run(null);
 if(apply){const verified=await staffDuplicateEvidence(db,auth,tenantId);if(verified.plan.summary.duplicateGroups)throw new Error('Staff duplicate post-release verification failed.');
  for(const s of verified.staff.filter(s=>s.duplicate_of))if(s.staff_code||s.employee_id||s.active!==false)throw new Error('A retired duplicate remains operational.');}
 return report;
}
