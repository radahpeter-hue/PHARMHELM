import test from 'node:test';
import assert from 'node:assert/strict';
import {planFinanceV2AccountRegisterScope} from '../src/services/financeV2AccountRegisterScope';

const head = {tenantId:'tenant-a',role:'Finance Head' as const,assignedBranchIds:[]};
const officer = {tenantId:'tenant-a',role:'Finance Officer' as const,assignedBranchIds:['branch-a']};
const accountant = {tenantId:'tenant-a',role:'Accountant' as const,assignedBranchIds:['branch-a']};

test('Finance Head scope always includes tenant and V2 version',()=>{
  assert.deepEqual(planFinanceV2AccountRegisterScope(head),{tenantId:'tenant-a',controlVersion:2});
  assert.deepEqual(planFinanceV2AccountRegisterScope(head,'branch-a'),{tenantId:'tenant-a',controlVersion:2,branchId:'branch-a'});
});
test('delegated register remains closed until Firestore rules are certified',()=>{
  assert.throws(()=>planFinanceV2AccountRegisterScope(officer,'branch-a'),/not certified/);
  assert.throws(()=>planFinanceV2AccountRegisterScope(accountant,'branch-a'),/not certified/);
});
test('even after future certification, branch restriction is mandatory',()=>{
  assert.deepEqual(planFinanceV2AccountRegisterScope(officer,'branch-a',true),{tenantId:'tenant-a',controlVersion:2,branchId:'branch-a'});
  assert.throws(()=>planFinanceV2AccountRegisterScope(officer,undefined,true),/not assigned/);
  assert.throws(()=>planFinanceV2AccountRegisterScope(officer,'branch-b',true),/not assigned/);
  assert.throws(()=>planFinanceV2AccountRegisterScope(accountant,'branch-b',true),/not assigned/);
  assert.throws(()=>planFinanceV2AccountRegisterScope({...officer,tenantId:'../../foo'},'branch-a',true),/Invalid tenant/);
});
