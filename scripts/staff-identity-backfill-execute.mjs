import { planStaffIdentityBackfill } from './staff-identity-backfill-plan.mjs';
/** Shared by the emulator and the owner-authorised live release job. */
export async function executeStaffIdentityBackfill(db,tenantId,apply=false) {
  const staffQuery=db.collection('staff').where('tenantId','==',tenantId);
  const claimQuery=db.collection('staff_identity_claims').where('tenantId','==',tenantId);
  const counterRef=db.collection('identity_sequence_counters').doc(`${tenantId}_staff`);
  const run=async tx=>{
    const read=ref=>tx?tx.get(ref):ref.get();
    const staffSnap=await read(staffQuery),claimSnap=await read(claimQuery),counterSnap=await read(counterRef);
    const staff=staffSnap.docs.map(d=>({...d.data(),id:d.id,updateTime:d.updateTime.toDate().toISOString()}));
    const claims=claimSnap.docs.map(d=>d.data());const counter=counterSnap.exists?counterSnap.data():null;
    const plan=planStaffIdentityBackfill({tenantId,staff,claims,counter});
    if(apply) {
      for(const item of plan.updates)tx.update(db.collection('staff').doc(item.id),{staff_code:item.code});
      for(const claim of plan.reservations)tx.create(db.collection('staff_identity_claims').doc(`${tenantId}_${claim.code}`),{tenantId,...claim,createdAt:new Date().toISOString()});
      if(plan.lastSequence!==Number(counter?.lastSequence||0))tx.set(counterRef,{...(counter||{}),tenantId,kind:'staff',lastSequence:plan.lastSequence,updatedAt:new Date().toISOString()});
    }
    return plan.summary;
  };
  const summary=apply?await db.runTransaction(run):await run(null);
  if(apply) {
    const verified=await executeStaffIdentityBackfill(db,tenantId,false);
    if(verified.codesAssigned || verified.reservationsCreated)throw new Error('Staff identity verification incomplete.');
  }
  return summary;
}
