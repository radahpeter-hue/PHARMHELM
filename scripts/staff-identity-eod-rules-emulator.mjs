import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { compactRuleSymbols } from './build-firestore-release-rules.mjs';
import { ensureStaffIdentity, backfillStaffIdentities } from '../src/services/staffIdentityService.ts';
import { planStaffIdentityBackfill } from './staff-identity-backfill-plan.mjs';
import { correctEod, EOD_CHANNELS } from '../src/services/eodCorrectionService.ts';
import { createScopedIdentity } from '../src/services/systemIdentityService.ts';
const env = await initializeTestEnvironment({projectId:'demo-staff-eod', firestore:{rules:compactRuleSymbols(readFileSync('firestore.rules','utf8'))}});
const tenantId='test';
const admin = fn => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore()));
const client = uid => env.authenticatedContext(uid).firestore();
try {
 await admin(async db => {
  for (const [id,role] of [['hr','HR Head'],['it','IT Head'],['support','IT Support Staff'],['cashier','cashier'],['owner','CEO']]) await setDoc(doc(db,'staff',id),{tenantId,role,status:'active',active:true,assigned_branches:['masaka']});
  await setDoc(doc(db,'staff','null-code'),{tenantId,full_name:'Legacy Null Code',role:'Staff',staff_code:null,status:'active',active:true});
  for (const id of ['employee-a','employee-b','empty-code']) await setDoc(doc(db,'staff',id),{tenantId,full_name:'Same Name',role:'Staff',staff_code:'',status:'active',active:true});
 });
 const hr=client('hr');
 const numbers=await Promise.all([ensureStaffIdentity(tenantId,'employee-a',hr),ensureStaffIdentity(tenantId,'employee-b',hr)]);
 assert.equal(new Set(numbers).size,2);
 assert.equal(await ensureStaffIdentity(tenantId,'employee-a',hr),numbers[0]);
 await assertFails(updateDoc(doc(hr,'staff','employee-b'),{staff_code:numbers[0]}));
 await assertFails(setDoc(doc(hr,'staff','forged'),{tenantId,role:'Staff',staff_code:numbers[0]}));
 await assertFails(updateDoc(doc(hr,'staff_identity_claims',`${tenantId}_${numbers[0]}`),{staffId:'someone-else'}));
 await assertFails(deleteDoc(doc(hr,'staff_identity_claims',`${tenantId}_${numbers[0]}`)));
 await assertFails(deleteDoc(doc(client('it'),'staff','employee-a')));
 await assertFails(ensureStaffIdentity(tenantId,'empty-code',client('cashier')));
 await assert.rejects(ensureStaffIdentity('other','employee-a',hr), /does not belong/);
 const created=await assertSucceeds(createScopedIdentity('staff',tenantId,{role:'Staff',full_name:'New Employee'},hr));
 assert.ok(!numbers.includes(created.code));
 await ensureStaffIdentity(tenantId,'empty-code',hr);
 assert.match(await ensureStaffIdentity(tenantId,'null-code',hr),/^STF-/);
 // The source survives activation and retains the reservation forever.
 const source=(await getDoc(doc(hr,'staff','employee-a'))).data();
 const itDb=client('it');
 const batch=writeBatch(itDb);
 batch.set(doc(itDb,'staff','activated-uid'),{...source,uid:'activated-uid',legacyStaffId:'employee-a',active:true,status:'active'});
 batch.update(doc(itDb,'staff','employee-a'),{canonical_staff_id:'activated-uid',active:false,status:'inactive'});
 await assertSucceeds(batch.commit());
 assert.equal(await ensureStaffIdentity(tenantId,'activated-uid',hr),numbers[0]);
 await assertFails(updateDoc(doc(itDb,'staff','employee-a'),{canonical_staff_id:'another-person'}));
 await assertFails(setDoc(doc(itDb,'staff','another-person'),{...source,uid:'another-person',legacyStaffId:'employee-a',active:true,status:'active'}));
 await assertSucceeds(backfillStaffIdentities(tenantId,hr));
 await assertSucceeds(backfillStaffIdentities(tenantId,hr));
 console.log('PASS staff: concurrent allocation, permanent claims, retries, legacy backfill, activation aliases, cross-tenant/unauthorised writes denied');
 const it=client('it');
 const day = daysAgo => {
  const date=new Date(Date.now()-daysAgo*86400000);
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
 };
 await admin(async db => {
  for (const age of [0,13,14,15,-1]) await setDoc(doc(db,'eod_reconciliations',`eod-${age}`),{tenantId,branch_id:'masaka',reconciliation_date:day(age),cash_actual:500000,cash_expected:500000,total_actual:500000,total_expected:500000,total_variance:0,status:'submitted'});
  await setDoc(doc(db,'eod_reconciliations','foreign'),{tenantId:'other',reconciliation_date:day(0)});
 });
 const patch=()=>({cash_actual:495000,correction_reason:'Count corrected after review',corrected_by:'it',corrected_at:serverTimestamp()});
 for (const uid of ['hr','cashier','support','owner']) await assertFails(updateDoc(doc(client(uid),'eod_reconciliations','eod-0'),{...patch(),corrected_by:uid}));
 await assertSucceeds(updateDoc(doc(it,'eod_reconciliations','eod-13'),patch()));
 for (const age of [14,15,-1]) await assertFails(updateDoc(doc(it,'eod_reconciliations',`eod-${age}`),patch()));
 await assertFails(updateDoc(doc(it,'eod_reconciliations','foreign'),patch()));
 await assertFails(updateDoc(doc(it,'eod_reconciliations','eod-0'),{...patch(),reconciliation_date:day(-1)}));
 await assertFails(updateDoc(doc(it,'eod_reconciliations','eod-0'),{...patch(),cash_expected:0}));
 await assertFails(updateDoc(doc(it,'eod_reconciliations','eod-0'),{...patch(),correction_reason:''}));
 await assertFails(deleteDoc(doc(it,'eod_reconciliations','eod-0')));
 const amounts=Object.fromEntries(EOD_CHANNELS.map(c=>[c,c==='cash'?500000:0]));
 await assertSucceeds(correctEod('eod-0',{uid:'it',tenantId,role:'IT Head'},amounts,'Verified exact match',it));
 const corrected=(await getDoc(doc(it,'eod_reconciliations','eod-0'))).data();
 assert.equal(corrected.total_variance,0);assert.equal(corrected.variance_reason,'');
 amounts.cash=495000;
 await assertSucceeds(correctEod('eod-0',{uid:'it',tenantId,role:'IT Head'},amounts,'Count shortage',it));
 assert.equal((await getDoc(doc(it,'eod_reconciliations','eod-0'))).data().total_variance,-5000);
 console.log('PASS EOD: IT Head-only corrections, no owner/support bypass, immutable date/expected, tenant boundary, 14-day cutoff, zero/shortage calculations');

 // Exercise the same Admin SDK transaction used by the authorised release job.
 const { createRequire }=await import('node:module');
 const req=createRequire(process.env.STAFF_BACKFILL_RUNTIME || '/tmp/staff-backfill-runtime/package.json');
 const {initializeApp,deleteApp}=req('firebase-admin/app');const {getFirestore}=req('firebase-admin/firestore');
 const { executeStaffIdentityBackfill }=await import('./staff-identity-backfill-execute.mjs');
 const adminApp=initializeApp({projectId:'demo-staff-eod'},'staff-backfill-test');const migrationDb=getFirestore(adminApp);
 try {
  const migrationTenant='migration-test';
  await migrationDb.collection('staff').doc('legacy-admin').set({tenantId:migrationTenant,full_name:'Synthetic Employee',staff_code:null});
  const preview=await executeStaffIdentityBackfill(migrationDb,migrationTenant,false);assert.equal(preview.codesAssigned,1);
  assert.equal((await migrationDb.collection('staff').doc('legacy-admin').get()).data().staff_code,null);
  const applied=await executeStaffIdentityBackfill(migrationDb,migrationTenant,true);assert.equal(applied.codesAssigned,1);
  const saved=(await migrationDb.collection('staff').doc('legacy-admin').get()).data();assert.equal(saved.staff_code,'STF-000001');assert.equal(saved.full_name,'Synthetic Employee');
  const repeated=await executeStaffIdentityBackfill(migrationDb,migrationTenant,true);assert.equal(repeated.codesAssigned,0);assert.equal(repeated.reservationsCreated,0);
  console.log('PASS release backfill: Admin transaction, read-only preview, atomic reservation/counter, personal fields preserved, idempotent retry');
 } finally {await deleteApp(adminApp);}

} finally { await env.cleanup(); }
