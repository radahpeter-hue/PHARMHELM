import {registeredBankAccounts} from '../src/domain/finance/portfolioFirestore';
import test from 'node:test';
import assert from 'node:assert/strict';
import {defineBuiltInPortfolio} from '../src/domain/finance/builtInPortfolios';
import {assertUniqueBankAccount,validatePortfolioChildAccount,bankAccountIdentity,type PortfolioChildAccount} from '../src/domain/finance/portfolioAccounts';
const p=defineBuiltInPortfolio({tenantId:'mp',key:'bank',createdBy:'ceo',createdAt:'2026-10-29T09:00:00Z'});
const a:PortfolioChildAccount={id:'eq_ops',tenantId:'mp',portfolioId:p.id,displayName:'Equity operating',accountReference:'123 456',institution:'Equity',currency:'UGX',scope:{kind:'organisation'},status:'active',createdBy:'ceo',createdAt:'2026-10-29T09:00:00Z'};
test('Changes 042-047 validate nested accounts and exact bank identity',()=>{
 assert.equal(validatePortfolioChildAccount(a,p).id,'eq_ops');
 assert.doesNotThrow(()=>assertUniqueBankAccount({...a,id:'eq_payroll',accountReference:'789123'},[a]));
 assert.throws(()=>assertUniqueBankAccount({...a,id:'eq_payroll',accountReference:'123-456'},[a]),/Duplicate/);
 assert.throws(()=>validatePortfolioChildAccount({...a,tenantId:'foreign'},p),/scope/);
 const bcs=defineBuiltInPortfolio({tenantId:'mp',key:'branch_cash_sales',branchId:'masaka',createdBy:'ceo',createdAt:'2026-10-29T09:00:00Z'});
 assert.throws(()=>validatePortfolioChildAccount({...a,portfolioId:bcs.id},bcs),/does not permit/);
});

test('Change 047 bank identity stays opaque, deterministic and prevents same-bank aliases',async()=>{
 const one=await bankAccountIdentity('mp',p.id,'Equity Bank','123-456');
 const again=await bankAccountIdentity('mp',p.id,'  EQUITY  BANK ','123 456');
 const different=await bankAccountIdentity('mp',p.id,'Stanbic Bank','123456');
 assert.match(one,/^bank_[0-9a-f]{64}$/);
 assert.equal(one,again);
 assert.notEqual(one,different);
 assert.doesNotThrow(()=>assertUniqueBankAccount({...a,id:'other',institution:'Stanbic Bank'},[a]));
});

test('individual bank identities are grouped under one virtual parent without inventing balances',()=>{
 const eq={...p,id:'bank_eq',origin:'custom' as const,supportsChildAccounts:false,bankInstitution:'EQUITY',bankAccountReference:'123456',bankParentId:'system_bank'};
 const st={...eq,id:'bank_st',bankInstitution:'STANBIC',bankAccountReference:'987654'};
 assert.deepEqual(registeredBankAccounts([p,eq,st]).map(v=>v.id),['bank_eq','bank_st']);
});
