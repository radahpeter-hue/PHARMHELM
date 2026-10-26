/** Authenticated 6.1 acceptance of the real checkout and application rules. Synthetic identities only. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc, runTransaction } from 'firebase/firestore';
if(!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('An isolated emulator is required.');
mkdirSync('node_modules/.cache/phase6',{recursive:true});
await build({entryPoints:['src/services/pos-v2/posCheckoutV2Repository.ts'],outfile:'node_modules/.cache/phase6/checkout.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'isolated-runtime',setup(b){b.onResolve({filter:/(^|\/)firebase$/},args=>args.path.startsWith('.')?{path:'runtime',namespace:'test'}:undefined);b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const db=globalThis.__phase6.db;export const auth={currentUser:{uid:"seller"}};',loader:'js'}));}}]});
const env=await initializeTestEnvironment({projectId:'demo-pharmhelm-phase6',firestore:{rules:readFileSync(process.env.PHARMHELM_TEST_RULES||'firestore.rules','utf8')}});
const tenantId='martin-pharma-test',branchId='masaka-test',evidence=[];
const actor=uid=>env.authenticatedContext(uid).firestore();
const seller=actor('seller');globalThis.__phase6={db:seller};
const {prepareCheckoutV2Repository,writeCheckoutV2Transaction}=await import('../node_modules/.cache/phase6/checkout.mjs');
const read=async(c,id)=>{let v;await env.withSecurityRulesDisabled(async ctx=>{v=(await getDoc(doc(ctx.firestore(),c,id))).data();});return v;};
const count=async(c)=>{let n;await env.withSecurityRulesDisabled(async ctx=>{n=(await getDocs(collection(ctx.firestore(),c))).size;});return n;};
async function seed(){
 await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();const rows=[
   ['staff','seller',{tenantId,role:'Dispenser',status:'active',active:true,assigned_branches:[branchId],secondaryRoles:[]}],
   ['staff','finance',{tenantId,role:'Finance Head',status:'active',assigned_branches:[branchId],secondaryRoles:[]}],
   ['staff','foreign',{tenantId:'foreign-tenant',role:'Finance Head',assigned_branches:[branchId],secondaryRoles:[]}],
   ['staff','other-branch',{tenantId,role:'Finance Head',assigned_branches:['other-branch'],secondaryRoles:[]}],
   ['staff','owner',{tenantId,role:'owner',assigned_branches:[],secondaryRoles:[]}],
   ['branches',branchId,{tenantId,name:'Masaka',status:'active',branch_code:'MSK'}],
   ['products','vitc',{tenantId,name:'Vitamin C',stock:100,quantityInStock:100,unitOfSell:'unit',sellingPrice:1000,purchasePrice:100}],
   ['product_batches','batch',{tenantId,branchId,productId:'vitc',quantity:100,purchasePrice:100,sellingPrice:1000,batchNumber:'TEST',expiryDate:'2028-12-31',batch_status:'active'}],
   ['clients','peter',{tenantId,full_name:'Synthetic Peter',care_status:'active',billing_type:'self-pay'}],
   ['institutions','hospital',{tenantId,supplier_name:'Synthetic Masaka Hospital',care_status:'active',role:'billable',payment_terms:'Net 30'}],
   ['institutions','foreign-hospital',{tenantId:'foreign-tenant',supplier_name:'Foreign Hospital',care_status:'active',role:'billable'}],
   ['finance_payment_accounts',`${tenantId}_bank`,{tenantId,accountId:'bank',branchId,kind:'BANK',currency:'UGX',balanceUGX:2000000,controlVersion:2,initialized:true,active:true}]
  ];for(const[c,id,data]of rows)await setDoc(doc(db,c,id),data);
 });
}
const request=(suffix='sale',changes={})=>({attemptId:`credit-${suffix}`,branchId,items:[{productId:'vitc',productName:'Vitamin C',quantity:10,unitPrice:1000,costPrice:100,total:10000,subtotal:10000}],paymentMethod:'institutional_credit',institutionId:'hospital',institutionName:'Synthetic Masaka Hospital',context:'institutional',...changes});
async function checkout(req=request(),mutate){
 const prepared=await prepareCheckoutV2Repository('seller',req);
 return runTransaction(seller,async tx=>{
  const wrapper={get:ref=>tx.get(ref),update:(ref,data)=>tx.update(ref,data),set:(ref,data,...opts)=>{
   const result=mutate?mutate(ref,data):{ref,data};
   if(result)tx.set(result.ref,result.data,...opts);
  }};
  return writeCheckoutV2Transaction(req,prepared,wrapper);
 });
}
async function scenario(id,details,fn){await seed();await fn();evidence.push({id,preconditions:'Synthetic seeded tenant, CRM masters, stock 100 units, bank UGX 2,000,000',tenant:'Martin Pharma (controlled emulator)',branch:'Masaka (controlled emulator)',role:'Dispenser; Finance Head / owner / foreign roles for denial controls',details,expected:'Atomic valid recognition, or rejected operation with balances unchanged',observed:'Assertions passed',pass:true,commit:process.env.PHASE6_TEST_COMMIT||'local-working-tree'});console.log(`PASS ${id}: ${details}`);}
try{
 await scenario('6.1-01','institutional credit recognizes once and deducts stock without crediting bank',async()=>{
  const result=await checkout();const r=await read('credit_receivables',result.saleId);
  assert.equal(r.amount_ugx,10000);assert.equal(r.debtorId,'hospital');assert.equal(r.debtorType,'institution');assert.equal(r.credit_terms,'Net 30');assert.equal(r.due_date,null);
  assert.equal((await read('products','vitc')).stock,90);assert.equal((await read('product_batches','batch')).quantity,90);assert.equal(await count('finance_v2_account_movements'),0);assert.equal((await read('finance_payment_accounts',`${tenantId}_bank`)).balanceUGX,2000000);
 });
 await scenario('6.1-02','individual client credit uses CRM identity',async()=>{
  const result=await checkout(request('individual',{context:'walk-in',institutionId:undefined,institutionName:undefined,patientId:'peter'}));
  const r=await read('credit_receivables',result.saleId);assert.equal(r.debtorId,'peter');assert.equal(r.debtorType,'client');assert.equal(r.client_name,'Synthetic Peter');
 });
 await scenario('6.1-03','part-paid invoice debt equals only unpaid component',async()=>{
  const result=await checkout(request('partial',{secondaryPaymentMethod:'cash',secondaryAmount:2500}));const r=await read('credit_receivables',result.saleId);
  assert.equal(r.amount_ugx,7500);assert.equal(r.invoice_amount_ugx,10000);assert.equal(result.payment.settledAmount,2500);assert.equal(result.payment.outstandingAmount,7500);assert.equal(await count('sales'),1);assert.equal(await count('finance_v2_account_movements'),0);
 });
 await scenario('6.1-04','repeated and concurrent checkout identity creates one sale, debt and stock deduction',async()=>{
  const req=request('retry');const attempts=await Promise.allSettled([checkout(req),checkout(req)]);assert.ok(attempts.some(r=>r.status==='fulfilled'));const a=attempts.find(r=>r.status==='fulfilled').value;const b=await checkout(req);assert.equal(a.saleId,b.saleId);assert.equal(b.replayed,true);assert.equal(await count('credit_receivables'),1);assert.equal(await count('sales'),1);assert.equal((await read('products','vitc')).stock,90);
  await assert.rejects(checkout({...req,secondaryPaymentMethod:'cash',secondaryAmount:1000}));
 });
 for(const [id,patch]of [['forged-debtor',{debtorId:'peter'}],['negative',{amount_ugx:-1}],['fraction',{outstanding_ugx:0.5}],['unsafe',{amount_ugx:9007199254740992}],['wrong-invoice',{receipt_id:'different-sale'}],['wrong-tenant',{tenantId:'foreign-tenant'}],['forged-due-date',{due_date:'2026-01-01'}]])await scenario(`6.1-deny-${id}`,`raw authenticated malformed ${id} rejected atomically`,async()=>{
  await assert.rejects(checkout(request(id),(ref,data)=>({ref,data:ref.path.startsWith('credit_receivables/')?{...data,...patch}:data})));
  assert.equal(await count('sales'),0);assert.equal(await count('credit_receivables'),0);assert.equal((await read('products','vitc')).stock,100);
 });
 for(const missing of ['sales','pos_payments','credit_receivables'])await scenario(`6.1-missing-${missing}`,`recognition batch missing ${missing} rejected`,async()=>{
  await assert.rejects(checkout(request(`missing-${missing}`),(ref,data)=>ref.path.startsWith(`${missing}/`)?null:{ref,data}));assert.equal(await count('sales'),0);assert.equal((await read('products','vitc')).stock,100);
 });
 await scenario('6.1-identity-denials','cross-tenant debtor, missing client and billing mismatch denied',async()=>{
  await assert.rejects(checkout(request('foreign',{institutionId:'foreign-hospital'})));await assert.rejects(checkout(request('missing',{institutionId:'missing'})));
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'clients','peter'),{billing_type:'institutional-pay',institution_to_bill_id:'another'}));
  await assert.rejects(checkout(request('wrong-biller',{patientId:'peter'})));assert.equal(await count('sales'),0);
 });
 await scenario('6.1-integrity','owner and Finance cannot edit debtor, balances or delete canonical debt; branches and tenant remain scoped',async()=>{
  const result=await checkout();const id=result.saleId;
  for(const uid of ['finance','owner']){
   await assertFails(updateDoc(doc(actor(uid),'credit_receivables',id),{debtorId:'peter'}));await assertFails(updateDoc(doc(actor(uid),'credit_receivables',id),{outstanding_ugx:0}));await assertFails(deleteDoc(doc(actor(uid),'credit_receivables',id)));
   await assertFails(setDoc(doc(actor(uid),'credit_receivables','fabricated'),{tenantId,branch_id:branchId,amount_ugx:10000,outstanding_ugx:10000}));
  }
  for(const uid of ['foreign','other-branch']){await assertFails(getDoc(doc(actor(uid),'credit_receivables',id)));await assertFails(getDocs(query(collection(actor(uid),'credit_receivables'),where('tenantId','==',tenantId))));}
  assert.equal((await getDoc(doc(actor('finance'),'credit_receivables',id))).data().outstanding_ugx,10000);
  assert.equal((await getDocs(query(collection(actor('finance'),'credit_receivables'),where('tenantId','==',tenantId),where('branch_id','==',branchId)))).size,1);
 });
 await scenario('6.1-partial-tamper','payment component forgery denied independently by rules',async()=>{
  await assert.rejects(checkout(request('bad-components',{secondaryPaymentMethod:'cash',secondaryAmount:2500}),(ref,data)=>({ref,data:ref.path.startsWith('pos_payments/')?{...data,components:[{...data.components[0],amount:10000},data.components[1]]}:data})));assert.equal(await count('sales'),0);
 });
 writeFileSync('/tmp/phase6-recognition-acceptance.json',JSON.stringify({milestone:'6.1',environment:'authenticated Firestore emulator',commit:process.env.PHASE6_TEST_COMMIT||'local-working-tree',passed:evidence.length,scenarios:evidence},null,2));
 console.log(`Phase 6.1 authenticated recognition acceptance: ${evidence.length} scenarios passed.`);
}finally{await env.cleanup();}
