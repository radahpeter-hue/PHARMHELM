import { verifyLegacyEodShift } from '../src/services/eodLegacyShiftService.ts';
import { withVerifiedLegacyShifts } from '../src/utils/eodLegacyEvidence.ts';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { compactRuleSymbols } from './build-firestore-release-rules.mjs';
import { correctEod, EOD_CHANNELS } from '../src/services/eodCorrectionService.ts';
import { submitEod } from '../src/services/eodSubmissionService.ts';
import { eodIdentity } from '../src/utils/eodShifts.ts';
import { capturePosShift } from '../src/utils/posShiftAttribution.ts';
import { EOD_PAYMENT_CHANNELS, expectedEodSales } from '../src/utils/eodExpected.ts';
const env = await initializeTestEnvironment({projectId:'demo-eod-level3',firestore:{rules:compactRuleSymbols(readFileSync('firestore.rules','utf8'))}});
const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const yesterday = new Date(Date.parse(`${day}T12:00:00Z`)-86400000).toISOString().slice(0,10);
const shifts = { dayShift:{enabled:true,startTime:'07:30',endTime:'17:00'}, eveningShift:{enabled:true,startTime:'17:00',endTime:'22:00'},nightShift:{enabled:false,startTime:'22:00',endTime:'07:30'} };
const actor = {uid:'cashier-a',tenantId:'mp'};
const client = (uid='cashier-a') => env.authenticatedContext(uid).firestore();
const input = (extra={}) => ({tenantId:'mp',branch_id:'masaka',reconciliation_date:day,shift_id:'dayShift',shift_name:'Day Shift',shift_start:'07:30',shift_end:'17:00',
  ...Object.fromEntries(EOD_PAYMENT_CHANNELS.flatMap(c=>[[c+'_expected',c==='cash'?500000:0],[c+'_actual',c==='cash'?500000:0]])),...extra});
const all = async () => {let result;await env.withSecurityRulesDisabled(async ctx => {result=(await getDocs(collection(ctx.firestore(),'eod_reconciliations'))).docs.map(d=>({id:d.id,...d.data()}));});return result;};
try {
 await env.withSecurityRulesDisabled(async ctx => {
  const db=ctx.firestore();
  for(const uid of ['cashier-a','cashier-b'])await setDoc(doc(db,'staff',uid),{tenantId:'mp',role:'cashier',active:true,status:'active',assigned_branches:['masaka','other']});
  await setDoc(doc(db,'staff','foreign'),{tenantId:'foreign',role:'cashier',active:true,status:'active',assigned_branches:['foreign-branch']});
  await setDoc(doc(db,'staff','it'),{tenantId:'mp',role:'IT Head',active:true,status:'active'});
  for(const id of ['masaka','other','unassigned'])await setDoc(doc(db,'branches',id),{tenantId:'mp',name:id,status:'Active',shifts});
  await setDoc(doc(db,'branches','foreign-branch'),{tenantId:'foreign',name:'Foreign',status:'Active',shifts});
 });
 const db=client();
 const normal=await submitEod(input(),actor,db);assert.equal(normal.replayed,false);assert.equal((await all()).length,1);
 assert.equal(normal.id,eodIdentity('mp','masaka',day,'dayShift'));
 console.log('PASS 028 A: normal authenticated submission creates canonical audit');
 const twice=await Promise.all([submitEod(input({reconciliation_date:yesterday}),actor,db),submitEod(input({reconciliation_date:yesterday}),actor,db)]);
 assert.equal(new Set(twice.map(r=>r.id)).size,1);assert.equal(twice.filter(r=>!r.replayed).length,1);assert.equal((await all()).length,2);
 console.log('PASS 028 B: concurrent same-session submissions have one winner');
 const sessionInput=input({branch_id:'other'});
 const sessions=await Promise.all([submitEod(sessionInput,actor,client()),submitEod({...sessionInput,cash_actual:490000,variance_reason:'Second session shortage'},{uid:'cashier-b',tenantId:'mp'},client('cashier-b'))]);
 assert.equal(sessions.filter(r=>!r.replayed).length,1);assert.equal(new Set(sessions.map(r=>r.id)).size,1);assert.equal((await all()).length,3);
 const winning=(await all()).find(r=>r.id===sessions[0].id);assert.ok([500000,490000].includes(winning.total_actual));
 console.log('PASS 028 C: independent authenticated sessions, conflicting declarations, one preserved winner');
 await assert.rejects((async()=>{await submitEod(input(),actor,db);throw new Error('Lost network acknowledgement');})(),/Lost network/);
 const retry=await submitEod(input({cash_actual:1,variance_reason:'must not overwrite'}),actor,db);assert.equal(retry.replayed,true);
 assert.equal((await all()).find(r=>r.id===normal.id).cash_actual,500000);
 console.log('PASS 028 D: retry after lost acknowledgement returns original without overwrite');
 const evening=await submitEod(input({shift_id:'eveningShift',shift_name:'Evening Shift',shift_start:'17:00',shift_end:'22:00'}),actor,db);assert.notEqual(evening.id,normal.id);
 assert.equal((await all()).length,4);console.log('PASS 028 E/F/G: different shift/date/branch independent');
 const foreign=await submitEod(input({tenantId:'foreign',branch_id:'foreign-branch'}),{uid:'foreign',tenantId:'foreign'},client('foreign'));
 assert.notEqual(foreign.id,normal.id);assert.equal((await all()).length,5);
 await assert.rejects(submitEod(input({tenantId:'foreign',branch_id:'foreign-branch'}),actor,db),/tenant/);
 await assertFails(getDoc(doc(client('foreign'),'eod_reconciliations',normal.id)));
 await assert.rejects(submitEod(input({branch_id:'unassigned'}),actor,db),/assigned/);
 await assert.rejects(submitEod(input({shift_id:'nightShift',shift_start:'22:00',shift_end:'07:30'}),actor,db),/Shift configuration/);
 console.log('PASS 028 H: tenant isolated; wrong branch, disabled shift rejected');
 // The security property needed by the create-only transaction is verified on
 // actual deployed predicates, including IT Head (the sole correction role).
 const saved=(await all()).find(r=>r.id===normal.id);
 for(const uid of ['cashier-a','cashier-b','it'])await assertFails(setDoc(doc(client(uid),'eod_reconciliations',normal.id),{...saved,submission_attempt_id:'replacement-attempt',cash_actual:0}));
 await assertFails(updateDoc(doc(client('it'),'eod_reconciliations',normal.id),{shift_id:'eveningShift'}));
 assert.equal((await all()).find(r=>r.id===normal.id).cash_actual,500000);
 await assert.rejects(submitEod(input({branch_id:'other',reconciliation_date:yesterday,cash_actual:495000}),actor,db),/reason/);
 console.log('PASS 028 existing Rules reject submission replacement even for IT Head; variance reason enforced');
 const declarations=Object.fromEntries(EOD_CHANNELS.map(c=>[c,c==='cash'?495000:0]));
 const itProfile={uid:'it',tenantId:'mp',role:'IT Head'};
 await correctEod(normal.id,itProfile,declarations,'First count reviewed',client('it'));
 declarations.cash=490000;
 await correctEod(normal.id,itProfile,declarations,'Second count reviewed',client('it'));
 let audits=[];await env.withSecurityRulesDisabled(async ctx=>{audits=(await getDocs(collection(ctx.firestore(),'audit_logs'))).docs.map(d=>d.data());});
 const corrections=audits.filter(e=>e.entity_id===normal.id);
 assert.equal(corrections.length,2);
 assert.deepEqual(corrections.map(e=>e.reason).sort(),['First count reviewed','Second count reviewed']);
 assert.ok(corrections.some(e=>e.before.total_actual===500000&&e.after.total_actual===495000));
 assert.ok(corrections.some(e=>e.before.total_actual===495000&&e.after.total_actual===490000));
 assert.ok(corrections.every(e=>e.userId==='it'&&e.timestamp&&e.before.reconciliation_date===day));
 assert.equal((await all()).length,5);assert.equal((await all()).find(r=>r.id===normal.id).shift_id,'dayShift');
 await assert.rejects(correctEod(normal.id,{...actor,role:'cashier'},declarations,'Denied',db),/locked/);
 const cutoff=new Date(Date.parse(`${day}T12:00:00Z`)-14*86400000).toISOString().slice(0,10);
 const lockedId='historic-lock';await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'eod_reconciliations',lockedId),{...input({reconciliation_date:cutoff}),total_expected:500000,total_actual:500000});});
 await assert.rejects(correctEod(lockedId,itProfile,declarations,'Too late',client('it')),/locked/);
 console.log('PASS 029: two corrections preserve before/after/actor/time/reason, original submission identity and independent history; non-IT/14-day lock retained');
 const legacyReceipts=[8000,5000,6000,1000,1000,14600].map((amount,i)=>({id:'old-'+i,tenantId:'mp',branchId:'masaka',timestamp:yesterday+'T07:29:00Z',status:'completed',paymentMethod:'cash',totalAmount:amount}));
 await env.withSecurityRulesDisabled(async ctx=>{for(const sale of legacyReceipts)await setDoc(doc(ctx.firestore(),'sales',sale.id),sale);});
 const selectedLegacyShift={id:'dayShift',name:'Day Shift',startTime:'07:30',endTime:'17:00'};
 const verify=profile=>verifyLegacyEodShift(legacyReceipts.map(s=>s.id),'masaka',yesterday,selectedLegacyShift,'Owner verified six receipts',profile,client(profile.uid));
 await assert.rejects(verify({...actor,role:'cashier'}),/IT Head/);
 await Promise.all([verify(itProfile),verify(itProfile)]);await verify(itProfile);
 let legacyEvidence=[];await env.withSecurityRulesDisabled(async ctx=>{legacyEvidence=(await getDocs(collection(ctx.firestore(),'audit_logs'))).docs.filter(d=>d.id.startsWith('e_')).map(d=>({id:d.id,...d.data()}));});
 assert.equal(legacyEvidence.length,6);
 assert.equal(expectedEodSales(withVerifiedLegacyShifts(legacyReceipts,legacyEvidence),'mp','masaka',yesterday,'dayShift').computedExpected.total,35600);
 await assert.rejects(verifyLegacyEodShift(['old-0'],'masaka',day,selectedLegacyShift,'Do not reassign',itProfile,client('it')),/already verified/);
 await assert.rejects(verifyLegacyEodShift(['old-0'],'foreign-branch',yesterday,selectedLegacyShift,'Wrong branch',itProfile,client('it')),/outside|unavailable/);
 const assignment=doc(client('it'),'audit_logs','e_mp~old-0');
 await assertFails(updateDoc(assignment,{shift_id:'eveningShift'}));await assertFails(deleteDoc(assignment));
 await assertFails(setDoc(doc(db,'audit_logs','e_mp~forged'),{...legacyEvidence[0],sale_id:'forged',userId:actor.uid}));
 await assertFails(getDoc(doc(client('foreign'),'audit_logs','e_mp~old-0')));
 const anonymous=env.unauthenticatedContext().firestore();await assertFails(getDoc(doc(anonymous,'audit_logs','e_mp~old-0')));await assertFails(setDoc(doc(anonymous,'audit_logs','anonymous-audit'),{tenantId:'mp',action:'ordinary'}));
 const ordinaryAudit=doc(db,'audit_logs','ordinary-audit');await setDoc(ordinaryAudit,{tenantId:'mp',action:'ordinary'});await updateDoc(ordinaryAudit,{action:'ordinary update'});await deleteDoc(ordinaryAudit);
 console.log('PASS legacy receipts: IT Head verification 35,600, replay safe, assignment immutable, cashier/cross-tenant/branch denial, no sale rewrite');

 const financialCollections=['sales','pos_payments','pos_transaction_outbox','finance_ledger','banking_records','banking_transactions','cashTransfers','finance_payment_accounts','petty_cash_ledger','credit_receivables','financial_posting_audit'];
 const snapshotFinancial=async()=>{const result={};await env.withSecurityRulesDisabled(async ctx=>{for(const name of financialCollections)result[name]=(await getDocs(collection(ctx.firestore(),name))).docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.id.localeCompare(b.id));});return JSON.stringify(result);};
 const controlledSales=[];
 await env.withSecurityRulesDisabled(async ctx=>{
  const seedDb=ctx.firestore();
  await setDoc(doc(seedDb,'branches','controlled'),{tenantId:'mp',name:'Controlled',status:'Active',shifts});
  await updateDoc(doc(seedDb,'staff','cashier-a'),{assigned_branches:['masaka','other','controlled']});
  for(const date of [day,yesterday]){
   const sale={id:'controlled-'+date,tenantId:'mp',branchId:'controlled',timestamp:date+'T10:00:00Z',status:'completed',paymentMethod:'cash',totalAmount:500000,eodShift:capturePosShift({shifts},date+'T10:00:00Z')};
   controlledSales.push(sale);await setDoc(doc(seedDb,'sales',sale.id),sale);
  }
 });
 const financialBefore=await snapshotFinancial();
 for(const [date,declared] of [[day,500000],[yesterday,495000]]){
  const expected=expectedEodSales(controlledSales,'mp','controlled',date,'dayShift');assert.equal(expected.computedExpected.total,500000);
  const declaration=input({branch_id:'controlled',reconciliation_date:date,cash_expected:expected.computedExpected.cash,cash_actual:declared});
  if(declared<500000){await assert.rejects(submitEod(declaration,actor,db),/reason/);declaration.variance_reason='Controlled count shortage';}
  const audit=await submitEod(declaration,actor,db);
  const record=(await all()).find(r=>r.id===audit.id);
  assert.equal(record.total_variance,declared-500000);assert.equal(record.audit_only,true);assert.equal(record.financial_posting,'none');
  assert.equal((await all()).filter(r=>r.id===audit.id).length,1);
  assert.equal(await snapshotFinancial(),financialBefore);
 }
 console.log('PASS 031: controlled POS 500,000 exact and 495,000 shortage produce only audits; sales/payments/outbox/revenue/bank/ledger snapshots unchanged, no balancing movements');
 // Run the actual checkout repository with only its Firebase connection replaced.
 await env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),'staff','seller'),{tenantId:'mp',role:'Dispenser',active:true,status:'active',assigned_branches:['checkout']});
  await setDoc(doc(ctx.firestore(),'branches','checkout'),{tenantId:'mp',name:'Checkout',branch_code:'MSK',status:'Active',shifts});
 });
 globalThis.__eodCheckoutDb=client('seller');
 mkdirSync('node_modules/.cache/eod-level3',{recursive:true});
 await build({entryPoints:['src/services/pos-v2/posCheckoutV2Repository.ts'],outfile:'node_modules/.cache/eod-level3/checkout.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'isolated-checkout-connection',setup(b){b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db=globalThis.__eodCheckoutDb;export const auth={currentUser:{uid:"seller"}};',loader:'js'}));}}]});
 const checkout=await import('../node_modules/.cache/eod-level3/checkout.mjs');
 const request={attemptId:'level3-checkout',branchId:'checkout',items:[{productId:'consultation',name:'Consultation',isService:true,quantity:1,commercialQuantity:1,unitPrice:500000,actualUnitPrice:500000,subtotal:500000,lineTotal:500000}],paymentMethod:'cash'};
 const prepared=await checkout.prepareCheckoutV2Repository('seller',request);
 const liveShifts={dayShift:{enabled:true,startTime:'00:00',endTime:'12:00'},eveningShift:{enabled:true,startTime:'12:00',endTime:'00:00'},nightShift:{enabled:false,startTime:'00:00',endTime:'01:00'}};
 await env.withSecurityRulesDisabled(async ctx=>{await updateDoc(doc(ctx.firestore(),'branches','checkout'),{shifts:liveShifts});});
 const committed=await checkout.commitCheckoutV2(request,prepared);
 assert.equal(committed.sale.totalAmount,500000);
 assert.deepEqual(committed.sale.eodShift,capturePosShift({shifts:liveShifts},committed.sale.timestamp));
 assert.ok(committed.sale.eodShift);assert.notEqual(committed.sale.eodShift.startTime,shifts[committed.sale.eodShift.shiftId].startTime);
 const replayed=await checkout.commitCheckoutV2(request,prepared);
 assert.equal(replayed.replayed,true);assert.equal(replayed.saleId,committed.saleId);assert.deepEqual(replayed.sale.eodShift,committed.sale.eodShift);
 console.log('PASS actual V2 checkout: atomic sale stores live Settings shift snapshot, canonical 500,000 payment, idempotent replay preserves attribution');



} finally {await env.cleanup();}
