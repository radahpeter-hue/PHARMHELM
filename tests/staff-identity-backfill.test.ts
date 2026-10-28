import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStaffIdentityBackfill as plan } from '../scripts/staff-identity-backfill-plan.mjs';
const tenantId='mp';
const employee=(id:string,staff_code?:string|null)=>({id,tenantId,full_name:'Same Name',staff_code,updateTime:'version'});
test('different records with repeated names get distinct numbers; null/missing codes are filled',()=>{
 const r=plan({tenantId,staff:[employee('a'),employee('b',null)],claims:[],counter:null});
 assert.deepEqual(r.updates.map(u=>u.code),['STF-000001','STF-000002']);assert.equal(r.lastSequence,2);
});
test('permanent reservations for departed staff and existing codes are never reused',()=>{
 const r=plan({tenantId,staff:[employee('new'),employee('existing','STF-000025')],claims:[{tenantId,staffId:'departed',code:'STF-000030'}],counter:{tenantId,kind:'staff',lastSequence:10}});
 assert.equal(r.updates[0].code,'STF-000031');assert.equal(r.reservations.find(x=>x.staffId==='existing')?.code,'STF-000025');
});
test('an already completed backfill is a no-op',()=>{
 const r=plan({tenantId,staff:[employee('a','STF-000001')],claims:[{tenantId,staffId:'a',code:'STF-000001'}],counter:{tenantId,kind:'staff',lastSequence:5}});
 assert.equal(r.updates.length,0);assert.equal(r.reservations.length,0);assert.equal(r.lastSequence,5);
});
test('duplicate existing codes, tenant mismatch and stolen reservations stop before writes',()=>{
 assert.throws(()=>plan({tenantId,staff:[employee('a','STF-000001'),employee('b','STF-000001')],claims:[],counter:null}),/Duplicate/);
 assert.throws(()=>plan({tenantId,staff:[{...employee('a'),tenantId:'other'}],claims:[],counter:null}),/tenant mismatch/);
 assert.throws(()=>plan({tenantId,staff:[employee('a','STF-000001')],claims:[{tenantId,staffId:'b',code:'STF-000001'}],counter:null}),/another identity/);
});
test('activation aliases preserve their original reservation and are not numbered twice',()=>{
 const r=plan({tenantId,staff:[{...employee('original','STF-000001'),canonical_staff_id:'uid'},{...employee('uid','STF-000001'),legacyStaffId:'original'}],claims:[{tenantId,staffId:'original',code:'STF-000001'}],counter:null});
 assert.equal(r.summary.aliasesSkipped,1);assert.equal(r.updates.length,0);assert.equal(r.reservations.length,0);
});
