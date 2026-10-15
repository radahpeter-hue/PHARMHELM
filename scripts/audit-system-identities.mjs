/**
 * READ-ONLY PharmHelm named-Firestore identity audit.
 * Uses CI service account via GOOGLE_APPLICATION_CREDENTIALS.
 * No individual names, contact details, raw record IDs or patient data are logged.
 * No create/update/delete/batch/transaction operations.
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const projectId = 'gen-lang-client-0911422817';
const databaseId = 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
export const definitions = {
  tenants: { prefix: 'TEN', field: 'tenant_code', kind: 'tenants', global: true },
  branches: { prefix: 'BR', field: 'branch_code', kind: 'branches' },
  clients: { prefix: 'PAT', field: 'patient_code', kind: 'patients' },
  prescribers: { prefix: 'PRE', field: 'prescriber_code', kind: 'prescribers' },
  institutions: { prefix: 'INS', field: 'institution_code', kind: 'institutions' },
  products: { prefix: 'PRD', field: 'productId', kind: 'products' },
  staff: { prefix: 'STF', field: 'employee_id', kind: 'staff' }
};

export function analyseIdentitySnapshot(records, counters = []) {
  const result = { mode: 'READ_ONLY', database: databaseId, collections: {}, tenants: [], blockers: [], counterBaselines: [] };
  const tenants = records.tenants || [];
  const tenantLookup = new Map(tenants.map(t => [t.id, t]));
  const knownCodes = new Map();
  const baselineMap = new Map(counters.map(c => [c.id, Number(c.lastSequence || 0)]));
  const all = [];

  for (const [collectionName, def] of Object.entries(definitions)) {
    for (const rec of records[collectionName] || []) {
      const scope = def.global ? 'platform' : rec.tenantId;
      const counterId = def.global ? 'platform_tenants' : `${scope}_${def.kind}`;
      all.push({ collectionName, rec, scope, counterId, ...def });
    }
  }
  for (const rec of records.operational_inventory_masters || []) {
    const fixed = rec.operationalType === 'FIXED_ASSET' || rec.type === 'fixed';
    const kind = fixed ? 'operational_assets' : 'operational_consumables';
    all.push({ collectionName:'operational_inventory_masters', rec, scope:rec.tenantId,
      counterId:`${rec.tenantId}_${kind}`, prefix:fixed?'AST':'OPS', field:'uniqueId', kind });
  }

  const summaries = new Map();
  const getSum = (scope, kind, collectionName) => {
    const key = `${scope}|${kind}`;
    if (!summaries.has(key)) summaries.set(key, {
      scope, kind, collection: collectionName, count:0, missing:0, formatted:0,
      legacyOrInvalidFormat:0, duplicate:0, missingTenant:0, skuMissing:0, skuDuplicate:0, skuInvalid:0,
      maxExistingSequence:0, currentCounter:0, safeStartingSequence:0, nextCandidate:''
    });
    return summaries.get(key);
  };
  const usedSku = new Map();

  // Pass 1: establish maxima for ALL records before predicting counter baselines.
  for (const entry of all) {
    const {rec,scope,counterId,prefix,field,kind,collectionName} = entry;
    const sum=getSum(scope || 'UNKNOWN',kind,collectionName);
    sum.count++;
    if (!scope) { sum.missingTenant++; result.blockers.push({type:'MISSING_TENANT_SCOPE',collection:collectionName}); }
    const value=String(rec[field] || '').trim();
    if (!value) { sum.missing++; continue; }
    const pattern=new RegExp(`^${prefix}-(\\d+)$`);
    const match=pattern.exec(value);
    if (match && Number.isSafeInteger(Number(match[1]))) {
      sum.formatted++;
      sum.maxExistingSequence=Math.max(sum.maxExistingSequence,Number(match[1]));
    } else sum.legacyOrInvalidFormat++;
    const uniqueKey=`${counterId}|${value.toUpperCase()}`;
    if (knownCodes.has(uniqueKey)) {
      sum.duplicate++;
      result.blockers.push({type:'DUPLICATE_CODE',collection:collectionName,kind});
    } else knownCodes.set(uniqueKey,true);
  }
  for(const p of records.products || []) {
    const sum=getSum(p.tenantId||'UNKNOWN','products','products');
    const sku=String(p.sku||'').trim();
    if (!sku) { sum.skuMissing++; continue; }
    if (!/^SKU-[A-Za-z0-9_-]+$/.test(sku)) sum.skuInvalid++;
    const key=`${p.tenantId}|${sku.toUpperCase()}`;
    if (usedSku.has(key)) { sum.skuDuplicate++; result.blockers.push({type:'DUPLICATE_SKU',collection:'products'}); }
    usedSku.set(key,true);
  }

  // Distinguish the pre-existing counter from the safe starting value.
  for (const [key,sum] of summaries) {
    const counterId=sum.scope==='platform' ? 'platform_tenants': `${sum.scope}_${sum.kind}`;
    sum.currentCounter=baselineMap.get(counterId) || 0;
    sum.safeStartingSequence=Math.max(sum.currentCounter,sum.maxExistingSequence);
    sum.nextCandidate=`${({ tenants:'TEN',branches:'BR',patients:'PAT',prescribers:'PRE',institutions:'INS',products:'PRD',staff:'STF',operational_assets:'AST',operational_consumables:'OPS' })[sum.kind]}-${String(sum.safeStartingSequence+1).padStart(6,'0')}`;
    if(sum.currentCounter<sum.maxExistingSequence)
      result.blockers.push({type:'COUNTER_BELOW_EXISTING_SEQUENCE',kind:sum.kind,collection:sum.collection});
    if (sum.legacyOrInvalidFormat>0)
      result.blockers.push({type:'LEGACY_CODE_FORMAT',kind:sum.kind,collection:sum.collection});
    result.counterBaselines.push({scope:sum.scope==='platform'?'platform':createHash('sha256').update(sum.scope).digest('hex').slice(0,12),kind:sum.kind,
      current:sum.currentCounter,minimumSafeStartingSequence:sum.safeStartingSequence,nextCandidate:sum.nextCandidate});
    const acc=result.collections[sum.collection] ||= {total:0,missing:0,duplicates:0,legacyFormat:0,missingTenant:0,skuMissing:0,skuDuplicates:0};
    acc.total+=sum.count; acc.missing+=sum.missing;acc.duplicates+=sum.duplicate;
    acc.legacyFormat+=sum.legacyOrInvalidFormat;acc.missingTenant+=sum.missingTenant;
    acc.skuMissing+=sum.skuMissing;acc.skuDuplicates+=sum.skuDuplicate;
  }

  // Summary per tenant, without database document IDs or names of individual people.
  for(const t of tenants) {
    const title=String(t.name || '').slice(0,80);
    const isMartin=/martin\s*pharma/i.test(title) || /martin/i.test(String(t.slug||''));
    const buckets=[...summaries.values()].filter(s=>s.scope===t.id);
    result.tenants.push({
      tenant:isMartin?'Martin Pharma':title || '(unnamed tenant)',
      isMartinPharma:isMartin,
      records:buckets.reduce((v,s)=>v+s.count,0),
      missing:buckets.reduce((v,s)=>v+s.missing,0),
      duplicates:buckets.reduce((v,s)=>v+s.duplicate+s.skuDuplicate,0),
      kinds:Object.fromEntries(buckets.map(s=>[s.kind,{count:s.count,missing:s.missing,duplicates:s.duplicate,
        legacyFormat:s.legacyOrInvalidFormat,counter:s.currentCounter,
        safeStartingSequence:s.safeStartingSequence,nextCandidate:s.nextCandidate}]))
    });
  }
  result.totalTenants=tenants.length;
  result.martinPharmaFound=result.tenants.some(t=>t.isMartinPharma);
  result.blockerCounts=Object.fromEntries([...new Set(result.blockers.map(b=>b.type))].map(type=>[type,result.blockers.filter(b=>b.type===type).length]));
  // Do not include raw tenant Firestore identifiers, only summary counts.
  result.counterBaselines.sort((a,b)=>a.scope.localeCompare(b.scope)||a.kind.localeCompare(b.kind));
  result.blockers=[]; // full unredacted occurrences remain inside the process only
  return result;
}

async function main() {
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Expected named live Firestore, received an emulator.');
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app=initializeApp({credential:applicationDefault(),projectId},'read-only-identity-audit');
  const db=getFirestore(app,databaseId);
  const records={};
  for (const [name,def] of Object.entries(definitions)) {
    const fields = new Set([def.field]);
    if(name!=='tenants')fields.add('tenantId');
    if(name==='tenants'){fields.add('name');fields.add('slug');}
    if(name==='products')fields.add('sku');
    const snaps=await db.collection(name).select(...fields).get();
    records[name]=snaps.docs.map(d=>({id:d.id,...d.data()}));
  }
  const masters=await db.collection('operational_inventory_masters')
    .select('tenantId','uniqueId','operationalType','type').get();
  records.operational_inventory_masters=masters.docs.map(d=>({id:d.id,...d.data()}));
  const counters=await db.collection('identity_sequence_counters').select('kind','tenantId','lastSequence').get();
  const report=analyseIdentitySnapshot(records,counters.docs.map(d=>({id:d.id,...d.data()})));
  const out=process.argv[2] || '/tmp/pharmhelm-identity-audit-summary.json';
  writeFileSync(out,JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:'AUDIT_COMPLETED_READ_ONLY',database:databaseId,totalTenants:report.totalTenants,
    martinPharmaFound:report.martinPharmaFound,collections:report.collections,
    blockerCounts:report.blockerCounts,
    martinPharma:report.tenants.find(t=>t.isMartinPharma)||null},null,2));
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) {
  main().catch(err=>{console.error('IDENTITY_AUDIT_FAILED:',err.code||err.message);process.exitCode=1;});
}
