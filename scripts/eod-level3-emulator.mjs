import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { compactRuleSymbols } from './build-firestore-release-rules.mjs';
import { submitEod } from '../src/services/eodSubmissionService.ts';
import { eodIdentity } from '../src/utils/eodShifts.ts';
import { EOD_PAYMENT_CHANNELS } from '../src/utils/eodExpected.ts';
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
} finally {await env.cleanup();}
