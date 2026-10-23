import test from 'node:test';
import assert from 'node:assert/strict';
import {financeV2AccountDocumentId,isLegacyManagementAccount,planFinanceV2AccountRegistration} from '../src/services/financeV2AccountRegistryPolicy';

const base = {
  tenantId:'tenant-1',accountId:'masaka_cash',name:'Masaka Branch Cash Sales',
  kind:'BRANCH_CASH_SALES' as const,branchId:'masaka',openingBalanceUGX:0,
  reconciliationReference:'OPEN-2026-001',actorUid:'finance-head'
};

test('creates reconciled branch cash account contract without posting money',()=>{
  const planned=planFinanceV2AccountRegistration(base);
  assert.equal(planned.balanceUGX,0);
  assert.equal(planned.openingBalanceUGX,0);
  assert.equal(planned.controlVersion,2);
  assert.equal(planned.lastPostingId,null);
  assert.equal(planned.branchId,'masaka');
  assert.equal(financeV2AccountDocumentId(base.tenantId,base.accountId),'tenant-1_masaka_cash');
});

test('permits multiple real bank and mobile money accounts',()=>{
  for(const kind of ['BANK','MTN_MOBILE_MONEY','AIRTEL_MONEY','PETTY_CASH'] as const){
    assert.equal(planFinanceV2AccountRegistration({...base,kind,branchId:undefined}).kind,kind);
  }
});

test('prevents accidental overwrite or re-registration of controlled legacy management IDs',()=>{
  assert.equal(isLegacyManagementAccount('management_bank'),true);
  assert.equal(isLegacyManagementAccount('management_petty_cash'),true);
  for(const accountId of ['management_bank','management_petty_cash'])
    assert.throws(()=>planFinanceV2AccountRegistration({...base,accountId}),/reserved/);
});

test('requires branch for cash sales and valid opening evidence',()=>{
  assert.throws(()=>planFinanceV2AccountRegistration({...base,branchId:undefined}),/requires a branch/);
  assert.throws(()=>planFinanceV2AccountRegistration({...base,openingBalanceUGX:-1}),/Opening balance/);
  assert.throws(()=>planFinanceV2AccountRegistration({...base,openingBalanceUGX:1.5}),/Opening balance/);
  assert.throws(()=>planFinanceV2AccountRegistration({...base,reconciliationReference:'x'}),/reconciliation reference/);
  assert.throws(()=>planFinanceV2AccountRegistration({...base,accountId:'bad/id'}),/Invalid account identity/);
});
