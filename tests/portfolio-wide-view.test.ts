import test from 'node:test';
import assert from 'node:assert/strict';
import {defineBuiltInPortfolio} from '../src/domain/finance/builtInPortfolios';
import {projectPortfolioBalances} from '../src/domain/finance/portfolioWideView';
import type {ManagementPaymentAccount} from '../src/services/managementCashPosting';
const at='2026-10-30T12:00:00Z';
const bank=defineBuiltInPortfolio({tenantId:'mp',key:'bank',createdBy:'ceo',createdAt:at});
const petty=defineBuiltInPortfolio({tenantId:'mp',key:'petty_cash',branchId:'masaka',createdBy:'ceo',createdAt:at});
const momo=defineBuiltInPortfolio({tenantId:'mp',key:'mtn_mobile_money',createdBy:'ceo',createdAt:at});
const funding:ManagementPaymentAccount={id:'mp_management_bank',tenantId:'mp',accountId:'management_bank',name:'Management Bank',kind:'bank',currency:'UGX',initialized:true,balanceUGX:450000,openingBalanceUGX:100000,reconciliationReference:'BANK-STMT-001'};
test('portfolio projection uses only verified authoritative mappings, never silently zeros unmapped balances',()=>{
 const views=projectPortfolioBalances([bank,petty,momo],[funding]);
 assert.deepEqual(views.map(x=>[x.status,x.balanceUGX]),[['reconciled',450000],['unavailable',null],['unavailable',null]]);
});
test('portfolio projection rejects duplicated accounts and isolates tenants',()=>{
 assert.throws(()=>projectPortfolioBalances([bank],[funding,funding]),/Duplicate authoritative/);
 assert.throws(()=>projectPortfolioBalances([bank,bank],[funding]),/Duplicate portfolio/);
 assert.equal(projectPortfolioBalances([bank],[{...funding,tenantId:'other'}])[0].balanceUGX,null);
});

test('bank parent consolidation is unavailable while registered child identities lack account mappings',()=>{
 const child={...bank,id:'bank_identity_one',origin:'custom' as const,
  bankParentId:'system_bank',bankInstitution:'EQUITY',bankAccountReference:'123456',
  supportsChildAccounts:false,allowsTransfersIn:false,allowsTransfersOut:false};
 const view=projectPortfolioBalances([bank,child],[funding]);
 assert.equal(view[0].status,'unavailable');
 assert.equal(view[0].balanceUGX,null);
 assert.equal(view[1].balanceUGX,null);
});
