import {test} from 'node:test';import assert from 'node:assert/strict';
import {planStaffDuplicateAudit as plan} from '../src/utils/staffIdentityAudit';
const s=(id:string,extra:any={})=>({id,tenantId:'t',full_name:'Alex',email:'alex@example.com',phone_number:'0772123456',...extra});
test('legacy copy with one actual login identity can be retired without guessing names',()=>{
 const r=plan([s('legacy'),s('uid',{uid:'uid'})],[{uid:'uid',email:'alex@example.com'}]);assert.equal(r.summary.verifiedDuplicates,1);assert.equal(r.groups[0].canonicalId,'uid');
});
test('same names alone and multiple enabled login accounts are never auto merged',()=>{
 assert.equal(plan([s('a',{email:'a@example.com',phone_number:''}),s('b',{email:'b@example.com',phone_number:''})],[]).summary.duplicateGroups,0);
 assert.equal(plan([s('a'),s('b')],[{uid:'a'},{uid:'b'}]).summary.reviewGroups,1);
});
test('aliases stay out of operational groups and email/phone without login proof requires review',()=>{
 assert.equal(plan([s('a'),s('b',{canonical_staff_id:'a'})],[]).summary.aliases,1);
 assert.equal(plan([s('a'),s('b')],[]).summary.reviewGroups,1);
});
