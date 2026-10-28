/** Pure planner. Never rewrites internal IDs, personal fields or existing codes. */
export function planStaffIdentityBackfill({tenantId, staff, claims, counter}) {
  if (!tenantId || staff.some(s=>s.tenantId!==tenantId) || claims.some(c=>c.tenantId!==tenantId)) throw new Error('Backfill tenant mismatch.');
  if (counter && (counter.tenantId!==tenantId || counter.kind!=='staff')) throw new Error('Counter scope mismatch.');
  let sequence=Number(counter?.lastSequence || 0);
  if (!Number.isSafeInteger(sequence) || sequence<0) throw new Error('Invalid staff counter.');
  const claimed=new Map();
  for(const claim of claims) {
    if (!claim.code || !claim.staffId || claimed.has(claim.code)) throw new Error('Malformed or duplicate staff reservation.');
    claimed.set(claim.code,claim.staffId);
    const m=/^STF-(\d+)$/.exec(claim.code);if(m)sequence=Math.max(sequence,Number(m[1]));
  }
  const records=staff.filter(s=>!s.canonical_staff_id).sort((a,b)=>a.id.localeCompare(b.id));
  const used=new Set();
  for(const record of records) {
    const code=String(record.staff_code || '');
    if(!code)continue;
    if(code!==code.trim() || code.includes('/') || used.has(code)) throw new Error('Duplicate or malformed existing staff code: review required before any write.');
    used.add(code);
    const m=/^STF-(\d+)$/.exec(code);if(m)sequence=Math.max(sequence,Number(m[1]));
    const owner=claimed.get(code);
    const source=staff.find(s=>s.id===record.legacyStaffId);
    if(owner && owner!==record.id && !(owner===record.legacyStaffId && source?.canonical_staff_id===record.id)) throw new Error('Existing staff reservation belongs to another identity.');
  }
  if(!Number.isSafeInteger(sequence)) throw new Error('Invalid historical staff sequence.');
  const updates=[], reservations=[];
  for(const record of records) {
    let code=String(record.staff_code || '');
    if(!code) {
      sequence++;
      if(!Number.isSafeInteger(sequence))throw new Error('Staff sequence exhausted.');
      code=`STF-${String(sequence).padStart(6,'0')}`;
      updates.push({id:record.id,code,updateTime:record.updateTime});
    }
    if(!claimed.has(code)) {
      reservations.push({staffId:record.id,code}); claimed.set(code,record.id);
    }
  }
  if(updates.length+reservations.length+1>450) throw new Error('Backfill exceeds the reviewed atomic write limit; no write performed.');
  return {updates,reservations,lastSequence:sequence,summary:{staffRecords:staff.length,aliasesSkipped:staff.length-records.length,
    codesAssigned:updates.length,reservationsCreated:reservations.length,counterBefore:Number(counter?.lastSequence||0),counterAfter:sequence}};
}
