// Execute the actual one-time setup against an isolated in-memory Firestore adapter.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.argv[2]||'scripts/activate-stage2-finance.mjs','utf8')
 .replace("import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app';","const {initializeApp,applicationDefault,deleteApp}=globalThis.setupTestSdk;")
 .replace("import {getFirestore,Timestamp} from 'firebase-admin/firestore';","const {getFirestore,Timestamp}=globalThis.setupTestSdk;");
const tenantId='zehqTDcKyrDAOHKK3stJ',release='f3c83a12c9761b1d35ef7881ba810b6c0dc1c9e2';
Object.assign(process.env,{STAGE2_SETUP_AUTHORIZATION:'MARTIN_PHARMA_ACCOUNT_SETUP_ONLY',GITHUB_REF:'refs/heads/ops/stage2-finance-activation',GITHUB_ACTOR:'test-operator',GITHUB_REPOSITORY:'radahpeter-hue/PHARMHELM',GITHUB_RUN_ID:'test-only'});
delete process.env.FIRESTORE_EMULATOR_HOST;
let serial=0;
function fixture(){return {
 ['system_settings/'+tenantId]:{tenantId},
 'invoices/invoice':{tenantId,supplierInvoiceNumber:'AVN161026001234',invoiceValue:38000,paidAmountUGX:0,paymentType:'cash',grnId:'grn_test'},
 'grn_records/grn_test':{tenantId,invoice_id:'invoice'},
 'management_expenses/management_payment_draft_grn_test':{tenantId,invoiceId:'invoice',source:'procurement_cash_grn',status:'draft',excludeFromOpexRollup:true,amount:38000},
 ...Object.fromEntries(Array.from({length:22},(_,i)=>['petty_cash_ledger/'+i,{tenantId,amount:i===0?3733650:0,type:'incoming'}]))
};}
async function execute(records,{stale=false,authorization=true}={}){
 const writes=[];const snap=path=>({id:path.split('/')[1],exists:!!records[path],get:key=>records[path]?.[key],data:()=>records[path]});
 const reference=(path)=>({path,get:async()=>snap(path)});
 const db={collection:path=>({doc:id=>reference(path+'/'+id),where:()=>({path,query:true,where(){return this;}})}),runTransaction:async cb=>{
  const pending=[];
  const value=await cb({get:async ref=>ref.query?{docs:Object.keys(records).filter(k=>k.startsWith(ref.path+'/')).map(snap),size:Object.keys(records).filter(k=>k.startsWith(ref.path+'/')).length}:snap(ref.path),
   create:(ref,data)=>{assert.ok(!records[ref.path]);pending.push({kind:'create',path:ref.path,data});},
   update:(ref,data)=>{assert.ok(records[ref.path]);pending.push({kind:'update',path:ref.path,data});}});
  for(const write of pending){records[write.path]={...records[write.path],...write.data};writes.push(write);}
  return value;
 }};
 globalThis.setupTestSdk={initializeApp:()=>({}),applicationDefault:()=>({}),deleteApp:async()=>{},getFirestore:()=>db,Timestamp:{now:()=>new Date()}};
 globalThis.fetch=async url=>({ok:true,text:async()=>String(url).includes('/assets/')?(stale?'old-build':release):'<script src="/assets/app.js"></script>'});
 process.env.STAGE2_SETUP_AUTHORIZATION=authorization?'MARTIN_PHARMA_ACCOUNT_SETUP_ONLY':'NOT_AUTHORIZED';
 try{await import('data:text/javascript;base64,'+Buffer.from(source+'\n// scenario '+serial++).toString('base64'));return writes;}
 catch(error){assert.equal(writes.length,0,'Failed preflight must perform zero writes.');throw error;}
}
const valid=fixture(),writes=await execute(valid);
assert.deepEqual(writes.map(w=>w.path).sort(),['finance_payment_accounts/'+tenantId+'_management_petty_cash','system_settings/'+tenantId].sort());
assert.equal(valid['finance_payment_accounts/'+tenantId+'_management_petty_cash'].balanceUGX,3733650);
assert.equal(valid['invoices/invoice'].paidAmountUGX,0);
assert.equal(Object.keys(valid).filter(k=>k.startsWith('petty_cash_ledger/')).length,22);
const repeated=await execute(valid);assert.equal(repeated.length,1);assert.equal(repeated[0].path,'system_settings/'+tenantId);
await assert.rejects(execute(fixture(),{stale:true}),/Exact Finance release/);
await assert.rejects(execute(fixture(),{authorization:false}));
const changed=fixture();changed['petty_cash_ledger/0'].amount--;await assert.rejects(execute(changed),/Cash balance changed/);
const paid=fixture();paid['invoices/invoice'].paidAmountUGX=38000;await assert.rejects(execute(paid));
const foreign=fixture();foreign['system_settings/'+tenantId].tenantId='foreign';await assert.rejects(execute(foreign));
console.log('Authorized setup preflight passed: bounded writes, retry without replacing balance, stale release, missing approval, changed cash, paid invoice and foreign tenant guards.');
