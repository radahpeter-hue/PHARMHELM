import test from 'node:test';
import assert from 'node:assert/strict';
import {canApproveAuthority} from '../src/services/authorityApprovalPolicy';
test('authority controls support owner roles and verified bootstrap identity, never HR/IT alone',()=>{
 for(const role of ['HR Head','HR Support Personnel','IT Head','Finance Head','Employee'])assert.equal(canApproveAuthority({role},null),false);
 assert.equal(canApproveAuthority({role:'owner'},null),true);
 assert.equal(canApproveAuthority({role:'Employee',secondaryRoles:['CEO']},null),true);
 for(const emailVerified of [false,true])assert.equal(canApproveAuthority({role:'IT Head'},{email:'peterssentongo61@gmail.com',emailVerified}),emailVerified);
 assert.equal(canApproveAuthority({role:'IT Head'},{email:'someone@example.com',emailVerified:true}),false);
});
