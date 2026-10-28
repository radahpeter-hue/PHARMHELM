import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { compactRuleSymbols } from './build-firestore-release-rules.mjs';
import { ensureStaffIdentity, backfillStaffIdentities } from '../src/services/staffIdentityService.ts';
import { createScopedIdentity } from '../src/services/systemIdentityService.ts';
const env = await initializeTestEnvironment({projectId:'demo-staff-eod', firestore:{rules:compactRuleSymbols(readFileSync('firestore.rules','utf8'))}});
const tenantId='test';
const admin = fn => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore()));
const client = uid => env.authenticatedContext(uid).firestore();
try {
 await admin(async db => {
  for (const [id,role] of [['hr','HR Head'],['it','IT Head'],['support','IT Support Staff'],['cashier','cashier'],['owner','CEO']]) await setDoc(doc(db,'staff',id),{tenantId,role,status:'active',active:true,assigned_branches:['masaka']});
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
 // The source survives activation and retains the reservation forever.
 const source=(await getDoc(doc(hr,'staff','employee-a'))).data();
 const itDb=client('it');
 const batch=writeBatch(itDb);
 batch.set(doc(itDb,'staff','activated-uid'),{...source,uid:'activated-uid',legacyStaffId:'employee-a',active:true,status:'active'});
 batch.update(doc(itDb,'staff','employee-a'),{canonical_staff_id:'activated-uid',active:false,status:'inactive'});
 await assertSucceeds(batch.commit());
 assert.equal(await ensureStaffIdentity(tenantId,'activated-uid',hr),numbers[0]);
 await assertSucceeds(backfillStaffIdentities(tenantId,hr));
 await assertSucceeds(backfillStaffIdentities(tenantId,hr));
 console.log('PASS staff: concurrent allocation, permanent claims, retries, legacy backfill, activation aliases, cross-tenant/unauthorised writes denied');
} finally { await env.cleanup(); }
