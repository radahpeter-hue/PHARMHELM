/**
 * Initialize only existing numbered-code sequence baselines. NO ENTITY WRITES.
 * Default is dry run; --apply permits ONLY monotonic counter updates.
 * Requires authenticated service-account access to named Firestore.
 */
import { definitions } from './audit-system-identities.mjs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'gen-lang-client-0911422817';
const databaseId = 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';

export function safeIdentityCounterBaselines(records) {
  const maxima = new Map();
  const seen = new Set();
  for(const [collectionName,def] of Object.entries(definitions)) {
    for(const rec of records[collectionName] || []) {
      const tenant=def.global ? 'platform' : rec.tenantId;
      if(!tenant) throw new Error('Record without tenant scope: '+collectionName);
      const value=String(rec[def.field] || '').trim();
      if(!value) continue;
      const counterId=def.global?'platform_tenants':`${tenant}_${def.kind}`;
      const dup=`${counterId}|${value.toUpperCase()}`;
      if(seen.has(dup)) throw new Error('Duplicate established canonical ID in '+collectionName);
      seen.add(dup);
      const match=new RegExp(`^${def.prefix}-(\\d+)$`).exec(value);
      if(match) maxima.set(counterId,{kind:def.kind,tenantId:def.global?undefined:tenant,scope:def.global?'platform':undefined,
        lastSequence:Math.max(maxima.get(counterId)?.lastSequence||0,Number(match[1]))});
    }
  }
  for(const rec of records.operational_inventory_masters || []) {
    if(!rec.tenantId)throw new Error('Operational master without tenant');
    const asset=rec.operationalType==='FIXED_ASSET'||rec.type==='fixed';
    const kind=asset?'operational_assets':'operational_consumables';
    const prefix=asset?'AST':'OPS';
    const value=String(rec.uniqueId||'').trim();
    if(!value)continue;
    const counterId=`${rec.tenantId}_${kind}`;
    const dup=`${counterId}|${value.toUpperCase()}`;
    if(seen.has(dup))throw new Error('Duplicate established Operational ID');
    seen.add(dup);
    const match=new RegExp(`^${prefix}-(\\d+)$`).exec(value);
    if(match)maxima.set(counterId,{kind,tenantId:rec.tenantId,lastSequence:Math.max(maxima.get(counterId)?.lastSequence||0,Number(match[1]))});
  }
  return maxima;
}

async function main() {
  if(process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Named production Firestore only; emulator detected.');
  const apply=process.argv.includes('--apply');
  const app=initializeApp({credential:applicationDefault(),projectId},'identity-counter-baseline');
  const db=getFirestore(app,databaseId);
  const records={};
  for(const [name,def] of Object.entries(definitions)) {
    const fields=[def.field];
    if(!def.global)fields.push('tenantId');
    const snaps=await db.collection(name).select(...fields).get();
    records[name]=snaps.docs.map(d=>d.data());
  }
  const masters=await db.collection('operational_inventory_masters').select('tenantId','uniqueId','type','operationalType').get();
  records.operational_inventory_masters=masters.docs.map(d=>d.data());
  const maxima=safeIdentityCounterBaselines(records);
  let changed=0,unchanged=0,planned=0;
  for(const [counterId,info] of maxima) {
    const ref=db.collection('identity_sequence_counters').doc(counterId);
    const snap=await ref.get();
    const existing=Number(snap.data()?.lastSequence||0);
    if(snap.exists() && (snap.data().kind!==info.kind || (info.tenantId && snap.data().tenantId!==info.tenantId)))
      throw new Error('Counter scope mismatch: refusing to initialize');
    if(existing>=info.lastSequence){unchanged++;continue;}
    planned++;
    if(!apply)continue;
    const didWrite=await db.runTransaction(async tx=>{
      const current=await tx.get(ref);
      const value=Number(current.data()?.lastSequence||0);
      if(current.exists() && (current.data().kind!==info.kind || (info.tenantId && current.data().tenantId!==info.tenantId)))throw new Error('Counter scope changed: aborting.');
      if(value>=info.lastSequence)return false;
      const payload={kind:info.kind,lastSequence:info.lastSequence,updatedAt:new Date().toISOString(),
        ...(info.tenantId?{tenantId:info.tenantId}:{scope:'platform'})};
      tx.set(ref,payload);
      return true;
    });
    if(didWrite)changed++;else unchanged++;
  }
  console.log(JSON.stringify({mode:apply?'COUNTERS_ONLY_APPLIED':'READ_ONLY_PREVIEW',database:databaseId,
    distinctCounterBaselines:maxima.size,aboveCurrent:planned,countersUpdated:changed,unchanged},null,2));
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(error=>{console.error('COUNTER_BASELINE_ABORTED',error.code||error.message);process.exitCode=1;});
}
